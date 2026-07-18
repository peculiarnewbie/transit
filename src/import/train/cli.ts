import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Clock, Duration, Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { TransportError } from "./errors.js";
import { TrainSourceHttp } from "./http.js";
import { TrainSourceImporter } from "./importer.js";
import {
  KrlSourceAdapter,
  SCHEDULES_URL as KRL_SCHEDULES_URL,
  STATIONS_URL as KRL_STATIONS_URL,
} from "./krl/adapter.js";
import { LrtSourceAdapter, SCHEDULES_URL as LRT_SCHEDULES_URL } from "./lrt/adapter.js";
import type { TrainSystem } from "./model.js";
import { MrtSourceAdapter, STATIONS_URL as MRT_STATIONS_URL } from "./mrt/adapter.js";

interface CliOptions {
  readonly systems: ReadonlyArray<TrainSystem>;
  readonly fixtureDir?: string;
  readonly output: string;
  readonly at?: number;
}

const parseArgs = (args: ReadonlyArray<string>): CliOptions => {
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const systems = (value("--systems") ?? "krl,mrt,lrt")
    .split(",")
    .map((system) => system.trim())
    .filter(
      (system): system is TrainSystem => system === "krl" || system === "mrt" || system === "lrt",
    );
  const fixtureDir = value("--fixture-dir");
  const at = value("--at");
  const atMillis = at === undefined ? undefined : Date.parse(at);
  if (at !== undefined && Number.isNaN(atMillis)) throw new Error(`Invalid --at timestamp: ${at}`);
  return {
    systems,
    ...(fixtureDir === undefined ? {} : { fixtureDir }),
    output: value("--output") ?? "train-import.local/report.json",
    ...(atMillis === undefined ? {} : { at: atMillis }),
  };
};

const fixtureFile = (directory: string, url: string): string => {
  if (url === KRL_STATIONS_URL) return path.join(directory, "krl-stations.json");
  if (url.startsWith(KRL_SCHEDULES_URL)) {
    return path.join(directory, `krl-schedules-${new URL(url).searchParams.get("stationid")}.json`);
  }
  if (url === LRT_SCHEDULES_URL) return path.join(directory, "lrt-schedule.html");
  if (url === MRT_STATIONS_URL) return path.join(directory, "mrt-stations.json");
  if (url.includes("jakartamrt.co.id")) {
    return path.join(
      directory,
      `mrt-detail-${new URL(url).searchParams.get("filters[slug]")}.json`,
    );
  }
  return path.join(directory, "unknown-source");
};

const fixtureLayer = (directory: string) =>
  Layer.succeed(
    TrainSourceHttp.Service,
    TrainSourceHttp.Service.of({
      getJson: Effect.fn("TrainSourceHttp.Fixture.getJson")(function* (context) {
        const text = yield* Effect.tryPromise({
          try: () => readFile(fixtureFile(directory, context.url), "utf8"),
          catch: (cause) =>
            new TransportError({
              operation: context.operation,
              system: context.system,
              source: context.url,
              cause,
            }),
        });
        return yield* Effect.try({
          try: () => JSON.parse(text) as unknown,
          catch: (cause) =>
            new TransportError({
              operation: context.operation,
              system: context.system,
              source: context.url,
              cause,
            }),
        });
      }),
      getText: Effect.fn("TrainSourceHttp.Fixture.getText")(function* (context) {
        return yield* Effect.tryPromise({
          try: () => readFile(fixtureFile(directory, context.url), "utf8"),
          catch: (cause) =>
            new TransportError({
              operation: context.operation,
              system: context.system,
              source: context.url,
              cause,
            }),
        });
      }),
    }),
  );

const options = parseArgs(process.argv.slice(2));
const adapters = Layer.mergeAll(
  KrlSourceAdapter.layer,
  MrtSourceAdapter.layer,
  LrtSourceAdapter.layer,
);
const transport =
  options.fixtureDir === undefined
    ? TrainSourceHttp.layer.pipe(Layer.provide(FetchHttpClient.layer))
    : fixtureLayer(options.fixtureDir);
const runtime = TrainSourceImporter.layer.pipe(
  Layer.provide(adapters.pipe(Layer.provide(transport))),
);

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: (duration) =>
    Effect.promise(
      () => new Promise<void>((resolve) => setTimeout(resolve, Duration.toMillis(duration))),
    ),
});

const program = Effect.gen(function* () {
  const importer = yield* TrainSourceImporter.Service;
  const report = yield* importer.import({ systems: options.systems });
  const encoded = yield* TrainSourceImporter.encodeReport(report);
  const serialized = `${JSON.stringify(encoded, null, 2)}\n`;
  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(path.dirname(options.output), { recursive: true });
      await writeFile(options.output, serialized, "utf8");
    },
    catch: (cause) => cause,
  });
  const hash = createHash("sha256").update(serialized).digest("hex");
  const counts = report.snapshots
    .map((snapshot) => `${snapshot.system}:${snapshot.stations.length}`)
    .join(" ");
  const failures = report.failures
    .map((failure) => `${failure.system}:${failure.errorTag}`)
    .join(",");
  yield* Effect.sync(() =>
    console.log(
      `train import at:${String(encoded.generatedAt)} ${counts} failures:${report.failures.length}${failures ? `(${failures})` : ""} sha256:${hash}`,
    ),
  );
  if (report.snapshots.length === 0) process.exitCode = 1;
}).pipe(Effect.provide(runtime), (effect) =>
  options.at === undefined
    ? effect
    : Effect.provideService(effect, Clock.Clock, fixedClock(options.at)),
);

Effect.runPromise(program).catch((cause: unknown) => {
  console.error(cause);
  process.exitCode = 1;
});
