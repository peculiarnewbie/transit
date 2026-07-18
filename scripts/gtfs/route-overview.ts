import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { Effect, Schema } from "effect";

import {
  type GeometrySidecar as GeometrySidecarType,
  GeometrySidecar,
  type NetworkSnapshot as NetworkSnapshotType,
  NetworkSnapshot,
} from "../../src/domain/transit/index.js";

interface CliOptions {
  readonly snapshot: string;
  readonly geometry: string;
  readonly output: string;
}

const usage =
  "Usage: npx tsx scripts/gtfs/route-overview.ts --snapshot <json> --geometry <json> --output <geojson>";

const parseArguments = (arguments_: ReadonlyArray<string>): CliOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--")) throw new Error(usage);
    values.set(key, value);
  }
  const snapshot = values.get("--snapshot");
  const geometry = values.get("--geometry");
  const output = values.get("--output");
  if (snapshot === undefined || geometry === undefined || output === undefined)
    throw new Error(usage);
  return { snapshot, geometry, output };
};

const simplify = (coordinates: ReadonlyArray<readonly [number, number]>) => {
  const first = coordinates[0];
  if (first === undefined) return [];
  const simplified: Array<readonly [number, number]> = [first];
  let previous = first;
  for (const coordinate of coordinates.slice(1, -1)) {
    const longitudeDelta = coordinate[0] - previous[0];
    const latitudeDelta = coordinate[1] - previous[1];
    if (longitudeDelta * longitudeDelta + latitudeDelta * latitudeDelta < 0.00012 ** 2) continue;
    simplified.push(coordinate);
    previous = coordinate;
  }
  const last = coordinates.at(-1);
  if (last !== undefined && (last[0] !== previous[0] || last[1] !== previous[1]))
    simplified.push(last);
  return simplified;
};

const routeColor = (color: string | undefined) =>
  color !== undefined && /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : "#31556f";

export const routeOverviewFeatures = (
  snapshot: NetworkSnapshotType,
  geometry: GeometrySidecarType,
) => {
  const stopsById = new Map(snapshot.stops.map((stop) => [stop.id, stop]));
  const publishedStopIds = new Set(snapshot.patterns.flatMap((pattern) => pattern.stopIds));
  const stopFeatures = new Map<
    string,
    {
      readonly type: "Feature";
      readonly properties: {
        readonly kind: "stop";
        readonly id: string;
        readonly name: string;
        readonly area: string;
      };
      readonly geometry: {
        readonly type: "Point";
        readonly coordinates: readonly [number, number];
      };
    }
  >();
  for (const publishedStopId of publishedStopIds) {
    const platform = stopsById.get(publishedStopId);
    if (platform === undefined) continue;
    const station =
      platform.parentStopId === undefined
        ? platform
        : (stopsById.get(platform.parentStopId) ?? platform);
    if (stopFeatures.has(station.id)) continue;
    const placed = station.location._tag === "Placed" ? station.location : platform.location;
    if (placed._tag !== "Placed") continue;
    stopFeatures.set(station.id, {
      type: "Feature",
      properties: { kind: "stop", id: station.id, name: station.name, area: "Jakarta" },
      geometry: { type: "Point", coordinates: [placed.longitude, placed.latitude] },
    });
  }

  const routesById = new Map(snapshot.routes.map((route) => [route.id, route]));
  const geometryById = new Map(geometry.geometries.map((entry) => [entry.id, entry.coordinates]));
  const seen = new Set<string>();
  const routeFeatures = snapshot.patterns.flatMap((pattern) => {
    if (pattern.geometryId === undefined) return [];
    const key = `${pattern.routeId}|${pattern.geometryId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const coordinates = simplify(geometryById.get(pattern.geometryId) ?? []);
    const route = routesById.get(pattern.routeId);
    if (route === undefined || coordinates.length < 2) return [];
    return [
      {
        type: "Feature" as const,
        properties: {
          kind: "route" as const,
          routeId: route.id,
          line: route.shortName || route.longName || route.id,
          name: route.longName ?? route.shortName ?? route.id,
          color: routeColor(route.color),
        },
        geometry: { type: "LineString" as const, coordinates },
      },
    ];
  });
  return [...routeFeatures, ...stopFeatures.values()];
};

export const buildRouteOverview = Effect.fn("Gtfs.buildRouteOverview")(function* (
  options: CliOptions,
) {
  const [snapshotText, geometryText] = yield* Effect.promise(() =>
    Promise.all([readFile(options.snapshot, "utf8"), readFile(options.geometry, "utf8")]),
  );
  const snapshot = yield* Schema.decodeUnknownEffect(NetworkSnapshot)(JSON.parse(snapshotText));
  const geometry = yield* Schema.decodeUnknownEffect(GeometrySidecar)(JSON.parse(geometryText));
  const features = routeOverviewFeatures(snapshot, geometry);
  const output = `${JSON.stringify({ type: "FeatureCollection", features })}\n`;
  yield* Effect.promise(() => writeFile(options.output, output));
  return {
    routes: snapshot.routes.length,
    features: features.length,
    stops: features.filter((feature) => feature.geometry.type === "Point").length,
    bytes: output.length,
  };
});

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  Effect.runPromise(buildRouteOverview(parseArguments(process.argv.slice(2))))
    .then((summary) => console.log(JSON.stringify(summary)))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
