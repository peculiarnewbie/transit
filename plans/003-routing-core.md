# Plan 003: Implement constrained bus routing and alternatives

> **Executor instructions**: Build the routing engine against canonical fixture
> snapshots only. Do not depend on GTFS parser internals, D1, HTTP, or UI state.
>
> **Drift check**: `git diff --stat 07703bb..HEAD -- src/domain/transit src/routing`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 001
- **Category**: feature / correctness / performance
- **Planned at**: commit `07703bb`, 2026-07-18

## Why this matters

The product differentiator is not merely earliest arrival: passengers must be
able to exclude disliked lines, prefer or require actual lines, lock a leg, and
compare understandable alternatives. This engine must be deterministic and
independent of data-source formats so trains can join later.

## Current state

There is no routing implementation. Plan 001 defines mode-neutral stops, ordered
route patterns, trips, stop times, transfers, and service availability. Plan
002 will compile the real GTFS feed concurrently, so this lane must create its
own small canonical fixtures.

## Commands

| Purpose          | Command                   | Expected result |
| ---------------- | ------------------------- | --------------- |
| Routing tests    | `npm test -- src/routing` | all pass        |
| Type/lint/format | `npm run check`           | exit 0          |
| Full tests       | `npm test`                | exit 0          |

## Scope

**In scope**:

- `src/routing/**` (create)
- `src/routing/fixtures/**` (create)

**Out of scope**:

- Importers, database, file routes, API DTOs, UI, MapLibre
- Changes to canonical domain contracts without first reporting the blocker
- Train-specific routing behavior
- Geocoding and street-level walking directions

## Git workflow

- Branch/worktree: `work/003-routing-core`
- Suggested commit: `feat(routing): compute constrained transit alternatives`

## Steps

### Step 1: Define query and result schemas

Add routing-local boundary schemas for origin/destination stop candidates,
service date/time, maximum transfers, maximum access/transfer walking seconds,
and line constraints.

The candidate arrays are a routing-core seam, not permission for V1 callers to
infer pedestrian access. Until Plan 011, the passenger API must supply exactly
one explicitly selected origin stop and one explicitly selected destination
stop, each with zero access/egress walking seconds. Walking during the journey
comes only from explicit transfer edges in the canonical snapshot.

Line constraints must be a tagged union rather than interacting boolean flags:

- no line constraint;
- excluded route IDs;
- preferred route IDs with a weight;
- required route IDs;
- locked ordered legs from a previous result.

Results must contain ordered walk/transit legs, boarded route and pattern IDs,
times, transfers, geometry references, and a score breakdown. Model typed
`NoRoute`, `InvalidConstraint`, and malformed-network failures separately.

**Verify**: Schema round-trip tests cover every query/result variant.

### Step 2: Build validated routing indexes

Create an Effect service that acquires one decoded `NetworkSnapshot` and builds
bounded lookup indexes once in its layer: patterns by stop, trips by pattern,
stop positions, transfer adjacency, and service availability.

Use `Context.Service`, `Layer.effect`, `Service.of`, and named `Effect.fn`
methods. Index construction validates ordering and dangling references. Do not
hide snapshot loading inside a default `Context.Reference`.

**Verify**: acquisition tests prove malformed fixtures fail before serving a
query and valid fixtures build once.

### Step 3: Implement deterministic earliest-arrival rounds

Implement a round-based public-transit algorithm appropriate for route patterns
(RAPTOR or an equivalently documented algorithm), supporting scheduled trips,
frequency windows, explicit transfers, and bounded walking edges. Keep the
algorithm pure where possible and wrap the public workflow in Effect.

Correctly handle GTFS service times beyond midnight and service-date calendars.
Avoid enumerating the full power set of routes.

**Verify**: tests cover direct ride, one transfer, missed connection, overnight
service, frequency service, no service, and transfer limits.

### Step 4: Generate useful alternatives and constraints

Produce a bounded Pareto set by arrival time, transfers, walking, and user line
preferences. Deduplicate itineraries with the same boarded route sequence.
Apply excluded and required routes during search where possible; do not compute
unbounded alternatives and filter afterward.

Locked legs must be validated against the network and preserved exactly, with
routing performed only for the unlocked prefix/suffix.

**Verify**: tests demonstrate that excluding the fastest line returns a valid
slower alternative, requiring an impossible line returns `NoRoute`, and locking
a leg does not silently substitute another route.

### Step 5: Add performance and determinism benchmarks

Create a generated medium-size fixture and a deterministic benchmark test. Set
an initially generous regression budget based on measured CI/local behavior,
recording network size and query count. Avoid fragile millisecond assertions in
ordinary unit tests; isolate benchmark thresholds.

**Verify**: 100 fixed queries return stable serialized results across two runs
and complete within the documented budget.

## Test plan

At minimum cover direct, transfer, circular pattern, branch pattern, duplicate
route variants, frequency windows, service exceptions, midnight rollover,
excluded/preferred/required lines, locked legs, and malformed snapshots. Use
explicit layers and no network or real sleeps.

## Done criteria

- [ ] Router consumes only canonical domain contracts.
- [ ] Public operations are named Effect methods with typed errors.
- [ ] Constraints affect search and results are bounded/deterministic.
- [ ] At least 20 routing behavior tests pass.
- [ ] Benchmark fixture and documented baseline exist.
- [ ] No importer, database, route, or UI files changed.
- [ ] `npm run check && npm test` passes.

## STOP conditions

- The canonical snapshot lacks data required to distinguish ordered patterns.
- Correct support would require guessing walking connections not present in the
  snapshot.
- Performance requires a data representation incompatible with Plan 001; report
  measurements and proposed contract change before proceeding.

## Maintenance notes

Review algorithm correctness before micro-optimizing. Any future train behavior
must enter through service-availability variants, not source-name conditionals.
Plan 011 may populate the existing origin/destination candidate seam with
street-routed pedestrian durations; earlier plans must not populate it from
straight-line distance or unverified proximity.
