import { Schema } from "effect";

import { StopId } from "./ids.js";
import { SourceRef } from "./source-ref.js";

export const Transfer = Schema.Struct({
  fromStopId: StopId,
  toStopId: StopId,
  sourceRefs: Schema.Array(SourceRef),
  kind: Schema.Literals(["Recommended", "Timed", "MinimumTime", "Forbidden"]),
  minimumTransferSeconds: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

export interface Transfer extends Schema.Schema.Type<typeof Transfer> {}
