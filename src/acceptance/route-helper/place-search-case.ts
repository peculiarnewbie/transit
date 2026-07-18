import { Schema } from "effect";

import { PlaceSearchCaseId } from "./ids.js";

export const PassengerPlaceType = Schema.Literals([
  "Area",
  "Landmark",
  "TransitPlace",
  "StopName",
]);
export type PassengerPlaceType = typeof PassengerPlaceType.Type;

export const PlaceSearchCategory = Schema.Literals([
  "AdministrativeCity",
  "Neighbourhood",
  "Landmark",
  "ExactStop",
  "Abbreviation",
  "SpellingVariant",
  "Ambiguous",
  "ExpectedNoResult",
]);
export type PlaceSearchCategory = typeof PlaceSearchCategory.Type;

export const JakartaAdminCity = Schema.Literals([
  "Jakarta Pusat",
  "Jakarta Utara",
  "Jakarta Barat",
  "Jakarta Selatan",
  "Jakarta Timur",
  "EdgeNetwork",
]);
export type JakartaAdminCity = typeof JakartaAdminCity.Type;

export const Coordinate = Schema.Struct({
  longitude: Schema.Number.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
  latitude: Schema.Number.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
});
export interface Coordinate extends Schema.Schema.Type<typeof Coordinate> {}

export const ExpectedRecognizedPlace = Schema.Struct({
  name: Schema.String.check(Schema.isNonEmpty()),
  placeType: PassengerPlaceType,
  locality: Schema.String.check(Schema.isNonEmpty()),
});
export interface ExpectedRecognizedPlace extends Schema.Schema.Type<typeof ExpectedRecognizedPlace> {}

export const PlaceSearchCase = Schema.Struct({
  id: PlaceSearchCaseId,
  query: Schema.String.check(Schema.isNonEmpty()),
  coordinate: Schema.optionalKey(Coordinate),
  adminCoverage: JakartaAdminCity,
  categories: Schema.Array(PlaceSearchCategory).check(Schema.isNonEmpty()),
  expectedPlaces: Schema.Array(ExpectedRecognizedPlace),
  forbiddenDuplicateLabels: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
  expectNoLocalResult: Schema.Boolean,
  rationale: Schema.String.check(Schema.isNonEmpty()),
  sourceReviewNote: Schema.String.check(Schema.isNonEmpty()),
});
export interface PlaceSearchCase extends Schema.Schema.Type<typeof PlaceSearchCase> {}
