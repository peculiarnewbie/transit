import { Schema } from "effect";

import { AgencyId } from "./ids.js";
import { SourceRef } from "./source-ref.js";

export const Agency = Schema.Struct({
  id: AgencyId,
  sourceRefs: Schema.Array(SourceRef),
  name: Schema.String.check(Schema.isNonEmpty()),
  timezone: Schema.String.check(Schema.isNonEmpty()),
  url: Schema.optionalKey(Schema.String),
});

export interface Agency extends Schema.Schema.Type<typeof Agency> {}
