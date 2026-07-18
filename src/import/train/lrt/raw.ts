import { Schema } from "effect";

export const DepartureTime = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/));

export const ParsedStation = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  name: Schema.String.check(Schema.isNonEmpty()),
  weekdays: Schema.Array(DepartureTime),
  weekends: Schema.Array(DepartureTime),
});

export type ParsedStation = typeof ParsedStation.Type;
