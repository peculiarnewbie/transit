import { Schema } from "effect";

export const Station = Schema.Struct({
  sta_id: Schema.String.check(Schema.isNonEmpty()),
  sta_name: Schema.String.check(Schema.isNonEmpty()),
  group_wil: Schema.Int,
  fg_enable: Schema.Literals([0, 1]),
});

export type Station = typeof Station.Type;

export const StationsResponse = Schema.Struct({
  status: Schema.Int,
  message: Schema.optionalKey(Schema.String),
  data: Schema.Array(Station),
});

export const ScheduleRow = Schema.Struct({
  train_id: Schema.String.check(Schema.isNonEmpty()),
  ka_name: Schema.String.check(Schema.isNonEmpty()),
  route_name: Schema.String.check(Schema.isNonEmpty()),
  dest: Schema.String.check(Schema.isNonEmpty()),
  time_est: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/)),
  color: Schema.String,
  dest_time: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/)),
});

export type ScheduleRow = typeof ScheduleRow.Type;

export const SchedulesResponse = Schema.Struct({
  status: Schema.Int,
  data: Schema.Array(ScheduleRow),
});
