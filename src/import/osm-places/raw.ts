import { Schema } from "effect";

/** Normalized OSM-derived feature consumed by the place compiler (not raw OSM XML). */
export const OsmPlaceGeometry = Schema.TaggedUnion({
  Point: {
    longitude: Schema.Number.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
    latitude: Schema.Number.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
  },
  Bounds: {
    west: Schema.Number.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
    south: Schema.Number.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
    east: Schema.Number.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
    north: Schema.Number.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
    /** Representative point inside or on the bounds. */
    longitude: Schema.Number.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
    latitude: Schema.Number.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
  },
});
export type OsmPlaceGeometry = typeof OsmPlaceGeometry.Type;

export const OsmPlaceFeature = Schema.Struct({
  osmType: Schema.Literals(["node", "way", "relation"]),
  osmId: Schema.Int.check(Schema.isGreaterThan(0)),
  name: Schema.String.check(Schema.isNonEmpty()),
  nameId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  altNames: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
  tags: Schema.Record(Schema.String, Schema.String),
  geometry: OsmPlaceGeometry,
  municipality: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  adminDistrict: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  neighbourhood: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
});
export interface OsmPlaceFeature extends Schema.Schema.Type<typeof OsmPlaceFeature> {}

export const OsmPlaceExtract = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  sourceName: Schema.String.check(Schema.isNonEmpty()),
  sourceDateOrVersion: Schema.String.check(Schema.isNonEmpty()),
  license: Schema.String.check(Schema.isNonEmpty()),
  attribution: Schema.String.check(Schema.isNonEmpty()),
  boundaryDescription: Schema.String.check(Schema.isNonEmpty()),
  extractionRules: Schema.String.check(Schema.isNonEmpty()),
  features: Schema.Array(OsmPlaceFeature),
});
export interface OsmPlaceExtract extends Schema.Schema.Type<typeof OsmPlaceExtract> {}
