import { Schema } from "effect";

const identifier = (brand: string) =>
  Schema.String.check(Schema.isNonEmpty()).pipe(Schema.brand(brand));

export const TransitPlaceId = identifier("TransitPlaceId");
export type TransitPlaceId = typeof TransitPlaceId.Type;

export const ReviewedComplexOverrideId = identifier("ReviewedComplexOverrideId");
export type ReviewedComplexOverrideId = typeof ReviewedComplexOverrideId.Type;
