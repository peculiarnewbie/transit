import { describe, expect, it, vi } from "vitest";

import { NoRoute } from "../../routing/index.js";
import { fixtureStops, searchFixtureJourneys } from "../../features/passenger/fixtures.js";
import type { RouteQuery } from "../../features/passenger/types.js";
import { handleJourneyRequest } from "./journeys.js";
import { handleStopRequest } from "./stops.js";

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

const validBody = {
  origin: { _tag: "Stop", stopId: "tj:bundaran-hi" },
  destination: { _tag: "Stop", stopId: "tj:gbk" },
  serviceDate: "2026-07-18",
  departureSeconds: 28_800,
  maximumResults: 4,
  lineRules: [],
};

describe("passenger API routes", () => {
  it("passes a bounded JSON body to the journey service", async () => {
    const execute = vi.fn(async () => ({ journeys: searchFixtureJourneys(query) }));
    const response = await handleJourneyRequest(
      new Request("https://transit.test/api/journeys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody),
      }),
      execute,
    );

    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledWith("https://transit.test/artifacts/active.json", validBody);
    expect(await response.text()).toContain('"direct-one"');
  });

  it("rejects malformed, oversized, and non-JSON request bodies", async () => {
    const execute = vi.fn();
    const malformed = await handleJourneyRequest(
      new Request("https://transit.test/api/journeys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      execute,
    );
    const oversized = await handleJourneyRequest(
      new Request("https://transit.test/api/journeys", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "40000" },
        body: "{}",
      }),
      execute,
    );
    const unsupported = await handleJourneyRequest(
      new Request("https://transit.test/api/journeys", { method: "POST", body: "{}" }),
      execute,
    );

    expect([malformed.status, oversized.status, unsupported.status]).toEqual([400, 400, 415]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps no-route and internal failures without leaking details", async () => {
    const noRoute = await handleJourneyRequest(
      new Request("https://transit.test/api/journeys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody),
      }),
      async () => Promise.reject(new NoRoute({ reason: "secret graph detail" })),
    );
    const internal = await handleJourneyRequest(
      new Request("https://transit.test/api/journeys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody),
      }),
      async () => Promise.reject(new Error("provider stack and credentials")),
    );

    expect(noRoute.status).toBe(404);
    expect(JSON.stringify(await noRoute.json())).not.toContain("secret graph detail");
    expect(internal.status).toBe(503);
    expect(JSON.stringify(await internal.json())).not.toContain("credentials");
  });

  it("parses and bounds stop search parameters", async () => {
    const execute = vi.fn(async () => ({ stops: fixtureStops.slice(0, 2) }));
    const response = await handleStopRequest(
      new Request("https://transit.test/api/stops?q=tosari&lat=-6.2&lng=106.8&limit=2"),
      execute,
    );

    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledWith("https://transit.test/artifacts/active.json", {
      query: "tosari",
      coordinate: { latitude: -6.2, longitude: 106.8 },
      limit: 2,
    });
    expect(response.headers.get("cache-control")).toContain("max-age=60");
  });
});
