# Plan 001: Establish the Effect application foundation

> **Executor instructions**: Complete this plan before any parallel worktree is
> created. Run every verification command. Stop on any STOP condition rather
> than inventing a competing architecture. Update this plan's row in
> `plans/README.md` when complete.
>
> **Drift check**: `git diff --stat 07703bb..HEAD -- package.json src .agents wrangler.jsonc`
> The current scaffold was uncommitted when this plan was written. Proceed only
> after it has been committed and the excerpts below still match.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: committed scaffold baseline
- **Category**: architecture / tests / DX
- **Planned at**: commit `07703bb`, 2026-07-18

## Why this matters

Five worktrees need one stable domain vocabulary and one Effect module style.
Without this plan, every lane will invent IDs, errors, service tags, and test
runtime wiring, creating expensive merge-time reconciliation. This plan creates
only shared contracts and conventions; it deliberately avoids business logic.

## Current state

- `package.json` pins `effect` at `4.0.0-beta.99`, SolidStart, Drizzle, Vitest,
  and Cloudflare tooling. MapLibre and ZIP parsing packages are not installed.
- `src/db/schema.ts` contains only a `health_checks` table.
- `src/routes/index.tsx` uses `Effect.runSync(Effect.succeed(...))` as a scaffold
  demonstration; there is no runtime layer or application service.
- `.agents/skills/effect/SKILL.md` requires Effect v4 `Schema`,
  `Context.Service`, `Layer.effect`, named `Effect.fn`, tagged errors, boundary
  decoding, and deterministic tests.

Current excerpt from `src/routes/index.tsx`:

```ts
const greeting = Effect.runSync(Effect.succeed("Transit Worker is ready."));
```

Follow `.agents/skills/effect/references/SCHEMA.md`,
`SERVICES_LAYERS.md`, and `TESTING.md`.

## Commands

| Purpose | Command | Expected result |
|---|---|---|
| Install planned shared dependencies | `npm install maplibre-gl pmtiles fflate` | exit 0; lockfile updated |
| Typecheck/lint/format | `npm run check` | exit 0 |
| Tests | `npm test` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:

- `package.json`, `package-lock.json`
- `src/domain/transit/**` (create)
- `src/lib/effect/**` (create)
- `src/testing/**` (create)
- `src/domain/transit/**/*.test.ts` (create)
- `AGENTS.md` (create only if no equivalent project instructions exist)

**Out of scope**:

- `src/db/schema.ts`, Drizzle migrations, or D1 bindings
- File routes and `src/routeTree.gen.ts`
- GTFS parsing, routing algorithms, MapLibre components, scrapers
- Any copied production data

## Git workflow

- Branch: `work/001-effect-foundation`
- Commit style: conventional commits; use `feat(domain): establish transit contracts`
- Do not push or deploy unless instructed.

## Steps

### Step 1: Install shared dependencies before lanes branch

Install `maplibre-gl`, `pmtiles`, and `fflate` now so Phase 1 worktrees never
independently edit `package.json` for known dependencies.

**Verify**: `npm ls maplibre-gl pmtiles fflate` reports one installed version of
each and exits 0.

### Step 2: Define canonical boundary schemas

Create small leaf modules under `src/domain/transit/` for branded IDs, source
provenance, modes, stops, routes, ordered route patterns, trips, stop times,
transfers, service calendars, geometries, and network snapshots.

Required shapes:

- Branded string schemas: `AgencyId`, `StopId`, `RouteId`, `RoutePatternId`,
  `TripId`, `ServiceId`, and `SourceRecordId`.
- `TransitMode`: at least `Bus`, `CommuterRail`, `Mrt`, `Lrt`, and `Walk`.
- `SourceRef`: source system, original identifier, retrieval timestamp, and
  source URL/name without secrets.
- `Stop`: canonical ID, source refs, name, optional placed coordinates, and
  placement state.
- `RoutePattern`: ordered stop IDs; never a set or alphabetically sorted list.
- `ServiceAvailability`: a `Schema.TaggedUnion` with `Scheduled`,
  `FrequencyOnly`, and `TopologyOnly` variants.
- `NetworkSnapshot`: schema version, generated timestamp, and normalized
  collections needed by routing.

Use `Schema.Struct(...)` plus same-name interfaces. Decode unknown input with
`Schema.decodeUnknownEffect`. No unchecked casts, `any`, or non-null assertions.

**Verify**: `npx tsc --noEmit` exits 0.

### Step 3: Establish the Effect service module convention

Create `src/lib/effect/operation-error.ts` for the minimal shared helper needed
to map adapter failures into operation-labelled `Schema.TaggedErrorClass`
instances. Do not create a generic service framework.

Add an `AGENTS.md` section that states:

- public and non-trivial methods use `Effect.fn("Domain.operation")`;
- multi-step workflows use `Effect.gen`, while `.pipe` wraps tracing, retry,
  and typed recovery;
- dependencies use `Context.Service` and explicit layers;
- HTTP handlers remain thin;
- raw inputs, persisted snapshots, and API bodies are Schema-decoded;
- tests avoid real sleeps and global environment mutation.

Reference the repository-local Effect skill instead of copying it wholesale.

**Verify**: `rg -n "Effect.fn|Context.Service|Schema.TaggedErrorClass" src/lib src/domain AGENTS.md`
returns the intended examples/conventions and no application service stubs.

### Step 4: Add an Effect-aware Vitest harness

Inspect the pinned Effect v4 package before choosing an adapter. If it exposes
a supported Vitest integration, use it. Otherwise create one small local helper
that runs scoped effects through `Effect.runPromise`, preserves typed failures,
and lets tests provide explicit layers. Document the deviation from the skill's
preferred `it.effect` syntax.

Write tests proving branded IDs reject empty values, route patterns preserve
order, incomplete coordinates remain explicit, and every
`ServiceAvailability` case decodes and matches exhaustively.

**Verify**: `npm test -- src/domain/transit` exits 0 with at least eight tests.

### Step 5: Verify the baseline and commit it

Run all checks and ensure no generated or build output is accidentally staged.

**Verify**: `npm run check && npm test && npm run build` exits 0.

## Done criteria

- [ ] Shared transit schemas exist and are exported from one domain barrel.
- [ ] Ordered route patterns and incomplete train service states are explicit.
- [ ] No persistence, parsing, routing, or UI behavior was added.
- [ ] At least eight domain tests pass.
- [ ] MapLibre, PMTiles, and fflate are installed once in the serial baseline.
- [ ] `npm run check`, `npm test`, and `npm run build` all pass.
- [ ] Only in-scope files changed.

## STOP conditions

- The scaffold has not been committed, so a new worktree cannot see it.
- The pinned Effect version contradicts the local skill examples in a way that
  requires upgrading Effect.
- A proposed shared model depends on details available only from one importer.
- A verification command fails twice after a reasonable correction.

## Maintenance notes

Keep the domain layer independent of Drizzle rows and HTTP DTOs. Importers may
reuse domain fields, but raw provider schemas belong beside their adapters.
Reviewers should reject abstractions with only hypothetical consumers.

