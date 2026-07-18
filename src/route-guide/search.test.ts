import { Effect } from "effect";
import { describe, expect } from "vitest";

import { itEffect } from "../testing/effect.js";
import { topologyNetwork } from "./fixtures.js";
import { compileGuideGraph, type GuideGraph, placeIdForStop } from "./graph.js";
import { compareAlternatives, searchGuidePaths } from "./search.js";
import type { RouteGuideQuery } from "./model.js";

const queryFor = (
  graph: GuideGraph,
  originStopId: string,
  destinationStopId: string,
  overrides: Partial<RouteGuideQuery> = {},
): RouteGuideQuery => {
  const originPlaceId = placeIdForStop(graph, originStopId);
  const destinationPlaceId = placeIdForStop(graph, destinationStopId);
  if (originPlaceId === undefined || destinationPlaceId === undefined) {
    throw new Error("missing places");
  }
  return {
    origins: [{ transitPlaceId: originPlaceId as never }],
    destinations: [{ transitPlaceId: destinationPlaceId as never }],
    maximumTransfers: 2,
    maximumOriginCandidates: 8,
    maximumDestinationCandidates: 8,
    maximumAlternatives: 6,
    maximumExpandedStates: 50_000,
    ...overrides,
  };
};

const compileGraph = () =>
  compileGuideGraph({
    snapshot: topologyNetwork,
    sourceArtifactVersion: "fixture-topology-v1",
  });

describe("route-guide search", () => {
  itEffect(
    "finds a direct ride and prefers it over transfers",
    Effect.gen(function* () {
      const graph = yield* compileGraph();
      const result = yield* searchGuidePaths(graph, queryFor(graph, "stop:A", "stop:D"));
      expect(result._tag).toBe("GuidesFound");
      if (result._tag !== "GuidesFound") return;
      expect(result.alternatives[0]?.metrics.transferCount).toBe(0);
      expect(result.alternatives[0]?.rideSteps[0]?.lineOptions[0]?.passengerLineName).toBe("1");
      expect(result.expandedStates).toBeLessThan(50);
    }),
  );

  itEffect(
    "groups 9 and 9A into one interchangeable ride step",
    Effect.gen(function* () {
      const graph = yield* compileGraph();
      const result = yield* searchGuidePaths(
        graph,
        queryFor(graph, "stop:cawang", "stop:grogol", { maximumTransfers: 0 }),
      );
      expect(result._tag).toBe("GuidesFound");
      if (result._tag !== "GuidesFound") return;
      const step = result.alternatives[0]?.rideSteps[0];
      expect(step?.lineOptions.map((option) => option.passengerLineName).sort()).toEqual([
        "9",
        "9A",
      ]);
      expect(result.alternatives).toHaveLength(1);
      expect(step?.lineOptions.every((option) => option.directionLabel.length > 0)).toBe(true);
    }),
  );

  itEffect(
    "keeps lookalike lines separate when boarding platforms differ",
    Effect.gen(function* () {
      const graph = yield* compileGraph();
      const originPlace = placeIdForStop(graph, "stop:lookalike-a1");
      const destinationPlace = placeIdForStop(graph, "stop:lookalike-c");
      const result = yield* searchGuidePaths(graph, {
        origins: [{ transitPlaceId: originPlace as never }],
        destinations: [{ transitPlaceId: destinationPlace as never }],
        maximumTransfers: 0,
        maximumOriginCandidates: 8,
        maximumDestinationCandidates: 8,
        maximumAlternatives: 6,
        maximumExpandedStates: 50_000,
      });
      expect(result._tag).toBe("GuidesFound");
      if (result._tag !== "GuidesFound") return;
      const lineSets = result.alternatives.map((alternative) =>
        alternative.rideSteps[0]?.lineOptions.map((option) => option.passengerLineName).sort(),
      );
      expect(lineSets.some((lines) => lines?.length === 1 && lines[0] === "L1")).toBe(true);
      expect(lineSets.some((lines) => lines?.length === 1 && lines[0] === "L2")).toBe(true);
      expect(lineSets.some((lines) => lines?.join(",") === "L1,L2")).toBe(false);
    }),
  );

  itEffect(
    "finds an explicit named transfer path",
    Effect.gen(function* () {
      const graph = yield* compileGraph();
      const result = yield* searchGuidePaths(
        graph,
        queryFor(graph, "stop:A", "stop:F", { maximumTransfers: 1 }),
      );
      expect(result._tag).toBe("GuidesFound");
      if (result._tag !== "GuidesFound") return;
      const named = result.alternatives.find((alternative) =>
        alternative.transfers.some(
          (transfer) =>
            transfer.leavePlace.placeName === "Transfer Gate North" &&
            transfer.boardNextPlace.placeName === "Transfer Gate South",
        ),
      );
      expect(named).toBeDefined();
    }),
  );

  itEffect(
    "is deterministic under origin candidate order permutation",
    Effect.gen(function* () {
      const graph = yield* compileGraph();
      const base = queryFor(graph, "stop:A", "stop:D");
      const permuted: RouteGuideQuery = {
        ...base,
        origins: [...base.origins].reverse(),
        destinations: [...base.destinations].reverse(),
      };
      const first = yield* searchGuidePaths(graph, base);
      const second = yield* searchGuidePaths(graph, permuted);
      expect(first._tag).toBe("GuidesFound");
      expect(second._tag).toBe("GuidesFound");
      if (first._tag !== "GuidesFound" || second._tag !== "GuidesFound") return;
      expect(first.alternatives.map((alternative) => alternative.id)).toEqual(
        second.alternatives.map((alternative) => alternative.id),
      );
    }),
  );

  itEffect(
    "ranks with the documented lexicographic policy",
    Effect.gen(function* () {
      const graph = yield* compileGraph();
      const result = yield* searchGuidePaths(
        graph,
        queryFor(graph, "stop:A", "stop:F", { maximumTransfers: 2 }),
      );
      expect(result._tag).toBe("GuidesFound");
      if (result._tag !== "GuidesFound") return;
      const sorted = [...result.alternatives].sort(compareAlternatives);
      expect(sorted.map((alternative) => alternative.id)).toEqual(
        result.alternatives.map((alternative) => alternative.id),
      );
      for (let index = 1; index < result.alternatives.length; index += 1) {
        expect(
          compareAlternatives(result.alternatives[index - 1]!, result.alternatives[index]!),
        ).toBeLessThanOrEqual(0);
      }
    }),
  );

  itEffect(
    "respects expanded-state bounds without throwing",
    Effect.gen(function* () {
      const graph = yield* compileGraph();
      const result = yield* searchGuidePaths(
        graph,
        queryFor(graph, "stop:A", "stop:F", {
          maximumTransfers: 2,
          maximumExpandedStates: 3,
        }),
      );
      expect(["GuidesFound", "NoTopologicalRoute"]).toContain(result._tag);
    }),
  );

  itEffect(
    "rejects identical origin and destination place sets",
    Effect.gen(function* () {
      const graph = yield* compileGraph();
      const result = yield* searchGuidePaths(graph, queryFor(graph, "stop:A", "stop:A"));
      expect(result._tag).toBe("InvalidCandidateSet");
      if (result._tag !== "InvalidCandidateSet") return;
      expect(result.reason).toMatch(/same transit place/i);
    }),
  );
});
