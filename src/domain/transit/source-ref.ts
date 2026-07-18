import { Schema } from "effect";

import { SourceRecordId } from "./ids.js";

export const SourceRef = Schema.Struct({
  system: Schema.String.check(Schema.isNonEmpty()),
  recordId: SourceRecordId,
  retrievedAt: Schema.DateTimeUtcFromString,
  source: Schema.String.check(Schema.isNonEmpty()),
});

export interface SourceRef extends Schema.Schema.Type<typeof SourceRef> {}
