import { Schema } from "effect";

const fields = {
  operation: Schema.String,
  system: Schema.Literals(["krl", "mrt", "lrt"]),
  source: Schema.String,
};

export class TransportError extends Schema.TaggedErrorClass<TransportError>()(
  "TrainImport.TransportError",
  { ...fields, cause: Schema.Defect() },
) {}

export class RejectedStatusError extends Schema.TaggedErrorClass<RejectedStatusError>()(
  "TrainImport.RejectedStatusError",
  { ...fields, status: Schema.Int },
) {}

export class RateLimitError extends Schema.TaggedErrorClass<RateLimitError>()(
  "TrainImport.RateLimitError",
  { ...fields, retryAfterMs: Schema.optionalKey(Schema.Int) },
) {}

export class DecodeError extends Schema.TaggedErrorClass<DecodeError>()("TrainImport.DecodeError", {
  ...fields,
  cause: Schema.Defect(),
}) {}

export class ParseError extends Schema.TaggedErrorClass<ParseError>()("TrainImport.ParseError", {
  ...fields,
  detail: Schema.String,
}) {}

export class PartialSourceError extends Schema.TaggedErrorClass<PartialSourceError>()(
  "TrainImport.PartialSourceError",
  { ...fields, failedRecordIds: Schema.Array(Schema.String) },
) {}

export type AcquisitionError = TransportError | RejectedStatusError | RateLimitError;
export type TrainImportError = AcquisitionError | DecodeError | ParseError | PartialSourceError;
