import { renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { EndpointButton, JourneyResults } from "./PassengerExplorer.js";
import { fixtureStops, searchFixtureJourneys } from "./fixtures.js";
import type { PassengerState, RouteQuery } from "./types.js";

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
    />
  ));

describe("passenger components", () => {
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
  });

  it("renders loading without replacing the journey region", () => {
    const html = renderResults({ _tag: "Searching", query });
    expect(html).toContain("Reading the corridors");
    expect(html).toContain("controls stay available");
  });

  it("renders no-route recovery", () => {
    const html = renderResults({ _tag: "NoRoute", query });
    expect(html).toContain("No route fits those rules");
    expect(html).toContain("Clear route rules");
  });

  it("renders offline-like request failure without mentioning the map", () => {
    const html = renderResults({ _tag: "Failed", query, message: "Connection lost" });
    expect(html).toContain("Routes are offline");
    expect(html).toContain("Connection lost");
    expect(html).toContain("Try again");
  });
});
