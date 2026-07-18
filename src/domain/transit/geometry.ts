import { Schema } from "effect";

import { GeometryId } from "./ids.js";
import { SourceRef } from "./source-ref.js";

export const GeometryCoordinate = Schema.Tuple([
  Schema.Number.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
  Schema.Number.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
]);

export const TransitGeometry = Schema.Struct({
  id: GeometryId,
  sourceRefs: Schema.Array(SourceRef),
  coordinates: Schema.Array(GeometryCoordinate).check(Schema.isMinLength(2)),
});

export interface TransitGeometry extends Schema.Schema.Type<typeof TransitGeometry> {}

export const GeometrySidecar = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  generatedAt: Schema.DateTimeUtcFromString,
  geometries: Schema.Array(TransitGeometry),
});

export interface GeometrySidecar extends Schema.Schema.Type<typeof GeometrySidecar> {}
