import { describe, expect, it } from "vitest";

import type {
  ArtifactVersionsResponse,
  NearbyTransitChoiceDto,
  PassengerPlaceSearchResult,
} from "../../runtime/route-helper-contracts.js";
import {
  candidatesForEndpoint,
  editEndpointText,
  reverseEndpoints,
  selectPlaceResult,
  type EndpointPair,
} from "./place-endpoint-state.js";
import { guideRequestKeyFor, routeGuideRequestFor } from "./PlaceRouteHelper.js";

const placeResult = {
  placeId: "place:menteng",
  displayLabel: "Menteng",
  disambiguatingContext: "Jakarta Pusat",
  resultKind: "Area",
  representativeLocation: { _tag: "Placed", latitude: -6.194, longitude: 106.832 },
  matchEvidence: [{ _tag: "ExactPrimaryName" }],
  rankScore: 100,
} as unknown as PassengerPlaceSearchResult;

const choice = (id: string, name: string, distance: number) =>
  ({
    transitPlaceId: id,
    primaryName: name,
    geographicDistanceMeters: distance,
    servedRouteIds: ["tj:1"],
    selectionEvidence: ["nearby"],
    representativeLocation: { _tag: "Placed", latitude: -6.2, longitude: 106.8 },
  }) as unknown as NearbyTransitChoiceDto;

describe("place endpoint state", () => {
  it("keeps stable selection identity separately from passenger text", () => {
    const endpoint = selectPlaceResult(placeResult, "places-v1");
    expect(endpoint.typedText).toBe("Menteng");
    expect(endpoint.selected).toMatchObject({
      placeId: "place:menteng",
      artifactVersion: "places-v1",
      coordinate: { latitude: -6.194, longitude: 106.832 },
    });

    const edited = editEndpointText(endpoint, "Menten");
    expect(edited.typedText).toBe("Menten");
    expect(edited.selected).toBeUndefined();
  });

  it("reverses the complete endpoint state atomically, including resolved candidates", () => {
    const origin = {
      ...selectPlaceResult(placeResult, "places-v1"),
      nearby: { _tag: "Ready" as const, choices: [choice("tp:origin", "Origin", 120)] },
    };
    const destination = {
      ...selectPlaceResult(
        {
          ...placeResult,
          placeId: "place:kota",
          displayLabel: "Kota Tua",
        } as PassengerPlaceSearchResult,
        "places-v1",
      ),
      nearby: { _tag: "Ready" as const, choices: [choice("tp:destination", "Destination", 80)] },
    };
    const pair: EndpointPair = { origin, destination };

    const reversed = reverseEndpoints(pair);

    expect(reversed.origin).toBe(destination);
    expect(reversed.destination).toBe(origin);
    expect(candidatesForEndpoint(reversed.origin)[0]?.transitPlaceId).toBe("tp:destination");
  });

  it("derives every bounded nearby candidate without a separate UI lock", () => {
    const endpoint = {
      ...selectPlaceResult(placeResult, "places-v1"),
      nearby: {
        _tag: "Ready" as const,
        choices: [choice("tp:a", "A", 100), choice("tp:b", "B", 220)],
      },
    };
    expect(candidatesForEndpoint(endpoint)).toEqual([
      { transitPlaceId: "tp:a", primaryName: "A", geographicDistanceMeters: 100 },
      { transitPlaceId: "tp:b", primaryName: "B", geographicDistanceMeters: 220 },
    ]);
  });

  it("does not turn the suggested nearest choice into an implicit route lock", () => {
    const endpoint = {
      ...selectPlaceResult(placeResult, "places-v1"),
      nearby: {
        _tag: "Ready" as const,
        choices: [choice("tp:a", "A", 0), choice("tp:b", "B", 173)],
      },
    };

    expect(candidatesForEndpoint(endpoint)).toEqual([
      { transitPlaceId: "tp:a", primaryName: "A", geographicDistanceMeters: 0 },
      { transitPlaceId: "tp:b", primaryName: "B", geographicDistanceMeters: 173 },
    ]);
  });

  it("keeps an exact stop usable while local graph entry points resolve", () => {
    const endpoint = selectPlaceResult(
      {
        ...placeResult,
        resultKind: "TransitPlace",
        transitPlaceId: "tp:grogol",
      } as PassengerPlaceSearchResult,
      "places-v1",
    );

    expect(endpoint.nearby._tag).toBe("Loading");
    expect(candidatesForEndpoint(endpoint)).toEqual([]);

    expect(
      candidatesForEndpoint({ ...endpoint, nearby: { _tag: "Failed", message: "offline" } }),
    ).toEqual([
      {
        transitPlaceId: "tp:grogol",
        primaryName: "Menteng",
        geographicDistanceMeters: 0,
      },
    ]);
  });

  it("derives a guide request only after both endpoint candidate sets resolve", () => {
    const origin = selectPlaceResult(placeResult, "places-v1");
    const destination = selectPlaceResult(
      { ...placeResult, placeId: "place:kota", displayLabel: "Kota" } as PassengerPlaceSearchResult,
      "places-v1",
    );
    const versions = {
      networkArtifactVersion: "network-v1",
      placesArtifactVersion: "places-v1",
    } as ArtifactVersionsResponse;

    expect(routeGuideRequestFor({ origin, destination }, versions)).toBeUndefined();

    const request = routeGuideRequestFor(
      {
        origin: { ...origin, nearby: { _tag: "Ready", choices: [choice("tp:a", "A", 20)] } },
        destination: {
          ...destination,
          nearby: { _tag: "Ready", choices: [choice("tp:b", "B", 30)] },
        },
      },
      versions,
    );

    expect(request?.originCandidates.map((candidate) => candidate.transitPlaceId)).toEqual([
      "tp:a",
    ]);
    expect(request?.destinationCandidates.map((candidate) => candidate.transitPlaceId)).toEqual([
      "tp:b",
    ]);
    expect(request === undefined ? undefined : guideRequestKeyFor(request)).toBe(
      request === undefined ? undefined : guideRequestKeyFor({ ...request }),
    );
  });
});
