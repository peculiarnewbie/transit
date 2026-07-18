import { Schema } from "effect";

import { AgencyId, RouteId } from "./ids.js";
import { TransitMode } from "./mode.js";
import { SourceRef } from "./source-ref.js";

export const Route = Schema.Struct({
  id: RouteId,
  agencyId: AgencyId,
  sourceRefs: Schema.Array(SourceRef),
  mode: TransitMode,
  shortName: Schema.optionalKey(Schema.String),
  longName: Schema.optionalKey(Schema.String),
  color: Schema.optionalKey(Schema.String),
  textColor: Schema.optionalKey(Schema.String),
});

export interface Route extends Schema.Schema.Type<typeof Route> {}
