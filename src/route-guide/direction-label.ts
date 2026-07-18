import { Effect, Schema } from "effect";

import { RoutePatternId } from "../domain/transit/ids.js";
import type { PatternDirectionEvidence } from "../discovery/transit/direction-evidence.js";
import { ReviewedDirectionLabelId } from "./ids.js";
import { type DirectionEvidenceClassification, type DirectionLabelAuthority } from "./model.js";

export const ReviewedDirectionLabel = Schema.Struct({
  id: ReviewedDirectionLabelId,
  patternId: RoutePatternId,
  routeId: Schema.String.check(Schema.isNonEmpty()),
  label: Schema.String.check(Schema.isNonEmpty()),
  rationale: Schema.String.check(Schema.isNonEmpty()),
  sourceArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
});
export interface ReviewedDirectionLabel extends Schema.Schema.Type<typeof ReviewedDirectionLabel> {}

export const ReviewedDirectionLabelSet = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  sourceArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  labels: Schema.Array(ReviewedDirectionLabel),
});
export interface ReviewedDirectionLabelSet extends Schema.Schema.Type<
  typeof ReviewedDirectionLabelSet
> {}

export interface SelectedDirectionLabel {
  readonly label: string;
  readonly authority: DirectionLabelAuthority;
  readonly classification: DirectionEvidenceClassification;
  readonly ambiguous: boolean;
}

const stableTripHeadsign = (evidence: PatternDirectionEvidence): string | undefined => {
  if (evidence.classification !== "StableTripHeadsign") return undefined;
  const candidate = evidence.candidates.find((entry) => entry._tag === "TripHeadsign");
  return candidate?._tag === "TripHeadsign" ? candidate.headsign : undefined;
};

const stopHeadsign = (evidence: PatternDirectionEvidence): string | undefined => {
  const candidate = evidence.candidates.find((entry) => entry._tag === "StopHeadsign");
  return candidate?._tag === "StopHeadsign" ? candidate.headsign : undefined;
};

const finalStopName = (evidence: PatternDirectionEvidence): string | undefined => {
  const candidate = evidence.candidates.find((entry) => entry._tag === "FinalStopName");
  return candidate?._tag === "FinalStopName" ? candidate.stopName : undefined;
};

/**
 * Deterministic passenger direction label policy (Plan 015 Step 4).
 * Never silently picks the most common conflicting headsign.
 */
export const selectDirectionLabel = Effect.fn("RouteGuide.selectDirectionLabel")(function* (
  evidence: PatternDirectionEvidence,
  reviewedByPatternId: ReadonlyMap<string, ReviewedDirectionLabel> = new Map(),
) {
  const classification = evidence.classification;
  const reviewed = reviewedByPatternId.get(evidence.patternId);

  if (classification === "StableTripHeadsign") {
    const label = stableTripHeadsign(evidence);
    if (label !== undefined) {
      return yield* Effect.succeed({
        label,
        authority: "Authoritative" as const,
        classification,
        ambiguous: false,
      } satisfies SelectedDirectionLabel);
    }
  }

  if (classification === "ConflictingTripHeadsigns") {
    if (reviewed !== undefined) {
      return yield* Effect.succeed({
        label: reviewed.label,
        authority: "Reviewed" as const,
        classification,
        ambiguous: false,
      } satisfies SelectedDirectionLabel);
    }
    const fallback = finalStopName(evidence);
    if (fallback !== undefined) {
      return yield* Effect.succeed({
        label: fallback,
        authority: "Fallback" as const,
        classification,
        ambiguous: true,
      } satisfies SelectedDirectionLabel);
    }
    return yield* Effect.succeed({
      label: "Direction unclear",
      authority: "Ambiguous" as const,
      classification,
      ambiguous: true,
    } satisfies SelectedDirectionLabel);
  }

  if (classification === "StopHeadsignOnly") {
    const label = stopHeadsign(evidence);
    if (label !== undefined) {
      return yield* Effect.succeed({
        label,
        authority: "Authoritative" as const,
        classification,
        ambiguous: false,
      } satisfies SelectedDirectionLabel);
    }
  }

  if (classification === "FinalStopFallback" || classification === "StopHeadsignOnly") {
    const fallback = finalStopName(evidence) ?? stopHeadsign(evidence);
    if (fallback !== undefined) {
      return yield* Effect.succeed({
        label: fallback,
        authority: "Fallback" as const,
        classification:
          classification === "StopHeadsignOnly" ? "FinalStopFallback" : classification,
        ambiguous: classification === "StopHeadsignOnly",
      } satisfies SelectedDirectionLabel);
    }
  }

  if (reviewed !== undefined) {
    return yield* Effect.succeed({
      label: reviewed.label,
      authority: "Reviewed" as const,
      classification,
      ambiguous: false,
    } satisfies SelectedDirectionLabel);
  }

  const fallback = finalStopName(evidence);
  if (fallback !== undefined) {
    return yield* Effect.succeed({
      label: fallback,
      authority: "Fallback" as const,
      classification: classification === "Absent" ? "FinalStopFallback" : classification,
      ambiguous: true,
    } satisfies SelectedDirectionLabel);
  }

  return yield* Effect.succeed({
    label: "Direction unclear",
    authority: "Ambiguous" as const,
    classification,
    ambiguous: true,
  } satisfies SelectedDirectionLabel);
});

export const indexReviewedDirectionLabels = (
  set: ReviewedDirectionLabelSet,
): ReadonlyMap<string, ReviewedDirectionLabel> =>
  new Map(set.labels.map((label) => [label.patternId, label]));
