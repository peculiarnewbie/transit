import { readFileSync } from "node:fs";

import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { ApplicationRuntime } from "./application.js";
import { RouteHelperQuery } from "./route-helper-query.js";

const networkBase = "https://transit.test/artifacts/";
const placesBase = "https://transit.test/artifacts/places/";
const networkManifestUrl = `${networkBase}active.json`;
const placesManifestUrl = `${placesBase}active.json`;

const networkManifest = readFileSync("public/artifacts/active.json", "utf8");
const networkSnapshot = readFileSync(
  "public/artifacts/bus-transjakarta-20260630-v2.network.json",
  "utf8",
);
const networkGeometry = readFileSync(
  "public/artifacts/bus-transjakarta-20260630-v2.network.geometry.json",
  "utf8",
);
const placesManifest = readFileSync("public/artifacts/places/active.json", "utf8");
const placesArtifact = readFileSync(
  "public/artifacts/places/places-jabodetabek-20260718-v1.json",
  "utf8",
);

const productionFetch: typeof globalThis.fetch = async (input) => {
  const url = String(input);
  if (url === networkManifestUrl) return new Response(networkManifest);
  if (url.endsWith("bus-transjakarta-20260630-v2.network.json"))
    return new Response(networkSnapshot);
  if (url.endsWith("bus-transjakarta-20260630-v2.network.geometry.json"))
    return new Response(networkGeometry);
  if (url === placesManifestUrl) return new Response(placesManifest);
  if (url.endsWith("places-jabodetabek-20260718-v1.json")) return new Response(placesArtifact);
  return new Response(`missing ${url}`, { status: 404 });
};

describe("route-helper production composition", () => {
  it("loads production artifacts and rejects fixture place versions in production layer", async () => {
    const runtime = ManagedRuntime.make(
      ApplicationRuntime.helperLayerWith({
        networkManifestUrl,
        placesManifestUrl,
        fetch: productionFetch,
      }),
    );
    const versions = await runtime.runPromise(
      Effect.gen(function* () {
        const query = yield* RouteHelperQuery.Service;
        return yield* query.versions();
      }),
    );
    expect(versions.networkArtifactVersion).toBe("bus-transjakarta-20260630-v2");
    expect(versions.placesArtifactVersion).toBe("places-jabodetabek-20260718-v1");
    expect(versions.coverage.mode).toBe("bus-only");
    expect(versions.placesArtifactVersion).not.toMatch(/fixture|demo/);
    expect(versions.networkSnapshotChecksum).toBe(
      "2a1c634db6791f68b611d1bb895f676a8612690b456aa97d550f51c12fa5801d",
    );
    expect(versions.placesArtifactChecksum).toBe(
      "1ef43a076ad143b3efb6e172afb54e615279d40cb45a5476adc6f525912ce007",
    );
    await runtime.dispose();
  }, 120_000);

  it("fails composition when the place artifact targets another network version", async () => {
    const incompatibleFetch: typeof globalThis.fetch = async (input) => {
      if (String(input) === placesManifestUrl) {
        return new Response(
          JSON.stringify({
            ...JSON.parse(placesManifest),
            networkArtifactVersion: "bus-incompatible",
          }),
        );
      }
      return productionFetch(input);
    };
    const runtime = ManagedRuntime.make(
      ApplicationRuntime.helperLayerWith({
        networkManifestUrl,
        placesManifestUrl,
        fetch: incompatibleFetch,
      }),
    );
    await expect(runtime.runPromise(RouteHelperQuery.Service)).rejects.toMatchObject({
      reason: expect.stringContaining("bus-incompatible"),
    });
    await runtime.dispose();
  }, 120_000);

  it("searches places and guides without timetable fields", async () => {
    const runtime = ManagedRuntime.make(
      ApplicationRuntime.helperLayerWith({
        networkManifestUrl,
        placesManifestUrl,
        fetch: productionFetch,
      }),
    );

    const placeResult = await runtime.runPromise(
      Effect.gen(function* () {
        const query = yield* RouteHelperQuery.Service;
        return yield* query.searchPlaces({ text: "Bundaran", limit: 5 });
      }),
    );
    expect(placeResult._tag === "Matches" || placeResult._tag === "NoMatch").toBe(true);

    if (placeResult._tag === "Matches" && placeResult.results.length > 0) {
      const first = placeResult.results[0]!;
      const transitId = first.transitPlaceId;
      if (transitId !== undefined) {
        const guide = await runtime.runPromise(
          Effect.gen(function* () {
            const query = yield* RouteHelperQuery.Service;
            return yield* query.guide({
              origin: {
                placeId: first.placeId,
                displayLabel: first.displayLabel,
                resultKind: first.resultKind,
                artifactVersion: placeResult.placesArtifactVersion,
                transitPlaceId: transitId,
              },
              destination: {
                placeId: first.placeId,
                displayLabel: first.displayLabel,
                resultKind: first.resultKind,
                artifactVersion: placeResult.placesArtifactVersion,
                transitPlaceId: transitId,
              },
              originCandidates: [{ transitPlaceId: transitId, primaryName: first.displayLabel }],
              destinationCandidates: [
                { transitPlaceId: transitId, primaryName: first.displayLabel },
              ],
              networkArtifactVersion: placeResult.networkArtifactVersion,
              placesArtifactVersion: placeResult.placesArtifactVersion,
            });
          }),
        );
        expect([
          "GuidesFound",
          "NoTopologicalRoute",
          "InvalidCandidateSet",
          "StaleSelection",
        ]).toContain(guide._tag);
        const serialized = JSON.stringify(guide);
        expect(serialized).not.toMatch(
          /"departureSeconds"|"arrivalSeconds"|"walkMinutes"|"fare"|"waitMinutes"/,
        );
        if (guide._tag === "GuidesFound") {
          for (const alternative of guide.alternatives) {
            for (const step of alternative.rideSteps) {
              expect(step.lineOptions.length).toBeGreaterThan(0);
              expect(step.linePhrase.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }

    await runtime.dispose();
  }, 120_000);

  it("returns StaleSelection when client artifact versions drift", async () => {
    const runtime = ManagedRuntime.make(
      ApplicationRuntime.helperLayerWith({
        networkManifestUrl,
        placesManifestUrl,
        fetch: productionFetch,
      }),
    );
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const query = yield* RouteHelperQuery.Service;
        return yield* query.guide({
          origin: {
            placeId: "place:x",
            displayLabel: "X",
            resultKind: "Area",
            artifactVersion: "places-old",
          },
          destination: {
            placeId: "place:y",
            displayLabel: "Y",
            resultKind: "Area",
            artifactVersion: "places-old",
          },
          originCandidates: [{ transitPlaceId: "tp:missing", primaryName: "X" }],
          destinationCandidates: [{ transitPlaceId: "tp:missing-2", primaryName: "Y" }],
          networkArtifactVersion: "bus-old",
          placesArtifactVersion: "places-old",
        });
      }),
    );
    expect(result._tag).toBe("StaleSelection");
    await runtime.dispose();
  }, 120_000);

  it("keeps an exact Grogol selection from silently switching to Grogol Reformasi", async () => {
    const runtime = ManagedRuntime.make(
      ApplicationRuntime.helperLayerWith({
        networkManifestUrl,
        placesManifestUrl,
        fetch: productionFetch,
      }),
    );
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const query = yield* RouteHelperQuery.Service;
        const originSearch = yield* query.searchPlaces({ text: "Grogol", limit: 8 });
        const destinationSearch = yield* query.searchPlaces({ text: "Semanggi", limit: 8 });
        if (originSearch._tag !== "Matches" || destinationSearch._tag !== "Matches")
          return yield* Effect.die("Expected production Grogol and Semanggi matches");
        const origin = originSearch.results[0]!;
        const destination = destinationSearch.results[0]!;
        const originNearby = yield* query.nearbyTransit({
          placeId: origin.placeId,
          coordinate: origin.representativeLocation,
          radiusMeters: 800,
          maxCount: 6,
        });
        const destinationNearby = yield* query.nearbyTransit({
          placeId: destination.placeId,
          coordinate: destination.representativeLocation,
          radiusMeters: 800,
          maxCount: 6,
        });
        if (originNearby._tag !== "Choices" || destinationNearby._tag !== "Choices")
          return yield* Effect.die("Expected nearby production choices");
        const selected = (place: typeof origin) => ({
          placeId: place.placeId,
          displayLabel: place.displayLabel,
          resultKind: place.resultKind,
          artifactVersion: originSearch.placesArtifactVersion,
          ...(place.transitPlaceId === undefined ? {} : { transitPlaceId: place.transitPlaceId }),
          ...(place.representativeLocation._tag === "Placed"
            ? {
                coordinate: {
                  latitude: place.representativeLocation.latitude,
                  longitude: place.representativeLocation.longitude,
                },
              }
            : {}),
        });
        const candidates = (choices: typeof originNearby.choices) =>
          choices.map((choice) => ({
            transitPlaceId: choice.transitPlaceId,
            primaryName: choice.primaryName,
            geographicDistanceMeters: choice.geographicDistanceMeters,
          }));
        const forward = yield* query.guide({
          origin: selected(origin),
          destination: selected(destination),
          originCandidates: candidates(originNearby.choices),
          destinationCandidates: candidates(destinationNearby.choices),
          networkArtifactVersion: originSearch.networkArtifactVersion,
          placesArtifactVersion: originSearch.placesArtifactVersion,
          maximumTransfers: 3,
          maximumAlternatives: 6,
        });
        const reverse = yield* query.guide({
          origin: selected(destination),
          destination: selected(origin),
          originCandidates: candidates(destinationNearby.choices),
          destinationCandidates: candidates(originNearby.choices),
          networkArtifactVersion: originSearch.networkArtifactVersion,
          placesArtifactVersion: originSearch.placesArtifactVersion,
          maximumTransfers: 3,
          maximumAlternatives: 6,
        });
        return { forward, reverse };
      }),
    );

    expect(result.forward._tag).toBe("GuidesFound");
    if (result.forward._tag === "GuidesFound") {
      const first = result.forward.alternatives[0]!;
      expect(first.origin.placeName).toBe("Grogol");
      expect(first.destination.placeName).toBe("Semanggi");
      expect(first.metrics.originCandidateDistanceMeters).toBe(0);
      expect(
        result.forward.alternatives.every(
          (alternative) =>
            alternative.origin.placeName === "Grogol" &&
            alternative.destination.placeName === "Semanggi",
        ),
      ).toBe(true);
      expect(
        result.forward.alternatives.some(
          (alternative) => alternative.origin.placeName === "Grogol Reformasi",
        ),
      ).toBe(false);
      expect(first.rideGeometry.length).toBeGreaterThan(0);
      expect(first.rideSegments.length).toBeGreaterThan(0);
      expect(first.rideSegments[0]?.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(result.reverse._tag).toBe("GuidesFound");
    if (result.reverse._tag === "GuidesFound") {
      expect(
        result.reverse.alternatives.every(
          (alternative) =>
            alternative.origin.placeName === "Semanggi" &&
            alternative.destination.placeName === "Grogol",
        ),
      ).toBe(true);
      expect(result.reverse.alternatives[0]?.metrics.destinationCandidateDistanceMeters).toBe(0);
    }
    await runtime.dispose();
  }, 120_000);

  it("keeps exact stops and ranks the shorter Grogol bus path first", async () => {
    const runtime = ManagedRuntime.make(
      ApplicationRuntime.helperLayerWith({
        networkManifestUrl,
        placesManifestUrl,
        fetch: productionFetch,
      }),
    );
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const query = yield* RouteHelperQuery.Service;
        return yield* query.guide({
          origin: {
            placeId: "place:transit-ref:place:source:gtfs:transjakarta:stop:H00071P",
            displayLabel: "Grogol Reformasi",
            resultKind: "TransitPlace",
            artifactVersion: "places-jabodetabek-20260718-v1",
            transitPlaceId: "place:source:gtfs:transjakarta:stop:H00071P",
          },
          destination: {
            placeId: "place:transit-ref:place:source:gtfs:transjakarta:stop:H00014P",
            displayLabel: "Blok M",
            resultKind: "TransitPlace",
            artifactVersion: "places-jabodetabek-20260718-v1",
            transitPlaceId: "place:source:gtfs:transjakarta:stop:H00014P",
          },
          originCandidates: [
            {
              transitPlaceId: "place:source:gtfs:transjakarta:stop:H00071P",
              primaryName: "Grogol Reformasi",
              geographicDistanceMeters: 0,
            },
            {
              transitPlaceId: "place:standalone:gtfs:transjakarta:stop:B05843P",
              primaryName: "Univ. Trisakti",
              geographicDistanceMeters: 169,
            },
          ],
          destinationCandidates: [
            {
              transitPlaceId: "place:source:gtfs:transjakarta:stop:H00014P",
              primaryName: "Blok M",
              geographicDistanceMeters: 0,
            },
          ],
          networkArtifactVersion: "bus-transjakarta-20260630-v2",
          placesArtifactVersion: "places-jabodetabek-20260718-v1",
          maximumTransfers: 3,
          maximumAlternatives: 6,
        });
      }),
    );

    expect(result._tag).toBe("GuidesFound");
    if (result._tag === "GuidesFound") {
      expect(
        result.alternatives.every(
          (alternative) =>
            alternative.origin.placeName === "Grogol Reformasi" &&
            alternative.destination.placeName === "Blok M" &&
            alternative.metrics.originCandidateDistanceMeters === 0 &&
            alternative.metrics.destinationCandidateDistanceMeters === 0,
        ),
      ).toBe(true);
      const first = result.alternatives[0]!;
      expect(first.origin.placeName).toBe("Grogol Reformasi");
      expect(first.destination.placeName).toBe("Blok M");
      expect(first.transferCount).toBe(1);
      expect(first.rideSteps).toHaveLength(2);
      expect(first.rideSteps[0]?.lineBadges).toEqual(["3F"]);
      expect(first.rideSteps[1]?.lineBadges).toEqual(["1"]);
      expect(first.metrics.journeyDistanceMeters).toBeGreaterThan(0);
      const passengerJourneys = result.alternatives.map((alternative) =>
        JSON.stringify(
          alternative.rideSteps.map((step) => ({
            lines: [...step.lineBadges].sort(),
            directions: [...step.directionSummaries].sort(),
          })),
        ),
      );
      expect(new Set(passengerJourneys).size).toBe(passengerJourneys.length);
    }
    await runtime.dispose();
  }, 120_000);

  it("keeps Polda Metro Jaya to Blok M alternatives passenger-distinct", async () => {
    const runtime = ManagedRuntime.make(
      ApplicationRuntime.helperLayerWith({
        networkManifestUrl,
        placesManifestUrl,
        fetch: productionFetch,
      }),
    );
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const query = yield* RouteHelperQuery.Service;
        return yield* query.guide({
          origin: {
            placeId: "place:transit-ref:place:source:gtfs:transjakarta:stop:H00176P",
            displayLabel: "Polda Metro Jaya",
            resultKind: "TransitPlace",
            artifactVersion: "places-jabodetabek-20260718-v1",
            transitPlaceId: "place:source:gtfs:transjakarta:stop:H00176P",
          },
          destination: {
            placeId: "place:transit-ref:place:source:gtfs:transjakarta:stop:H00014P",
            displayLabel: "Blok M",
            resultKind: "TransitPlace",
            artifactVersion: "places-jabodetabek-20260718-v1",
            transitPlaceId: "place:source:gtfs:transjakarta:stop:H00014P",
          },
          originCandidates: [
            {
              transitPlaceId: "place:source:gtfs:transjakarta:stop:H00176P",
              primaryName: "Polda Metro Jaya",
              geographicDistanceMeters: 0,
            },
          ],
          destinationCandidates: [
            {
              transitPlaceId: "place:source:gtfs:transjakarta:stop:H00014P",
              primaryName: "Blok M",
              geographicDistanceMeters: 0,
            },
          ],
          networkArtifactVersion: "bus-transjakarta-20260630-v2",
          placesArtifactVersion: "places-jabodetabek-20260718-v1",
          maximumTransfers: 3,
          maximumAlternatives: 6,
        });
      }),
    );

    expect(result._tag).toBe("GuidesFound");
    if (result._tag === "GuidesFound") {
      expect(result.alternatives[0]?.rideSteps).toHaveLength(1);
      expect(result.alternatives[0]?.rideSteps[0]?.lineBadges).toEqual(["1"]);
      expect(result.alternatives[0]?.rideSteps[0]?.boardingPlaceName).toBe("Polda Metro Jaya");
      expect(result.alternatives[0]?.rideSteps[0]?.alightingPlaceName).toBe("Blok M");
      const passengerJourneys = result.alternatives.map((alternative) =>
        JSON.stringify(
          alternative.rideSteps.map((step) => ({
            lines: [...step.lineBadges].sort(),
            directions: [...step.directionSummaries].sort(),
          })),
        ),
      );
      expect(new Set(passengerJourneys).size).toBe(passengerJourneys.length);
    }
    await runtime.dispose();
  }, 120_000);
});
