# Passenger place artifacts (Plan 014)

Production place search uses a **pinned OSM-derived extract**, compiled offline
into `public/artifacts/places/`. The Worker never calls a live geocoder or the
public Overpass/OSM API.

## License

OpenStreetMap data is available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/).
Attribution: © OpenStreetMap contributors.

## Intermediate extract format

`OsmPlaceExtract` (`src/import/osm-places/raw.ts`) is a normalized JSON document:

- source metadata (date/version, license, attribution, boundary, extraction rules)
- features with OSM type/id, name, aliases, tags, geometry, and locality hints

Raw `.osm.pbf` / shapefiles stay outside Git under `var/places/source/` (gitignored).
Only the normalized extract (or a small fixture) and the compiled artifact are
reviewable data-version changes.

## Build

```bash
# From a pinned extract (never an unrecorded live fetch in CI):
npx tsx scripts/places/compile-places.ts \
  --input var/places/source/jabodetabek-YYYYMMDD.extract.json \
  --version places-jabodetabek-YYYYMMDD-v1 \
  --output public/artifacts/places/places-jabodetabek-YYYYMMDD-v1.json \
  --retrieved-at YYYY-MM-DDT00:00:00.000Z
```

Fixture (CI / unit tests):

```bash
npx tsx scripts/places/compile-places.ts \
  --input test/fixtures/places/jabodetabek-sample.extract.json \
  --version places-jabodetabek-fixture-v1 \
  --output public/artifacts/places/places-jabodetabek-fixture-v1.json \
  --retrieved-at 2026-06-30T00:00:00.000Z
```

Two compiles from the same extract must be byte-identical (enforced in
`src/import/osm-places/compiler.test.ts`).

## Extraction rules (production)

Select named features inside the Jabodetabek bounding box
`(106.38, -6.80, 107.18, -5.95)`:

| Class     | OSM selectors                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Areas     | `place` in suburb, neighbourhood, quarter, city, town, municipality, village; `boundary=administrative` with `admin_level` 5–10                         |
| Landmarks | `shop=mall`, `amenity` in marketplace/university/college/hospital/bus_station, `leisure=stadium`, `railway=station`, `tourism` in attraction/museum/zoo |

Prefer `name` (local) with `name:en` / `alt_name` as aliases. Attach municipality
from reverse-admin tags when present (`addr:city`, `is_in:city`, parent relation
names).

## Updating production data

1. Produce a new pinned extract with a new date stamp and checksum.
2. Compile and commit the artifact + `active.json` + audit counts.
3. Do not change ranking code solely to make one acceptance query green.
