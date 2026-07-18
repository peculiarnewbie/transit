import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";

import { itEffect } from "../testing/effect.js";
import {
  FORBIDDEN_TIMETABLE_FIELD_NAMES,
  GuideAlternative,
  InterchangeableRideStep,
  RouteGuideQuery,
  RouteGuideResult,
} from "./model.js";

const validQuery = {
  origins: [{ transitPlaceId: "place:standalone:stop:A" }],
  destinations: [{ transitPlaceId: "place:standalone:stop:D" }],
  maximumTransfers: 2,
  maximumOriginCandidates: 8,
  maximumDestinationCandidates: 8,
  maximumAlternatives: 4,
  maximumExpandedStates: 10_000,
};

const validLineOption = {
  routeId: "route:1",
  passengerLineName: "1",
  patternId: "pattern:1",
  directionLabel: "Delta",
  directionLabelAuthority: "Authoritative",
  directionEvidenceClassification: "StableTripHeadsign",
  intermediatePlaces: [
    { transitPlaceId: "place:standalone:stop:B", placeName: "Bravo" },
    { transitPlaceId: "place:standalone:stop:C", placeName: "Charlie" },
  ],
};

const validAlternative = {
  id: "guide:test",
  origin: {
    transitPlaceId: "place:standalone:stop:A",
    placeName: "Alpha",
    member: { stopId: "stop:A", stopName: "Alpha" },
  },
  destination: {
    transitPlaceId: "place:standalone:stop:D",
    placeName: "Delta",
    member: { stopId: "stop:D", stopName: "Delta" },
  },
  rideSteps: [
    {
      lineOptions: [validLineOption],
      boarding: {
        transitPlaceId: "place:standalone:stop:A",
        placeName: "Alpha",
        member: { stopId: "stop:A", stopName: "Alpha" },
      },
      alighting: {
        transitPlaceId: "place:standalone:stop:D",
        placeName: "Delta",
        member: { stopId: "stop:D", stopName: "Delta" },
      },
    },
  ],
  transfers: [],
  metrics: {
    transferCount: 0,
    boardingCount: 1,
    intermediateStopCount: 2,
    directionAmbiguityCount: 0,
    routeComplexity: 1,
    transferHubPenalty: 0,
    variantLinePenalty: 0,
  },
};

describe("route-guide contract", () => {
  itEffect(
    "accepts a time-independent query",
    Effect.gen(function* () {
      const query = yield* Schema.decodeUnknownEffect(RouteGuideQuery)(validQuery);
      expect(query.origins).toHaveLength(1);
      expect(query.destinations).toHaveLength(1);
    }),
  );

  itEffect(
    "rejects empty candidate sets",
    Effect.gen(function* () {
      const emptyOrigins = yield* Schema.decodeUnknownEffect(RouteGuideQuery)({
        ...validQuery,
        origins: [],
      }).pipe(Effect.result);
      const emptyDestinations = yield* Schema.decodeUnknownEffect(RouteGuideQuery)({
        ...validQuery,
        destinations: [],
      }).pipe(Effect.result);
      expect(emptyOrigins._tag).toBe("Failure");
      expect(emptyDestinations._tag).toBe("Failure");
    }),
  );

  itEffect(
    "rejects missing direction labels on line options",
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(InterchangeableRideStep)({
        lineOptions: [
          {
            ...validLineOption,
            directionLabel: "",
          },
        ],
        boarding: validAlternative.rideSteps[0]!.boarding,
        alighting: validAlternative.rideSteps[0]!.alighting,
      }).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
    }),
  );

  itEffect(
    "rejects unordered intermediate stops that omit required place fields",
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(InterchangeableRideStep)({
        lineOptions: [
          {
            ...validLineOption,
            intermediatePlaces: [{ placeName: "Bravo" }],
          },
        ],
        boarding: validAlternative.rideSteps[0]!.boarding,
        alighting: validAlternative.rideSteps[0]!.alighting,
      }).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
    }),
  );

  itEffect(
    "rejects inconsistent leg boundaries without boarding place",
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(GuideAlternative)({
        ...validAlternative,
        rideSteps: [
          {
            lineOptions: [validLineOption],
            boarding: { placeName: "Alpha" },
            alighting: validAlternative.rideSteps[0]!.alighting,
          },
        ],
      }).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
    }),
  );

  itEffect(
    "rejects any timetable field on the query shape",
    Effect.gen(function* () {
      for (const field of FORBIDDEN_TIMETABLE_FIELD_NAMES) {
        const result = yield* Schema.decodeUnknownEffect(RouteGuideQuery)({
          ...validQuery,
          [field]: 1,
        });
        expect(Object.hasOwn(result, field)).toBe(false);
      }
    }),
  );

  itEffect(
    "decodes GuidesFound and NoTopologicalRoute results",
    Effect.gen(function* () {
      const found = yield* Schema.decodeUnknownEffect(RouteGuideResult)({
        _tag: "GuidesFound",
        alternatives: [validAlternative],
      });
      const none = yield* Schema.decodeUnknownEffect(RouteGuideResult)({
        _tag: "NoTopologicalRoute",
        originPlaceIds: ["place:standalone:stop:A"],
        destinationPlaceIds: ["place:standalone:stop:D"],
        reason: "No path",
      });
      expect(found._tag).toBe("GuidesFound");
      expect(none._tag).toBe("NoTopologicalRoute");
    }),
  );
});
