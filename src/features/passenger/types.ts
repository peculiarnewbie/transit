import type { RouteId } from "../../domain/transit/index.js";
import type {
  Coordinate,
  Journey,
  LockedLeg,
  StopSuggestion,
  TransitJourneyLeg,
  WalkJourneyLeg,
} from "../../runtime/api-contracts.js";

export type { Coordinate, Journey, LockedLeg, StopSuggestion };

export type JourneyEndpoint =
  | { readonly _tag: "Stop"; readonly stop: StopSuggestion }
  | { readonly _tag: "MapPoint"; readonly coordinate: Coordinate; readonly label: string };

export type LineConstraint =
  | { readonly _tag: "Exclude"; readonly routeId: RouteId }
  | { readonly _tag: "Prefer"; readonly routeId: RouteId }
  | { readonly _tag: "Require"; readonly routeId: RouteId };

export interface RouteQuery {
  readonly origin: JourneyEndpoint;
  readonly destination: JourneyEndpoint;
  readonly lineConstraints: ReadonlyArray<LineConstraint>;
  readonly lockedLeg?: LockedLeg;
}

export type TransitLeg = TransitJourneyLeg;
export type WalkLeg = WalkJourneyLeg;
export type JourneyLeg = TransitLeg | WalkLeg;

export interface PassengerRoutingAdapter {
  readonly search: (
    query: RouteQuery,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<ReadonlyArray<Journey>>;
  readonly searchStops?: (
    query?: string,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<ReadonlyArray<StopSuggestion>>;
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
