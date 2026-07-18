import { Context, Effect, Layer, Schema } from "effect";

import {
  NetworkSnapshot,
  type RoutePattern,
  type RoutePatternId,
  type ServiceCalendar,
  type ServiceId,
  type Stop,
  type StopId,
  type Transfer,
  type Trip,
} from "../domain/transit/index.js";
import { MalformedNetwork } from "./model.js";

export interface Interface {
  readonly snapshot: NetworkSnapshot;
  readonly stopsById: ReadonlyMap<StopId, Stop>;
  readonly childStopIdsByParent: ReadonlyMap<StopId, ReadonlyArray<StopId>>;
  readonly patternsByStop: ReadonlyMap<StopId, ReadonlyArray<RoutePattern>>;
  readonly tripsByPattern: ReadonlyMap<RoutePatternId, ReadonlyArray<Trip>>;
  readonly transfersByStop: ReadonlyMap<StopId, ReadonlyArray<Transfer>>;
  readonly calendarsById: ReadonlyMap<ServiceId, ServiceCalendar>;
}

export class Service extends Context.Service<Service, Interface>()("@transit/RoutingIndex") {}

const malformed = (reason: string) => new MalformedNetwork({ reason });

const pushMap = <K, V>(map: Map<K, Array<V>>, key: K, value: V): void => {
  const values = map.get(key);
  if (values === undefined) map.set(key, [value]);
  else values.push(value);
};

export const make = Effect.fn("RoutingIndex.make")(function* (input: unknown) {
  const snapshot = yield* Schema.decodeUnknownEffect(NetworkSnapshot)(input).pipe(
    Effect.mapError((error) => malformed(`Snapshot decoding failed: ${String(error)}`)),
  );
  const stopIds = new Set(snapshot.stops.map((stop) => stop.id));
  const agencyIds = new Set(snapshot.agencies.map((agency) => agency.id));
  const routeIds = new Set(snapshot.routes.map((route) => route.id));
  const patternIds = new Set(snapshot.patterns.map((pattern) => pattern.id));
  const tripIds = new Set(snapshot.trips.map((trip) => trip.id));
  const serviceIds = new Set(snapshot.calendars.map((calendar) => calendar.id));
  const stopsById = new Map(snapshot.stops.map((stop) => [stop.id, stop]));
  const childStopIdsByParent = new Map<StopId, Array<StopId>>();
  const patternsByStop = new Map<StopId, Array<RoutePattern>>();
  const tripsByPattern = new Map<RoutePatternId, Array<Trip>>();
  const transfersByStop = new Map<StopId, Array<Transfer>>();

  if (stopIds.size !== snapshot.stops.length)
    return yield* Effect.fail(malformed("Duplicate stop id"));
  if (agencyIds.size !== snapshot.agencies.length)
    return yield* Effect.fail(malformed("Duplicate agency id"));
  if (routeIds.size !== snapshot.routes.length)
    return yield* Effect.fail(malformed("Duplicate route id"));
  if (patternIds.size !== snapshot.patterns.length)
    return yield* Effect.fail(malformed("Duplicate pattern id"));
  if (tripIds.size !== snapshot.trips.length)
    return yield* Effect.fail(malformed("Duplicate trip id"));
  if (serviceIds.size !== snapshot.calendars.length)
    return yield* Effect.fail(malformed("Duplicate service id"));

  for (const stop of snapshot.stops) {
    if (stop.parentStopId !== undefined && !stopIds.has(stop.parentStopId))
      return yield* Effect.fail(malformed(`Stop ${stop.id} references a missing parent stop`));
    if (stop.parentStopId !== undefined) pushMap(childStopIdsByParent, stop.parentStopId, stop.id);
  }
  for (const route of snapshot.routes) {
    if (!agencyIds.has(route.agencyId))
      return yield* Effect.fail(malformed(`Route ${route.id} references a missing agency`));
  }
  for (const calendar of snapshot.calendars) {
    if (calendar.endDate < calendar.startDate)
      return yield* Effect.fail(malformed(`Calendar ${calendar.id} ends before it starts`));
  }

  for (const pattern of snapshot.patterns) {
    if (!routeIds.has(pattern.routeId))
      return yield* Effect.fail(malformed(`Pattern ${pattern.id} references missing route`));
    for (const stopId of new Set(pattern.stopIds)) {
      if (!stopIds.has(stopId))
        return yield* Effect.fail(
          malformed(`Pattern ${pattern.id} references missing stop ${stopId}`),
        );
      pushMap(patternsByStop, stopId, pattern);
    }
  }

  for (const trip of snapshot.trips) {
    if (!patternIds.has(trip.patternId))
      return yield* Effect.fail(malformed(`Trip ${trip.id} references missing pattern`));
    if (!serviceIds.has(trip.serviceId))
      return yield* Effect.fail(malformed(`Trip ${trip.id} references missing calendar`));
    if (trip.availability._tag !== "TopologyOnly") {
      for (const window of trip.availability.frequencyWindows) {
        if (window.endSeconds <= window.startSeconds)
          return yield* Effect.fail(malformed(`Trip ${trip.id} has an invalid frequency window`));
      }
    }
    if (trip.availability._tag === "Scheduled") {
      const pattern = snapshot.patterns.find((candidate) => candidate.id === trip.patternId);
      if (pattern === undefined)
        return yield* Effect.fail(malformed(`Missing pattern ${trip.patternId}`));
      if (trip.availability.stopTimes.length !== pattern.stopIds.length)
        return yield* Effect.fail(malformed(`Trip ${trip.id} stop times do not match its pattern`));
      let previousSequence = -1;
      let previousDeparture = -1;
      for (let index = 0; index < trip.availability.stopTimes.length; index += 1) {
        const stopTime = trip.availability.stopTimes[index];
        if (stopTime === undefined || stopTime.stopId !== pattern.stopIds[index])
          return yield* Effect.fail(
            malformed(`Trip ${trip.id} stop order does not match its pattern`),
          );
        if (stopTime.sequence <= previousSequence || stopTime.arrivalSeconds < previousDeparture)
          return yield* Effect.fail(malformed(`Trip ${trip.id} has non-monotonic stop times`));
        if (stopTime.departureSeconds < stopTime.arrivalSeconds)
          return yield* Effect.fail(malformed(`Trip ${trip.id} departs before arriving`));
        previousSequence = stopTime.sequence;
        previousDeparture = stopTime.departureSeconds;
      }
    }
    pushMap(tripsByPattern, trip.patternId, trip);
  }

  for (const transfer of snapshot.transfers) {
    if (!stopIds.has(transfer.fromStopId) || !stopIds.has(transfer.toStopId))
      return yield* Effect.fail(malformed("Transfer references a missing stop"));
    if (transfer.kind !== "Forbidden") pushMap(transfersByStop, transfer.fromStopId, transfer);
  }

  const calendarsById = new Map(snapshot.calendars.map((calendar) => [calendar.id, calendar]));
  return Service.of({
    snapshot,
    stopsById,
    childStopIdsByParent,
    patternsByStop,
    tripsByPattern,
    transfersByStop,
    calendarsById,
  });
});

export const layer = (snapshot: unknown) => Layer.effect(Service, make(snapshot));

export * as RoutingIndex from "./network-index.js";
