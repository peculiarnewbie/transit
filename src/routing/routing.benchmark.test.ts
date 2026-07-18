import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  mediumNetworkFixture,
  mediumNetworkSize,
  mediumQueries,
} from "./fixtures/medium-network.js";
import { Router } from "./index.js";

const runQueries = Effect.gen(function* () {
  const router = yield* Router.Service;
  const results = [];
  for (const query of mediumQueries) results.push(yield* router.route(query));
  return JSON.stringify(results);
}).pipe(Effect.provide(Router.layer(mediumNetworkFixture)));

describe("routing deterministic benchmark", () => {
  it("returns 100 stable results within the generous regression budget", async () => {
    const startedAt = performance.now();
    const first = await Effect.runPromise(runQueries);
    const second = await Effect.runPromise(runQueries);
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(mediumQueries).toHaveLength(100);
    expect(mediumNetworkSize).toEqual({ routes: 20, patterns: 20, trips: 20, stops: 200 });
    expect(second).toBe(first);
    expect(elapsedMilliseconds).toBeLessThan(10_000);
  });
});
