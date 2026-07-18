import { Context, Effect, Layer, Result, Schema } from "effect";

import { compileGuideGraph, type CompileGuideGraphOptions, type GuideGraph } from "./graph.js";
import { projectInstructions, type GuideInstructions } from "./instructions.js";
import {
  type GuideAlternative,
  type RouteGuideError,
  RouteGuideQuery,
  type RouteGuideResult,
} from "./model.js";
import { searchGuidePaths } from "./search.js";

export interface Interface {
  readonly graph: GuideGraph;
  readonly guide: (input: unknown) => Effect.Effect<RouteGuideResult, RouteGuideError>;
  readonly instruct: (alternative: GuideAlternative) => Effect.Effect<GuideInstructions, never>;
}

export class Service extends Context.Service<Service, Interface>()("@transit/RouteGuide") {}

export const make = Effect.fn("RouteGuide.make")(function* (options: CompileGuideGraphOptions) {
  const graph = yield* compileGuideGraph(options);
  const guide = Effect.fn("RouteGuide.guide")(function* (input: unknown) {
    const decodedResult = yield* Schema.decodeUnknownEffect(RouteGuideQuery)(input).pipe(
      Effect.result,
    );
    if (Result.isFailure(decodedResult)) {
      return {
        _tag: "InvalidCandidateSet" as const,
        reason: `Invalid route-guide query: ${String(decodedResult.failure)}`,
      } satisfies RouteGuideResult;
    }
    const decoded = decodedResult.success;

    for (const candidate of [...decoded.origins, ...decoded.destinations]) {
      if (!graph.placesById.has(candidate.transitPlaceId)) {
        return {
          _tag: "InvalidCandidateSet" as const,
          reason: `Unknown transit place candidate ${candidate.transitPlaceId}`,
        } satisfies RouteGuideResult;
      }
    }

    return yield* searchGuidePaths(graph, decoded);
  });

  const instruct = Effect.fn("RouteGuide.instruct")(function* (alternative: GuideAlternative) {
    return yield* Effect.succeed(projectInstructions(alternative));
  });

  return Service.of({ graph, guide, instruct });
});

export const layer = (options: CompileGuideGraphOptions) => Layer.effect(Service, make(options));

export const testLayer = layer;
