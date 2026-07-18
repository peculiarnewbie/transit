# Transit implementation plans

Originally generated on 2026-07-18 from commit `07703bb`; reconciled at commit
`b626253` with the active Plan 007 work and the complete production GTFS audit.
These plans turn the Cloudflare Workers + SolidStart + D1 + Effect application
into a usable Jakarta bus route helper first, then a multimodal bus + train +
street-routed walking product.

## Human prerequisite: commit the scaffold

Before creating any worktree, commit the current scaffold, including
`package.json`, `package-lock.json`, `src/`, `wrangler.jsonc`, `.agents/`, and
`skills-lock.json`. At the time these plans were written, nearly all of those
files were untracked relative to `07703bb`; a worktree created from the current
HEAD would contain only the original one-line README.

After committing, compare the committed files with the current-state excerpts
in Plan 001. If they match, the new commit is the effective baseline even though
the plans' drift checks name `07703bb`.

## Execution phases and parallel lanes

```text
Phase 0 (serial)
  001 Effect foundation and shared contracts

Phase 1 (parallel, one worktree each)
  lane/gtfs       002 Compile TransJakarta GTFS
  lane/routing    003 Implement routing core
  lane/passenger  004 Build passenger map shell
  lane/trains     005 Migrate train source adapters
  lane/curation   006 Build curation persistence service

Phase 2 (current technical baseline)
  007 Integrate the original stop/timetable bus slice

Phase 3 (usable bus midpoint)
  serial          012 Fix the route-helper product contract and real corpus
  serial          013 Project canonical transit places/direction evidence

  parallel, after 013
    lane/places   014 Build broad geographic place discovery
    lane/guides   015 Build time-independent bus route guidance

  serial, after both lanes merge
                  016 Integrate and qualify the public bus route helper

Phase 4 (parallel, after the usable bus release)
  lane/admin      008 Build protected curation editor
  lane/projection 009 Publish curated train graph

Phase 5 (serial)
  010 Add combined bus/train routing and choose the production runtime

Phase 6 (serial, committed destination)
  011 Add street-routed pedestrian access and egress
```

Phase 1 plans intentionally own disjoint directories. They must not add
TanStack file routes or edit `src/routeTree.gen.ts`; Plan 007 is the first
technical integration gate that owns passenger API route generation. Plan 013
is a shared contract gate. Plans 014 and 015 then own disjoint place-discovery
and route-guide paths and may run from the same Plan 013 merge commit; neither
may edit runtime routes or passenger UI. Plan 016 is the only midpoint lane that
joins those contracts and owns the release UX. After it merges, Plan 009 must
not add file routes, allowing it to run alongside Plan 008 without a generated-
route conflict.

## Execution order and status

| Plan | Title                                                  | Priority | Effort | Depends on       | Status      |
| ---- | ------------------------------------------------------ | -------: | -----: | ---------------- | ----------- |
| 001  | Establish the Effect application foundation            |       P0 |      M | scaffold commit  | DONE        |
| 002  | Compile TransJakarta GTFS into a canonical snapshot    |       P1 |      L | 001              | DONE        |
| 003  | Implement constrained bus routing and alternatives     |       P1 |      L | 001              | DONE        |
| 004  | Build the low-bandwidth passenger map shell            |       P1 |      L | 001              | DONE        |
| 005  | Migrate official train-source adapters                 |       P1 |      L | 001              | DONE        |
| 006  | Build revisioned curation persistence                  |       P1 |      L | 001              | DONE        |
| 007  | Integrate the original bus-routing technical slice     |       P1 |      L | 002, 003, 004    | IN PROGRESS |
| 012  | Define the usable bus route-helper contract and corpus |       P0 |      M | 001–007 baseline | DONE        |
| 013  | Project canonical transit places and guidance evidence |       P0 |      L | 002, 012         | DONE        |
| 014  | Build broad geographic passenger-place discovery       |       P0 |      L | 012, 013         | DONE        |
| 015  | Build time-independent bus route guidance              |       P0 |     XL | 012, 013         | IN PROGRESS |
| 016  | Integrate and release the usable bus route helper      |       P0 |     XL | 014, 015         | TODO        |
| 008  | Build the protected station/topology editor            |       P1 |      L | 004, 006, 016    | TODO        |
| 009  | Project imported and curated trains into the network   |       P1 |      L | 005, 006, 016    | TODO        |
| 010  | Add multimodal routing and choose the routing runtime  |       P2 |     XL | 008, 009, 016    | TODO        |
| 011  | Add street-routed pedestrian access and egress         |       P3 |     XL | 010              | TODO        |

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

1. Create parallel lanes from the exact shared prerequisite merge commit.
2. Keep commits limited to each plan's in-scope paths.
3. Merge parallel lanes one at a time and run `npm run check` and `npm test`
   after every merge.
4. Resolve shared barrel exports in the receiving branch, not independently in
   every lane. Plan 016 owns the route-helper runtime composition.
5. Regenerate `src/routeTree.gen.ts` only in plans that explicitly own routes.
6. Do not start Plans 014 or 015 until Plan 013's contracts merge. Do not start
   Plans 008 or 009 until Plan 016 passes its release gate.

## Architectural decisions encoded by these plans

- Raw imports are immutable evidence; human edits are separate curated
  revisions.
- GTFS is an input format, not the application domain model.
- The routing engine consumes canonical snapshots and does not know whether a
  record came from GTFS, KRL, MRT, LRT, D1, or a fixture.
- PMTiles is for map display, not routing storage.
- TanStack Start runs in SPA mode for all passenger and admin pages. The Worker
  serves the static app shell and API/server routes; page content is not SSR'd.
- The committed destination is multimodal bus + train + street-routed walking.
- Before that, Plan 016 ships a genuinely usable, time-independent TransJakarta
  bus route helper. It accepts passenger places and areas and explains lines,
  directions, boarding/alighting places, intermediate stops, and transfers.
- Geographic places resolve to bounded nearby transit choices. Straight-line
  distance may rank or describe those choices but must never create a transfer,
  walking duration, pedestrian feasibility claim, or street direction.
- Recognized places remain visible when the current graph cannot route them;
  reachability is not a search filter.
- The midpoint has no timetable, departure/arrival selection, live vehicle,
  fare, or user-facing trip/wait/walk duration. The scheduled routing core is
  retained as a later capability, not used to fabricate precision in Plan 016.
- Canonical transit places are passenger display/boarding concepts. Grouping
  platforms does not itself authorize a transfer.
- The midpoint endpoint selector follows the familiar map-product interaction:
  a floating top control on mobile, a floating side panel on desktop,
  autocomplete directly below the active input, and one obvious atomic
  origin/destination reverse action. The project borrows the interaction model,
  not another product's branding or visual assets.
- Lines that require the same boarding, alighting, and next passenger action
  are presented as interchangeable options inside one ride step (for example,
  “9 or 9A”), while line-specific direction and intermediate-stop evidence is
  retained. Different platforms or onward actions must remain separate.
- Plan 007 establishes an ordinary Cloudflare Worker technical baseline. Plan
  016 qualifies the bus-only release; Plan 010 then
  measures that baseline against a browser Web Worker using the same TypeScript
  core; a Cloudflare Container is the fallback only when both ordinary Worker
  and client-device gates fail.
- Plans 010 and 011 must preserve the static bus route helper as a complete
  fallback when multimodal schedules or pedestrian routing are unavailable.
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
