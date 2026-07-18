import { Clock, Context, Effect, Layer, Schema } from "effect";

import { KrlSourceAdapter } from "./krl/adapter.js";
import { LrtSourceAdapter } from "./lrt/adapter.js";
import { type TrainSystem, TrainImportReport, TrainSourceSnapshot } from "./model.js";
import { MrtSourceAdapter } from "./mrt/adapter.js";

export interface ImportOptions {
  readonly systems?: ReadonlyArray<TrainSystem>;
}

export interface Interface {
  readonly import: (options?: ImportOptions) => Effect.Effect<typeof TrainImportReport.Type>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@transit/TrainSourceImporter",
) {}

const failureDetail = (error: {
  readonly _tag: string;
  readonly operation: string;
  readonly source: string;
}) => ({
  errorTag: error._tag,
  operation: error.operation,
  detail: `Source operation failed (${error.source}).`,
});

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const krl = yield* KrlSourceAdapter.Service;
    const lrt = yield* LrtSourceAdapter.Service;
    const mrt = yield* MrtSourceAdapter.Service;

    const acquire = {
      krl: krl.acquire,
      lrt: lrt.acquire,
      mrt: mrt.acquire,
    } satisfies Record<
      TrainSystem,
      () => Effect.Effect<
        typeof TrainSourceSnapshot.Type,
        { _tag: string; operation: string; source: string }
      >
    >;

    const importSources = Effect.fn("TrainSourceImporter.import")(function* (
      options: ImportOptions = {},
    ) {
      const generatedAt = yield* Schema.decodeUnknownEffect(Schema.DateTimeUtcFromString)(
        new Date(yield* Clock.currentTimeMillis).toISOString(),
      ).pipe(Effect.orDie);
      const systems = [...new Set(options.systems ?? (["krl", "mrt", "lrt"] as const))].sort();
      const results = yield* Effect.forEach(
        systems,
        (system) => acquire[system]().pipe(Effect.result),
        { concurrency: 3 },
      );
      return yield* TrainImportReport.makeEffect({
        schemaVersion: "1",
        generatedAt,
        snapshots: results.flatMap((result) => (result._tag === "Success" ? [result.success] : [])),
        failures: results.flatMap((result, index) =>
          result._tag === "Failure"
            ? [{ system: systems[index]!, ...failureDetail(result.failure) }]
            : [],
        ),
      }).pipe(Effect.orDie);
    });

    return Service.of({ import: importSources });
  }),
);

export const encodeReport = Schema.encodeUnknownEffect(TrainImportReport);

export * as TrainSourceImporter from "./importer.js";
