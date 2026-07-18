import { readFile, readdir } from "node:fs/promises";

import { Effect, Result, Schema } from "effect";
import { strToU8, zipSync } from "fflate";
import { describe, expect } from "vitest";

import { NetworkSnapshot } from "../../domain/transit/index.js";
import { itEffect } from "../../testing/effect.js";
import { compileGtfs, encodeGeometry, encodeSnapshot, parseServiceTime } from "./compiler.js";
import { decodeTable, parseCsv } from "./csv.js";
import { GtfsTableError, GtfsValidationError } from "./errors.js";
import { RawStop } from "./raw.js";

const generatedAt = "2026-07-18T00:00:00.000Z";
const fixtureDirectory = new URL("../../../test/fixtures/gtfs/valid/", import.meta.url);

const fixtureArchive = Effect.promise(async () => {
  const names = await readdir(fixtureDirectory);
  const files: Record<string, Uint8Array> = {};
  for (const name of names.sort()) {
    files[name] = await readFile(new URL(name, fixtureDirectory));
  }
  return zipSync(files, { level: 6 });
});

const replaceInArchive = (file: string, contents: string) =>
  Effect.promise(async () => {
    const names = await readdir(fixtureDirectory);
    const files: Record<string, Uint8Array> = {};
    for (const name of names.sort()) {
      files[name] =
        name === file ? strToU8(contents) : await readFile(new URL(name, fixtureDirectory));
    }
    return zipSync(files, { level: 6 });
  });

describe("GTFS CSV boundary", () => {
  itEffect(
    "parses quoted commas, escaped quotes, and CRLF",
    Effect.gen(function* () {
      const parsed = yield* parseCsv(
        "stops",
        'stop_id,stop_name,stop_lat,stop_lon\r\nA,"Central, ""North""",-6.1,106.8\r\n',
      );
      expect(parsed.records[0]?.values.stop_name).toBe('Central, "North"');
    }),
  );

  itEffect(
    "reports missing required columns with table and header row",
    Effect.gen(function* () {
      const result = yield* decodeTable({
        table: "stops",
        input: "stop_id,stop_lat,stop_lon\nA,-6.1,106.8\n",
        schema: RawStop,
        requiredColumns: ["stop_id", "stop_name"],
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toEqual(
          expect.objectContaining({ _tag: "GtfsTableError", table: "stops", rowNumber: 1 }),
        );
      }
    }),
  );

  itEffect(
    "rejects empty required fields without rejecting empty optional fields",
    Effect.gen(function* () {
      const valid = yield* decodeTable({
        table: "stops",
        input: "stop_id,stop_name,stop_lat,stop_lon,parent_station\nA,Alpha,-6.1,106.8,\n",
        schema: RawStop,
        requiredColumns: ["stop_id", "stop_name"],
      });
      expect(valid).toHaveLength(1);

      const invalid = yield* decodeTable({
        table: "stops",
        input: "stop_id,stop_name\nA,\n",
        schema: RawStop,
        requiredColumns: ["stop_id", "stop_name"],
      }).pipe(Effect.result);
      expect(Result.isFailure(invalid)).toBe(true);
    }),
  );
});

describe("GTFS compiler", () => {
  itEffect(
    "preserves service times beyond 24 hours",
    Effect.gen(function* () {
      expect(yield* parseServiceTime("25:10:00")).toBe(90_600);
      const invalid = yield* parseServiceTime("25:60:00").pipe(Effect.result);
      expect(Result.isFailure(invalid)).toBe(true);
    }),
  );

  itEffect(
    "compiles the synthetic ZIP into canonical topology and geometry",
    Effect.gen(function* () {
      const input = yield* fixtureArchive;
      const compiled = yield* compileGtfs({
        input,
        generatedAt,
        sourceName: "fixture.zip",
      });
      expect(compiled.summary).toEqual(
        expect.objectContaining({
          agencies: 1,
          stops: 4,
          routes: 1,
          patterns: 2,
          trips: 3,
          calendars: 1,
          transfers: 1,
          geometries: 2,
        }),
      );
      expect(compiled.snapshot.patterns.map((pattern) => pattern.stopIds)).toEqual(
        expect.arrayContaining([
          ["gtfs:transjakarta:stop:A", "gtfs:transjakarta:stop:B", "gtfs:transjakarta:stop:C"],
          ["gtfs:transjakarta:stop:A", "gtfs:transjakarta:stop:D", "gtfs:transjakarta:stop:C"],
        ]),
      );
      const encoded = yield* encodeSnapshot(compiled.snapshot);
      yield* Schema.decodeUnknownEffect(NetworkSnapshot)(encoded);
      expect(JSON.stringify(encoded)).not.toContain("coordinates");
    }),
  );

  itEffect(
    "emits byte-identical encoded artifacts for identical inputs",
    Effect.gen(function* () {
      const input = yield* fixtureArchive;
      const first = yield* compileGtfs({ input, generatedAt, sourceName: "fixture.zip" });
      const second = yield* compileGtfs({ input, generatedAt, sourceName: "fixture.zip" });
      expect(JSON.stringify(yield* encodeSnapshot(first.snapshot))).toBe(
        JSON.stringify(yield* encodeSnapshot(second.snapshot)),
      );
      expect(JSON.stringify(yield* encodeGeometry(first.geometry))).toBe(
        JSON.stringify(yield* encodeGeometry(second.geometry)),
      );
    }),
  );

  itEffect(
    "rejects non-monotonic stop sequences",
    Effect.gen(function* () {
      const invalid = yield* replaceInArchive(
        "stop_times.txt",
        "trip_id,stop_sequence,stop_id,arrival_time,departure_time\nT1,1,A,05:00:00,05:00:10\nT1,0,B,05:05:00,05:05:10\n",
      );
      const result = yield* compileGtfs({
        input: invalid,
        generatedAt,
        sourceName: "fixture.zip",
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toEqual(
          expect.objectContaining({
            _tag: "GtfsValidationError",
            code: "NON_MONOTONIC_STOP_SEQUENCE",
          }),
        );
      }
    }),
  );

  itEffect(
    "rejects dangling stop references",
    Effect.gen(function* () {
      const invalid = yield* replaceInArchive(
        "transfers.txt",
        "from_stop_id,to_stop_id,transfer_type,min_transfer_time\nB,MISSING,0,\n",
      );
      const result = yield* compileGtfs({
        input: invalid,
        generatedAt,
        sourceName: "fixture.zip",
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toEqual(
          expect.objectContaining({ _tag: "GtfsValidationError", code: "DANGLING_TRANSFER_STOP" }),
        );
      }
    }),
  );
});

describe("typed GTFS errors", () => {
  itEffect(
    "keeps table errors compact",
    Effect.sync(() => {
      const error = new GtfsTableError({ table: "stops", rowNumber: 2, reason: "Malformed" });
      expect(JSON.stringify(error)).not.toContain("stop_name");
      expect(error.rowNumber).toBe(2);
    }),
  );

  itEffect(
    "keeps validation errors discriminated",
    Effect.sync(() => {
      const error = new GtfsValidationError({ code: "TEST", message: "test" });
      expect(error._tag).toBe("GtfsValidationError");
    }),
  );
});
