import { Schema } from "effect";

export const TrainSystem = Schema.Literals(["krl", "mrt", "lrt"]);
export type TrainSystem = typeof TrainSystem.Type;

export const SourceEvidence = Schema.Struct({
  url: Schema.String.check(Schema.isNonEmpty()),
  retrievedAt: Schema.DateTimeUtcFromString,
  kind: Schema.Literals(["official-json", "official-html", "manual-topology", "inferred-topology"]),
});

export const SourceStation = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  name: Schema.String.check(Schema.isNonEmpty()),
  enabled: Schema.optionalKey(Schema.Boolean),
  slug: Schema.optionalKey(Schema.String),
});

export const OrderedTopology = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  label: Schema.String.check(Schema.isNonEmpty()),
  color: Schema.optionalKey(Schema.String),
  stationIds: Schema.Array(Schema.String).check(Schema.isNonEmpty()),
  provenance: Schema.Literals(["observed-train-run", "manual-official-network"]),
  notes: Schema.Array(Schema.String),
});

const ServiceAvailability = Schema.TaggedUnion({
  Scheduled: {
    semantics: Schema.Literals([
      "train-stop-calls",
      "directional-station-departures",
      "untagged-station-departures",
    ]),
    topology: Schema.Literals(["inferred", "manual", "unresolved"]),
  },
  FrequencyOnly: {
    topology: Schema.Literals(["inferred", "manual", "unresolved"]),
    reason: Schema.String,
  },
  TopologyOnly: {
    topology: Schema.Literals(["inferred", "manual", "unresolved"]),
    reason: Schema.String,
  },
});

const KrlObservation = Schema.Struct({
  trainId: Schema.String,
  stationId: Schema.String,
  stationName: Schema.String,
  lineName: Schema.String,
  routeName: Schema.String,
  destination: Schema.String,
  departure: Schema.String,
  destinationTime: Schema.String,
  color: Schema.String,
});

const LrtObservation = Schema.Struct({
  stationId: Schema.String,
  stationName: Schema.String,
  weekdays: Schema.Array(Schema.String),
  weekends: Schema.Array(Schema.String),
});

const MrtDirection = Schema.Struct({
  destination: Schema.String,
  direction: Schema.Literals(["start", "end"]),
  weekdays: Schema.Array(Schema.String),
  weekends: Schema.Array(Schema.String),
});

const MrtObservation = Schema.Struct({
  stationId: Schema.String,
  stationName: Schema.String,
  slug: Schema.String,
  directions: Schema.Array(MrtDirection),
});

const snapshotFields = {
  schemaVersion: Schema.Literal("1"),
  retrievedAt: Schema.DateTimeUtcFromString,
  sources: Schema.Array(SourceEvidence),
  stations: Schema.Array(SourceStation),
  topologies: Schema.Array(OrderedTopology),
  availability: ServiceAvailability,
  warnings: Schema.Array(Schema.String),
};

export const TrainSourceSnapshot = Schema.TaggedUnion({
  Krl: {
    ...snapshotFields,
    system: Schema.Literal("krl"),
    observations: Schema.Array(KrlObservation),
  },
  Lrt: {
    ...snapshotFields,
    system: Schema.Literal("lrt"),
    observations: Schema.Array(LrtObservation),
  },
  Mrt: {
    ...snapshotFields,
    system: Schema.Literal("mrt"),
    observations: Schema.Array(MrtObservation),
  },
});

export type TrainSourceSnapshot = typeof TrainSourceSnapshot.Type;

export const ImportFailure = Schema.Struct({
  system: TrainSystem,
  errorTag: Schema.String,
  operation: Schema.String,
  detail: Schema.String,
});

export const TrainImportReport = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  generatedAt: Schema.DateTimeUtcFromString,
  snapshots: Schema.Array(TrainSourceSnapshot),
  failures: Schema.Array(ImportFailure),
});

export type TrainImportReport = typeof TrainImportReport.Type;
