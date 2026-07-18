import { Schema } from "effect";

import { GeometryId, RouteId, RoutePatternId, StopId } from "./ids.js";
import { SourceRef } from "./source-ref.js";

export const RoutePattern = Schema.Struct({
  id: RoutePatternId,
  routeId: RouteId,
  sourceRefs: Schema.Array(SourceRef),
  directionId: Schema.optionalKey(Schema.Int),
  stopIds: Schema.Array(StopId).check(Schema.isNonEmpty()),
  geometryId: Schema.optionalKey(GeometryId),
});

export interface RoutePattern extends Schema.Schema.Type<typeof RoutePattern> {}
