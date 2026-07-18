import { readFileSync } from "node:fs";

import { Effect } from "effect";
import { describe, expect } from "vitest";

import { itEffect } from "../../testing/effect.js";
import type { TransitPlaceIndex } from "../transit/transit-place.js";
import { compileOsmPlaces } from "../../import/osm-places/index.js";
import { make } from "./service.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../test/fixtures/places/jabodetabek-sample.extract.json", import.meta.url),
    "utf8",
  ),
);

const transitIndex = {
  schemaVersion: "1" as const,
  sourceArtifactVersion: "fixture-v1",
  placesById: {
    "place:source-parent:blok-m": {
      id: "place:source-parent:blok-m",
      primaryName: "Blok M",
      aliases: ["Blok M Terminal"],
      representativeLocation: { _tag: "Placed" as const, latitude: -6.243, longitude: 106.802 },
      memberStopIds: ["stop:blok-m-1", "stop:blok-m-2", "stop:blok-m-3"],
      servedRouteIds: ["route:1", "route:9"],
      sourceRefs: [],
      groupingEvidence: { _tag: "SourceParent" as const, parentStopId: "stop:blok-m-parent" },
      platformSummary: { codes: ["1", "2"], memberCount: 3 },
    },
    "place:standalone:far": {
      id: "place:standalone:far",
      primaryName: "Far Stop",
      aliases: [],
      representativeLocation: { _tag: "Placed" as const, latitude: -6.5, longitude: 106.9 },
      memberStopIds: ["stop:far"],
      servedRouteIds: ["route:99"],
      sourceRefs: [],
      groupingEvidence: { _tag: "Standalone" as const },
    },
  },
  placeIdByStopId: {
    "stop:blok-m-1": "place:source-parent:blok-m",
    "stop:blok-m-2": "place:source-parent:blok-m",
    "stop:blok-m-3": "place:source-parent:blok-m",
    "stop:far": "place:standalone:far",
  },
  unresolvedFindings: [],
} as unknown as TransitPlaceIndex;

describe("passenger place discovery", () => {
  itEffect(
    "ranks exact, alias, and abbreviation matches deterministically",
    Effect.gen(function* () {
      const compiled = yield* compileOsmPlaces({
        extract: fixture,
        artifactVersion: "places-jabodetabek-fixture-v1",
        retrievedAt: "2026-06-30T00:00:00.000Z",
      });
      const discovery = yield* make({
        artifact: compiled.artifact,
        transitIndex,
      });

      const exact = yield* discovery.search({ text: "Grand Indonesia", limit: 5 });
      expect(exact._tag).toBe("Matches");
      if (exact._tag === "Matches") {
        expect(exact.results[0]?.displayLabel).toBe("Grand Indonesia");
        expect(exact.results[0]?.resultKind).toBe("Landmark");
      }

      const alias = yield* discovery.search({ text: "GI", limit: 5 });
      expect(alias._tag).toBe("Matches");
      if (alias._tag === "Matches") {
        expect(alias.results[0]?.displayLabel).toBe("Grand Indonesia");
        expect(alias.results[0]?.matchedAlias).toBe("GI");
      }

      const abbreviated = yield* discovery.search({ text: "St Gambir", limit: 5 });
      expect(abbreviated._tag).toBe("Matches");
      if (abbreviated._tag === "Matches") {
        expect(abbreviated.results[0]?.displayLabel).toBe("Stasiun Gambir");
      }
    }),
  );

  itEffect(
    "shows a transit complex once and keeps stable selected ids",
    Effect.gen(function* () {
      const compiled = yield* compileOsmPlaces({
        extract: fixture,
        artifactVersion: "places-jabodetabek-fixture-v1",
        retrievedAt: "2026-06-30T00:00:00.000Z",
      });
      const discovery = yield* make({
        artifact: compiled.artifact,
        transitIndex,
      });
      const outcome = yield* discovery.search({ text: "Blok M", limit: 10 });
      expect(outcome._tag).toBe("Matches");
      if (outcome._tag === "Matches") {
        const blokM = outcome.results.filter((result) => result.displayLabel === "Blok M");
        expect(blokM).toHaveLength(1);
        expect(blokM[0]?.resultKind).toBe("TransitPlace");
        expect(blokM[0]?.placeId).toBe("place:transit-ref:place:source-parent:blok-m");
        expect(blokM[0]?.transitPlaceId).toBe("place:source-parent:blok-m");
      }
    }),
  );

  itEffect(
    "returns recognized places without an origin-reachability filter",
    Effect.gen(function* () {
      const compiled = yield* compileOsmPlaces({
        extract: fixture,
        artifactVersion: "places-jabodetabek-fixture-v1",
        retrievedAt: "2026-06-30T00:00:00.000Z",
      });
      const discovery = yield* make({ artifact: compiled.artifact, transitIndex });
      const outcome = yield* discovery.search({ text: "Universitas Indonesia", limit: 5 });
      expect(outcome._tag).toBe("Matches");
    }),
  );

  itEffect(
    "applies soft coordinate bias without hiding strong remote text matches",
    Effect.gen(function* () {
      const compiled = yield* compileOsmPlaces({
        extract: fixture,
        artifactVersion: "places-jabodetabek-fixture-v1",
        retrievedAt: "2026-06-30T00:00:00.000Z",
      });
      const discovery = yield* make({ artifact: compiled.artifact, transitIndex });
      const outcome = yield* discovery.search({
        text: "Menteng",
        limit: 5,
        biasCoordinate: { latitude: -6.36, longitude: 106.83 },
      });
      expect(outcome._tag).toBe("Matches");
      if (outcome._tag === "Matches") {
        expect(outcome.results.some((result) => result.displayLabel === "Menteng")).toBe(true);
      }
    }),
  );

  itEffect(
    "resolves nearby transit choices with geometric distance only",
    Effect.gen(function* () {
      const compiled = yield* compileOsmPlaces({
        extract: fixture,
        artifactVersion: "places-jabodetabek-fixture-v1",
        retrievedAt: "2026-06-30T00:00:00.000Z",
      });
      const discovery = yield* make({ artifact: compiled.artifact, transitIndex });
      const nearby = yield* discovery.nearbyTransit(
        {
          coordinate: { latitude: -6.243, longitude: 106.802 },
          radiusMeters: 2_000,
          maxCount: 5,
        },
        transitIndex,
      );
      expect(nearby._tag).toBe("Choices");
      if (nearby._tag === "Choices") {
        expect(nearby.choices[0]?.primaryName).toBe("Blok M");
        expect(nearby.choices[0]?.geographicDistanceMeters).toBeLessThan(50);
        expect(nearby.choices.some((choice) => choice.primaryName === "Far Stop")).toBe(false);
      }

      const none = yield* discovery.nearbyTransit(
        {
          coordinate: { latitude: -6.0, longitude: 106.0 },
          radiusMeters: 100,
          maxCount: 5,
        },
        transitIndex,
      );
      expect(none._tag).toBe("NoneWithinCap");
    }),
  );

  itEffect(
    "returns NoMatch distinct from failure",
    Effect.gen(function* () {
      const compiled = yield* compileOsmPlaces({
        extract: fixture,
        artifactVersion: "places-jabodetabek-fixture-v1",
        retrievedAt: "2026-06-30T00:00:00.000Z",
      });
      const discovery = yield* make({ artifact: compiled.artifact, transitIndex });
      const outcome = yield* discovery.search({ text: "zzznomatchzzz", limit: 5 });
      expect(outcome).toEqual({ _tag: "NoMatch", queryText: "zzznomatchzzz" });
    }),
  );
});
