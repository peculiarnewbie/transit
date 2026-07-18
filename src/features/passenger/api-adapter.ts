import { Effect, Schema } from "effect";

import {
  JourneyResponse,
  StopSearchResponse,
  type JourneyRequest,
} from "../../runtime/api-contracts.js";
import type { JourneyEndpoint, PassengerRoutingAdapter, RouteQuery } from "./types.js";

const endpoint = (value: JourneyEndpoint): JourneyRequest["origin"] =>
  value._tag === "Stop"
    ? { _tag: "Stop", stopId: value.stop.id }
    : { _tag: "Coordinate", coordinate: value.coordinate };

const jakartaClock = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    serviceDate: `${value("year")}-${value("month")}-${value("day")}`,
    departureSeconds:
      Number(value("hour")) * 3600 + Number(value("minute")) * 60 + Number(value("second")),
  };
};

const messageFromResponse = async (response: Response) => {
  try {
    const body = (await response.json()) as { readonly error?: { readonly message?: string } };
    return body.error?.message ?? `Journey service returned HTTP ${response.status}`;
  } catch {
    return `Journey service returned HTTP ${response.status}`;
  }
};

export const createApiPassengerAdapter = (
  fetcher: typeof globalThis.fetch = globalThis.fetch,
  now: () => Date = () => new Date(),
): PassengerRoutingAdapter => ({
  search: async (query: RouteQuery, options) => {
    const clock = jakartaClock(now());
    const response = await fetcher("/api/journeys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        origin: endpoint(query.origin),
        destination: endpoint(query.destination),
        ...clock,
        maximumResults: 6,
        lineRules: query.lineConstraints,
        ...(query.lockedLeg === undefined ? {} : { lockedLeg: query.lockedLeg }),
      }),
      signal: options?.signal,
    });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(await messageFromResponse(response));
    const decoded = await Effect.runPromise(
      Schema.decodeUnknownEffect(JourneyResponse)(await response.json()),
    );
    return decoded.journeys;
  },
  searchStops: async (query = "", options) => {
    const parameters = new URLSearchParams({ q: query, limit: "8" });
    if (options?.reachableFromStopId !== undefined) {
      const clock = jakartaClock(now());
      parameters.set("from", options.reachableFromStopId);
      parameters.set("date", clock.serviceDate);
      parameters.set("departure", String(clock.departureSeconds));
    }
    const response = await fetcher(`/api/stops?${parameters}`, { signal: options?.signal });
    if (!response.ok) throw new Error(await messageFromResponse(response));
    const decoded = await Effect.runPromise(
      Schema.decodeUnknownEffect(StopSearchResponse)(await response.json()),
    );
    return decoded.stops;
  },
});

export const apiPassengerAdapter = createApiPassengerAdapter();
