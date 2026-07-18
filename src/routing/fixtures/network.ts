const stop = (id: string) => ({
  id,
  sourceRefs: [],
  name: id,
  location: { _tag: "Placed", latitude: -6.2, longitude: 106.8 },
  locationKind: "Stop",
  wheelchairBoarding: "Unknown",
});

const route = (id: string) => ({
  id,
  agencyId: "agency:test",
  sourceRefs: [],
  mode: "Bus",
  shortName: id,
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
  serviceId: string,
  times: ReadonlyArray<readonly [string, number, number]>,
  frequencyWindows: ReadonlyArray<{
    readonly startSeconds: number;
    readonly endSeconds: number;
    readonly headwaySeconds: number;
    readonly exactTimes: boolean;
  }> = [],
) => ({
  id,
  patternId,
  serviceId,
  sourceRefs: [],
  availability: {
    _tag: "Scheduled",
    stopTimes: times.map(([stopId, arrivalSeconds, departureSeconds], sequence) => ({
      stopId,
      sequence,
      arrivalSeconds,
      departureSeconds,
      pickupPolicy: "Normal",
      dropOffPolicy: "Normal",
    })),
    frequencyWindows,
  },
});

export const networkFixture = {
  schemaVersion: "2",
  generatedAt: "2026-07-18T00:00:00.000Z",
  agencies: [
    {
      id: "agency:test",
      sourceRefs: [],
      name: "Test Transit",
      timezone: "Asia/Jakarta",
    },
  ],
  stops: ["A", "B", "C", "D", "E", "F", "G"].map((id) => stop(`stop:${id}`)),
  routes: ["fast", "slow", "feeder", "connector", "frequency", "overnight", "loop"].map((id) =>
    route(`route:${id}`),
  ),
  patterns: [
    pattern("pattern:fast", "route:fast", ["stop:A", "stop:B", "stop:D"]),
    pattern("pattern:slow", "route:slow", ["stop:A", "stop:C", "stop:D"]),
    pattern("pattern:feeder", "route:feeder", ["stop:E", "stop:B"]),
    pattern("pattern:connector", "route:connector", ["stop:B", "stop:F"]),
    pattern("pattern:frequency", "route:frequency", ["stop:C", "stop:G"]),
    pattern("pattern:overnight", "route:overnight", ["stop:A", "stop:G"]),
    pattern("pattern:loop", "route:loop", ["stop:A", "stop:B", "stop:C", "stop:A"]),
  ],
  trips: [
    scheduled("trip:fast", "pattern:fast", "service:weekday", [
      ["stop:A", 28_800, 28_800],
      ["stop:B", 29_400, 29_460],
      ["stop:D", 30_000, 30_000],
    ]),
    scheduled("trip:slow", "pattern:slow", "service:weekday", [
      ["stop:A", 28_800, 28_800],
      ["stop:C", 29_700, 29_760],
      ["stop:D", 30_900, 30_900],
    ]),
    scheduled("trip:feeder", "pattern:feeder", "service:weekday", [
      ["stop:E", 28_500, 28_500],
      ["stop:B", 29_100, 29_100],
    ]),
    scheduled("trip:connector", "pattern:connector", "service:weekday", [
      ["stop:B", 29_200, 29_200],
      ["stop:F", 29_800, 29_800],
    ]),
    scheduled(
      "trip:frequency",
      "pattern:frequency",
      "service:weekday",
      [
        ["stop:C", 0, 0],
        ["stop:G", 600, 600],
      ],
      [{ startSeconds: 28_800, endSeconds: 32_400, headwaySeconds: 600, exactTimes: true }],
    ),
    scheduled("trip:overnight", "pattern:overnight", "service:weekday", [
      ["stop:A", 90_000, 90_000],
      ["stop:G", 91_200, 91_200],
    ]),
    scheduled("trip:loop", "pattern:loop", "service:weekday", [
      ["stop:A", 32_400, 32_400],
      ["stop:B", 32_700, 32_700],
      ["stop:C", 33_000, 33_000],
      ["stop:A", 33_300, 33_300],
    ]),
  ],
  calendars: [
    {
      id: "service:weekday",
      sourceRefs: [],
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      activeWeekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      exceptions: [
        { date: "2026-07-20", operation: "Remove" },
        { date: "2026-07-19", operation: "Add" },
      ],
    },
  ],
  transfers: [
    {
      fromStopId: "stop:B",
      toStopId: "stop:C",
      sourceRefs: [],
      kind: "MinimumTime",
      minimumTransferSeconds: 120,
    },
  ],
};

export const queryFixture = (overrides: Record<string, unknown> = {}) => ({
  origins: [{ stopId: "stop:A", walkSeconds: 0 }],
  destinations: [{ stopId: "stop:D", walkSeconds: 0 }],
  serviceDate: "2026-07-21",
  departureSeconds: 28_700,
  maximumTransfers: 2,
  maximumAccessWalkSeconds: 600,
  maximumTransferWalkSeconds: 300,
  maximumResults: 5,
  lineConstraint: { _tag: "None" },
  ...overrides,
});
