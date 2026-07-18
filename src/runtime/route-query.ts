import { Cache, Context, Effect, Layer, Schema } from "effect";

import type { GeometryId, Route, RoutePattern, Stop, StopId } from "../domain/transit/index.js";
import {
  type Itinerary,
  type LineConstraint as RoutingLineConstraint,
  type RoutingLeg,
  type RoutingError,
  type TransitLeg as RoutingTransitLeg,
  Router,
  RoutingIndex,
} from "../routing/index.js";
import { hasBoardableDeparture, isServiceActive } from "../routing/search.js";
import {
  type Journey,
  JourneyRequest,
  type JourneyResponse,
  type LockedLeg,
  type StopSearchResponse,
  StopSearchRequest,
  type StopSuggestion,
} from "./api-contracts.js";
import { ArtifactStore } from "./artifact-store.js";

export class InvalidQuery extends Schema.TaggedErrorClass<InvalidQuery>()(
  "RouteQuery.InvalidQuery",
  { reason: Schema.String },
) {}

export type QueryError = InvalidQuery | RoutingError;

export interface Interface {
  readonly journeys: (input: unknown) => Effect.Effect<JourneyResponse, QueryError>;
  readonly searchStops: (input: unknown) => Effect.Effect<StopSearchResponse, InvalidQuery>;
}

export class Service extends Context.Service<Service, Interface>()("@transit/RouteQuery") {}

const invalid = (reason: string) => new InvalidQuery({ reason });
const radians = (degrees: number) => (degrees * Math.PI) / 180;

const distanceMeters = (
  left: { readonly latitude: number; readonly longitude: number },
  right: { readonly latitude: number; readonly longitude: number },
) => {
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const latitude1 = radians(left.latitude);
  const latitude2 = radians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

const placedCoordinate = (stop: Stop) =>
  stop.location._tag === "Placed"
    ? { latitude: stop.location.latitude, longitude: stop.location.longitude }
    : undefined;

const stationIdFor = (index: RoutingIndex.Interface, stopId: StopId): StopId =>
  index.stopsById.get(stopId)?.parentStopId ?? stopId;

const stationStopIds = (index: RoutingIndex.Interface, stopId: StopId): ReadonlyArray<StopId> => {
  const stationId = stationIdFor(index, stopId);
  return [stationId, ...(index.childStopIdsByParent.get(stationId) ?? [])];
};

const connectedStationStopIds = (
  index: RoutingIndex.Interface,
  stopId: StopId,
): ReadonlyArray<StopId> => {
  const connected = stationStopIds(index, stopId).filter((candidate) =>
    index.patternsByStop.has(candidate),
  );
  return connected.length === 0 ? [stopId] : connected;
};

const stopIdsLinkedWithoutBoarding = (
  index: RoutingIndex.Interface,
  seedStopIds: Iterable<StopId>,
): ReadonlySet<StopId> => {
  const pending = [...seedStopIds].flatMap((stopId) => stationStopIds(index, stopId));
  const visited = new Set<StopId>();
  while (pending.length > 0) {
    const stopId = pending.pop();
    if (stopId === undefined || visited.has(stopId)) continue;
    visited.add(stopId);
    for (const transfer of index.transfersByStop.get(stopId) ?? []) {
      for (const linkedStopId of stationStopIds(index, transfer.toStopId)) {
        if (!visited.has(linkedStopId)) pending.push(linkedStopId);
      }
    }
  }
  return visited;
};

interface DirectBoarding {
  readonly boardingStopId: StopId;
  readonly pattern: RoutePattern;
}

const directBoardings = (
  index: RoutingIndex.Interface,
  originStopId: StopId,
): ReadonlyArray<DirectBoarding> => {
  const boardings: Array<DirectBoarding> = [];
  const seenBoardings = new Set<string>();
  for (const stopId of stopIdsLinkedWithoutBoarding(index, [originStopId])) {
    for (const pattern of index.patternsByStop.get(stopId) ?? []) {
      const key = `${stopId}|${pattern.id}`;
      if (seenBoardings.has(key)) continue;
      seenBoardings.add(key);
      boardings.push({ boardingStopId: stopId, pattern });
    }
  }
  return boardings;
};

const directlyReachableStopIds = (
  index: RoutingIndex.Interface,
  boardings: ReadonlyArray<DirectBoarding>,
  serviceDate: string | undefined,
  departureSeconds: number | undefined,
) => {
  const reachable = new Set<StopId>();
  for (const { boardingStopId, pattern } of boardings) {
    if (
      serviceDate !== undefined &&
      departureSeconds !== undefined &&
      !(index.tripsByPattern.get(pattern.id) ?? []).some((trip) => {
        const calendar = index.calendarsById.get(trip.serviceId);
        return (
          calendar !== undefined &&
          isServiceActive(calendar, serviceDate) &&
          hasBoardableDeparture(pattern, trip, boardingStopId, departureSeconds)
        );
      })
    )
      continue;
    for (let position = 0; position < pattern.stopIds.length; position += 1) {
      if (pattern.stopIds[position] !== boardingStopId) continue;
      for (const nextStopId of pattern.stopIds.slice(position + 1)) {
        for (const stationStopId of stationStopIds(index, nextStopId)) {
          reachable.add(stationStopId);
        }
      }
    }
  }
  return reachable;
};

const endpointCandidates = Effect.fn("RouteQuery.endpointCandidates")(function* (
  index: RoutingIndex.Interface,
  endpoint: JourneyRequest["origin"],
) {
  if (endpoint._tag === "Stop") {
    if (!index.stopsById.has(endpoint.stopId))
      return yield* Effect.fail(invalid(`Unknown stop ${endpoint.stopId}`));
    return connectedStationStopIds(index, endpoint.stopId).map((stopId) => ({
      stopId,
      walkSeconds: 0,
    }));
  }
  const candidates = index.snapshot.stops
    .flatMap((stop) => {
      const coordinate = placedCoordinate(stop);
      if (coordinate === undefined) return [];
      const meters = distanceMeters(endpoint.coordinate, coordinate);
      const walkSeconds = Math.ceil(meters / 1.35);
      return walkSeconds <= 900 ? [{ stopId: stop.id, walkSeconds, meters }] : [];
    })
    .sort((left, right) => left.meters - right.meters)
    .slice(0, 4)
    .map(({ stopId, walkSeconds }) => ({ stopId, walkSeconds }));
  if (candidates.length === 0)
    return yield* Effect.fail(invalid("No transit stop is within walking distance"));
  return candidates;
});

const toRoutingConstraint = Effect.fn("RouteQuery.toRoutingConstraint")(function* (
  request: JourneyRequest,
) {
  if (request.lockedLeg !== undefined)
    return { _tag: "Locked", legs: [request.lockedLeg] } satisfies RoutingLineConstraint;
  if (request.lineRules.length === 0) return { _tag: "None" } satisfies RoutingLineConstraint;
  const kinds = new Set(request.lineRules.map((rule) => rule._tag));
  if (kinds.size !== 1)
    return yield* Effect.fail(
      invalid("Combine line rules of one kind at a time: prefer, require, or exclude"),
    );
  const routeIds = request.lineRules.map((rule) => rule.routeId);
  const kind = request.lineRules[0]?._tag;
  switch (kind) {
    case "Exclude":
      return { _tag: "Excluded", routeIds } satisfies RoutingLineConstraint;
    case "Prefer":
      return { _tag: "Preferred", routeIds, weight: 900 } satisfies RoutingLineConstraint;
    case "Require":
      return { _tag: "Required", routeIds } satisfies RoutingLineConstraint;
    default:
      return { _tag: "None" } satisfies RoutingLineConstraint;
  }
});

const toneForRoute = (route: Route): "red" | "blue" | "yellow" | "green" => {
  const value = route.color?.toLowerCase() ?? route.id.toLowerCase();
  if (value.includes("yellow") || value.startsWith("f") || value.startsWith("e")) return "yellow";
  if (value.includes("green") || value.startsWith("2") || value.startsWith("3")) return "green";
  if (value.includes("blue") || value.startsWith("0") || value.startsWith("1")) return "blue";
  return "red";
};

const colorForRoute = (route: Route | undefined): string =>
  route?.color !== undefined && /^[0-9a-f]{6}$/i.test(route.color) ? `#${route.color}` : "#31556f";

const routingPointLabel = (
  index: RoutingIndex.Interface,
  point: Extract<RoutingLeg, { readonly _tag: "Walk" }>["from"],
) => {
  switch (point._tag) {
    case "Origin":
      return "Origin";
    case "Destination":
      return "Destination";
    case "Stop":
      return index.stopsById.get(point.stopId)?.name ?? point.stopId;
  }
};

const stopName = (index: RoutingIndex.Interface, stopId: StopId) =>
  index.stopsById.get(stopId)?.name ?? stopId;

const transitStopCount = (
  index: RoutingIndex.Interface,
  patternId: LockedLeg["patternId"],
  fromStopId: StopId,
  toStopId: StopId,
) => {
  const pattern = index.snapshot.patterns.find((candidate) => candidate.id === patternId);
  if (pattern === undefined) return 1;
  return Math.max(1, pattern.stopIds.lastIndexOf(toStopId) - pattern.stopIds.indexOf(fromStopId));
};

const coordinateDistanceSquared = (
  coordinate: readonly [number, number],
  stop: { readonly latitude: number; readonly longitude: number },
) => (coordinate[0] - stop.longitude) ** 2 + (coordinate[1] - stop.latitude) ** 2;

const nearestCoordinateIndex = (
  coordinates: ReadonlyArray<readonly [number, number]>,
  stop: { readonly latitude: number; readonly longitude: number },
  minimumIndex: number,
) => {
  let nearestIndex = minimumIndex;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = minimumIndex; index < coordinates.length; index += 1) {
    const coordinate = coordinates[index];
    if (coordinate === undefined) continue;
    const distance = coordinateDistanceSquared(coordinate, stop);
    if (distance >= nearestDistance) continue;
    nearestIndex = index;
    nearestDistance = distance;
  }
  return nearestIndex;
};

const patternRangeForLeg = (index: RoutingIndex.Interface, leg: RoutingTransitLeg) => {
  const pattern = index.snapshot.patterns.find((candidate) => candidate.id === leg.patternId);
  if (pattern === undefined) return undefined;
  const trip = index.snapshot.trips.find((candidate) => candidate.id === leg.tripId);
  const legDuration = leg.arrivalSeconds - leg.departureSeconds;
  let bestRange:
    | { readonly from: number; readonly to: number; readonly difference: number }
    | undefined;
  for (let from = 0; from < pattern.stopIds.length; from += 1) {
    if (pattern.stopIds[from] !== leg.fromStopId) continue;
    for (let to = from + 1; to < pattern.stopIds.length; to += 1) {
      if (pattern.stopIds[to] !== leg.toStopId) continue;
      const fromTime =
        trip?.availability._tag === "Scheduled" ? trip.availability.stopTimes[from] : undefined;
      const toTime =
        trip?.availability._tag === "Scheduled" ? trip.availability.stopTimes[to] : undefined;
      const scheduledDuration =
        fromTime === undefined || toTime === undefined
          ? legDuration
          : toTime.arrivalSeconds - fromTime.departureSeconds;
      const difference = Math.abs(scheduledDuration - legDuration);
      if (bestRange === undefined || difference < bestRange.difference)
        bestRange = { from, to, difference };
    }
  }
  return bestRange === undefined ? undefined : { pattern, ...bestRange };
};

const geometryForLeg = (
  index: RoutingIndex.Interface,
  geometryById: ReadonlyMap<GeometryId, ReadonlyArray<readonly [number, number]>>,
  leg: RoutingTransitLeg,
) => {
  if (leg.geometryId === undefined) return [];
  const geometry = geometryById.get(leg.geometryId) ?? [];
  const range = patternRangeForLeg(index, leg);
  if (range === undefined || geometry.length < 2) return geometry;
  const geometryIndexes: Array<number> = [];
  let minimumIndex = 0;
  for (const stopId of range.pattern.stopIds) {
    const stop = index.stopsById.get(stopId);
    const coordinate = stop === undefined ? undefined : placedCoordinate(stop);
    const geometryIndex =
      coordinate === undefined
        ? minimumIndex
        : nearestCoordinateIndex(geometry, coordinate, minimumIndex);
    geometryIndexes.push(geometryIndex);
    minimumIndex = geometryIndex;
  }
  const fromGeometryIndex = geometryIndexes[range.from];
  const toGeometryIndex = geometryIndexes[range.to];
  if (
    fromGeometryIndex === undefined ||
    toGeometryIndex === undefined ||
    toGeometryIndex <= fromGeometryIndex
  )
    return geometry;
  return geometry.slice(fromGeometryIndex, toGeometryIndex + 1);
};

const joinGeometry = (
  index: RoutingIndex.Interface,
  geometryById: ReadonlyMap<GeometryId, ReadonlyArray<readonly [number, number]>>,
  itinerary: Itinerary,
) => {
  const coordinates: Array<readonly [number, number]> = [];
  for (const leg of itinerary.legs) {
    if (leg._tag !== "Transit") continue;
    const segment = geometryForLeg(index, geometryById, leg);
    for (const coordinate of segment) {
      const previous = coordinates.at(-1);
      if (previous?.[0] !== coordinate[0] || previous[1] !== coordinate[1])
        coordinates.push(coordinate);
    }
  }
  return coordinates;
};

const mapJourney = (
  index: RoutingIndex.Interface,
  geometryById: ReadonlyMap<GeometryId, ReadonlyArray<readonly [number, number]>>,
  itinerary: Itinerary,
): Journey => {
  const lineNames: Array<string> = [];
  const legs = itinerary.legs.map((leg) => {
    if (leg._tag === "Walk")
      return {
        _tag: "Walk" as const,
        from: routingPointLabel(index, leg.from),
        to: routingPointLabel(index, leg.to),
        minutes: Math.ceil(leg.durationSeconds / 60),
        meters: Math.round(leg.durationSeconds * 1.35),
      };
    const route = index.snapshot.routes.find((candidate) => candidate.id === leg.routeId);
    const line = route?.shortName || route?.longName || leg.routeId;
    lineNames.push(line);
    return {
      _tag: "Transit" as const,
      routeId: leg.routeId,
      line,
      from: stopName(index, leg.fromStopId),
      to: stopName(index, leg.toStopId),
      minutes: Math.ceil((leg.arrivalSeconds - leg.departureSeconds) / 60),
      stops: transitStopCount(index, leg.patternId, leg.fromStopId, leg.toStopId),
      tone: route === undefined ? ("red" as const) : toneForRoute(route),
      color: colorForRoute(route),
      lock: {
        fromStopId: leg.fromStopId,
        toStopId: leg.toStopId,
        routeId: leg.routeId,
        patternId: leg.patternId,
        tripId: leg.tripId,
        departureSeconds: leg.departureSeconds,
        arrivalSeconds: leg.arrivalSeconds,
        ...(leg.geometryId === undefined ? {} : { geometryId: leg.geometryId }),
      },
    };
  });
  const id = itinerary.legs
    .map((leg) =>
      leg._tag === "Transit"
        ? `${leg.tripId}:${leg.fromStopId}:${leg.toStopId}`
        : `walk:${leg.departureSeconds}:${leg.arrivalSeconds}`,
    )
    .join("|");
  return {
    id,
    label: lineNames.length === 1 ? `Direct on ${lineNames[0]}` : lineNames.join(" → "),
    minutes: Math.ceil((itinerary.arrivalSeconds - itinerary.departureSeconds) / 60),
    walkingMinutes: Math.ceil(itinerary.walkingSeconds / 60),
    transfers: itinerary.transferCount,
    legs,
    geometry: joinGeometry(index, geometryById, itinerary),
  };
};

export const make = Effect.gen(function* () {
  const artifacts = yield* ArtifactStore.Service;
  const index = yield* RoutingIndex.Service;
  const router = yield* Router.Service;
  const geometryById = new Map(
    artifacts.geometry.geometries.map((geometry) => [geometry.id, geometry.coordinates]),
  );
  const boardingOptions = yield* Cache.make({
    capacity: 256,
    lookup: (stopId: StopId) => Effect.sync(() => directBoardings(index, stopId)),
    timeToLive: "1 hour",
  });

  const journeys = Effect.fn("RouteQuery.journeys")(function* (input: unknown) {
    const request = yield* Schema.decodeUnknownEffect(JourneyRequest)(input).pipe(
      Effect.mapError((error) => invalid(`Invalid journey request: ${String(error)}`)),
    );
    const [origins, destinations, lineConstraint] = yield* Effect.all([
      endpointCandidates(index, request.origin),
      endpointCandidates(index, request.destination),
      toRoutingConstraint(request),
    ]);
    const result = yield* router.route({
      origins,
      destinations,
      serviceDate: request.serviceDate,
      departureSeconds: request.departureSeconds,
      maximumTransfers: 3,
      maximumAccessWalkSeconds: 900,
      maximumTransferWalkSeconds: 900,
      maximumResults: request.maximumResults,
      lineConstraint,
    });
    return {
      journeys: result.itineraries.map((itinerary) => mapJourney(index, geometryById, itinerary)),
    };
  });

  const searchStops = Effect.fn("RouteQuery.searchStops")(function* (input: unknown) {
    const request = yield* Schema.decodeUnknownEffect(StopSearchRequest)(input).pipe(
      Effect.mapError((error) => invalid(`Invalid stop search: ${String(error)}`)),
    );
    const normalized = request.query?.trim().toLocaleLowerCase("id-ID") ?? "";
    if (
      request.reachableFromStopId !== undefined &&
      !index.stopsById.has(request.reachableFromStopId)
    )
      return yield* Effect.fail(invalid(`Unknown origin stop ${request.reachableFromStopId}`));
    if ((request.serviceDate === undefined) !== (request.departureSeconds === undefined))
      return yield* Effect.fail(
        invalid("Stop reachability requires both service date and departure time"),
      );
    const reachable =
      request.reachableFromStopId === undefined
        ? undefined
        : directlyReachableStopIds(
            index,
            yield* Cache.get(boardingOptions, request.reachableFromStopId),
            request.serviceDate,
            request.departureSeconds,
          );
    const originStationId =
      request.reachableFromStopId === undefined
        ? undefined
        : stationIdFor(index, request.reachableFromStopId);
    const grouped = new Map<
      StopId,
      StopSuggestion & { readonly distance: number; readonly matchRank: number }
    >();
    for (const stop of index.snapshot.stops) {
      const stationId = stationIdFor(index, stop.id);
      if (originStationId === stationId) continue;
      const station = index.stopsById.get(stationId) ?? stop;
      const stationName = station.name.toLocaleLowerCase("id-ID");
      const stopName = stop.name.toLocaleLowerCase("id-ID");
      if (normalized !== "" && !stationName.includes(normalized) && !stopName.includes(normalized))
        continue;
      if (
        reachable !== undefined &&
        !stationStopIds(index, stationId).some((candidate) => reachable.has(candidate))
      )
        continue;
      const coordinate = placedCoordinate(station) ?? placedCoordinate(stop);
      if (coordinate === undefined) continue;
      const matchRank =
        normalized === "" || stationName === normalized
          ? 0
          : stopName === normalized
            ? 1
            : stationName.startsWith(normalized)
              ? 2
              : stopName.startsWith(normalized)
                ? 3
                : 4;
      const candidate = {
        id: stationId,
        name: station.name,
        area: "Jakarta",
        coordinate,
        distance:
          request.coordinate === undefined ? 0 : distanceMeters(request.coordinate, coordinate),
        matchRank,
      };
      const existing = grouped.get(stationId);
      if (
        existing === undefined ||
        candidate.matchRank < existing.matchRank ||
        (candidate.matchRank === existing.matchRank && candidate.distance < existing.distance)
      )
        grouped.set(stationId, candidate);
    }
    const stops = [...grouped.values()]
      .sort(
        (left, right) =>
          left.matchRank - right.matchRank ||
          left.distance - right.distance ||
          left.name.localeCompare(right.name),
      )
      .slice(0, request.limit)
      .map(({ distance: _distance, matchRank: _matchRank, ...stop }) => stop);
    return { stops };
  });

  return Service.of({ journeys, searchStops });
});

export const layer = Layer.effect(Service, make);

export * as RouteQuery from "./route-query.js";
