import { Schema } from "effect";

export class OsmPlacesDecodeError extends Schema.TaggedErrorClass<OsmPlacesDecodeError>()(
  "OsmPlaces.DecodeError",
  {
    reason: Schema.String,
  },
) {}

export class OsmPlacesValidationError extends Schema.TaggedErrorClass<OsmPlacesValidationError>()(
  "OsmPlaces.ValidationError",
  {
    code: Schema.String,
    message: Schema.String,
    recordContext: Schema.optionalKey(Schema.String),
  },
) {}

export type OsmPlacesCompileError = OsmPlacesDecodeError | OsmPlacesValidationError;
