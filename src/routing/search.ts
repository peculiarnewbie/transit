import {
  type FrequencyWindow,
  type RouteId,
  type RoutePattern,
  type ServiceCalendar,
  ServiceDaySeconds,
  type StopId,
  type StopTime,
  type Trip,
} from "../domain/transit/index.js";
import {
  type Itinerary,
  type LineConstraint,
  RoutingPoint,
  type RoutingQuery,
  type TransitLeg,
  WalkLeg,
} from "./model.js";
import type { Interface as RoutingIndexInterface } from "./network-index.js";

interface State {
  readonly stopId: StopId;
  readonly time: number;
  readonly walkingSeconds: number;
  readonly boardings: number;
  readonly legs: ReadonlyArray<Itinerary["legs"][number]>;
  readonly routeIds: ReadonlyArray<RouteId>;
}

interface Destination {
  readonly state: State;
  readonly walkSeconds: number;
}

const compareStates = (left: State, right: State) =>
  left.time - right.time ||
  left.boardings - right.boardings ||
  left.walkingSeconds - right.walkingSeconds ||
  `${left.stopId}|${left.routeIds.join(",")}`.localeCompare(
    `${right.stopId}|${right.routeIds.join(",")}`,
  );

class MinHeap<Value> {
  readonly values: Array<Value> = [];

  constructor(
    values: ReadonlyArray<Value>,
    readonly compare: (left: Value, right: Value) => number,
  ) {
    for (const value of values) this.push(value);
  }

  get length() {
    return this.values.length;
  }

  push(value: Value) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.values[parentIndex];
      if (parent === undefined || this.compare(parent, value) <= 0) break;
      this.values[index] = parent;
      index = parentIndex;
    }
    this.values[index] = value;
  }

  pop(): Value | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (first === undefined || last === undefined || this.values.length === 0) return first;

    let index = 0;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      const left = this.values[leftIndex];
      const right = this.values[rightIndex];
      const childIndex =
        right !== undefined && (left === undefined || this.compare(right, left) < 0)
          ? rightIndex
          : leftIndex;
      const child = this.values[childIndex];
      if (child === undefined || this.compare(last, child) <= 0) break;
      this.values[index] = child;
      index = childIndex;
    }
    this.values[index] = last;
    return first;
  }
}

const weekdayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const parseDate = (date: string): Date => {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

export const isServiceActive = (calendar: ServiceCalendar, serviceDate: string): boolean => {
  const exception = calendar.exceptions.find((candidate) => candidate.date === serviceDate);
  if (exception !== undefined) return exception.operation === "Add";
  if (serviceDate < calendar.startDate || serviceDate > calendar.endDate) return false;
  const weekday = weekdayNames[parseDate(serviceDate).getUTCDay()];
  return weekday !== undefined && calendar.activeWeekdays.includes(weekday);
};

const seconds = (value: number) => ServiceDaySeconds.make(value);

const nextFrequencyDeparture = (
  stopTimes: ReadonlyArray<StopTime>,
  window: FrequencyWindow,
  boardingIndex: number,
  earliestTime: number,
): { readonly departure: number; readonly runStart: number } | undefined => {
  const first = stopTimes[0];
  const boarding = stopTimes[boardingIndex];
  if (first === undefined || boarding === undefined) return undefined;
  const offset = boarding.departureSeconds - first.departureSeconds;
  const earliestRunStart = Math.max(window.startSeconds, earliestTime - offset);
  const steps = Math.max(
    0,
    Math.ceil((earliestRunStart - window.startSeconds) / window.headwaySeconds),
  );
  const runStart = window.startSeconds + steps * window.headwaySeconds;
  if (runStart >= window.endSeconds) return undefined;
  return { departure: runStart + offset, runStart };
};

export const hasBoardableDeparture = (
  pattern: RoutePattern,
  trip: Trip,
  boardingStopId: StopId,
  earliestTime: number,
) => {
  if (trip.availability._tag !== "Scheduled") return false;
  const stopTimes = trip.availability.stopTimes;
  for (let boardingIndex = 0; boardingIndex < pattern.stopIds.length; boardingIndex += 1) {
    if (pattern.stopIds[boardingIndex] !== boardingStopId) continue;
    const boarding = stopTimes[boardingIndex];
    if (boarding === undefined) continue;
    if (trip.availability.frequencyWindows.length === 0) {
      if (boarding.departureSeconds >= earliestTime) return true;
      continue;
    }
    if (
      trip.availability.frequencyWindows.some(
        (window) =>
          nextFrequencyDeparture(stopTimes, window, boardingIndex, earliestTime) !== undefined,
      )
    )
      return true;
  }
  return false;
};

const transitOptions = (
  pattern: RoutePattern,
  trip: Trip,
  boardingStopId: StopId,
  earliestTime: number,
): ReadonlyArray<TransitLeg> => {
  if (trip.availability._tag !== "Scheduled") return [];
  const options: Array<TransitLeg> = [];
  for (let boardingIndex = 0; boardingIndex < pattern.stopIds.length; boardingIndex += 1) {
    if (pattern.stopIds[boardingIndex] !== boardingStopId) continue;
    const boarding = trip.availability.stopTimes[boardingIndex];
    if (boarding === undefined) continue;
    const departures: Array<{ readonly departure: number; readonly shift: number }> = [];
    if (trip.availability.frequencyWindows.length === 0) {
      if (boarding.departureSeconds >= earliestTime)
        departures.push({ departure: boarding.departureSeconds, shift: 0 });
    } else {
      for (const window of trip.availability.frequencyWindows) {
        const next = nextFrequencyDeparture(
          trip.availability.stopTimes,
          window,
          boardingIndex,
          earliestTime,
        );
        const first = trip.availability.stopTimes[0];
        if (next !== undefined && first !== undefined)
          departures.push({
            departure: next.departure,
            shift: next.runStart - first.departureSeconds,
          });
      }
    }
    for (const departure of departures) {
      for (
        let alightingIndex = boardingIndex + 1;
        alightingIndex < pattern.stopIds.length;
        alightingIndex += 1
      ) {
        const alighting = trip.availability.stopTimes[alightingIndex];
        const toStopId = pattern.stopIds[alightingIndex];
        if (alighting === undefined || toStopId === undefined) continue;
        const arrival = alighting.arrivalSeconds + departure.shift;
        if (arrival < departure.departure || arrival > 604_800) continue;
        options.push({
          _tag: "Transit",
          fromStopId: boardingStopId,
          toStopId,
          routeId: pattern.routeId,
          patternId: pattern.id,
          tripId: trip.id,
          departureSeconds: seconds(departure.departure),
          arrivalSeconds: seconds(arrival),
          ...(pattern.geometryId === undefined ? {} : { geometryId: pattern.geometryId }),
        });
      }
    }
  }
  return options;
};

const routeAllowed = (constraint: LineConstraint, routeId: RouteId): boolean =>
  constraint._tag !== "Excluded" || !constraint.routeIds.includes(routeId);

const requiredRoutesPresent = (
  constraint: LineConstraint,
  boardedRouteIds: ReadonlyArray<RouteId>,
): boolean =>
  constraint._tag !== "Required" ||
  constraint.routeIds.every((routeId) => boardedRouteIds.includes(routeId));

const preferencePenalty = (
  constraint: LineConstraint,
  boardedRouteIds: ReadonlyArray<RouteId>,
): number => {
  if (constraint._tag !== "Preferred") return 0;
  return (
    boardedRouteIds.filter((routeId) => !constraint.routeIds.includes(routeId)).length *
    constraint.weight
  );
};

const dominates = (left: State, right: State): boolean =>
  left.time <= right.time &&
  left.walkingSeconds <= right.walkingSeconds &&
  left.boardings <= right.boardings &&
  (left.time < right.time ||
    left.walkingSeconds < right.walkingSeconds ||
    left.boardings < right.boardings);

const equivalent = (left: State, right: State): boolean =>
  left.time === right.time &&
  left.walkingSeconds === right.walkingSeconds &&
  left.boardings === right.boardings;

const routeSequenceKey = (routeIds: ReadonlyArray<RouteId>): string =>
  routeIds.filter((routeId, index) => index === 0 || routeId !== routeIds[index - 1]).join(">");

const stateKey = (state: State): string =>
  `${state.stopId}|first-route:${state.routeIds[0] ?? "walking"}`;

export const search = (
  index: RoutingIndexInterface,
  query: RoutingQuery,
  constraint: LineConstraint = query.lineConstraint,
): ReadonlyArray<Itinerary> => {
  const destinations = new Map(
    query.destinations
      .filter((candidate) => candidate.walkSeconds <= query.maximumAccessWalkSeconds)
      .map((candidate) => [candidate.stopId, candidate.walkSeconds]),
  );
  const queue = new MinHeap<State>(
    query.origins
      .filter(
        (candidate) =>
          candidate.walkSeconds <= query.maximumAccessWalkSeconds &&
          query.departureSeconds + candidate.walkSeconds <= 604_800,
      )
      .map(
        (candidate): State => ({
          stopId: candidate.stopId,
          time: query.departureSeconds + candidate.walkSeconds,
          walkingSeconds: candidate.walkSeconds,
          boardings: 0,
          legs: [
            WalkLeg.make({
              from: RoutingPoint.cases.Origin.make({}),
              to: RoutingPoint.cases.Stop.make({ stopId: candidate.stopId }),
              departureSeconds: query.departureSeconds,
              arrivalSeconds: seconds(query.departureSeconds + candidate.walkSeconds),
              durationSeconds: candidate.walkSeconds,
            }),
          ],
          routeIds: [],
        }),
      ),
    compareStates,
  );
  const labels = new Map<string, Array<State>>();
  const found: Array<Destination> = [];
  const foundRouteSequences = new Set<string>();
  const maximumCandidates = Math.min(query.maximumResults * 4, 32);
  let expansions = 0;

  while (queue.length > 0 && foundRouteSequences.size < maximumCandidates && expansions < 50_000) {
    const state = queue.pop();
    if (state === undefined) break;
    expansions += 1;

    const egress = destinations.get(state.stopId);
    if (
      egress !== undefined &&
      state.boardings > 0 &&
      state.time + egress <= 604_800 &&
      requiredRoutesPresent(constraint, state.routeIds)
    ) {
      const routeSequence = routeSequenceKey(state.routeIds);
      if (!foundRouteSequences.has(routeSequence)) {
        foundRouteSequences.add(routeSequence);
        found.push({ state, walkSeconds: egress });
      }
    }

    const key = stateKey(state);
    const existing = labels.get(key) ?? [];
    if (existing.some((label) => equivalent(label, state) || dominates(label, state))) continue;
    labels.set(key, [...existing.filter((label) => !dominates(state, label)), state].slice(0, 8));

    const transfersUsed = Math.max(0, state.boardings - 1);
    if (transfersUsed < query.maximumTransfers + 1) {
      for (const pattern of index.patternsByStop.get(state.stopId) ?? []) {
        if (!routeAllowed(constraint, pattern.routeId)) continue;
        const nextBoardings = state.boardings + 1;
        if (Math.max(0, nextBoardings - 1) > query.maximumTransfers) continue;
        for (const trip of index.tripsByPattern.get(pattern.id) ?? []) {
          const calendar = index.calendarsById.get(trip.serviceId);
          if (calendar === undefined || !isServiceActive(calendar, query.serviceDate)) continue;
          for (const leg of transitOptions(pattern, trip, state.stopId, state.time)) {
            queue.push({
              stopId: leg.toStopId,
              time: leg.arrivalSeconds,
              walkingSeconds: state.walkingSeconds,
              boardings: nextBoardings,
              legs: [...state.legs, leg],
              routeIds: [...state.routeIds, leg.routeId],
            });
          }
        }
      }
    }

    for (const transfer of index.transfersByStop.get(state.stopId) ?? []) {
      const duration = transfer.minimumTransferSeconds ?? 0;
      if (duration > query.maximumTransferWalkSeconds || state.time + duration > 604_800) continue;
      queue.push({
        stopId: transfer.toStopId,
        time: state.time + duration,
        walkingSeconds: state.walkingSeconds + duration,
        boardings: state.boardings,
        legs: [
          ...state.legs,
          WalkLeg.make({
            from: RoutingPoint.cases.Stop.make({ stopId: state.stopId }),
            to: RoutingPoint.cases.Stop.make({ stopId: transfer.toStopId }),
            departureSeconds: seconds(state.time),
            arrivalSeconds: seconds(state.time + duration),
            durationSeconds: duration,
          }),
        ],
        routeIds: state.routeIds,
      });
    }

    const stop = index.stopsById.get(state.stopId);
    const stationId =
      stop?.parentStopId ??
      (index.childStopIdsByParent.has(state.stopId) ? state.stopId : undefined);
    if (stationId !== undefined) {
      for (const stationStopId of [
        stationId,
        ...(index.childStopIdsByParent.get(stationId) ?? []),
      ]) {
        if (stationStopId === state.stopId) continue;
        queue.push({ ...state, stopId: stationStopId });
      }
    }
  }

  const itineraries = found
    .filter(({ state }) => requiredRoutesPresent(constraint, state.routeIds))
    .map(({ state, walkSeconds }) => {
      const arrival = state.time + walkSeconds;
      const penalty = preferencePenalty(constraint, state.routeIds);
      const walking = state.walkingSeconds + walkSeconds;
      const transfers = Math.max(0, state.boardings - 1);
      const legs = [
        ...state.legs,
        WalkLeg.make({
          from: RoutingPoint.cases.Stop.make({ stopId: state.stopId }),
          to: RoutingPoint.cases.Destination.make({}),
          departureSeconds: seconds(state.time),
          arrivalSeconds: seconds(arrival),
          durationSeconds: walkSeconds,
        }),
      ];
      return {
        legs,
        boardedRouteIds: state.routeIds,
        departureSeconds: query.departureSeconds,
        arrivalSeconds: seconds(arrival),
        transferCount: transfers,
        walkingSeconds: walking,
        score: {
          arrivalSeconds: seconds(arrival),
          transferCount: transfers,
          walkingSeconds: walking,
          preferencePenalty: penalty,
          total: arrival + transfers * 900 + walking * 2 + penalty,
        },
      } satisfies Itinerary;
    })
    .sort(
      (left, right) =>
        left.score.total - right.score.total ||
        left.arrivalSeconds - right.arrivalSeconds ||
        left.boardedRouteIds.join(",").localeCompare(right.boardedRouteIds.join(",")),
    );

  const unique = new Map<string, Itinerary>();
  for (const itinerary of itineraries) {
    const key = routeSequenceKey(itinerary.boardedRouteIds);
    if (!unique.has(key)) unique.set(key, itinerary);
  }
  return [...unique.values()].slice(0, query.maximumResults);
};
