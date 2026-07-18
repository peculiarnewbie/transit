import { Schema } from "effect";

import { RouteId, StopId } from "../../domain/transit/ids.js";
import { SourceRef } from "../../domain/transit/source-ref.js";
import { StopLocation } from "../../domain/transit/stop.js";
import { TransitPlaceId } from "./ids.js";

export const GroupingEvidence = Schema.TaggedUnion({
  SourceParent: {
    parentStopId: StopId,
  },
  ReviewedComplex: {
    overrideId: Schema.String.check(Schema.isNonEmpty()),
    rationale: Schema.String.check(Schema.isNonEmpty()),
    sourceArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  },
  Standalone: {},
});
export type GroupingEvidence = typeof GroupingEvidence.Type;

export const PlatformSummary = Schema.Struct({
  codes: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
  memberCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export interface PlatformSummary extends Schema.Schema.Type<typeof PlatformSummary> {}

export const TransitPlace = Schema.Struct({
  id: TransitPlaceId,
  primaryName: Schema.String.check(Schema.isNonEmpty()),
  aliases: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
  representativeLocation: StopLocation,
  memberStopIds: Schema.Array(StopId).check(Schema.isNonEmpty()),
  parentStationStopId: Schema.optionalKey(StopId),
  platformSummary: Schema.optionalKey(PlatformSummary),
  servedRouteIds: Schema.Array(RouteId),
  sourceRefs: Schema.Array(SourceRef),
  groupingEvidence: GroupingEvidence,
});
export interface TransitPlace extends Schema.Schema.Type<typeof TransitPlace> {}

export const UnresolvedGroupingFinding = Schema.TaggedUnion({
  ProposedComplex: {
    candidateStopIds: Schema.Array(StopId).check(Schema.isNonEmpty()),
    reasons: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(Schema.isNonEmpty()),
  },
  MissingRepresentativeCoordinate: {
    transitPlaceId: TransitPlaceId,
    memberStopIds: Schema.Array(StopId).check(Schema.isNonEmpty()),
  },
  ConflictingParents: {
    stopId: StopId,
    parentStopIds: Schema.Array(StopId).check(Schema.isNonEmpty()),
  },
});
export type UnresolvedGroupingFinding = typeof UnresolvedGroupingFinding.Type;

export const TransitPlaceIndex = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  sourceArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  placesById: Schema.Record(Schema.String, TransitPlace),
  placeIdByStopId: Schema.Record(Schema.String, Schema.String),
  unresolvedFindings: Schema.Array(UnresolvedGroupingFinding),
});
export interface TransitPlaceIndex extends Schema.Schema.Type<typeof TransitPlaceIndex> {}

export class MalformedMembership extends Schema.TaggedErrorClass<MalformedMembership>()(
  "TransitPlace.MalformedMembership",
  {
    stopId: StopId,
    reason: Schema.String,
  },
) {}

export class DuplicateMembership extends Schema.TaggedErrorClass<DuplicateMembership>()(
  "TransitPlace.DuplicateMembership",
  {
    stopId: StopId,
    placeIds: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
  },
) {}

export class MissingRepresentativeCoordinate extends Schema.TaggedErrorClass<MissingRepresentativeCoordinate>()(
  "TransitPlace.MissingRepresentativeCoordinate",
  {
    transitPlaceId: TransitPlaceId,
    memberStopIds: Schema.Array(StopId),
  },
) {}

export class ConflictingAuthoritativeParents extends Schema.TaggedErrorClass<ConflictingAuthoritativeParents>()(
  "TransitPlace.ConflictingAuthoritativeParents",
  {
    stopId: StopId,
    parentStopIds: Schema.Array(StopId),
  },
) {}

export type TransitPlaceError =
  | MalformedMembership
  | DuplicateMembership
  | MissingRepresentativeCoordinate
  | ConflictingAuthoritativeParents;
