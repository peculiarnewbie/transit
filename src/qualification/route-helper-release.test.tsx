import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { renderToString } from "solid-js/web";
import { Effect, ManagedRuntime, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { loadFromJsonText } from "../acceptance/route-helper/load.js";
import RouteGuideResults from "../features/passenger/RouteGuideResults.js";
import { selectedPlaceFromResult } from "../features/passenger/place-endpoint-state.js";
import { qualifyRouteGuide } from "../route-guide/qualify.js";
import {
  NearbyTransitResponse,
  PlaceSearchResponse,
  RouteGuideResponse,
} from "../runtime/route-helper-contracts.js";
import { ApplicationRuntime } from "../runtime/application.js";
import { RouteHelperQuery } from "../runtime/route-helper-query.js";
import { handleNearbyTransitRequest } from "../routes/api/nearby-transit.js";
import { handlePlaceSearchRequest } from "../routes/api/places.js";
import { handleRouteGuideRequest } from "../routes/api/route-guide.js";

const QualificationConfig = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  artifacts: Schema.Struct({
    networkVersion: Schema.String,
    placesVersion: Schema.String,
    networkSnapshotChecksum: Schema.String,
    networkGeometryChecksum: Schema.String,
    routeMapChecksum: Schema.String,
    placesArtifactChecksum: Schema.String,
  }),
  budgets: Schema.Struct({
    coldCompositionMs: Schema.Number,
    warmPlaceQueryP95Ms: Schema.Number,
    guideIndexMs: Schema.Number,
    guideQueryP95Ms: Schema.Number,
    guideQueryMaximumMs: Schema.Number,
    maximumExpandedStates: Schema.Number,
    placeResponseBytes: Schema.Number,
    routeGuideResponseBytes: Schema.Number,
    initialAssetsGzipBytes: Schema.Number,
    lazyMapAssetsGzipBytes: Schema.Number,
  }),
});

const readJsonText = (file: string) => readFileSync(file, "utf8");
const readJson = (file: string): unknown => JSON.parse(readJsonText(file));
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const percentile = (values: ReadonlyArray<number>, ratio: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;
};

const normalize = (value: string) => value.toLowerCase().trim();
const qualification = process.env.ROUTE_HELPER_QUALIFY === "1" ? describe : describe.skip;

qualification("Plan 016 route-helper release qualification", () => {
  it("qualifies the exact production composition, complete corpus, payloads, and assets", async () => {
    const config = Schema.decodeUnknownSync(QualificationConfig)(
      readJson("config/route-helper-release.json"),
    );
    const networkManifest = readJson("public/artifacts/active.json") as {
      version: string;
      snapshotUrl: string;
      snapshotChecksum: string;
      geometryUrl: string;
      geometryChecksum: string;
      routeMapUrl: string;
      routeMapChecksum: string;
    };
    const placesManifest = readJson("public/artifacts/places/active.json") as {
      version: string;
      networkArtifactVersion: string;
      artifactUrl: string;
      artifactChecksum: string;
      attribution: string;
    };
    const snapshotPath = path.resolve("public/artifacts", networkManifest.snapshotUrl);
    const geometryPath = path.resolve("public/artifacts", networkManifest.geometryUrl);
    const routeMapPath = path.resolve("public/artifacts", networkManifest.routeMapUrl);
    const placesPath = path.resolve("public/artifacts/places", placesManifest.artifactUrl);

    expect(networkManifest.version).toBe(config.artifacts.networkVersion);
    expect(placesManifest.version).toBe(config.artifacts.placesVersion);
    expect(placesManifest.networkArtifactVersion).toBe(networkManifest.version);
    expect(placesManifest.attribution).not.toBe("");
    expect(networkManifest.snapshotChecksum).toBe(config.artifacts.networkSnapshotChecksum);
    expect(networkManifest.geometryChecksum).toBe(config.artifacts.networkGeometryChecksum);
    expect(networkManifest.routeMapChecksum).toBe(config.artifacts.routeMapChecksum);
    expect(placesManifest.artifactChecksum).toBe(config.artifacts.placesArtifactChecksum);
    expect(sha256(snapshotPath)).toBe(config.artifacts.networkSnapshotChecksum);
    expect(sha256(geometryPath)).toBe(config.artifacts.networkGeometryChecksum);
    expect(sha256(routeMapPath)).toBe(config.artifacts.routeMapChecksum);
    expect(sha256(placesPath)).toBe(config.artifacts.placesArtifactChecksum);
    expect(`${networkManifest.version}${placesManifest.version}`).not.toMatch(/fixture|demo/i);

    const corpus = await Effect.runPromise(
      loadFromJsonText({
        manifestText: readJsonText("test/fixtures/route-helper/corpus-manifest.json"),
        placeSearchCasesText: readJsonText("test/fixtures/route-helper/place-search-cases.json"),
        routeGuideCasesText: readJsonText("test/fixtures/route-helper/route-guide-cases.json"),
        usabilityTasksText: readJsonText("test/fixtures/route-helper/usability-tasks.json"),
      }),
    );
    expect(corpus.manifest.sourceArtifactVersion).toBe(networkManifest.version);

    const networkBase = "https://qualification.test/artifacts/";
    const placesBase = `${networkBase}places/`;
    const networkManifestUrl = `${networkBase}active.json`;
    const placesManifestUrl = `${placesBase}active.json`;
    const fileByUrl = new Map<string, string>([
      [networkManifestUrl, "public/artifacts/active.json"],
      [new URL(networkManifest.snapshotUrl, networkManifestUrl).href, snapshotPath],
      [new URL(networkManifest.geometryUrl, networkManifestUrl).href, geometryPath],
      [placesManifestUrl, "public/artifacts/places/active.json"],
      [new URL(placesManifest.artifactUrl, placesManifestUrl).href, placesPath],
    ]);
    const productionFetch: typeof globalThis.fetch = async (input) => {
      const file = fileByUrl.get(String(input));
      if (file === undefined) return new Response("not found", { status: 404 });
      const body = readFileSync(file);
      return new Response(body, { headers: { "content-length": String(body.byteLength) } });
    };

    const coldStarted = performance.now();
    const runtime = ManagedRuntime.make(
      ApplicationRuntime.helperLayerWith({
        networkManifestUrl,
        placesManifestUrl,
        fetch: productionFetch,
      }),
    );
    const query = await runtime.runPromise(RouteHelperQuery.Service);
    const artifactVersions = await runtime.runPromise(query.versions());
    const coldCompositionMs = performance.now() - coldStarted;
    expect(coldCompositionMs).toBeLessThanOrEqual(config.budgets.coldCompositionMs);
    expect(artifactVersions).toMatchObject({
      networkArtifactVersion: config.artifacts.networkVersion,
      placesArtifactVersion: config.artifacts.placesVersion,
      networkSnapshotChecksum: config.artifacts.networkSnapshotChecksum,
      networkGeometryChecksum: config.artifacts.networkGeometryChecksum,
      placesArtifactChecksum: config.artifacts.placesArtifactChecksum,
    });
    expect(artifactVersions.coverage.attribution).not.toBe("");
    expect(artifactVersions.coverage.freshnessNote).not.toBe("");

    const placeLatencies: number[] = [];
    const placeFailures: Array<{ id: string; reasons: ReadonlyArray<string> }> = [];
    let topResultAccepted = 0;
    let maximumPlaceResponseBytes = 0;
    for (const placeCase of corpus.placeSearchCases) {
      const started = performance.now();
      const response = await runtime.runPromise(
        query.searchPlaces({
          text: placeCase.query,
          limit: 10,
          ...(placeCase.coordinate === undefined ? {} : { biasCoordinate: placeCase.coordinate }),
        }),
      );
      placeLatencies.push(performance.now() - started);
      maximumPlaceResponseBytes = Math.max(maximumPlaceResponseBytes, bytes(response));
      const reasons: string[] = [];
      if (placeCase.expectNoLocalResult) {
        if (response._tag !== "NoMatch") reasons.push("expected NoMatch");
      } else if (response._tag !== "Matches") {
        reasons.push("NoMatch");
      } else {
        const hits = response.results.map((result) => ({
          ...result,
          names: [result.displayLabel, result.matchedAlias]
            .filter((name): name is string => name !== undefined)
            .map(normalize),
        }));
        const expectedMatches = (expected: (typeof placeCase.expectedPlaces)[number]) =>
          hits.find((hit) => {
            const expectedName = normalize(expected.name);
            const nameOk = hit.names.some(
              (name) =>
                name === expectedName ||
                name.startsWith(`${expectedName} `) ||
                (expected.placeType === "Landmark" && name.includes(expectedName)),
            );
            const typeOk =
              expected.placeType === "TransitPlace"
                ? hit.resultKind === "TransitPlace"
                : expected.placeType === "Area"
                  ? hit.resultKind === "Area" || hit.resultKind === "Landmark"
                  : expected.placeType === "Landmark"
                    ? hit.resultKind === "Landmark" || hit.resultKind === "Area"
                    : true;
            return nameOk && typeOk;
          });
        for (const expected of placeCase.expectedPlaces) {
          if (expectedMatches(expected) === undefined)
            reasons.push(`missing ${expected.placeType}:${expected.name}`);
        }
        const first = hits[0];
        if (
          first !== undefined &&
          placeCase.expectedPlaces.some((expected) => {
            const expectedName = normalize(expected.name);
            return first.names.some(
              (name) => name === expectedName || name.startsWith(`${expectedName} `),
            );
          })
        )
          topResultAccepted += 1;
        for (const forbidden of placeCase.forbiddenDuplicateLabels) {
          if (response.results.filter((result) => result.displayLabel === forbidden).length > 1)
            reasons.push(`duplicate ${forbidden}`);
        }
      }
      if (reasons.length > 0) placeFailures.push({ id: placeCase.id, reasons });
    }
    const warmPlaceP95Ms = percentile(placeLatencies, 0.95);
    expect(placeFailures).toEqual([]);
    expect(warmPlaceP95Ms).toBeLessThanOrEqual(config.budgets.warmPlaceQueryP95Ms);
    expect(maximumPlaceResponseBytes).toBeLessThanOrEqual(config.budgets.placeResponseBytes);

    const routeReport = await Effect.runPromise(
      qualifyRouteGuide({
        snapshot: readJson(snapshotPath),
        networkArtifact: snapshotPath,
        sourceArtifactVersion: networkManifest.version,
        overrides: readJson("test/fixtures/transit-places/reviewed-complex-overrides.json"),
        overrideArtifact: path.resolve(
          "test/fixtures/transit-places/reviewed-complex-overrides.json",
        ),
        placeLabelAliases: (
          readJson("test/fixtures/route-guide/corpus-place-aliases.json") as {
            aliases: Array<{ label: string; alsoMatchPlaceNames: Array<string> }>;
          }
        ).aliases,
        corpus: {
          manifest: corpus.manifest,
          placeSearchCases: corpus.placeSearchCases,
          routeGuideCases: corpus.routeGuideCases,
          usabilityTasks: corpus.usabilityTasks,
        },
      }),
    );
    const supportedRegressions = routeReport.cases.filter(
      (entry) => entry.outcome === "Supported" && entry.status !== "Matched",
    );
    const knownGapRegressions = routeReport.cases.filter(
      (entry) =>
        entry.outcome === "KnownGap" && !["ExpectedGap", "UnresolvedPlace"].includes(entry.status),
    );
    expect(supportedRegressions).toEqual([]);
    expect(knownGapRegressions).toEqual([]);
    expect(routeReport.graph.indexTimeMs).toBeLessThanOrEqual(config.budgets.guideIndexMs);
    expect(routeReport.queryLatencyMs.p95).toBeLessThanOrEqual(config.budgets.guideQueryP95Ms);
    expect(routeReport.queryLatencyMs.max).toBeLessThanOrEqual(config.budgets.guideQueryMaximumMs);
    expect(routeReport.graph.maximumExpandedStates).toBeLessThanOrEqual(
      config.budgets.maximumExpandedStates,
    );
    expect(
      routeReport.interchangeableGroups.memberLineExamples.some(
        (lines) => lines.includes("9") && lines.includes("9A"),
      ),
    ).toBe(true);

    const executePlaceSearch = async (_network: string, _places: string, input: unknown) =>
      runtime.runPromise(query.searchPlaces(input));
    const executeNearby = async (_network: string, _places: string, input: unknown) =>
      runtime.runPromise(query.nearbyTransit(input));
    const executeGuide = async (_network: string, _places: string, input: unknown) =>
      runtime.runPromise(query.guide(input));
    const apiLatencies: number[] = [];
    const searchThroughHttp = async (text: string) => {
      const started = performance.now();
      const response = await handlePlaceSearchRequest(
        new Request(`https://qualification.test/api/places?q=${encodeURIComponent(text)}&limit=6`),
        executePlaceSearch,
      );
      apiLatencies.push(performance.now() - started);
      expect(response.status).toBe(200);
      return Schema.decodeUnknownSync(PlaceSearchResponse)(await response.json());
    };
    const originSearch = await searchThroughHttp("Cawang");
    const destinationSearch = await searchThroughHttp("Grogol");
    expect(originSearch._tag).toBe("Matches");
    expect(destinationSearch._tag).toBe("Matches");
    if (originSearch._tag !== "Matches" || destinationSearch._tag !== "Matches")
      throw new Error("Qualification endpoints were not recognized");
    const originResult = originSearch.results[0]!;
    const destinationResult = destinationSearch.results[0]!;
    const nearbyThroughHttp = async (result: typeof originResult) => {
      const started = performance.now();
      const response = await handleNearbyTransitRequest(
        new Request("https://qualification.test/api/nearby-transit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            placeId: result.placeId,
            radiusMeters: 1200,
            maxCount: 8,
            artifactVersion: placesManifest.version,
          }),
        }),
        executeNearby,
      );
      apiLatencies.push(performance.now() - started);
      expect(response.status).toBe(200);
      return Schema.decodeUnknownSync(NearbyTransitResponse)(await response.json());
    };
    const originNearby = await nearbyThroughHttp(originResult);
    const destinationNearby = await nearbyThroughHttp(destinationResult);
    expect(originNearby._tag).toBe("Choices");
    expect(destinationNearby._tag).toBe("Choices");
    if (originNearby._tag !== "Choices" || destinationNearby._tag !== "Choices")
      throw new Error("Qualification endpoints did not resolve to nearby transit");
    const guideStarted = performance.now();
    const guideHttpResponse = await handleRouteGuideRequest(
      new Request("https://qualification.test/api/route-guide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: selectedPlaceFromResult(originResult, placesManifest.version),
          destination: selectedPlaceFromResult(destinationResult, placesManifest.version),
          originCandidates: originNearby.choices.map((choice) => ({
            transitPlaceId: choice.transitPlaceId,
            primaryName: choice.primaryName,
            geographicDistanceMeters: choice.geographicDistanceMeters,
          })),
          destinationCandidates: destinationNearby.choices.map((choice) => ({
            transitPlaceId: choice.transitPlaceId,
            primaryName: choice.primaryName,
            geographicDistanceMeters: choice.geographicDistanceMeters,
          })),
          networkArtifactVersion: networkManifest.version,
          placesArtifactVersion: placesManifest.version,
          maximumTransfers: 3,
          maximumAlternatives: 6,
        }),
      }),
      executeGuide,
    );
    apiLatencies.push(performance.now() - guideStarted);
    expect(guideHttpResponse.status).toBe(200);
    const guideJson: unknown = await guideHttpResponse.json();
    const guideResponse = Schema.decodeUnknownSync(RouteGuideResponse)(guideJson);
    expect(guideResponse._tag).toBe("GuidesFound");
    expect(bytes(guideJson)).toBeLessThanOrEqual(config.budgets.routeGuideResponseBytes);
    const serializedGuide = JSON.stringify(guideJson);
    expect(serializedGuide).not.toMatch(
      /departureSeconds|arrivalSeconds|walkMinutes|waitMinutes|fare|pedestrian/i,
    );
    if (guideResponse._tag !== "GuidesFound") throw new Error("Guide qualification failed");
    const rendered = renderToString(() => <RouteGuideResults result={guideResponse} />);
    expect(rendered).toContain("Cakupan bus saja");
    expect(rendered).toContain("Naik di");
    expect(rendered).not.toMatch(/walkMinutes|waitMinutes|departureSeconds|fare/i);

    const clientAssetDirectory = "dist/client/assets";
    const assetFiles = readdirSync(clientAssetDirectory).map((name) => ({
      name,
      path: path.join(clientAssetDirectory, name),
    }));
    const gzipBytes = (file: string) => gzipSync(readFileSync(file)).byteLength;
    const shellStyle = assetFiles.find((asset) => /^styles-.*\.css$/.test(asset.name));
    expect(shellStyle).toBeDefined();
    const shellCss = readFileSync(shellStyle!.path, "utf8");
    expect(shellCss).toContain("@media (width <= 700px)");
    expect(shellCss).toContain("max-height: min(26rem, 100dvh - 10rem)");
    expect(shellCss).toContain("max-height: 46dvh");
    expect(shellCss).toContain("height: 100dvh");
    const lazyMapAssetsGzipBytes = assetFiles
      .filter((asset) => /MapCanvas|PassengerMap/.test(asset.name))
      .reduce((total, asset) => total + gzipBytes(asset.path), 0);
    const initialAssetsGzipBytes = assetFiles
      .filter((asset) => !/MapCanvas|PassengerMap/.test(asset.name))
      .reduce((total, asset) => total + gzipBytes(asset.path), 0);
    expect(initialAssetsGzipBytes).toBeLessThanOrEqual(config.budgets.initialAssetsGzipBytes);
    expect(lazyMapAssetsGzipBytes).toBeLessThanOrEqual(config.budgets.lazyMapAssetsGzipBytes);
    expect(statSync(snapshotPath).size).toBeGreaterThan(0);

    const report = {
      schemaVersion: "1",
      generatedAt: new Date().toISOString(),
      artifacts: {
        networkVersion: networkManifest.version,
        placesVersion: placesManifest.version,
        checksums: config.artifacts,
        attribution: placesManifest.attribution,
      },
      corpus: {
        placeCases: corpus.placeSearchCases.length,
        placePassed: corpus.placeSearchCases.length - placeFailures.length,
        topResultAccepted,
        routeCases: routeReport.cases.length,
        supportedMatched: routeReport.cases.filter((entry) => entry.status === "Matched").length,
        knownGaps: routeReport.cases
          .filter((entry) => entry.outcome === "KnownGap")
          .map((entry) => ({ caseId: entry.caseId, status: entry.status })),
      },
      performance: {
        coldCompositionMs,
        warmPlaceQueryP50Ms: percentile(placeLatencies, 0.5),
        warmPlaceQueryP95Ms: warmPlaceP95Ms,
        guideIndexMs: routeReport.graph.indexTimeMs,
        guideQueryMs: routeReport.queryLatencyMs,
        maximumExpandedStates: routeReport.graph.maximumExpandedStates,
        apiLatencyP95Ms: percentile(apiLatencies, 0.95),
      },
      payloads: {
        maximumPlaceResponseBytes,
        routeGuideResponseBytes: bytes(guideJson),
        initialAssetsGzipBytes,
        lazyMapAssetsGzipBytes,
      },
      gates: {
        productionFixtureFallback: false,
        artifactCompatibility: true,
        attributionAndFreshness: true,
        timetableOrPedestrianFields: false,
        interchangeableNineNineAObserved: true,
        allBudgetsPassed: true,
      },
    };
    writeFileSync(
      "docs/data/route-helper-release-qualification.json",
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await runtime.dispose();
  }, 240_000);
});
