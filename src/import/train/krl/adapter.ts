import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";

import { DecodeError, type TrainImportError } from "../errors.js";
import { TrainSourceHttp } from "../http.js";
import { TrainSourceSnapshot } from "../model.js";
import { retryAcquisition } from "../retry.js";
import { SchedulesResponse, Station, StationsResponse } from "./raw.js";
import { inferTopologies, type ObservedStop } from "./topology.js";

export const STATIONS_URL = "https://kci.id/api/krl/stations";
export const SCHEDULES_URL = "https://kci.id/api/krl/schedules";

export interface Interface {
  readonly acquire: () => Effect.Effect<typeof TrainSourceSnapshot.Type, TrainImportError>;
}

export class Service extends Context.Service<Service, Interface>()("@transit/KrlSourceAdapter") {}

const decode = <A, I, R>(
  schema: Schema.Codec<A, I, R, never>,
  operation: string,
  source: string,
  input: unknown,
) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((cause) => new DecodeError({ operation, system: "krl", source, cause })),
  );

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* TrainSourceHttp.Service;

    const acquire = Effect.fn("KrlSourceAdapter.acquire")(function* () {
      const retrievedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
      const stationsBody = yield* retryAcquisition(
        http.getJson({
          operation: "KrlSourceAdapter.fetchStations",
          system: "krl",
          url: STATIONS_URL,
        }),
      );
      const stationsResponse = yield* decode(
        StationsResponse,
        "KrlSourceAdapter.decodeStations",
        STATIONS_URL,
        stationsBody,
      );
      if (stationsResponse.status !== 200) {
        return yield* new DecodeError({
          operation: "KrlSourceAdapter.decodeStations",
          system: "krl",
          source: STATIONS_URL,
          cause: `Provider body status ${stationsResponse.status}`,
        });
      }

      const enabled = stationsResponse.data.filter((station) => station.fg_enable === 1);
      const results = yield* Effect.forEach(
        enabled,
        (station, index) => {
          const url = new URL(SCHEDULES_URL);
          url.searchParams.set("stationid", station.sta_id);
          url.searchParams.set("timefrom", "00:00");
          url.searchParams.set("timeto", "23:59");
          return http
            .getJson({
              operation: "KrlSourceAdapter.fetchSchedules",
              system: "krl",
              url: url.toString(),
            })
            .pipe(
              Effect.delay(Duration.millis((index % 4) * 75)),
              retryAcquisition,
              Effect.flatMap((body) =>
                decode(SchedulesResponse, "KrlSourceAdapter.decodeSchedules", url.toString(), body),
              ),
              Effect.flatMap((response) =>
                response.status === 200
                  ? Effect.succeed({ station, rows: response.data })
                  : Effect.fail(
                      new DecodeError({
                        operation: "KrlSourceAdapter.decodeSchedules",
                        system: "krl",
                        source: url.toString(),
                        cause: `Provider body status ${response.status}`,
                      }),
                    ),
              ),
              Effect.result,
            );
        },
        { concurrency: 4 },
      );

      const observations: Array<ObservedStop> = [];
      const failedStationIds: Array<string> = [];
      for (const result of results) {
        if (result._tag === "Failure") {
          const match = enabled[results.indexOf(result)];
          if (match !== undefined) failedStationIds.push(match.sta_id);
          continue;
        }
        for (const row of result.success.rows)
          observations.push({ ...row, stationId: result.success.station.sta_id });
      }

      return yield* Schema.decodeUnknownEffect(TrainSourceSnapshot)({
        _tag: "Krl",
        schemaVersion: "1",
        system: "krl",
        retrievedAt,
        sources: [
          { url: STATIONS_URL, retrievedAt, kind: "official-json" },
          {
            url: `${SCHEDULES_URL}?stationid={id}&timefrom=00%3A00&timeto=23%3A59`,
            retrievedAt,
            kind: "official-json",
          },
          { url: SCHEDULES_URL, retrievedAt, kind: "inferred-topology" },
        ],
        stations: stationsResponse.data.map((station: Station) => ({
          id: station.sta_id,
          name: station.sta_name,
          enabled: station.fg_enable === 1,
        })),
        observations: observations.map((row) => ({
          trainId: row.train_id,
          stationId: row.stationId,
          stationName:
            stationsResponse.data.find((station) => station.sta_id === row.stationId)?.sta_name ??
            row.stationId,
          lineName: row.ka_name,
          routeName: row.route_name,
          destination: row.dest,
          departure: row.time_est,
          destinationTime: row.dest_time,
          color: row.color,
        })),
        topologies: inferTopologies(observations, stationsResponse.data).map((topology) => ({
          ...topology,
          provenance: "observed-train-run",
        })),
        availability: {
          _tag: observations.length === 0 ? "TopologyOnly" : "Scheduled",
          ...(observations.length === 0
            ? { topology: "inferred", reason: "No station schedule request succeeded." }
            : { semantics: "train-stop-calls", topology: "inferred" }),
        },
        warnings:
          failedStationIds.length === 0
            ? []
            : [
                `Partial KRL source: schedule acquisition failed for ${failedStationIds.sort().join(", ")}.`,
              ],
      }).pipe(
        Effect.mapError(
          (cause) =>
            new DecodeError({
              operation: "KrlSourceAdapter.buildSnapshot",
              system: "krl",
              source: STATIONS_URL,
              cause,
            }),
        ),
      );
    });

    return Service.of({ acquire });
  }),
);

export * as KrlSourceAdapter from "./adapter.js";
