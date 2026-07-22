import { Effect } from "effect";

import type { StopId } from "../domain/transit/ids.js";
import type { TransitPlaceId } from "../discovery/transit/ids.js";
import {
  canAlight,
  canBoard,
  type GuideGraph,
  type GuidePattern,
  placeIdForStop,
  type TransferEdge,
} from "./graph.js";
import { GuideAlternativeId } from "./ids.js";
import {
  type GuideAlternative,
  type GuideMetrics,
  type InterchangeableRideStep,
  type LineOption,
  type PlaceRef,
  type RouteGuideQuery,
  type RouteGuideResult,
  type StraightLineWalk,
  type TransferEvidence,
  type TransferInstruction,
  type TransitPlaceCandidate,
} from "./model.js";

export interface RawRideLeg {
  readonly pattern: GuidePattern;
  readonly boardStopId: StopId;
  readonly boardSequence: number;
  readonly alightStopId: StopId;
  readonly alightSequence: number;
  readonly intermediateStopIds: ReadonlyArray<StopId>;
}

export interface RawPath {
  readonly originPlaceId: string;
  readonly destinationPlaceId: string;
  readonly originDistance?: number;
  readonly destinationDistance?: number;
  readonly originWalk?: TransferEdge;
  readonly destinationWalk?: TransferEdge;
  readonly legs: ReadonlyArray<RawRideLeg>;
  readonly transferEdges: ReadonlyArray<TransferEdge>;
}

interface SearchState {
  readonly stopId: StopId;
  readonly originPlaceId: string;
  readonly originDistance?: number;
  readonly originWalk?: TransferEdge;
  readonly transfersUsed: number;
  readonly straightLineWalksUsed: number;
  readonly legs: ReadonlyArray<RawRideLeg>;
  readonly transferEdges: ReadonlyArray<TransferEdge>;
  readonly boardedRouteIds: ReadonlyArray<string>;
}

const compareLineNames = (left: string, right: string) => {
  const leftNum = Number.parseInt(left, 10);
  const rightNum = Number.parseInt(right, 10);
  const leftIsNum = !Number.isNaN(leftNum) && /^\d/.test(left);
  const rightIsNum = !Number.isNaN(rightNum) && /^\d/.test(right);
  if (leftIsNum && rightIsNum && leftNum !== rightNum) return leftNum - rightNum;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
};

const placeRef = (graph: GuideGraph, stopId: string): PlaceRef | undefined => {
  const placeId = placeIdForStop(graph, stopId);
  const place = placeId === undefined ? undefined : graph.placesById.get(placeId);
  const stop = graph.stopsById.get(stopId);
  if (placeId === undefined || place === undefined || stop === undefined) return undefined;
  return {
    transitPlaceId: placeId as TransitPlaceId,
    placeName: place.primaryName,
    member: {
      stopId: stop.id,
      stopName: stop.name,
      ...(stop.platformCode === undefined ? {} : { platformCode: stop.platformCode }),
    },
  };
};

const intermediatePlacesForLeg = (graph: GuideGraph, leg: RawRideLeg) => {
  const places: Array<{ transitPlaceId: TransitPlaceId; placeName: string }> = [];
  const seen = new Set<string>();
  const boardPlaceId = placeIdForStop(graph, leg.boardStopId);
  const alightPlaceId = placeIdForStop(graph, leg.alightStopId);
  for (const stopId of leg.intermediateStopIds) {
    const placeId = placeIdForStop(graph, stopId);
    const place = placeId === undefined ? undefined : graph.placesById.get(placeId);
    if (placeId === undefined || place === undefined) continue;
    if (placeId === boardPlaceId || placeId === alightPlaceId) continue;
    if (seen.has(placeId)) continue;
    seen.add(placeId);
    places.push({ transitPlaceId: placeId as TransitPlaceId, placeName: place.primaryName });
  }
  return places;
};

const toLineOption = (graph: GuideGraph, leg: RawRideLeg): LineOption => ({
  routeId: leg.pattern.routeId as LineOption["routeId"],
  passengerLineName: leg.pattern.passengerLineName,
  patternId: leg.pattern.patternId as LineOption["patternId"],
  directionLabel: leg.pattern.direction.label,
  directionLabelAuthority: leg.pattern.direction.authority,
  directionEvidenceClassification: leg.pattern.evidence.classification,
  intermediatePlaces: intermediatePlacesForLeg(graph, leg),
  ...(leg.pattern.geometryId === undefined
    ? {}
    : { geometryId: leg.pattern.geometryId as LineOption["geometryId"] }),
});

const transferEvidence = (edge: TransferEdge): TransferEvidence => {
  if (edge.evidence._tag === "SameStop") {
    return { _tag: "SameStop", stopId: edge.fromStopId };
  }
  if (edge.evidence._tag === "SourceStation") {
    return {
      _tag: "SourceStation",
      parentStopId: edge.evidence.parentStopId,
      fromStopId: edge.fromStopId,
      toStopId: edge.toStopId,
    };
  }
  if (edge.evidence._tag === "StraightLineWalk") {
    return {
      _tag: "StraightLineWalk",
      fromStopId: edge.fromStopId,
      toStopId: edge.toStopId,
      distanceMeters: edge.evidence.distanceMeters,
    };
  }
  return {
    _tag: "PublishedTransfer",
    fromStopId: edge.fromStopId,
    toStopId: edge.toStopId,
    kind: edge.evidence.kind,
  };
};

const isStraightLineWalk = (
  edge: TransferEdge,
): edge is TransferEdge & {
  readonly evidence: { readonly _tag: "StraightLineWalk"; readonly distanceMeters: number };
} => edge.evidence._tag === "StraightLineWalk";

const straightLineWalkFor = (
  graph: GuideGraph,
  edge: TransferEdge | undefined,
): StraightLineWalk | undefined => {
  if (edge === undefined || !isStraightLineWalk(edge)) return undefined;
  const from = placeRef(graph, edge.fromStopId);
  const to = placeRef(graph, edge.toStopId);
  if (from === undefined || to === undefined) return undefined;
  return { from, to, distanceMeters: edge.evidence.distanceMeters };
};

const stopToStopDistanceMeters = (
  graph: GuideGraph,
  leftStopId: StopId,
  rightStopId: StopId,
): number | undefined => {
  const left = graph.stopsById.get(leftStopId);
  const right = graph.stopsById.get(rightStopId);
  if (left?.location._tag !== "Placed" || right?.location._tag !== "Placed") return undefined;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(right.location.latitude - left.location.latitude);
  const longitudeDelta = radians(right.location.longitude - left.location.longitude);
  const latitudeLeft = radians(left.location.latitude);
  const latitudeRight = radians(right.location.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeLeft) * Math.cos(latitudeRight) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
};

const journeyDistanceMeters = (graph: GuideGraph, path: RawPath): number | undefined => {
  let distanceMeters = 0;
  for (const leg of path.legs) {
    for (let sequence = leg.boardSequence; sequence < leg.alightSequence; sequence += 1) {
      const distance = stopToStopDistanceMeters(
        graph,
        leg.pattern.stopIds[sequence]!,
        leg.pattern.stopIds[sequence + 1]!,
      );
      if (distance === undefined) return undefined;
      distanceMeters += distance;
    }
  }
  for (const edge of [path.originWalk, ...path.transferEdges, path.destinationWalk]) {
    if (edge !== undefined && isStraightLineWalk(edge))
      distanceMeters += edge.evidence.distanceMeters;
  }
  return Math.round(distanceMeters);
};

const straightLineWalkDistanceMeters = (path: RawPath): number =>
  [path.originWalk, ...path.transferEdges, path.destinationWalk].reduce(
    (distanceMeters, edge) =>
      edge !== undefined && isStraightLineWalk(edge)
        ? distanceMeters + edge.evidence.distanceMeters
        : distanceMeters,
    0,
  );

const metricsFor = (
  graph: GuideGraph,
  path: RawPath,
  rideSteps: ReadonlyArray<InterchangeableRideStep>,
): GuideMetrics => {
  const intermediateStopCount = path.legs.reduce(
    (sum, leg) => sum + leg.intermediateStopIds.length,
    0,
  );
  const directionAmbiguityCount = rideSteps.reduce(
    (sum, step) =>
      sum +
      step.lineOptions.filter(
        (option) =>
          option.directionLabelAuthority === "Ambiguous" ||
          option.directionLabelAuthority === "Fallback",
      ).length,
    0,
  );
  const routeComplexity = rideSteps.reduce((sum, step) => sum + step.lineOptions.length, 0);
  let transferHubStrength = 0;
  for (let index = 0; index < rideSteps.length - 1; index += 1) {
    const placeId = rideSteps[index]!.alighting.transitPlaceId;
    const place = graph.placesById.get(placeId);
    transferHubStrength += place?.servedRouteIds.length ?? 0;
  }
  const transferHubPenalty = Math.max(0, 50 - transferHubStrength);
  const variantLinePenalty = rideSteps.reduce(
    (sum, step) =>
      sum + step.lineOptions.filter((option) => /[A-Za-z]$/.test(option.passengerLineName)).length,
    0,
  );
  const journeyDistance = journeyDistanceMeters(graph, path);
  const straightLineWalkDistance = straightLineWalkDistanceMeters(path);
  return {
    transferCount: Math.max(0, rideSteps.length - 1),
    boardingCount: rideSteps.length,
    intermediateStopCount,
    ...(journeyDistance === undefined ? {} : { journeyDistanceMeters: journeyDistance }),
    ...(straightLineWalkDistance === 0
      ? {}
      : { straightLineWalkDistanceMeters: straightLineWalkDistance }),
    ...(path.originDistance === undefined
      ? {}
      : { originCandidateDistanceMeters: path.originDistance }),
    ...(path.destinationDistance === undefined
      ? {}
      : { destinationCandidateDistanceMeters: path.destinationDistance }),
    directionAmbiguityCount,
    routeComplexity,
    transferHubPenalty,
    variantLinePenalty,
  };
};

/** Lexicographic passenger ranking. No fictional minutes. */
export const compareAlternatives = (left: GuideAlternative, right: GuideAlternative): number =>
  left.metrics.transferCount - right.metrics.transferCount ||
  left.metrics.boardingCount - right.metrics.boardingCount ||
  (left.metrics.journeyDistanceMeters ?? Number.MAX_SAFE_INTEGER) -
    (right.metrics.journeyDistanceMeters ?? Number.MAX_SAFE_INTEGER) ||
  left.metrics.intermediateStopCount - right.metrics.intermediateStopCount ||
  left.metrics.routeComplexity - right.metrics.routeComplexity ||
  left.metrics.transferHubPenalty - right.metrics.transferHubPenalty ||
  left.metrics.variantLinePenalty - right.metrics.variantLinePenalty ||
  (left.metrics.originCandidateDistanceMeters ?? 0) -
    (right.metrics.originCandidateDistanceMeters ?? 0) ||
  (left.metrics.destinationCandidateDistanceMeters ?? 0) -
    (right.metrics.destinationCandidateDistanceMeters ?? 0) ||
  left.metrics.directionAmbiguityCount - right.metrics.directionAmbiguityCount ||
  left.id.localeCompare(right.id);

/** Reject a pattern that passes the boarding or destination complex before the stated alighting. */
const loopsBackPastRideBoundary = (graph: GuideGraph, leg: RawRideLeg): boolean => {
  const boardPlaceId = placeIdForStop(graph, leg.boardStopId);
  const alightPlaceId = placeIdForStop(graph, leg.alightStopId);
  return leg.intermediateStopIds.some((stopId) => {
    const placeId = placeIdForStop(graph, stopId);
    return placeId !== undefined && (placeId === boardPlaceId || placeId === alightPlaceId);
  });
};

/** Keep the shortest range when one line has multiple published variants for the same action. */
const sameRouteAction = (graph: GuideGraph, candidate: RawPath, alternative: RawPath) =>
  candidate.legs.length === alternative.legs.length &&
  walkingPathKey(candidate) === walkingPathKey(alternative) &&
  candidate.legs.every((candidateLeg, index) => {
    const alternativeLeg = alternative.legs[index];
    return (
      alternativeLeg !== undefined &&
      candidateLeg.pattern.routeId === alternativeLeg.pattern.routeId &&
      candidateLeg.boardStopId === alternativeLeg.boardStopId &&
      placeIdForStop(graph, candidateLeg.alightStopId) ===
        placeIdForStop(graph, alternativeLeg.alightStopId)
    );
  });

const transferEdgeKey = (edge: TransferEdge | undefined) =>
  edge === undefined
    ? ""
    : `${edge.fromStopId}>${edge.toStopId}:${edge.evidence._tag}${
        edge.evidence._tag === "StraightLineWalk" ? `:${edge.evidence.distanceMeters}` : ""
      }`;

const walkingPathKey = (path: RawPath) =>
  [path.originWalk, ...path.transferEdges, path.destinationWalk]
    .filter((edge): edge is TransferEdge => edge !== undefined && isStraightLineWalk(edge))
    .map(transferEdgeKey)
    .join("|");

const withoutLongerSameRoutePaths = (graph: GuideGraph, paths: ReadonlyArray<RawPath>) =>
  paths.filter((alternative) => {
    const alternativeDistance = journeyDistanceMeters(graph, alternative);
    return !paths.some((candidate) => {
      if (!sameRouteAction(graph, candidate, alternative)) return false;
      const candidateDistance = journeyDistanceMeters(graph, candidate);
      return (
        candidateDistance !== undefined &&
        alternativeDistance !== undefined &&
        candidateDistance < alternativeDistance
      );
    });
  });

/**
 * Several nearby boarding members can produce the same line-and-direction
 * decision, especially when straight-line access is available. Retain the
 * first ranked representative before applying the result cap so those copies
 * cannot hide a distinct transfer strategy.
 */
const distinctPassengerActions = (alternatives: ReadonlyArray<GuideAlternative>) => {
  const seen = new Set<string>();
  return alternatives.filter((alternative) => {
    const key = JSON.stringify(
      alternative.rideSteps.map((step) =>
        step.lineOptions
          .map((option) => `${option.passengerLineName}:${option.directionLabel}`)
          .sort(),
      ),
    );
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const stablePathId = (path: RawPath): string => {
  const legKey = path.legs
    .map(
      (leg) =>
        `${leg.pattern.routeId}@${leg.boardStopId}->${leg.alightStopId}:${leg.pattern.patternId}`,
    )
    .join("|");
  return `guide:${path.originPlaceId}>${path.destinationPlaceId}:${walkingPathKey(path)}:${legKey}`;
};

const groupingKeyForLeg = (
  leg: RawRideLeg,
  next: RawRideLeg | undefined,
  graph: GuideGraph,
): string => {
  const boardPlace = placeIdForStop(graph, leg.boardStopId) ?? leg.boardStopId;
  const alightPlace = placeIdForStop(graph, leg.alightStopId) ?? leg.alightStopId;
  const nextBoard =
    next === undefined
      ? "FINISH"
      : `${placeIdForStop(graph, next.boardStopId) ?? next.boardStopId}|${next.pattern.routeId}`;
  // Boarding member must match; alighting is place-level so sibling platforms
  // (e.g. 9/9A at Grogol Reformasi) can form one interchangeable step. The
  // range keeps distinct routes separate; variants of one route are collapsed
  // before this grouping step.
  const span = leg.alightSequence - leg.boardSequence;
  return `${leg.boardStopId}|${boardPlace}|${alightPlace}|${span}|${nextBoard}`;
};

/**
 * Group interchangeable line options when board member, alight place/member,
 * route span, and next action match. Intermediate stops may differ per option.
 */
export const groupInterchangeablePaths = (
  graph: GuideGraph,
  paths: ReadonlyArray<RawPath>,
): ReadonlyArray<GuideAlternative> => {
  const bySignature = new Map<string, Array<RawPath>>();
  for (const path of paths) {
    const signature = [
      walkingPathKey(path),
      ...path.legs.map((leg, index) => groupingKeyForLeg(leg, path.legs[index + 1], graph)),
    ].join("::");
    const bucket = bySignature.get(signature) ?? [];
    bucket.push(path);
    bySignature.set(signature, bucket);
  }

  const alternatives: Array<GuideAlternative> = [];
  for (const group of bySignature.values()) {
    const representative = group[0];
    if (representative === undefined) continue;

    const rideSteps: Array<InterchangeableRideStep> = [];
    const transfers: Array<TransferInstruction> = [];

    for (let legIndex = 0; legIndex < representative.legs.length; legIndex += 1) {
      const optionsByRoute = new Map<string, LineOption>();
      for (const path of group) {
        const leg = path.legs[legIndex];
        if (leg === undefined) continue;
        const option = toLineOption(graph, leg);
        const existing = optionsByRoute.get(option.routeId);
        if (
          existing === undefined ||
          (existing.directionLabelAuthority !== "Authoritative" &&
            option.directionLabelAuthority === "Authoritative")
        ) {
          optionsByRoute.set(option.routeId, option);
        }
      }
      const lineOptions = [...optionsByRoute.values()].sort(
        (left, right) =>
          compareLineNames(left.passengerLineName, right.passengerLineName) ||
          left.routeId.localeCompare(right.routeId),
      );
      const board = placeRef(graph, representative.legs[legIndex]!.boardStopId);
      const alight = placeRef(graph, representative.legs[legIndex]!.alightStopId);
      if (board === undefined || alight === undefined || lineOptions.length === 0) continue;
      rideSteps.push({ lineOptions, boarding: board, alighting: alight });

      if (legIndex < representative.legs.length - 1) {
        const edge =
          representative.transferEdges[legIndex] ??
          ({
            fromStopId: representative.legs[legIndex]!.alightStopId,
            toStopId: representative.legs[legIndex + 1]!.boardStopId,
            evidence: { _tag: "SameStop" as const },
          } satisfies TransferEdge);
        const nextLeg = representative.legs[legIndex + 1]!;
        const leave = placeRef(graph, representative.legs[legIndex]!.alightStopId);
        const boardNext = placeRef(graph, nextLeg.boardStopId);
        if (leave === undefined || boardNext === undefined) continue;
        const nextNames = [
          ...new Set(
            group
              .map((path) => path.legs[legIndex + 1]?.pattern.passengerLineName)
              .filter((name): name is string => name !== undefined),
          ),
        ].sort(compareLineNames);
        const nextDirections = [
          ...new Set(
            group
              .map((path) => path.legs[legIndex + 1]?.pattern.direction.label)
              .filter((label): label is string => label !== undefined),
          ),
        ];
        transfers.push({
          leavePlace: leave,
          boardNextPlace: boardNext,
          nextPassengerLineNames: nextNames as TransferInstruction["nextPassengerLineNames"],
          ...(nextDirections.length === 1 ? { nextDirectionLabel: nextDirections[0] } : {}),
          platformDetailKnown: boardNext.member?.platformCode !== undefined,
          evidence: transferEvidence(edge),
        });
      }
    }

    if (rideSteps.length === 0) continue;
    const origin = placeRef(
      graph,
      representative.originWalk?.fromStopId ?? representative.legs[0]!.boardStopId,
    );
    const destination = placeRef(
      graph,
      representative.destinationWalk?.toStopId ??
        representative.legs[representative.legs.length - 1]!.alightStopId,
    );
    if (origin === undefined || destination === undefined) continue;
    const originWalk = straightLineWalkFor(graph, representative.originWalk);
    const destinationWalk = straightLineWalkFor(graph, representative.destinationWalk);

    const idSeed = [
      representative.originPlaceId,
      representative.destinationPlaceId,
      ...rideSteps.map((step) =>
        [
          step.boarding.member?.stopId ?? step.boarding.transitPlaceId,
          step.alighting.member?.stopId ?? step.alighting.transitPlaceId,
          ...step.lineOptions.map((option) => option.routeId),
        ].join("+"),
      ),
    ].join(">");

    alternatives.push({
      id: `guide:${idSeed}` as typeof GuideAlternativeId.Type,
      origin,
      destination,
      rideSteps,
      transfers,
      ...(originWalk === undefined ? {} : { originWalk }),
      ...(destinationWalk === undefined ? {} : { destinationWalk }),
      metrics: metricsFor(graph, representative, rideSteps),
    });
  }

  return alternatives.sort(compareAlternatives);
};

const expandRidesFromStop = (
  graph: GuideGraph,
  stopId: StopId,
  excludeRouteIds: ReadonlySet<string>,
  allowedRouteIds: ReadonlySet<string>,
  alightTargets: ReadonlySet<string>,
): ReadonlyArray<RawRideLeg> => {
  const patterns = graph.patternsByStopId.get(stopId) ?? [];
  const rides: Array<RawRideLeg> = [];
  for (const pattern of patterns) {
    if (excludeRouteIds.has(pattern.routeId) || !allowedRouteIds.has(pattern.routeId)) continue;
    for (let boardSequence = 0; boardSequence < pattern.stopIds.length; boardSequence += 1) {
      if (pattern.stopIds[boardSequence] !== stopId) continue;
      if (!canBoard(pattern, boardSequence)) continue;
      for (
        let alightSequence = boardSequence + 1;
        alightSequence < pattern.stopIds.length;
        alightSequence += 1
      ) {
        if (!canAlight(pattern, alightSequence)) continue;
        const alightStopId = pattern.stopIds[alightSequence]!;
        if (!alightTargets.has(alightStopId)) continue;
        rides.push({
          pattern,
          boardStopId: stopId,
          boardSequence,
          alightStopId,
          alightSequence,
          intermediateStopIds: pattern.stopIds.slice(boardSequence + 1, alightSequence),
        });
      }
    }
  }
  return rides;
};

const routeSearchBounds = (
  graph: GuideGraph,
  destinationStopIds: ReadonlySet<string>,
  maximumTransfers: number,
) => {
  const destinationRouteIds = new Set<string>();
  for (const stopId of destinationStopIds) {
    for (const routeId of graph.alightableRouteIdsByStopId.get(stopId) ?? [])
      destinationRouteIds.add(routeId);
  }

  const allowedRoutesByTransfersRemaining: Array<ReadonlySet<string>> = [destinationRouteIds];
  for (let remaining = 1; remaining <= maximumTransfers; remaining += 1) {
    const routes = new Set(allowedRoutesByTransfersRemaining[remaining - 1]);
    for (const routeId of allowedRoutesByTransfersRemaining[remaining - 1] ?? []) {
      for (const predecessor of graph.predecessorRouteIdsByRouteId.get(routeId) ?? [])
        routes.add(predecessor);
    }
    allowedRoutesByTransfersRemaining.push(routes);
  }

  const alightTargetsByTransfersRemaining: Array<ReadonlySet<string>> = [destinationStopIds];
  for (let remaining = 1; remaining <= maximumTransfers; remaining += 1) {
    const targets = new Set<string>(destinationStopIds);
    const allowedNextRoutes = allowedRoutesByTransfersRemaining[remaining - 1]!;
    for (const [fromStopId, edges] of graph.transferEdgesFrom) {
      if (
        edges.some((edge) =>
          [...(graph.boardableRouteIdsByStopId.get(edge.toStopId) ?? [])].some((routeId) =>
            allowedNextRoutes.has(routeId),
          ),
        )
      )
        targets.add(fromStopId);
    }
    alightTargetsByTransfersRemaining.push(targets);
  }

  return { allowedRoutesByTransfersRemaining, alightTargetsByTransfersRemaining };
};

const memberStopIdsForPlaces = (
  graph: GuideGraph,
  candidates: ReadonlyArray<TransitPlaceCandidate>,
  maximum: number,
): ReadonlyArray<{ stopId: StopId; placeId: string; distance?: number }> => {
  const sorted = [...candidates]
    .sort(
      (left, right) =>
        (left.geographicDistanceMeters ?? 0) - (right.geographicDistanceMeters ?? 0) ||
        left.transitPlaceId.localeCompare(right.transitPlaceId),
    )
    .slice(0, maximum);
  const members: Array<{ stopId: StopId; placeId: string; distance?: number }> = [];
  for (const candidate of sorted) {
    const place = graph.placesById.get(candidate.transitPlaceId);
    if (place === undefined) continue;
    for (const stopId of place.memberStopIds) {
      members.push({
        stopId,
        placeId: candidate.transitPlaceId,
        ...(candidate.geographicDistanceMeters === undefined
          ? {}
          : { distance: candidate.geographicDistanceMeters }),
      });
    }
  }
  return members.sort((left, right) => left.stopId.localeCompare(right.stopId));
};

const stateKey = (state: SearchState): string =>
  `${state.originPlaceId}|${transferEdgeKey(state.originWalk)}|${state.stopId}|${state.transfersUsed}|${state.straightLineWalksUsed}|${state.boardedRouteIds.join(",")}`;

export const searchGuidePaths = Effect.fn("RouteGuide.searchGuidePaths")(function* (
  graph: GuideGraph,
  query: RouteGuideQuery,
) {
  const originPlaceIds = new Set(query.origins.map((origin) => origin.transitPlaceId));
  const destinationPlaceIds = new Set(
    query.destinations.map((destination) => destination.transitPlaceId),
  );
  const samePlaceOnly =
    originPlaceIds.size > 0 &&
    destinationPlaceIds.size > 0 &&
    [...originPlaceIds].every((id) => destinationPlaceIds.has(id)) &&
    [...destinationPlaceIds].every((id) => originPlaceIds.has(id));
  if (samePlaceOnly) {
    return yield* Effect.succeed({
      _tag: "InvalidCandidateSet" as const,
      reason: "Origin and destination resolve to the same transit place; no ride is required",
      expandedStates: 0,
    } satisfies RouteGuideResult);
  }

  const originMembers = memberStopIdsForPlaces(graph, query.origins, query.maximumOriginCandidates);
  const destinationMembers = memberStopIdsForPlaces(
    graph,
    query.destinations,
    query.maximumDestinationCandidates,
  );
  if (originMembers.length === 0 || destinationMembers.length === 0) {
    return yield* Effect.succeed({
      _tag: "InvalidCandidateSet" as const,
      reason: "No known transit-place members for the supplied candidates",
      expandedStates: 0,
    } satisfies RouteGuideResult);
  }

  const destinationStopIds = new Set(destinationMembers.map((member) => member.stopId));
  const destinationPlaceByStop = new Map(
    destinationMembers.map((member) => [member.stopId, member]),
  );
  const destinationDistanceByPlace = new Map(
    destinationMembers
      .filter((member) => member.distance !== undefined)
      .map((member) => [member.placeId, member.distance as number]),
  );

  const { allowedRoutesByTransfersRemaining, alightTargetsByTransfersRemaining } =
    routeSearchBounds(graph, destinationStopIds, query.maximumTransfers);

  const queue: Array<SearchState> = [];
  let queueIndex = 0;
  const bestAt = new Map<string, number>();
  let expandedStates = 0;
  const foundPaths: Array<RawPath> = [];

  for (const origin of originMembers) {
    queue.push({
      stopId: origin.stopId,
      originPlaceId: origin.placeId,
      ...(origin.distance === undefined ? {} : { originDistance: origin.distance }),
      transfersUsed: 0,
      straightLineWalksUsed: 0,
      legs: [],
      transferEdges: [],
      boardedRouteIds: [],
    });
    for (const edge of graph.transferEdgesFrom.get(origin.stopId) ?? []) {
      if (!isStraightLineWalk(edge)) continue;
      queue.push({
        stopId: edge.toStopId,
        originPlaceId: origin.placeId,
        ...(origin.distance === undefined ? {} : { originDistance: origin.distance }),
        originWalk: edge,
        transfersUsed: 0,
        straightLineWalksUsed: 0,
        legs: [],
        transferEdges: [],
        boardedRouteIds: [],
      });
    }
  }

  // Path discovery is breadth-first, so a very small cap can let one noisy
  // platform family crowd out a geographically different interchange.
  const maximumFoundPaths = Math.max(2_048, query.maximumAlternatives * 256);
  while (queueIndex < queue.length) {
    const state = queue[queueIndex++]!;
    expandedStates += 1;
    if (expandedStates > query.maximumExpandedStates) break;

    if (state.legs.length > 0) {
      const dest = destinationPlaceByStop.get(state.stopId);
      if (dest !== undefined) {
        foundPaths.push({
          originPlaceId: state.originPlaceId,
          destinationPlaceId: dest.placeId,
          ...(state.originDistance === undefined ? {} : { originDistance: state.originDistance }),
          ...(destinationDistanceByPlace.has(dest.placeId)
            ? { destinationDistance: destinationDistanceByPlace.get(dest.placeId) }
            : {}),
          ...(state.originWalk === undefined ? {} : { originWalk: state.originWalk }),
          legs: state.legs,
          transferEdges: state.transferEdges,
        });
        if (foundPaths.length >= maximumFoundPaths) break;
      }

      for (const edge of graph.transferEdgesFrom.get(state.stopId) ?? []) {
        if (!isStraightLineWalk(edge)) continue;
        const walkedDestination = destinationPlaceByStop.get(edge.toStopId);
        if (walkedDestination === undefined) continue;
        foundPaths.push({
          originPlaceId: state.originPlaceId,
          destinationPlaceId: walkedDestination.placeId,
          ...(state.originDistance === undefined ? {} : { originDistance: state.originDistance }),
          ...(destinationDistanceByPlace.has(walkedDestination.placeId)
            ? { destinationDistance: destinationDistanceByPlace.get(walkedDestination.placeId) }
            : {}),
          ...(state.originWalk === undefined ? {} : { originWalk: state.originWalk }),
          destinationWalk: edge,
          legs: state.legs,
          transferEdges: state.transferEdges,
        });
        if (foundPaths.length >= maximumFoundPaths) break;
      }
      if (foundPaths.length >= maximumFoundPaths) break;
    }

    const key = stateKey(state);
    const prior = bestAt.get(key);
    if (prior !== undefined && prior <= state.transfersUsed && state.legs.length > 0) continue;
    bestAt.set(key, state.transfersUsed);

    if (state.legs.length >= query.maximumTransfers + 1) continue;

    if (state.legs.length === 0) {
      const allowedRoutes = allowedRoutesByTransfersRemaining[query.maximumTransfers]!;
      const targets = alightTargetsByTransfersRemaining[query.maximumTransfers]!;
      for (const ride of expandRidesFromStop(
        graph,
        state.stopId,
        new Set(),
        allowedRoutes,
        targets,
      )) {
        queue.push({
          stopId: ride.alightStopId,
          originPlaceId: state.originPlaceId,
          ...(state.originDistance === undefined ? {} : { originDistance: state.originDistance }),
          ...(state.originWalk === undefined ? {} : { originWalk: state.originWalk }),
          transfersUsed: 0,
          straightLineWalksUsed: 0,
          legs: [ride],
          transferEdges: [],
          boardedRouteIds: [ride.pattern.routeId],
        });
      }
      continue;
    }

    if (state.transfersUsed >= query.maximumTransfers) continue;

    const remainingTransfers = query.maximumTransfers - state.transfersUsed - 1;
    const nextTargets = alightTargetsByTransfersRemaining[remainingTransfers]!;
    const allowedRoutes = allowedRoutesByTransfersRemaining[remainingTransfers]!;
    const excludeRoutes = new Set(state.boardedRouteIds);
    const edges = graph.transferEdgesFrom.get(state.stopId) ?? [];

    // Prefer continuing after alighting: require a route change via transfer edges.
    for (const edge of edges) {
      if (isStraightLineWalk(edge) && state.straightLineWalksUsed >= 1) continue;
      for (const ride of expandRidesFromStop(
        graph,
        edge.toStopId,
        excludeRoutes,
        allowedRoutes,
        nextTargets,
      )) {
        queue.push({
          stopId: ride.alightStopId,
          originPlaceId: state.originPlaceId,
          ...(state.originDistance === undefined ? {} : { originDistance: state.originDistance }),
          ...(state.originWalk === undefined ? {} : { originWalk: state.originWalk }),
          transfersUsed: state.transfersUsed + 1,
          straightLineWalksUsed: state.straightLineWalksUsed + (isStraightLineWalk(edge) ? 1 : 0),
          legs: [...state.legs, ride],
          transferEdges: [...state.transferEdges, edge],
          boardedRouteIds: [...state.boardedRouteIds, ride.pattern.routeId],
        });
      }
    }
  }

  if (foundPaths.length === 0) {
    return yield* Effect.succeed({
      _tag: "NoTopologicalRoute" as const,
      originPlaceIds: query.origins.map((candidate) => candidate.transitPlaceId),
      destinationPlaceIds: query.destinations.map((candidate) => candidate.transitPlaceId),
      reason: "No topological bus guide within transfer and expansion caps",
      expandedStates,
    } satisfies RouteGuideResult);
  }

  const unique = new Map<string, RawPath>();
  for (const path of foundPaths) {
    const key = stablePathId(path);
    if (!unique.has(key)) unique.set(key, path);
  }

  const rideablePaths = [...unique.values()].filter((path) =>
    path.legs.every((leg) => !loopsBackPastRideBoundary(graph, leg)),
  );
  const actionable = groupInterchangeablePaths(
    graph,
    withoutLongerSameRoutePaths(graph, rideablePaths),
  ).filter((alternative) =>
    alternative.rideSteps.every((step) =>
      step.lineOptions.every((option) => option.directionLabelAuthority !== "Ambiguous"),
    ),
  );
  // Exact duplicate routes and longer variants of the same passenger action
  // have already been collapsed above. Keep the remaining line/transfer
  // strategies so a faster direct bus does not erase valid alternatives.
  const alternatives = distinctPassengerActions(actionable).slice(0, query.maximumAlternatives);

  if (alternatives.length === 0) {
    return yield* Effect.succeed({
      _tag: "NoTopologicalRoute" as const,
      originPlaceIds: query.origins.map((candidate) => candidate.transitPlaceId),
      destinationPlaceIds: query.destinations.map((candidate) => candidate.transitPlaceId),
      reason: "Guide paths lacked actionable steps or a defensible direction label",
      expandedStates,
    } satisfies RouteGuideResult);
  }

  return yield* Effect.succeed({
    _tag: "GuidesFound" as const,
    alternatives,
    expandedStates,
  } satisfies RouteGuideResult);
});
