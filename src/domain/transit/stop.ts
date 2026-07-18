import { Schema } from "effect";

import { StopId } from "./ids.js";
import { SourceRef } from "./source-ref.js";

export const StopLocation = Schema.TaggedUnion({
  Placed: {
    latitude: Schema.Number.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
    longitude: Schema.Number.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
  },
  Unplaced: {
    reason: Schema.String.check(Schema.isNonEmpty()),
  },
});

export type StopLocation = typeof StopLocation.Type;

export const Stop = Schema.Struct({
  id: StopId,
  sourceRefs: Schema.Array(SourceRef),
  name: Schema.String.check(Schema.isNonEmpty()),
  location: StopLocation,
  parentStopId: Schema.optionalKey(StopId),
});

export interface Stop extends Schema.Schema.Type<typeof Stop> {}
