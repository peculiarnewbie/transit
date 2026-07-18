import { Schema } from "effect";

export class GtfsArchiveError extends Schema.TaggedErrorClass<GtfsArchiveError>()(
  "GtfsArchiveError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class GtfsTableError extends Schema.TaggedErrorClass<GtfsTableError>()("GtfsTableError", {
  table: Schema.String,
  rowNumber: Schema.Int,
  reason: Schema.String,
}) {}

export class GtfsValidationError extends Schema.TaggedErrorClass<GtfsValidationError>()(
  "GtfsValidationError",
  {
    code: Schema.String,
    message: Schema.String,
  },
) {}

export type GtfsCompileError = GtfsArchiveError | GtfsTableError | GtfsValidationError;
