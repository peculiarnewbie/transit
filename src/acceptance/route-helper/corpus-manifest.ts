import { Schema } from "effect";

export const CorpusManifest = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  reviewedAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  reviewer: Schema.String.check(Schema.isNonEmpty()),
  sourceArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  counts: Schema.Struct({
    placeSearchCases: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    routeGuideCases: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    usabilityTasks: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  fixtures: Schema.Struct({
    placeSearchCases: Schema.String.check(Schema.isNonEmpty()),
    routeGuideCases: Schema.String.check(Schema.isNonEmpty()),
    usabilityTasks: Schema.String.check(Schema.isNonEmpty()),
  }),
  releaseThreshold: Schema.Struct({
    unfamiliarParticipants: Schema.Literal(5),
    tasksPerParticipantMinimum: Schema.Literal(3),
    requiredSuccessesPerCoreTask: Schema.Literal(4),
  }),
});
export interface CorpusManifest extends Schema.Schema.Type<typeof CorpusManifest> {}
