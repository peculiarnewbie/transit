import { Schema } from "effect";

const identifier = (brand: string) =>
  Schema.String.check(Schema.isNonEmpty()).pipe(Schema.brand(brand));

export const PassengerPlaceId = identifier("PassengerPlaceId");
export type PassengerPlaceId = typeof PassengerPlaceId.Type;

export const PlaceSourceRecordId = identifier("PlaceSourceRecordId");
export type PlaceSourceRecordId = typeof PlaceSourceRecordId.Type;
