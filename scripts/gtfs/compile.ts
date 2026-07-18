import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { Effect } from "effect";

import { compileGtfs, encodeGeometry, encodeSnapshot } from "../../src/import/gtfs/index.js";

interface CliOptions {
  readonly input: string;
  readonly output: string;
  readonly generatedAt: string;
}

const usage =
  "Usage: npx tsx scripts/gtfs/compile.ts --input <zip> --output <json> [--generated-at <ISO timestamp>]";

const parseArguments = (arguments_: ReadonlyArray<string>): CliOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(usage);
    }
    values.set(key, value);
  }
  const input = values.get("--input");
  const output = values.get("--output");
  if (input === undefined || output === undefined) throw new Error(usage);
  return {
    input,
    output,
    generatedAt: values.get("--generated-at") ?? new Date().toISOString(),
  };
};

const geometryPath = (output: string) =>
  output.endsWith(".json") ? `${output.slice(0, -5)}.geometry.json` : `${output}.geometry.json`;

const stableJson = (value: unknown) => `${JSON.stringify(value)}\n`;

export const runCli = Effect.fn("Gtfs.runCli")(function* (options: CliOptions) {
  const input = yield* Effect.promise(() => readFile(options.input));
  const compiled = yield* compileGtfs({
    input,
    generatedAt: options.generatedAt,
    sourceName: basename(options.input),
  });
  const snapshot = yield* encodeSnapshot(compiled.snapshot);
  const geometry = yield* encodeGeometry(compiled.geometry);
  const snapshotJson = stableJson(snapshot);
  const geometryJson = stableJson(geometry);
  const sidecar = geometryPath(options.output);
  yield* Effect.promise(() => mkdir(dirname(options.output), { recursive: true }));
  yield* Effect.promise(() =>
    Promise.all([writeFile(options.output, snapshotJson), writeFile(sidecar, geometryJson)]),
  );
  return {
    ...compiled.summary,
    topologyBytes: Buffer.byteLength(snapshotJson),
    geometryBytes: Buffer.byteLength(geometryJson),
    contentHash: createHash("sha256").update(snapshotJson).digest("hex"),
    output: options.output,
    geometryOutput: sidecar,
  };
});

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  Effect.runPromise(runCli(parseArguments(process.argv.slice(2))))
    .then((summary) => console.log(JSON.stringify(summary)))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
