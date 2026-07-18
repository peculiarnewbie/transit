const ROUTE_COUNT = 20;
const STOPS_PER_ROUTE = 10;

export const mediumNetworkSize = {
  routes: ROUTE_COUNT,
  patterns: ROUTE_COUNT,
  trips: ROUTE_COUNT,
  stops: ROUTE_COUNT * STOPS_PER_ROUTE,
};

export const mediumNetworkFixture = {
  schemaVersion: "1",
  generatedAt: "2026-07-18T00:00:00.000Z",
  agencies: [
    {
      id: "agency:benchmark",
      sourceRefs: [],
      name: "Benchmark Transit",
      timezone: "Asia/Jakarta",
    },
  ],
  stops: Array.from({ length: mediumNetworkSize.stops }, (_, index) => ({
    id: `stop:benchmark:${index}`,
    sourceRefs: [],
    name: `Benchmark stop ${index}`,
    location: { _tag: "Placed", latitude: -6.2, longitude: 106.8 },
  })),
  routes: Array.from({ length: ROUTE_COUNT }, (_, routeIndex) => ({
    id: `route:benchmark:${routeIndex}`,
    agencyId: "agency:benchmark",
    sourceRefs: [],
    mode: "Bus",
    shortName: `B${routeIndex}`,
  })),
  patterns: Array.from({ length: ROUTE_COUNT }, (_, routeIndex) => ({
    id: `pattern:benchmark:${routeIndex}`,
    routeId: `route:benchmark:${routeIndex}`,
    sourceRefs: [],
    stopIds: Array.from(
      { length: STOPS_PER_ROUTE },
      (_, stopIndex) => `stop:benchmark:${routeIndex * STOPS_PER_ROUTE + stopIndex}`,
    ),
  })),
  trips: Array.from({ length: ROUTE_COUNT }, (_, routeIndex) => ({
    id: `trip:benchmark:${routeIndex}`,
    patternId: `pattern:benchmark:${routeIndex}`,
    serviceId: "service:benchmark",
    sourceRefs: [],
    availability: {
      _tag: "Scheduled",
      stopTimes: Array.from({ length: STOPS_PER_ROUTE }, (_, stopIndex) => ({
        stopId: `stop:benchmark:${routeIndex * STOPS_PER_ROUTE + stopIndex}`,
        sequence: stopIndex,
        arrivalSeconds: 28_800 + routeIndex * 60 + stopIndex * 180,
        departureSeconds: 28_800 + routeIndex * 60 + stopIndex * 180,
      })),
      frequencyWindows: [],
    },
  })),
  calendars: [
    {
      id: "service:benchmark",
      sourceRefs: [],
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      activeWeekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      exceptions: [],
    },
  ],
  transfers: [],
};

export const mediumQueries = Array.from({ length: 100 }, (_, queryIndex) => {
  const routeIndex = queryIndex % ROUTE_COUNT;
  const firstStop = routeIndex * STOPS_PER_ROUTE;
  return {
    origins: [{ stopId: `stop:benchmark:${firstStop}`, walkSeconds: 0 }],
    destinations: [{ stopId: `stop:benchmark:${firstStop + STOPS_PER_ROUTE - 1}`, walkSeconds: 0 }],
    serviceDate: "2026-07-21",
    departureSeconds: 28_700,
    maximumTransfers: 0,
    maximumAccessWalkSeconds: 0,
    maximumTransferWalkSeconds: 0,
    maximumResults: 1,
    lineConstraint: { _tag: "None" },
  };
});
