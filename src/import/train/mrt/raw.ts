import { Schema } from "effect";

export const StationListRow = Schema.Struct({
  id: Schema.Number,
  slug: Schema.String.check(Schema.isNonEmpty()),
  name: Schema.String.check(Schema.isNonEmpty()),
});

export type StationListRow = typeof StationListRow.Type;

export const StationsResponse = Schema.Struct({
  data: Schema.Array(StationListRow),
  meta: Schema.optionalKey(Schema.Unknown),
});

const ScheduleObject = Schema.Struct({
  start: Schema.optionalKey(Schema.String),
  end: Schema.optionalKey(Schema.String),
  weekdaysStart: Schema.optionalKey(Schema.String),
  weekendsStart: Schema.optionalKey(Schema.String),
  weekdaysEnd: Schema.optionalKey(Schema.String),
  weekendsEnd: Schema.optionalKey(Schema.String),
  firstRatanggaStart: Schema.optionalKey(Schema.String),
  lastRatanggaStart: Schema.optionalKey(Schema.String),
  firstRatanggaEnd: Schema.optionalKey(Schema.String),
  lastRatanggaEnd: Schema.optionalKey(Schema.String),
});

export const StationDetailResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      slug: Schema.String,
      name: Schema.String,
      object: Schema.optionalKey(Schema.Struct({ schedule: Schema.optionalKey(ScheduleObject) })),
    }),
  ),
});

export type ScheduleObject = typeof ScheduleObject.Type;
