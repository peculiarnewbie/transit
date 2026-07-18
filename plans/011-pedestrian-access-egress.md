# Plan 011: Add street-routed pedestrian access and egress

> **Executor instructions**: Start only after Plan 010 has shipped the
> place-aware bus/train product. Preserve its transit guidance and Plan 016's
> static bus helper as complete, independent fallbacks. This plan may add
> routable coordinate access/egress only
> through a real pedestrian street graph; it must never estimate a user-facing
> walk from straight-line distance.
> Do not call this plan complete from one successful pedestrian route or a
> provider demo. Completion requires the reviewed Jakarta correctness corpus,
> failure and cost behavior, both access and egress, and the transit-only route-
> helper fallback to pass against the selected production runtime.
>
> **Drift check**: `git diff --stat HEAD -- src/domain src/street-routing src/runtime src/routes/api src/features/passenger src/components/map performance wrangler.jsonc`

## Status

- **Priority**: P3
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: Plan 010
- **Category**: final product capability / provider integration / cost / correctness
- **Planned at**: after Plan 010

## Why this matters

The place-aware transit-only product is useful without pretending that a nearby
choice is a walkable path. Door-to-door planning completes the passenger task,
but Jakarta makes geometric walking estimates untrustworthy: rivers, toll
roads, railway corridors, gates, barriers, missing crossings, and station
entrances can turn a nearby stop into an impossible or unsafe access path.

This plan adds routed origin-to-stop and stop-to-destination pedestrian legs
using an OSM-derived street graph. It does not change how the transit router
chooses bus/train legs or how curated transfers connect systems.

## Current state

After Plan 010:

- passengers can select ordinary places and nearby transit choices, but those
  choices carry only honest geographic proximity—not pedestrian routes;
- the canonical transit network contains only published, reviewed walking
  transfers;
- the routing core already accepts bounded origin/destination stop candidates
  with access durations, but production callers provide one zero-duration
  selected stop at each end;
- no street-routing provider, arbitrary-coordinate journey DTO, provider budget,
  or street-routing failure UX exists;
- place discovery and transit-only guidance work without an external street
  service.

## Commands

| Purpose                   | Command                                                                | Expected result                  |
| ------------------------- | ---------------------------------------------------------------------- | -------------------------------- |
| Street-routing tests      | `npm test -- src/street-routing src/routes/api src/features/passenger` | all pass                         |
| Full verification         | `npm run check && npm test && npm run build`                           | exit 0                           |
| Provider/runtime evidence | `npm run perf -- street-routing`                                       | documented gates and report pass |

## Scope

**In scope**:

- `src/street-routing/**` provider-neutral contracts, service, fixtures, and
  adapters
- minimal shared journey-contract changes required to distinguish selected
  passenger places, transit candidates, and routed endpoint coordinates
- `src/runtime/**` explicit street-router layer wiring
- passenger journey API and UI extensions for coordinate access/egress
- map rendering for returned pedestrian geometry
- `performance/**` Jakarta correctness corpus, provider-call accounting, and
  hosted/container measurements
- a hosted Valhalla-compatible adapter for evaluation
- a Jabodetabek Valhalla-on-Cloudflare-Containers prototype for comparison
- runtime cost controls, lawful temporary caching, attribution, observability,
  and circuit-breaking/fallback behavior

**Out of scope**:

- Replacing the canonical transit router with a third-party multimodal engine
- Using street routing to invent or bypass curated stop-to-stop transfers
- Straight-line, radius/speed, or crow-flies walking estimates in passenger
  results
- New address/POI geocoding; reuse Plan 014's selected places, with map/device
  coordinates when a precise walking endpoint is required
- Bicycle, motorcycle, car, taxi, parking, pickup/drop-off, traffic, or other
  vehicle connector behavior
- Google APIs or SDKs
- Bulk downloading, proxy caching, or permanently storing hosted-provider
  results without explicit contractual permission
- Building a global or full-Indonesia routing graph

## Git workflow

- Branch: `work/011-pedestrian-access-egress`
- Suggested commit: `feat(routing): add pedestrian access and egress`

## Steps

### Step 1: Define provider-neutral pedestrian contracts

Add boundary schemas that distinguish a selected passenger place, its precise
walking coordinate, and the transit candidates considered. Model journey and
street-routing variants as tagged unions rather than optional coordinate/stop
fields or interacting booleans. For a broad area without a truthful entrance
point, require the passenger to refine the walking endpoint instead of routing
from an arbitrary centroid.

Define a `StreetRouter` Effect service whose named methods accept one coordinate
and a bounded set of candidate transit stops, then return feasible pedestrian
connections. A connection includes snapped endpoints, routed duration and
distance, bounded geometry or a geometry reference, routing-data version,
provider provenance, and warnings relevant to passenger explanation.

Model `NoPedestrianPath`, invalid/snap-rejected input, provider unavailable,
provider response failure, and budget exhaustion as separate typed errors. Use
`Context.Service`, explicit `Layer` values, `Effect.fn` public methods, and
`Schema` decoding at every hosted/container response boundary. Keep pedestrian
connectors distinct from scheduled transit route modes so future vehicles do
not become fake transit routes.

**Verify**: Schema round-trip tests cover endpoint/connection variants and
service tests prove each typed failure remains distinguishable.

### Step 2: Build a Jakarta pedestrian correctness corpus

Create a reviewed fixture corpus of difficult access/egress cases: rivers and
canals, toll-road crossings, rail corridors, pedestrian bridges, station
entrances, gated areas, roads without sidewalks, stairs, and disconnected OSM
components. Include expected reachability and unacceptable-path assertions,
not only snapshots of whichever provider answers first.

Evaluate a hosted Valhalla-compatible API and a Jabodetabek-only self-hosted
Valhalla graph against the same corpus. Record exact OSM extract/version,
costing options, false-positive/false-negative cases, latency, response size,
and provider credit usage. Treat missing or incorrect OSM facts as data-quality
work, not a reason to add geometric fallback.

**Verify**: the corpus produces a machine-readable comparison report and every
accepted engine meets documented reachability/safety thresholds.

### Step 3: Generate bounded access and egress candidates

Use local stop coordinates only to create a small internal candidate shortlist;
geographic distance may reduce provider work but must never become a displayed
duration or feasibility claim. Ask `StreetRouter` to route the shortlist and
discard candidates without a real pedestrian path or beyond configured routed
duration/distance limits.

Populate the routing core's existing origin/destination candidate seam with
the returned routed durations. Fetch detailed geometry only for connectors in
the bounded returned alternatives when the provider can avoid calculating it
for every rejected candidate. Never use street routing to connect two transit
systems except through an already-published transfer edge.

**Verify**: tests cover a geometrically near but unreachable stop, a farther
reachable stop, bounded candidate counts, no path, and preservation of curated
transfer-only transit interchange.

### Step 4: Add an explicit door-to-door passenger mode

Keep the Plan 014 place-selection and transit-only guidance as the complete
fallback. Add routed access/egress for precise landmark, map, or device
coordinates, explain that pedestrian routing depends on mapped paths, and
render those legs separately from transit and curated-transfer legs. Reuse
existing place search; do not add another geocoder in this plan.

If street routing is unavailable, over budget, or returns no path, retain the
user's inputs and offer transit-only guidance. Never silently substitute
a straight line, zero-duration connector, or nearest stop. Ensure screen-reader
text distinguishes the app-covered transit journey from the access/egress
estimate.

**Verify**: component/API tests cover coordinate validation, explicit mode
entry, returned pedestrian geometry, no-path explanation, provider outage, and
one-action recovery to station-only planning.

### Step 5: Enforce provider, caching, and cost boundaries

Keep hosted API credentials server-side and wrap outgoing HTTP calls in the
provider adapter. Record calls, credits/elements, latency, errors, cache status,
and graph/provider version without logging precise passenger coordinates.

Set a hard maximum provider cost per passenger search and prevent retries from
multiplying billable work. Follow provider cache headers and contract terms;
do not bulk precompute or persist hosted route output unless the subscription or
written agreement explicitly permits it. Project-owned curated transfers and
outputs generated by a project-operated OSM router follow their own versioning
and OSM attribution/licensing policy.

**Verify**: deterministic tests prove the call/credit ceiling, bounded retries,
redacted telemetry, cache behavior, attribution, and hard-budget fallback.

### Step 6: Select hosted Valhalla or a Cloudflare Container

Benchmark the accepted hosted adapter against one named Cloudflare Container
running Valhalla with a Jabodetabek graph baked into the image. Do not download
the graph during request startup. Measure image/graph size, graph build time,
container cold start plus Valhalla readiness, warm latency, memory/disk/CPU,
monthly projected cost, update/rollback procedure, and failure recovery.

Record an ADR selecting exactly one production street-routing runtime. Prefer
the hosted service while its route quality, contractual rights, call budget,
and cost are acceptable; select the Container only when the measured operational
and financial result is better. The `StreetRouter` contract and passenger
fallback must be identical for both.

**Verify**: the ADR includes reproducible evidence, the selected runtime passes
the Jakarta corpus and cost/performance gates, and only one production adapter
is enabled by default.

### Step 7: Add production gates and staged rollout

Extend `npm run perf` with cold/warm end-to-end journey searches, weak-mobile
response/rendering measurements, provider/container failure injection, and a
machine-readable cost projection. Roll out behind an explicit feature flag or
bounded cohort while transit-only guidance remains universally available.

Define operational thresholds for provider failure rate, no-path rate, latency,
credit/container spend, and automatic disabling of only door-to-door mode. A
street-router incident must not take down place search or transit-only
guidance.

**Verify**: failure injection disables/degrades only coordinate access/egress,
and the full Plan 012 route-helper acceptance corpus remains unchanged.

## Test plan

At minimum cover tagged endpoint/connector schemas, invalid coordinates, snap
rejection, bounded stop shortlisting, inaccessible nearby stops, route geometry,
provider malformed responses, typed provider failures, timeout/circuit behavior,
credit ceilings, cache/licensing configuration, redacted telemetry, runtime
equivalence on the Jakarta corpus, and transit-only fallback. Use explicit test
layers and no live provider calls in ordinary CI.

## Done criteria

- [ ] Place discovery and transit-only guidance remain available and work
      independently of the street router.
- [ ] Precise endpoint coordinates are routed only through explicit
      door-to-door behavior.
- [ ] Every displayed access/egress duration and geometry comes from an accepted
      pedestrian street graph; no straight-line fallback exists.
- [ ] Street routing cannot invent stop-to-stop or cross-system transfers.
- [ ] `StreetRouter` has provider-neutral schemas, explicit layers, named Effect
      operations, typed errors, and deterministic fixture layers.
- [ ] Jakarta correctness corpus and provider/runtime ADR are committed.
- [ ] Provider calls, credits/cost, retries, caching rights, attribution, and
      coordinate-safe telemetry are bounded and documented.
- [ ] Hosted/container failure degrades only door-to-door mode.
- [ ] `npm run check && npm test && npm run build && npm run perf -- street-routing`
      passes.
- [ ] The completion report publishes corpus coverage and pass/fail results for
      every barrier category, both access and egress, provider failures, budget
      exhaustion, and transit-only fallback.
- [ ] Evidence comes from the selected runtime and versioned pedestrian graph
      or provider, not only mocks or one successful route.
- [ ] A completion report satisfies the repository completion integrity
      protocol and lists all excluded areas, unsupported cases, and known
      correctness failures; unresolved in-scope failures prevent `DONE`.

## STOP conditions

- The accepted provider/runtime cannot distinguish required Jakarta barriers or
  produces unsafe false-positive pedestrian paths in the reviewed corpus.
- OSM lacks enough entrance/crossing/access data for a truthful connector; fix
  or curate the source data rather than inventing a walk.
- Hosted-provider terms do not permit the intended server integration, caching,
  attribution, or commercial use; obtain written terms or select another
  runtime before implementation.
- A Cloudflare Container graph exceeds measured image, memory, disk, startup, or
  cost gates; do not increase scope to Indonesia-wide infrastructure.
- Door-to-door failure cannot be isolated from transit-only guidance.

## Maintenance notes

Keep the provider boundary narrow and preserve graph/provider versioning in
results so disputed paths can be reproduced. Re-run the Jakarta corpus whenever
the OSM extract, Valhalla version, or costing configuration changes. Personal
vehicles are a separate future plan because legal road profiles, parking,
pickup/drop-off, traffic expectations, and connector eligibility materially
change the product contract.
