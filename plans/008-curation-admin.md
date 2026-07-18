# Plan 008: Build the protected station and topology editor

> **Executor instructions**: Merge Plans 004, 006, and 007 first. This plan owns
> all `/admin` routes, admin APIs, and route-tree generation. It edits curation
> through the service from Plan 006; it never edits imported JSON.
> Do not call this plan complete after implementing only one editor screen or
> one mutation. Placement, identity mapping, topology/branches, transfers,
> preview/validation, publication, and server-side authorization must each work
> end to end through the UI, API, and curation service.
>
> **Drift check**: `git diff --stat 07703bb..HEAD -- src/routes/admin src/routes/api/admin src/features/admin src/routeTree.gen.ts wrangler.jsonc`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plans 004, 006, 007
- **Category**: internal tooling / security / feature
- **Planned at**: commit `07703bb`, 2026-07-18

## Why this matters

Train routing cannot be made trustworthy without human placement, ordered
topology, identity matching, and transfer curation. The editor must make those
tasks fast while retaining revision history and preventing unauthorized or
accidental publication.

## Current state

Plan 006 provides draft/revision/publish services and D1 persistence. Plan 004
provides reusable MapLibre patterns. Plan 007 owns the existing passenger
routes. No authentication convention exists in the scaffold.

## Commands

| Purpose           | Command                                               | Expected result                   |
| ----------------- | ----------------------------------------------------- | --------------------------------- |
| Generate routes   | `npm run generate-routes`                             | admin routes appear in route tree |
| Admin tests       | `npm test -- src/features/admin src/routes/api/admin` | all pass                          |
| Full verification | `npm run check && npm test && npm run build`          | exit 0                            |

## Scope

**In scope**:

- `src/features/admin/**` (create)
- `src/routes/admin/**` and `src/routes/api/admin/**` (create)
- `src/routeTree.gen.ts` generated changes
- `src/auth/**` minimal Cloudflare Access identity boundary (create)
- `wrangler.jsonc` non-secret environment names only
- admin tests

**Out of scope**:

- New curation tables or direct Drizzle calls from handlers/components
- Source scraper changes
- Passenger routing behavior
- A general user/account system
- Storing Cloudflare Access secrets in Git

## Git workflow

- Branch/worktree: `work/008-curation-admin`
- Suggested commit: `feat(admin): add revisioned transit network editor`

## Steps

### Step 1: Protect every admin boundary

Use Cloudflare Access (or the deployment's established equivalent) for the
admin path. Validate trusted identity at the server boundary and pass a typed
actor into curation operations. Never rely on hidden navigation or client-side
checks. Admin pages remain client-rendered SPA routes, but every API mutation and
draft read is authorized on the Worker; lack of SSR is not an authentication
boundary. Development bypass must be explicit, local-only, and fail closed in
production.

**Verify**: route tests prove anonymous requests cannot read drafts or mutate,
invalid identity is rejected, and actor identity is recorded on edits.

### Step 2: Build the unresolved-station placement queue

Display imported unresolved stations by system with provenance and freshness.
Allow map click/drag placement, approximate/verified status, aliases, notes,
and mapping multiple source stations to one physical place. Use longitude,
latitude ordering consistently and show coordinates numerically before save.

Autosave only into a named draft with optimistic revision checks. Surface
conflicts rather than silently overwriting another editor.

**Verify**: component/API integration tests cover placement, correction,
identity merge, conflict, and undo via a new revision.

### Step 3: Build ordered line topology editing

Allow an editor to choose a system/line, append stations in travel order,
reorder, remove, split branches/directions, and preview line segments on the
map. Prevent alphabetical sorting. Display unresolved/missing stations inline.

**Verify**: tests preserve exact sequence, create two branch patterns, and block
duplicate consecutive stations.

### Step 4: Build explicit transfer editing

Allow directed or bidirectional links between physical places/boarding points,
with walking duration, accessibility/notes, and verification status. Suggest
nearby candidates as non-authoritative hints; saving always requires an explicit
editor action.

**Verify**: tests distinguish nearby suggestion from saved transfer and reject
self/dangling transfers.

### Step 5: Add preview, validation, and publish workflow

Render imported evidence plus draft overrides, show blocking errors and
warnings, compare against the currently published revision, and require a
deliberate publish confirmation. Publish through the service atomically.

**Verify**: invalid drafts cannot publish; valid publish records actor/revision;
passenger published reads do not see uncommitted drafts.

## Done criteria

- [ ] All admin server routes require verified identity.
- [ ] Admin pages remain SPA-only while admin APIs enforce server-side identity.
- [ ] Editors can place stations, map identities, order branches, and define
      explicit transfers.
- [ ] Drafts use optimistic concurrency and preserve audit history.
- [ ] Validation/preview precedes atomic publish.
- [ ] No imported source data is edited in place.
- [ ] Generated route tree and full verification pass.
- [ ] A completion report satisfies the repository completion integrity
      protocol and maps every admin workflow to UI, API, service, authorization,
      and integration-test evidence.
- [ ] The report identifies every planned admin workflow that remains stubbed,
      fixture-only, or inaccessible; if any exists, status remains
      `IN PROGRESS`.

## STOP conditions

- Cloudflare Access policy/domain details are unavailable; implement the typed
  boundary and tests, then stop before inventing production configuration.
- A required edit cannot be expressed through Plan 006 service methods; report
  the missing capability rather than querying D1 directly.
- Map suggestions would require a paid geocoder or exposed secret not approved
  by the operator.

## Maintenance notes

Admin usability directly affects data quality. Keep suggestions visibly
non-authoritative and preserve source evidence beside every human override.
