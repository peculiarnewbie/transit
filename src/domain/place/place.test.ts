import { Effect, Result, Schema } from "effect";
import { describe, expect } from "vitest";

import { itEffect } from "../../testing/effect.js";
import {
  DuplicatePlaceId,
  DuplicateSourceIdentity,
  GeographicBounds,
  PassengerPlace,
  PassengerPlaceSearchResult,
  decodePassengerPlace,
  decodePassengerPlaceArtifact,
} from "./index.js";

const retrievedAt = "2026-06-30T00:00:00.000Z";

const areaFixture = {
  _tag: "Area" as const,
  id: "place:area:kota-tua",
  primaryName: "Kota Tua",
  aliases: ["Old Town", "Kota Lama"],
  locality: { municipality: "Jakarta Barat", neighbourhood: "Pinangsia" },
  representativeLocation: { _tag: "Placed" as const, latitude: -6.135, longitude: 106.813 },
  bounds: { west: 106.8, south: -6.15, east: 106.83, north: -6.12 },
  sourceRefs: [
    {
      system: "osm",
      recordId: "relation:123",
      retrievedAt,
      source: "geofabrik-jabodetabek",
      classification: "place=neighbourhood",
    },
  ],
  artifactVersion: "places-jabodetabek-20260630-v1",
  areaKind: "Neighbourhood" as const,
};

const landmarkFixture = {
  _tag: "Landmark" as const,
  id: "place:landmark:grand-indonesia",
  primaryName: "Grand Indonesia",
  aliases: ["GI"],
  locality: { municipality: "Jakarta Pusat", adminDistrict: "Menteng" },
  representativeLocation: { _tag: "Placed" as const, latitude: -6.195, longitude: 106.822 },
  sourceRefs: [
    {
      system: "osm",
      recordId: "way:456",
      retrievedAt,
      source: "geofabrik-jabodetabek",
      classification: "shop=mall",
    },
  ],
  artifactVersion: "places-jabodetabek-20260630-v1",
  landmarkKind: "Mall" as const,
};

const transitRefFixture = {
  _tag: "TransitPlaceReference" as const,
  id: "place:transit:blok-m",
  primaryName: "Blok M",
  aliases: ["Blok M Terminal"],
  locality: { municipality: "Jakarta Selatan" },
  representativeLocation: { _tag: "Placed" as const, latitude: -6.243, longitude: 106.802 },
  sourceRefs: [
    {
      system: "transit-place",
      recordId: "place:source-parent:H00014P",
      retrievedAt,
      source: "bus-transjakarta-20260630-v2",
    },
  ],
  artifactVersion: "places-jabodetabek-20260630-v1",
  transitPlaceId: "place:source-parent:H00014P",
};

describe("passenger place domain", () => {
  itEffect(
    "round-trips Area with Unicode aliases and bounds",
    Effect.gen(function* () {
      const place = yield* decodePassengerPlace({
        ...areaFixture,
        primaryName: "Kota Tua",
        aliases: ["Kota Tua Jakarta", "Kawasan Kota Tua"],
      });
      expect(place._tag).toBe("Area");
      if (place._tag === "Area") {
        expect(place.areaKind).toBe("Neighbourhood");
        expect(place.bounds?.west).toBe(106.8);
      }
    }),
  );

  itEffect(
    "round-trips Landmark and TransitPlaceReference variants",
    Effect.gen(function* () {
      const landmark = yield* decodePassengerPlace(landmarkFixture);
      const transit = yield* decodePassengerPlace(transitRefFixture);
      expect(landmark._tag).toBe("Landmark");
      expect(transit._tag).toBe("TransitPlaceReference");
      if (transit._tag === "TransitPlaceReference") {
        expect(transit.transitPlaceId).toBe("place:source-parent:H00014P");
      }
    }),
  );

  itEffect(
    "decodes PassengerPlaceSearchResult independently of OSM tags",
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(PassengerPlaceSearchResult)({
        placeId: "place:area:kota-tua",
        displayLabel: "Kota Tua",
        disambiguatingContext: "Neighbourhood · Jakarta Barat",
        resultKind: "Area",
        representativeLocation: areaFixture.representativeLocation,
        matchEvidence: [{ _tag: "ExactPrimaryName" }],
        rankScore: 100,
      });
      expect(result.resultKind).toBe("Area");
      expect(result.matchEvidence[0]?._tag).toBe("ExactPrimaryName");
    }),
  );

  itEffect(
    "rejects invalid bounds",
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(GeographicBounds)({
        west: 106.9,
        east: 106.8,
        south: -6.15,
        north: -6.12,
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  itEffect(
    "rejects malformed coordinates on places",
    Effect.gen(function* () {
      const result = yield* decodePassengerPlace({
        ...landmarkFixture,
        representativeLocation: { _tag: "Placed", latitude: -91, longitude: 106.8 },
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  itEffect(
    "rejects empty primary names",
    Effect.gen(function* () {
      const result = yield* decodePassengerPlace({
        ...landmarkFixture,
        primaryName: "",
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  itEffect(
    "rejects duplicate place IDs in an artifact",
    Effect.gen(function* () {
      const result = yield* decodePassengerPlaceArtifact({
        schemaVersion: "1",
        artifactVersion: "places-jabodetabek-20260630-v1",
        source: {
          name: "fixture",
          dateOrVersion: "2026-06-30",
          license: "ODbL",
          attribution: "© OpenStreetMap",
          boundaryDescription: "Jabodetabek test",
          inputChecksum: "abc",
          compilerVersion: "1",
        },
        outputChecksum: "def",
        places: [areaFixture, { ...areaFixture }],
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DuplicatePlaceId);
      }
    }),
  );

  itEffect(
    "rejects duplicate source identities across places",
    Effect.gen(function* () {
      const result = yield* decodePassengerPlaceArtifact({
        schemaVersion: "1",
        artifactVersion: "places-jabodetabek-20260630-v1",
        source: {
          name: "fixture",
          dateOrVersion: "2026-06-30",
          license: "ODbL",
          attribution: "© OpenStreetMap",
          boundaryDescription: "Jabodetabek test",
          inputChecksum: "abc",
          compilerVersion: "1",
        },
        outputChecksum: "def",
        places: [
          areaFixture,
          {
            ...landmarkFixture,
            sourceRefs: areaFixture.sourceRefs,
          },
        ],
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DuplicateSourceIdentity);
      }
    }),
  );

  itEffect(
    "accepts a mixed-variant artifact",
    Effect.gen(function* () {
      const artifact = yield* decodePassengerPlaceArtifact({
        schemaVersion: "1",
        artifactVersion: "places-jabodetabek-20260630-v1",
        source: {
          name: "fixture",
          dateOrVersion: "2026-06-30",
          license: "ODbL",
          attribution: "© OpenStreetMap",
          boundaryDescription: "Jabodetabek test",
          inputChecksum: "abc",
          compilerVersion: "1",
        },
        outputChecksum: "def",
        places: [areaFixture, landmarkFixture, transitRefFixture],
      });
      expect(artifact.places).toHaveLength(3);
      expect(artifact.places.map((p) => p._tag).sort()).toEqual([
        "Area",
        "Landmark",
        "TransitPlaceReference",
      ]);
    }),
  );

  // Keep PassengerPlace union exhaustiveness visible to the typechecker.
  void (null as unknown as PassengerPlace);
});
