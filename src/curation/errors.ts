import { Schema } from "effect";

import { RevisionId, RevisionVersion, ValidationFinding } from "./model.js";

export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
  "Curation.PersistenceError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "Curation.NotFoundError",
  {
    entity: Schema.String,
    id: Schema.String,
  },
) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()(
  "Curation.ConflictError",
  {
    revisionId: RevisionId,
    expectedVersion: RevisionVersion,
  },
) {}

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()(
  "Curation.ValidationError",
  {
    message: Schema.String,
    findings: Schema.Array(ValidationFinding),
  },
) {}
