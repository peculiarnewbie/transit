import { describe, expect, it } from "vitest";

import type { GuideAlternative } from "../route-guide/model.js";
import { distinctPassengerAlternatives } from "./route-helper-query.js";

const place = (id: string, name: string) => ({
  transitPlaceId: id,
  placeName: name,
  member: { stopId: `${id}:member`, stopName: name },
});

const alternative = (id: string, connectorMeters: number, direction = "Juanda") =>
  ({
    id,
    origin: place("place:pasar-minggu", "Pasar Minggu"),
    destination: place("place:juanda", "Juanda"),
    rideSteps: [
      {
        lineOptions: [
          {
            routeId: "route:4B",
            passengerLineName: "4B",
            patternId: "pattern:4B",
            directionLabel: "Stasiun Manggarai",
            directionLabelAuthority: "Authoritative",
            directionEvidenceClassification: "StableTripHeadsign",
            intermediatePlaces: [],
          },
          {
            routeId: "route:6M",
            passengerLineName: "6M",
            patternId: "pattern:6M",
            directionLabel: "Blok M",
            directionLabelAuthority: "Authoritative",
            directionEvidenceClassification: "StableTripHeadsign",
            intermediatePlaces: [],
          },
          {
            routeId: "route:10H",
            passengerLineName: "10H",
            patternId: "pattern:10H",
            directionLabel: direction,
            directionLabelAuthority: "Authoritative",
            directionEvidenceClassification: "StableTripHeadsign",
            intermediatePlaces: [],
          },
        ],
        boarding: place("place:pasar-minggu", "Pasar Minggu"),
        alighting: place("place:juanda", "Juanda"),
      },
    ],
    transfers: [],
    metrics: {
      transferCount: 2,
      boardingCount: 3,
      intermediateStopCount: 8,
      originCandidateDistanceMeters: 0,
      destinationCandidateDistanceMeters: connectorMeters,
      directionAmbiguityCount: 0,
      routeComplexity: 3,
      transferHubPenalty: 0,
      variantLinePenalty: 0,
    },
  }) as unknown as GuideAlternative;

describe("passenger alternative filtering", () => {
  it("keeps one closest representative for duplicate passenger-visible journeys", () => {
    const alternatives = distinctPassengerAlternatives([
      alternative("guide:far", 301),
      alternative("guide:closest", 0),
      alternative("guide:other-direction", 0, "Tanjung Priok"),
    ]);

    expect(alternatives.map((entry) => entry.id)).toEqual([
      "guide:closest",
      "guide:other-direction",
    ]);
  });
});
