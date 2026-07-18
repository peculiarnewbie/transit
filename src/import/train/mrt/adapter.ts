import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";

import { DecodeError, type TrainImportError } from "../errors.js";
import { TrainSourceHttp } from "../http.js";
import { TrainSourceSnapshot } from "../model.js";
import { retryAcquisition } from "../retry.js";
import { type ScheduleObject, StationDetailResponse, StationsResponse } from "./raw.js";

const API_BASE = "https://beweb-dev.jakartamrt.co.id/middleware/api/datum";
export const STATIONS_URL = `${API_BASE}?fields[]=id&fields[]=slug&fields[]=name&filters[field][slug]=stasiun&locale=id`;
export const stationDetailUrl = (slug: string) =>
  `${API_BASE}?fields[]=id&fields[]=name&fields[]=slug&fields[]=object&filters[field][slug]=stasiun&filters[slug]=${encodeURIComponent(slug)}&pagination[limit]=1&sort[]=id:desc`;

const splitTimes = (value: string | undefined): Array<string> =>
  value === undefined
    ? []
    : value
        .split(";")
        .map((time) => time.trim())
        .filter(Boolean);

const directions = (schedule: ScheduleObject | undefined) => [
  ...(schedule?.end === undefined
    ? []
    : [
        {
          destination: schedule.end,
          direction: "end" as const,
          weekdays: splitTimes(schedule.weekdaysEnd),
          weekends: splitTimes(schedule.weekendsEnd),
        },
      ]),
  ...(schedule?.start === undefined
    ? []
    : [
        {
          destination: schedule.start,
          direction: "start" as const,
          weekdays: splitTimes(schedule.weekdaysStart),
          weekends: splitTimes(schedule.weekendsStart),
        },
      ]),
];

export interface Interface {
  readonly acquire: () => Effect.Effect<typeof TrainSourceSnapshot.Type, TrainImportError>;
}

export class Service extends Context.Service<Service, Interface>()("@transit/MrtSourceAdapter") {}

const decode = <A, I, R>(
  schema: Schema.Codec<A, I, R, never>,
  operation: string,
  source: string,
  input: unknown,
) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((cause) => new DecodeError({ operation, system: "mrt", source, cause })),
  );

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* TrainSourceHttp.Service;
    const acquire = Effect.fn("MrtSourceAdapter.acquire")(function* () {
      const retrievedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
      const listBody = yield* retryAcquisition(
        http.getJson({
          operation: "MrtSourceAdapter.fetchStations",
          system: "mrt",
          url: STATIONS_URL,
        }),
      );
      const list = yield* decode(
        StationsResponse,
        "MrtSourceAdapter.decodeStations",
        STATIONS_URL,
        listBody,
      );
      if (list.data.length === 0) {
        return yield* new DecodeError({
          operation: "MrtSourceAdapter.decodeStations",
          system: "mrt",
          source: STATIONS_URL,
          cause: "Official station list was empty.",
        });
      }
      const results = yield* Effect.forEach(
        list.data,
        (station, index) => {
          const url = stationDetailUrl(station.slug);
          return http
            .getJson({ operation: "MrtSourceAdapter.fetchStationDetail", system: "mrt", url })
            .pipe(
              Effect.delay(Duration.millis((index % 4) * 50)),
              retryAcquisition,
              Effect.flatMap((body) =>
                decode(StationDetailResponse, "MrtSourceAdapter.decodeStationDetail", url, body),
              ),
              Effect.flatMap((body) =>
                body.data[0] === undefined
                  ? Effect.fail(
                      new DecodeError({
                        operation: "MrtSourceAdapter.decodeStationDetail",
                        system: "mrt",
                        source: url,
                        cause: "Official station detail was empty.",
                      }),
                    )
                  : Effect.succeed({ station, detail: body.data[0] }),
              ),
              Effect.result,
            );
        },
        { concurrency: 4 },
      );
      const observations = results.flatMap((result) =>
        result._tag === "Failure"
          ? []
          : [
              {
                stationId: String(result.success.station.id),
                stationName: result.success.station.name.trim(),
                slug: result.success.station.slug,
                directions: directions(result.success.detail.object?.schedule),
              },
            ],
      );
      const failed = results.flatMap((result, index) => {
        const station = list.data[index];
        return result._tag === "Failure" && station !== undefined ? [String(station.id)] : [];
      });
      return yield* Schema.decodeUnknownEffect(TrainSourceSnapshot)({
        _tag: "Mrt",
        schemaVersion: "1",
        system: "mrt",
        retrievedAt,
        sources: [
          { url: STATIONS_URL, retrievedAt, kind: "official-json" },
          { url: stationDetailUrl("{slug}"), retrievedAt, kind: "official-json" },
        ],
        stations: list.data.map((station) => ({
          id: String(station.id),
          name: station.name.trim(),
          slug: station.slug,
        })),
        observations,
        topologies: [],
        availability:
          observations.length === 0
            ? {
                _tag: "TopologyOnly",
                topology: "unresolved",
                reason: "No directional station schedule was acquired.",
              }
            : {
                _tag: "Scheduled",
                semantics: "directional-station-departures",
                topology: "unresolved",
              },
        warnings: [
          "MRT source publishes directional station departures but no ordered topology.",
          ...(failed.length === 0
            ? []
            : [
                `Partial MRT source: station detail acquisition failed for ${failed.sort().join(", ")}.`,
              ]),
        ],
      }).pipe(
        Effect.mapError(
          (cause) =>
            new DecodeError({
              operation: "MrtSourceAdapter.buildSnapshot",
              system: "mrt",
              source: STATIONS_URL,
              cause,
            }),
        ),
      );
    });
    return Service.of({ acquire });
  }),
);

export * as MrtSourceAdapter from "./adapter.js";
