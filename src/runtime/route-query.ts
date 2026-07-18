import { Context, Effect, Layer, Schema } from "effect";

import type { GeometryId, Route, Stop, StopId } from "../domain/transit/index.js";
import {
  type Itinerary,
  type LineConstraint as RoutingLineConstraint,
  type RoutingLeg,
  type RoutingError,
  Router,
  RoutingIndex,
} from "../routing/index.js";
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

const endpointCandidates = Effect.fn("RouteQuery.endpointCandidates")(function* (
  index: RoutingIndex.Interface,
  endpoint: JourneyRequest["origin"],
) {
  if (endpoint._tag === "Stop") {
    if (!index.stopsById.has(endpoint.stopId))
      return yield* Effect.fail(invalid(`Unknown stop ${endpoint.stopId}`));
    return [{ stopId: endpoint.stopId, walkSeconds: 0 }];
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

const joinGeometry = (
  geometryById: ReadonlyMap<GeometryId, ReadonlyArray<readonly [number, number]>>,
  itinerary: Itinerary,
) => {
  const coordinates: Array<readonly [number, number]> = [];
  for (const leg of itinerary.legs) {
    if (leg._tag !== "Transit" || leg.geometryId === undefined) continue;
    const segment = geometryById.get(leg.geometryId) ?? [];
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
    geometry: joinGeometry(geometryById, itinerary),
  };
};

export const make = Effect.gen(function* () {
  const artifacts = yield* ArtifactStore.Service;
  const index = yield* RoutingIndex.Service;
  const router = yield* Router.Service;
  const geometryById = new Map(
    artifacts.geometry.geometries.map((geometry) => [geometry.id, geometry.coordinates]),
  );

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
    const stops = index.snapshot.stops
      .flatMap((stop): ReadonlyArray<StopSuggestion & { readonly distance: number }> => {
        const coordinate = placedCoordinate(stop);
        if (coordinate === undefined || !stop.name.toLocaleLowerCase("id-ID").includes(normalized))
          return [];
        const parentName =
          stop.parentStopId === undefined
            ? undefined
            : index.stopsById.get(stop.parentStopId)?.name;
        return [
          {
            id: stop.id,
            name: stop.name,
            area: parentName ?? "Jakarta",
            coordinate,
            distance:
              request.coordinate === undefined ? 0 : distanceMeters(request.coordinate, coordinate),
          },
        ];
      })
      .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
      .slice(0, request.limit)
      .map(({ distance: _distance, ...stop }) => stop);
    return { stops };
  });

  return Service.of({ journeys, searchStops });
});

export const layer = Layer.effect(Service, make);

export * as RouteQuery from "./route-query.js";
