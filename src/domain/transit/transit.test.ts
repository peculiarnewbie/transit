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
        locationKind: "Stop",
        wheelchairBoarding: "Unknown",
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
        locationKind: "Stop",
        wheelchairBoarding: "Unknown",
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
    "retains stop location kind, codes, and wheelchair evidence",
    Effect.gen(function* () {
      const stop = yield* Schema.decodeUnknownEffect(Stop)({
        id: "stop:platform",
        sourceRefs: [],
        name: "Platform 1",
        location: { _tag: "Placed", latitude: -6.2, longitude: 106.8 },
        locationKind: "Stop",
        stopCode: "P1",
        platformCode: "1",
        wheelchairBoarding: "Possible",
        parentStopId: "stop:station",
      });
      expect(stop.locationKind).toBe("Stop");
      expect(stop.platformCode).toBe("1");
      expect(stop.wheelchairBoarding).toBe("Possible");
      const encoded = yield* Schema.encodeEffect(Stop)(stop);
      const roundTrip = yield* Schema.decodeUnknownEffect(Stop)(encoded);
      expect(roundTrip).toEqual(stop);
    }),
  );

  itEffect(
    "keeps wheelchair unknown distinct from not-possible",
    Effect.gen(function* () {
      const unknown = yield* Schema.decodeUnknownEffect(Stop)({
        id: "stop:unknown",
        sourceRefs: [],
        name: "Unknown access",
        location: { _tag: "Unplaced", reason: "Awaiting curation" },
        locationKind: "Station",
        wheelchairBoarding: "Unknown",
      });
      expect(unknown.wheelchairBoarding).toBe("Unknown");
    }),
  );

  itEffect(
    "retains stop-time boarding policies and stop headsign",
    Effect.gen(function* () {
      const availability = yield* Schema.decodeUnknownEffect(ServiceAvailability)({
        _tag: "Scheduled",
        stopTimes: [
          {
            stopId: "stop:one",
            sequence: 1,
            arrivalSeconds: 0,
            departureSeconds: 0,
            pickupPolicy: "Forbidden",
            dropOffPolicy: "CoordinateWithDriver",
            stopHeadsign: "Toward Kota",
          },
        ],
        frequencyWindows: [],
      });
      expect(availability._tag).toBe("Scheduled");
      if (availability._tag === "Scheduled") {
        expect(availability.stopTimes[0]?.pickupPolicy).toBe("Forbidden");
        expect(availability.stopTimes[0]?.dropOffPolicy).toBe("CoordinateWithDriver");
        expect(availability.stopTimes[0]?.stopHeadsign).toBe("Toward Kota");
      }
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
              pickupPolicy: "Normal",
              dropOffPolicy: "Normal",
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
