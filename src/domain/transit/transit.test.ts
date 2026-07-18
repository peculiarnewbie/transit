import { Effect, Result, Schema } from "effect";
import { describe, expect } from "vitest";

import { itEffect } from "../../testing/effect.js";
import {
  AgencyId,
  RoutePattern,
  ServiceAvailability,
  ServiceDaySeconds,
  Stop,
  StopId,
} from "./index.js";

describe("canonical transit contracts", () => {
  itEffect(
    "decodes a non-empty branded agency id",
    Schema.decodeUnknownEffect(AgencyId)("gtfs:transjakarta").pipe(Effect.as(true)),
  );

  itEffect(
    "rejects an empty branded agency id",
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(AgencyId)("").pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  itEffect(
    "keeps route pattern stop order",
    Effect.gen(function* () {
      const pattern = yield* Schema.decodeUnknownEffect(RoutePattern)({
        id: "pattern:one",
        routeId: "route:one",
        sourceRefs: [],
        directionId: 0,
        stopIds: ["stop:c", "stop:a", "stop:b"],
      });
      expect(pattern.stopIds).toEqual(["stop:c", "stop:a", "stop:b"]);
    }),
  );

  itEffect(
    "rejects an empty route pattern",
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(RoutePattern)({
        id: "pattern:empty",
        routeId: "route:one",
        sourceRefs: [],
        stopIds: [],
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  itEffect(
    "represents unplaced stops explicitly",
    Effect.gen(function* () {
      const stop = yield* Schema.decodeUnknownEffect(Stop)({
        id: "stop:unknown",
        sourceRefs: [],
        name: "Unknown platform",
        location: { _tag: "Unplaced", reason: "Awaiting curation" },
      });
      expect(stop.location._tag).toBe("Unplaced");
    }),
  );

  itEffect(
    "validates placed coordinates",
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(Stop)({
        id: "stop:invalid",
        sourceRefs: [],
        name: "Invalid stop",
        location: { _tag: "Placed", latitude: -91, longitude: 106.8 },
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  itEffect(
    "preserves service-day times beyond midnight",
    Effect.gen(function* () {
      const seconds = yield* Schema.decodeUnknownEffect(ServiceDaySeconds)(25 * 60 * 60 + 10 * 60);
      expect(seconds).toBe(90_600);
    }),
  );

  itEffect(
    "decodes every service availability variant",
    Effect.gen(function* () {
      const stopId = yield* Schema.decodeUnknownEffect(StopId)("stop:one");
      const variants = [
        {
          _tag: "Scheduled",
          stopTimes: [
            {
              stopId,
              sequence: 1,
              arrivalSeconds: 0,
              departureSeconds: 0,
            },
          ],
          frequencyWindows: [],
        },
        {
          _tag: "FrequencyOnly",
          frequencyWindows: [
            {
              startSeconds: 0,
              endSeconds: 3_600,
              headwaySeconds: 600,
              exactTimes: false,
            },
          ],
        },
        { _tag: "TopologyOnly", reason: "No timetable published" },
      ];

      for (const variant of variants) {
        const availability = yield* Schema.decodeUnknownEffect(ServiceAvailability)(variant);
        const label = ServiceAvailability.match(availability, {
          Scheduled: () => "scheduled",
          FrequencyOnly: () => "frequency",
          TopologyOnly: () => "topology",
        });
        expect(label).toBeTypeOf("string");
      }
    }),
  );
});
