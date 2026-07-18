import { Schema } from "effect";

import { TransitPlaceId } from "../../discovery/transit/ids.js";
import { StopLocation } from "../transit/stop.js";
import { PassengerPlaceId, PlaceSourceRecordId } from "./ids.js";

export const GeographicBounds = Schema.Struct({
  west: Schema.Number.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
  south: Schema.Number.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
  east: Schema.Number.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
  north: Schema.Number.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
}).check(
  Schema.makeFilter(
    (bounds: {
      readonly west: number;
      readonly south: number;
      readonly east: number;
      readonly north: number;
    }) => bounds.west < bounds.east && bounds.south < bounds.north,
    {
      description: "GeographicBounds must have west < east and south < north",
    },
  ),
);
export interface GeographicBounds extends Schema.Schema.Type<typeof GeographicBounds> {}

export const PlaceSourceRef = Schema.Struct({
  system: Schema.String.check(Schema.isNonEmpty()),
  recordId: PlaceSourceRecordId,
  retrievedAt: Schema.DateTimeUtcFromString,
  source: Schema.String.check(Schema.isNonEmpty()),
  classification: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
});
export interface PlaceSourceRef extends Schema.Schema.Type<typeof PlaceSourceRef> {}

export const PlaceLocality = Schema.Struct({
  municipality: Schema.String.check(Schema.isNonEmpty()),
  adminDistrict: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  neighbourhood: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
});
export interface PlaceLocality extends Schema.Schema.Type<typeof PlaceLocality> {}

const placeCommon = {
  id: PassengerPlaceId,
  primaryName: Schema.String.check(Schema.isNonEmpty()),
  aliases: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
  locality: PlaceLocality,
  representativeLocation: StopLocation,
  bounds: Schema.optionalKey(GeographicBounds),
  sourceRefs: Schema.Array(PlaceSourceRef).check(Schema.isNonEmpty()),
  artifactVersion: Schema.String.check(Schema.isNonEmpty()),
};

/** Neighbourhood or administrative area searchable by passengers. */
export const AreaPlace = Schema.TaggedStruct("Area", {
  ...placeCommon,
  areaKind: Schema.Literals(["Neighbourhood", "Administrative", "District"]),
});
export interface AreaPlace extends Schema.Schema.Type<typeof AreaPlace> {}

/** Passenger-relevant landmark (market, mall, campus, hospital, stadium, …). */
export const LandmarkPlace = Schema.TaggedStruct("Landmark", {
  ...placeCommon,
  landmarkKind: Schema.Literals([
    "Market",
    "Mall",
    "Campus",
    "Hospital",
    "Stadium",
    "Terminal",
    "RailStation",
    "Landmark",
    "Other",
  ]),
});
export interface LandmarkPlace extends Schema.Schema.Type<typeof LandmarkPlace> {}

/**
 * Searchable reference to a Plan 013 transit place. Does not copy grouping
 * rules; identity remains the canonical TransitPlaceId.
 */
export const TransitPlaceReference = Schema.TaggedStruct("TransitPlaceReference", {
  ...placeCommon,
  transitPlaceId: TransitPlaceId,
});
export interface TransitPlaceReference extends Schema.Schema.Type<typeof TransitPlaceReference> {}

export const PassengerPlace = Schema.Union([AreaPlace, LandmarkPlace, TransitPlaceReference]);
export type PassengerPlace = typeof PassengerPlace.Type;

export const MatchEvidence = Schema.TaggedUnion({
  ExactPrimaryName: {},
  ExactAlias: { alias: Schema.String.check(Schema.isNonEmpty()) },
  Prefix: { matchedText: Schema.String.check(Schema.isNonEmpty()) },
  Token: {
    tokens: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(Schema.isNonEmpty()),
  },
  Abbreviation: {
    ruleId: Schema.String.check(Schema.isNonEmpty()),
    matchedText: Schema.String.check(Schema.isNonEmpty()),
  },
  CoordinateBias: {
    geographicDistanceMeters: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  },
});
export type MatchEvidence = typeof MatchEvidence.Type;

export const PassengerPlaceSearchResult = Schema.Struct({
  placeId: PassengerPlaceId,
  displayLabel: Schema.String.check(Schema.isNonEmpty()),
  disambiguatingContext: Schema.String.check(Schema.isNonEmpty()),
  matchedAlias: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  resultKind: Schema.Literals(["Area", "Landmark", "TransitPlace"]),
  representativeLocation: StopLocation,
  bounds: Schema.optionalKey(GeographicBounds),
  transitPlaceId: Schema.optionalKey(TransitPlaceId),
  matchEvidence: Schema.Array(MatchEvidence).check(Schema.isNonEmpty()),
  rankScore: Schema.Number,
});
export interface PassengerPlaceSearchResult extends Schema.Schema.Type<
  typeof PassengerPlaceSearchResult
> {}

export const PassengerPlaceArtifact = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  artifactVersion: Schema.String.check(Schema.isNonEmpty()),
  source: Schema.Struct({
    name: Schema.String.check(Schema.isNonEmpty()),
    dateOrVersion: Schema.String.check(Schema.isNonEmpty()),
    license: Schema.String.check(Schema.isNonEmpty()),
    attribution: Schema.String.check(Schema.isNonEmpty()),
    boundaryDescription: Schema.String.check(Schema.isNonEmpty()),
    inputChecksum: Schema.String.check(Schema.isNonEmpty()),
    compilerVersion: Schema.String.check(Schema.isNonEmpty()),
  }),
  outputChecksum: Schema.String.check(Schema.isNonEmpty()),
  places: Schema.Array(PassengerPlace),
});
export interface PassengerPlaceArtifact extends Schema.Schema.Type<typeof PassengerPlaceArtifact> {}

export class MissingStableId extends Schema.TaggedErrorClass<MissingStableId>()(
  "PassengerPlace.MissingStableId",
  {
    recordContext: Schema.String,
    reason: Schema.String,
  },
) {}

export class UnusableCoordinate extends Schema.TaggedErrorClass<UnusableCoordinate>()(
  "PassengerPlace.UnusableCoordinate",
  {
    placeId: Schema.optionalKey(Schema.String),
    recordContext: Schema.String,
    reason: Schema.String,
  },
) {}

export class InvalidBounds extends Schema.TaggedErrorClass<InvalidBounds>()(
  "PassengerPlace.InvalidBounds",
  {
    placeId: Schema.optionalKey(Schema.String),
    recordContext: Schema.String,
    reason: Schema.String,
  },
) {}

export class EmptyPlaceName extends Schema.TaggedErrorClass<EmptyPlaceName>()(
  "PassengerPlace.EmptyPlaceName",
  {
    placeId: Schema.optionalKey(Schema.String),
    recordContext: Schema.String,
  },
) {}

export class DuplicateSourceIdentity extends Schema.TaggedErrorClass<DuplicateSourceIdentity>()(
  "PassengerPlace.DuplicateSourceIdentity",
  {
    system: Schema.String,
    recordId: Schema.String,
    placeIds: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
  },
) {}

export class DuplicatePlaceId extends Schema.TaggedErrorClass<DuplicatePlaceId>()(
  "PassengerPlace.DuplicatePlaceId",
  {
    placeId: Schema.String,
  },
) {}

export type PassengerPlaceError =
  | MissingStableId
  | UnusableCoordinate
  | InvalidBounds
  | EmptyPlaceName
  | DuplicateSourceIdentity
  | DuplicatePlaceId;
