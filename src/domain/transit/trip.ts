import { Schema } from "effect";

import { RoutePatternId, ServiceId, StopId, TripId } from "./ids.js";
import { SourceRef } from "./source-ref.js";

export const ServiceDaySeconds = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 604_800 }),
).pipe(Schema.brand("ServiceDaySeconds"));
export type ServiceDaySeconds = typeof ServiceDaySeconds.Type;

/** Pickup / drop-off policy retained from GTFS pickup_type / drop_off_type. */
export const BoardingPolicy = Schema.Literals([
  "Normal",
  "Forbidden",
  "PhoneAgency",
  "CoordinateWithDriver",
]);
export type BoardingPolicy = typeof BoardingPolicy.Type;

export const StopTime = Schema.Struct({
  stopId: StopId,
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  arrivalSeconds: ServiceDaySeconds,
  departureSeconds: ServiceDaySeconds,
  pickupPolicy: BoardingPolicy,
  dropOffPolicy: BoardingPolicy,
  stopHeadsign: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
});

export interface StopTime extends Schema.Schema.Type<typeof StopTime> {}

export const FrequencyWindow = Schema.Struct({
  startSeconds: ServiceDaySeconds,
  endSeconds: ServiceDaySeconds,
  headwaySeconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  exactTimes: Schema.Boolean,
});

export interface FrequencyWindow extends Schema.Schema.Type<typeof FrequencyWindow> {}

export const ServiceAvailability = Schema.TaggedUnion({
  Scheduled: {
    stopTimes: Schema.Array(StopTime).check(Schema.isNonEmpty()),
    frequencyWindows: Schema.Array(FrequencyWindow),
  },
  FrequencyOnly: {
    frequencyWindows: Schema.Array(FrequencyWindow).check(Schema.isNonEmpty()),
  },
  TopologyOnly: {
    reason: Schema.String.check(Schema.isNonEmpty()),
  },
});

export type ServiceAvailability = typeof ServiceAvailability.Type;

export const Trip = Schema.Struct({
  id: TripId,
  patternId: RoutePatternId,
  serviceId: ServiceId,
  sourceRefs: Schema.Array(SourceRef),
  headsign: Schema.optionalKey(Schema.String),
  availability: ServiceAvailability,
});

export interface Trip extends Schema.Schema.Type<typeof Trip> {}
