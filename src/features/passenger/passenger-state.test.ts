import { describe, expect, it, vi } from "vitest";

import { fixtureRouteIds, fixtureStops, searchFixtureJourneys } from "./fixtures.js";
import {
  describePassengerState,
  runPassengerSearch,
  setLineConstraint,
  setLockedLeg,
} from "./passenger-state.js";
import type {
  JourneyEndpoint,
  PassengerRoutingAdapter,
  PassengerState,
  RouteQuery,
} from "./types.js";

const stopEndpoint = (index: number): JourneyEndpoint => {
  const stop = fixtureStops[index];
  if (stop === undefined) throw new Error(`Missing fixture stop ${index}`);
  return { _tag: "Stop", stop };
};

const query: RouteQuery = {
  origin: stopEndpoint(0),
  destination: stopEndpoint(3),
  lineConstraints: [],
};

describe("passenger state", () => {
  it("renders a description for every tagged state", () => {
    const states: ReadonlyArray<PassengerState> = [
      { _tag: "Idle" },
      { _tag: "ChoosingEndpoint", endpoint: "origin" },
      { _tag: "Searching", query },
      {
        _tag: "Results",
        query,
        journeys: searchFixtureJourneys(query),
        selectedJourneyId: "direct-one",
      },
      { _tag: "NoRoute", query },
      { _tag: "Failed", query, message: "Offline" },
    ];

    expect(states.map(describePassengerState)).toEqual([
      "Choose where to start",
      "Choose origin",
      "Finding routes",
      "3 routes found",
      "No route found",
      "Offline",
    ]);
  });

  it.each(["Exclude", "Prefer", "Require"] as const)(
    "sends one exact query when a line is marked %s",
    async (constraint) => {
      const search = vi.fn(async () => searchFixtureJourneys(query));
      const adapter: PassengerRoutingAdapter = { search };
      const refined = setLineConstraint({ query, routeId: fixtureRouteIds.one, constraint });

      await runPassengerSearch({ adapter, query: refined, onState: () => undefined });

      expect(search).toHaveBeenCalledOnce();
      expect(search).toHaveBeenCalledWith({
        ...query,
        lineConstraints: [{ _tag: constraint, routeId: fixtureRouteIds.one }],
      });
    },
  );

  it("replaces a rule for the same line instead of producing contradictory constraints", () => {
    const preferred = setLineConstraint({
      query,
      routeId: fixtureRouteIds.one,
      constraint: "Prefer",
    });
    const excluded = setLineConstraint({
      query: preferred,
      routeId: fixtureRouteIds.one,
      constraint: "Exclude",
    });

    expect(excluded.lineConstraints).toEqual([{ _tag: "Exclude", routeId: fixtureRouteIds.one }]);
  });

  it("keeps the query in one composable rule family", () => {
    const preferred = setLineConstraint({
      query,
      routeId: fixtureRouteIds.one,
      constraint: "Prefer",
    });
    const excluded = setLineConstraint({
      query: preferred,
      routeId: fixtureRouteIds.sixB,
      constraint: "Exclude",
    });

    expect(excluded.lineConstraints).toEqual([{ _tag: "Exclude", routeId: fixtureRouteIds.sixB }]);
  });

  it("sends one exact query when a journey leg is locked", async () => {
    const search = vi.fn(async () => searchFixtureJourneys(query));
    const journey = searchFixtureJourneys(query)[0];
    const lockedLeg = journey?.legs.find((leg) => leg._tag === "Transit")?.lock;
    if (lockedLeg === undefined) throw new Error("Expected a lockable fixture leg");
    const refined = setLockedLeg({ query, lockedLeg });

    await runPassengerSearch({ adapter: { search }, query: refined, onState: () => undefined });

    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith({ ...query, lockedLeg });
  });

  it("moves through searching and results", async () => {
    const states: Array<PassengerState> = [];
    await runPassengerSearch({
      adapter: { search: async () => searchFixtureJourneys(query) },
      query,
      onState: (state) => states.push(state),
    });

    expect(states.map((state) => state._tag)).toEqual(["Searching", "Results"]);
  });

  it("keeps failures typed as a failed UI state", async () => {
    const states: Array<PassengerState> = [];
    await runPassengerSearch({
      adapter: { search: async () => Promise.reject(new Error("Connection lost")) },
      query,
      onState: (state) => states.push(state),
    });

    expect(states.at(-1)).toEqual({ _tag: "Failed", query, message: "Connection lost" });
  });

  it("returns no route when requirements cannot be satisfied", () => {
    const impossible = setLineConstraint({
      query: setLineConstraint({
        query,
        routeId: fixtureRouteIds.one,
        constraint: "Exclude",
      }),
      routeId: fixtureRouteIds.one,
      constraint: "Require",
    });

    // The setter intentionally replaces contradictory rules. Two distinct route rules can still remove every fixture.
    const none = setLineConstraint({
      query: setLineConstraint({
        query: impossible,
        routeId: fixtureRouteIds.sixB,
        constraint: "Exclude",
      }),
      routeId: fixtureRouteIds.one,
      constraint: "Exclude",
    });
    expect(searchFixtureJourneys(none)).toEqual([]);
  });
});
