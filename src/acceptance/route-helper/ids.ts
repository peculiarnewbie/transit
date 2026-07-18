import { Schema } from "effect";

const identifier = (brand: string) =>
  Schema.String.check(Schema.isNonEmpty()).pipe(Schema.brand(brand));

export const PlaceSearchCaseId = identifier("PlaceSearchCaseId");
export type PlaceSearchCaseId = typeof PlaceSearchCaseId.Type;

export const RouteGuideCaseId = identifier("RouteGuideCaseId");
export type RouteGuideCaseId = typeof RouteGuideCaseId.Type;

export const UsabilityTaskId = identifier("UsabilityTaskId");
export type UsabilityTaskId = typeof UsabilityTaskId.Type;
