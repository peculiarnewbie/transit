# Plan 004: Build the low-bandwidth passenger map shell

> **Executor instructions**: Build against static typed fixtures. Do not add API
> routes or depend on unpublished routing services. This lane exclusively owns
> the passenger page and map components.
>
> **Drift check**: `git diff --stat 07703bb..HEAD -- src/routes/index.tsx src/features/passenger src/components/map src/styles.css`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: Plan 001
- **Category**: feature / performance / UX
- **Planned at**: commit `07703bb`, 2026-07-18

## Why this matters

The passenger workflow must remain useful on weak mobile connections. The map
is progressive context around origin, destination, and route choices; it must
not block the list-based journey UI. Static fixtures let this lane ship a real
interaction contract while the router and importer are built independently.

## Current state

`src/routes/index.tsx` is a 47-line scaffold page. `src/routes/__root.tsx`
declares a dark-only shell. MapLibre, PMTiles, and StyleX are available after
Plan 001. The app runs as a SolidStart SPA on Cloudflare Workers through
`tanstackStart({ spa: { enabled: true } })` and `defaultSsr: false`.

## Commands

| Purpose         | Command                                                 | Expected result            |
| --------------- | ------------------------------------------------------- | -------------------------- |
| Component tests | `npm test -- src/features/passenger src/components/map` | all pass                   |
| Verification    | `npm run check && npm test && npm run build`            | exit 0                     |
| Manual preview  | `npm run dev`                                           | app available on port 3000 |

## Scope

**In scope**:

- `src/routes/index.tsx`
- `src/features/passenger/**` (create)
- `src/components/map/**` (create)
- `src/styles.css` only for global map/root layout requirements
- component tests beside the new modules

**Out of scope**:

- `src/routes/api/**`, `src/routeTree.gen.ts`
- Routing engine, importers, D1, admin pages
- PMTiles generation or custom OSM hosting
- Google Places, routing, or traffic APIs

## Git workflow

- Branch/worktree: `work/004-passenger-map`
- Suggested commit: `feat(web): build progressive passenger route explorer`

## Steps

### Step 1: Define passenger UI states as tagged unions

Model idle, choosing endpoints, searching, results, no-route, and failed states
without boolean flag bags. Define an adapter interface that Plan 007 can replace
with the real routing API. Provide deterministic Jakarta fixture results.

**Verify**: exhaustive state-rendering tests cover every variant.

### Step 2: Add MapLibre as a lazy progressive enhancement

Keep the passenger route client-rendered; do not add SSR or hydration-time data
loading. Create the map only after the component mounts and after the journey
controls and list shell render. Dynamically import all browser-only MapLibre
code so module evaluation never touches `window` or WebGL during Worker builds.
Use a
simple hosted OSM-derived style configured through an injected URL; retain OSM
attribution. Do not use the public `tile.openstreetmap.org` endpoint as the
production default.

Use Jakarta bounds, `renderWorldCopies: false`, no pitch, capped pixel ratio,
no antialiasing, and minimal animation. Render route geometries as MapLibre
sources/layers, not thousands of DOM markers.

If MapLibre fails or is still loading, preserve endpoint controls and itinerary
cards on a plain background.

**Verify**: component tests prove controls/results render before map readiness
and map failure does not remove them.

### Step 3: Build endpoint and line-choice interactions

Allow origin/destination selection from typed stop suggestions and transit-stop
markers on the map. A map click may select a rendered stop/station marker, but
must not create an arbitrary coordinate endpoint for the V1 journey contract.
Render alternatives as cards showing line sequence, transfers, walking, and
estimated time. Add controls to exclude, prefer, require, and lock a selected
line/leg; they should update the fixture adapter query exactly once.

Use accessible buttons and lists; do not make color the only line identifier.

**Verify**: interaction tests assert the exact typed query produced by each
control.

### Step 4: Minimize initial payload and motion

Code-split MapLibre/map components from the initial route. Avoid eagerly loading
all stop or geometry fixtures. Respect reduced motion. Use system fonts for app
chrome and keep map glyph/font dependencies explicit.

Record bundle sizes from the production build in a small markdown note under
`src/features/passenger/README.md`, including initial JS and lazy map chunk.

**Verify**: production build shows MapLibre in a lazy chunk rather than the
initial route chunk.

### Step 5: Test mobile layouts and degraded states

Test narrow viewport behavior for the journey sheet, map, focus management,
loading, no results, and offline-like request failure. The itinerary list must
remain navigable without interacting with the map canvas.

**Verify**: component tests pass and manual checks at 360x640 and 1280x800 show
no obscured primary controls.

## Done criteria

- [ ] Passenger workflow renders from typed fixtures.
- [ ] Passenger pages remain SPA-only; no SSR/hydration path is introduced.
- [ ] MapLibre is lazy-loaded and non-blocking.
- [ ] Line preference/exclusion/requirement/locking produces typed queries.
- [ ] OSM attribution remains visible.
- [ ] Initial and lazy bundle sizes are documented.
- [ ] No APIs, database, importer, or router files changed.
- [ ] `npm run check && npm test && npm run build` passes.

## STOP conditions

- The chosen basemap requires exposing a secret in browser code.
- SolidStart cannot code-split MapLibre with the current SPA build; report the
  measured bundle before changing framework configuration.
- A dependency requires enabling SSR or evaluating browser globals in the
  Worker build; replace/isolate that dependency instead of changing app mode.
- Fixture contracts require changing Plan 001 domain schemas.

## Maintenance notes

The hosted basemap is intentionally replaceable. A later PMTiles basemap can
change the style/source without rewriting passenger state or route layers. The
completed fixture scaffold's `MapPoint` endpoint is not part of the V1 product
contract; Plan 007 must remove or disable free-coordinate endpoint selection
when it installs the production adapter. Plan 011 may restore arbitrary
coordinate endpoints only with real street-routed pedestrian access/egress.
