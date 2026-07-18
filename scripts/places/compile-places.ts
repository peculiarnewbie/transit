#!/usr/bin/env npx tsx
/**
 * Compile a pinned OsmPlaceExtract JSON into a passenger-place artifact.
 *
 * Usage:
 *   npx tsx scripts/places/compile-places.ts \
 *     --input path/to/extract.json \
 *     --version places-jabodetabek-YYYYMMDD-v1 \
 *     --output public/artifacts/places/places-jabodetabek-YYYYMMDD-v1.json \
 *     --retrieved-at 2026-06-30T00:00:00.000Z
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Effect } from "effect";

import { compileOsmPlaces } from "../../src/import/osm-places/index.js";

const getArg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const inputPath = getArg("--input");
const version = getArg("--version");
const outputPath = getArg("--output");
const retrievedAt = getArg("--retrieved-at") ?? new Date().toISOString();

if (inputPath === undefined || version === undefined || outputPath === undefined) {
  console.error(
    "Usage: compile-places.ts --input <extract.json> --version <id> --output <artifact.json> [--retrieved-at ISO]",
  );
  process.exit(1);
}

const extract = JSON.parse(readFileSync(inputPath, "utf8"));
const result = await Effect.runPromise(
  compileOsmPlaces({
    extract,
    artifactVersion: version,
    retrievedAt,
  }),
);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, result.artifactJson);
writeFileSync(
  outputPath.replace(/\.json$/, ".audit.json"),
  `${JSON.stringify(result.audit, null, 2)}\n`,
);

const manifest = {
  schemaVersion: "1",
  version,
  artifactUrl: `./${version}.json`,
  license: result.artifact.source.license,
  attribution: result.artifact.source.attribution,
  inputChecksum: result.artifact.source.inputChecksum,
  outputChecksum: result.artifact.outputChecksum,
  placeCount: result.artifact.places.length,
};
const manifestPath = `${dirname(outputPath)}/active.json`;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      version,
      outputPath,
      manifestPath,
      placeCount: result.artifact.places.length,
      audit: result.audit,
    },
    null,
    2,
  ),
);
