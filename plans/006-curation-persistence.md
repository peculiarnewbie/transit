# Plan 006: Build revisioned curation persistence

> **Executor instructions**: Implement the curation domain and D1 service only.
> Do not build admin pages or add TanStack routes in this lane.
>
> **Drift check**: `git diff --stat 07703bb..HEAD -- src/db src/curation drizzle wrangler.jsonc worker-configuration.d.ts`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 001
- **Category**: feature / persistence / correctness
- **Planned at**: commit `07703bb`, 2026-07-18

## Why this matters

Train coordinates, ordered topology, aliases, and transfers require human
curation. Imported evidence must remain immutable while edits are versioned,
auditable, previewable, and publishable. This service is the authoritative
boundary that prevents a refresh from overwriting manual work.

## Current state

`src/db/schema.ts` contains only:

```ts
export const healthChecks = sqliteTable("health_checks", {
  id: integer("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});
```

`wrangler.jsonc` has no D1 binding, although Drizzle scripts are present.
SolidStart deploys to Cloudflare Workers and observability is enabled.

## Commands

| Purpose            | Command                     | Expected result                          |
| ------------------ | --------------------------- | ---------------------------------------- |
| Generate migration | `npm run db:generate`       | deterministic migration under `drizzle/` |
| Apply locally      | `npm run db:migrate:local`  | exit 0 against local D1                  |
| Service tests      | `npm test -- src/curation`  | all pass                                 |
| Full verification  | `npm run check && npm test` | exit 0                                   |

## Scope

**In scope**:

- `src/db/schema.ts`
- `src/curation/**` (create)
- `drizzle/**` migrations
- `wrangler.jsonc` D1 binding declaration
- `worker-configuration.d.ts` regenerated binding types
- local integration tests and fixtures

**Out of scope**:

- Admin UI or file routes
- Source scrapers and GTFS compiler
- Routing or MapLibre
- Authentication implementation
- Editing raw import artifacts

## Git workflow

- Branch/worktree: `work/006-curation-persistence`
- Suggested commit: `feat(curation): add revisioned transit data overrides`

## Steps

### Step 1: Model immutable imports and curated identities

Add normalized tables for import runs/source records and curated physical
places. Keep source station identity separate from physical place and boarding
point identity. Include source IDs, content hashes, retrieved timestamps,
provenance, and import status.

Do not store provider payload blobs in arbitrary text columns unless needed for
audit; prefer a content-addressed artifact reference.

**Verify**: schema constraints prevent two active mappings for the same source
record and preserve multiple source records mapped to one physical place.

### Step 2: Model draft revisions and operations

Add revision, station placement, alias, ordered line topology, branch/direction,
boarding point, and explicit transfer records. Every edit records actor,
timestamp, base revision, and notes. Placement status is unresolved,
approximate, or verified.

Use integer microdegrees or validated numeric storage consistently; do not mix
latitude/longitude order. Transfers include endpoints, walking duration,
directionality, accessibility/notes, and verification state.

**Verify**: database constraints reject invalid coordinates, duplicate sequence
positions, self-transfers, and edits against nonexistent revisions.

### Step 3: Implement Effect repositories and curation service

Wrap Drizzle/D1 in `Context.Service` repositories with named Effect methods and
typed persistence/conflict/not-found/validation errors. Decode nontrivial rows
through Schema. Keep provider/network work outside transactions.

Use the pinned `drizzle-orm/d1` adapter. It is Promise-based; Drizzle's native
Effect driver does not support D1. Convert its operations with `Effect.tryPromise`
at the repository boundary and map failures into the repository's typed errors.
Do not call `Effect.runPromise` inside repositories or services.

Implement draft creation, optimistic revision editing, preview reads, validation,
publish, and rollback-to-new-draft. Publishing is atomic: either one validated
revision becomes current or nothing changes.

**Verify**: integration tests use a real local SQLite/D1-compatible database,
not mocked query methods.

### Step 4: Add publication validation

Block publication for unresolved stations used in active topology, missing
ordered stops, duplicate consecutive stops, dangling transfers, impossible
coordinates, and source mappings whose imported records disappeared. Warnings
may include large geographic jumps and stale provenance but must be explicit.

**Verify**: each invariant has a failing test and one valid network publishes.

### Step 5: Configure local and deployed D1 boundaries

Add a named `DB` binding and typed configuration without inventing production
IDs. Document commands for the operator to create/bind the real database. Tests
must use local configuration and never contact production.

**Verify**: local migration and integration tests pass from a clean local D1
state.

## Done criteria

- [ ] Raw import evidence and curated overrides are separate.
- [ ] Physical places, boarding points, and source stations are distinct.
- [ ] Draft/publish uses optimistic concurrency and atomic publication.
- [ ] All specified invariants have integration tests.
- [ ] D1 binding is typed without committed secrets or invented production ID.
- [ ] No routes, UI, importer, or routing files changed.
- [ ] `npm run check && npm test` passes.

## STOP conditions

- Production D1 identifiers are required; ask the operator instead of guessing.
- Drizzle beta APIs differ enough that migrations cannot be tested locally.
- A curation invariant depends on unknown product policy; encode it as a warning
  and report, rather than silently choosing destructive behavior.

## Maintenance notes

Never update imported source rows to apply a correction. New import runs and new
curation revisions should make every published graph reproducible.
