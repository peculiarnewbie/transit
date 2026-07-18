import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Effect, Schema } from "effect";

import { NetworkSnapshot } from "../../src/domain/transit/index.js";
import {
  projectDirectionEvidence,
  TransitPlaceProjection,
} from "../../src/discovery/transit/index.js";

const args = process.argv.slice(2);
const getArg = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const snapshotPath = resolve(
  getArg("--snapshot") ?? "public/artifacts/bus-transjakarta-20260630-v2.network.json",
);
const artifactVersion = getArg("--version") ?? "bus-transjakarta-20260630-v2";
const overridesPath = getArg("--overrides");
const outputPath = resolve(getArg("--output") ?? "docs/data/transit-place-audit.json");

const main = Effect.gen(function* () {
  const raw = JSON.parse(readFileSync(snapshotPath, "utf8")) as unknown;
  const snapshot = yield* Schema.decodeUnknownEffect(NetworkSnapshot)(raw);
  const overrides =
    overridesPath === undefined
      ? undefined
      : JSON.parse(readFileSync(resolve(overridesPath), "utf8"));

  const projection = yield* TransitPlaceProjection.Service;
  const index = yield* projection.project({
    snapshot: raw,
    sourceArtifactVersion: artifactVersion,
    overrides,
  });
  const validation = yield* projection.validationReport(index);
  const direction = yield* projectDirectionEvidence(snapshot, artifactVersion);

  const stopsByKind = snapshot.stops.reduce<Record<string, number>>((counts, stop) => {
    counts[stop.locationKind] = (counts[stop.locationKind] ?? 0) + 1;
    return counts;
  }, {});

  let pickupForbidden = 0;
  let dropOffForbidden = 0;
  let stopHeadsignCount = 0;
  let platformCodeCount = 0;
  let wheelchairPossible = 0;
  let wheelchairNotPossible = 0;
  let wheelchairUnknown = 0;
  for (const stop of snapshot.stops) {
    if (stop.platformCode !== undefined) platformCodeCount += 1;
    if (stop.wheelchairBoarding === "Possible") wheelchairPossible += 1;
    if (stop.wheelchairBoarding === "NotPossible") wheelchairNotPossible += 1;
    if (stop.wheelchairBoarding === "Unknown") wheelchairUnknown += 1;
  }
  for (const trip of snapshot.trips) {
    if (trip.availability._tag !== "Scheduled") continue;
    for (const stopTime of trip.availability.stopTimes) {
      if (stopTime.pickupPolicy === "Forbidden") pickupForbidden += 1;
      if (stopTime.dropOffPolicy === "Forbidden") dropOffForbidden += 1;
      if (stopTime.stopHeadsign !== undefined) stopHeadsignCount += 1;
    }
  }

  const duplicateNameGroups = new Map<string, number>();
  for (const place of Object.values(index.placesById)) {
    const key = place.primaryName.toLowerCase();
    duplicateNameGroups.set(key, (duplicateNameGroups.get(key) ?? 0) + 1);
  }
  const duplicatePrimaryNames = [...duplicateNameGroups.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

  const report = {
    schemaVersion: "1",
    sourceArtifactVersion: artifactVersion,
    snapshotPath,
    input: {
      stops: snapshot.stops.length,
      patterns: snapshot.patterns.length,
      trips: snapshot.trips.length,
      routes: snapshot.routes.length,
      transfers: snapshot.transfers.length,
    },
    stopsByLocationKind: stopsByKind,
    projection: {
      placeCount: validation.placeCount,
      sourceParentGroupCount: validation.sourceParentGroupCount,
      standaloneCount: validation.standaloneCount,
      reviewedComplexCount: validation.reviewedComplexCount,
      unresolvedFindingCount: validation.unresolvedFindingCount,
      unresolvedFindingSample: validation.findings.slice(0, 25),
    },
    policies: {
      pickupForbidden,
      dropOffForbidden,
      stopHeadsignCount,
      platformCodeCount,
      wheelchairPossible,
      wheelchairNotPossible,
      wheelchairUnknown,
    },
    directionEvidence: direction.counts,
    duplicatePrimaryNames: duplicatePrimaryNames.slice(0, 50),
    reconciliation: {
      inputStops: snapshot.stops.length,
      assignedStops: Object.keys(index.placeIdByStopId).length,
      silentlyDroppedStops: snapshot.stops.length - Object.keys(index.placeIdByStopId).length,
      inputPatterns: snapshot.patterns.length,
      directionEvidencePatterns: direction.patterns.length,
      silentlyDroppedPatterns: snapshot.patterns.length - direction.patterns.length,
    },
    notes: [
      "v2 topology migrated from published v1 defaults locationKind=Stop when GTFS source ZIP is unavailable; recompile from GTFS to restore station/platform kinds.",
      "Unresolved proposed complexes are findings only and do not create membership or transfers.",
    ],
  };

  if (report.reconciliation.silentlyDroppedStops !== 0) {
    return yield* Effect.fail(
      new Error(`Silent stop loss: ${report.reconciliation.silentlyDroppedStops}`),
    );
  }
  if (report.reconciliation.silentlyDroppedPatterns !== 0) {
    return yield* Effect.fail(
      new Error(`Silent pattern loss: ${report.reconciliation.silentlyDroppedPatterns}`),
    );
  }
  if (report.input.stops !== 8243) {
    return yield* Effect.fail(
      new Error(`Expected 8243 stops for ${artifactVersion}, found ${report.input.stops}`),
    );
  }

  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({ outputPath, ...report.reconciliation, projection: validation }, null, 2),
  );
});

Effect.runPromise(main.pipe(Effect.provide(TransitPlaceProjection.layer))).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
