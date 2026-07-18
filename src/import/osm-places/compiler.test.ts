import { readFileSync } from "node:fs";

import { Effect } from "effect";
import { describe, expect } from "vitest";

import { itEffect } from "../../testing/effect.js";
import { compileOsmPlaces } from "./index.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../test/fixtures/places/jabodetabek-sample.extract.json", import.meta.url),
    "utf8",
  ),
);

describe("osm places compiler", () => {
  itEffect(
    "compiles areas and landmarks and rejects unsupported features",
    Effect.gen(function* () {
      const result = yield* compileOsmPlaces({
        extract: fixture,
        artifactVersion: "places-jabodetabek-fixture-v1",
        retrievedAt: "2026-06-30T00:00:00.000Z",
      });
      expect(result.audit.accepted).toBe(5);
      expect(result.audit.rejected).toBe(1);
      expect(result.audit.exactDuplicatesMerged).toBe(1);
      expect(result.audit.byRejectionReason.unsupported_classification).toBe(1);
      expect(result.artifact.places.map((place) => place.primaryName).sort()).toEqual([
        "Grand Indonesia",
        "Kota Tua",
        "Menteng",
        "Stasiun Gambir",
        "Universitas Indonesia",
      ]);
      expect(result.artifact.source.inputChecksum.length).toBe(64);
      expect(result.artifact.outputChecksum.length).toBe(64);
    }),
  );

  itEffect(
    "produces byte-identical output for the same pinned input",
    Effect.gen(function* () {
      const first = yield* compileOsmPlaces({
        extract: fixture,
        artifactVersion: "places-jabodetabek-fixture-v1",
        retrievedAt: "2026-06-30T00:00:00.000Z",
      });
      const second = yield* compileOsmPlaces({
        extract: fixture,
        artifactVersion: "places-jabodetabek-fixture-v1",
        retrievedAt: "2026-06-30T00:00:00.000Z",
      });
      expect(first.artifactJson).toBe(second.artifactJson);
      expect(first.artifact.outputChecksum).toBe(second.artifact.outputChecksum);
      expect(first.artifact.source.inputChecksum).toBe(second.artifact.source.inputChecksum);
    }),
  );
});
