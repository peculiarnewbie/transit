import { Context, Effect, Layer, Schema } from "effect";

import { ServiceDaySeconds, type StopId } from "../domain/transit/index.js";
import {
  InvalidConstraint,
  type Itinerary,
  type LockedTransitLeg,
  NoRoute,
  type RoutingError,
  type RoutingLeg,
  RoutingPoint,
  RoutingQuery,
  RoutingResult,
  TransitLeg,
  WalkLeg,
} from "./model.js";
import { RoutingIndex } from "./network-index.js";
import { isServiceActive, search } from "./search.js";

export interface Interface {
  readonly route: (input: unknown) => Effect.Effect<RoutingResult, RoutingError>;
}

export class Service extends Context.Service<Service, Interface>()("@transit/Router") {}

const invalid = (reason: string) => new InvalidConstraint({ reason });

const validateLockedLegs = Effect.fn("Router.validateLockedLegs")(function* (
  index: RoutingIndex.Interface,
  legs: ReadonlyArray<LockedTransitLeg>,
  serviceDate: string,
) {
  for (let position = 0; position < legs.length; position += 1) {
    const leg = legs[position];
    if (leg === undefined) continue;
    if (leg.arrivalSeconds < leg.departureSeconds)
      return yield* Effect.fail(invalid(`Locked leg ${position} arrives before it departs`));
    const pattern = index.snapshot.patterns.find((candidate) => candidate.id === leg.patternId);
    const trip = index.snapshot.trips.find((candidate) => candidate.id === leg.tripId);
    if (pattern === undefined || trip === undefined)
      return yield* Effect.fail(
        invalid(`Locked leg ${position} references a missing trip or pattern`),
      );
    const calendar = index.calendarsById.get(trip.serviceId);
    if (calendar === undefined || !isServiceActive(calendar, serviceDate))
      return yield* Effect.fail(invalid(`Locked leg ${position} does not run on the service date`));
    if (pattern.routeId !== leg.routeId || trip.patternId !== pattern.id)
      return yield* Effect.fail(
        invalid(`Locked leg ${position} has inconsistent route references`),
      );
    const fromIndex = pattern.stopIds.indexOf(leg.fromStopId);
    const toIndex = pattern.stopIds.indexOf(leg.toStopId);
    if (fromIndex < 0 || toIndex <= fromIndex)
      return yield* Effect.fail(invalid(`Locked leg ${position} does not follow its pattern`));
    if (trip.availability._tag !== "Scheduled")
      return yield* Effect.fail(invalid(`Locked leg ${position} has no verifiable stop times`));
    const fromTime = trip.availability.stopTimes[fromIndex];
    const toTime = trip.availability.stopTimes[toIndex];
    if (fromTime === undefined || toTime === undefined)
      return yield* Effect.fail(invalid(`Locked leg ${position} has incomplete stop times`));
    const departureShift = leg.departureSeconds - fromTime.departureSeconds;
    const arrivalShift = leg.arrivalSeconds - toTime.arrivalSeconds;
    if (departureShift !== arrivalShift)
      return yield* Effect.fail(invalid(`Locked leg ${position} times do not match the trip`));
    if (trip.availability.frequencyWindows.length === 0 && departureShift !== 0)
      return yield* Effect.fail(invalid(`Locked leg ${position} changes a scheduled trip time`));
    if (trip.availability.frequencyWindows.length > 0) {
      const first = trip.availability.stopTimes[0];
      const runStart = first === undefined ? -1 : first.departureSeconds + departureShift;
      const matchesWindow = trip.availability.frequencyWindows.some(
        (window) =>
          runStart >= window.startSeconds &&
          runStart < window.endSeconds &&
          (runStart - window.startSeconds) % window.headwaySeconds === 0,
      );
      if (!matchesWindow)
        return yield* Effect.fail(invalid(`Locked leg ${position} is not a frequency departure`));
    }
    const previous = legs[position - 1];
    if (
      previous !== undefined &&
      (previous.toStopId !== leg.fromStopId || previous.arrivalSeconds > leg.departureSeconds)
    )
      return yield* Effect.fail(invalid("Locked legs must be ordered and contiguous"));
  }
});

const directAccess = (
  query: RoutingQuery,
  stopId: StopId,
): ReadonlyArray<Pick<Itinerary, "legs" | "boardedRouteIds" | "walkingSeconds">> =>
  query.origins
    .filter(
      (candidate) =>
        candidate.stopId === stopId &&
        candidate.walkSeconds <= query.maximumAccessWalkSeconds &&
        query.departureSeconds + candidate.walkSeconds <= 604_800,
    )
    .map((candidate) => ({
      legs: [
        WalkLeg.make({
          from: RoutingPoint.cases.Origin.make({}),
          to: RoutingPoint.cases.Stop.make({ stopId }),
          departureSeconds: query.departureSeconds,
          arrivalSeconds: ServiceDaySeconds.make(query.departureSeconds + candidate.walkSeconds),
          durationSeconds: candidate.walkSeconds,
        }),
      ],
      boardedRouteIds: [],
      walkingSeconds: candidate.walkSeconds,
    }));

const directEgress = (
  query: RoutingQuery,
  stopId: StopId,
): ReadonlyArray<
  Pick<Itinerary, "legs" | "boardedRouteIds" | "walkingSeconds" | "arrivalSeconds">
> =>
  query.destinations
    .filter(
      (candidate) =>
        candidate.stopId === stopId &&
        candidate.walkSeconds <= query.maximumAccessWalkSeconds &&
        query.departureSeconds + candidate.walkSeconds <= 604_800,
    )
    .map((candidate) => ({
      legs: [
        WalkLeg.make({
          from: RoutingPoint.cases.Stop.make({ stopId }),
          to: RoutingPoint.cases.Destination.make({}),
          departureSeconds: query.departureSeconds,
          arrivalSeconds: ServiceDaySeconds.make(query.departureSeconds + candidate.walkSeconds),
          durationSeconds: candidate.walkSeconds,
        }),
      ],
      boardedRouteIds: [],
      walkingSeconds: candidate.walkSeconds,
      arrivalSeconds: ServiceDaySeconds.make(query.departureSeconds + candidate.walkSeconds),
    }));

const stripTerminalWalk = (legs: ReadonlyArray<RoutingLeg>): ReadonlyArray<RoutingLeg> =>
  legs.slice(0, -1);
const stripInitialWalk = (legs: ReadonlyArray<RoutingLeg>): ReadonlyArray<RoutingLeg> =>
  legs.slice(1);

const routeLocked = Effect.fn("Router.routeLocked")(function* (
  index: RoutingIndex.Interface,
  query: RoutingQuery,
  locked: ReadonlyArray<LockedTransitLeg>,
) {
  yield* validateLockedLegs(index, locked, query.serviceDate);
  const first = locked[0];
  const last = locked[locked.length - 1];
  if (first === undefined || last === undefined)
    return yield* Effect.fail(invalid("At least one locked leg is required"));

  const none = { _tag: "None" } as const;
  const prefixQuery = RoutingQuery.make({
    ...query,
    destinations: [{ stopId: first.fromStopId, walkSeconds: 0 }],
    maximumResults: Math.min(query.maximumResults, 4),
    lineConstraint: none,
  });
  const suffixQuery = RoutingQuery.make({
    ...query,
    origins: [{ stopId: last.toStopId, walkSeconds: 0 }],
    departureSeconds: last.arrivalSeconds,
    maximumResults: Math.min(query.maximumResults, 4),
    lineConstraint: none,
  });

  const prefixSearch = search(index, prefixQuery, none)
    .filter((itinerary) => itinerary.arrivalSeconds <= first.departureSeconds)
    .map((itinerary) => ({
      legs: stripTerminalWalk(itinerary.legs),
      boardedRouteIds: itinerary.boardedRouteIds,
      walkingSeconds: itinerary.walkingSeconds,
    }));
  const suffixSearch = search(index, suffixQuery, none).map((itinerary) => ({
    legs: stripInitialWalk(itinerary.legs),
    boardedRouteIds: itinerary.boardedRouteIds,
    walkingSeconds: itinerary.walkingSeconds,
    arrivalSeconds: itinerary.arrivalSeconds,
  }));
  const prefixes = [
    ...directAccess(query, first.fromStopId).filter((prefix) => {
      const access = prefix.legs[0];
      return access !== undefined && access.arrivalSeconds <= first.departureSeconds;
    }),
    ...prefixSearch,
  ];
  const suffixes = [...directEgress(suffixQuery, last.toStopId), ...suffixSearch];
  const lockedTransit = locked.map((leg) =>
    TransitLeg.make({
      ...leg,
      ...(leg.geometryId === undefined ? {} : { geometryId: leg.geometryId }),
    }),
  );

  const itineraries: Array<Itinerary> = [];
  for (const prefix of prefixes) {
    for (const suffix of suffixes) {
      const routeIds = [
        ...prefix.boardedRouteIds,
        ...locked.map((leg) => leg.routeId),
        ...suffix.boardedRouteIds,
      ];
      const legs = [...prefix.legs, ...lockedTransit, ...suffix.legs];
      const walkingSeconds = prefix.walkingSeconds + suffix.walkingSeconds;
      const transferCount = Math.max(0, routeIds.length - 1);
      if (transferCount > query.maximumTransfers) continue;
      itineraries.push({
        legs,
        boardedRouteIds: routeIds,
        departureSeconds: query.departureSeconds,
        arrivalSeconds: suffix.arrivalSeconds,
        transferCount,
        walkingSeconds,
        score: {
          arrivalSeconds: suffix.arrivalSeconds,
          transferCount,
          walkingSeconds,
          preferencePenalty: 0,
          total: suffix.arrivalSeconds + transferCount * 900 + walkingSeconds * 2,
        },
      });
    }
  }
  return itineraries
    .sort((left, right) => left.score.total - right.score.total)
    .slice(0, query.maximumResults);
});

export const make = Effect.gen(function* () {
  const index = yield* RoutingIndex.Service;
  const route = Effect.fn("Router.route")(function* (input: unknown) {
    const query = yield* Schema.decodeUnknownEffect(RoutingQuery)(input).pipe(
      Effect.mapError((error) => invalid(`Invalid routing query: ${String(error)}`)),
    );
    const itineraries =
      query.lineConstraint._tag === "Locked"
        ? yield* routeLocked(index, query, query.lineConstraint.legs)
        : search(index, query);
    if (itineraries.length === 0)
      return yield* Effect.fail(new NoRoute({ reason: "No itinerary satisfies the query" }));
    return RoutingResult.make({ itineraries });
  });
  return Service.of({ route });
});

export const layer = (snapshot: unknown) =>
  Layer.effect(Service, make).pipe(Layer.provide(RoutingIndex.layer(snapshot)));

export * as Router from "./router.js";
