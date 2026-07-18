import { renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import type { RouteGuideFound } from "../../runtime/route-helper-contracts.js";
import RouteGuideResults from "./RouteGuideResults.js";

const result = {
  _tag: "GuidesFound",
  alternatives: [
    {
      id: "guide:9-9a",
      differenceSummary: "Langsung, tanpa pindah",
      origin: { transitPlaceId: "tp:cawang", placeName: "Cawang" },
      destination: { transitPlaceId: "tp:grogol", placeName: "Grogol Reformasi" },
      transferCount: 0,
      rideSteps: [
        {
          lineBadges: ["9", "9A"],
          linePhrase: "9 atau 9A",
          directionSummaries: ["Pluit", "Grogol via Semanggi"],
          boardingPlaceName: "Cawang",
          alightingPlaceName: "Grogol Reformasi",
          boardingMemberDetail: "Halte Cawang Sentral",
          intermediatePlaceNamesByOption: [
            { line: "9", placeNames: ["Pancoran", "Semanggi"] },
            { line: "9A", placeNames: ["Tebet", "Semanggi"] },
          ],
          lineOptions: [
            {
              passengerLineName: "9",
              directionLabel: "Pluit",
              intermediatePlaces: [],
            },
            {
              passengerLineName: "9A",
              directionLabel: "Grogol via Semanggi",
              intermediatePlaces: [],
            },
          ],
        },
      ],
      transfers: [],
    },
  ],
  coverage: {
    mode: "bus-only",
    networkArtifactVersion: "bus-v1",
    placesArtifactVersion: "places-v1",
    attribution: "© OpenStreetMap contributors",
    freshnessNote: "Data bus 2026-07-18; tanpa jadwal.",
  },
} as unknown as RouteGuideFound;

describe("passenger route-guide presentation", () => {
  it("renders interchangeable lines as one shared passenger action", () => {
    const html = renderToString(() => (
      <RouteGuideResults result={result} selectedAlternativeId="guide:9-9a" />
    ));
    const text = html.replaceAll(/<!--[^>]*-->/g, "");

    expect(text).toContain("9 atau 9A");
    expect(text).toContain("Naik di Cawang, turun di Grogol Reformasi");
    expect(text).toContain("Jalur 9 · Pluit");
    expect(text).toContain("Jalur 9A · Grogol via Semanggi");
    expect(text).toContain("Pancoran");
    expect(text).toContain("Tebet");
    expect(html.match(/<article/g)).toHaveLength(1);
  });

  it("states platform uncertainty, coverage, freshness, and absent timing honestly", () => {
    const html = renderToString(() => (
      <RouteGuideResults result={result} selectedAlternativeId="guide:9-9a" />
    ));
    expect(html).toContain("Titik turun spesifik belum diketahui");
    expect(html).toContain("Cakupan bus saja");
    expect(html).toContain("Data bus 2026-07-18; tanpa jadwal");
    expect(html).not.toMatch(/departure|arrival|waitMinutes|walkMinutes|fare/i);
  });

  it("separates a nearby boarding connector from bus transfers", () => {
    const nearbyResult = {
      ...result,
      origin: { displayLabel: "Grogol" },
      destination: { displayLabel: "Semanggi" },
      alternatives: result.alternatives.map((alternative) => ({
        ...alternative,
        origin: { ...alternative.origin, placeName: "Grogol Reformasi" },
        destination: { ...alternative.destination, placeName: "Semanggi" },
        metrics: {
          transferCount: 0,
          boardingCount: 1,
          intermediateStopCount: 3,
          originCandidateDistanceMeters: 173,
          destinationCandidateDistanceMeters: 0,
          directionAmbiguityCount: 0,
          routeComplexity: 1,
          transferHubPenalty: 0,
          variantLinePenalty: 0,
        },
      })),
    } as unknown as RouteGuideFound;

    const html = renderToString(() => (
      <RouteGuideResults result={nearbyResult} selectedAlternativeId="guide:9-9a" />
    ));
    expect(html).toContain("Grogol → Grogol Reformasi · ± 173 m garis lurus");
    expect(html).toContain("bukan rute berjalan");
    expect(html).toContain("langsung tanpa pindah bus");
  });

  it("collapses a selected alternative to a map-first route summary", () => {
    const html = renderToString(() => (
      <RouteGuideResults result={result} selectedAlternativeId="guide:9-9a" compact />
    ));

    expect(html).toContain("Cawang");
    expect(html).toContain("Grogol Reformasi");
    expect(html).not.toContain("Urutan halte antara");
    expect(html).not.toContain("Cakupan bus saja");
  });
});
