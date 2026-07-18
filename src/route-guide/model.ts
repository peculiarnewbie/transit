import { Schema } from "effect";

import { GeometryId, RouteId, RoutePatternId, StopId } from "../domain/transit/ids.js";
import { TransitPlaceId } from "../discovery/transit/ids.js";
import { GuideAlternativeId } from "./ids.js";

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

/** Origin/destination candidate supplied by place discovery (Plan 014). */
export const TransitPlaceCandidate = Schema.Struct({
  transitPlaceId: TransitPlaceId,
  geographicDistanceMeters: Schema.optionalKey(NonNegativeNumber),
});
export interface TransitPlaceCandidate extends Schema.Schema.Type<typeof TransitPlaceCandidate> {}

/**
 * Time-independent route-guide query.
 * Must not contain service date, departure/arrival time, walking duration, or fare.
 */
export const RouteGuideQuery = Schema.Struct({
  origins: Schema.Array(TransitPlaceCandidate).check(Schema.isNonEmpty()),
  destinations: Schema.Array(TransitPlaceCandidate).check(Schema.isNonEmpty()),
  maximumTransfers: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  maximumOriginCandidates: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 })),
  maximumDestinationCandidates: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 })),
  maximumAlternatives: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
  maximumExpandedStates: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 250_000 })),
});
export interface RouteGuideQuery extends Schema.Schema.Type<typeof RouteGuideQuery> {}

export const DirectionLabelAuthority = Schema.Literals([
  "Authoritative",
  "Reviewed",
  "Fallback",
  "Ambiguous",
]);
export type DirectionLabelAuthority = typeof DirectionLabelAuthority.Type;

export const DirectionEvidenceClassification = Schema.Literals([
  "StableTripHeadsign",
  "ConflictingTripHeadsigns",
  "StopHeadsignOnly",
  "FinalStopFallback",
  "Absent",
]);
export type DirectionEvidenceClassification = typeof DirectionEvidenceClassification.Type;

export const MemberStopRef = Schema.Struct({
  stopId: StopId,
  stopName: Schema.String.check(Schema.isNonEmpty()),
  platformCode: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
});
export interface MemberStopRef extends Schema.Schema.Type<typeof MemberStopRef> {}

export const PlaceRef = Schema.Struct({
  transitPlaceId: TransitPlaceId,
  placeName: Schema.String.check(Schema.isNonEmpty()),
  member: Schema.optionalKey(MemberStopRef),
});
export interface PlaceRef extends Schema.Schema.Type<typeof PlaceRef> {}

export const LineOption = Schema.Struct({
  routeId: RouteId,
  passengerLineName: Schema.String.check(Schema.isNonEmpty()),
  patternId: RoutePatternId,
  directionLabel: Schema.String.check(Schema.isNonEmpty()),
  directionLabelAuthority: DirectionLabelAuthority,
  directionEvidenceClassification: DirectionEvidenceClassification,
  intermediatePlaces: Schema.Array(
    Schema.Struct({
      transitPlaceId: TransitPlaceId,
      placeName: Schema.String.check(Schema.isNonEmpty()),
    }),
  ),
  geometryId: Schema.optionalKey(GeometryId),
});
export interface LineOption extends Schema.Schema.Type<typeof LineOption> {}

export const InterchangeableRideStep = Schema.Struct({
  lineOptions: Schema.Array(LineOption).check(Schema.isNonEmpty()),
  boarding: PlaceRef,
  alighting: PlaceRef,
});
export interface InterchangeableRideStep extends Schema.Schema.Type<
  typeof InterchangeableRideStep
> {}

export const TransferEvidence = Schema.TaggedUnion({
  SameStop: {
    stopId: StopId,
  },
  SourceStation: {
    parentStopId: StopId,
    fromStopId: StopId,
    toStopId: StopId,
  },
  PublishedTransfer: {
    fromStopId: StopId,
    toStopId: StopId,
    kind: Schema.Literals(["Recommended", "Timed", "MinimumTime"]),
  },
});
export type TransferEvidence = typeof TransferEvidence.Type;

export const TransferInstruction = Schema.Struct({
  leavePlace: PlaceRef,
  boardNextPlace: PlaceRef,
  nextPassengerLineNames: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(
    Schema.isNonEmpty(),
  ),
  nextDirectionLabel: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  platformDetailKnown: Schema.Boolean,
  evidence: TransferEvidence,
});
export interface TransferInstruction extends Schema.Schema.Type<typeof TransferInstruction> {}

export const GuideMetrics = Schema.Struct({
  transferCount: NonNegativeInt,
  boardingCount: NonNegativeInt,
  intermediateStopCount: NonNegativeInt,
  originCandidateDistanceMeters: Schema.optionalKey(NonNegativeNumber),
  destinationCandidateDistanceMeters: Schema.optionalKey(NonNegativeNumber),
  directionAmbiguityCount: NonNegativeInt,
  routeComplexity: NonNegativeInt,
  /** Negated hub strength: lower is better (more served routes at transfer points). */
  transferHubPenalty: NonNegativeInt,
  /** Letter-suffix variant lines (6V vs 6); lower is better. */
  variantLinePenalty: NonNegativeInt,
});
export interface GuideMetrics extends Schema.Schema.Type<typeof GuideMetrics> {}

export const GuideAlternative = Schema.Struct({
  id: GuideAlternativeId,
  origin: PlaceRef,
  destination: PlaceRef,
  rideSteps: Schema.Array(InterchangeableRideStep).check(Schema.isNonEmpty()),
  transfers: Schema.Array(TransferInstruction),
  metrics: GuideMetrics,
});
export interface GuideAlternative extends Schema.Schema.Type<typeof GuideAlternative> {}

export const RouteGuideResult = Schema.TaggedUnion({
  GuidesFound: {
    alternatives: Schema.Array(GuideAlternative).check(Schema.isNonEmpty()),
    expandedStates: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  },
  NoTopologicalRoute: {
    originPlaceIds: Schema.Array(TransitPlaceId).check(Schema.isNonEmpty()),
    destinationPlaceIds: Schema.Array(TransitPlaceId).check(Schema.isNonEmpty()),
    reason: Schema.String.check(Schema.isNonEmpty()),
    expandedStates: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  },
  InvalidCandidateSet: {
    reason: Schema.String.check(Schema.isNonEmpty()),
    expandedStates: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  },
  DataValidationFailure: {
    reason: Schema.String.check(Schema.isNonEmpty()),
    expandedStates: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  },
});
export type RouteGuideResult = typeof RouteGuideResult.Type;

export class MalformedGuideGraph extends Schema.TaggedErrorClass<MalformedGuideGraph>()(
  "RouteGuide.MalformedGuideGraph",
  {
    reason: Schema.String,
  },
) {}

export class GuideSearchExceeded extends Schema.TaggedErrorClass<GuideSearchExceeded>()(
  "RouteGuide.GuideSearchExceeded",
  {
    reason: Schema.String,
    expandedStates: Schema.Int,
  },
) {}

export type RouteGuideError = MalformedGuideGraph | GuideSearchExceeded;

/** Fields that must never appear on the route-guide contract. */
export const FORBIDDEN_TIMETABLE_FIELD_NAMES = [
  "serviceDate",
  "departureSeconds",
  "arrivalSeconds",
  "departureTime",
  "arrivalTime",
  "walkSeconds",
  "walkingSeconds",
  "walkMinutes",
  "waitSeconds",
  "waitMinutes",
  "tripMinutes",
  "durationSeconds",
  "durationMinutes",
  "fare",
  "fareCents",
] as const;
