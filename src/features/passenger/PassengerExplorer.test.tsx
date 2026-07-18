import { renderToString } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

import {
  EndpointButton,
  JourneyResults,
  endpointSearchText,
  scheduleStopSearch,
} from "./PassengerExplorer.js";
import { fixtureStops, searchFixtureJourneys } from "./fixtures.js";
import type { PassengerState, RouteQuery } from "./types.js";
import PlaceRouteHelper from "./PlaceRouteHelper.js";

const fixtureStop = (index: number) => {
  const stop = fixtureStops[index];
  if (stop === undefined) throw new Error(`Missing fixture stop ${index}`);
  return stop;
};

const query: RouteQuery = {
  origin: { _tag: "Stop", stop: fixtureStop(0) },
  destination: { _tag: "Stop", stop: fixtureStop(3) },
  lineConstraints: [],
};

const noOp = () => undefined;
const renderResults = (state: PassengerState) =>
  renderToString(() => (
    <JourneyResults
      state={state}
      onSelect={noOp}
      onLineConstraint={noOp}
      onLockLeg={noOp}
      onRetry={noOp}
      onClearRules={noOp}
      onChangeStops={noOp}
    />
  ));

describe("passenger components", () => {
  it("renders the place-first route helper over the required map", () => {
    const html = renderToString(() => <PlaceRouteHelper />);
    expect(html).toContain("Mau ke mana?");
    expect(html).toContain('id="origin-place"');
    expect(html).toContain('id="destination-place"');
    expect(html).toContain("Tukar tempat asal dan tujuan");
    expect(html).toContain("Memuat peta");
    expect(html).not.toContain("Buka peta (opsional)");
    expect(html).not.toContain("Tampilkan rute bus");
    expect(html).not.toContain("Naik dari sekitar asal");
    expect(html).not.toContain("departure");
  });

  it("renders endpoint controls independently of map readiness", () => {
    const html = renderToString(() => (
      <>
        <EndpointButton kind="origin" active={false} onChoose={noOp} />
        <EndpointButton kind="destination" active={false} onChoose={noOp} />
      </>
    ));

    expect(html).toContain("Choose from");
    expect(html).toContain("Choose to");
  });

  it("keeps the selected stop name when reopening an endpoint", () => {
    expect(endpointSearchText({ _tag: "Stop", stop: fixtureStop(0) })).toBe(fixtureStop(0).name);
    expect(endpointSearchText(undefined)).toBe("");
  });

  it("renders journey cards and every line action without map readiness", () => {
    const journeys = searchFixtureJourneys(query);
    const firstJourney = journeys[0];
    if (firstJourney === undefined) throw new Error("Expected fixture journeys");
    const html = renderResults({
      _tag: "Results",
      query,
      journeys,
      selectedJourneyId: firstJourney.id,
    });
    const visibleText = html.replaceAll(/<!--\/?\$-->/g, "");

    expect(visibleText).toContain("Direct on Corridor 1");
    expect(visibleText).toContain("Prefer 1");
    expect(visibleText).toContain("Require 1");
    expect(visibleText).toContain("Avoid 1");
    expect(visibleText).toContain("Lock this leg");
    expect(html).toContain('aria-label="Journey options"');
    expect(html).toContain('tabindex="0"');
  });

  it("renders loading without replacing the journey region", () => {
    const html = renderResults({ _tag: "Searching", query });
    expect(html).toContain("Reading the corridors");
    expect(html).toContain("controls stay available");
  });

  it("renders no-route recovery", () => {
    const html = renderResults({ _tag: "NoRoute", query });
    expect(html).toContain("No route found between these stops");
    expect(html).toContain("Choose another stop");
  });

  it("debounces stop input so only the final query is searched", () => {
    vi.useFakeTimers();
    try {
      const searched: Array<string> = [];
      const cancelFirst = scheduleStopSearch({
        query: "sema",
        onSearch: (query) => searched.push(query),
      });
      vi.advanceTimersByTime(200);
      cancelFirst();
      scheduleStopSearch({
        query: "semanggi",
        onSearch: (query) => searched.push(query),
      });

      vi.advanceTimersByTime(349);
      expect(searched).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(searched).toEqual(["semanggi"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders offline-like request failure without mentioning the map", () => {
    const html = renderResults({ _tag: "Failed", query, message: "Connection lost" });
    expect(html).toContain("Routes are offline");
    expect(html).toContain("Connection lost");
    expect(html).toContain("Try again");
  });
});
