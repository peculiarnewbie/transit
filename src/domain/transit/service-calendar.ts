import { Schema } from "effect";

import { ServiceId } from "./ids.js";
import { SourceRef } from "./source-ref.js";

export const ServiceDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)).pipe(
  Schema.brand("ServiceDate"),
);
export type ServiceDate = typeof ServiceDate.Type;

export const Weekday = Schema.Literals([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]);

export const CalendarException = Schema.Struct({
  date: ServiceDate,
  operation: Schema.Literals(["Add", "Remove"]),
});

export interface CalendarException extends Schema.Schema.Type<typeof CalendarException> {}

export const ServiceCalendar = Schema.Struct({
  id: ServiceId,
  sourceRefs: Schema.Array(SourceRef),
  startDate: ServiceDate,
  endDate: ServiceDate,
  activeWeekdays: Schema.Array(Weekday),
  exceptions: Schema.Array(CalendarException),
});

export interface ServiceCalendar extends Schema.Schema.Type<typeof ServiceCalendar> {}
