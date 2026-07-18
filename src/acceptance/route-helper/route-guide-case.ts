import { Schema } from "effect";

import { RouteGuideCaseId } from "./ids.js";

export const RouteGuideOutcome = Schema.Literals(["Supported", "KnownGap"]);
export type RouteGuideOutcome = typeof RouteGuideOutcome.Type;

export const RouteGuideCategory = Schema.Literals([
  "Direct",
  "OneTransfer",
  "TwoTransfer",
  "ReversePair",
  "Branch",
  "Loop",
  "TerminalPlatform",
  "ParentChildStation",
  "Peripheral",
  "InterchangeableLines",
  "KnownGap",
]);
export type RouteGuideCategory = typeof RouteGuideCategory.Type;

export const LineOptionExpectation = Schema.Struct({
  line: Schema.String.check(Schema.isNonEmpty()),
  headsign: Schema.String.check(Schema.isNonEmpty()),
});
export interface LineOptionExpectation extends Schema.Schema.Type<typeof LineOptionExpectation> {}

export const RideStepExpectation = Schema.Struct({
  lineOptions: Schema.Array(LineOptionExpectation).check(Schema.isNonEmpty()),
  boardingPlaceLabel: Schema.String.check(Schema.isNonEmpty()),
  alightingPlaceLabel: Schema.String.check(Schema.isNonEmpty()),
  intermediateStopLabels: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
});
export interface RideStepExpectation extends Schema.Schema.Type<typeof RideStepExpectation> {}

export const AcceptableSequence = Schema.Struct({
  steps: Schema.Array(RideStepExpectation).check(Schema.isNonEmpty()),
});
export interface AcceptableSequence extends Schema.Schema.Type<typeof AcceptableSequence> {}

export const PassengerPlaceRef = Schema.Struct({
  label: Schema.String.check(Schema.isNonEmpty()),
  locality: Schema.String.check(Schema.isNonEmpty()),
});
export interface PassengerPlaceRef extends Schema.Schema.Type<typeof PassengerPlaceRef> {}

export const RouteGuideCase = Schema.Struct({
  id: RouteGuideCaseId,
  origin: PassengerPlaceRef,
  destination: PassengerPlaceRef,
  outcome: RouteGuideOutcome,
  categories: Schema.Array(RouteGuideCategory).check(Schema.isNonEmpty()),
  acceptableSequences: Schema.Array(AcceptableSequence),
  maximumTransferCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  requiredBoardingLabels: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
  requiredAlightingLabels: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
  reverseOfCaseId: Schema.optionalKey(RouteGuideCaseId),
  rationale: Schema.String.check(Schema.isNonEmpty()),
  sourceReviewNote: Schema.String.check(Schema.isNonEmpty()),
});
export interface RouteGuideCase extends Schema.Schema.Type<typeof RouteGuideCase> {}
