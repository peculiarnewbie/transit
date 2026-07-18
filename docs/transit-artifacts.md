# Transit artifact publication

The journey runtime reads a small activation manifest, then loads the exact
versioned topology and geometry files named by that manifest. Both files must
share the same `generatedAt` value. Runtime acquisition fails before serving
queries if either file is missing, malformed, or from a different compilation
run.

## Local compile and validation

Compile the source ZIP outside `public/` so raw provider data can never enter a
client build:

```bash
npx tsx scripts/gtfs/compile.ts \
  --input var/transit/source/transjakarta.zip \
  --output var/transit/compiled/network.json \
  --generated-at 2026-07-18T00:00:00.000Z
```

The compiler validates the canonical snapshot and writes both `network.json`
and `network.geometry.json`. Generate the compact map overlay separately so the
browser never needs the full topology artifact:

```bash
npx tsx scripts/gtfs/route-overview.ts \
  --snapshot var/transit/compiled/network.json \
  --geometry var/transit/compiled/network.geometry.json \
  --output var/transit/compiled/network.routes.geojson
```

Run the routing and runtime acceptance tests before publishing:

```bash
npm test -- src/import/gtfs src/routing src/runtime
```

## Publish and activate

1. Give the validated pair a never-reused version name, preferably including
   the compiler's reported SHA-256 content hash.
2. Copy all three files to `public/artifacts/` under that version. Do not overwrite a
   previously published version.
3. Update `public/artifacts/active.json` so its `snapshotUrl`, `geometryUrl`, and
   `routeMapUrl` reference that exact set.
4. Run `npm run build`, verify `file_gtfs.zip` is absent from `dist/`, and deploy
   the Worker once. Cloudflare activates the static assets and Worker version as
   one deployment.

Versioned artifacts receive a one-year immutable cache policy from
`public/_headers`; the activation manifest uses `no-cache`. Existing isolates
continue using their already validated immutable pair, while new runtime
lifecycles acquire the newly activated version. A request can therefore never
combine topology from one version with geometry from another.

For an externally hosted manifest, set `TRANSIT_ARTIFACT_MANIFEST_URL` to its
absolute URL. Publish both immutable objects before atomically changing that
manifest. No R2 bucket, production binding ID, or credential is required by the
default Workers Static Assets setup.

The source ZIP must remain under ignored `var/transit/` storage and must never be
copied into `public/`.
