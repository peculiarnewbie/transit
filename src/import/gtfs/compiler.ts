import { createHash } from "node:crypto";
import { basename } from "node:path";

import { DateTime, Effect, Schema } from "effect";
import { strFromU8, unzipSync } from "fflate";

import { GeometrySidecar, NetworkSnapshot, type TransitMode } from "../../domain/transit/index.js";
import { decodeTable } from "./csv.js";
import { GtfsArchiveError, type GtfsCompileError, GtfsValidationError } from "./errors.js";
import {
  RawAgency,
  RawCalendar,
  RawCalendarDate,
  RawFrequency,
  RawRoute,
  RawShapePoint,
  RawStop,
  RawStopTime,
  RawTransfer,
  RawTrip,
} from "./raw.js";

const tableNames = [
  "agency",
  "calendar",
  "calendar_dates",
  "routes",
  "stops",
  "trips",
  "stop_times",
  "frequencies",
  "transfers",
  "shapes",
] as const;

type TableName = (typeof tableNames)[number];

const requiredColumns: Record<TableName, ReadonlyArray<string>> = {
  agency: ["agency_name", "agency_timezone"],
  calendar: [
    "service_id",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "start_date",
    "end_date",
  ],
  calendar_dates: ["service_id", "date", "exception_type"],
  routes: ["route_id", "route_type"],
  stops: ["stop_id", "stop_name"],
  trips: ["trip_id", "route_id", "service_id"],
  stop_times: ["trip_id", "stop_sequence", "stop_id", "arrival_time", "departure_time"],
  frequencies: ["trip_id", "start_time", "end_time", "headway_secs"],
  transfers: ["from_stop_id", "to_stop_id", "transfer_type"],
  shapes: ["shape_id", "shape_pt_sequence", "shape_pt_lat", "shape_pt_lon"],
};

const namespace = (kind: string, value: string) => `gtfs:transjakarta:${kind}:${value}`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const byId = <A extends { readonly id: string }>(left: A, right: A) =>
  left.id.localeCompare(right.id);

const sourceRef = (kind: string, value: string, generatedAt: string, source: string) => ({
  system: "gtfs:transjakarta",
  recordId: namespace(kind, value),
  retrievedAt: generatedAt,
  source,
});

const failValidation = (code: string, message: string) =>
  Effect.fail(new GtfsValidationError({ code, message }));

export const parseServiceTime = Effect.fn("Gtfs.parseServiceTime")(function* (value: string) {
  const match = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(value);
  if (match === null) {
    return yield* failValidation("INVALID_SERVICE_TIME", `Invalid GTFS service time: ${value}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const total = hours * 3_600 + minutes * 60 + seconds;
  if (total > 604_800) {
    return yield* failValidation(
      "SERVICE_TIME_OUT_OF_RANGE",
      `GTFS service time exceeds seven days: ${value}`,
    );
  }
  return total;
});

const serviceDate = (value: string) => {
  if (!/^\d{8}$/.test(value)) return undefined;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
};

const routeMode = (routeType: number): TransitMode | undefined => {
  switch (routeType) {
    case 0:
      return "Lrt";
    case 1:
      return "Mrt";
    case 2:
      return "CommuterRail";
    case 3:
    case 7:
    case 11:
      return "Bus";
    default:
      return undefined;
  }
};

const stopLocationKind = (
  locationType: number | undefined,
): "Stop" | "Station" | "EntranceExit" | "GenericNode" | "BoardingArea" | undefined => {
  switch (locationType ?? 0) {
    case 0:
      return "Stop";
    case 1:
      return "Station";
    case 2:
      return "EntranceExit";
    case 3:
      return "GenericNode";
    case 4:
      return "BoardingArea";
    default:
      return undefined;
  }
};

const wheelchairBoarding = (
  value: number | undefined,
): "Unknown" | "Possible" | "NotPossible" | undefined => {
  switch (value ?? 0) {
    case 0:
      return "Unknown";
    case 1:
      return "Possible";
    case 2:
      return "NotPossible";
    default:
      return undefined;
  }
};

const boardingPolicy = (
  value: number | undefined,
): "Normal" | "Forbidden" | "PhoneAgency" | "CoordinateWithDriver" | undefined => {
  switch (value ?? 0) {
    case 0:
      return "Normal";
    case 1:
      return "Forbidden";
    case 2:
      return "PhoneAgency";
    case 3:
      return "CoordinateWithDriver";
    default:
      return undefined;
  }
};

const optionalNonEmpty = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

const loadArchive = (input: Uint8Array) =>
  Effect.try({
    try: () => {
      const wanted = new Set(tableNames.map((name) => `${name}.txt`));
      const files = unzipSync(input, {
        filter: (file) => wanted.has(basename(file.name)),
      });
      const tables = new Map<TableName, string>();
      for (const [path, data] of Object.entries(files)) {
        const fileName = basename(path);
        const table = tableNames.find((candidate) => `${candidate}.txt` === fileName);
        if (table !== undefined) tables.set(table, strFromU8(data));
      }
      return tables;
    },
    catch: (cause) => new GtfsArchiveError({ operation: "Gtfs.loadArchive", cause }),
  });

const readRequiredTable = <A>(
  tables: ReadonlyMap<TableName, string>,
  table: TableName,
  schema: Schema.ConstraintDecoder<A>,
) => {
  const input = tables.get(table);
  if (input === undefined) {
    return Effect.fail(
      new GtfsArchiveError({
        operation: `Gtfs.readTable.${table}`,
        cause: new Error(`Archive does not contain ${table}.txt`),
      }),
    );
  }
  return decodeTable({ table, input, schema, requiredColumns: requiredColumns[table] });
};

export interface CompileGtfsOptions {
  readonly input: Uint8Array;
  readonly generatedAt: string;
  readonly sourceName: string;
}

export interface CompileSummary {
  readonly agencies: number;
  readonly stops: number;
  readonly routes: number;
  readonly patterns: number;
  readonly trips: number;
  readonly calendars: number;
  readonly transfers: number;
  readonly geometries: number;
  readonly warnings: ReadonlyArray<string>;
}

export interface CompileGtfsResult {
  readonly snapshot: NetworkSnapshot;
  readonly geometry: GeometrySidecar;
  readonly summary: CompileSummary;
}

export const compileGtfs = Effect.fn("Gtfs.compile")(function* (
  options: CompileGtfsOptions,
): Effect.fn.Return<CompileGtfsResult, GtfsCompileError> {
  const generatedAt = yield* Schema.decodeUnknownEffect(Schema.DateTimeUtcFromString)(
    options.generatedAt,
  ).pipe(
    Effect.mapError(
      () =>
        new GtfsValidationError({
          code: "INVALID_GENERATED_AT",
          message: "generatedAt must be an ISO-8601 UTC timestamp",
        }),
    ),
  );
  const canonicalGeneratedAt = DateTime.formatIso(generatedAt);
  const tables = yield* loadArchive(options.input);

  const agenciesRaw = yield* readRequiredTable(tables, "agency", RawAgency);
  const calendarsRaw = yield* readRequiredTable(tables, "calendar", RawCalendar);
  const calendarDatesRaw = yield* readRequiredTable(tables, "calendar_dates", RawCalendarDate);
  const routesRaw = yield* readRequiredTable(tables, "routes", RawRoute);
  const stopsRaw = yield* readRequiredTable(tables, "stops", RawStop);
  const tripsRaw = yield* readRequiredTable(tables, "trips", RawTrip);
  const stopTimesRaw = yield* readRequiredTable(tables, "stop_times", RawStopTime);
  const frequenciesRaw = yield* readRequiredTable(tables, "frequencies", RawFrequency);
  const transfersRaw = yield* readRequiredTable(tables, "transfers", RawTransfer);
  const shapePointsRaw = yield* readRequiredTable(tables, "shapes", RawShapePoint);

  const warnings: Array<string> = [];
  const agencyRawIds = agenciesRaw.map(
    (agency, index) => agency.agency_id ?? `agency-${index + 1}`,
  );
  const agencies = agenciesRaw.map((agency, index) => {
    const rawId = agencyRawIds[index] ?? `agency-${index + 1}`;
    return {
      id: namespace("agency", rawId),
      sourceRefs: [sourceRef("agency", rawId, canonicalGeneratedAt, options.sourceName)],
      name: agency.agency_name,
      timezone: agency.agency_timezone,
      ...(agency.agency_url === undefined ? {} : { url: agency.agency_url }),
    };
  });
  const agencyIds = new Set(agencyRawIds);

  for (const stop of stopsRaw) {
    if ((stop.stop_lat === undefined) !== (stop.stop_lon === undefined)) {
      return yield* failValidation(
        "PARTIAL_STOP_COORDINATES",
        `Stop ${stop.stop_id} has only one of stop_lat and stop_lon`,
      );
    }
  }
  const stops = [];
  for (const stop of stopsRaw) {
    const locationKind = stopLocationKind(stop.location_type);
    if (locationKind === undefined) {
      return yield* failValidation(
        "INVALID_LOCATION_TYPE",
        `Stop ${stop.stop_id} has unsupported location_type ${String(stop.location_type)}`,
      );
    }
    const accessibility = wheelchairBoarding(stop.wheelchair_boarding);
    if (accessibility === undefined) {
      return yield* failValidation(
        "INVALID_WHEELCHAIR_BOARDING",
        `Stop ${stop.stop_id} has unsupported wheelchair_boarding ${String(stop.wheelchair_boarding)}`,
      );
    }
    const stopCode = optionalNonEmpty(stop.stop_code);
    const platformCode = optionalNonEmpty(stop.platform_code);
    stops.push({
      id: namespace("stop", stop.stop_id),
      sourceRefs: [sourceRef("stop", stop.stop_id, canonicalGeneratedAt, options.sourceName)],
      name: stop.stop_name,
      location:
        stop.stop_lat === undefined || stop.stop_lon === undefined
          ? { _tag: "Unplaced" as const, reason: "Coordinates absent from source" }
          : {
              _tag: "Placed" as const,
              latitude: stop.stop_lat,
              longitude: stop.stop_lon,
            },
      locationKind,
      wheelchairBoarding: accessibility,
      ...(stopCode === undefined ? {} : { stopCode }),
      ...(platformCode === undefined ? {} : { platformCode }),
      ...(stop.parent_station === undefined
        ? {}
        : { parentStopId: namespace("stop", stop.parent_station) }),
    });
  }
  const stopIds = new Set(stopsRaw.map((stop) => stop.stop_id));
  for (const stop of stopsRaw) {
    if (stop.parent_station !== undefined && !stopIds.has(stop.parent_station)) {
      return yield* failValidation(
        "DANGLING_PARENT_STOP",
        `Stop ${stop.stop_id} references absent parent ${stop.parent_station}`,
      );
    }
  }

  const routes = [];
  const routeIds = new Set<string>();
  for (const route of routesRaw) {
    const agencyRawId =
      route.agency_id ?? (agencyRawIds.length === 1 ? agencyRawIds[0] : undefined);
    if (agencyRawId === undefined || !agencyIds.has(agencyRawId)) {
      return yield* failValidation(
        "DANGLING_AGENCY",
        `Route ${route.route_id} does not resolve to a known agency`,
      );
    }
    const mode = routeMode(route.route_type);
    if (mode === undefined) {
      return yield* failValidation(
        "UNSUPPORTED_ROUTE_TYPE",
        `Route ${route.route_id} uses unsupported GTFS route_type ${route.route_type}`,
      );
    }
    routeIds.add(route.route_id);
    routes.push({
      id: namespace("route", route.route_id),
      agencyId: namespace("agency", agencyRawId),
      sourceRefs: [sourceRef("route", route.route_id, canonicalGeneratedAt, options.sourceName)],
      mode,
      ...(route.route_short_name === undefined ? {} : { shortName: route.route_short_name }),
      ...(route.route_long_name === undefined ? {} : { longName: route.route_long_name }),
      ...(route.route_color === undefined ? {} : { color: route.route_color }),
      ...(route.route_text_color === undefined ? {} : { textColor: route.route_text_color }),
    });
  }

  const exceptionsByService = new Map<
    string,
    Array<{ date: string; operation: "Add" | "Remove" }>
  >();
  for (const exception of calendarDatesRaw) {
    const date = serviceDate(exception.date);
    if (date === undefined || (exception.exception_type !== 1 && exception.exception_type !== 2)) {
      return yield* failValidation(
        "INVALID_CALENDAR_EXCEPTION",
        `Calendar exception for ${exception.service_id} is invalid`,
      );
    }
    const list = exceptionsByService.get(exception.service_id) ?? [];
    list.push({ date, operation: exception.exception_type === 1 ? "Add" : "Remove" });
    exceptionsByService.set(exception.service_id, list);
  }

  const weekdayNames = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ] as const;
  const calendars = [];
  const serviceIds = new Set<string>();
  for (const calendar of calendarsRaw) {
    const startDate = serviceDate(calendar.start_date);
    const endDate = serviceDate(calendar.end_date);
    const flags = [
      calendar.monday,
      calendar.tuesday,
      calendar.wednesday,
      calendar.thursday,
      calendar.friday,
      calendar.saturday,
      calendar.sunday,
    ];
    if (
      startDate === undefined ||
      endDate === undefined ||
      startDate > endDate ||
      flags.some((flag) => flag !== 0 && flag !== 1)
    ) {
      return yield* failValidation(
        "INVALID_CALENDAR",
        `Service calendar ${calendar.service_id} is invalid`,
      );
    }
    serviceIds.add(calendar.service_id);
    calendars.push({
      id: namespace("service", calendar.service_id),
      sourceRefs: [
        sourceRef("calendar", calendar.service_id, canonicalGeneratedAt, options.sourceName),
      ],
      startDate,
      endDate,
      activeWeekdays: weekdayNames.filter((_, index) => flags[index] === 1),
      exceptions: (exceptionsByService.get(calendar.service_id) ?? []).sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    });
  }
  for (const [serviceId, exceptions] of exceptionsByService) {
    if (serviceIds.has(serviceId)) continue;
    const dates = exceptions.map((exception) => exception.date).sort();
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];
    if (startDate === undefined || endDate === undefined) continue;
    serviceIds.add(serviceId);
    calendars.push({
      id: namespace("service", serviceId),
      sourceRefs: [sourceRef("calendar", serviceId, canonicalGeneratedAt, options.sourceName)],
      startDate,
      endDate,
      activeWeekdays: [],
      exceptions: exceptions.sort((a, b) => a.date.localeCompare(b.date)),
    });
  }

  const shapePoints = new Map<string, Array<RawShapePoint>>();
  for (const point of shapePointsRaw) {
    const points = shapePoints.get(point.shape_id) ?? [];
    points.push(point);
    shapePoints.set(point.shape_id, points);
  }

  const geometryByContent = new Map<
    string,
    { id: string; coordinates: ReadonlyArray<readonly [number, number]>; rawIds: Array<string> }
  >();
  const geometryIdByShape = new Map<string, string>();
  for (const [rawId, points] of shapePoints) {
    points.sort((left, right) => left.shape_pt_sequence - right.shape_pt_sequence);
    for (let index = 1; index < points.length; index += 1) {
      if (points[index]?.shape_pt_sequence === points[index - 1]?.shape_pt_sequence) {
        return yield* failValidation(
          "DUPLICATE_SHAPE_SEQUENCE",
          `Shape ${rawId} contains duplicate point sequence values`,
        );
      }
    }
    if (points.length < 2) {
      return yield* failValidation(
        "INVALID_SHAPE",
        `Shape ${rawId} contains fewer than two points`,
      );
    }
    const coordinates = points.map(
      (point) =>
        [Number(point.shape_pt_lon.toFixed(6)), Number(point.shape_pt_lat.toFixed(6))] as const,
    );
    const contentKey = JSON.stringify(coordinates);
    const existing = geometryByContent.get(contentKey);
    const id = existing?.id ?? namespace("geometry", digest(contentKey).slice(0, 24));
    geometryIdByShape.set(rawId, id);
    if (existing === undefined) {
      geometryByContent.set(contentKey, { id, coordinates, rawIds: [rawId] });
    } else {
      existing.rawIds.push(rawId);
    }
  }
  const geometries = [...geometryByContent.values()]
    .map((geometry) => ({
      id: geometry.id,
      sourceRefs: geometry.rawIds
        .sort((a, b) => a.localeCompare(b))
        .map((rawId) => sourceRef("shape", rawId, canonicalGeneratedAt, options.sourceName)),
      coordinates: geometry.coordinates,
    }))
    .sort(byId);

  const stopTimesByTrip = new Map<string, Array<RawStopTime>>();
  for (const stopTime of stopTimesRaw) {
    if (!stopIds.has(stopTime.stop_id)) {
      return yield* failValidation(
        "DANGLING_STOP_TIME_STOP",
        `Trip ${stopTime.trip_id} references absent stop ${stopTime.stop_id}`,
      );
    }
    const entries = stopTimesByTrip.get(stopTime.trip_id) ?? [];
    const previous = entries[entries.length - 1];
    if (previous !== undefined && stopTime.stop_sequence <= previous.stop_sequence) {
      return yield* failValidation(
        "NON_MONOTONIC_STOP_SEQUENCE",
        `Trip ${stopTime.trip_id} has a non-monotonic stop sequence`,
      );
    }
    entries.push(stopTime);
    stopTimesByTrip.set(stopTime.trip_id, entries);
  }

  const frequenciesByTrip = new Map<string, Array<RawFrequency>>();
  for (const frequency of frequenciesRaw) {
    const entries = frequenciesByTrip.get(frequency.trip_id) ?? [];
    entries.push(frequency);
    frequenciesByTrip.set(frequency.trip_id, entries);
  }

  const patternGroups = new Map<
    string,
    {
      readonly id: string;
      readonly routeId: string;
      readonly directionId: number | undefined;
      readonly stopIds: ReadonlyArray<string>;
      readonly tripIds: Array<string>;
      readonly geometryIds: Set<string>;
    }
  >();
  const patternIdByTrip = new Map<string, string>();
  for (const trip of tripsRaw) {
    if (!routeIds.has(trip.route_id)) {
      return yield* failValidation(
        "DANGLING_TRIP_ROUTE",
        `Trip ${trip.trip_id} references absent route ${trip.route_id}`,
      );
    }
    if (!serviceIds.has(trip.service_id)) {
      return yield* failValidation(
        "DANGLING_TRIP_SERVICE",
        `Trip ${trip.trip_id} references absent service ${trip.service_id}`,
      );
    }
    const stopTimes = stopTimesByTrip.get(trip.trip_id);
    if (stopTimes === undefined || stopTimes.length === 0) {
      return yield* failValidation("TRIP_WITHOUT_STOPS", `Trip ${trip.trip_id} has no stop times`);
    }
    let geometryId: string | undefined;
    if (trip.shape_id !== undefined) {
      geometryId = geometryIdByShape.get(trip.shape_id);
      if (geometryId === undefined) {
        return yield* failValidation(
          "DANGLING_TRIP_SHAPE",
          `Trip ${trip.trip_id} references absent shape ${trip.shape_id}`,
        );
      }
    }
    const orderedStopIds = stopTimes.map((stopTime) => stopTime.stop_id);
    const key = JSON.stringify([trip.route_id, trip.direction_id ?? null, orderedStopIds]);
    const existing = patternGroups.get(key);
    if (existing === undefined) {
      const id = namespace("pattern", digest(key).slice(0, 24));
      patternGroups.set(key, {
        id,
        routeId: trip.route_id,
        directionId: trip.direction_id,
        stopIds: orderedStopIds,
        tripIds: [trip.trip_id],
        geometryIds: new Set(geometryId === undefined ? [] : [geometryId]),
      });
      patternIdByTrip.set(trip.trip_id, id);
    } else {
      existing.tripIds.push(trip.trip_id);
      if (geometryId !== undefined) existing.geometryIds.add(geometryId);
      patternIdByTrip.set(trip.trip_id, existing.id);
    }
  }

  const patterns = [...patternGroups.values()]
    .map((pattern) => {
      if (pattern.geometryIds.size > 1) {
        warnings.push(
          `Pattern ${pattern.id} has multiple source geometries; topology retained without one display geometry`,
        );
      }
      const geometryId = pattern.geometryIds.size === 1 ? [...pattern.geometryIds][0] : undefined;
      return {
        id: pattern.id,
        routeId: namespace("route", pattern.routeId),
        sourceRefs: pattern.tripIds
          .sort((a, b) => a.localeCompare(b))
          .map((tripId) => sourceRef("trip", tripId, canonicalGeneratedAt, options.sourceName)),
        ...(pattern.directionId === undefined ? {} : { directionId: pattern.directionId }),
        stopIds: pattern.stopIds.map((stopId) => namespace("stop", stopId)),
        ...(geometryId === undefined ? {} : { geometryId }),
      };
    })
    .sort(byId);

  const trips = [];
  for (const trip of tripsRaw) {
    const patternId = patternIdByTrip.get(trip.trip_id);
    const rawStopTimes = stopTimesByTrip.get(trip.trip_id);
    if (patternId === undefined || rawStopTimes === undefined) {
      return yield* failValidation(
        "TRIP_WITHOUT_PATTERN",
        `Trip ${trip.trip_id} did not resolve to a pattern`,
      );
    }
    const stopTimes = [];
    for (const stopTime of rawStopTimes) {
      const arrivalSeconds = yield* parseServiceTime(stopTime.arrival_time);
      const departureSeconds = yield* parseServiceTime(stopTime.departure_time);
      if (departureSeconds < arrivalSeconds) {
        return yield* failValidation(
          "DEPARTURE_BEFORE_ARRIVAL",
          `Trip ${trip.trip_id} departs before it arrives at stop ${stopTime.stop_id}`,
        );
      }
      const pickupPolicy = boardingPolicy(stopTime.pickup_type);
      const dropOffPolicy = boardingPolicy(stopTime.drop_off_type);
      if (pickupPolicy === undefined) {
        return yield* failValidation(
          "INVALID_PICKUP_TYPE",
          `Trip ${trip.trip_id} stop ${stopTime.stop_id} has unsupported pickup_type ${String(stopTime.pickup_type)}`,
        );
      }
      if (dropOffPolicy === undefined) {
        return yield* failValidation(
          "INVALID_DROP_OFF_TYPE",
          `Trip ${trip.trip_id} stop ${stopTime.stop_id} has unsupported drop_off_type ${String(stopTime.drop_off_type)}`,
        );
      }
      const stopHeadsign = optionalNonEmpty(stopTime.stop_headsign);
      stopTimes.push({
        stopId: namespace("stop", stopTime.stop_id),
        sequence: stopTime.stop_sequence,
        arrivalSeconds,
        departureSeconds,
        pickupPolicy,
        dropOffPolicy,
        ...(stopHeadsign === undefined ? {} : { stopHeadsign }),
      });
    }
    const frequencyWindows = [];
    for (const frequency of frequenciesByTrip.get(trip.trip_id) ?? []) {
      const startSeconds = yield* parseServiceTime(frequency.start_time);
      const endSeconds = yield* parseServiceTime(frequency.end_time);
      if (endSeconds <= startSeconds || frequency.headway_secs <= 0) {
        return yield* failValidation(
          "INVALID_FREQUENCY_WINDOW",
          `Trip ${trip.trip_id} has an invalid frequency window`,
        );
      }
      frequencyWindows.push({
        startSeconds,
        endSeconds,
        headwaySeconds: frequency.headway_secs,
        exactTimes: frequency.exact_times === 1,
      });
    }
    frequencyWindows.sort((a, b) => a.startSeconds - b.startSeconds);
    trips.push({
      id: namespace("trip", trip.trip_id),
      patternId,
      serviceId: namespace("service", trip.service_id),
      sourceRefs: [sourceRef("trip", trip.trip_id, canonicalGeneratedAt, options.sourceName)],
      ...(trip.trip_headsign === undefined ? {} : { headsign: trip.trip_headsign }),
      availability: {
        _tag: "Scheduled" as const,
        stopTimes,
        frequencyWindows,
      },
    });
  }

  const transfers = [];
  const transferKinds = ["Recommended", "Timed", "MinimumTime", "Forbidden"] as const;
  for (const transfer of transfersRaw) {
    if (!stopIds.has(transfer.from_stop_id) || !stopIds.has(transfer.to_stop_id)) {
      return yield* failValidation(
        "DANGLING_TRANSFER_STOP",
        `Transfer ${transfer.from_stop_id} -> ${transfer.to_stop_id} references an absent stop`,
      );
    }
    const kind = transferKinds[transfer.transfer_type];
    if (kind === undefined) {
      return yield* failValidation(
        "INVALID_TRANSFER_TYPE",
        `Transfer ${transfer.from_stop_id} -> ${transfer.to_stop_id} has invalid type`,
      );
    }
    if (kind === "MinimumTime" && transfer.min_transfer_time === undefined) {
      return yield* failValidation(
        "MISSING_TRANSFER_TIME",
        `Minimum-time transfer ${transfer.from_stop_id} -> ${transfer.to_stop_id} has no duration`,
      );
    }
    const recordId = `${transfer.from_stop_id}:${transfer.to_stop_id}`;
    transfers.push({
      fromStopId: namespace("stop", transfer.from_stop_id),
      toStopId: namespace("stop", transfer.to_stop_id),
      sourceRefs: [sourceRef("transfer", recordId, canonicalGeneratedAt, options.sourceName)],
      kind,
      ...(transfer.min_transfer_time === undefined
        ? {}
        : { minimumTransferSeconds: transfer.min_transfer_time }),
    });
  }

  const snapshot = yield* Schema.decodeUnknownEffect(NetworkSnapshot)({
    schemaVersion: "2",
    generatedAt: canonicalGeneratedAt,
    agencies: agencies.sort(byId),
    stops: stops.sort(byId),
    routes: routes.sort(byId),
    patterns,
    trips: trips.sort(byId),
    calendars: calendars.sort(byId),
    transfers: transfers.sort((left, right) => {
      const from = left.fromStopId.localeCompare(right.fromStopId);
      return from === 0 ? left.toStopId.localeCompare(right.toStopId) : from;
    }),
  }).pipe(
    Effect.mapError(
      () =>
        new GtfsValidationError({
          code: "INVALID_CANONICAL_SNAPSHOT",
          message: "Compiled topology did not satisfy the canonical NetworkSnapshot schema",
        }),
    ),
  );
  const geometry = yield* Schema.decodeUnknownEffect(GeometrySidecar)({
    schemaVersion: "1",
    generatedAt: canonicalGeneratedAt,
    geometries,
  }).pipe(
    Effect.mapError(
      () =>
        new GtfsValidationError({
          code: "INVALID_GEOMETRY_SIDECAR",
          message: "Compiled geometry did not satisfy the canonical GeometrySidecar schema",
        }),
    ),
  );

  return {
    snapshot,
    geometry,
    summary: {
      agencies: snapshot.agencies.length,
      stops: snapshot.stops.length,
      routes: snapshot.routes.length,
      patterns: snapshot.patterns.length,
      trips: snapshot.trips.length,
      calendars: snapshot.calendars.length,
      transfers: snapshot.transfers.length,
      geometries: geometry.geometries.length,
      warnings: warnings.sort((a, b) => a.localeCompare(b)),
    },
  };
});

export const encodeSnapshot = Schema.encodeUnknownEffect(NetworkSnapshot);
export const encodeGeometry = Schema.encodeUnknownEffect(GeometrySidecar);
