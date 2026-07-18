import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";

import { itEffect } from "../testing/effect.js";
import {
  indexReviewedDirectionLabels,
  ReviewedDirectionLabelSet,
  selectDirectionLabel,
} from "./direction-label.js";
import type { PatternDirectionEvidence } from "../discovery/transit/direction-evidence.js";
import { RoutePatternId } from "../domain/transit/ids.js";

const evidence = (
  partial: Partial<PatternDirectionEvidence> &
    Pick<PatternDirectionEvidence, "classification" | "candidates">,
): PatternDirectionEvidence => ({
  patternId: RoutePatternId.make("pattern:1"),
  routeId: "route:1",
  ...partial,
});

describe("route-guide direction labels", () => {
  itEffect(
    "uses a stable trip headsign as authoritative",
    Effect.gen(function* () {
      const selected = yield* selectDirectionLabel(
        evidence({
          classification: "StableTripHeadsign",
          candidates: [{ _tag: "TripHeadsign", headsign: "Kota", tripCount: 3 }],
        }),
      );
      expect(selected).toMatchObject({
        label: "Kota",
        authority: "Authoritative",
        ambiguous: false,
      });
    }),
  );

  itEffect(
    "does not silently pick the most common conflicting headsign",
    Effect.gen(function* () {
      const selected = yield* selectDirectionLabel(
        evidence({
          classification: "ConflictingTripHeadsigns",
          candidates: [
            { _tag: "TripHeadsign", headsign: "Branch A", tripCount: 10 },
            { _tag: "TripHeadsign", headsign: "Branch B", tripCount: 2 },
            { _tag: "FinalStopName", stopName: "Terminal" },
          ],
        }),
      );
      expect(selected.label).toBe("Terminal");
      expect(selected.authority).toBe("Fallback");
      expect(selected.ambiguous).toBe(true);
      expect(selected.label).not.toBe("Branch A");
    }),
  );

  itEffect(
    "uses a reviewed label when headsigns conflict",
    Effect.gen(function* () {
      const reviewed = yield* Schema.decodeUnknownEffect(ReviewedDirectionLabelSet)({
        schemaVersion: "1",
        sourceArtifactVersion: "fixture-v1",
        labels: [
          {
            id: "reviewed:pattern:1",
            patternId: "pattern:1",
            routeId: "route:1",
            label: "Reviewed Terminal",
            rationale: "Branch conflict documented",
            sourceArtifactVersion: "fixture-v1",
          },
        ],
      });
      const selected = yield* selectDirectionLabel(
        evidence({
          classification: "ConflictingTripHeadsigns",
          candidates: [
            { _tag: "TripHeadsign", headsign: "A", tripCount: 1 },
            { _tag: "TripHeadsign", headsign: "B", tripCount: 1 },
          ],
        }),
        indexReviewedDirectionLabels(reviewed),
      );
      expect(selected).toMatchObject({
        label: "Reviewed Terminal",
        authority: "Reviewed",
        ambiguous: false,
      });
    }),
  );

  itEffect(
    "falls back to final stop name when headsigns are missing",
    Effect.gen(function* () {
      const selected = yield* selectDirectionLabel(
        evidence({
          classification: "FinalStopFallback",
          candidates: [{ _tag: "FinalStopName", stopName: "End Place" }],
        }),
      );
      expect(selected).toMatchObject({
        label: "End Place",
        authority: "Fallback",
      });
    }),
  );

  itEffect(
    "marks absent evidence as ambiguous",
    Effect.gen(function* () {
      const selected = yield* selectDirectionLabel(
        evidence({
          classification: "Absent",
          candidates: [{ _tag: "Absent", reason: "none" }],
        }),
      );
      expect(selected.authority).toBe("Ambiguous");
      expect(selected.ambiguous).toBe(true);
    }),
  );

  itEffect(
    "uses stop headsign when that is the only source evidence",
    Effect.gen(function* () {
      const selected = yield* selectDirectionLabel(
        evidence({
          classification: "StopHeadsignOnly",
          candidates: [{ _tag: "StopHeadsign", headsign: "Via Stop Sign", observationCount: 2 }],
        }),
      );
      expect(selected).toMatchObject({
        label: "Via Stop Sign",
        authority: "Authoritative",
      });
    }),
  );
});
