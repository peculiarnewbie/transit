import { Schema } from "effect";

import {
  RouteId,
  RoutePatternId,
  ServiceDaySeconds,
  StopId,
  TripId,
} from "../../domain/transit/index.js";
import type {
  Journey,
  LineConstraint,
  LockedLeg,
  PassengerRoutingAdapter,
  RouteQuery,
  StopSuggestion,
  TransitLeg,
} from "./types.js";

const stopId = Schema.decodeUnknownSync(StopId);
const routeId = Schema.decodeUnknownSync(RouteId);
const patternId = Schema.decodeUnknownSync(RoutePatternId);
const tripId = Schema.decodeUnknownSync(TripId);
const seconds = Schema.decodeUnknownSync(ServiceDaySeconds);

const lock = ({
  routeId,
  key,
  from,
  to,
  departure,
  arrival,
}: {
  readonly routeId: RouteId;
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly departure: number;
  readonly arrival: number;
}): LockedLeg => ({
  fromStopId: stopId(from),
  toStopId: stopId(to),
  routeId,
  patternId: patternId(`fixture:pattern:${key}`),
  tripId: tripId(`fixture:trip:${key}`),
  departureSeconds: seconds(departure),
  arrivalSeconds: seconds(arrival),
});

export const fixtureStops: ReadonlyArray<StopSuggestion> = [
  {
    id: stopId("tj:bundaran-hi"),
    name: "Bundaran HI Astra",
    area: "Thamrin",
    coordinate: { longitude: 106.823, latitude: -6.193 },
  },
  {
    id: stopId("tj:tosari"),
    name: "Tosari",
    area: "Sudirman",
    coordinate: { longitude: 106.8232, latitude: -6.1989 },
  },
  {
    id: stopId("tj:dukuh-atas"),
    name: "Dukuh Atas",
    area: "Setiabudi",
    coordinate: { longitude: 106.8228, latitude: -6.2057 },
  },
  {
    id: stopId("tj:gbk"),
    name: "Gelora Bung Karno",
    area: "Senayan",
    coordinate: { longitude: 106.8003, latitude: -6.2242 },
  },
];

export const fixtureRouteIds = {
  one: routeId("tj:1"),
  sixB: routeId("tj:6B"),
  nineC: routeId("tj:9C"),
} as const;

const journeys: ReadonlyArray<Journey> = [
  {
    id: "direct-one",
    label: "Direct on Corridor 1",
    minutes: 24,
    walkingMinutes: 5,
    transfers: 0,
    legs: [
      { _tag: "Walk", from: "Origin", to: "Bundaran HI Astra", minutes: 3, meters: 210 },
      {
        _tag: "Transit",
        routeId: fixtureRouteIds.one,
        line: "1",
        from: "Bundaran HI Astra",
        to: "Gelora Bung Karno",
        minutes: 17,
        stops: 6,
        tone: "red",
        color: "#e0442e",
        lock: lock({
          routeId: fixtureRouteIds.one,
          key: "one",
          from: "tj:bundaran-hi",
          to: "tj:gbk",
          departure: 28_800,
          arrival: 29_820,
        }),
      },
      { _tag: "Walk", from: "Gelora Bung Karno", to: "Destination", minutes: 2, meters: 140 },
    ],
    geometry: [
      [106.823, -6.193],
      [106.8232, -6.1989],
      [106.8228, -6.2057],
      [106.8003, -6.2242],
    ],
  },
  {
    id: "six-b-nine-c",
    label: "Quieter transfer at Semanggi",
    minutes: 31,
    walkingMinutes: 7,
    transfers: 1,
    legs: [
      { _tag: "Walk", from: "Origin", to: "Dukuh Atas", minutes: 4, meters: 290 },
      {
        _tag: "Transit",
        routeId: fixtureRouteIds.sixB,
        line: "6B",
        from: "Dukuh Atas",
        to: "Semanggi",
        minutes: 11,
        stops: 4,
        tone: "blue",
        color: "#31556f",
        lock: lock({
          routeId: fixtureRouteIds.sixB,
          key: "six-b",
          from: "tj:dukuh-atas",
          to: "tj:semanggi",
          departure: 28_800,
          arrival: 29_460,
        }),
      },
      {
        _tag: "Transit",
        routeId: fixtureRouteIds.nineC,
        line: "9C",
        from: "Semanggi",
        to: "Gelora Bung Karno",
        minutes: 9,
        stops: 3,
        tone: "yellow",
        color: "#f5c542",
        lock: lock({
          routeId: fixtureRouteIds.nineC,
          key: "nine-c",
          from: "tj:semanggi",
          to: "tj:gbk",
          departure: 29_580,
          arrival: 30_120,
        }),
      },
      { _tag: "Walk", from: "Gelora Bung Karno", to: "Destination", minutes: 3, meters: 220 },
    ],
    geometry: [
      [106.8228, -6.2057],
      [106.8096, -6.2195],
      [106.8003, -6.2242],
    ],
  },
  {
    id: "six-b-one",
    label: "Sheltered transfer at Tosari",
    minutes: 35,
    walkingMinutes: 4,
    transfers: 1,
    legs: [
      {
        _tag: "Transit",
        routeId: fixtureRouteIds.sixB,
        line: "6B",
        from: "Dukuh Atas",
        to: "Tosari",
        minutes: 9,
        stops: 3,
        tone: "blue",
        color: "#31556f",
        lock: lock({
          routeId: fixtureRouteIds.sixB,
          key: "six-b-north",
          from: "tj:dukuh-atas",
          to: "tj:tosari",
          departure: 28_800,
          arrival: 29_340,
        }),
      },
      {
        _tag: "Transit",
        routeId: fixtureRouteIds.one,
        line: "1",
        from: "Tosari",
        to: "Gelora Bung Karno",
        minutes: 22,
        stops: 7,
        tone: "red",
        color: "#e0442e",
        lock: lock({
          routeId: fixtureRouteIds.one,
          key: "one-south",
          from: "tj:tosari",
          to: "tj:gbk",
          departure: 29_460,
          arrival: 30_780,
        }),
      },
    ],
    geometry: [
      [106.8228, -6.2057],
      [106.8232, -6.1989],
      [106.8003, -6.2242],
    ],
  },
];

const transitLegs = (journey: Journey): ReadonlyArray<TransitLeg> =>
  journey.legs.filter((leg): leg is TransitLeg => leg._tag === "Transit");

const matchesConstraint = (journey: Journey, constraint: LineConstraint): boolean => {
  const includesRoute = transitLegs(journey).some((leg) => leg.routeId === constraint.routeId);
  return constraint._tag === "Exclude"
    ? !includesRoute
    : constraint._tag === "Require"
      ? includesRoute
      : true;
};

export const searchFixtureJourneys = (query: RouteQuery): ReadonlyArray<Journey> => {
  const constrained = journeys.filter((journey) => {
    const lockedLeg = query.lockedLeg;
    const matchesLock =
      lockedLeg === undefined ||
      transitLegs(journey).some(
        (leg) =>
          leg.lock.routeId === lockedLeg.routeId &&
          leg.lock.fromStopId === lockedLeg.fromStopId &&
          leg.lock.toStopId === lockedLeg.toStopId,
      );
    return (
      matchesLock &&
      query.lineConstraints.every((constraint) => matchesConstraint(journey, constraint))
    );
  });
  const preferredRoutes = new Set(
    query.lineConstraints
      .filter((constraint) => constraint._tag === "Prefer")
      .map((constraint) => constraint.routeId),
  );
  return [...constrained].sort((left, right) => {
    const preferred = (journey: Journey) =>
      transitLegs(journey).some((leg) => preferredRoutes.has(leg.routeId)) ? 0 : 1;
    return preferred(left) - preferred(right) || left.minutes - right.minutes;
  });
};

export const fixturePassengerAdapter: PassengerRoutingAdapter = {
  search: async (query) => searchFixtureJourneys(query),
};

export const offlineFixtureAdapter: PassengerRoutingAdapter = {
  search: async () => Promise.reject(new Error("The route service is unreachable.")),
};
