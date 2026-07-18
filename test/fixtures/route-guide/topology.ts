/** Topology fixtures for Plan 015 route-guide graph and search tests. */

const stop = (
  id: string,
  name: string,
  opts: {
    parentStopId?: string;
    platformCode?: string;
    locationKind?: "Stop" | "Station";
    latitude?: number;
    longitude?: number;
  } = {},
) => ({
  id,
  sourceRefs: [],
  name,
  location: {
    _tag: "Placed" as const,
    latitude: opts.latitude ?? -6.2,
    longitude: opts.longitude ?? 106.8,
  },
  locationKind: opts.locationKind ?? ("Stop" as const),
  wheelchairBoarding: "Unknown" as const,
  ...(opts.parentStopId === undefined ? {} : { parentStopId: opts.parentStopId }),
  ...(opts.platformCode === undefined ? {} : { platformCode: opts.platformCode }),
});

const route = (id: string, shortName: string) => ({
  id,
  agencyId: "agency:test",
  sourceRefs: [],
  mode: "Bus" as const,
  shortName,
});

const pattern = (id: string, routeId: string, stopIds: ReadonlyArray<string>) => ({
  id,
  routeId,
  sourceRefs: [],
  stopIds,
});

const scheduled = (
  id: string,
  patternId: string,
  stopIds: ReadonlyArray<string>,
  headsign: string,
  policies?: ReadonlyArray<{ pickup: string; dropOff: string }>,
) => ({
  id,
  patternId,
  serviceId: "service:1",
  sourceRefs: [],
  headsign,
  availability: {
    _tag: "Scheduled" as const,
    stopTimes: stopIds.map((stopId, sequence) => ({
      stopId,
      sequence,
      arrivalSeconds: sequence * 60,
      departureSeconds: sequence * 60,
      pickupPolicy: policies?.[sequence]?.pickup ?? "Normal",
      dropOffPolicy: policies?.[sequence]?.dropOff ?? "Normal",
    })),
    frequencyWindows: [],
  },
});

export const topologyNetwork = {
  schemaVersion: "2" as const,
  generatedAt: "2026-07-18T00:00:00.000Z",
  agencies: [
    {
      id: "agency:test",
      sourceRefs: [],
      name: "Test Transit",
      timezone: "Asia/Jakarta",
    },
  ],
  stops: [
    stop("stop:A", "Alpha"),
    stop("stop:B", "Bravo"),
    stop("stop:C", "Charlie"),
    stop("stop:D", "Delta"),
    stop("stop:E", "Echo"),
    stop("stop:F", "Foxtrot"),
    stop("stop:G", "Golf"),
    stop("stop:H", "Hotel"),
    stop("stop:station", "Central Station", { locationKind: "Station" }),
    stop("stop:plat-1", "Central Platform 1", {
      parentStopId: "stop:station",
      platformCode: "1",
    }),
    stop("stop:plat-2", "Central Platform 2", {
      parentStopId: "stop:station",
      platformCode: "2",
    }),
    stop("stop:loop-a", "Loop A"),
    stop("stop:loop-b", "Loop B"),
    stop("stop:loop-c", "Loop C"),
    stop("stop:forbid-board", "No Board"),
    stop("stop:forbid-alight", "No Alight"),
    stop("stop:group-x", "Grouped X", { latitude: -6.21, longitude: 106.81 }),
    stop("stop:group-y", "Grouped Y", { latitude: -6.2101, longitude: 106.8101 }),
    stop("stop:named-transfer-a", "Transfer Gate North"),
    stop("stop:named-transfer-b", "Transfer Gate South"),
    stop("stop:cawang", "Cawang"),
    stop("stop:grogol", "Grogol Reformasi"),
    stop("stop:mid-9", "Semanggi"),
    stop("stop:lookalike-station", "Lookalike Station", { locationKind: "Station" }),
    stop("stop:lookalike-a1", "Lookalike A", {
      parentStopId: "stop:lookalike-station",
      platformCode: "A1",
    }),
    stop("stop:lookalike-a2", "Lookalike A", {
      parentStopId: "stop:lookalike-station",
      platformCode: "A2",
    }),
    stop("stop:lookalike-b", "Lookalike B"),
    stop("stop:lookalike-c", "Lookalike C"),
  ],
  routes: [
    route("route:1", "1"),
    route("route:2", "2"),
    route("route:9", "9"),
    route("route:9A", "9A"),
    route("route:branch", "B"),
    route("route:loop", "L"),
    route("route:forbid", "F"),
    route("route:look-1", "L1"),
    route("route:look-2", "L2"),
    route("route:dup", "D"),
  ],
  patterns: [
    // Direct Alpha → Delta via Bravo, Charlie
    pattern("pattern:1", "route:1", ["stop:A", "stop:B", "stop:C", "stop:D"]),
    // Reverse
    pattern("pattern:1-rev", "route:1", ["stop:D", "stop:C", "stop:B", "stop:A"]),
    // Connector for transfer at Charlie
    pattern("pattern:2", "route:2", ["stop:C", "stop:E", "stop:F"]),
    // Branch: same corridor then diverge
    pattern("pattern:branch-main", "route:branch", ["stop:A", "stop:B", "stop:G"]),
    pattern("pattern:branch-side", "route:branch", ["stop:A", "stop:B", "stop:H"]),
    // Loop
    pattern("pattern:loop", "route:loop", [
      "stop:loop-a",
      "stop:loop-b",
      "stop:loop-c",
      "stop:loop-a",
    ]),
    // Forbidden pickup at first usable, forbidden drop at end
    pattern("pattern:forbid", "route:forbid", [
      "stop:forbid-board",
      "stop:B",
      "stop:forbid-alight",
    ]),
    // Parent/platform detail
    pattern("pattern:plat-in", "route:2", ["stop:plat-1", "stop:E"]),
    pattern("pattern:plat-out", "route:1", ["stop:A", "stop:plat-2"]),
    // Explicit differently named transfer endpoints
    pattern("pattern:named-a", "route:1", ["stop:A", "stop:named-transfer-a"]),
    pattern("pattern:named-b", "route:2", ["stop:named-transfer-b", "stop:F"]),
    // 9 / 9A interchangeable corridor
    pattern("pattern:9", "route:9", ["stop:cawang", "stop:mid-9", "stop:grogol"]),
    pattern("pattern:9A", "route:9A", ["stop:cawang", "stop:mid-9", "stop:grogol"]),
    // Lookalike lines: same corridor but different boarding platforms
    pattern("pattern:look-1", "route:look-1", [
      "stop:lookalike-a1",
      "stop:lookalike-b",
      "stop:lookalike-c",
    ]),
    pattern("pattern:look-2", "route:look-2", [
      "stop:lookalike-a2",
      "stop:lookalike-b",
      "stop:lookalike-c",
    ]),
    // Duplicate scheduled trips sharing sequence
    pattern("pattern:dup-a", "route:dup", ["stop:A", "stop:B", "stop:D"]),
    pattern("pattern:dup-b", "route:dup", ["stop:A", "stop:B", "stop:D"]),
    // Grouped-but-not-transferable (no parent, separate places unless override)
    pattern("pattern:group-x", "route:1", ["stop:group-x", "stop:A"]),
    pattern("pattern:group-y", "route:2", ["stop:group-y", "stop:F"]),
  ],
  trips: [
    scheduled("trip:1", "pattern:1", ["stop:A", "stop:B", "stop:C", "stop:D"], "Delta"),
    scheduled("trip:1b", "pattern:1", ["stop:A", "stop:B", "stop:C", "stop:D"], "Delta"),
    scheduled("trip:1-rev", "pattern:1-rev", ["stop:D", "stop:C", "stop:B", "stop:A"], "Alpha"),
    scheduled("trip:2", "pattern:2", ["stop:C", "stop:E", "stop:F"], "Foxtrot"),
    scheduled("trip:branch-main", "pattern:branch-main", ["stop:A", "stop:B", "stop:G"], "Golf"),
    scheduled(
      "trip:branch-side",
      "pattern:branch-side",
      ["stop:A", "stop:B", "stop:H"],
      "Hotel Side",
    ),
    scheduled(
      "trip:loop",
      "pattern:loop",
      ["stop:loop-a", "stop:loop-b", "stop:loop-c", "stop:loop-a"],
      "Loop",
    ),
    scheduled(
      "trip:forbid",
      "pattern:forbid",
      ["stop:forbid-board", "stop:B", "stop:forbid-alight"],
      "Forbidden",
      [
        { pickup: "Forbidden", dropOff: "Forbidden" },
        { pickup: "Normal", dropOff: "Normal" },
        { pickup: "Forbidden", dropOff: "Forbidden" },
      ],
    ),
    scheduled("trip:plat-in", "pattern:plat-in", ["stop:plat-1", "stop:E"], "Echo"),
    scheduled("trip:plat-out", "pattern:plat-out", ["stop:A", "stop:plat-2"], "Central"),
    scheduled(
      "trip:named-a",
      "pattern:named-a",
      ["stop:A", "stop:named-transfer-a"],
      "Transfer Gate North",
    ),
    scheduled("trip:named-b", "pattern:named-b", ["stop:named-transfer-b", "stop:F"], "Foxtrot"),
    scheduled("trip:9", "pattern:9", ["stop:cawang", "stop:mid-9", "stop:grogol"], "Pluit"),
    scheduled(
      "trip:9A",
      "pattern:9A",
      ["stop:cawang", "stop:mid-9", "stop:grogol"],
      "Grogol Reformasi",
    ),
    scheduled(
      "trip:look-1",
      "pattern:look-1",
      ["stop:lookalike-a1", "stop:lookalike-b", "stop:lookalike-c"],
      "Look C via L1",
    ),
    scheduled(
      "trip:look-2",
      "pattern:look-2",
      ["stop:lookalike-a2", "stop:lookalike-b", "stop:lookalike-c"],
      "Look C via L2",
    ),
    scheduled("trip:dup-a", "pattern:dup-a", ["stop:A", "stop:B", "stop:D"], "Delta Dup"),
    scheduled("trip:dup-b", "pattern:dup-b", ["stop:A", "stop:B", "stop:D"], "Delta Dup"),
    scheduled("trip:group-x", "pattern:group-x", ["stop:group-x", "stop:A"], "Alpha"),
    scheduled("trip:group-y", "pattern:group-y", ["stop:group-y", "stop:F"], "Foxtrot"),
  ],
  calendars: [
    {
      id: "service:1",
      sourceRefs: [],
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      activeWeekdays: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ],
      exceptions: [],
    },
  ],
  transfers: [
    {
      fromStopId: "stop:named-transfer-a",
      toStopId: "stop:named-transfer-b",
      sourceRefs: [],
      kind: "Recommended" as const,
    },
  ],
};

export const reviewedComplexOverride = {
  schemaVersion: "1" as const,
  sourceArtifactVersion: "fixture-topology-v1",
  overrides: [
    {
      id: "override:grouped-xy",
      sourceArtifactVersion: "fixture-topology-v1",
      memberStopIds: ["stop:group-x", "stop:group-y"],
      primaryName: "Grouped Complex",
      aliases: [],
      rationale: "Nearby stops grouped for display only; not a transfer proof",
      reviewer: "plan-015",
      reviewedAt: "2026-07-18",
    },
  ],
};
