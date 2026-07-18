import { readFileSync } from "node:fs";
import path from "node:path";

import { Effect, Result, Schema } from "effect";
import { describe, expect } from "vitest";

import { itEffect } from "../../testing/effect.js";
import {
  CorpusManifest,
  load,
  loadFromJsonText,
  PlaceSearchCase,
  RouteGuideCase,
  UsabilityTask,
} from "./index.js";

const fixtureDirectory = path.resolve("test/fixtures/route-helper");
const readFixture = (name: string) => readFileSync(path.join(fixtureDirectory, name), "utf8");

const loadReviewedCorpus = () =>
  loadFromJsonText({
    manifestText: readFixture("corpus-manifest.json"),
    placeSearchCasesText: readFixture("place-search-cases.json"),
    routeGuideCasesText: readFixture("route-guide-cases.json"),
    usabilityTasksText: readFixture("usability-tasks.json"),
  });

describe("route helper corpus schemas", () => {
  itEffect(
    "round-trips reviewed fixtures through Schema decode/encode",
    Effect.gen(function* () {
      const corpus = yield* loadReviewedCorpus();
      const places = yield* Schema.decodeUnknownEffect(Schema.Array(PlaceSearchCase))(
        yield* Schema.encodeEffect(Schema.Array(PlaceSearchCase))(corpus.placeSearchCases),
      );
      const routes = yield* Schema.decodeUnknownEffect(Schema.Array(RouteGuideCase))(
        yield* Schema.encodeEffect(Schema.Array(RouteGuideCase))(corpus.routeGuideCases),
      );
      const tasks = yield* Schema.decodeUnknownEffect(Schema.Array(UsabilityTask))(
        yield* Schema.encodeEffect(Schema.Array(UsabilityTask))(corpus.usabilityTasks),
      );
      const manifest = yield* Schema.decodeUnknownEffect(CorpusManifest)(
        yield* Schema.encodeEffect(CorpusManifest)(corpus.manifest),
      );
      expect(places.length).toBe(corpus.placeSearchCases.length);
      expect(routes.length).toBe(corpus.routeGuideCases.length);
      expect(tasks.length).toBe(corpus.usabilityTasks.length);
      expect(manifest.sourceArtifactVersion).toBe("bus-transjakarta-20260630-v2");
    }),
  );

  itEffect(
    "sorts cases deterministically by id",
    Effect.gen(function* () {
      const corpus = yield* loadReviewedCorpus();
      const placeIds = corpus.placeSearchCases.map((placeCase) => placeCase.id);
      const routeIds = corpus.routeGuideCases.map((routeCase) => routeCase.id);
      const taskIds = corpus.usabilityTasks.map((task) => task.id);
      expect(placeIds).toEqual([...placeIds].sort((a, b) => a.localeCompare(b)));
      expect(routeIds).toEqual([...routeIds].sort((a, b) => a.localeCompare(b)));
      expect(taskIds).toEqual([...taskIds].sort((a, b) => a.localeCompare(b)));
    }),
  );

  itEffect(
    "rejects duplicate place-search ids",
    Effect.gen(function* () {
      const corpus = yield* loadReviewedCorpus();
      const duplicate = corpus.placeSearchCases[0];
      const result = yield* load({
        manifest: {
          ...corpus.manifest,
          counts: {
            ...corpus.manifest.counts,
            placeSearchCases: corpus.placeSearchCases.length + 1,
          },
        },
        placeSearchCases: [...corpus.placeSearchCases, duplicate],
        routeGuideCases: corpus.routeGuideCases,
        usabilityTasks: corpus.usabilityTasks,
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toContain("Duplicate place-search id");
      }
    }),
  );

  itEffect(
    "rejects manifest count mismatches",
    Effect.gen(function* () {
      const corpus = yield* loadReviewedCorpus();
      const result = yield* load({
        manifest: {
          ...corpus.manifest,
          counts: { ...corpus.manifest.counts, routeGuideCases: 1 },
        },
        placeSearchCases: corpus.placeSearchCases,
        routeGuideCases: corpus.routeGuideCases,
        usabilityTasks: corpus.usabilityTasks,
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toContain("Manifest routeGuideCases count");
      }
    }),
  );

  itEffect(
    "rejects KnownGap cases that invent route instructions",
    Effect.gen(function* () {
      const corpus = yield* loadReviewedCorpus();
      const gap = corpus.routeGuideCases.find((routeCase) => routeCase.outcome === "KnownGap");
      expect(gap).toBeDefined();
      const malformed = {
        ...gap!,
        acceptableSequences: [
          {
            steps: [
              {
                lineOptions: [{ line: "1", headsign: "Kota" }],
                boardingPlaceLabel: "Blok M",
                alightingPlaceLabel: "Kota",
                intermediateStopLabels: [],
              },
            ],
          },
        ],
      };
      const result = yield* load({
        manifest: corpus.manifest,
        placeSearchCases: corpus.placeSearchCases,
        routeGuideCases: corpus.routeGuideCases.map((routeCase) =>
          routeCase.id === gap!.id ? malformed : routeCase,
        ),
        usabilityTasks: corpus.usabilityTasks,
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toContain("KnownGap but includes route instructions");
      }
    }),
  );

  itEffect(
    "rejects interchangeable groups with fewer than two distinct lines",
    Effect.gen(function* () {
      const corpus = yield* loadReviewedCorpus();
      const supported = corpus.routeGuideCases.find(
        (routeCase) => routeCase.outcome === "Supported",
      );
      expect(supported).toBeDefined();
      const malformed = {
        ...supported!,
        acceptableSequences: [
          {
            steps: [
              {
                lineOptions: [
                  { line: "9", headsign: "Pluit" },
                  { line: "9", headsign: "Pluit via Semanggi" },
                ],
                boardingPlaceLabel: "Cawang",
                alightingPlaceLabel: "Grogol Reformasi",
                intermediateStopLabels: [],
              },
            ],
          },
        ],
      };
      const result = yield* load({
        manifest: corpus.manifest,
        placeSearchCases: corpus.placeSearchCases,
        routeGuideCases: corpus.routeGuideCases.map((routeCase) =>
          routeCase.id === supported!.id ? malformed : routeCase,
        ),
        usabilityTasks: corpus.usabilityTasks,
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toMatch(/repeats a line option|two distinct lines/);
      }
    }),
  );

  itEffect(
    "rejects malformed place-search cases missing expected places",
    Effect.gen(function* () {
      const corpus = yield* loadReviewedCorpus();
      const sample = corpus.placeSearchCases.find((placeCase) => !placeCase.expectNoLocalResult);
      expect(sample).toBeDefined();
      const malformed = { ...sample!, expectedPlaces: [] };
      const result = yield* load({
        manifest: corpus.manifest,
        placeSearchCases: corpus.placeSearchCases.map((placeCase) =>
          placeCase.id === sample!.id ? malformed : placeCase,
        ),
        routeGuideCases: corpus.routeGuideCases,
        usabilityTasks: corpus.usabilityTasks,
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  itEffect(
    "rejects usability tasks with prohibited stop-id hints",
    Effect.gen(function* () {
      const corpus = yield* loadReviewedCorpus();
      const task = corpus.usabilityTasks[0]!;
      const malformed = {
        ...task,
        scenario: `Board using gtfs:transjakarta:stop:B00001 from ${task.scenario}`,
      };
      const result = yield* load({
        manifest: corpus.manifest,
        placeSearchCases: corpus.placeSearchCases,
        routeGuideCases: corpus.routeGuideCases,
        usabilityTasks: corpus.usabilityTasks.map((item) =>
          item.id === task.id ? malformed : item,
        ),
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toContain("prohibited stop-name/ID hints");
      }
    }),
  );

  itEffect(
    "rejects corpus references to nonexistent case ids",
    Effect.gen(function* () {
      const corpus = yield* loadReviewedCorpus();
      const task = corpus.usabilityTasks[0]!;
      const malformed = {
        ...task,
        relatedRouteCaseIds: ["route:does-not-exist"],
      };
      const result = yield* load({
        manifest: corpus.manifest,
        placeSearchCases: corpus.placeSearchCases,
        routeGuideCases: corpus.routeGuideCases,
        usabilityTasks: corpus.usabilityTasks.map((item) =>
          item.id === task.id ? malformed : item,
        ),
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toContain("missing route case");
      }
    }),
  );

  itEffect(
    "rejects Supported cases with empty acceptable sequences",
    Effect.gen(function* () {
      const corpus = yield* loadReviewedCorpus();
      const supported = corpus.routeGuideCases.find(
        (routeCase) => routeCase.outcome === "Supported",
      );
      expect(supported).toBeDefined();
      const malformed = { ...supported!, acceptableSequences: [] };
      const result = yield* load({
        manifest: corpus.manifest,
        placeSearchCases: corpus.placeSearchCases,
        routeGuideCases: corpus.routeGuideCases.map((routeCase) =>
          routeCase.id === supported!.id ? malformed : routeCase,
        ),
        usabilityTasks: corpus.usabilityTasks,
      }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toContain("empty acceptable sequences");
      }
    }),
  );
});

describe("route helper corpus coverage minima", () => {
  itEffect(
    "prints and enforces place-search category minima",
    Effect.gen(function* () {
      const corpus = yield* loadReviewedCorpus();
      const byCategory = new Map<string, number>();
      const byAdmin = new Map<string, number>();
      for (const placeCase of corpus.placeSearchCases) {
        for (const category of placeCase.categories) {
          byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
        }
        byAdmin.set(placeCase.adminCoverage, (byAdmin.get(placeCase.adminCoverage) ?? 0) + 1);
      }

      const report = {
        total: corpus.placeSearchCases.length,
        byCategory: Object.fromEntries([...byCategory.entries()].sort()),
        byAdmin: Object.fromEntries([...byAdmin.entries()].sort()),
        expectedNoResult: corpus.placeSearchCases.filter(
          (placeCase) => placeCase.expectNoLocalResult,
        ).length,
        ambiguous: byCategory.get("Ambiguous") ?? 0,
        spellingVariant: byCategory.get("SpellingVariant") ?? 0,
      };
      console.log("[route-helper place coverage]", JSON.stringify(report));

      expect(corpus.placeSearchCases.length).toBeGreaterThanOrEqual(60);
      for (const city of [
        "Jakarta Pusat",
        "Jakarta Utara",
        "Jakarta Barat",
        "Jakarta Selatan",
        "Jakarta Timur",
      ]) {
        expect(byAdmin.get(city) ?? 0).toBeGreaterThanOrEqual(1);
      }
      expect(byAdmin.get("EdgeNetwork") ?? 0).toBeGreaterThanOrEqual(1);
      expect(byCategory.get("Neighbourhood") ?? 0).toBeGreaterThanOrEqual(1);
      expect(byCategory.get("Landmark") ?? 0).toBeGreaterThanOrEqual(1);
      expect(byCategory.get("ExactStop") ?? 0).toBeGreaterThanOrEqual(1);
      expect(byCategory.get("Abbreviation") ?? 0).toBeGreaterThanOrEqual(1);
      expect(byCategory.get("SpellingVariant") ?? 0).toBeGreaterThanOrEqual(10);
      expect(byCategory.get("Ambiguous") ?? 0).toBeGreaterThanOrEqual(10);
      expect(byCategory.get("ExpectedNoResult") ?? 0).toBeGreaterThanOrEqual(10);
      for (const required of [
        "Kota Tua",
        "Grand Indonesia",
        "Universitas Indonesia",
        "Blok M",
        "Bundaran HI",
        "Tanah Abang",
        "Jakarta International Stadium",
      ]) {
        expect(
          corpus.placeSearchCases.some(
            (placeCase) =>
              placeCase.query === required ||
              placeCase.expectedPlaces.some((expected) => expected.name === required),
          ),
        ).toBe(true);
      }
    }),
  );

  itEffect(
    "prints and enforces route-guide category minima",
    Effect.gen(function* () {
      const corpus = yield* loadReviewedCorpus();
      const byCategory = new Map<string, number>();
      for (const routeCase of corpus.routeGuideCases) {
        for (const category of routeCase.categories) {
          byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
        }
      }
      const knownGaps = corpus.routeGuideCases.filter(
        (routeCase) => routeCase.outcome === "KnownGap",
      ).length;
      const report = {
        total: corpus.routeGuideCases.length,
        byCategory: Object.fromEntries([...byCategory.entries()].sort()),
        knownGaps,
        interchangeable: byCategory.get("InterchangeableLines") ?? 0,
      };
      console.log("[route-helper route coverage]", JSON.stringify(report));

      expect(corpus.routeGuideCases.length).toBeGreaterThanOrEqual(50);
      expect(byCategory.get("Direct") ?? 0).toBeGreaterThanOrEqual(15);
      expect(byCategory.get("OneTransfer") ?? 0).toBeGreaterThanOrEqual(15);
      expect(byCategory.get("TwoTransfer") ?? 0).toBeGreaterThanOrEqual(8);
      expect(byCategory.get("ReversePair") ?? 0).toBeGreaterThanOrEqual(6);
      expect(knownGaps).toBeGreaterThanOrEqual(6);
      expect(byCategory.get("InterchangeableLines") ?? 0).toBeGreaterThanOrEqual(1);
      expect(
        corpus.routeGuideCases.some((routeCase) =>
          routeCase.acceptableSequences.some((sequence) =>
            sequence.steps.some((step) => {
              const lines = new Set(step.lineOptions.map((option) => option.line));
              return lines.has("9") && lines.has("9A");
            }),
          ),
        ),
      ).toBe(true);

      for (const [origin, destination] of [
        ["Blok M", "Bundaran HI"],
        ["Blok M", "Kota"],
        ["Ragunan", "Harmoni"],
        ["Jakarta International Stadium", "Blok M"],
        ["Kalideres", "Pulo Gadung"],
        ["Tanjung Priok", "Lebak Bulus"],
        ["Cawang", "Kota"],
      ] as const) {
        expect(
          corpus.routeGuideCases.some(
            (routeCase) =>
              routeCase.origin.label === origin && routeCase.destination.label === destination,
          ),
        ).toBe(true);
      }

      for (const routeCase of corpus.routeGuideCases) {
        const encoded = JSON.stringify(routeCase.acceptableSequences);
        expect(encoded).not.toMatch(
          /"(departure|arrival|waitMinutes|tripMinutes|walkMinutes|walkingMinutes|serviceDate|departureSeconds)"/,
        );
      }
    }),
  );

  itEffect(
    "enforces usability task minima and interaction coverage",
    Effect.gen(function* () {
      const corpus = yield* loadReviewedCorpus();
      expect(corpus.usabilityTasks.length).toBeGreaterThanOrEqual(6);
      const interactions = new Set(corpus.usabilityTasks.flatMap((task) => [...task.interactions]));
      for (const required of [
        "AutocompleteBelowActiveInput",
        "OriginDestinationSwap",
        "FloatingTopControlPhone",
        "FloatingSidePanelDesktop",
        "InterchangeableLineStep",
        "WithoutOpeningMap",
      ]) {
        expect(interactions.has(required as never)).toBe(true);
      }
      expect(corpus.manifest.releaseThreshold.unfamiliarParticipants).toBe(5);
      expect(corpus.manifest.releaseThreshold.requiredSuccessesPerCoreTask).toBe(4);
    }),
  );
});
