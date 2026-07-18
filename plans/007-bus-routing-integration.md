# Plan 007: Integrate the bus-routing vertical slice

> **Executor instructions**: Merge Plans 002, 003, and 004 first. This plan owns
> runtime composition, passenger API routes, generated route-tree changes, and
> replacing UI fixtures with the real adapter.
> This plan is now a technical baseline, not the public passenger release gate.
> Plans 012–016 supersede its stop-only/timetable product assumptions and own
> the usable, place-aware, time-independent bus midpoint. Preserve completed
> technical work so Plan 016 can reconcile it deliberately.
>
> **Drift check**: `git diff --stat 07703bb..HEAD -- src/routes src/runtime src/features/passenger src/routeTree.gen.ts wrangler.jsonc`

## Status

- **Status**: IN PROGRESS
- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plans 002, 003, 004
- **Category**: integration / feature / performance
- **Planned at**: commit `07703bb`, 2026-07-18

## Why this matters

This establishes the first deployable technical slice: canonical artifacts,
routing, typed APIs, runtime composition, and real adapter wiring. It proves
that compiler, router, and UI contracts can integrate, but its stop-only,
date/time-oriented flow is not the first public product. Plans 012–016 use this
baseline to ship the usable bus route helper before train complexity enters.

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
- Geocoding or street-routing provider integration
- Arbitrary-coordinate origin/destination endpoints or proximity-derived
  pedestrian access/egress
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

The public journey DTO accepts one selected origin stop ID and one selected
destination stop ID. Map those to the routing core's candidate arrays with zero
access/egress walking seconds. Do not expose caller-supplied walking seconds,
coordinate candidates, or inferred nearby-stop access through the V1 API.

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

Remove or disable the fixture-only free-coordinate `MapPoint` endpoint flow.
Map interaction may choose a rendered stop marker; clicking empty map space must
not create a V1 journey endpoint.

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
no-service time, rejection of arbitrary-coordinate endpoints, and
map-independent itinerary rendering.

**Verify**: `npm run check && npm test && npm run build` passes.

## Done criteria

- [ ] A deployed-style runtime answers bus journey requests.
- [ ] All API inputs/outputs are Schema-validated and bounded.
- [ ] Passenger UI uses the real adapter in production.
- [ ] Production journeys begin and end at explicitly selected transit stops;
      no arbitrary-coordinate or inferred access/egress path is exposed.
      This is a technical-slice criterion only; Plan 016 supersedes it for the
      public midpoint with place-aware endpoint discovery.
- [ ] TanStack Start remains in SPA mode with `defaultSsr: false`.
- [ ] Snapshot activation is atomic and versioned.
- [ ] Generated route tree is current.
- [ ] Acceptance tests cover line-selection features.
- [ ] Full verification passes.

## Completion audit (2026-07-18)

Plan 007 was previously classified as complete, but the merged implementation
does not yet substantiate the plan's production integration scope. It remains
`IN PROGRESS` until the gaps below are resolved and a completion report meets
the repository completion integrity protocol.

### Evidence currently present

- Runtime, journey/stops API routes, the production passenger adapter, and
  versioned artifact loading exist.
- The hand-built integration snapshot contains 3 routes (`tj:1`, `tj:6B`, and
  `tj:9C`), 3 patterns, 5 stops, and 3 trips. Tests exercise direct, transfer,
  exclude, require, and locked-leg behavior against this snapshot.
- The supplied TransJakarta artifact contains 256 routes, 719 patterns, 8,243
  stops, 730 trips, and 14 transfers.
- Unit/integration tests and the production build pass as of this audit, subject
  to the known formatting and Vitest shutdown issues recorded in the working
  baseline.

### Gaps preventing completion

- The vertical-slice integration test reads the 3-route demo topology and
  geometry even though the active manifest names the full TransJakarta
  artifact. It therefore does not prove that the deployed-style runtime can
  load or route over the active production artifact.
- There is no deterministic whole-artifact audit or representative query corpus
  proving routeability across the 256 supplied routes and their 719 patterns.
  Production coverage, disconnected routes, service availability, and skipped
  records are not reported.
- Arbitrary-coordinate endpoints remain in the public/runtime contracts and
  passenger adapter. The integration test explicitly expects a coordinate
  origin to succeed, contradicting the V1 selected-stop-only scope and done
  criterion.
- The itinerary rendering acceptance test constructs `MapPoint` endpoints, so
  it does not prove the required selected-stop-only passenger flow.
- The acceptance evidence is fixture-only and does not demonstrate the local
  compile → validate → publish → activate sequence with the full artifact.
- `npm run check` is not currently green because the generated route tree fails
  the formatting check. Vitest passes but reports a delayed shutdown caused by
  a process that keeps Vite alive.

### Required evidence before `DONE`

- Make the public passenger journey contract reject coordinate endpoints and
  remove/disable the fixture-only `MapPoint` production flow.
- Run deployed-style integration queries against the active TransJakarta
  artifact, with a versioned representative corpus covering multiple corridors,
  patterns/branches, direct and transfer journeys, constraints, no-route, and
  no-service behavior.
- Produce a whole-artifact coverage report with route/pattern/stop/trip counts,
  routable and unroutable cases, and every skipped or invalid record. Full
  enumeration is required; a single successful route is insufficient.
- Demonstrate an atomic full-artifact activation and selected-stop UI/API flow.
- Pass `npm run check && npm test && npm run build`, then attach the completion
  report required by `plans/README.md`.

## STOP conditions

- Compiler and router disagree on a canonical contract.
- Snapshot cold-load size/latency exceeds the documented routing budget; report
  measurements before choosing new infrastructure.
- Artifact publication requires production credentials or binding IDs.

## Maintenance notes

This plan is the bus MVP release gate. Do not let train work delay its acceptance
criteria. Keep transport DTOs derived from or explicitly mapped to domain
schemas to avoid drift.
