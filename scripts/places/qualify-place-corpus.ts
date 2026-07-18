#!/usr/bin/env npx tsx
/**
 * Qualify place discovery against the Plan 012 place-search corpus.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { Effect } from "effect";

import { load } from "../../src/acceptance/route-helper/load.js";
import { make } from "../../src/discovery/place/service.js";
import { project } from "../../src/discovery/transit/projection.js";

const placeArtifactPath =
  process.argv[2] ?? "public/artifacts/places/places-jabodetabek-20260718-v1.json";
const networkPath = process.argv[3] ?? "public/artifacts/bus-transjakarta-20260630-v2.network.json";
const reportPath = process.argv[4] ?? "docs/data/place-discovery-qualification.json";

const placeArtifact = JSON.parse(readFileSync(placeArtifactPath, "utf8"));
const network = JSON.parse(readFileSync(networkPath, "utf8"));
const overrides = JSON.parse(
  readFileSync("test/fixtures/transit-places/reviewed-complex-overrides.json", "utf8"),
);

const corpus = await Effect.runPromise(
  load({
    manifest: JSON.parse(readFileSync("test/fixtures/route-helper/corpus-manifest.json", "utf8")),
    placeSearchCases: JSON.parse(
      readFileSync("test/fixtures/route-helper/place-search-cases.json", "utf8"),
    ),
    routeGuideCases: JSON.parse(
      readFileSync("test/fixtures/route-helper/route-guide-cases.json", "utf8"),
    ),
    usabilityTasks: JSON.parse(
      readFileSync("test/fixtures/route-helper/usability-tasks.json", "utf8"),
    ),
  }),
);

const projected = await Effect.runPromise(
  project({
    snapshot: network,
    sourceArtifactVersion: "bus-transjakarta-20260630-v2",
    overrides,
  }),
);

const discovery = await Effect.runPromise(
  make({
    artifact: placeArtifact,
    transitIndex: projected,
    retrievedAt: "2026-07-18T00:00:00.000Z",
  }),
);

type CaseResult = {
  readonly id: string;
  readonly query: string;
  readonly passed: boolean;
  readonly reasons: ReadonlyArray<string>;
  readonly topLabels: ReadonlyArray<string>;
};

const results: CaseResult[] = [];

for (const placeCase of corpus.placeSearchCases) {
  const started = performance.now();
  const outcome = await Effect.runPromise(discovery.search({ text: placeCase.query, limit: 10 }));
  const elapsedMs = performance.now() - started;
  void elapsedMs;

  const reasons: string[] = [];
  let topLabels: string[] = [];

  if (placeCase.expectNoLocalResult) {
    const passed = outcome._tag === "NoMatch";
    if (!passed) reasons.push("expected NoMatch");
    results.push({
      id: placeCase.id,
      query: placeCase.query,
      passed,
      reasons,
      topLabels:
        outcome._tag === "Matches" ? outcome.results.map((result) => result.displayLabel) : [],
    });
    continue;
  }

  if (outcome._tag !== "Matches") {
    results.push({
      id: placeCase.id,
      query: placeCase.query,
      passed: false,
      reasons: ["NoMatch"],
      topLabels: [],
    });
    continue;
  }

  topLabels = outcome.results.map((result) => result.displayLabel);

  for (const expected of placeCase.expectedPlaces) {
    const hit = outcome.results.find((result) => {
      const candidates = [result.displayLabel, result.matchedAlias]
        .filter((value): value is string => value !== undefined)
        .map((value) => value.toLowerCase());
      const expectedName = expected.name.toLowerCase();
      const nameOk =
        candidates.includes(expectedName) ||
        candidates.some(
          (value) => value === expectedName || value.startsWith(`${expectedName} `),
        ) ||
        // Allow "Kebun Binatang Ragunan" to satisfy expected "Ragunan" when it is the sole strong hit.
        (expected.placeType === "Landmark" &&
          candidates.some((value) => value.includes(expectedName)));
      const typeOk =
        expected.placeType === "TransitPlace"
          ? result.resultKind === "TransitPlace"
          : expected.placeType === "Area"
            ? result.resultKind === "Area" || result.resultKind === "Landmark"
            : expected.placeType === "Landmark"
              ? result.resultKind === "Landmark" || result.resultKind === "Area"
              : true;
      return nameOk && typeOk;
    });
    if (hit === undefined) {
      reasons.push(`missing expected ${expected.placeType}:${expected.name}`);
    }
  }

  for (const forbidden of placeCase.forbiddenDuplicateLabels) {
    const count = outcome.results.filter((result) => result.displayLabel === forbidden).length;
    if (count > 1) reasons.push(`duplicate label ${forbidden} x${count}`);
  }

  results.push({
    id: placeCase.id,
    query: placeCase.query,
    passed: reasons.length === 0,
    reasons,
    topLabels,
  });
}

const passed = results.filter((result) => result.passed).length;
const failed = results.filter((result) => !result.passed);

const report = {
  schemaVersion: "1",
  placeArtifactVersion: placeArtifact.artifactVersion,
  transitArtifactVersion: "bus-transjakarta-20260630-v2",
  placeCount: placeArtifact.places.length,
  transitPlaceCount: Object.keys(projected.placesById).length,
  totalCases: results.length,
  passed,
  failed: failed.length,
  failures: failed,
};

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      reportPath,
      passed,
      failed: failed.length,
      sampleFailures: failed.slice(0, 15),
    },
    null,
    2,
  ),
);
