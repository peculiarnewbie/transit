import { Effect } from "effect";
import { describe, expect } from "vitest";

import { itEffect } from "../testing/effect.js";
import { topologyNetwork } from "./fixtures.js";
import { compileGuideGraph, placeIdForStop } from "./graph.js";
import { projectInstructions } from "./instructions.js";
import { searchGuidePaths } from "./search.js";

describe("route-guide instructions", () => {
  itEffect(
    "projects a direct ride instruction",
    Effect.gen(function* () {
      const graph = yield* compileGuideGraph({
        snapshot: topologyNetwork,
        sourceArtifactVersion: "fixture-topology-v1",
      });
      const origin = placeIdForStop(graph, "stop:A");
      const destination = placeIdForStop(graph, "stop:D");
      const result = yield* searchGuidePaths(graph, {
        origins: [{ transitPlaceId: origin as never }],
        destinations: [{ transitPlaceId: destination as never }],
        maximumTransfers: 0,
        maximumOriginCandidates: 4,
        maximumDestinationCandidates: 4,
        maximumAlternatives: 3,
        maximumExpandedStates: 20_000,
      });
      expect(result._tag).toBe("GuidesFound");
      if (result._tag !== "GuidesFound") return;
      const instructions = projectInstructions(result.alternatives[0]!);
      expect(instructions.rideSteps).toHaveLength(1);
      expect(instructions.transfers).toHaveLength(0);
      expect(instructions.rideSteps[0]?.summary).toContain("Board at");
      expect(instructions.rideSteps[0]?.summary).toContain("alight at");
      expect(instructions.sharedLinePhrase[0]).toMatch(/1/);
      expect(instructions.transfers).toHaveLength(0);
    }),
  );

  itEffect(
    "projects interchangeable 9/9A copy as take 9 or 9A",
    Effect.gen(function* () {
      const graph = yield* compileGuideGraph({
        snapshot: topologyNetwork,
        sourceArtifactVersion: "fixture-topology-v1",
      });
      const origin = placeIdForStop(graph, "stop:cawang");
      const destination = placeIdForStop(graph, "stop:grogol");
      const result = yield* searchGuidePaths(graph, {
        origins: [{ transitPlaceId: origin as never }],
        destinations: [{ transitPlaceId: destination as never }],
        maximumTransfers: 0,
        maximumOriginCandidates: 4,
        maximumDestinationCandidates: 4,
        maximumAlternatives: 3,
        maximumExpandedStates: 20_000,
      });
      expect(result._tag).toBe("GuidesFound");
      if (result._tag !== "GuidesFound") return;
      const instructions = projectInstructions(result.alternatives[0]!);
      expect(instructions.sharedLinePhrase[0]).toBe("9 or 9A");
      expect(instructions.rideSteps[0]?.intermediatePlaceNamesByOption).toHaveLength(2);
    }),
  );

  itEffect(
    "preserves differently named transfer endpoints",
    Effect.gen(function* () {
      const graph = yield* compileGuideGraph({
        snapshot: topologyNetwork,
        sourceArtifactVersion: "fixture-topology-v1",
      });
      const origin = placeIdForStop(graph, "stop:A");
      const destination = placeIdForStop(graph, "stop:F");
      const result = yield* searchGuidePaths(graph, {
        origins: [{ transitPlaceId: origin as never }],
        destinations: [{ transitPlaceId: destination as never }],
        maximumTransfers: 1,
        maximumOriginCandidates: 4,
        maximumDestinationCandidates: 4,
        maximumAlternatives: 6,
        maximumExpandedStates: 50_000,
      });
      expect(result._tag).toBe("GuidesFound");
      if (result._tag !== "GuidesFound") return;
      const named = result.alternatives.find((alternative) =>
        alternative.transfers.some(
          (transfer) => transfer.leavePlace.placeName !== transfer.boardNextPlace.placeName,
        ),
      );
      expect(named).toBeDefined();
      const instructions = projectInstructions(named!);
      expect(
        instructions.transfers.some((transfer) => transfer.preservesDistinctEndpointNames),
      ).toBe(true);
    }),
  );

  itEffect(
    "mentions unknown platform detail explicitly when absent",
    Effect.gen(function* () {
      const graph = yield* compileGuideGraph({
        snapshot: topologyNetwork,
        sourceArtifactVersion: "fixture-topology-v1",
      });
      const origin = placeIdForStop(graph, "stop:A");
      const destination = placeIdForStop(graph, "stop:F");
      const result = yield* searchGuidePaths(graph, {
        origins: [{ transitPlaceId: origin as never }],
        destinations: [{ transitPlaceId: destination as never }],
        maximumTransfers: 1,
        maximumOriginCandidates: 4,
        maximumDestinationCandidates: 4,
        maximumAlternatives: 6,
        maximumExpandedStates: 50_000,
      });
      expect(result._tag).toBe("GuidesFound");
      if (result._tag !== "GuidesFound") return;
      const withUnknown = result.alternatives.find((alternative) =>
        alternative.transfers.some((transfer) => !transfer.platformDetailKnown),
      );
      if (withUnknown === undefined) return;
      const instructions = projectInstructions(withUnknown);
      expect(
        instructions.transfers.some((transfer) =>
          transfer.summary.includes("platform detail unknown"),
        ),
      ).toBe(true);
    }),
  );

  itEffect(
    "includes parent/platform detail when known",
    Effect.gen(function* () {
      const graph = yield* compileGuideGraph({
        snapshot: topologyNetwork,
        sourceArtifactVersion: "fixture-topology-v1",
      });
      const origin = placeIdForStop(graph, "stop:A");
      const destination = placeIdForStop(graph, "stop:plat-2");
      const result = yield* searchGuidePaths(graph, {
        origins: [{ transitPlaceId: origin as never }],
        destinations: [{ transitPlaceId: destination as never }],
        maximumTransfers: 0,
        maximumOriginCandidates: 4,
        maximumDestinationCandidates: 4,
        maximumAlternatives: 3,
        maximumExpandedStates: 20_000,
      });
      expect(result._tag).toBe("GuidesFound");
      if (result._tag !== "GuidesFound") return;
      const instructions = projectInstructions(result.alternatives[0]!);
      expect(
        instructions.rideSteps.some(
          (step) =>
            step.alightingMemberDetail?.includes("platform") || step.summary.includes("platform"),
        ),
      ).toBe(true);
    }),
  );
});
