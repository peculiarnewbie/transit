import { Effect } from "effect";
import { describe, expect } from "vitest";

import { itEffect } from "../testing/effect.js";
import { reviewedComplexOverride, topologyNetwork } from "./fixtures.js";
import { canAlight, canBoard, compileGuideGraph } from "./graph.js";

describe("route-guide graph", () => {
  itEffect(
    "compiles direct, reverse, branch, and loop patterns",
    Effect.gen(function* () {
      const graph = yield* compileGuideGraph({
        snapshot: topologyNetwork,
        sourceArtifactVersion: "fixture-topology-v1",
      });
      const patternIds = new Set(graph.patterns.map((pattern) => pattern.patternId));
      expect(patternIds.has("pattern:1")).toBe(true);
      expect(patternIds.has("pattern:1-rev")).toBe(true);
      expect(patternIds.has("pattern:branch-main")).toBe(true);
      expect(patternIds.has("pattern:branch-side")).toBe(true);
      expect(patternIds.has("pattern:loop")).toBe(true);
    }),
  );

  itEffect(
    "collapses duplicate scheduled sequences into one guide pattern",
    Effect.gen(function* () {
      const graph = yield* compileGuideGraph({
        snapshot: topologyNetwork,
        sourceArtifactVersion: "fixture-topology-v1",
      });
      expect(graph.duplicateSequenceCollapseCount).toBeGreaterThanOrEqual(1);
      const dupPatterns = graph.patterns.filter((pattern) => pattern.routeId === "route:dup");
      expect(dupPatterns).toHaveLength(1);
    }),
  );

  itEffect(
    "respects forbidden pickup and drop-off policies",
    Effect.gen(function* () {
      const graph = yield* compileGuideGraph({
        snapshot: topologyNetwork,
        sourceArtifactVersion: "fixture-topology-v1",
      });
      const forbid = graph.patterns.find((pattern) => pattern.patternId === "pattern:forbid");
      expect(forbid).toBeDefined();
      expect(canBoard(forbid!, 0)).toBe(false);
      expect(canAlight(forbid!, 2)).toBe(false);
      expect(canBoard(forbid!, 1)).toBe(true);
      expect(canAlight(forbid!, 1)).toBe(true);
    }),
  );

  itEffect(
    "keeps explicit published transfers",
    Effect.gen(function* () {
      const graph = yield* compileGuideGraph({
        snapshot: topologyNetwork,
        sourceArtifactVersion: "fixture-topology-v1",
      });
      const edges = graph.transferEdgesFrom.get("stop:named-transfer-a") ?? [];
      expect(
        edges.some(
          (edge) =>
            edge.toStopId === "stop:named-transfer-b" && edge.evidence._tag === "PublishedTransfer",
        ),
      ).toBe(true);
    }),
  );

  itEffect(
    "indexes route-level transfer predecessors for destination pruning",
    Effect.gen(function* () {
      const graph = yield* compileGuideGraph({
        snapshot: topologyNetwork,
        sourceArtifactVersion: "fixture-topology-v1",
      });

      expect(graph.boardableRouteIdsByStopId.get("stop:A")?.has("route:1")).toBe(true);
      expect(graph.alightableRouteIdsByStopId.get("stop:F")?.has("route:2")).toBe(true);
      expect(graph.predecessorRouteIdsByRouteId.get("route:2")?.has("route:1")).toBe(true);
    }),
  );

  itEffect(
    "does not treat reviewed grouping alone as a transfer edge",
    Effect.gen(function* () {
      const graph = yield* compileGuideGraph({
        snapshot: topologyNetwork,
        sourceArtifactVersion: "fixture-topology-v1",
        overrides: reviewedComplexOverride,
      });
      const place = Object.values(graph.places.placesById).find(
        (candidate) => candidate.primaryName === "Grouped Complex",
      );
      expect(place).toBeDefined();
      const fromX = graph.transferEdgesFrom.get("stop:group-x") ?? [];
      expect(
        fromX.some(
          (edge) => edge.toStopId === "stop:group-y" && edge.evidence._tag !== "PublishedTransfer",
        ),
      ).toBe(false);
    }),
  );

  itEffect(
    "links source-station sibling platforms for transfer",
    Effect.gen(function* () {
      const graph = yield* compileGuideGraph({
        snapshot: topologyNetwork,
        sourceArtifactVersion: "fixture-topology-v1",
      });
      const edges = graph.transferEdgesFrom.get("stop:plat-1") ?? [];
      expect(
        edges.some(
          (edge) => edge.toStopId === "stop:plat-2" && edge.evidence._tag === "SourceStation",
        ),
      ).toBe(true);
    }),
  );
});
