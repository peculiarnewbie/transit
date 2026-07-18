import { Effect, Schema } from "effect";

import {
  type BoardingPolicy,
  NetworkSnapshot,
  type Route,
  type RoutePattern,
  type Stop,
  type StopId,
  type Transfer,
  type Trip,
} from "../domain/transit/index.js";
import {
  projectDirectionEvidence,
  type PatternDirectionEvidence,
} from "../discovery/transit/direction-evidence.js";
import {
  type TransitPlace,
  type TransitPlaceIndex,
  TransitPlaceProjection,
} from "../discovery/transit/index.js";
import {
  indexReviewedDirectionLabels,
  type ReviewedDirectionLabel,
  type ReviewedDirectionLabelSet,
  selectDirectionLabel,
  type SelectedDirectionLabel,
} from "./direction-label.js";
import { MalformedGuideGraph } from "./model.js";

export type BoardAlightPolicy = "Allowed" | "Forbidden";

export interface PatternStopPolicy {
  readonly stopId: StopId;
  readonly sequence: number;
  readonly pickup: BoardAlightPolicy;
  readonly dropOff: BoardAlightPolicy;
}

export interface GuidePattern {
  readonly patternId: string;
  readonly routeId: string;
  readonly passengerLineName: string;
  readonly stopIds: ReadonlyArray<StopId>;
  readonly policies: ReadonlyArray<PatternStopPolicy>;
  readonly geometryId: string | undefined;
  readonly direction: SelectedDirectionLabel;
  readonly evidence: PatternDirectionEvidence;
  readonly collapsedTripCount: number;
}

export interface TransferEdge {
  readonly fromStopId: StopId;
  readonly toStopId: StopId;
  readonly evidence:
    | { readonly _tag: "SameStop" }
    | { readonly _tag: "SourceStation"; readonly parentStopId: StopId }
    | {
        readonly _tag: "PublishedTransfer";
        readonly kind: "Recommended" | "Timed" | "MinimumTime";
      };
}

export interface GuideGraphValidationFinding {
  readonly _tag:
    | "MissingPlaceMember"
    | "BrokenPattern"
    | "DirectionConflict"
    | "UnusableTransferEndpoint"
    | "ExcludedPattern";
  readonly detail: string;
}

export interface GuideGraph {
  readonly sourceArtifactVersion: string;
  readonly snapshot: NetworkSnapshot;
  readonly places: TransitPlaceIndex;
  readonly stopsById: ReadonlyMap<string, Stop>;
  readonly routesById: ReadonlyMap<string, Route>;
  readonly placeIdByStopId: ReadonlyMap<string, string>;
  readonly placesById: ReadonlyMap<string, TransitPlace>;
  readonly patterns: ReadonlyArray<GuidePattern>;
  readonly patternsByStopId: ReadonlyMap<string, ReadonlyArray<GuidePattern>>;
  readonly boardableRouteIdsByStopId: ReadonlyMap<string, ReadonlySet<string>>;
  readonly alightableRouteIdsByStopId: ReadonlyMap<string, ReadonlySet<string>>;
  readonly predecessorRouteIdsByRouteId: ReadonlyMap<string, ReadonlySet<string>>;
  readonly transferEdgesFrom: ReadonlyMap<string, ReadonlyArray<TransferEdge>>;
  readonly siblingStopIdsByStopId: ReadonlyMap<string, ReadonlyArray<StopId>>;
  readonly findings: ReadonlyArray<GuideGraphValidationFinding>;
  readonly duplicateSequenceCollapseCount: number;
}

const passengerLineName = (route: Route): string =>
  route.shortName?.trim() || route.longName?.trim() || route.id;

const policyAllows = (policy: BoardingPolicy): BoardAlightPolicy =>
  policy === "Forbidden" ? "Forbidden" : "Allowed";

const derivePolicies = (
  pattern: RoutePattern,
  trips: ReadonlyArray<Trip>,
): ReadonlyArray<PatternStopPolicy> | undefined => {
  const scheduled = trips.filter((trip) => trip.availability._tag === "Scheduled");
  if (scheduled.length === 0) {
    return pattern.stopIds.map((stopId, sequence) => ({
      stopId,
      sequence,
      pickup: sequence < pattern.stopIds.length - 1 ? ("Allowed" as const) : ("Forbidden" as const),
      dropOff: sequence > 0 ? ("Allowed" as const) : ("Forbidden" as const),
    }));
  }

  const policies: Array<PatternStopPolicy> = [];
  for (let sequence = 0; sequence < pattern.stopIds.length; sequence += 1) {
    const stopId = pattern.stopIds[sequence]!;
    let pickup: BoardAlightPolicy = "Forbidden";
    let dropOff: BoardAlightPolicy = "Forbidden";
    for (const trip of scheduled) {
      if (trip.availability._tag !== "Scheduled") continue;
      const stopTime = trip.availability.stopTimes[sequence];
      if (stopTime === undefined || stopTime.stopId !== stopId) return undefined;
      if (policyAllows(stopTime.pickupPolicy) === "Allowed") pickup = "Allowed";
      if (policyAllows(stopTime.dropOffPolicy) === "Allowed") dropOff = "Allowed";
    }
    policies.push({ stopId, sequence, pickup, dropOff });
  }
  return policies;
};

const sequenceKey = (routeId: string, stopIds: ReadonlyArray<string>) =>
  `${routeId}|${stopIds.join(">")}`;

const pushMap = <K, V>(map: Map<K, Array<V>>, key: K, value: V): void => {
  const values = map.get(key);
  if (values === undefined) map.set(key, [value]);
  else values.push(value);
};

const buildSiblingIndex = (stops: ReadonlyArray<Stop>) => {
  const childrenByParent = new Map<string, Array<StopId>>();
  for (const stop of stops) {
    if (stop.parentStopId === undefined) continue;
    pushMap(childrenByParent, stop.parentStopId, stop.id);
  }
  const siblingStopIdsByStopId = new Map<string, Array<StopId>>();
  for (const stop of stops) {
    const siblings = new Set<StopId>();
    siblings.add(stop.id);
    if (stop.parentStopId !== undefined) {
      for (const child of childrenByParent.get(stop.parentStopId) ?? []) siblings.add(child);
      siblings.add(stop.parentStopId);
      const parent = stops.find((candidate) => candidate.id === stop.parentStopId);
      if (parent?.parentStopId !== undefined) {
        for (const child of childrenByParent.get(parent.parentStopId) ?? []) siblings.add(child);
      }
    }
    for (const child of childrenByParent.get(stop.id) ?? []) siblings.add(child);
    siblingStopIdsByStopId.set(
      stop.id,
      [...siblings].sort((left, right) => left.localeCompare(right)),
    );
  }
  return { childrenByParent, siblingStopIdsByStopId };
};

const transferAllowed = (transfer: Transfer) =>
  transfer.kind === "Recommended" || transfer.kind === "Timed" || transfer.kind === "MinimumTime";

export interface CompileGuideGraphOptions {
  readonly snapshot: unknown;
  readonly sourceArtifactVersion: string;
  readonly placeIndex?: TransitPlaceIndex;
  readonly overrides?: unknown;
  readonly reviewedDirectionLabels?: ReviewedDirectionLabelSet;
}

export const compileGuideGraph = Effect.fn("RouteGuide.compileGuideGraph")(function* (
  options: CompileGuideGraphOptions,
) {
  const snapshot = yield* Schema.decodeUnknownEffect(NetworkSnapshot)(options.snapshot).pipe(
    Effect.mapError(
      (error) => new MalformedGuideGraph({ reason: `Snapshot decode failed: ${String(error)}` }),
    ),
  );

  const places =
    options.placeIndex ??
    (yield* TransitPlaceProjection.project({
      snapshot: options.snapshot,
      sourceArtifactVersion: options.sourceArtifactVersion,
      ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
    }).pipe(
      Effect.mapError(
        (error) =>
          new MalformedGuideGraph({
            reason: `Transit place projection failed: ${error._tag}${
              "stopId" in error ? ` stopId=${String(error.stopId)}` : ""
            }${"reason" in error ? ` (${String(error.reason)})` : ""}`,
          }),
      ),
    ));

  const directionReport = yield* projectDirectionEvidence(snapshot, options.sourceArtifactVersion);
  const evidenceByPattern = new Map(
    directionReport.patterns.map((evidence) => [evidence.patternId, evidence]),
  );
  const reviewedByPattern = options.reviewedDirectionLabels
    ? indexReviewedDirectionLabels(options.reviewedDirectionLabels)
    : new Map<string, ReviewedDirectionLabel>();

  const stopsById = new Map<string, Stop>(snapshot.stops.map((stop) => [stop.id as string, stop]));
  const routesById = new Map<string, Route>(
    snapshot.routes.map((route) => [route.id as string, route]),
  );
  const tripsByPattern = new Map<string, Array<Trip>>();
  for (const trip of snapshot.trips) {
    pushMap(tripsByPattern, trip.patternId, trip);
  }

  const findings: Array<GuideGraphValidationFinding> = [];
  for (const [stopId, placeId] of Object.entries(places.placeIdByStopId)) {
    if (!stopsById.has(stopId)) {
      findings.push({
        _tag: "MissingPlaceMember",
        detail: `Place ${placeId} references missing stop ${stopId}`,
      });
    }
  }

  const { siblingStopIdsByStopId } = buildSiblingIndex(snapshot.stops);
  const transferEdgesFrom = new Map<string, Array<TransferEdge>>();

  for (const stop of snapshot.stops) {
    pushMap(transferEdgesFrom, stop.id, {
      fromStopId: stop.id,
      toStopId: stop.id,
      evidence: { _tag: "SameStop" },
    });
    for (const siblingId of siblingStopIdsByStopId.get(stop.id) ?? []) {
      if (siblingId === stop.id) continue;
      const sibling = stopsById.get(siblingId);
      const parentStopId = stop.parentStopId ?? sibling?.parentStopId ?? stop.id;
      pushMap(transferEdgesFrom, stop.id, {
        fromStopId: stop.id,
        toStopId: siblingId,
        evidence: { _tag: "SourceStation", parentStopId },
      });
    }
  }

  for (const transfer of snapshot.transfers) {
    if (!transferAllowed(transfer)) continue;
    if (!stopsById.has(transfer.fromStopId) || !stopsById.has(transfer.toStopId)) {
      findings.push({
        _tag: "UnusableTransferEndpoint",
        detail: `Transfer ${transfer.fromStopId} → ${transfer.toStopId} has missing endpoint`,
      });
      continue;
    }
    pushMap(transferEdgesFrom, transfer.fromStopId, {
      fromStopId: transfer.fromStopId,
      toStopId: transfer.toStopId,
      evidence: {
        _tag: "PublishedTransfer",
        kind: transfer.kind as "Recommended" | "Timed" | "MinimumTime",
      },
    });
  }

  const seenSequences = new Map<string, GuidePattern>();
  let duplicateSequenceCollapseCount = 0;
  const guidePatterns: Array<GuidePattern> = [];

  for (const pattern of [...snapshot.patterns].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const route = routesById.get(pattern.routeId);
    if (route === undefined) {
      findings.push({
        _tag: "BrokenPattern",
        detail: `Pattern ${pattern.id} references missing route ${pattern.routeId}`,
      });
      continue;
    }
    if (pattern.stopIds.length < 2) {
      findings.push({
        _tag: "BrokenPattern",
        detail: `Pattern ${pattern.id} has fewer than two stops`,
      });
      continue;
    }
    const missingStop = pattern.stopIds.find((stopId) => !stopsById.has(stopId));
    if (missingStop !== undefined) {
      findings.push({
        _tag: "BrokenPattern",
        detail: `Pattern ${pattern.id} references missing stop ${missingStop}`,
      });
      continue;
    }

    const trips = tripsByPattern.get(pattern.id) ?? [];
    const policies = derivePolicies(pattern, trips);
    if (policies === undefined) {
      findings.push({
        _tag: "ExcludedPattern",
        detail: `Pattern ${pattern.id} has inconsistent stop-time alignment`,
      });
      continue;
    }

    const evidence = evidenceByPattern.get(pattern.id);
    if (evidence === undefined) {
      findings.push({
        _tag: "DirectionConflict",
        detail: `Pattern ${pattern.id} has no direction evidence`,
      });
      continue;
    }
    if (evidence.classification === "ConflictingTripHeadsigns") {
      findings.push({
        _tag: "DirectionConflict",
        detail: `Pattern ${pattern.id} has conflicting trip headsigns`,
      });
    }

    const direction = yield* selectDirectionLabel(evidence, reviewedByPattern);
    const key = sequenceKey(pattern.routeId, pattern.stopIds);
    const existing = seenSequences.get(key);
    if (existing !== undefined) {
      duplicateSequenceCollapseCount += 1;
      continue;
    }

    const guidePattern: GuidePattern = {
      patternId: pattern.id,
      routeId: pattern.routeId,
      passengerLineName: passengerLineName(route),
      stopIds: pattern.stopIds,
      policies,
      geometryId: pattern.geometryId,
      direction,
      evidence,
      collapsedTripCount: Math.max(1, trips.length),
    };
    seenSequences.set(key, guidePattern);
    guidePatterns.push(guidePattern);
  }

  const patternsByStopId = new Map<string, Array<GuidePattern>>();
  const boardableRouteIdsByStopId = new Map<string, Set<string>>();
  const alightableRouteIdsByStopId = new Map<string, Set<string>>();
  for (const pattern of guidePatterns) {
    for (const stopId of new Set(pattern.stopIds)) pushMap(patternsByStopId, stopId, pattern);
    for (let sequence = 0; sequence < pattern.stopIds.length; sequence += 1) {
      const stopId = pattern.stopIds[sequence]!;
      if (canBoard(pattern, sequence)) {
        const routes = boardableRouteIdsByStopId.get(stopId) ?? new Set<string>();
        routes.add(pattern.routeId);
        boardableRouteIdsByStopId.set(stopId, routes);
      }
      if (canAlight(pattern, sequence)) {
        const routes = alightableRouteIdsByStopId.get(stopId) ?? new Set<string>();
        routes.add(pattern.routeId);
        alightableRouteIdsByStopId.set(stopId, routes);
      }
    }
  }

  const predecessorRouteIdsByRouteId = new Map<string, Set<string>>();
  for (const [fromStopId, edges] of transferEdgesFrom) {
    const fromRoutes = alightableRouteIdsByStopId.get(fromStopId) ?? new Set<string>();
    for (const edge of edges) {
      const toRoutes = boardableRouteIdsByStopId.get(edge.toStopId) ?? new Set<string>();
      for (const toRouteId of toRoutes) {
        const predecessors = predecessorRouteIdsByRouteId.get(toRouteId) ?? new Set<string>();
        for (const fromRouteId of fromRoutes) {
          if (fromRouteId !== toRouteId) predecessors.add(fromRouteId);
        }
        predecessorRouteIdsByRouteId.set(toRouteId, predecessors);
      }
    }
  }

  return {
    sourceArtifactVersion: options.sourceArtifactVersion,
    snapshot,
    places,
    stopsById,
    routesById,
    placeIdByStopId: new Map(Object.entries(places.placeIdByStopId)),
    placesById: new Map(Object.entries(places.placesById)),
    patterns: guidePatterns,
    patternsByStopId,
    boardableRouteIdsByStopId,
    alightableRouteIdsByStopId,
    predecessorRouteIdsByRouteId,
    transferEdgesFrom,
    siblingStopIdsByStopId,
    findings,
    duplicateSequenceCollapseCount,
  } satisfies GuideGraph;
});

export const placeIdForStop = (graph: GuideGraph, stopId: string): string | undefined =>
  graph.placeIdByStopId.get(stopId);

export const canBoard = (pattern: GuidePattern, sequence: number): boolean =>
  pattern.policies[sequence]?.pickup === "Allowed";

export const canAlight = (pattern: GuidePattern, sequence: number): boolean =>
  pattern.policies[sequence]?.dropOff === "Allowed";

export const parentStationChildren = (
  graph: GuideGraph,
  parentStopId: string,
): ReadonlyArray<StopId> => {
  const children: Array<StopId> = [];
  for (const stop of graph.snapshot.stops) {
    if (stop.parentStopId === parentStopId) children.push(stop.id);
  }
  return children.sort((left, right) => left.localeCompare(right));
};
