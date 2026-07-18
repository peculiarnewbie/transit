# Plan 007: Integrate the bus-routing vertical slice

> **Executor instructions**: Merge Plans 002, 003, and 004 first. This plan owns
> runtime composition, passenger API routes, generated route-tree changes, and
> replacing UI fixtures with the real adapter.
>
> **Drift check**: `git diff --stat 07703bb..HEAD -- src/routes src/runtime src/features/passenger src/routeTree.gen.ts wrangler.jsonc`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plans 002, 003, 004
- **Category**: integration / feature / performance
- **Planned at**: commit `07703bb`, 2026-07-18

## Why this matters

This is the first deployable product slice: choose two Jakarta locations/stops,
receive TransJakarta alternatives, constrain actual lines, and inspect the
result on the map. It is also the gate that proves compiler, router, and UI
contracts agree before train complexity enters.

## Current state

After prerequisites merge:

- the GTFS compiler emits versioned topology and geometry artifacts;
- the router operates on canonical snapshots and typed constraints;
- the passenger page calls a fixture adapter and lazy-loads MapLibre;
- no passenger routing endpoint or whole-app Effect runtime exists.

## Commands

| Purpose           | Command                                             | Expected result                          |
| ----------------- | --------------------------------------------------- | ---------------------------------------- |
| Generate routes   | `npm run generate-routes`                           | route tree includes passenger API routes |
| Integration tests | `npm test -- src/routes/api src/features/passenger` | all pass                                 |
| Full verification | `npm run check && npm test && npm run build`        | exit 0                                   |

## Scope

**In scope**:

- `src/runtime/**` (create)
- `src/routes/api/journeys.ts` (create)
- `src/routes/api/stops.ts` (create)
- `src/features/passenger/**` adapter integration
- `src/routeTree.gen.ts` generated changes
- artifact-loading configuration/documentation
- end-to-end integration fixtures/tests

**Out of scope**:

- Train adapters or multimodal routing
- Curation/admin files
- New persistence tables
- Geocoding provider integration; origin/destination may be stop or coordinate
  candidates resolved to nearby stops
- Custom PMTiles basemap generation

## Git workflow

- Branch: `work/007-bus-integration`
- Suggested commit: `feat(app): integrate TransJakarta journey planning`

## Steps

### Step 1: Compose the application runtime explicitly

Create named layers for snapshot loading, routing indexes, and route-query
service. Use topologically sorted `Layer` composition; do not use
`Layer.mergeAll`/`provideMerge` merely to silence missing requirements. Acquire
the immutable snapshot and routing indexes once per runtime lifecycle.

Configure artifact location through Effect `Config`, with deterministic test
providers. Validate the snapshot before exposing the runtime.

**Verify**: a runtime acquisition test proves one snapshot load services
multiple queries.

### Step 2: Add thin Schema-validated HTTP routes

`POST /api/journeys` decodes the query, calls the routing service, and maps typed
domain errors to stable error DTOs/status codes. `GET /api/stops` performs a
bounded nearby/name search without returning the entire stop catalog.

No business logic belongs in handlers. Apply request size limits and bound all
result counts/transfer limits.

**Verify**: route tests cover malformed input, no route, valid alternatives,
constraints, and internal failure without leaking stack/provider details.

### Step 3: Replace passenger fixtures with the API adapter

Keep fixtures available for component tests, but make production state call the
real endpoints from the client after interaction, with cancellation when inputs
change. Do not introduce SSR loaders or server-render journey state. Preserve
list-first and map-failure behavior. Render only geometry for returned
alternatives, loading full detail for the selected option when appropriate.

**Verify**: integration test exercises endpoint selection through rendered
itinerary cards and exact line constraints.

### Step 4: Publish/cache immutable artifacts safely

Choose one deployment-compatible immutable artifact mechanism already available
in the stack (Workers static assets or R2 if configured by the operator). Use
content-hashed/versioned URLs and long-lived cache headers. Never bundle the
external production ZIP into client assets.

Document the local compile → validate → publish → activate sequence. Activation
must be atomic so requests never mix topology and geometry versions.

**Verify**: a test switches between two snapshot versions without partial
state; production build contains no `file_gtfs.zip`.

### Step 5: Add bus vertical-slice acceptance tests

Use a realistic fixture with branches and transfers. Cover endpoint selection,
direct route, transfer route, excluded line, required line, locked leg,
no-service time, and map-independent itinerary rendering.

**Verify**: `npm run check && npm test && npm run build` passes.

## Done criteria

- [ ] A deployed-style runtime answers bus journey requests.
- [ ] All API inputs/outputs are Schema-validated and bounded.
- [ ] Passenger UI uses the real adapter in production.
- [ ] TanStack Start remains in SPA mode with `defaultSsr: false`.
- [ ] Snapshot activation is atomic and versioned.
- [ ] Generated route tree is current.
- [ ] Acceptance tests cover line-selection features.
- [ ] Full verification passes.

## STOP conditions

- Compiler and router disagree on a canonical contract.
- Snapshot cold-load size/latency exceeds the documented routing budget; report
  measurements before choosing new infrastructure.
- Artifact publication requires production credentials or binding IDs.

## Maintenance notes

This plan is the bus MVP release gate. Do not let train work delay its acceptance
criteria. Keep transport DTOs derived from or explicitly mapped to domain
schemas to avoid drift.
