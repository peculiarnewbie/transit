# Plan 010: Add multimodal routing and production performance gates

> **Executor instructions**: Start only after bus routing, admin publication,
> and train projection are complete. This is an integration and hardening plan,
> not permission to redesign working source lanes.
>
> **Drift check**: `git diff --stat 07703bb..HEAD -- src/runtime src/routing src/routes/api src/features/passenger src/components/map performance`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plans 007, 008, 009
- **Category**: integration / performance / feature
- **Planned at**: commit `07703bb`, 2026-07-18

## Why this matters

This plan completes the combined bus/train product while protecting the original
priority: usefulness on weak mobile connections. Multimodal routing should add
explicit curated transfers and honest schedule precision without increasing the
initial client payload or delaying the bus experience.

## Current state

After prerequisites:

- bus journeys are deployed through a canonical router;
- published train snapshots are canonical and versioned;
- curated cross-system transfers can be published;
- the passenger UI lazy-loads MapLibre and renders returned geometry;
- production performance budgets have not yet been enforced end to end.

## Commands

| Purpose           | Command                                                         | Expected result             |
| ----------------- | --------------------------------------------------------------- | --------------------------- |
| Multimodal tests  | `npm test -- src/routing src/routes/api src/features/passenger` | all pass                    |
| Full verification | `npm run check && npm test && npm run build`                    | exit 0                      |
| Performance suite | `npm run perf`                                                  | all documented budgets pass |

## Scope

**In scope**:

- `src/runtime/**` multimodal snapshot composition
- `src/routing/**` mode-aware behavior using existing contracts
- passenger journey API and UI extensions
- `src/components/map/**` combined route layers
- `performance/**` fixtures/scripts/results format
- `package.json` only for a `perf` script; no new dependency without approval

**Out of scope**:

- New source scraping or curation tables
- Guessing uncurated transfers
- Full offline city-map download
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

**Verify**: tests cover bus→train, train→bus, two transfers, directionality,
unavailable service, excluded train line, and no inferred nearby transfer.

### Step 3: Extend journey responses and passenger explanations

Return mode, provenance/freshness, uncertainty, station/boarding-point names,
and transfer walking notes. The UI must explain when a train time is approximate
or unavailable. Keep geometry detail lazy and bounded.

**Verify**: accessibility tests confirm uncertainty is conveyed in text, not
color/icon alone.

### Step 4: Establish network and rendering budgets

Measure on a throttled mobile profile:

- initial HTML/CSS/JS bytes and time to usable journey controls;
- lazy MapLibre chunk size;
- requests/bytes for initial Jakarta viewport;
- stop search and journey API response sizes/latency;
- routing cold and warm latency;
- interaction/rendering with all alternatives and one selected geometry.

Record concrete budgets from baseline measurements, then fail `npm run perf` on
material regressions with stable synthetic fixtures. Do not create fragile
internet-dependent CI tests.

**Verify**: performance suite runs offline against local fixtures and emits a
machine-readable report.

### Step 5: Tune caching and basemap delivery from evidence

Use immutable versioned cache headers for snapshots and geometry, bounded
Effect `Cache` for repeated server lookups where measurement justifies it, and
small API responses. Do not hand-roll TTL maps.

If the hosted basemap dominates weak-network measurements, write a separate
decision record and implementation plan for a Jakarta-only OSM-derived PMTiles
basemap served from range-capable storage/CDN. Do not fold tile generation into
this plan without that evidence.

**Verify**: repeat visits reduce transferred bytes as documented, and failures
still leave journey controls/results usable without the basemap.

## Done criteria

- [ ] One atomic canonical network serves bus and train routing.
- [ ] Only curated transfers connect systems.
- [ ] Incomplete train timing is visible and typed end to end.
- [ ] Passenger line controls work across modes.
- [ ] Offline fixture performance suite enforces documented budgets.
- [ ] Basemap/PMTiles decision is measurement-based.
- [ ] `npm run check && npm test && npm run build && npm run perf` passes.

## STOP conditions

- Train publication lacks enough topology for a truthful routing leg.
- Weak-network measurements require a new paid provider or production binding;
  present options and costs instead of selecting one.
- Performance regression can only be hidden by removing required provenance or
  uncertainty information.

## Maintenance notes

Keep performance budgets tied to user outcomes: usable controls, small journey
responses, bounded map work, and understandable degraded states. Revisit the
PMTiles basemap only when hosted tile delivery is the measured bottleneck.
