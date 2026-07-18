# Plan 009: Publish imported and curated trains as a canonical network

> **Executor instructions**: This plan may run in parallel with Plan 008 after
> Plans 005 and 006 merge. It must not add file routes or edit
> `src/routeTree.gen.ts`.
> A projection of one hand-picked route or one train system is not completion.
> The implementation must process every supported imported system (KRL, MRT,
> and LRT) and every route/pattern present in the supplied snapshots, reporting
> unresolved data rather than silently skipping it.
>
> **Drift check**: `git diff --stat 07703bb..HEAD -- src/import/train src/curation src/projection/train`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plans 005, 006
- **Category**: feature / data projection / correctness
- **Planned at**: commit `07703bb`, 2026-07-18

## Why this matters

Train source snapshots and human corrections are intentionally separate. This
projection is the only place that may combine them into a publishable canonical
network, making the result reproducible and keeping routing free of
source-specific guesses.

## Current state

Plan 005 emits typed KRL/MRT/LRT source snapshots with incomplete service states.
Plan 006 stores physical places, boarding points, ordered topology, transfers,
and published revisions. Neither is directly routable until combined and
validated.

## Commands

| Purpose           | Command                            | Expected result |
| ----------------- | ---------------------------------- | --------------- |
| Projection tests  | `npm test -- src/projection/train` | all pass        |
| Full verification | `npm run check && npm test`        | exit 0          |

## Scope

**In scope**:

- `src/projection/train/**` (create)
- projection fixtures/tests
- service methods in `src/curation/**` only if already anticipated and backward
  compatible; otherwise stop and report

**Out of scope**:

- Admin UI or any file routes
- Passenger routing/runtime integration
- Scraper behavior
- Invented coordinates, topology, schedules, or transfers

## Git workflow

- Branch/worktree: `work/009-train-projection`
- Suggested commit: `feat(trains): project curated train network snapshots`

## Steps

### Step 1: Join source identities to curated physical places

Resolve every active source station through the published curation revision.
Emit typed unresolved/orphan/stale-source validation findings rather than
dropping records. Preserve all source refs on canonical stops.

**Verify**: tests cover many-source-to-one-place, missing mapping, stale source
ID, and unmapped newly imported station.

### Step 2: Project ordered train route patterns

Use only published ordered topology. Expand branches/directions into distinct
patterns with stable IDs. Attach station observations to patterns when the
source evidence supports the association.

Never reuse KRL alphabetical route station arrays. Never infer MRT/LRT ordering
from coordinates alone.

**Verify**: branch/direction fixtures produce exact ordered patterns and stable
IDs across identical runs.

### Step 3: Reconstruct only defensible service data

For KRL, group observations by train ID and order station calls by service-day
time, rejecting contradictory sequences. For MRT/LRT, retain scheduled or
frequency information only to the precision supported by the source.

When exact through-trips cannot be established, emit `FrequencyOnly` or
`TopologyOnly`, not fabricated `Scheduled` trips.

**Verify**: tests cover midnight rollover, duplicate observations,
contradictions, partial station scrapes, and honest degradation.

### Step 4: Add curated transfers and validation report

Project only published transfers, retaining direction and walking duration.
Produce blocking errors for active route stations without placed coordinates or
ordered topology; warnings for stale import age and large geographic jumps.

**Verify**: invalid projection cannot be marked publishable; a complete fixture
emits a canonical `NetworkSnapshot` that decodes successfully.

### Step 5: Make output deterministic and version-addressed

Hash the train import content plus curation revision and schema version. Stable
inputs must produce byte-identical topology output for fixed generated time.

**Verify**: repeated projection produces identical content hash and JSON bytes.

## Done criteria

- [ ] Source snapshots and curated revision combine reproducibly.
- [ ] No unresolved active station is silently dropped.
- [ ] Route patterns preserve curated order and branches.
- [ ] Service precision is never overstated.
- [ ] Output is deterministic, versioned, and Schema-decodable.
- [ ] No route/UI/runtime files changed.
- [ ] `npm run check && npm test` passes.
- [ ] A whole-artifact audit reports input and output counts by system, route,
      pattern, station, service-precision variant, and transfer, plus every
      skipped or unresolved record.
- [ ] Representative integration evidence covers KRL, MRT, and LRT and more
      than one route/pattern wherever the supplied source contains them; a
      single-route or fixture-only projection keeps status `IN PROGRESS`.
- [ ] A completion report satisfies the repository completion integrity
      protocol and explains any count mismatch without silent filtering.

## STOP conditions

- Published curation lacks required identity or topology data.
- KRL observations cannot defensibly reconstruct trip order.
- A projection needs direct database access not exposed by Plan 006 services.

## Maintenance notes

Every published train snapshot should be traceable to both an import hash and a
curation revision. Treat source changes as new evidence, never as instructions
to erase overrides.
