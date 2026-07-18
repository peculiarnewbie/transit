import { Schema } from "effect";

import { StopId } from "../../domain/transit/ids.js";
import { ReviewedComplexOverrideId } from "./ids.js";

export const ReviewedComplexOverride = Schema.Struct({
  id: ReviewedComplexOverrideId,
  sourceArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  memberStopIds: Schema.Array(StopId).check(Schema.isNonEmpty()),
  primaryName: Schema.String.check(Schema.isNonEmpty()),
  aliases: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
  rationale: Schema.String.check(Schema.isNonEmpty()),
  reviewer: Schema.String.check(Schema.isNonEmpty()),
  reviewedAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
});
export interface ReviewedComplexOverride extends Schema.Schema.Type<
  typeof ReviewedComplexOverride
> {}

export const ReviewedComplexOverrideSet = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  sourceArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  overrides: Schema.Array(ReviewedComplexOverride),
});
export interface ReviewedComplexOverrideSet extends Schema.Schema.Type<
  typeof ReviewedComplexOverrideSet
> {}
