import { Effect, Schema } from "effect";

import { CorpusManifest } from "./corpus-manifest.js";
import { PlaceSearchCase } from "./place-search-case.js";
import { RouteGuideCase } from "./route-guide-case.js";
import { UsabilityTask } from "./usability-task.js";

export class CorpusDecodeError extends Schema.TaggedErrorClass<CorpusDecodeError>()(
  "RouteHelperCorpus.DecodeError",
  {
    fixture: Schema.String,
    reason: Schema.String,
  },
) {}

export class CorpusInvariantError extends Schema.TaggedErrorClass<CorpusInvariantError>()(
  "RouteHelperCorpus.InvariantError",
  {
    reason: Schema.String,
  },
) {}

export interface RouteHelperCorpusInput {
  readonly manifest: unknown;
  readonly placeSearchCases: unknown;
  readonly routeGuideCases: unknown;
  readonly usabilityTasks: unknown;
}

export interface RouteHelperCorpus {
  readonly manifest: CorpusManifest;
  readonly placeSearchCases: ReadonlyArray<PlaceSearchCase>;
  readonly routeGuideCases: ReadonlyArray<RouteGuideCase>;
  readonly usabilityTasks: ReadonlyArray<UsabilityTask>;
}

const prohibitedTimetableField =
  /(departure|arrival|waitMinutes|tripMinutes|walkMinutes|walkingMinutes|serviceDate|departureSeconds)/i;

const prohibitedStopHint =
  /\b(gtfs:|stop:[a-z0-9:_-]+|board at stop|boarding stop id|alight at stop id)\b/i;

const decodeArray = <A>(
  fixture: string,
  schema: Schema.ConstraintDecoder<A>,
  input: unknown,
): Effect.Effect<ReadonlyArray<A>, CorpusDecodeError> =>
  Schema.decodeUnknownEffect(Schema.Array(schema))(input).pipe(
    Effect.mapError(
      (error) =>
        new CorpusDecodeError({
          fixture,
          reason: `Schema validation failed: ${String(error)}`,
        }),
    ),
  );

const decodeManifest = (input: unknown): Effect.Effect<CorpusManifest, CorpusDecodeError> =>
  Schema.decodeUnknownEffect(CorpusManifest)(input).pipe(
    Effect.mapError(
      (error) =>
        new CorpusDecodeError({
          fixture: "manifest",
          reason: `Schema validation failed: ${String(error)}`,
        }),
    ),
  );

const assertUniqueIds = (kind: string, ids: ReadonlyArray<string>) => {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      return new CorpusInvariantError({ reason: `Duplicate ${kind} id: ${id}` });
    }
    seen.add(id);
  }
  return undefined;
};

const assertPlaceCaseInvariants = (cases: ReadonlyArray<PlaceSearchCase>) => {
  for (const placeCase of cases) {
    if (placeCase.expectNoLocalResult && placeCase.expectedPlaces.length > 0) {
      return new CorpusInvariantError({
        reason: `${placeCase.id} expects no local result but lists expected places`,
      });
    }
    if (!placeCase.expectNoLocalResult && placeCase.expectedPlaces.length === 0) {
      return new CorpusInvariantError({
        reason: `${placeCase.id} expects recognized places but lists none`,
      });
    }
    if (placeCase.expectNoLocalResult && !placeCase.categories.includes("ExpectedNoResult")) {
      return new CorpusInvariantError({
        reason: `${placeCase.id} expects no local result without ExpectedNoResult category`,
      });
    }
  }
  return undefined;
};

const assertRouteCaseInvariants = (cases: ReadonlyArray<RouteGuideCase>) => {
  for (const routeCase of cases) {
    if (routeCase.outcome === "KnownGap") {
      if (routeCase.acceptableSequences.length > 0) {
        return new CorpusInvariantError({
          reason: `${routeCase.id} is KnownGap but includes route instructions`,
        });
      }
      if (!routeCase.categories.includes("KnownGap")) {
        return new CorpusInvariantError({
          reason: `${routeCase.id} is KnownGap without KnownGap category`,
        });
      }
      continue;
    }

    if (routeCase.acceptableSequences.length === 0) {
      return new CorpusInvariantError({
        reason: `${routeCase.id} is Supported but has empty acceptable sequences`,
      });
    }

    for (const [sequenceIndex, sequence] of routeCase.acceptableSequences.entries()) {
      const transferCount = Math.max(0, sequence.steps.length - 1);
      if (transferCount > routeCase.maximumTransferCount) {
        return new CorpusInvariantError({
          reason: `${routeCase.id} sequence ${sequenceIndex} exceeds maximumTransferCount`,
        });
      }

      for (const [stepIndex, step] of sequence.steps.entries()) {
        const lines = step.lineOptions.map((option) => option.line);
        const uniqueLines = new Set(lines);
        if (uniqueLines.size !== lines.length) {
          return new CorpusInvariantError({
            reason: `${routeCase.id} step ${stepIndex} repeats a line option`,
          });
        }
        if (step.lineOptions.length >= 2 && uniqueLines.size < 2) {
          return new CorpusInvariantError({
            reason: `${routeCase.id} step ${stepIndex} interchangeable group needs two distinct lines`,
          });
        }

        const encoded = JSON.stringify(step);
        if (prohibitedTimetableField.test(encoded)) {
          return new CorpusInvariantError({
            reason: `${routeCase.id} step ${stepIndex} contains prohibited timetable fields`,
          });
        }
      }
    }
  }
  return undefined;
};

const assertUsabilityInvariants = (
  tasks: ReadonlyArray<UsabilityTask>,
  placeIds: ReadonlySet<string>,
  routeIds: ReadonlySet<string>,
) => {
  for (const task of tasks) {
    if (prohibitedStopHint.test(task.scenario) || prohibitedStopHint.test(task.expectedGoal)) {
      return new CorpusInvariantError({
        reason: `${task.id} scenario or goal contains prohibited stop-name/ID hints`,
      });
    }
    for (const placeId of task.relatedPlaceCaseIds) {
      if (!placeIds.has(placeId)) {
        return new CorpusInvariantError({
          reason: `${task.id} references missing place case ${placeId}`,
        });
      }
    }
    for (const routeId of task.relatedRouteCaseIds) {
      if (!routeIds.has(routeId)) {
        return new CorpusInvariantError({
          reason: `${task.id} references missing route case ${routeId}`,
        });
      }
    }
  }
  return undefined;
};

const assertReversePairs = (cases: ReadonlyArray<RouteGuideCase>) => {
  const byId = new Map(cases.map((routeCase) => [routeCase.id, routeCase]));
  for (const routeCase of cases) {
    if (routeCase.reverseOfCaseId === undefined) continue;
    const reverse = byId.get(routeCase.reverseOfCaseId);
    if (reverse === undefined) {
      return new CorpusInvariantError({
        reason: `${routeCase.id} reverseOfCaseId ${routeCase.reverseOfCaseId} does not exist`,
      });
    }
    if (reverse.outcome === "Supported" && routeCase.outcome === "Supported") {
      if (reverse.origin.label !== routeCase.destination.label) {
        return new CorpusInvariantError({
          reason: `${routeCase.id} reverse pair origin/destination labels do not mirror`,
        });
      }
      if (reverse.destination.label !== routeCase.origin.label) {
        return new CorpusInvariantError({
          reason: `${routeCase.id} reverse pair destination/origin labels do not mirror`,
        });
      }
    }
  }
  return undefined;
};

export const load = Effect.fn("RouteHelperCorpus.load")(function* (input: RouteHelperCorpusInput) {
  const manifest = yield* decodeManifest(input.manifest);
  const placeSearchCases = yield* decodeArray(
    "placeSearchCases",
    PlaceSearchCase,
    input.placeSearchCases,
  );
  const routeGuideCases = yield* decodeArray(
    "routeGuideCases",
    RouteGuideCase,
    input.routeGuideCases,
  );
  const usabilityTasks = yield* decodeArray("usabilityTasks", UsabilityTask, input.usabilityTasks);

  const duplicatePlace = assertUniqueIds(
    "place-search",
    placeSearchCases.map((placeCase) => placeCase.id),
  );
  if (duplicatePlace) return yield* Effect.fail(duplicatePlace);

  const duplicateRoute = assertUniqueIds(
    "route-guide",
    routeGuideCases.map((routeCase) => routeCase.id),
  );
  if (duplicateRoute) return yield* Effect.fail(duplicateRoute);

  const duplicateTask = assertUniqueIds(
    "usability-task",
    usabilityTasks.map((task) => task.id),
  );
  if (duplicateTask) return yield* Effect.fail(duplicateTask);

  if (manifest.counts.placeSearchCases !== placeSearchCases.length) {
    return yield* Effect.fail(
      new CorpusInvariantError({
        reason: `Manifest placeSearchCases count ${manifest.counts.placeSearchCases} != ${placeSearchCases.length}`,
      }),
    );
  }
  if (manifest.counts.routeGuideCases !== routeGuideCases.length) {
    return yield* Effect.fail(
      new CorpusInvariantError({
        reason: `Manifest routeGuideCases count ${manifest.counts.routeGuideCases} != ${routeGuideCases.length}`,
      }),
    );
  }
  if (manifest.counts.usabilityTasks !== usabilityTasks.length) {
    return yield* Effect.fail(
      new CorpusInvariantError({
        reason: `Manifest usabilityTasks count ${manifest.counts.usabilityTasks} != ${usabilityTasks.length}`,
      }),
    );
  }

  const placeInvariant = assertPlaceCaseInvariants(placeSearchCases);
  if (placeInvariant) return yield* Effect.fail(placeInvariant);

  const routeInvariant = assertRouteCaseInvariants(routeGuideCases);
  if (routeInvariant) return yield* Effect.fail(routeInvariant);

  const reverseInvariant = assertReversePairs(routeGuideCases);
  if (reverseInvariant) return yield* Effect.fail(reverseInvariant);

  const placeIds = new Set(placeSearchCases.map((placeCase) => placeCase.id));
  const routeIds = new Set(routeGuideCases.map((routeCase) => routeCase.id));
  const taskInvariant = assertUsabilityInvariants(usabilityTasks, placeIds, routeIds);
  if (taskInvariant) return yield* Effect.fail(taskInvariant);

  const sortedPlaces = [...placeSearchCases].sort((left, right) => left.id.localeCompare(right.id));
  const sortedRoutes = [...routeGuideCases].sort((left, right) => left.id.localeCompare(right.id));
  const sortedTasks = [...usabilityTasks].sort((left, right) => left.id.localeCompare(right.id));

  return {
    manifest,
    placeSearchCases: sortedPlaces,
    routeGuideCases: sortedRoutes,
    usabilityTasks: sortedTasks,
  } satisfies RouteHelperCorpus;
});

export const loadFromJsonText = Effect.fn("RouteHelperCorpus.loadFromJsonText")(function* (input: {
  readonly manifestText: string;
  readonly placeSearchCasesText: string;
  readonly routeGuideCasesText: string;
  readonly usabilityTasksText: string;
}) {
  const parse = (fixture: string, text: string) =>
    Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (error) =>
        new CorpusDecodeError({
          fixture,
          reason: `Invalid JSON: ${String(error)}`,
        }),
    });

  return yield* load({
    manifest: yield* parse("manifest", input.manifestText),
    placeSearchCases: yield* parse("placeSearchCases", input.placeSearchCasesText),
    routeGuideCases: yield* parse("routeGuideCases", input.routeGuideCasesText),
    usabilityTasks: yield* parse("usabilityTasks", input.usabilityTasksText),
  });
});
