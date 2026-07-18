import { Clock, Context, Effect, Layer, Schema } from "effect";

import { DecodeError, type TrainImportError } from "../errors.js";
import { TrainSourceHttp } from "../http.js";
import { TrainSourceSnapshot } from "../model.js";
import { retryAcquisition } from "../retry.js";
import { parseSchedulePage } from "./parser.js";

export const SCHEDULES_URL = "https://lrtjabodebek.kai.id/jadwal-keberangkatan";

const TRUNK = [
  "dukuh-atas-bni",
  "setiabudi",
  "rasuna-said",
  "kuningan",
  "pancoran-bank-bjb",
  "cikoko",
  "ciliwung",
  "cawang",
] as const;

const TOPOLOGIES = [
  {
    id: "LIN BEKASI",
    label: "Bekasi",
    color: "#2563EB",
    stationIds: [
      ...TRUNK,
      "halim",
      "jati-bening-baru",
      "cikunir-1",
      "cikunir-2",
      "bekasi-barat",
      "jati-mulya",
    ],
  },
  {
    id: "LIN CIBUBUR",
    label: "Cibubur",
    color: "#DB2777",
    stationIds: [...TRUNK, "taman-mini", "kampung-rambutan", "ciracas", "harjamukti"],
  },
] as const;

export interface Interface {
  readonly acquire: () => Effect.Effect<typeof TrainSourceSnapshot.Type, TrainImportError>;
}

export class Service extends Context.Service<Service, Interface>()("@transit/LrtSourceAdapter") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* TrainSourceHttp.Service;
    const acquire = Effect.fn("LrtSourceAdapter.acquire")(function* () {
      const retrievedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
      const html = yield* retryAcquisition(
        http.getText({
          operation: "LrtSourceAdapter.fetchSchedulePage",
          system: "lrt",
          url: SCHEDULES_URL,
        }),
      );
      const stations = yield* parseSchedulePage(SCHEDULES_URL, html);
      const hasSchedules = stations.some(
        (station) => station.weekdays.length + station.weekends.length > 0,
      );
      return yield* Schema.decodeUnknownEffect(TrainSourceSnapshot)({
        _tag: "Lrt",
        schemaVersion: "1",
        system: "lrt",
        retrievedAt,
        sources: [
          { url: SCHEDULES_URL, retrievedAt, kind: "official-html" },
          { url: "https://lrtjabodebek.kai.id/", retrievedAt, kind: "manual-topology" },
        ],
        stations: stations.map((station) => ({
          id: station.id,
          name: station.name,
          slug: station.id,
        })),
        observations: stations.map((station) => ({
          stationId: station.id,
          stationName: station.name,
          weekdays: station.weekdays,
          weekends: station.weekends,
        })),
        topologies: TOPOLOGIES.map((topology) => ({
          ...topology,
          provenance: "manual-official-network",
          notes: [
            "Ordered line membership is manually maintained; the schedule page does not tag departures by destination or line.",
          ],
        })),
        availability: hasSchedules
          ? { _tag: "Scheduled", semantics: "untagged-station-departures", topology: "manual" }
          : {
              _tag: "TopologyOnly",
              topology: "manual",
              reason: "The official page exposed station tabs but no departure times.",
            },
        warnings: [
          "LRT departure lists have no destination or line tags and cannot be assigned to a topology without curation.",
        ],
      }).pipe(
        Effect.mapError(
          (cause) =>
            new DecodeError({
              operation: "LrtSourceAdapter.buildSnapshot",
              system: "lrt",
              source: SCHEDULES_URL,
              cause,
            }),
        ),
      );
    });
    return Service.of({ acquire });
  }),
);

export * as LrtSourceAdapter from "./adapter.js";
