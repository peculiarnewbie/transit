import type { ScheduleRow, Station } from "./raw.js";

export interface ObservedStop extends ScheduleRow {
  readonly stationId: string;
}

export interface InferredTopology {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly stationIds: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
}

const secondsSinceMidnight = (value: string): number => {
  const [hours = 0, minutes = 0, seconds = 0] = value.split(":").map(Number);
  return hours * 3_600 + minutes * 60 + seconds;
};

const sortRun = (stops: ReadonlyArray<ObservedStop>): ReadonlyArray<ObservedStop> => {
  const sorted = [...stops].sort(
    (left, right) => secondsSinceMidnight(left.time_est) - secondsSinceMidnight(right.time_est),
  );
  if (sorted.length < 2) return sorted;
  let largestGap = -1;
  let boundary = 0;
  for (let index = 0; index < sorted.length; index++) {
    const currentStop = sorted[index];
    const nextStop = sorted[(index + 1) % sorted.length];
    if (currentStop === undefined || nextStop === undefined) continue;
    const current = secondsSinceMidnight(currentStop.time_est);
    const next = secondsSinceMidnight(nextStop.time_est);
    const gap = (next - current + 86_400) % 86_400;
    if (gap > largestGap) {
      largestGap = gap;
      boundary = (index + 1) % sorted.length;
    }
  }
  return [...sorted.slice(boundary), ...sorted.slice(0, boundary)];
};

const normalizedName = (value: string): string =>
  value.toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/g, "");

const repairKnownGaps = (topology: InferredTopology): InferredTopology => {
  if (topology.label !== "COMMUTER LINE TANGERANG" || topology.stationIds.includes("GGL"))
    return topology;
  const duri = topology.stationIds.indexOf("DU");
  const pesing = topology.stationIds.indexOf("PSG");
  if (duri === -1 || pesing === -1) return topology;
  const insertAt = duri < pesing ? duri + 1 : duri;
  return {
    ...topology,
    stationIds: [
      ...topology.stationIds.slice(0, insertAt),
      "GGL",
      ...topology.stationIds.slice(insertAt),
    ],
    notes: [
      ...topology.notes,
      "Inserted GGL between DU and PSG: official KCI schedules currently omit Grogol calls.",
    ],
  };
};

/** Reconstruct ordered calls per train; never derive topology from alphabetic station lists. */
export const inferTopologies = (
  stops: ReadonlyArray<ObservedStop>,
  stations: ReadonlyArray<Station>,
): ReadonlyArray<InferredTopology> => {
  const stationIdsByName = new Map(
    stations.map((station) => [normalizedName(station.sta_name), station.sta_id]),
  );
  const routes = new Map<
    string,
    { label: string; color: string; runs: Map<string, Array<ObservedStop>> }
  >();
  for (const stop of stops) {
    const key = `${stop.route_name}|${stop.ka_name}|${stop.color}`;
    const entry = routes.get(key) ?? { label: stop.ka_name, color: stop.color, runs: new Map() };
    const run = entry.runs.get(stop.train_id) ?? [];
    run.push(stop);
    entry.runs.set(stop.train_id, run);
    routes.set(key, entry);
  }

  return [...routes.entries()]
    .flatMap(([id, entry]) => {
      const candidates = [...entry.runs.values()]
        .map((run) => {
          const ordered = sortRun(run);
          const stationIds = [...new Set(ordered.map((stop) => stop.stationId))];
          const terminal = ordered
            .map((stop) => stationIdsByName.get(normalizedName(stop.dest)))
            .find((stationId): stationId is string => stationId !== undefined);
          return terminal !== undefined && !stationIds.includes(terminal)
            ? [...stationIds, terminal]
            : stationIds;
        })
        .sort(
          (left, right) =>
            right.length - left.length || left.join("|").localeCompare(right.join("|")),
        );
      const stationIds = candidates[0];
      return stationIds === undefined || stationIds.length === 0
        ? []
        : [repairKnownGaps({ id, label: entry.label, color: entry.color, stationIds, notes: [] })];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
};
