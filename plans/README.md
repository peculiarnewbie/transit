# Transit implementation plans

Generated on 2026-07-18 from commit `07703bb` plus the uncommitted application
scaffold currently present in the working tree. These plans turn the current
Cloudflare Workers + SolidStart + D1 + Effect scaffold into a Jakarta transit
router with bus-first routing, migrated train ingestion, and internal curation
tools.

## Human prerequisite: commit the scaffold

Before creating any worktree, commit the current scaffold, including
`package.json`, `package-lock.json`, `src/`, `wrangler.jsonc`, `.agents/`, and
`skills-lock.json`. At the time these plans were written, nearly all of those
files were untracked relative to `07703bb`; a worktree created from the current
HEAD would contain only the original one-line README.

After committing, compare the committed files with the current-state excerpts
in Plan 001. If they match, the new commit is the effective baseline even though
the plans' drift checks name `07703bb`.

## Execution phases and worktree lanes

```text
Phase 0 (serial)
  001 Effect foundation and shared contracts

Phase 1 (parallel, one worktree each)
  lane/gtfs       002 Compile TransJakarta GTFS
  lane/routing    003 Implement routing core
  lane/passenger  004 Build passenger map shell
  lane/trains     005 Migrate train source adapters
  lane/curation   006 Build curation persistence service

Phase 2 (after Phase 1 merges)
  007 Integrate bus routing vertically

Phase 3 (parallel, after required Phase 1 merges)
  lane/admin      008 Build protected curation editor
  lane/projection 009 Publish curated train graph

Phase 4 (serial)
  010 Add multimodal routing and production performance gates
```

Phase 1 plans intentionally own disjoint directories. They must not add
TanStack file routes or edit `src/routeTree.gen.ts`; Plan 007 is the first
integration gate that owns passenger API route generation. In Phase 3, Plan 009
must not add file routes, allowing it to run alongside Plan 008 without a
generated-route conflict.

## Execution order and status

| Plan | Title | Priority | Effort | Depends on | Status |
|---|---|---:|---:|---|---|
| 001 | Establish the Effect application foundation | P0 | M | scaffold commit | TODO |
| 002 | Compile TransJakarta GTFS into a canonical snapshot | P1 | L | 001 | TODO |
| 003 | Implement constrained bus routing and alternatives | P1 | L | 001 | TODO |
| 004 | Build the low-bandwidth passenger map shell | P1 | L | 001 | TODO |
| 005 | Migrate official train-source adapters | P1 | L | 001 | TODO |
| 006 | Build revisioned curation persistence | P1 | L | 001 | TODO |
| 007 | Integrate the bus-routing vertical slice | P1 | L | 002, 003, 004 | TODO |
| 008 | Build the protected station/topology editor | P1 | L | 004, 006, 007 | TODO |
| 009 | Project imported and curated trains into the network | P1 | L | 005, 006 | TODO |
| 010 | Add multimodal routing and performance gates | P2 | L | 007, 008, 009 | TODO |

Status values: `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED: <reason>`, or
`REJECTED: <reason>`.

## Merge protocol

1. Create each lane from the same committed Phase 0 result.
2. Keep commits limited to the plan's in-scope paths.
3. Merge Phase 1 lanes one at a time and run `npm run check` and `npm test`
   after every merge.
4. Resolve shared barrel exports in the receiving branch, not independently in
   every lane. Plan 007 owns the first whole-app runtime composition.
5. Regenerate `src/routeTree.gen.ts` only in plans that explicitly own routes.

## Architectural decisions encoded by these plans

- Raw imports are immutable evidence; human edits are separate curated
  revisions.
- GTFS is an input format, not the application domain model.
- The routing engine consumes canonical snapshots and does not know whether a
  record came from GTFS, KRL, MRT, LRT, D1, or a fixture.
- PMTiles is for map display, not routing storage.
- TanStack Start runs in SPA mode for all passenger and admin pages. The Worker
  serves the static app shell and API/server routes; page content is not SSR'd.
- Bus routing ships before multimodal routing, while shared contracts remain
  mode-neutral.
- Incomplete train schedules are represented explicitly as `Scheduled`,
  `FrequencyOnly`, or `TopologyOnly` instead of inventing precision.
- Effect `Schema` validates every untrusted boundary; services use
  `Context.Service`, `Layer`, named `Effect.fn` methods, typed tagged errors,
  and deterministic Effect-aware tests.

## Frontend rendering constraint

Keep the existing `tanstackStart({ spa: { enabled: true } })` and
`defaultSsr: false` configuration. Do not add route-level SSR, server-rendered
map placeholders, hydration-time data loaders, or browser-global workarounds.
Passenger and admin pages render on the client; MapLibre is dynamically imported
after mount. Cloudflare Workers remain responsible for typed API routes,
artifact delivery, scheduled/import work, and authentication boundaries.

The app shell should be cacheable so repeat visits can open controls quickly,
but routing results and unpublished admin state must follow their own cache and
authorization policies.

## Findings considered and rejected

- **Make the existing train API a runtime dependency:** rejected because its
  endpoints are thin proxies over static JSON and would add latency, failure
  coupling, and duplicate public contracts.
- **Use PMTiles as the routing database:** rejected because spatial tile lookup
  cannot answer timetable and graph queries efficiently.
- **Wait for complete train data before bus routing:** rejected because it
  couples product validation to the least reliable data source.
- **Edit scraped train JSON in the admin tool:** rejected because every refresh
  could destroy human work and erase provenance.
