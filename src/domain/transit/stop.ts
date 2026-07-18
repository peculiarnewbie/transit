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

/** Passenger-facing stop location kind derived from GTFS location_type. */
export const StopLocationKind = Schema.Literals([
  "Stop",
  "Station",
  "EntranceExit",
  "GenericNode",
  "BoardingArea",
]);
export type StopLocationKind = typeof StopLocationKind.Type;

/** Wheelchair boarding evidence; unknown must not become false. */
export const WheelchairBoarding = Schema.Literals(["Unknown", "Possible", "NotPossible"]);
export type WheelchairBoarding = typeof WheelchairBoarding.Type;

export const Stop = Schema.Struct({
  id: StopId,
  sourceRefs: Schema.Array(SourceRef),
  name: Schema.String.check(Schema.isNonEmpty()),
  location: StopLocation,
  locationKind: StopLocationKind,
  stopCode: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  platformCode: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  wheelchairBoarding: WheelchairBoarding,
  parentStopId: Schema.optionalKey(StopId),
});

export interface Stop extends Schema.Schema.Type<typeof Stop> {}
