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

const NonNegativeSeconds = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const StopCandidate = Schema.Struct({
  stopId: StopId,
  walkSeconds: NonNegativeSeconds,
});
export interface StopCandidate extends Schema.Schema.Type<typeof StopCandidate> {}

export const LockedTransitLeg = Schema.Struct({
  fromStopId: StopId,
  toStopId: StopId,
  routeId: RouteId,
  patternId: RoutePatternId,
  tripId: TripId,
  departureSeconds: ServiceDaySeconds,
  arrivalSeconds: ServiceDaySeconds,
  geometryId: Schema.optionalKey(GeometryId),
});
export interface LockedTransitLeg extends Schema.Schema.Type<typeof LockedTransitLeg> {}

export const LineConstraint = Schema.TaggedUnion({
  None: {},
  Excluded: { routeIds: Schema.Array(RouteId).check(Schema.isNonEmpty()) },
  Preferred: {
    routeIds: Schema.Array(RouteId).check(Schema.isNonEmpty()),
    weight: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  },
  Required: { routeIds: Schema.Array(RouteId).check(Schema.isNonEmpty()) },
  Locked: { legs: Schema.Array(LockedTransitLeg).check(Schema.isNonEmpty()) },
});
export type LineConstraint = typeof LineConstraint.Type;

export const RoutingQuery = Schema.Struct({
  origins: Schema.Array(StopCandidate).check(Schema.isNonEmpty()),
  destinations: Schema.Array(StopCandidate).check(Schema.isNonEmpty()),
  serviceDate: ServiceDate,
  departureSeconds: ServiceDaySeconds,
  maximumTransfers: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 12 })),
  maximumAccessWalkSeconds: NonNegativeSeconds,
  maximumTransferWalkSeconds: NonNegativeSeconds,
  maximumResults: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
  lineConstraint: LineConstraint,
});
export interface RoutingQuery extends Schema.Schema.Type<typeof RoutingQuery> {}

export const RoutingPoint = Schema.TaggedUnion({
  Origin: {},
  Stop: { stopId: StopId },
  Destination: {},
});
export type RoutingPoint = typeof RoutingPoint.Type;

export const WalkLeg = Schema.TaggedStruct("Walk", {
  from: RoutingPoint,
  to: RoutingPoint,
  departureSeconds: ServiceDaySeconds,
  arrivalSeconds: ServiceDaySeconds,
  durationSeconds: NonNegativeSeconds,
});
export interface WalkLeg extends Schema.Schema.Type<typeof WalkLeg> {}

export const TransitLeg = Schema.TaggedStruct("Transit", {
  fromStopId: StopId,
  toStopId: StopId,
  routeId: RouteId,
  patternId: RoutePatternId,
  tripId: TripId,
  departureSeconds: ServiceDaySeconds,
  arrivalSeconds: ServiceDaySeconds,
  geometryId: Schema.optionalKey(GeometryId),
});
export interface TransitLeg extends Schema.Schema.Type<typeof TransitLeg> {}

export const RoutingLeg = Schema.Union([WalkLeg, TransitLeg]);
export type RoutingLeg = typeof RoutingLeg.Type;

export const ScoreBreakdown = Schema.Struct({
  arrivalSeconds: ServiceDaySeconds,
  transferCount: NonNegativeSeconds,
  walkingSeconds: NonNegativeSeconds,
  preferencePenalty: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  total: Schema.Number,
});
export interface ScoreBreakdown extends Schema.Schema.Type<typeof ScoreBreakdown> {}

export const Itinerary = Schema.Struct({
  legs: Schema.Array(RoutingLeg).check(Schema.isNonEmpty()),
  boardedRouteIds: Schema.Array(RouteId).check(Schema.isNonEmpty()),
  departureSeconds: ServiceDaySeconds,
  arrivalSeconds: ServiceDaySeconds,
  transferCount: NonNegativeSeconds,
  walkingSeconds: NonNegativeSeconds,
  score: ScoreBreakdown,
});
export interface Itinerary extends Schema.Schema.Type<typeof Itinerary> {}

export const RoutingResult = Schema.Struct({
  itineraries: Schema.Array(Itinerary).check(Schema.isNonEmpty()),
});
export interface RoutingResult extends Schema.Schema.Type<typeof RoutingResult> {}

export class NoRoute extends Schema.TaggedErrorClass<NoRoute>()("Routing.NoRoute", {
  reason: Schema.String,
}) {}

export class InvalidConstraint extends Schema.TaggedErrorClass<InvalidConstraint>()(
  "Routing.InvalidConstraint",
  { reason: Schema.String },
) {}

export class MalformedNetwork extends Schema.TaggedErrorClass<MalformedNetwork>()(
  "Routing.MalformedNetwork",
  { reason: Schema.String },
) {}

export type RoutingError = NoRoute | InvalidConstraint | MalformedNetwork;
