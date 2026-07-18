import type { RouteId, StopId } from "../../domain/transit/index.js";

export interface Coordinate {
  readonly longitude: number;
  readonly latitude: number;
}

export interface StopSuggestion {
  readonly id: StopId;
  readonly name: string;
  readonly area: string;
  readonly coordinate: Coordinate;
}

export type JourneyEndpoint =
  | { readonly _tag: "Stop"; readonly stop: StopSuggestion }
  | { readonly _tag: "MapPoint"; readonly coordinate: Coordinate; readonly label: string };

export type LineConstraint =
  | { readonly _tag: "Exclude"; readonly routeId: RouteId }
  | { readonly _tag: "Prefer"; readonly routeId: RouteId }
  | { readonly _tag: "Require"; readonly routeId: RouteId };

export interface LockedLeg {
  readonly journeyId: string;
  readonly legIndex: number;
  readonly routeId: RouteId;
}

export interface RouteQuery {
  readonly origin: JourneyEndpoint;
  readonly destination: JourneyEndpoint;
  readonly lineConstraints: ReadonlyArray<LineConstraint>;
  readonly lockedLeg?: LockedLeg;
}

export interface TransitLeg {
  readonly _tag: "Transit";
  readonly routeId: RouteId;
  readonly line: string;
  readonly from: string;
  readonly to: string;
  readonly minutes: number;
  readonly stops: number;
  readonly tone: "red" | "blue" | "yellow" | "green";
}

export interface WalkLeg {
  readonly _tag: "Walk";
  readonly from: string;
  readonly to: string;
  readonly minutes: number;
  readonly meters: number;
}

export type JourneyLeg = TransitLeg | WalkLeg;

export interface Journey {
  readonly id: string;
  readonly label: string;
  readonly minutes: number;
  readonly walkingMinutes: number;
  readonly transfers: number;
  readonly legs: ReadonlyArray<JourneyLeg>;
}

export interface PassengerRoutingAdapter {
  readonly search: (query: RouteQuery) => Promise<ReadonlyArray<Journey>>;
}

export type EndpointKind = "origin" | "destination";

export type PassengerState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "ChoosingEndpoint"; readonly endpoint: EndpointKind }
  | { readonly _tag: "Searching"; readonly query: RouteQuery }
  | {
      readonly _tag: "Results";
      readonly query: RouteQuery;
      readonly journeys: ReadonlyArray<Journey>;
      readonly selectedJourneyId: string;
    }
  | { readonly _tag: "NoRoute"; readonly query: RouteQuery }
  | { readonly _tag: "Failed"; readonly query: RouteQuery; readonly message: string };

export const endpointLabel = (endpoint: JourneyEndpoint): string =>
  endpoint._tag === "Stop" ? endpoint.stop.name : endpoint.label;
