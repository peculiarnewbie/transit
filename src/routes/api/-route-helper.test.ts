import { describe, expect, it } from "vitest";

import {
  handleArtifactVersionsRequest,
  type ArtifactVersionsExecutor,
} from "./artifact-versions.js";
import { handleNearbyTransitRequest, type NearbyTransitExecutor } from "./nearby-transit.js";
import { handlePlaceSearchRequest, type PlaceSearchExecutor } from "./places.js";
import { handleRouteGuideRequest, type RouteGuideExecutor } from "./route-guide.js";

const coverage = {
  mode: "bus-only" as const,
  networkArtifactVersion: "bus-transjakarta-20260630-v2",
  placesArtifactVersion: "places-jabodetabek-20260718-v1",
  attribution: "© OpenStreetMap contributors",
  freshnessNote: "bus only",
};

const selectedPlace = {
  placeId: "place:test-origin",
  displayLabel: "Menteng",
  resultKind: "Area" as const,
  artifactVersion: "places-jabodetabek-20260718-v1",
};

describe("route-helper API routes", () => {
  it("parses and bounds place search parameters", async () => {
    let seen: unknown;
    const execute: PlaceSearchExecutor = async (network, places, input) => {
      seen = { network, places, input };
      return {
        _tag: "Matches",
        placesArtifactVersion: coverage.placesArtifactVersion,
        networkArtifactVersion: coverage.networkArtifactVersion,
        results: [],
      };
    };
    const response = await handlePlaceSearchRequest(
      new Request(
        "https://transit.test/api/places?q=menteng&lat=-6.2&lng=106.8&limit=4&artifact=places-jabodetabek-20260718-v1",
      ),
      execute,
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual({
      network: "https://transit.test/artifacts/active.json",
      places: "https://transit.test/artifacts/places/active.json",
      input: {
        text: "menteng",
        limit: 4,
        biasCoordinate: { latitude: -6.2, longitude: 106.8 },
        artifactVersion: "places-jabodetabek-20260718-v1",
      },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects oversized place search text", async () => {
    let called = false;
    const execute: PlaceSearchExecutor = async () => {
      called = true;
      return {
        _tag: "NoMatch",
        placesArtifactVersion: coverage.placesArtifactVersion,
        networkArtifactVersion: coverage.networkArtifactVersion,
        queryText: "",
      };
    };
    const response = await handlePlaceSearchRequest(
      new Request(`https://transit.test/api/places?q=${"a".repeat(81)}`),
      execute,
    );
    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });

  it("passes nearby-transit JSON to the helper service", async () => {
    const body = {
      placeId: "place:menteng",
      radiusMeters: 600,
      maxCount: 4,
    };
    let seen: unknown;
    const execute: NearbyTransitExecutor = async (network, places, input) => {
      seen = { network, places, input };
      return {
        _tag: "NoneWithinCap",
        placesArtifactVersion: coverage.placesArtifactVersion,
        networkArtifactVersion: coverage.networkArtifactVersion,
        radiusMeters: 600,
        maxCount: 4,
      };
    };
    const response = await handleNearbyTransitRequest(
      new Request("https://transit.test/api/nearby-transit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      execute,
    );
    expect(response.status).toBe(200);
    expect(seen).toEqual({
      network: "https://transit.test/artifacts/active.json",
      places: "https://transit.test/artifacts/places/active.json",
      input: body,
    });
  });

  it("preserves structured lineOptions on route-guide success", async () => {
    const body = {
      origin: selectedPlace,
      destination: { ...selectedPlace, placeId: "place:test-dest", displayLabel: "Kota Tua" },
      originCandidates: [{ transitPlaceId: "tp:a", primaryName: "A" }],
      destinationCandidates: [{ transitPlaceId: "tp:b", primaryName: "B" }],
      networkArtifactVersion: coverage.networkArtifactVersion,
      placesArtifactVersion: coverage.placesArtifactVersion,
    };
    const alternative = {
      id: "guide:1",
      differenceSummary: "Rute utama",
      origin: { transitPlaceId: "tp:a", placeName: "A" },
      destination: { transitPlaceId: "tp:b", placeName: "B" },
      transferCount: 0,
      rideSteps: [
        {
          summary: "Board 9 or 9A",
          lineBadges: ["9", "9A"],
          linePhrase: "9 atau 9A",
          directionSummaries: ["toward Pinang Ranti"],
          boardingPlaceName: "A",
          alightingPlaceName: "B",
          intermediatePlaceNamesByOption: [
            { line: "9", placeNames: ["Mid"] },
            { line: "9A", placeNames: ["Mid A"] },
          ],
          lineOptions: [
            {
              routeId: "tj:9",
              passengerLineName: "9",
              patternId: "pattern:9",
              directionLabel: "Pinang Ranti",
              directionLabelAuthority: "Authoritative" as const,
              directionEvidenceClassification: "StableTripHeadsign" as const,
              intermediatePlaces: [{ transitPlaceId: "tp:mid", placeName: "Mid" }],
            },
            {
              routeId: "tj:9A",
              passengerLineName: "9A",
              patternId: "pattern:9A",
              directionLabel: "Pinang Ranti",
              directionLabelAuthority: "Authoritative" as const,
              directionEvidenceClassification: "StableTripHeadsign" as const,
              intermediatePlaces: [{ transitPlaceId: "tp:mid-a", placeName: "Mid A" }],
            },
          ],
          boarding: { transitPlaceId: "tp:a", placeName: "A" },
          alighting: { transitPlaceId: "tp:b", placeName: "B" },
        },
      ],
      transfers: [],
      metrics: {
        transferCount: 0,
        boardingCount: 1,
        intermediateStopCount: 1,
        directionAmbiguityCount: 0,
        routeComplexity: 1,
        transferHubPenalty: 0,
        variantLinePenalty: 0,
      },
      rideGeometry: [
        [
          [106.78, -6.16],
          [106.81, -6.22],
        ],
      ],
      rideSegments: [
        {
          coordinates: [
            [106.78, -6.16],
            [106.81, -6.22],
          ],
          color: "#31556f",
        },
      ],
      alternative: {
        id: "guide:1",
        origin: { transitPlaceId: "tp:a", placeName: "A" },
        destination: { transitPlaceId: "tp:b", placeName: "B" },
        rideSteps: [
          {
            lineOptions: [
              {
                routeId: "tj:9",
                passengerLineName: "9",
                patternId: "pattern:9",
                directionLabel: "Pinang Ranti",
                directionLabelAuthority: "Authoritative" as const,
                directionEvidenceClassification: "StableTripHeadsign" as const,
                intermediatePlaces: [{ transitPlaceId: "tp:mid", placeName: "Mid" }],
              },
              {
                routeId: "tj:9A",
                passengerLineName: "9A",
                patternId: "pattern:9A",
                directionLabel: "Pinang Ranti",
                directionLabelAuthority: "Authoritative" as const,
                directionEvidenceClassification: "StableTripHeadsign" as const,
                intermediatePlaces: [{ transitPlaceId: "tp:mid-a", placeName: "Mid A" }],
              },
            ],
            boarding: { transitPlaceId: "tp:a", placeName: "A" },
            alighting: { transitPlaceId: "tp:b", placeName: "B" },
          },
        ],
        transfers: [],
        metrics: {
          transferCount: 0,
          boardingCount: 1,
          intermediateStopCount: 1,
          directionAmbiguityCount: 0,
          routeComplexity: 1,
          transferHubPenalty: 0,
          variantLinePenalty: 0,
        },
      },
    };
    const execute: RouteGuideExecutor = async () =>
      ({
        _tag: "GuidesFound",
        origin: body.origin,
        destination: body.destination,
        alternatives: [alternative],
        coverage,
      }) as unknown as Awaited<ReturnType<RouteGuideExecutor>>;
    const response = await handleRouteGuideRequest(
      new Request("https://transit.test/api/route-guide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      execute,
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      alternatives: Array<{ rideSteps: Array<{ lineOptions: unknown[]; linePhrase: string }> }>;
    };
    expect(json.alternatives).toHaveLength(1);
    expect(json.alternatives[0]!.rideSteps[0]!.lineOptions).toHaveLength(2);
    expect(json.alternatives[0]!.rideSteps[0]!.linePhrase).toBe("9 atau 9A");
    expect(JSON.stringify(json)).not.toMatch(/departureSeconds|walkMinutes|fare/);
  });

  it("returns stale selection without treating it as a server failure", async () => {
    const execute: RouteGuideExecutor = async () =>
      ({
        _tag: "StaleSelection",
        reason: "versions drifted",
        expectedNetworkArtifactVersion: "bus-new",
        expectedPlacesArtifactVersion: "places-new",
        receivedNetworkArtifactVersion: "bus-old",
        receivedPlacesArtifactVersion: "places-old",
      }) as unknown as Awaited<ReturnType<RouteGuideExecutor>>;
    const response = await handleRouteGuideRequest(
      new Request("https://transit.test/api/route-guide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: selectedPlace,
          destination: selectedPlace,
          originCandidates: [{ transitPlaceId: "tp:a", primaryName: "A" }],
          destinationCandidates: [{ transitPlaceId: "tp:b", primaryName: "B" }],
          networkArtifactVersion: "bus-old",
          placesArtifactVersion: "places-old",
        }),
      }),
      execute,
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { _tag: string };
    expect(json._tag).toBe("StaleSelection");
  });

  it("maps internal helper failures without leaking details", async () => {
    const execute: RouteGuideExecutor = async () =>
      Promise.reject(new Error("secret stack and credentials"));
    const response = await handleRouteGuideRequest(
      new Request("https://transit.test/api/route-guide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      execute,
    );
    expect(response.status).toBe(503);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("credentials");
    expect(text).toContain("SERVICE_UNAVAILABLE");
  });

  it("serves artifact version disclosure", async () => {
    let seen: unknown;
    const execute: ArtifactVersionsExecutor = async (network, places) => {
      seen = { network, places };
      return {
        networkArtifactVersion: coverage.networkArtifactVersion,
        placesArtifactVersion: coverage.placesArtifactVersion,
        coverage,
      };
    };
    const response = await handleArtifactVersionsRequest(
      new Request("https://transit.test/api/artifact-versions"),
      execute,
    );
    expect(response.status).toBe(200);
    expect(seen).toEqual({
      network: "https://transit.test/artifacts/active.json",
      places: "https://transit.test/artifacts/places/active.json",
    });
    expect(response.headers.get("cache-control")).toContain("max-age=60");
  });
});
