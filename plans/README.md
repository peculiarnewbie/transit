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
  010 Add multimodal routing and choose the production routing runtime

Phase 5 (optional, post-V1)
  011 Add street-routed pedestrian access and egress
```

Phase 1 plans intentionally own disjoint directories. They must not add
TanStack file routes or edit `src/routeTree.gen.ts`; Plan 007 is the first
integration gate that owns passenger API route generation. In Phase 3, Plan 009
must not add file routes, allowing it to run alongside Plan 008 without a
generated-route conflict.

## Execution order and status

| Plan | Title                                                 | Priority | Effort | Depends on      | Status      |
| ---- | ----------------------------------------------------- | -------: | -----: | --------------- | ----------- |
| 001  | Establish the Effect application foundation           |       P0 |      M | scaffold commit | DONE        |
| 002  | Compile TransJakarta GTFS into a canonical snapshot   |       P1 |      L | 001             | DONE        |
| 003  | Implement constrained bus routing and alternatives    |       P1 |      L | 001             | DONE        |
| 004  | Build the low-bandwidth passenger map shell           |       P1 |      L | 001             | DONE        |
| 005  | Migrate official train-source adapters                |       P1 |      L | 001             | DONE        |
| 006  | Build revisioned curation persistence                 |       P1 |      L | 001             | DONE        |
| 007  | Integrate the bus-routing vertical slice              |       P1 |      L | 002, 003, 004   | IN PROGRESS |
| 008  | Build the protected station/topology editor           |       P1 |      L | 004, 006, 007   | TODO        |
| 009  | Project imported and curated trains into the network  |       P1 |      L | 005, 006        | TODO        |
| 010  | Add multimodal routing and choose the routing runtime |       P2 |     XL | 007, 008, 009   | TODO        |
| 011  | Add street-routed pedestrian access and egress        |       P3 |     XL | 010             | TODO        |

Status values: `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED: <reason>`, or
`REJECTED: <reason>`.

## Completion integrity protocol

Plan scope is a contract, not a theme. Executors must not narrow plural or
system-wide requirements to one convenient example and then mark the plan
`DONE`. A route, line, mode, provider, workflow, or source named in a plan is
incomplete until the implementation and evidence cover the representative set
defined by that plan.

Before changing a plan to `DONE`, the executor must add a completion report to
the plan containing:

1. A scope matrix mapping every step and done criterion to implementation files
   and verification evidence.
2. Counts and identities for the real entities exercised where the plan works
   with imported or production data: sources, systems, routes/lines, patterns,
   stops/stations, transfers, and validation findings as applicable.
3. The exact verification commands run and their results. A fixture-only unit
   test is not evidence that a real-data integration requirement is complete.
4. An explicit list of omitted, stubbed, fixture-only, hard-coded, manually
   bypassed, or degraded behavior. Any in-scope item in this list keeps the plan
   `IN PROGRESS` or makes it `BLOCKED`; it cannot be `DONE`.
5. A diff audit confirming that no out-of-scope shortcut replaced the required
   architecture or silently weakened an existing test/assertion.

Passing tests is necessary but not sufficient. Tests that exercise only one
route, line, mode, happy path, or hand-built fixture do not prove a plural or
network-wide requirement. Executors must add representative integration tests
and, when the plan consumes real artifacts, run a deterministic audit over the
whole supplied artifact. Sampling is allowed only when the plan explicitly
defines the sample and why it is representative.

If most of a plan works but any done criterion does not, leave its status as
`IN PROGRESS` and report the remaining gap precisely. Reviewers should reject a
`DONE` transition when its completion report cannot independently substantiate
every checkbox.

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
- The V1 passenger product routes between explicitly selected transit stops or
  stations. Map clicks select transit markers, not arbitrary coordinates.
  Access from an arbitrary origin and egress to an arbitrary destination are
  deferred to Plan 011.
- V1 walking legs come only from explicit published transfer edges. Geographic
  proximity may bound stop display/search, but it must not create a transfer,
  walking duration, or claim of pedestrian feasibility.
- Plan 007 ships routing in an ordinary Cloudflare Worker first. Plan 010 then
  measures that baseline against a browser Web Worker using the same TypeScript
  core; a Cloudflare Container is the fallback only when both ordinary Worker
  and client-device gates fail.
- Browser routing, if selected, downloads one compact versioned topology graph
  after the first journey interaction and caches it by content hash. Geometry
  remains separate and lazy; query-specific graph fragments are rejected
  because they can omit valid transfer paths.
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
after mount. Cloudflare Workers initially remain responsible for typed API
routes, artifact delivery, scheduled/import work, and authentication boundaries.
Plan 010 may move only the routing calculation into a browser Web Worker after
measured first-use and low-end-device gates pass; the page remains SPA-only
either way.

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
- **Estimate pedestrian access with straight-line distance:** rejected because
  rivers, toll roads, railway corridors, barriers, gates, and missing crossings
  make geometric proximity an unsafe proxy for a Jakarta walking route. Plan
  011 requires a routed pedestrian graph and has no straight-line fallback.
