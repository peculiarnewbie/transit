import { readFileSync } from "node:fs";
import path from "node:path";

import { Clock, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { TransportError } from "./errors.js";
import { TrainSourceHttp } from "./http.js";
import { TrainSourceImporter } from "./importer.js";
import {
  KrlSourceAdapter,
  SCHEDULES_URL as KRL_SCHEDULES_URL,
  STATIONS_URL as KRL_STATIONS_URL,
} from "./krl/adapter.js";
import { inferTopologies } from "./krl/topology.js";
import { LrtSourceAdapter, SCHEDULES_URL as LRT_SCHEDULES_URL } from "./lrt/adapter.js";
import {
  MrtSourceAdapter,
  STATIONS_URL as MRT_STATIONS_URL,
  stationDetailUrl,
} from "./mrt/adapter.js";

const FIXTURES = path.resolve("test/fixtures/train");
const jsonFixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
const textFixture = (name: string): string => readFileSync(path.join(FIXTURES, name), "utf8");

const fixtures = new Map<string, unknown>([
  [KRL_STATIONS_URL, jsonFixture("krl-stations.json")],
  [
    `${KRL_SCHEDULES_URL}?stationid=DU&timefrom=00%3A00&timeto=23%3A59`,
    jsonFixture("krl-schedules-DU.json"),
  ],
  [
    `${KRL_SCHEDULES_URL}?stationid=PSG&timefrom=00%3A00&timeto=23%3A59`,
    jsonFixture("krl-schedules-PSG.json"),
  ],
  [MRT_STATIONS_URL, jsonFixture("mrt-stations.json")],
  [stationDetailUrl("stasiun-lebak-bulus"), jsonFixture("mrt-detail-stasiun-lebak-bulus.json")],
  [stationDetailUrl("bundaran-hi"), jsonFixture("mrt-detail-bundaran-hi.json")],
  [LRT_SCHEDULES_URL, textFixture("lrt-schedule.html")],
]);

const fakeHttpLayer = (values: ReadonlyMap<string, unknown> = fixtures) =>
  Layer.succeed(
    TrainSourceHttp.Service,
    TrainSourceHttp.Service.of({
      getJson: Effect.fn("TrainSourceHttp.Test.getJson")(function* (context) {
        const value = values.get(context.url);
        if (value === undefined) {
          return yield* new TransportError({
            operation: context.operation,
            system: context.system,
            source: context.url,
            cause: "Missing fixture",
          });
        }
        return value;
      }),
      getText: Effect.fn("TrainSourceHttp.Test.getText")(function* (context) {
        const value = values.get(context.url);
        if (typeof value !== "string") {
          return yield* new TransportError({
            operation: context.operation,
            system: context.system,
            source: context.url,
            cause: "Missing text fixture",
          });
        }
        return value;
      }),
    }),
  );

const fixedClock: Clock.Clock = {
  currentTimeMillisUnsafe: () => 1_700_000_000_000,
  currentTimeMillis: Effect.succeed(1_700_000_000_000),
  currentTimeNanosUnsafe: () => 1_700_000_000_000_000_000n,
  currentTimeNanos: Effect.succeed(1_700_000_000_000_000_000n),
  sleep: () => Effect.void,
};

const withClock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provideService(effect, Clock.Clock, fixedClock);

describe("train source adapters", () => {
  it("reconstructs KRL train runs across midnight and records the Grogol source repair", async () => {
    const topologies = inferTopologies(
      [
        {
          train_id: "1904A",
          stationId: "DU",
          ka_name: "COMMUTER LINE TANGERANG",
          route_name: "DURI-TANGERANG",
          dest: "TANGERANG",
          time_est: "23:56:00",
          color: "#623814",
          dest_time: "00:22:00",
        },
        {
          train_id: "1904A",
          stationId: "PSG",
          ka_name: "COMMUTER LINE TANGERANG",
          route_name: "DURI-TANGERANG",
          dest: "TANGERANG",
          time_est: "00:04:00",
          color: "#623814",
          dest_time: "00:22:00",
        },
      ],
      [
        { sta_id: "DU", sta_name: "DURI", group_wil: 0, fg_enable: 1 },
        { sta_id: "GGL", sta_name: "GROGOL", group_wil: 0, fg_enable: 0 },
        { sta_id: "PSG", sta_name: "PESING", group_wil: 0, fg_enable: 1 },
        { sta_id: "TNG", sta_name: "TANGERANG", group_wil: 0, fg_enable: 0 },
      ],
    );

    expect(topologies[0]?.stationIds).toEqual(["DU", "GGL", "PSG", "TNG"]);
    expect(topologies[0]?.notes[0]).toContain("official KCI schedules");
  });

  it("decodes fixture snapshots and keeps each system's completeness honest", async () => {
    const adapters = Layer.mergeAll(
      KrlSourceAdapter.layer,
      MrtSourceAdapter.layer,
      LrtSourceAdapter.layer,
    ).pipe(Layer.provide(fakeHttpLayer()));
    const program = Effect.gen(function* () {
      const krl = yield* KrlSourceAdapter.Service;
      const mrt = yield* MrtSourceAdapter.Service;
      const lrt = yield* LrtSourceAdapter.Service;
      return yield* Effect.all([krl.acquire(), mrt.acquire(), lrt.acquire()], { concurrency: 3 });
    }).pipe(Effect.provide(adapters), withClock);
    const [krl, mrt, lrt] = await Effect.runPromise(program);

    expect(krl._tag).toBe("Krl");
    expect(krl.topologies[0]?.stationIds).toEqual(["DU", "GGL", "PSG", "TNG"]);
    expect(mrt.availability).toMatchObject({ _tag: "Scheduled", topology: "unresolved" });
    expect(mrt.topologies).toEqual([]);
    expect(lrt.availability).toMatchObject({
      _tag: "Scheduled",
      semantics: "untagged-station-departures",
    });
    expect(lrt.topologies).toHaveLength(2);
  });

  it("reports provider shape drift with source-specific typed errors", async () => {
    const malformed = new Map(fixtures);
    malformed.set(KRL_STATIONS_URL, { status: 200, data: [{ sta_id: "DU", fg_enable: "yes" }] });
    malformed.set(MRT_STATIONS_URL, { meta: {} });
    malformed.set(LRT_SCHEDULES_URL, "<html>changed</html>");
    const adapters = Layer.mergeAll(
      KrlSourceAdapter.layer,
      MrtSourceAdapter.layer,
      LrtSourceAdapter.layer,
    ).pipe(Layer.provide(fakeHttpLayer(malformed)));
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const krl = yield* KrlSourceAdapter.Service;
        const mrt = yield* MrtSourceAdapter.Service;
        const lrt = yield* LrtSourceAdapter.Service;
        return yield* Effect.all([
          krl.acquire().pipe(Effect.result),
          mrt.acquire().pipe(Effect.result),
          lrt.acquire().pipe(Effect.result),
        ]);
      }).pipe(Effect.provide(adapters), withClock),
    );

    expect(
      results.map((result) => (result._tag === "Failure" ? result.failure._tag : "Success")),
    ).toEqual(["TrainImport.DecodeError", "TrainImport.DecodeError", "TrainImport.ParseError"]);
  });

  it("returns successful systems when one provider is unavailable and encodes byte-stably", async () => {
    const partial = new Map(fixtures);
    partial.delete(MRT_STATIONS_URL);
    const adapters = Layer.mergeAll(
      KrlSourceAdapter.layer,
      MrtSourceAdapter.layer,
      LrtSourceAdapter.layer,
    ).pipe(Layer.provide(fakeHttpLayer(partial)));
    const runtime = TrainSourceImporter.layer.pipe(Layer.provide(adapters));
    const program = Effect.gen(function* () {
      const importer = yield* TrainSourceImporter.Service;
      const report = yield* importer.import();
      const first = yield* TrainSourceImporter.encodeReport(report);
      const second = yield* TrainSourceImporter.encodeReport(report);
      return { report, first: JSON.stringify(first), second: JSON.stringify(second) };
    }).pipe(Effect.provide(runtime), withClock);
    const result = await Effect.runPromise(program);

    expect(result.report.snapshots.map((snapshot) => snapshot.system).sort()).toEqual([
      "krl",
      "lrt",
    ]);
    expect(result.report.failures).toMatchObject([
      { system: "mrt", errorTag: "TrainImport.TransportError" },
    ]);
    expect(result.first).toBe(result.second);
  });
});
