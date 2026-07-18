import { Effect, Result, Schema } from "effect";
import { describe, expect } from "vitest";

import { NetworkSnapshot } from "../../domain/transit/index.js";
import { itEffect } from "../../testing/effect.js";
import { projectDirectionEvidence, TransitPlaceId, TransitPlaceProjection } from "./index.js";

const stop = (
  id: string,
  name: string,
  opts: {
    parentStopId?: string;
    locationKind?: "Stop" | "Station";
    platformCode?: string;
    latitude?: number;
    longitude?: number;
  } = {},
) => ({
  id,
  sourceRefs: [],
  name,
  location: {
    _tag: "Placed" as const,
    latitude: opts.latitude ?? -6.2,
    longitude: opts.longitude ?? 106.8,
  },
  locationKind: opts.locationKind ?? "Stop",
  wheelchairBoarding: "Unknown" as const,
  ...(opts.parentStopId === undefined ? {} : { parentStopId: opts.parentStopId }),
  ...(opts.platformCode === undefined ? {} : { platformCode: opts.platformCode }),
});

const baseSnapshot = {
  schemaVersion: "2",
  generatedAt: "2026-07-18T00:00:00.000Z",
  agencies: [
    {
      id: "agency:test",
      sourceRefs: [],
      name: "Test",
      timezone: "Asia/Jakarta",
    },
  ],
  stops: [] as Array<ReturnType<typeof stop>>,
  routes: [
    {
      id: "route:1",
      agencyId: "agency:test",
      sourceRefs: [],
      mode: "Bus",
      shortName: "1",
    },
  ],
  patterns: [
    {
      id: "pattern:1",
      routeId: "route:1",
      sourceRefs: [],
      stopIds: ["stop:a", "stop:b"],
    },
  ],
  trips: [
    {
      id: "trip:1",
      patternId: "pattern:1",
      serviceId: "service:1",
      sourceRefs: [],
      headsign: "Kota",
      availability: {
        _tag: "Scheduled",
        stopTimes: [
          {
            stopId: "stop:a",
            sequence: 0,
            arrivalSeconds: 0,
            departureSeconds: 0,
            pickupPolicy: "Normal",
            dropOffPolicy: "Normal",
          },
          {
            stopId: "stop:b",
            sequence: 1,
            arrivalSeconds: 60,
            departureSeconds: 60,
            pickupPolicy: "Normal",
            dropOffPolicy: "Normal",
          },
        ],
        frequencyWindows: [],
      },
    },
  ],
  calendars: [
    {
      id: "service:1",
      sourceRefs: [],
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      activeWeekdays: ["Monday"],
      exceptions: [],
    },
  ],
  transfers: [],
};

const project = (snapshot: unknown, overrides?: unknown) =>
  Effect.gen(function* () {
    const service = yield* TransitPlaceProjection.Service;
    return yield* service.project({
      snapshot,
      sourceArtifactVersion: "fixture-v1",
      overrides,
    });
  }).pipe(Effect.provide(TransitPlaceProjection.layer));

describe("transit place projection", () => {
  itEffect(
    "brands transit place ids",
    Schema.decodeUnknownEffect(TransitPlaceId)("place:source:stop:a").pipe(Effect.as(true)),
  );

  itEffect(
    "groups a station with child platforms under source parent evidence",
    Effect.gen(function* () {
      const snapshot = {
        ...baseSnapshot,
        stops: [
          stop("stop:station", "Bundaran HI", { locationKind: "Station" }),
          stop("stop:p1", "Bundaran HI", {
            parentStopId: "stop:station",
            platformCode: "1",
            latitude: -6.201,
          }),
          stop("stop:p2", "Bundaran HI", {
            parentStopId: "stop:station",
            platformCode: "2",
            latitude: -6.202,
          }),
        ],
        patterns: [
          {
            id: "pattern:1",
            routeId: "route:1",
            sourceRefs: [],
            stopIds: ["stop:p1", "stop:p2"],
          },
        ],
        trips: [
          {
            ...baseSnapshot.trips[0],
            availability: {
              _tag: "Scheduled",
              stopTimes: [
                {
                  stopId: "stop:p1",
                  sequence: 0,
                  arrivalSeconds: 0,
                  departureSeconds: 0,
                  pickupPolicy: "Normal",
                  dropOffPolicy: "Normal",
                },
                {
                  stopId: "stop:p2",
                  sequence: 1,
                  arrivalSeconds: 60,
                  departureSeconds: 60,
                  pickupPolicy: "Normal",
                  dropOffPolicy: "Normal",
                },
              ],
              frequencyWindows: [],
            },
          },
        ],
      };
      const index = yield* project(snapshot);
      expect(Object.keys(index.placesById)).toHaveLength(1);
      const place = Object.values(index.placesById)[0]!;
      expect(place.groupingEvidence._tag).toBe("SourceParent");
      expect(place.memberStopIds).toEqual(["stop:p1", "stop:p2", "stop:station"]);
      expect(place.platformSummary?.codes).toEqual(["1", "2"]);
      expect(index.placeIdByStopId["stop:p1" as keyof typeof index.placeIdByStopId]).toBe(place.id);
      expect(index.placeIdByStopId["stop:p2" as keyof typeof index.placeIdByStopId]).toBe(place.id);
    }),
  );

  itEffect(
    "keeps same-name standalone stops separate by default",
    Effect.gen(function* () {
      const snapshot = {
        ...baseSnapshot,
        stops: [
          stop("stop:north", "Cawang", { latitude: -6.24, longitude: 106.86 }),
          stop("stop:south", "Cawang", { latitude: -6.25, longitude: 106.87 }),
        ],
      };
      const index = yield* project(snapshot);
      expect(Object.keys(index.placesById)).toHaveLength(2);
      expect(
        Object.values(index.placesById).every(
          (place) => place.groupingEvidence._tag === "Standalone",
        ),
      ).toBe(true);
    }),
  );

  itEffect(
    "reports opposing curb stops as proposed complexes without merging",
    Effect.gen(function* () {
      const snapshot = {
        ...baseSnapshot,
        stops: [
          stop("stop:west", "Semanggi Arah Barat", {
            latitude: -6.2195,
            longitude: 106.8096,
            platformCode: "A",
          }),
          stop("stop:east", "Semanggi Arah Timur", {
            latitude: -6.21951,
            longitude: 106.80961,
            platformCode: "B",
          }),
        ],
        patterns: [
          {
            id: "pattern:1",
            routeId: "route:1",
            sourceRefs: [],
            stopIds: ["stop:west", "stop:east"],
          },
        ],
      };
      const index = yield* project(snapshot);
      expect(Object.keys(index.placesById)).toHaveLength(2);
      expect(index.unresolvedFindings.some((finding) => finding._tag === "ProposedComplex")).toBe(
        true,
      );
    }),
  );

  itEffect(
    "accepts versioned reviewed complex overrides",
    Effect.gen(function* () {
      const snapshot = {
        ...baseSnapshot,
        stops: [
          stop("stop:t1", "Blok M Jalur 2", { latitude: -6.244, longitude: 106.799 }),
          stop("stop:t2", "Blok M Jalur 3", { latitude: -6.2441, longitude: 106.7991 }),
        ],
      };
      const overrides = {
        schemaVersion: "1",
        sourceArtifactVersion: "fixture-v1",
        overrides: [
          {
            id: "override:blok-m",
            sourceArtifactVersion: "fixture-v1",
            memberStopIds: ["stop:t1", "stop:t2"],
            primaryName: "Blok M",
            aliases: ["Blok-M"],
            rationale: "Reviewed terminal complex",
            reviewer: "plan-013",
            reviewedAt: "2026-07-18",
          },
        ],
      };
      const index = yield* project(snapshot, overrides);
      expect(Object.keys(index.placesById)).toHaveLength(1);
      const place = Object.values(index.placesById)[0]!;
      expect(place.primaryName).toBe("Blok M");
      expect(place.groupingEvidence._tag).toBe("ReviewedComplex");
    }),
  );

  itEffect(
    "rejects stale reviewed overrides against a different artifact version",
    Effect.gen(function* () {
      const snapshot = {
        ...baseSnapshot,
        stops: [stop("stop:a", "A"), stop("stop:b", "B")],
      };
      const result = yield* project(snapshot, {
        schemaVersion: "1",
        sourceArtifactVersion: "other-version",
        overrides: [
          {
            id: "override:stale",
            sourceArtifactVersion: "other-version",
            memberStopIds: ["stop:a", "stop:b"],
            primaryName: "Complex",
            aliases: [],
            rationale: "stale",
            reviewer: "plan-013",
            reviewedAt: "2026-07-18",
          },
        ],
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result) && result.failure._tag === "TransitPlace.MalformedMembership") {
        expect(result.failure.reason).toContain("Reviewed overrides target");
      }
    }),
  );

  itEffect(
    "enforces unique stop membership",
    Effect.gen(function* () {
      const snapshot = {
        ...baseSnapshot,
        stops: [
          stop("stop:station", "Station", { locationKind: "Station" }),
          stop("stop:child", "Child", { parentStopId: "stop:station" }),
        ],
      };
      const result = yield* project(snapshot, {
        schemaVersion: "1",
        sourceArtifactVersion: "fixture-v1",
        overrides: {
          schemaVersion: "1",
          sourceArtifactVersion: "fixture-v1",
          overrides: [
            {
              id: "override:dup",
              sourceArtifactVersion: "fixture-v1",
              memberStopIds: ["stop:child"],
              primaryName: "Dup",
              aliases: [],
              rationale: "should fail",
              reviewer: "plan-013",
              reviewedAt: "2026-07-18",
            },
          ],
        },
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );
});

describe("pattern direction evidence", () => {
  itEffect(
    "classifies stable, conflicting, and absent headsigns",
    Effect.gen(function* () {
      const snapshot = {
        ...baseSnapshot,
        patterns: [
          {
            id: "pattern:stable",
            routeId: "route:1",
            sourceRefs: [],
            stopIds: ["stop:a", "stop:b"],
          },
          {
            id: "pattern:conflict",
            routeId: "route:1",
            sourceRefs: [],
            stopIds: ["stop:a", "stop:b"],
          },
          {
            id: "pattern:absent",
            routeId: "route:1",
            sourceRefs: [],
            stopIds: ["stop:a"],
          },
        ],
        stops: [stop("stop:a", "Alpha"), stop("stop:b", "Beta")],
        trips: [
          {
            id: "trip:stable",
            patternId: "pattern:stable",
            serviceId: "service:1",
            sourceRefs: [],
            headsign: "Beta",
            availability: { _tag: "TopologyOnly", reason: "fixture" },
          },
          {
            id: "trip:conflict-a",
            patternId: "pattern:conflict",
            serviceId: "service:1",
            sourceRefs: [],
            headsign: "Beta",
            availability: { _tag: "TopologyOnly", reason: "fixture" },
          },
          {
            id: "trip:conflict-b",
            patternId: "pattern:conflict",
            serviceId: "service:1",
            sourceRefs: [],
            headsign: "Gamma",
            availability: { _tag: "TopologyOnly", reason: "fixture" },
          },
          {
            id: "trip:absent",
            patternId: "pattern:absent",
            serviceId: "service:1",
            sourceRefs: [],
            availability: { _tag: "TopologyOnly", reason: "fixture" },
          },
        ],
      };
      const decoded = yield* Schema.decodeUnknownEffect(NetworkSnapshot)(snapshot);
      const report = yield* projectDirectionEvidence(decoded, "fixture-v1");
      expect(report.counts.stableTripHeadsign).toBe(1);
      expect(report.counts.conflictingTripHeadsigns).toBe(1);
      expect(report.counts.finalStopFallback + report.counts.absent).toBeGreaterThanOrEqual(1);
      expect(
        report.patterns.find((pattern) => pattern.patternId === "pattern:stable")?.classification,
      ).toBe("StableTripHeadsign");
      expect(
        report.patterns.find((pattern) => pattern.patternId === "pattern:conflict")?.classification,
      ).toBe("ConflictingTripHeadsigns");
    }),
  );
});
