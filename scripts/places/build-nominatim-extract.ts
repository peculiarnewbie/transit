#!/usr/bin/env npx tsx
/**
 * One-shot builder: resolve a pinned query list via Nominatim into OsmPlaceExtract.
 * Respects Nominatim usage policy (1 req/s, identifying User-Agent).
 * Output is a reviewable data version — not used at runtime.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const UA = "TransitJakartaHelper/0.1 (offline place extract builder; peculiarnewbie@gmail.com)";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const queriesPath = process.argv[2] ?? "var/places/source/nominatim-queries.json";
const outputPath = process.argv[3] ?? "var/places/source/jabodetabek-20260718.extract.json";

type Query = { readonly name: string; readonly placeType: string; readonly locality: string };

const queries = JSON.parse(readFileSync(queriesPath, "utf8")) as Query[];

const features: Array<Record<string, unknown>> = [];
const seen = new Set<string>();

const municipalityHint = (locality: string) => {
  if (
    locality.startsWith("Jakarta") ||
    locality === "Bekasi" ||
    locality === "Depok" ||
    locality === "Tangerang" ||
    locality === "Bogor"
  ) {
    return locality;
  }
  if (locality === "EdgeNetwork") return "Depok";
  return "Jabodetabek";
};

for (const [index, query] of queries.entries()) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set(
    "q",
    `${query.name}, ${query.locality === "EdgeNetwork" ? "Jabodetabek" : query.locality}`,
  );
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "3");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("viewbox", "106.38,-5.95,107.18,-6.80");
  url.searchParams.set("bounded", "0");

  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!response.ok) {
    console.error(`HTTP ${response.status} for ${query.name}`);
    await sleep(1100);
    continue;
  }
  const rows = (await response.json()) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const osmType = String(row.osm_type ?? "");
    const osmId = Number(row.osm_id);
    if (!["node", "way", "relation"].includes(osmType) || !Number.isFinite(osmId)) continue;
    const key = `${osmType}:${osmId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const address = (row.address ?? {}) as Record<string, string>;
    const clazz = String(row.class ?? "");
    const type = String(row.type ?? "");
    const tags: Record<string, string> = { name: String(row.name ?? query.name) };
    if (clazz === "place") tags.place = type;
    else if (clazz === "amenity") tags.amenity = type;
    else if (clazz === "shop") tags.shop = type;
    else if (clazz === "railway") tags.railway = type;
    else if (clazz === "tourism") tags.tourism = type;
    else if (clazz === "leisure") tags.leisure = type;
    else if (clazz === "historic") {
      tags.tourism = "attraction";
      tags.historic = type;
    } else if (query.placeType === "Area") {
      tags.place = "suburb";
    } else {
      tags.tourism = "attraction";
    }

    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    features.push({
      osmType,
      osmId,
      name: String(row.name ?? query.name),
      altNames: query.name !== row.name ? [query.name] : [],
      tags,
      geometry: { _tag: "Point", longitude: lon, latitude: lat },
      municipality:
        address.city ??
        address.town ??
        address.municipality ??
        address.state ??
        municipalityHint(query.locality),
      ...(address.suburb !== undefined ? { adminDistrict: address.suburb } : {}),
      ...(address.neighbourhood !== undefined ? { neighbourhood: address.neighbourhood } : {}),
    });
  }
  console.error(
    `[${index + 1}/${queries.length}] ${query.name} → +${rows.length} (features ${features.length})`,
  );
  await sleep(1100);
}

const extract = {
  schemaVersion: "1",
  sourceName: "nominatim-osm-jabodetabek",
  sourceDateOrVersion: "2026-07-18",
  license: "ODbL-1.0",
  attribution: "© OpenStreetMap contributors",
  boundaryDescription: "Jabodetabek viewbox 106.38,-6.80,107.18,-5.95 via Nominatim search",
  extractionRules:
    "Nominatim search for Plan 014 seed query list; tags inferred from Nominatim class/type; historic→tourism=attraction",
  features,
};

mkdirSync(dirname(outputPath), { recursive: true });
const body = `${JSON.stringify(extract, null, 2)}\n`;
writeFileSync(outputPath, body);
const checksum = createHash("sha256").update(body).digest("hex");
writeFileSync(`${outputPath}.sha256`, `${checksum}\n`);
console.log(JSON.stringify({ outputPath, featureCount: features.length, checksum }, null, 2));
