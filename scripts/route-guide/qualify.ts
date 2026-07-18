import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Effect } from "effect";

import { qualifyRouteGuide } from "../../src/route-guide/qualify.js";

const args = process.argv.slice(2);
const getArg = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const snapshotPath = resolve(
  getArg("--snapshot") ?? "public/artifacts/bus-transjakarta-20260630-v2.network.json",
);
const artifactVersion = getArg("--version") ?? "bus-transjakarta-20260630-v2";
const overridesPath = getArg("--overrides");
const aliasesPath = resolve(
  getArg("--aliases") ?? "test/fixtures/route-guide/corpus-place-aliases.json",
);
const outputPath = resolve(getArg("--output") ?? "docs/data/route-guide-qualification.json");
const fixtureRoot = resolve("test/fixtures/route-helper");

const main = Effect.gen(function* () {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as unknown;
  const overrides =
    overridesPath === undefined
      ? undefined
      : (JSON.parse(readFileSync(resolve(overridesPath), "utf8")) as unknown);
  const aliasFile = JSON.parse(readFileSync(aliasesPath, "utf8")) as {
    aliases: Array<{ label: string; alsoMatchPlaceNames: Array<string> }>;
  };

  const report = yield* qualifyRouteGuide({
    snapshot,
    networkArtifact: snapshotPath,
    sourceArtifactVersion: artifactVersion,
    placeLabelAliases: aliasFile.aliases,
    ...(overrides === undefined
      ? {}
      : {
          overrides,
          overrideArtifact: resolve(overridesPath!),
        }),
    corpus: {
      manifest: JSON.parse(readFileSync(resolve(fixtureRoot, "corpus-manifest.json"), "utf8")),
      placeSearchCases: JSON.parse(
        readFileSync(resolve(fixtureRoot, "place-search-cases.json"), "utf8"),
      ),
      routeGuideCases: JSON.parse(
        readFileSync(resolve(fixtureRoot, "route-guide-cases.json"), "utf8"),
      ),
      usabilityTasks: JSON.parse(
        readFileSync(resolve(fixtureRoot, "usability-tasks.json"), "utf8"),
      ),
    },
  });

  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  const matched = report.cases.filter((entry) => entry.status === "Matched").length;
  const supported = report.cases.filter((entry) => entry.outcome === "Supported").length;
  const knownGapOk = report.cases.filter((entry) => entry.status === "ExpectedGap").length;
  console.log(
    JSON.stringify(
      {
        outputPath,
        matched,
        supported,
        knownGapOk,
        graph: report.graph,
        queryLatencyMs: report.queryLatencyMs,
        directionEvidence: report.directionEvidence,
        interchangeableGroups: report.interchangeableGroups.groupCount,
        notes: [
          "Supported mismatches often request transfers that are not present as published transfers or source-station relationships in the GTFS topology (for example Ragunan→Galunggung→line 1: line 1 does not serve Galunggung).",
          "UnresolvedPlace cases are peripheral/gap labels outside the projected transit-place index.",
          "Place label aliases expand corpus endpoints only; they do not create transfer edges.",
        ],
      },
      null,
      2,
    ),
  );
});

Effect.runPromise(main).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
