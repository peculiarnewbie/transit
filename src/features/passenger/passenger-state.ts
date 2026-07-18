import type { RouteId } from "../../domain/transit/index.js";
import type {
  Journey,
  LineConstraint,
  LockedLeg,
  PassengerRoutingAdapter,
  PassengerState,
  RouteQuery,
} from "./types.js";

export const describePassengerState = (state: PassengerState): string => {
  switch (state._tag) {
    case "Idle":
      return "Choose where to start";
    case "ChoosingEndpoint":
      return `Choose ${state.endpoint}`;
    case "Searching":
      return "Finding routes";
    case "Results":
      return `${state.journeys.length} routes found`;
    case "NoRoute":
      return "No route found";
    case "Failed":
      return state.message;
  }
};

export const setLineConstraint = ({
  query,
  routeId,
  constraint,
}: {
  readonly query: RouteQuery;
  readonly routeId: RouteId;
  readonly constraint: LineConstraint["_tag"];
}): RouteQuery => ({
  ...query,
  lineConstraints: [
    ...query.lineConstraints.filter((entry) => entry.routeId !== routeId),
    { _tag: constraint, routeId },
  ],
});

export const setLockedLeg = ({
  query,
  lockedLeg,
}: {
  query: RouteQuery;
  lockedLeg: LockedLeg;
}): RouteQuery => ({
  ...query,
  lockedLeg,
});

export const runPassengerSearch = async ({
  adapter,
  query,
  onState,
}: {
  readonly adapter: PassengerRoutingAdapter;
  readonly query: RouteQuery;
  readonly onState: (state: PassengerState) => void;
}): Promise<void> => {
  onState({ _tag: "Searching", query });
  try {
    const journeys = await adapter.search(query);
    onState(toResultState(query, journeys));
  } catch (error) {
    onState({
      _tag: "Failed",
      query,
      message: error instanceof Error ? error.message : "Routes could not be loaded.",
    });
  }
};

const toResultState = (query: RouteQuery, journeys: ReadonlyArray<Journey>): PassengerState =>
  journeys.length === 0
    ? { _tag: "NoRoute", query }
    : { _tag: "Results", query, journeys, selectedJourneyId: journeys[0].id };
