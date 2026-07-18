import { readFile, writeFile } from "node:fs/promises";

const routeMapPath = "public/artifacts/bus-transjakarta-20260630-v2.routes-v1.geojson";
const networkSnapshotPath = "public/artifacts/bus-transjakarta-20260630-v2.network.json";
const placesManifestPath = "public/artifacts/places/active.json";

const manifest = JSON.parse(await readFile(placesManifestPath, "utf8"));
const placesPath = new URL(
  manifest.artifactUrl,
  new URL(`file://${process.cwd()}/${placesManifestPath}`),
);
const places = JSON.parse(await readFile(placesPath, "utf8"));
const routeMap = JSON.parse(await readFile(routeMapPath, "utf8"));
const snapshot = JSON.parse(await readFile(networkSnapshotPath, "utf8"));

const stopsById = new Map(snapshot.stops.map((stop) => [stop.id, stop]));
const parentStopIds = new Set(
  snapshot.stops.map((stop) => stop.parentStopId).filter((id) => id !== undefined),
);
const transitPlaceIdForStop = (stopId) => {
  const stop = stopsById.get(stopId);
  if (stop === undefined) throw new Error(`Route-map stop ${stopId} is absent from the snapshot`);
  const sourceParentId = stop.parentStopId ?? (parentStopIds.has(stop.id) ? stop.id : undefined);
  return sourceParentId === undefined
    ? `place:standalone:${stop.id}`
    : `place:source:${sourceParentId}`;
};

const geographicEntries = places.places.map((place) => ({
  placeId: place.id,
  displayLabel: place.primaryName,
  aliases: place.aliases,
  disambiguatingContext: [place.locality?.adminDistrict, place.locality?.municipality]
    .filter(Boolean)
    .join(" · "),
  resultKind: place._tag === "TransitPlaceReference" ? "TransitPlace" : place._tag,
  representativeLocation: place.representativeLocation,
  ...(place.bounds === undefined ? {} : { bounds: place.bounds }),
  ...(place.transitPlaceId === undefined ? {} : { transitPlaceId: place.transitPlaceId }),
}));

const stopEntries = routeMap.features
  .filter((feature) => feature.properties?.kind === "stop" && feature.geometry?.type === "Point")
  .map((feature) => {
    const transitPlaceId = transitPlaceIdForStop(feature.properties.id);
    return {
      placeId: `place:transit-ref:${transitPlaceId}`,
      displayLabel: feature.properties.name,
      aliases: [],
      disambiguatingContext: `Halte bus · ${feature.properties.area ?? "Jakarta"}`,
      resultKind: "TransitPlace",
      transitPlaceId,
      representativeLocation: {
        _tag: "Placed",
        latitude: feature.geometry.coordinates[1],
        longitude: feature.geometry.coordinates[0],
      },
    };
  });

const byIdentity = new Map();
for (const entry of [...geographicEntries, ...stopEntries]) {
  const location = entry.representativeLocation;
  const key = `${entry.displayLabel.toLocaleLowerCase("id-ID")}|${location.latitude.toFixed(5)}|${location.longitude.toFixed(5)}`;
  if (!byIdentity.has(key)) byIdentity.set(key, entry);
}

const output = {
  schemaVersion: "1",
  placesArtifactVersion: manifest.version,
  networkArtifactVersion: manifest.networkArtifactVersion,
  entries: [...byIdentity.values()].sort(
    (left, right) =>
      left.displayLabel.localeCompare(right.displayLabel, "id-ID") ||
      left.placeId.localeCompare(right.placeId),
  ),
};

await writeFile(
  "public/artifacts/places/offline-search-20260718-v2.json",
  `${JSON.stringify(output)}\n`,
);
console.log(`Wrote ${output.entries.length} offline-search entries.`);
