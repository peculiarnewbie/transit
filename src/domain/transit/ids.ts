import { Schema } from "effect";

const identifier = (brand: string) =>
  Schema.String.check(Schema.isNonEmpty()).pipe(Schema.brand(brand));

export const AgencyId = identifier("AgencyId");
export type AgencyId = typeof AgencyId.Type;

export const StopId = identifier("StopId");
export type StopId = typeof StopId.Type;

export const RouteId = identifier("RouteId");
export type RouteId = typeof RouteId.Type;

export const RoutePatternId = identifier("RoutePatternId");
export type RoutePatternId = typeof RoutePatternId.Type;

export const TripId = identifier("TripId");
export type TripId = typeof TripId.Type;

export const ServiceId = identifier("ServiceId");
export type ServiceId = typeof ServiceId.Type;

export const SourceRecordId = identifier("SourceRecordId");
export type SourceRecordId = typeof SourceRecordId.Type;

export const GeometryId = identifier("GeometryId");
export type GeometryId = typeof GeometryId.Type;
