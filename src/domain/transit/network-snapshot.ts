import { Schema } from "effect";

import { Agency } from "./agency.js";
import { RoutePattern } from "./route-pattern.js";
import { Route } from "./route.js";
import { ServiceCalendar } from "./service-calendar.js";
import { Stop } from "./stop.js";
import { Transfer } from "./transfer.js";
import { Trip } from "./trip.js";

export const NetworkSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal("2"),
  generatedAt: Schema.DateTimeUtcFromString,
  agencies: Schema.Array(Agency),
  stops: Schema.Array(Stop),
  routes: Schema.Array(Route),
  patterns: Schema.Array(RoutePattern),
  trips: Schema.Array(Trip),
  calendars: Schema.Array(ServiceCalendar),
  transfers: Schema.Array(Transfer),
});

export interface NetworkSnapshot extends Schema.Schema.Type<typeof NetworkSnapshot> {}
