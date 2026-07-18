import { Schema } from "effect";

const NonEmptyString = Schema.String.check(Schema.isNonEmpty());
const IntegerFromString = Schema.NumberFromString.check(Schema.isInt());
const NonNegativeIntegerFromString = IntegerFromString.check(Schema.isGreaterThanOrEqualTo(0));

export const RawAgency = Schema.Struct({
  agency_id: Schema.optionalKey(NonEmptyString),
  agency_name: NonEmptyString,
  agency_url: Schema.optionalKey(Schema.String),
  agency_timezone: NonEmptyString,
});
export interface RawAgency extends Schema.Schema.Type<typeof RawAgency> {}

export const RawCalendar = Schema.Struct({
  service_id: NonEmptyString,
  monday: IntegerFromString,
  tuesday: IntegerFromString,
  wednesday: IntegerFromString,
  thursday: IntegerFromString,
  friday: IntegerFromString,
  saturday: IntegerFromString,
  sunday: IntegerFromString,
  start_date: NonEmptyString,
  end_date: NonEmptyString,
});
export interface RawCalendar extends Schema.Schema.Type<typeof RawCalendar> {}

export const RawCalendarDate = Schema.Struct({
  service_id: NonEmptyString,
  date: NonEmptyString,
  exception_type: IntegerFromString,
});
export interface RawCalendarDate extends Schema.Schema.Type<typeof RawCalendarDate> {}

export const RawRoute = Schema.Struct({
  route_id: NonEmptyString,
  agency_id: Schema.optionalKey(NonEmptyString),
  route_short_name: Schema.optionalKey(Schema.String),
  route_long_name: Schema.optionalKey(Schema.String),
  route_type: IntegerFromString,
  route_color: Schema.optionalKey(Schema.String),
  route_text_color: Schema.optionalKey(Schema.String),
});
export interface RawRoute extends Schema.Schema.Type<typeof RawRoute> {}

export const RawStop = Schema.Struct({
  stop_id: NonEmptyString,
  stop_name: NonEmptyString,
  stop_lat: Schema.optionalKey(Schema.NumberFromString),
  stop_lon: Schema.optionalKey(Schema.NumberFromString),
  parent_station: Schema.optionalKey(NonEmptyString),
  location_type: Schema.optionalKey(IntegerFromString),
  stop_code: Schema.optionalKey(Schema.String),
  platform_code: Schema.optionalKey(Schema.String),
  wheelchair_boarding: Schema.optionalKey(IntegerFromString),
});
export interface RawStop extends Schema.Schema.Type<typeof RawStop> {}

export const RawTrip = Schema.Struct({
  trip_id: NonEmptyString,
  route_id: NonEmptyString,
  service_id: NonEmptyString,
  trip_headsign: Schema.optionalKey(Schema.String),
  direction_id: Schema.optionalKey(IntegerFromString),
  shape_id: Schema.optionalKey(NonEmptyString),
});
export interface RawTrip extends Schema.Schema.Type<typeof RawTrip> {}

export const RawStopTime = Schema.Struct({
  trip_id: NonEmptyString,
  stop_sequence: NonNegativeIntegerFromString,
  stop_id: NonEmptyString,
  arrival_time: NonEmptyString,
  departure_time: NonEmptyString,
  pickup_type: Schema.optionalKey(IntegerFromString),
  drop_off_type: Schema.optionalKey(IntegerFromString),
  stop_headsign: Schema.optionalKey(Schema.String),
});
export interface RawStopTime extends Schema.Schema.Type<typeof RawStopTime> {}

export const RawFrequency = Schema.Struct({
  trip_id: NonEmptyString,
  start_time: NonEmptyString,
  end_time: NonEmptyString,
  headway_secs: NonNegativeIntegerFromString,
  exact_times: Schema.optionalKey(IntegerFromString),
});
export interface RawFrequency extends Schema.Schema.Type<typeof RawFrequency> {}

export const RawTransfer = Schema.Struct({
  from_stop_id: NonEmptyString,
  to_stop_id: NonEmptyString,
  transfer_type: IntegerFromString,
  min_transfer_time: Schema.optionalKey(NonNegativeIntegerFromString),
});
export interface RawTransfer extends Schema.Schema.Type<typeof RawTransfer> {}

export const RawShapePoint = Schema.Struct({
  shape_id: NonEmptyString,
  shape_pt_sequence: NonNegativeIntegerFromString,
  shape_pt_lat: Schema.NumberFromString,
  shape_pt_lon: Schema.NumberFromString,
});
export interface RawShapePoint extends Schema.Schema.Type<typeof RawShapePoint> {}
