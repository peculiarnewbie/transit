import { Context, Effect, Layer, Schema } from "effect";

import { PlaceDiscoveryFailure } from "../discovery/place/model.js";
import * as PassengerPlaceDiscovery from "../discovery/place/service.js";
import { TransitPlaceProjection } from "../discovery/transit/index.js";
import { NetworkSnapshot, type Stop } from "../domain/transit/index.js";
import type { GuideGraph } from "../route-guide/graph.js";
import { projectInstructions } from "../route-guide/instructions.js";
import type { GuideAlternative, RouteGuideError, RouteGuideResult } from "../route-guide/model.js";
import { RouteGuide } from "../route-guide/index.js";
import { ArtifactStore } from "./artifact-store.js";
import { PlaceArtifactStore } from "./place-artifact-store.js";
import {
  type ArtifactVersionsResponse,
  type CoverageDisclosure,
  type NearbyTransitResponse,
  type PassengerGuideAlternative,
  type PlaceSearchResponse,
  type RouteGuideResponse,
  NearbyTransitRequest as NearbyTransitRequestSchema,
  PlaceSearchRequest as PlaceSearchRequestSchema,
  RouteGuideRequest as RouteGuideRequestSchema,
} from "./route-helper-contracts.js";

export class InvalidRouteHelperQuery extends Schema.TaggedErrorClass<InvalidRouteHelperQuery>()(
  "RouteHelperQuery.InvalidQuery",
  {
    reason: Schema.String,
  },
) {}

const formatLineList = (names: ReadonlyArray<string>): string => {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} atau ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, atau ${names[names.length - 1]}`;
};

const differenceSummary = (
  alternative: GuideAlternative,
  index: number,
  all: ReadonlyArray<GuideAlternative>,
): string => {
  if (all.length === 1) return "Rute utama";
  const baseline = all[0]!;
  if (index === 0) {
    if (alternative.metrics.transferCount === 0) return "Langsung, tanpa pindah";
    return `${alternative.metrics.transferCount} kali pindah`;
  }
  if (alternative.metrics.transferCount < baseline.metrics.transferCount) {
    return "Lebih sedikit pindah";
  }
  if (alternative.metrics.transferCount > baseline.metrics.transferCount) {
    return "Lebih banyak pindah";
  }
  const baseBoard = baseline.rideSteps[0]?.boarding.placeName;
  const board = alternative.rideSteps[0]?.boarding.placeName;
  if (baseBoard !== undefined && board !== undefined && baseBoard !== board) {
    return `Naik di ${board}`;
  }
  const baseLines = baseline.rideSteps[0]?.lineOptions.map((o) => o.passengerLineName).join("/");
  const lines = alternative.rideSteps[0]?.lineOptions.map((o) => o.passengerLineName).join("/");
  if (baseLines !== undefined && lines !== undefined && baseLines !== lines) {
    return `Jalur ${lines}`;
  }
  return `Alternatif ${index + 1}`;
};

/**
 * Platform/member variants often produce several graph paths with an identical
 * passenger decision. Keep the closest representative for each visible line
 * and direction sequence instead of presenting those variants as choices.
 */
export const distinctPassengerAlternatives = (
  alternatives: ReadonlyArray<GuideAlternative>,
): ReadonlyArray<GuideAlternative> => {
  const byJourney = new Map<string, GuideAlternative>();
  const connectorDistance = (alternative: GuideAlternative) =>
    (alternative.metrics.originCandidateDistanceMeters ?? 0) +
    (alternative.metrics.destinationCandidateDistanceMeters ?? 0);
  for (const alternative of alternatives) {
    const instructions = projectInstructions(alternative);
    const key = JSON.stringify(
      instructions.rideSteps.map((step) => ({
        lines: [...step.lineBadges].sort(),
        directions: [...step.directionSummaries].sort(),
      })),
    );
    const current = byJourney.get(key);
    if (current === undefined || connectorDistance(alternative) < connectorDistance(current))
      byJourney.set(key, alternative);
  }
  return [...byJourney.values()];
};

const placedCoordinate = (stop: Stop): readonly [number, number] | undefined =>
  stop.location._tag === "Placed" ? [stop.location.longitude, stop.location.latitude] : undefined;

const nearestCoordinateIndexes = (
  geometry: ReadonlyArray<readonly [number, number]>,
  coordinate: readonly [number, number],
) =>
  geometry
    .map((candidate, index) => {
      const longitudeDelta = candidate[0] - coordinate[0];
      const latitudeDelta = candidate[1] - coordinate[1];
      return { index, distance: longitudeDelta * longitudeDelta + latitudeDelta * latitudeDelta };
    })
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 8);

const simplifyGeometry = (coordinates: ReadonlyArray<readonly [number, number]>) => {
  const first = coordinates[0];
  if (first === undefined) return [];
  const simplified: Array<readonly [number, number]> = [first];
  let previous = first;
  for (const coordinate of coordinates.slice(1, -1)) {
    const longitudeDelta = coordinate[0] - previous[0];
    const latitudeDelta = coordinate[1] - previous[1];
    if (longitudeDelta * longitudeDelta + latitudeDelta * latitudeDelta < 0.00005 ** 2) continue;
    simplified.push(coordinate);
    previous = coordinate;
  }
  const last = coordinates.at(-1);
  if (last !== undefined && (last[0] !== previous[0] || last[1] !== previous[1]))
    simplified.push(last);
  return simplified;
};

const rideSegmentsFor = (
  graph: GuideGraph,
  geometryById: ReadonlyMap<string, ReadonlyArray<readonly [number, number]>>,
  routeColorById: ReadonlyMap<string, string>,
  alternative: GuideAlternative,
) =>
  alternative.rideSteps.flatMap((step) => {
    const option = step.lineOptions[0];
    if (option?.geometryId === undefined) return [];
    const pattern = graph.patterns.find((candidate) => candidate.patternId === option.patternId);
    const geometry = geometryById.get(option.geometryId);
    if (pattern === undefined || geometry === undefined || geometry.length < 2) return [];

    const boardingIndexes = pattern.stopIds
      .map((stopId, index) =>
        graph.placeIdByStopId.get(stopId) === step.boarding.transitPlaceId ? index : -1,
      )
      .filter((index) => index >= 0);
    const alightingIndexes = pattern.stopIds
      .map((stopId, index) =>
        graph.placeIdByStopId.get(stopId) === step.alighting.transitPlaceId ? index : -1,
      )
      .filter((index) => index >= 0);
    const range = boardingIndexes
      .flatMap((from) =>
        alightingIndexes.filter((to) => to > from).map((to) => ({ from, to, length: to - from })),
      )
      .sort((left, right) => left.length - right.length)[0];
    if (range === undefined) return [];

    const boardingStop = graph.stopsById.get(pattern.stopIds[range.from]!);
    const alightingStop = graph.stopsById.get(pattern.stopIds[range.to]!);
    const boardingCoordinate =
      boardingStop === undefined ? undefined : placedCoordinate(boardingStop);
    const alightingCoordinate =
      alightingStop === undefined ? undefined : placedCoordinate(alightingStop);
    if (boardingCoordinate === undefined || alightingCoordinate === undefined) return [];
    const geometryRange = nearestCoordinateIndexes(geometry, boardingCoordinate)
      .flatMap((from) =>
        nearestCoordinateIndexes(geometry, alightingCoordinate)
          .filter((to) => to.index > from.index)
          .map((to) => ({
            from: from.index,
            to: to.index,
            distance: from.distance + to.distance,
            length: to.index - from.index,
          })),
      )
      .sort((left, right) => left.distance - right.distance || left.length - right.length)[0];
    if (geometryRange === undefined) return [];
    const segment = simplifyGeometry(geometry.slice(geometryRange.from, geometryRange.to + 1));
    return segment.length < 2
      ? []
      : [{ coordinates: segment, color: routeColorById.get(option.routeId) ?? "#31556f" }];
  });

const toPassengerAlternative = (
  alternative: GuideAlternative,
  index: number,
  all: ReadonlyArray<GuideAlternative>,
  graph: GuideGraph,
  geometryById: ReadonlyMap<string, ReadonlyArray<readonly [number, number]>>,
  routeColorById: ReadonlyMap<string, string>,
): PassengerGuideAlternative => {
  const instructions = projectInstructions(alternative);
  const rideSegments = rideSegmentsFor(graph, geometryById, routeColorById, alternative);
  return {
    id: alternative.id,
    differenceSummary: differenceSummary(alternative, index, all),
    origin: alternative.origin,
    destination: alternative.destination,
    transferCount: alternative.metrics.transferCount,
    rideSteps: alternative.rideSteps.map((step, stepIndex) => {
      const instruction = instructions.rideSteps[stepIndex]!;
      return {
        summary: instruction.summary,
        lineBadges: [...instruction.lineBadges],
        linePhrase: formatLineList(instruction.lineBadges),
        directionSummaries: [...instruction.directionSummaries],
        boardingPlaceName: instruction.boardingPlaceName,
        alightingPlaceName: instruction.alightingPlaceName,
        ...(instruction.boardingMemberDetail === undefined
          ? {}
          : { boardingMemberDetail: instruction.boardingMemberDetail }),
        ...(instruction.alightingMemberDetail === undefined
          ? {}
          : { alightingMemberDetail: instruction.alightingMemberDetail }),
        intermediatePlaceNamesByOption: instruction.intermediatePlaceNamesByOption.map((entry) => ({
          line: entry.line,
          placeNames: [...entry.placeNames],
        })),
        lineOptions: step.lineOptions,
        boarding: step.boarding,
        alighting: step.alighting,
      };
    }),
    transfers: alternative.transfers.map((transfer, transferIndex) => {
      const instruction = instructions.transfers[transferIndex]!;
      return {
        summary: instruction.summary,
        leavePlaceName: instruction.leavePlaceName,
        boardNextPlaceName: instruction.boardNextPlaceName,
        nextLineBadges: [...instruction.nextLineBadges],
        ...(instruction.nextDirectionLabel === undefined
          ? {}
          : { nextDirectionLabel: instruction.nextDirectionLabel }),
        platformDetailKnown: instruction.platformDetailKnown,
        leavePlace: transfer.leavePlace,
        boardNextPlace: transfer.boardNextPlace,
        evidence: transfer.evidence,
      };
    }),
    metrics: alternative.metrics,
    rideGeometry: rideSegments.map((segment) => segment.coordinates),
    rideSegments,
    alternative,
  };
};

export interface Interface {
  readonly versions: () => Effect.Effect<ArtifactVersionsResponse, never>;
  readonly searchPlaces: (
    input: unknown,
  ) => Effect.Effect<PlaceSearchResponse, InvalidRouteHelperQuery | PlaceDiscoveryFailure>;
  readonly nearbyTransit: (
    input: unknown,
  ) => Effect.Effect<NearbyTransitResponse, InvalidRouteHelperQuery | PlaceDiscoveryFailure>;
  readonly guide: (
    input: unknown,
  ) => Effect.Effect<
    RouteGuideResponse,
    InvalidRouteHelperQuery | RouteGuideError | PlaceDiscoveryFailure
  >;
}

export class Service extends Context.Service<Service, Interface>()("@transit/RouteHelperQuery") {}

export const make = Effect.fn("RouteHelperQuery.make")(function* () {
  const network = yield* ArtifactStore.Service;
  const places = yield* PlaceArtifactStore.Service;
  const discovery = yield* PassengerPlaceDiscovery.Service;
  const guideService = yield* RouteGuide.Service;
  const geometryById = new Map(
    network.geometry.geometries.map((geometry) => [geometry.id, geometry.coordinates]),
  );
  const routeColorById = new Map(
    network.snapshot.routes.map((route) => [
      route.id,
      route.color !== undefined && /^[0-9a-f]{6}$/i.test(route.color)
        ? `#${route.color}`
        : "#31556f",
    ]),
  );

  const coverage = (): CoverageDisclosure => ({
    mode: "bus-only",
    networkArtifactVersion: network.version,
    placesArtifactVersion: places.version,
    attribution: places.attribution,
    freshnessNote: `Data bus ${network.version}; tempat penumpang ${places.version}. Hanya TransJakarta bus, tanpa jadwal.`,
  });

  const versions = Effect.fn("RouteHelperQuery.versions")(() =>
    Effect.succeed({
      networkArtifactVersion: network.version,
      placesArtifactVersion: places.version,
      networkSnapshotChecksum: network.snapshotChecksum,
      networkGeometryChecksum: network.geometryChecksum,
      placesArtifactChecksum: places.artifactChecksum,
      coverage: coverage(),
    } satisfies ArtifactVersionsResponse),
  );

  const searchPlaces = Effect.fn("RouteHelperQuery.searchPlaces")(function* (input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(PlaceSearchRequestSchema)(input).pipe(
      Effect.mapError(
        (error) =>
          new InvalidRouteHelperQuery({ reason: `Invalid place search: ${String(error)}` }),
      ),
    );
    if (decoded.artifactVersion !== undefined && decoded.artifactVersion !== places.version) {
      return {
        _tag: "NoMatch" as const,
        placesArtifactVersion: places.version,
        networkArtifactVersion: network.version,
        queryText: decoded.text,
      } satisfies PlaceSearchResponse;
    }
    const outcome = yield* discovery.search({
      text: decoded.text,
      limit: decoded.limit ?? 8,
      ...(decoded.biasCoordinate === undefined ? {} : { biasCoordinate: decoded.biasCoordinate }),
    });
    if (outcome._tag === "NoMatch") {
      return {
        _tag: "NoMatch" as const,
        placesArtifactVersion: places.version,
        networkArtifactVersion: network.version,
        queryText: outcome.queryText,
      } satisfies PlaceSearchResponse;
    }
    return {
      _tag: "Matches" as const,
      placesArtifactVersion: places.version,
      networkArtifactVersion: network.version,
      results: outcome.results,
    } satisfies PlaceSearchResponse;
  });

  const nearbyTransit = Effect.fn("RouteHelperQuery.nearbyTransit")(function* (input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(NearbyTransitRequestSchema)(input).pipe(
      Effect.mapError(
        (error) =>
          new InvalidRouteHelperQuery({ reason: `Invalid nearby transit query: ${String(error)}` }),
      ),
    );
    if (decoded.artifactVersion !== undefined && decoded.artifactVersion !== places.version) {
      return yield* Effect.fail(
        new InvalidRouteHelperQuery({
          reason: `Stale places artifact ${decoded.artifactVersion}; current is ${places.version}`,
        }),
      );
    }
    const outcome = yield* discovery.nearbyTransit(
      {
        ...(decoded.placeId === undefined ? {} : { placeId: decoded.placeId }),
        ...(decoded.coordinate === undefined ? {} : { coordinate: decoded.coordinate }),
        ...(decoded.bounds === undefined ? {} : { bounds: decoded.bounds }),
        radiusMeters: decoded.radiusMeters ?? 800,
        maxCount: decoded.maxCount ?? 6,
      },
      guideService.graph.places,
    );
    if (outcome._tag === "NoneWithinCap") {
      return {
        _tag: "NoneWithinCap" as const,
        placesArtifactVersion: places.version,
        networkArtifactVersion: network.version,
        radiusMeters: outcome.radiusMeters,
        maxCount: outcome.maxCount,
      } satisfies NearbyTransitResponse;
    }
    return {
      _tag: "Choices" as const,
      placesArtifactVersion: places.version,
      networkArtifactVersion: network.version,
      choices: outcome.choices,
    } satisfies NearbyTransitResponse;
  });

  const guide = Effect.fn("RouteHelperQuery.guide")(function* (input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(RouteGuideRequestSchema)(input).pipe(
      Effect.mapError(
        (error) => new InvalidRouteHelperQuery({ reason: `Invalid route guide: ${String(error)}` }),
      ),
    );

    if (
      decoded.networkArtifactVersion !== network.version ||
      decoded.placesArtifactVersion !== places.version
    ) {
      return {
        _tag: "StaleSelection" as const,
        reason: "Artifact versions no longer match the loaded production set.",
        expectedNetworkArtifactVersion: network.version,
        expectedPlacesArtifactVersion: places.version,
        receivedNetworkArtifactVersion: decoded.networkArtifactVersion,
        receivedPlacesArtifactVersion: decoded.placesArtifactVersion,
      } satisfies RouteGuideResponse;
    }

    const origins = decoded.originCandidates.map((candidate) => ({
      transitPlaceId: candidate.transitPlaceId,
      ...(candidate.geographicDistanceMeters === undefined
        ? {}
        : { geographicDistanceMeters: candidate.geographicDistanceMeters }),
    }));
    const destinations = decoded.destinationCandidates.map((candidate) => ({
      transitPlaceId: candidate.transitPlaceId,
      ...(candidate.geographicDistanceMeters === undefined
        ? {}
        : { geographicDistanceMeters: candidate.geographicDistanceMeters }),
    }));
    const transferCeiling = decoded.maximumTransfers ?? 3;
    let result: RouteGuideResult | undefined;
    for (let maximumTransfers = 0; maximumTransfers <= transferCeiling; maximumTransfers += 1) {
      result = yield* guideService.guide({
        origins,
        destinations,
        maximumTransfers,
        maximumOriginCandidates: Math.min(12, decoded.originCandidates.length),
        maximumDestinationCandidates: Math.min(12, decoded.destinationCandidates.length),
        maximumAlternatives: decoded.maximumAlternatives ?? 6,
        maximumExpandedStates: 100_000,
      });
      if (result._tag === "GuidesFound" || result._tag === "InvalidCandidateSet") break;
    }
    if (result === undefined)
      return yield* Effect.die("Route-guide iterative search did not execute");

    if (result._tag === "GuidesFound") {
      const alternatives = distinctPassengerAlternatives(result.alternatives);
      return {
        _tag: "GuidesFound" as const,
        origin: decoded.origin,
        destination: decoded.destination,
        alternatives: alternatives.map((alternative, index) =>
          toPassengerAlternative(
            alternative,
            index,
            alternatives,
            guideService.graph,
            geometryById,
            routeColorById,
          ),
        ),
        coverage: coverage(),
      } satisfies RouteGuideResponse;
    }

    if (result._tag === "NoTopologicalRoute") {
      return {
        _tag: "NoTopologicalRoute" as const,
        origin: decoded.origin,
        destination: decoded.destination,
        originCandidates: decoded.originCandidates,
        destinationCandidates: decoded.destinationCandidates,
        reason: result.reason,
        coverage: coverage(),
      } satisfies RouteGuideResponse;
    }

    return {
      _tag: "InvalidCandidateSet" as const,
      origin: decoded.origin,
      destination: decoded.destination,
      reason: result.reason,
      coverage: coverage(),
    } satisfies RouteGuideResponse;
  });

  return Service.of({ versions, searchPlaces, nearbyTransit, guide });
});

export const layer = Layer.effect(Service, make());

/** Build place discovery + route guide + query layers from loaded artifacts. */
export const composeHelperLayers = Effect.fn("RouteHelperQuery.composeHelperLayers")(function* () {
  const network = yield* ArtifactStore.Service;
  const places = yield* PlaceArtifactStore.Service;
  if (places.networkArtifactVersion !== network.version) {
    return yield* Effect.fail(
      new InvalidRouteHelperQuery({
        reason: `Place artifact requires network ${places.networkArtifactVersion}; loaded ${network.version}`,
      }),
    );
  }
  // Projection and guide graph re-decode NetworkSnapshot from wire JSON.
  const encodedSnapshot = yield* Schema.encodeUnknownEffect(NetworkSnapshot)(network.snapshot);
  const placeIndex = yield* TransitPlaceProjection.project({
    snapshot: encodedSnapshot,
    sourceArtifactVersion: network.version,
  });
  const discoveryLayer = PassengerPlaceDiscovery.layer({
    artifact: places.artifact,
    transitIndex: placeIndex,
  });
  const guideLayer = RouteGuide.layer({
    snapshot: encodedSnapshot,
    sourceArtifactVersion: network.version,
    placeIndex,
  });
  return layer.pipe(Layer.provide(discoveryLayer), Layer.provide(guideLayer));
});

export * as RouteHelperQuery from "./route-helper-query.js";
