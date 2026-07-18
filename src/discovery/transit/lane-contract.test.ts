import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";

import { itEffect } from "../../testing/effect.js";
import {
  DirectionEvidenceReport,
  PatternDirectionEvidence,
  TransitPlace,
  TransitPlaceIndex,
} from "./index.js";

describe("lane contracts for plans 014 and 015", () => {
  itEffect(
    "exports TransitPlace shape for place discovery",
    Effect.gen(function* () {
      const place = yield* Schema.decodeUnknownEffect(TransitPlace)({
        id: "place:standalone:stop:a",
        primaryName: "Alpha",
        aliases: ["A"],
        representativeLocation: { _tag: "Placed", latitude: -6.2, longitude: 106.8 },
        memberStopIds: ["stop:a"],
        servedRouteIds: ["route:1"],
        sourceRefs: [],
        groupingEvidence: { _tag: "Standalone" },
      });
      expect(place.memberStopIds).toEqual(["stop:a"]);
      expect(place.servedRouteIds).toEqual(["route:1"]);
    }),
  );

  itEffect(
    "exports TransitPlaceIndex lookup maps",
    Effect.gen(function* () {
      const index = yield* Schema.decodeUnknownEffect(TransitPlaceIndex)({
        schemaVersion: "1",
        sourceArtifactVersion: "fixture-v1",
        placesById: {
          "place:standalone:stop:a": {
            id: "place:standalone:stop:a",
            primaryName: "Alpha",
            aliases: [],
            representativeLocation: { _tag: "Placed", latitude: -6.2, longitude: 106.8 },
            memberStopIds: ["stop:a"],
            servedRouteIds: [],
            sourceRefs: [],
            groupingEvidence: { _tag: "Standalone" },
          },
        },
        placeIdByStopId: { "stop:a": "place:standalone:stop:a" },
        unresolvedFindings: [],
      });
      expect(index.placeIdByStopId["stop:a"]).toBe("place:standalone:stop:a");
    }),
  );

  itEffect(
    "exports direction evidence for route guidance",
    Effect.gen(function* () {
      const evidence = yield* Schema.decodeUnknownEffect(PatternDirectionEvidence)({
        patternId: "pattern:1",
        routeId: "route:1",
        candidates: [{ _tag: "TripHeadsign", headsign: "Kota", tripCount: 2 }],
        classification: "StableTripHeadsign",
      });
      const report = yield* Schema.decodeUnknownEffect(DirectionEvidenceReport)({
        schemaVersion: "1",
        sourceArtifactVersion: "fixture-v1",
        patterns: [evidence],
        counts: {
          stableTripHeadsign: 1,
          conflictingTripHeadsigns: 0,
          stopHeadsignOnly: 0,
          finalStopFallback: 0,
          absent: 0,
        },
      });
      expect(report.patterns[0]?.classification).toBe("StableTripHeadsign");
    }),
  );
});
