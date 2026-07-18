import { readFileSync } from "node:fs";

import { renderToString } from "solid-js/web";
import { ConfigProvider, Effect, Layer, ManagedRuntime, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { JourneyResults } from "../features/passenger/PassengerExplorer.js";
import { NetworkSnapshot, StopId } from "../domain/transit/index.js";
import { RouteQuery } from "./route-query.js";
import { ApplicationRuntime } from "./application.js";
import { ArtifactStore } from "./artifact-store.js";

const baseUrl = "https://transit.test/artifacts/";
const manifestUrl = `${baseUrl}active.json`;
const activeArtifactVersion = "bus-transjakarta-20260629-v1";
const manifest = readFileSync("public/artifacts/active.json", "utf8");
const snapshot = readFileSync("public/artifacts/bus-demo-20260718-v1.network.json", "utf8");
const geometry = readFileSync("public/artifacts/bus-demo-20260718-v1.geometry.json", "utf8");

const groupedStationSnapshot = (() => {
  const decoded = Schema.decodeUnknownSync(NetworkSnapshot)(JSON.parse(snapshot));
  const platform = decoded.stops.find((stop) => stop.id === "tj:bundaran-hi");
  if (platform === undefined) throw new Error("Missing Bundaran HI fixture platform");
  const stationId = StopId.make("tj:bundaran-hi-station");
  const secondPlatformId = StopId.make("tj:bundaran-hi-platform-2");
  return JSON.stringify(
    Schema.encodeUnknownSync(NetworkSnapshot)({
      ...decoded,
      stops: [
        ...decoded.stops.map((stop) =>
          stop.id === platform.id ? { ...stop, parentStopId: stationId } : stop,
        ),
        { ...platform, id: stationId },
        { ...platform, id: secondPlatformId, parentStopId: stationId },
      ],
    }),
  );
})();

const transferOnlySnapshot = (() => {
  const decoded = Schema.decodeUnknownSync(NetworkSnapshot)(JSON.parse(snapshot));
  const template = decoded.stops.find((stop) => stop.id === "tj:gbk");
  if (template === undefined) throw new Error("Missing GBK fixture stop");
  const transferOnlyStopId = StopId.make("tj:transfer-only");
  return JSON.stringify(
    Schema.encodeUnknownSync(NetworkSnapshot)({
      ...decoded,
      stops: [...decoded.stops, { ...template, id: transferOnlyStopId, name: "Transfer Only" }],
      patterns: decoded.patterns.map((pattern) =>
        pattern.id === "pattern:tj:9C:west"
          ? { ...pattern, stopIds: ["tj:semanggi", transferOnlyStopId] }
          : pattern,
      ),
      trips: decoded.trips.map((trip) =>
        trip.patternId === "pattern:tj:9C:west" && trip.availability._tag === "Scheduled"
          ? {
              ...trip,
              availability: {
                ...trip.availability,
                stopTimes: trip.availability.stopTimes.map((stopTime) =>
                  stopTime.stopId === "tj:gbk"
                    ? { ...stopTime, stopId: transferOnlyStopId }
                    : stopTime,
                ),
              },
            }
          : trip,
      ),
    }),
  );
})();

const artifactFetch =
  (
    loaded: Array<string>,
    geometryBody = geometry,
    manifestBody = manifest,
    snapshotBody = snapshot,
  ): typeof globalThis.fetch =>
  async (input) => {
    const url = String(input);
    loaded.push(url);
    if (url === manifestUrl) return new Response(manifestBody);
    if (url.endsWith(".network.json")) return new Response(snapshotBody);
    if (url.endsWith(".geometry.json")) return new Response(geometryBody);
    return new Response("not found", { status: 404 });
  };

const request = (overrides: Record<string, unknown> = {}) => ({
  origin: { _tag: "Stop", stopId: "tj:bundaran-hi" },
  destination: { _tag: "Stop", stopId: "tj:gbk" },
  serviceDate: "2026-07-18",
  departureSeconds: 28_800,
  maximumResults: 6,
  lineRules: [],
  ...overrides,
});

const makeTestRuntime = (loaded: Array<string>) =>
  ManagedRuntime.make(ApplicationRuntime.layerWith({ manifestUrl, fetch: artifactFetch(loaded) }));

type TestRuntime = ReturnType<typeof makeTestRuntime>;

const withRuntime = async <A,>(run: (runtime: TestRuntime) => Promise<A>) => {
  const loaded: Array<string> = [];
  const runtime = makeTestRuntime(loaded);
  try {
    return { value: await run(runtime), loaded };
  } finally {
    await runtime.dispose();
  }
};

const journeys = (runtime: TestRuntime, input: unknown) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const service = yield* RouteQuery.Service;
      return yield* service.journeys(input);
    }),
  );

describe("bus vertical slice", () => {
  it("acquires one immutable artifact pair for multiple route queries", async () => {
    const result = await withRuntime(async (runtime) => {
      const first = await journeys(runtime, request());
      const second = await journeys(
        runtime,
        request({
          origin: {
            _tag: "Coordinate",
            coordinate: { longitude: 106.8232, latitude: -6.1989 },
          },
        }),
      );
      return { first, second };
    });

    expect(result.value.first.journeys.length).toBeGreaterThan(0);
    expect(result.value.second.journeys.length).toBeGreaterThan(0);
    expect(result.loaded).toHaveLength(3);
  });

  it("reads the manifest location from a deterministic Effect config provider", async () => {
    const loaded: Array<string> = [];
    const configuredLayer = ArtifactStore.layerConfig(
      "https://invalid.test/default.json",
      artifactFetch(loaded),
    ).pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ TRANSIT_ARTIFACT_MANIFEST_URL: manifestUrl }),
        ),
      ),
    );
    const runtime = ManagedRuntime.make(configuredLayer);
    try {
      const artifacts = await runtime.runPromise(ArtifactStore.Service);
      expect(artifacts.version).toBe(activeArtifactVersion);
      expect(loaded[0]).toBe(manifestUrl);
    } finally {
      await runtime.dispose();
    }
  });

  it("bounds stop discovery and reports dates without service as no-route", async () => {
    const result = await withRuntime(async (runtime) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RouteQuery.Service;
          const stops = yield* service.searchStops({ query: "a", limit: 2 });
          const unavailable = yield* Effect.result(
            service.journeys(request({ serviceDate: "2031-01-01" })),
          );
          return { stops, unavailable };
        }),
      ),
    );

    expect(result.value.stops.stops).toHaveLength(2);
    expect(Result.isFailure(result.value.unavailable)).toBe(true);
    if (Result.isFailure(result.value.unavailable))
      expect(result.value.unavailable.failure._tag).toBe("Routing.NoRoute");
  });

  it("returns one station result for child platforms and routes through the station", async () => {
    const runtime = ManagedRuntime.make(
      ApplicationRuntime.layerWith({
        manifestUrl,
        fetch: artifactFetch([], geometry, manifest, groupedStationSnapshot),
      }),
    );
    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RouteQuery.Service;
          const stops = yield* service.searchStops({ query: "Bundaran HI", limit: 8 });
          const routed = yield* service.journeys(
            request({
              origin: { _tag: "Stop", stopId: "tj:bundaran-hi-station" },
            }),
          );
          return { stops, routed };
        }),
      );

      expect(result.stops.stops).toHaveLength(1);
      expect(result.stops.stops[0]?.id).toBe("tj:bundaran-hi-station");
      expect(result.routed.journeys.length).toBeGreaterThan(0);
    } finally {
      await runtime.dispose();
    }
  });

  it("only suggests destinations reachable without changing buses", async () => {
    const runtime = ManagedRuntime.make(
      ApplicationRuntime.layerWith({
        manifestUrl,
        fetch: artifactFetch([], geometry, manifest, transferOnlySnapshot),
      }),
    );
    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* RouteQuery.Service;
          const direct = yield* service.searchStops({
            query: "Semanggi",
            reachableFromStopId: "tj:bundaran-hi",
            serviceDate: "2026-07-18",
            departureSeconds: 28_800,
            limit: 8,
          });
          const transferOnly = yield* service.searchStops({
            query: "Transfer Only",
            reachableFromStopId: "tj:bundaran-hi",
            serviceDate: "2026-07-18",
            departureSeconds: 28_800,
            limit: 8,
          });
          const unavailable = yield* service.searchStops({
            query: "Semanggi",
            reachableFromStopId: "tj:bundaran-hi",
            serviceDate: "2031-01-01",
            departureSeconds: 28_800,
            limit: 8,
          });
          return { direct, transferOnly, unavailable };
        }),
      );

      expect(result.direct.stops.map((stop) => stop.name)).toContain("Semanggi");
      expect(result.transferOnly.stops).toEqual([]);
      expect(result.unavailable.stops).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("clips journey geometry to the boarded section of a route", async () => {
    const result = await withRuntime((runtime) =>
      journeys(
        runtime,
        request({
          origin: { _tag: "Stop", stopId: "tj:tosari" },
          destination: { _tag: "Stop", stopId: "tj:semanggi" },
        }),
      ),
    );

    expect(result.value.journeys[0]?.geometry).toEqual([
      [106.8232, -6.1989],
      [106.8228, -6.2057],
      [106.8096, -6.2195],
    ]);
  });

  it("rejects an activation that mixes topology and geometry generations", async () => {
    const loaded: Array<string> = [];
    const first = await Effect.runPromise(
      ArtifactStore.load({ manifestUrl, fetch: artifactFetch(loaded) }),
    );
    const nextManifest = manifest.replace(activeArtifactVersion, `${activeArtifactVersion}-next`);
    const nextGeometry = geometry.replace("2026-07-18T00:00:00.000Z", "2026-07-19T00:00:00.000Z");
    const switched = await Effect.runPromise(
      Effect.result(
        ArtifactStore.load({
          manifestUrl,
          fetch: artifactFetch([], nextGeometry, nextManifest),
        }),
      ),
    );

    expect(first.version).toBe(activeArtifactVersion);
    expect(Result.isFailure(switched)).toBe(true);
    if (Result.isFailure(switched))
      expect(switched.failure.reason).toContain("different compilation runs");
  });

  it("supports direct, transfer, exclusion, requirement, and locked-leg searches", async () => {
    const result = await withRuntime(async (runtime) => {
      const direct = await journeys(runtime, request());
      const transfer = await journeys(
        runtime,
        request({
          origin: { _tag: "Stop", stopId: "tj:dukuh-atas" },
          lineRules: [
            { _tag: "Require", routeId: "tj:6B" },
            { _tag: "Require", routeId: "tj:9C" },
          ],
        }),
      );
      const excluded = await journeys(
        runtime,
        request({
          origin: { _tag: "Stop", stopId: "tj:dukuh-atas" },
          lineRules: [{ _tag: "Exclude", routeId: "tj:1" }],
        }),
      );
      const required = await journeys(
        runtime,
        request({ lineRules: [{ _tag: "Require", routeId: "tj:1" }] }),
      );
      const firstTransit = direct.journeys[0]?.legs.find((leg) => leg._tag === "Transit");
      if (firstTransit === undefined) throw new Error("Expected a transit leg");
      const locked = await journeys(runtime, request({ lockedLeg: firstTransit.lock }));
      return { direct, transfer, excluded, required, locked };
    });

    expect(result.value.direct.journeys[0]?.label).toContain("1");
    expect(result.value.direct.journeys[0]?.legs.find((leg) => leg._tag === "Transit")).toEqual(
      expect.objectContaining({ color: "#c6312c" }),
    );
    expect(result.value.transfer.journeys[0]?.transfers).toBe(1);
    expect(
      result.value.excluded.journeys
        .flatMap((journey) => journey.legs)
        .some((leg) => leg._tag === "Transit" && leg.routeId === "tj:1"),
    ).toBe(false);
    expect(result.value.required.journeys[0]?.label).toContain("1");
    expect(result.value.locked.journeys[0]?.legs).toContainEqual(
      expect.objectContaining({ _tag: "Transit", routeId: "tj:1" }),
    );
  });

  it("renders returned itinerary cards without depending on the map", async () => {
    const result = await withRuntime((runtime) => journeys(runtime, request()));
    const first = result.value.journeys[0];
    if (first === undefined) throw new Error("Expected a journey");
    const query = {
      origin: {
        _tag: "MapPoint" as const,
        coordinate: { longitude: 106.823, latitude: -6.193 },
        label: "Origin",
      },
      destination: {
        _tag: "MapPoint" as const,
        coordinate: { longitude: 106.8003, latitude: -6.2242 },
        label: "Destination",
      },
      lineConstraints: [],
    };
    const html = renderToString(() => (
      <JourneyResults
        state={{
          _tag: "Results",
          query,
          journeys: result.value.journeys,
          selectedJourneyId: first.id,
        }}
        onSelect={() => undefined}
        onLineConstraint={() => undefined}
        onLockLeg={() => undefined}
        onRetry={() => undefined}
        onClearRules={() => undefined}
        onChangeStops={() => undefined}
      />
    ));

    const visibleText = html.replaceAll(/<!--\/?\$-->/g, "");
    expect(visibleText).toContain("Direct on 1");
    expect(visibleText).toContain("Require 1");
    expect(first.geometry.length).toBeGreaterThan(1);
  });
});
