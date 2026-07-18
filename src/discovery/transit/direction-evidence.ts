import { Effect, Schema } from "effect";

import { RoutePatternId, type NetworkSnapshot } from "../../domain/transit/index.js";

export const DirectionLabelProvenance = Schema.TaggedUnion({
  TripHeadsign: {
    headsign: Schema.String.check(Schema.isNonEmpty()),
    tripCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  },
  StopHeadsign: {
    headsign: Schema.String.check(Schema.isNonEmpty()),
    observationCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  },
  FinalStopName: {
    stopName: Schema.String.check(Schema.isNonEmpty()),
  },
  Absent: {
    reason: Schema.String.check(Schema.isNonEmpty()),
  },
});
export type DirectionLabelProvenance = typeof DirectionLabelProvenance.Type;

export const PatternDirectionEvidence = Schema.Struct({
  patternId: RoutePatternId,
  routeId: Schema.String.check(Schema.isNonEmpty()),
  candidates: Schema.Array(DirectionLabelProvenance).check(Schema.isNonEmpty()),
  classification: Schema.Literals([
    "StableTripHeadsign",
    "ConflictingTripHeadsigns",
    "StopHeadsignOnly",
    "FinalStopFallback",
    "Absent",
  ]),
});
export interface PatternDirectionEvidence extends Schema.Schema.Type<
  typeof PatternDirectionEvidence
> {}

export const DirectionEvidenceReport = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  sourceArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  patterns: Schema.Array(PatternDirectionEvidence),
  counts: Schema.Struct({
    stableTripHeadsign: Schema.Int,
    conflictingTripHeadsigns: Schema.Int,
    stopHeadsignOnly: Schema.Int,
    finalStopFallback: Schema.Int,
    absent: Schema.Int,
  }),
});
export interface DirectionEvidenceReport extends Schema.Schema.Type<
  typeof DirectionEvidenceReport
> {}

export const projectDirectionEvidence = Effect.fn("PatternDirectionEvidence.project")(function* (
  snapshot: NetworkSnapshot,
  sourceArtifactVersion: string,
) {
  const stopNameById = new Map(snapshot.stops.map((stop) => [stop.id, stop.name]));
  const patterns = [];
  let stableTripHeadsign = 0;
  let conflictingTripHeadsigns = 0;
  let stopHeadsignOnly = 0;
  let finalStopFallback = 0;
  let absent = 0;

  for (const pattern of [...snapshot.patterns].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const trips = snapshot.trips.filter((trip) => trip.patternId === pattern.id);
    const headsignCounts = new Map<string, number>();
    for (const trip of trips) {
      const headsign = trip.headsign?.trim();
      if (headsign === undefined || headsign.length === 0) continue;
      headsignCounts.set(headsign, (headsignCounts.get(headsign) ?? 0) + 1);
    }
    const stopHeadsignCounts = new Map<string, number>();
    for (const trip of trips) {
      if (trip.availability._tag !== "Scheduled") continue;
      for (const stopTime of trip.availability.stopTimes) {
        const headsign = stopTime.stopHeadsign?.trim();
        if (headsign === undefined || headsign.length === 0) continue;
        stopHeadsignCounts.set(headsign, (stopHeadsignCounts.get(headsign) ?? 0) + 1);
      }
    }
    const finalStopId = pattern.stopIds.at(-1);
    const finalStopName =
      finalStopId === undefined ? undefined : stopNameById.get(finalStopId)?.trim();

    const candidates: Array<typeof DirectionLabelProvenance.Type> = [];
    for (const [headsign, tripCount] of [...headsignCounts.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      candidates.push({ _tag: "TripHeadsign", headsign, tripCount });
    }
    for (const [headsign, observationCount] of [...stopHeadsignCounts.entries()].sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      candidates.push({ _tag: "StopHeadsign", headsign, observationCount });
    }
    if (finalStopName !== undefined && finalStopName.length > 0) {
      candidates.push({ _tag: "FinalStopName", stopName: finalStopName });
    }

    let classification:
      | "StableTripHeadsign"
      | "ConflictingTripHeadsigns"
      | "StopHeadsignOnly"
      | "FinalStopFallback"
      | "Absent";
    if (headsignCounts.size === 1) {
      classification = "StableTripHeadsign";
      stableTripHeadsign += 1;
    } else if (headsignCounts.size > 1) {
      classification = "ConflictingTripHeadsigns";
      conflictingTripHeadsigns += 1;
    } else if (stopHeadsignCounts.size > 0) {
      classification = "StopHeadsignOnly";
      stopHeadsignOnly += 1;
    } else if (finalStopName !== undefined && finalStopName.length > 0) {
      classification = "FinalStopFallback";
      finalStopFallback += 1;
    } else {
      classification = "Absent";
      absent += 1;
      candidates.push({
        _tag: "Absent",
        reason: "No trip headsign, stop headsign, or final stop name",
      });
    }

    patterns.push({
      patternId: pattern.id,
      routeId: pattern.routeId,
      candidates,
      classification,
    });
  }

  return yield* Schema.decodeUnknownEffect(DirectionEvidenceReport)({
    schemaVersion: "1",
    sourceArtifactVersion,
    patterns,
    counts: {
      stableTripHeadsign,
      conflictingTripHeadsigns,
      stopHeadsignOnly,
      finalStopFallback,
      absent,
    },
  });
});
