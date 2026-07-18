# Plan 010: Add multimodal routing and choose the production routing runtime

> **Executor instructions**: Start only after the usable bus route helper,
> admin publication, and train projection are complete. Preserve Plan 016's
> static bus helper as a complete fallback. Keep the Worker-hosted router as the
> baseline until measurements justify a runtime change. This is an
> integration and hardening plan, not permission to redesign working source
> lanes or maintain two routing implementations.
> Do not mark this plan complete from one bus/train interchange or one golden
> query. Completion requires a versioned query corpus spanning multiple bus and
> train routes, every supported mode transition and service-precision variant,
> negative constraints, and all runtime candidates considered by the decision.
>
> **Drift check**: `git diff --stat 07703bb..HEAD -- src/runtime src/routing src/routes/api src/features/passenger src/components/map performance`

## Status

- **Priority**: P2
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: Plans 008, 009, 016
- **Category**: integration / performance / runtime decision / feature
- **Planned at**: commit `07703bb`, 2026-07-18

## Why this matters

This plan completes the combined bus/train product while protecting the original
priority: usefulness on weak mobile connections. Multimodal routing should add
explicit curated transfers and honest schedule precision without increasing the
initial client payload or delaying the bus experience.

Plan 016 deliberately qualifies the straightforward Worker-hosted bus product
first. This plan measures that deployed baseline before deciding whether
multimodal routing should remain in Workers, move into a browser Web Worker
with a versioned cached graph, or fall back to a Cloudflare Container. The
decision must be based on cold and warm behavior on realistic devices and
production-like infrastructure, not assumed from artifact size.

## Current state

After prerequisites:

- bus journeys are deployed through a canonical router;
- the routing core is TypeScript and remains independent of Cloudflare and
  browser APIs;
- published train snapshots are canonical and versioned;
- curated cross-system transfers can be published;
- the passenger UI lazy-loads MapLibre and renders returned geometry;
- production performance budgets have not yet been enforced end to end;
- the production TransJakarta verification artifact is 6.91 MB of canonical
  topology JSON, approximately 620 KB with gzip or 352 KB with Brotli; this is
  an interchange format, not proof of its decoded memory or indexing cost.

## Commands

| Purpose                  | Command                                                         | Expected result                         |
| ------------------------ | --------------------------------------------------------------- | --------------------------------------- |
| Multimodal tests         | `npm test -- src/routing src/routes/api src/features/passenger` | all pass                                |
| Runtime equivalence      | `npm test -- performance/runtime`                               | golden queries match in every candidate |
| Full verification        | `npm run check && npm test && npm run build`                    | exit 0                                  |
| Production runtime gates | `npm run perf`                                                  | selected runtime passes all budgets     |

## Scope

**In scope**:

- `src/runtime/**` multimodal snapshot composition
- `src/routing/**` mode-aware behavior using existing contracts
- passenger journey API and UI extensions
- `src/components/map/**` combined route layers
- a compact, versioned routing projection derived from the canonical snapshot
- `performance/**` fixtures, Worker/browser harnesses, scripts, and results
- a browser Web Worker adapter and persistent artifact cache only if selected
  by the runtime decision gate
- Cloudflare Container routing behind the existing service contract only if
  both ordinary Workers and client routing fail their applicable gates
- `package.json` only for a `perf` script; no new dependency without approval

**Out of scope**:

- New source scraping or curation tables
- Guessing uncurated transfers
- Arbitrary-coordinate origins/destinations, street-level pedestrian routing,
  or access/egress outside the selected transit stops
- Bicycle, motorcycle, car, taxi, or other personal-vehicle connector legs
- Full offline city-map download
- Sending query-specific graph fragments that can omit valid transfer paths
- Maintaining separate browser and server routing algorithms
- Moving routing into the browser before the Plan 016 server baseline is
  measured
- Building a custom OSM tile pipeline unless measurements show it is necessary
- Journey fares or real-time vehicle prediction

## Git workflow

- Branch: `work/010-multimodal-performance`
- Suggested commit: `feat(routing): add curated multimodal journeys`

## Steps

### Step 1: Atomically compose bus and train snapshots

Create a combined version from exact bus snapshot, train projection, and
curation revision hashes. Reject conflicting canonical IDs and dangling
transfers. Activation must swap one whole immutable network version.

**Verify**: concurrent requests observe either old or new version, never a mixed
graph.

### Step 2: Enable mode-aware routing through curated transfers

Route across bus and train patterns only via explicit published transfer edges.
Preserve existing line exclusion/preference/requirement/locking across modes.
Score `Scheduled`, `FrequencyOnly`, and `TopologyOnly` legs differently and
surface uncertainty rather than turning it into fake exact times.

Every journey begins with Plan 014's selected passenger place and bounded
nearby transit choices. It may combine bus and train only through explicit
published transfers. Endpoint proximity remains geographic selection evidence,
not a walking leg, duration, feasibility claim, or transfer. Retain transfer
direction, minimum duration, accessibility information, notes, and verification
provenance in the composed network and returned journey.

**Verify**: tests cover bus→train, train→bus, two transfers, directionality,
unavailable service, excluded train line, and no inferred nearby transfer.

### Step 3: Extend journey responses and passenger explanations

Return mode, provenance/freshness, uncertainty, station/boarding-point names,
and transfer walking notes. The UI must explain when a train time is approximate
or unavailable. It must state the selected passenger places and chosen transit
boarding/alighting places so it does not imply door-to-door coverage. Keep
geometry detail lazy and bounded.

**Verify**: accessibility tests confirm uncertainty is conveyed in text, not
color/icon alone.

### Step 4: Establish Worker, network, and rendering budgets

Measure on a throttled mobile profile:

- initial HTML/CSS/JS bytes and time to usable journey controls;
- lazy MapLibre chunk size;
- requests/bytes for initial Jakarta viewport;
- place search, route-guide, and multimodal API response sizes/latency;
- Worker snapshot fetch, decode, index-build, and peak-memory cost;
- Worker cold and warm routing latency and CPU time;
- interaction/rendering with all alternatives and one selected geometry.

Record concrete budgets from baseline measurements, then fail `npm run perf` on
material regressions with stable synthetic fixtures. Do not create fragile
internet-dependent CI tests.

Treat a Worker memory-limit breach, repeated cold-start failure, or failure to
meet the journey-response budget as a runtime decision failure rather than
raising limits or hiding work in request handlers.

**Verify**: performance suite runs offline against local fixtures, records a
production-like Worker run separately, and emits a machine-readable report.

### Step 5: Benchmark browser routing without changing the default

Build a performance harness around the same routing core using a browser Web
Worker. Derive a compact graph with numeric identifiers and bounded arrays from
the canonical snapshot. It must contain routing topology, schedules, service
calendars, transfers, and station locations, but no display geometry or repeated
provenance strings.

Load the engine and graph only after the first journey interaction. Cache the
immutable graph by content hash in Cache Storage or IndexedDB. Send the complete
compact routing graph once; do not ask the server for a supposedly relevant
per-query subgraph because doing so duplicates search work and can exclude valid
multi-transfer alternatives.

Measure on representative low-end mobile profiles:

- compressed engine and graph bytes on first use;
- graph decode/index time and peak browser memory;
- main-thread blocking, which must remain bounded by running routing in the Web
  Worker;
- cold and cached query latency for the same fixed query corpus;
- repeat-visit transferred bytes and offline behavior;
- correctness equivalence with the server runtime.

This step is an experiment behind the existing passenger adapter. The
production UI continues to call the Plan 016 API until Step 6 selects another
runtime.

**Verify**: every server golden query has a byte-equivalent browser result, and
the performance report compares first-use and cached behavior against the
Worker baseline.

### Step 6: Select and productionize exactly one routing runtime

Record the decision and measurements in an ADR. Use this order:

1. **Retain ordinary Workers** when Worker cold/warm budgets pass and browser
   routing does not materially improve the weak-mobile experience.
2. **Select browser Web Worker routing** when it preserves correctness, meets
   first-use mobile budgets, and materially improves repeat interactions. Keep
   the HTTP routing service as a deployable fallback, not a second algorithm.
3. **Select a Cloudflare Container** when ordinary Workers fail server resource
   gates and browser routing fails device or first-use budgets. Run the same
   routing core behind the existing typed service/API contract and load the same
   immutable network version.

Do not select a runtime merely because its warm benchmark is fastest. First-use
latency, memory, failure recovery, operational complexity, and weak-network
behavior are required decision inputs. Preserve the passenger adapter contract
so runtime choice does not leak into UI state.

**Verify**: only the selected production path is enabled by default, fallback
behavior is explicit and tested, and all runtime-specific resource gates pass.

### Step 7: Tune caching and basemap delivery from evidence

Use immutable versioned cache headers for snapshots and geometry, bounded
Effect `Cache` for repeated server lookups where measurement justifies it, and
small API responses. For browser routing, use the content-addressed persistent
graph cache established in Step 5; do not add a second application-level TTL
cache. Do not hand-roll TTL maps.

If the hosted basemap dominates weak-network measurements, write a separate
decision record and implementation plan for a Jakarta-only OSM-derived PMTiles
basemap served from range-capable storage/CDN. Do not fold tile generation into
this plan without that evidence.

**Verify**: repeat visits reduce transferred bytes as documented, and failures
still leave journey controls/results usable without the basemap.

## Done criteria

- [ ] One atomic canonical network serves bus and train routing.
- [ ] Only curated transfers connect systems.
- [ ] Journeys begin/end at selected stops or stations, and no street-routed or
      proximity-estimated access/egress is implied.
- [ ] Incomplete train timing is visible and typed end to end.
- [ ] Passenger line controls work across modes.
- [ ] Offline fixture performance suite enforces documented budgets.
- [ ] Worker and browser routing produce equivalent results for the golden
      query corpus.
- [ ] A measured ADR selects ordinary Workers, browser Web Worker routing, or a
      Cloudflare Container.
- [ ] The selected runtime passes cold, warm, memory, and weak-network gates.
- [ ] Initial controls do not download the routing graph or geometry.
- [ ] Basemap/PMTiles decision is measurement-based.
- [ ] `npm run check && npm test && npm run build && npm run perf` passes.
- [ ] The completion report publishes the query-corpus matrix and results by
      route, mode sequence, transfer count/direction, service-precision variant,
      constraint, cold/warm state, and selected runtime.
- [ ] Real composed artifacts are audited for coverage; a single interchange,
      route, mode pair, or fixture-only happy path keeps status `IN PROGRESS`.
- [ ] A completion report satisfies the repository completion integrity
      protocol and lists every unsupported or degraded multimodal case.

## STOP conditions

- Train publication lacks enough topology for a truthful routing leg.
- The routing core acquires platform-specific dependencies that prevent the
  same golden corpus from running in Worker and browser harnesses.
- Neither Worker, browser, nor Container candidate can meet the documented
  first-use and correctness gates; report the measured bottleneck before
  changing product behavior.
- Weak-network measurements require a new paid provider or production binding;
  present options and costs instead of selecting one.
- Performance regression can only be hidden by removing required provenance or
  uncertainty information.

## Maintenance notes

Keep performance budgets tied to user outcomes: usable controls, small journey
responses, bounded map work, and understandable degraded states. Revisit the
PMTiles basemap only when hosted tile delivery is the measured bottleneck. The
browser and server harnesses must import one routing core; environment adapters
own artifact loading, caching, and transport concerns. Plan 011 is the sole
follow-up authorized to add arbitrary-coordinate pedestrian access/egress; it
must preserve this station-only workflow as the independent fallback.
