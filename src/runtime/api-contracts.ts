import { Schema } from "effect";

import {
  GeometryId,
  RouteId,
  RoutePatternId,
  ServiceDate,
  ServiceDaySeconds,
  StopId,
  TripId,
} from "../domain/transit/index.js";

export const Coordinate = Schema.Struct({
  longitude: Schema.Number.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
  latitude: Schema.Number.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
});
export interface Coordinate extends Schema.Schema.Type<typeof Coordinate> {}

export const JourneyEndpoint = Schema.TaggedUnion({
  Stop: { stopId: StopId },
  Coordinate: { coordinate: Coordinate },
});
export type JourneyEndpoint = typeof JourneyEndpoint.Type;

export const LineRule = Schema.TaggedUnion({
  Exclude: { routeId: RouteId },
  Prefer: { routeId: RouteId },
  Require: { routeId: RouteId },
});
export type LineRule = typeof LineRule.Type;

export const LockedLeg = Schema.Struct({
  fromStopId: StopId,
  toStopId: StopId,
  routeId: RouteId,
  patternId: RoutePatternId,
  tripId: TripId,
  departureSeconds: ServiceDaySeconds,
  arrivalSeconds: ServiceDaySeconds,
  geometryId: Schema.optionalKey(GeometryId),
});
export interface LockedLeg extends Schema.Schema.Type<typeof LockedLeg> {}

export const JourneyRequest = Schema.Struct({
  origin: JourneyEndpoint,
  destination: JourneyEndpoint,
  serviceDate: ServiceDate,
  departureSeconds: ServiceDaySeconds,
  maximumResults: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
  lineRules: Schema.Array(LineRule).check(Schema.isMaxLength(12)),
  lockedLeg: Schema.optionalKey(LockedLeg),
});
export interface JourneyRequest extends Schema.Schema.Type<typeof JourneyRequest> {}

export const StopSuggestion = Schema.Struct({
  id: StopId,
  name: Schema.String.check(Schema.isNonEmpty()),
  area: Schema.String,
  coordinate: Coordinate,
});
export interface StopSuggestion extends Schema.Schema.Type<typeof StopSuggestion> {}

export const StopSearchRequest = Schema.Struct({
  query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(80))),
  coordinate: Schema.optionalKey(Coordinate),
  reachableFromStopId: Schema.optionalKey(StopId),
  serviceDate: Schema.optionalKey(ServiceDate),
  departureSeconds: Schema.optionalKey(ServiceDaySeconds),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
});
export interface StopSearchRequest extends Schema.Schema.Type<typeof StopSearchRequest> {}

export const TransitJourneyLeg = Schema.TaggedStruct("Transit", {
  routeId: RouteId,
  line: Schema.String.check(Schema.isNonEmpty()),
  from: Schema.String.check(Schema.isNonEmpty()),
  to: Schema.String.check(Schema.isNonEmpty()),
  minutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  stops: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  tone: Schema.Literals(["red", "blue", "yellow", "green"]),
  color: Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/i)),
  lock: LockedLeg,
});
export interface TransitJourneyLeg extends Schema.Schema.Type<typeof TransitJourneyLeg> {}

export const WalkJourneyLeg = Schema.TaggedStruct("Walk", {
  from: Schema.String.check(Schema.isNonEmpty()),
  to: Schema.String.check(Schema.isNonEmpty()),
  minutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  meters: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export interface WalkJourneyLeg extends Schema.Schema.Type<typeof WalkJourneyLeg> {}

export const JourneyLeg = Schema.Union([TransitJourneyLeg, WalkJourneyLeg]);
export type JourneyLeg = typeof JourneyLeg.Type;

export const Journey = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  label: Schema.String.check(Schema.isNonEmpty()),
  minutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  walkingMinutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  transfers: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  legs: Schema.Array(JourneyLeg).check(Schema.isNonEmpty()),
  geometry: Schema.Array(Schema.Tuple([Schema.Number, Schema.Number])),
});
export interface Journey extends Schema.Schema.Type<typeof Journey> {}

export const JourneyResponse = Schema.Struct({ journeys: Schema.Array(Journey) });
export interface JourneyResponse extends Schema.Schema.Type<typeof JourneyResponse> {}

export const StopSearchResponse = Schema.Struct({ stops: Schema.Array(StopSuggestion) });
export interface StopSearchResponse extends Schema.Schema.Type<typeof StopSearchResponse> {}

export const ApiError = Schema.Struct({
  error: Schema.Struct({
    code: Schema.Literals(["INVALID_REQUEST", "NO_ROUTE", "SERVICE_UNAVAILABLE"]),
    message: Schema.String,
  }),
});
export interface ApiError extends Schema.Schema.Type<typeof ApiError> {}
