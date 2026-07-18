import { Effect } from "effect";

export interface OperationErrorInput {
  readonly operation: string;
  readonly cause: unknown;
}

export const operationError =
  <Error>(make: (input: OperationErrorInput) => Error) =>
  (operation: string) =>
  <Success, Failure, Requirements>(
    effect: Effect.Effect<Success, Failure, Requirements>,
  ): Effect.Effect<Success, Error, Requirements> =>
    effect.pipe(Effect.mapError((cause) => make({ operation, cause })));
