import { Effect, Result, Schema } from "effect";
import { describe, expect } from "vitest";

import { StopId } from "../domain/transit/index.js";
import { itEffect } from "../testing/effect.js";
import {
  InvalidConstraint,
  LineConstraint,
  NoRoute,
  RoutingQuery,
  RoutingResult,
  Router,
  RoutingIndex,
} from "./index.js";
import { networkFixture, queryFixture } from "./fixtures/network.js";

const route = (input: unknown, snapshot: unknown = networkFixture) =>
  Effect.gen(function* () {
    const router = yield* Router.Service;
    return yield* router.route(input);
  }).pipe(Effect.provide(Router.layer(snapshot)));

const cloneNetwork = () => structuredClone(networkFixture);
const first = <T>(values: ReadonlyArray<T>): T => {
  const value = values[0];
  if (value === undefined) throw new Error("Expected a non-empty test collection");
  return value;
};

describe("routing boundary schemas", () => {
  for (const constraint of [
    { _tag: "None" },
    { _tag: "Excluded", routeIds: ["route:fast"] },
    { _tag: "Preferred", routeIds: ["route:slow"], weight: 500 },
    { _tag: "Required", routeIds: ["route:fast"] },
    {
      _tag: "Locked",
      legs: [
        {
          fromStopId: "stop:A",
          toStopId: "stop:D",
          routeId: "route:fast",
          patternId: "pattern:fast",
          tripId: "trip:fast",
          departureSeconds: 28_800,
          arrivalSeconds: 30_000,
        },
      ],
    },
  ]) {
    itEffect(
      `round-trips the ${constraint._tag} constraint`,
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(LineConstraint)(constraint);
        const encoded = yield* Schema.encodeEffect(LineConstraint)(decoded);
        expect(encoded).toEqual(constraint);
      }),
    );
  }

  itEffect(
    "round-trips a routing query and result",
    Effect.gen(function* () {
      const query = yield* Schema.decodeUnknownEffect(RoutingQuery)(queryFixture());
      const result = yield* route(query);
      const encoded = yield* Schema.encodeEffect(RoutingResult)(result);
      const decoded = yield* Schema.decodeUnknownEffect(RoutingResult)(encoded);
      expect(decoded).toEqual(result);
    }),
  );

  itEffect(
    "classifies malformed query input as InvalidConstraint",
    Effect.gen(function* () {
      const result = yield* route(queryFixture({ maximumTransfers: -1 })).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(InvalidConstraint);
    }),
  );
});

describe("validated routing index", () => {
  itEffect(
    "acquires a valid index once for repeated service access",
    Effect.gen(function* () {
      const indexFirst = yield* RoutingIndex.Service;
      const indexSecond = yield* RoutingIndex.Service;
      expect(indexFirst).toBe(indexSecond);
      expect(
        indexFirst.patternsByStop.get(
          first(Schema.decodeUnknownSync(RoutingQuery)(queryFixture()).origins).stopId,
        ),
      ).toHaveLength(4);
    }).pipe(Effect.provide(RoutingIndex.layer(networkFixture))),
  );

  itEffect(
    "rejects a dangling pattern stop during acquisition",
    Effect.gen(function* () {
      const snapshot = cloneNetwork();
      const pattern = snapshot.patterns[0];
      if (pattern !== undefined)
        snapshot.patterns[0] = {
          ...pattern,
          stopIds: ["stop:missing", ...pattern.stopIds.slice(1)],
        };
      const result = yield* Effect.gen(function* () {
        return yield* RoutingIndex.Service;
      }).pipe(Effect.provide(RoutingIndex.layer(snapshot)), Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  itEffect(
    "indexes child platforms by their parent station",
    Effect.gen(function* () {
      const snapshot = cloneNetwork();
      const parent = first(snapshot.stops);
      const platformId = StopId.make("stop:A:platform");
      const input = {
        ...snapshot,
        stops: [...snapshot.stops, { ...parent, id: platformId, parentStopId: parent.id }],
      };
      const index = yield* RoutingIndex.make(input);
      expect(index.childStopIdsByParent.get(StopId.make(parent.id))).toEqual([platformId]);
    }),
  );

  itEffect(
    "rejects trip stop times that disagree with pattern order",
    Effect.gen(function* () {
      const snapshot = cloneNetwork();
      const trip = first(snapshot.trips);
      const stopTime = first(trip.availability.stopTimes);
      stopTime.stopId = "stop:C";
      const result = yield* Effect.gen(function* () {
        return yield* RoutingIndex.Service;
      }).pipe(Effect.provide(RoutingIndex.layer(snapshot)), Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  itEffect(
    "rejects duplicate canonical ids",
    Effect.gen(function* () {
      const snapshot = cloneNetwork();
      snapshot.stops.push(structuredClone(first(snapshot.stops)));
      const result = yield* Effect.gen(function* () {
        return yield* RoutingIndex.Service;
      }).pipe(Effect.provide(RoutingIndex.layer(snapshot)), Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );
});

describe("routing behavior", () => {
  itEffect(
    "finds the deterministic fastest direct ride",
    Effect.gen(function* () {
      const result = yield* route(queryFixture());
      expect(first(result.itineraries).boardedRouteIds).toEqual(["route:fast"]);
      expect(first(result.itineraries).arrivalSeconds).toBe(30_000);
    }),
  );

  itEffect(
    "returns the best journey for each distinct route sequence",
    Effect.gen(function* () {
      const result = yield* route(queryFixture());
      const routeSequences = result.itineraries.map((itinerary) => itinerary.boardedRouteIds);
      expect(routeSequences).toContainEqual(["route:fast"]);
      expect(routeSequences).toContainEqual(["route:slow"]);
      expect(
        routeSequences.some((routeIds) =>
          routeIds.some((routeId, index) => index > 0 && routeId === routeIds[index - 1]),
        ),
      ).toBe(false);
    }),
  );

  itEffect(
    "finds a one-transfer journey",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({
          origins: [{ stopId: "stop:E", walkSeconds: 0 }],
          destinations: [{ stopId: "stop:F", walkSeconds: 0 }],
          departureSeconds: 28_400,
        }),
      );
      expect(first(result.itineraries).boardedRouteIds).toEqual([
        "route:feeder",
        "route:connector",
      ]);
      expect(first(result.itineraries).transferCount).toBe(1);
    }),
  );

  itEffect(
    "uses a parent-station transfer to reach a linked platform",
    Effect.gen(function* () {
      const base = cloneNetwork();
      const origin = first(base.stops.filter((stop) => stop.id === "stop:E"));
      const destination = first(base.stops.filter((stop) => stop.id === "stop:D"));
      const snapshot = {
        ...base,
        stops: [
          ...base.stops.map((stop) =>
            stop.id === origin.id ? { ...stop, parentStopId: "station:E" } : stop,
          ),
          { ...origin, id: "station:E" },
          { ...origin, id: "station:linked" },
          { ...origin, id: "stop:linked-platform", parentStopId: "station:linked" },
        ],
        patterns: [
          ...base.patterns,
          {
            id: "pattern:linked",
            routeId: "route:fast",
            sourceRefs: [],
            stopIds: ["stop:linked-platform", destination.id],
          },
        ],
        trips: [
          ...base.trips,
          {
            id: "trip:linked",
            patternId: "pattern:linked",
            serviceId: "service:weekday",
            sourceRefs: [],
            availability: {
              _tag: "Scheduled",
              stopTimes: [
                {
                  stopId: "stop:linked-platform",
                  sequence: 0,
                  arrivalSeconds: 28_800,
                  departureSeconds: 28_800,
                },
                {
                  stopId: destination.id,
                  sequence: 1,
                  arrivalSeconds: 30_000,
                  departureSeconds: 30_000,
                },
              ],
              frequencyWindows: [],
            },
          },
        ],
        transfers: [
          ...base.transfers,
          {
            fromStopId: "station:E",
            toStopId: "station:linked",
            sourceRefs: [],
            kind: "Recommended",
          },
        ],
      };
      const result = yield* route(
        queryFixture({
          origins: [{ stopId: origin.id, walkSeconds: 0 }],
          maximumTransfers: 0,
          lineConstraint: { _tag: "Required", routeIds: ["route:fast"] },
        }),
        snapshot,
      );
      expect(first(result.itineraries).boardedRouteIds).toEqual(["route:fast"]);
      expect(first(result.itineraries).legs).toContainEqual(
        expect.objectContaining({
          _tag: "Walk",
          from: { _tag: "Stop", stopId: "station:E" },
          to: { _tag: "Stop", stopId: "station:linked" },
        }),
      );
    }),
  );

  itEffect(
    "does not board a missed connection",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({
          origins: [{ stopId: "stop:E", walkSeconds: 0 }],
          destinations: [{ stopId: "stop:F", walkSeconds: 0 }],
          departureSeconds: 28_600,
        }),
      ).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(NoRoute);
    }),
  );

  itEffect(
    "routes service times beyond midnight on the service date",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({
          destinations: [{ stopId: "stop:G", walkSeconds: 0 }],
          departureSeconds: 89_900,
        }),
      );
      expect(first(result.itineraries).arrivalSeconds).toBe(91_200);
    }),
  );

  itEffect(
    "uses the next scheduled frequency departure",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({
          origins: [{ stopId: "stop:C", walkSeconds: 0 }],
          destinations: [{ stopId: "stop:G", walkSeconds: 0 }],
          departureSeconds: 29_001,
        }),
      );
      const transit = first(result.itineraries).legs.find((leg) => leg._tag === "Transit");
      expect(transit?._tag === "Transit" ? transit.departureSeconds : -1).toBe(29_400);
      expect(first(result.itineraries).arrivalSeconds).toBe(30_000);
    }),
  );

  itEffect(
    "honors a removed service-calendar exception",
    Effect.gen(function* () {
      const result = yield* route(queryFixture({ serviceDate: "2026-07-20" })).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  itEffect(
    "honors an added service-calendar exception",
    Effect.gen(function* () {
      const result = yield* route(queryFixture({ serviceDate: "2026-07-19" }));
      expect(first(result.itineraries).boardedRouteIds).toEqual(["route:fast"]);
    }),
  );

  itEffect(
    "enforces the maximum transfer count",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({
          origins: [{ stopId: "stop:E", walkSeconds: 0 }],
          destinations: [{ stopId: "stop:F", walkSeconds: 0 }],
          maximumTransfers: 0,
        }),
      ).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  itEffect(
    "excludes the fastest line and returns a slower alternative",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({ lineConstraint: { _tag: "Excluded", routeIds: ["route:fast"] } }),
      );
      expect(first(result.itineraries).boardedRouteIds).toEqual(["route:slow"]);
    }),
  );

  itEffect(
    "uses preference weight in alternative scoring",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({
          lineConstraint: { _tag: "Preferred", routeIds: ["route:slow"], weight: 5_000 },
        }),
      );
      expect(first(result.itineraries).boardedRouteIds).toEqual(["route:slow"]);
      expect(first(result.itineraries).score.preferencePenalty).toBe(0);
    }),
  );

  itEffect(
    "requires a reachable route",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({ lineConstraint: { _tag: "Required", routeIds: ["route:slow"] } }),
      );
      expect(first(result.itineraries).boardedRouteIds).toContain("route:slow");
    }),
  );

  itEffect(
    "returns NoRoute for an impossible required route",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({ lineConstraint: { _tag: "Required", routeIds: ["route:connector"] } }),
      ).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(NoRoute);
    }),
  );

  itEffect(
    "preserves a locked transit leg exactly",
    Effect.gen(function* () {
      const locked = {
        fromStopId: "stop:A",
        toStopId: "stop:D",
        routeId: "route:fast",
        patternId: "pattern:fast",
        tripId: "trip:fast",
        departureSeconds: 28_800,
        arrivalSeconds: 30_000,
      };
      const result = yield* route(
        queryFixture({ lineConstraint: { _tag: "Locked", legs: [locked] } }),
      );
      const transit = first(result.itineraries).legs.find((leg) => leg._tag === "Transit");
      expect(transit).toMatchObject(locked);
    }),
  );

  itEffect(
    "rejects a locked leg with substituted times",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({
          lineConstraint: {
            _tag: "Locked",
            legs: [
              {
                fromStopId: "stop:A",
                toStopId: "stop:D",
                routeId: "route:fast",
                patternId: "pattern:fast",
                tripId: "trip:fast",
                departureSeconds: 28_801,
                arrivalSeconds: 30_001,
              },
            ],
          },
        }),
      ).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(InvalidConstraint);
    }),
  );

  itEffect(
    "bounds access walking",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({
          origins: [{ stopId: "stop:A", walkSeconds: 601 }],
          maximumAccessWalkSeconds: 600,
        }),
      ).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  itEffect(
    "bounds explicit transfer walking",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({
          origins: [{ stopId: "stop:B", walkSeconds: 0 }],
          destinations: [{ stopId: "stop:G", walkSeconds: 0 }],
          departureSeconds: 29_500,
          maximumTransferWalkSeconds: 119,
          lineConstraint: { _tag: "Excluded", routeIds: ["route:overnight"] },
        }),
      ).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  itEffect(
    "routes through a circular pattern without confusing repeated stops",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({
          destinations: [{ stopId: "stop:A", walkSeconds: 0 }],
          departureSeconds: 32_300,
        }),
      );
      expect(first(result.itineraries).boardedRouteIds).toEqual(["route:loop"]);
      expect(first(result.itineraries).arrivalSeconds).toBe(33_300);
    }),
  );

  itEffect(
    "routes from the middle of a branch pattern",
    Effect.gen(function* () {
      const result = yield* route(
        queryFixture({
          origins: [{ stopId: "stop:C", walkSeconds: 0 }],
          departureSeconds: 29_650,
        }),
      );
      expect(first(result.itineraries).boardedRouteIds).toEqual(["route:slow"]);
    }),
  );

  itEffect(
    "deduplicates duplicate pattern variants by boarded route sequence",
    Effect.gen(function* () {
      const snapshot = cloneNetwork();
      snapshot.patterns.push({
        id: "pattern:fast-variant",
        routeId: "route:fast",
        sourceRefs: [],
        stopIds: ["stop:A", "stop:D"],
      });
      snapshot.trips.push({
        id: "trip:fast-variant",
        patternId: "pattern:fast-variant",
        serviceId: "service:weekday",
        sourceRefs: [],
        availability: {
          _tag: "Scheduled",
          stopTimes: [
            { stopId: "stop:A", sequence: 0, arrivalSeconds: 28_900, departureSeconds: 28_900 },
            { stopId: "stop:D", sequence: 1, arrivalSeconds: 30_100, departureSeconds: 30_100 },
          ],
          frequencyWindows: [],
        },
      });
      const result = yield* route(queryFixture(), snapshot);
      expect(
        result.itineraries.filter(
          (item) => item.boardedRouteIds.length === 1 && item.boardedRouteIds[0] === "route:fast",
        ),
      ).toHaveLength(1);
    }),
  );
});
