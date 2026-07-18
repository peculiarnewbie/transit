import { Effect } from "effect";
import { it } from "vitest";

export const itEffect = (name: string, effect: Effect.Effect<unknown, unknown, never>) =>
  it(name, () => Effect.runPromise(effect));
