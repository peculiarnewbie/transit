import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { JourneyRequest } from "../../runtime/api-contracts.js";
import { createApiPassengerAdapter } from "./api-adapter.js";
import { fixtureRouteIds, fixtureStops, searchFixtureJourneys } from "./fixtures.js";
import type { RouteQuery } from "./types.js";

const fixtureStop = (index: number) => {
  const stop = fixtureStops[index];
  if (stop === undefined) throw new Error(`Missing fixture stop ${index}`);
  return stop;
};

const query: RouteQuery = {
  origin: { _tag: "Stop", stop: fixtureStop(0) },
  destination: { _tag: "Stop", stop: fixtureStop(3) },
  lineConstraints: [{ _tag: "Require", routeId: fixtureRouteIds.one }],
};

describe("passenger API adapter", () => {
  it("sends the exact route rules and decodes journey DTOs", async () => {
    const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      requests.push({ url: input instanceof Request ? input.url : String(input), init });
      return Response.json({ journeys: searchFixtureJourneys(query) });
    };
    const adapter = createApiPassengerAdapter(fetcher, () => new Date("2026-07-18T01:00:00.000Z"));

    const journeys = await adapter.search(query);
    const recorded = requests[0];
    if (recorded?.init?.body === undefined) throw new Error("Expected a request body");
    const body = Schema.decodeUnknownSync(JourneyRequest)(JSON.parse(String(recorded.init.body)));

    expect(recorded.url).toBe("/api/journeys");
    expect(body.serviceDate).toBe("2026-07-18");
    expect(body.departureSeconds).toBe(28_800);
    expect(body.lineRules).toEqual([{ _tag: "Require", routeId: fixtureRouteIds.one }]);
    expect(journeys[0]?.geometry.length).toBeGreaterThan(1);
  });

  it("passes cancellation to fetch and treats no-route as an empty result", async () => {
    let receivedSignal: AbortSignal | null | undefined;
    const fetcher: typeof globalThis.fetch = async (_input, init) => {
      receivedSignal = init?.signal;
      return Response.json({ error: { code: "NO_ROUTE", message: "No route" } }, { status: 404 });
    };
    const adapter = createApiPassengerAdapter(fetcher, () => new Date("2026-07-18T01:00:00.000Z"));
    const controller = new AbortController();

    const journeys = await adapter.search(query, { signal: controller.signal });

    expect(receivedSignal).toBe(controller.signal);
    expect(journeys).toEqual([]);
  });

  it("loads bounded stop suggestions from the real stop endpoint", async () => {
    let requestedUrl: string | undefined;
    const fetcher: typeof globalThis.fetch = async (input) => {
      requestedUrl = input instanceof Request ? input.url : String(input);
      return Response.json({ stops: fixtureStops.slice(0, 2) });
    };
    const adapter = createApiPassengerAdapter(fetcher, () => new Date("2026-07-18T01:00:00.000Z"));

    const stops = await adapter.searchStops?.("tosari", {
      reachableFromStopId: fixtureStop(0).id,
    });

    expect(stops).toHaveLength(2);
    expect(stops?.[0]?.name).toBe("Bundaran HI Astra");
    expect(requestedUrl).toBe(
      `/api/stops?q=tosari&limit=8&from=${encodeURIComponent(fixtureStop(0).id)}&date=2026-07-18&departure=28800`,
    );
  });
});
