# Plan 012: Define the usable bus route-helper contract and acceptance corpus

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. This is the serial product-contract gate for Plans 013–016. Do not
> implement passenger search, routing, HTTP routes, or UI in this plan. If
> anything in the "STOP conditions" section occurs, stop and report rather than
> inventing product behavior. When done, update this plan's status row in
> `plans/README.md` unless a reviewer says they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b626253..HEAD -- plans src/runtime/api-contracts.ts src/routing src/features/passenger test/fixtures`
> and
> `git diff --stat -- plans src/runtime/api-contracts.ts src/routing src/features/passenger test/fixtures`.
> This plan was written while Plan 007 had uncommitted work in those paths. If
> the current contracts no longer match the excerpts below, update only this
> plan's contract artifacts after reporting the drift; do not adapt production
> code in this lane.

## Status

- **Status**: DONE
- **Priority**: P0
- **Effort**: M
- **Risk**: LOW
- **Depends on**: Plans 001–007 as the current technical baseline; may start while Plan 007 is still being reconciled
- **Category**: direction / tests / product contract
- **Planned at**: commit `b626253`, 2026-07-18

## Why this matters

The repository can compile and route TransJakarta data, but its current public
contract describes a timetable journey planner and its acceptance evidence is
dominated by hand-built fixtures. The required middle milestone is different:
an unfamiliar passenger must be able to express an ordinary Jakarta place and
receive clear, time-independent bus route guidance. This plan fixes the product
boundary and creates reviewed real-world evidence before parallel lanes build
more code around the wrong assumptions.

This is an intermediate milestone, not the final destination. Plans 008–011
remain the path to combined bus, train, and street-routed walking. The route
helper established here must remain a useful fallback inside that later
multimodal product.

## Current state

- `src/runtime/api-contracts.ts:19-52` models `Stop | Coordinate` journey
  endpoints but requires `serviceDate` and `departureSeconds` for every query.
- `src/routing/model.ts:45-55` makes date/time and line constraints fundamental
  to `RoutingQuery`.
- `src/runtime/api-contracts.ts:73-105` returns minutes and walk estimates but
  does not return a passenger-facing headsign, boarding platform, alighting
  platform, or intermediate stop sequence.
- `src/features/passenger/types.ts:33-44` exposes stop search and journey search,
  not a unified passenger-place search contract.
- `src/runtime/bus-integration.test.tsx` primarily exercises the small
  `bus-demo-20260718-v1` artifact; Plan 007's completion audit records that this
  does not establish full-network usability.
- The production feed contains 8,243 placed stops, 256 routes, 719 patterns,
  730 trips, and 14 explicit transfers. All 730 trips carry a non-empty
  `trip_headsign`; this is useful direction evidence even though exact timetable
  behavior is out of scope for the middle milestone.

Repository conventions to retain in later plans are documented in `AGENTS.md`:
boundary data uses Effect `Schema`, non-trivial operations use named
`Effect.fn`, services use `Context.Service` and explicit `Layer` values, and
tests use explicit Effect-aware test layers. This plan should encode those
requirements but should not add production services itself.

## Commands you will need

| Purpose             | Command                                   | Expected on success                  |
| ------------------- | ----------------------------------------- | ------------------------------------ |
| Corpus/schema tests | `npm test -- src/acceptance/route-helper` | all route-helper contract tests pass |
| Typecheck           | `npx tsc --noEmit`                        | exit 0, no errors                    |
| Lint                | `npx oxlint .`                            | exit 0                               |
| Full tests          | `npm test`                                | all tests pass                       |

## Suggested executor toolkit

- Use the repository-local `effect` skill when defining corpus schemas.
- Use `quality-code` if available when designing branded IDs and discriminated
  unions for long-lived acceptance data.
- Do not use a frontend skill in this plan; production UI is Plan 016.

## Scope

**In scope** (the only paths this plan may modify):

- `docs/product/route-helper-contract.md` (create)
- `src/acceptance/route-helper/**` (create)
- `test/fixtures/route-helper/**` (create)
- `plans/012-route-helper-contract-and-corpus.md`
- `plans/README.md` status only

**Out of scope**:

- `src/domain/**`, `src/import/**`, `src/discovery/**`, `src/routing/**`
- `src/runtime/**`, `src/routes/**`, `src/features/**`, `src/components/**`
- Modifying the active artifact or production GTFS compiler
- Timetables, departure/arrival times, real-time vehicles, fares, or pedestrian
  routing
- Hand-curating a production place catalog; reviewed corpus cases are tests,
  not product search data
- Plans 008–011 implementation

## Git workflow

- Branch: `work/012-route-helper-contract`
- Suggested commit: `test(product): define route helper acceptance contract`
- Do not push or open a PR unless the operator requests it.

## Steps

### Step 1: Write the middle-milestone product contract

Create `docs/product/route-helper-contract.md`. State all of the following
normatively:

- The middle milestone is a TransJakarta bus route helper, not a timetable or
  live journey planner.
- The final roadmap remains multimodal bus + train + street-routed walk.
- Passenger inputs may be a transit place, neighbourhood/administrative area,
  landmark/POI, map point, or device coordinate.
- A geographic place resolves to a bounded set of nearby transit boarding
  places. Straight-line distance may rank or describe "nearby" but must never
  be shown as walking time, pedestrian feasibility, or street directions.
- A passenger does not need to know a GTFS stop name or ID.
- Search must never hide a recognized destination merely because the current
  graph cannot route to it.
- Every returned transit leg must identify the route/line, direction or
  headsign, boarding place, alighting place, and ordered intermediate stops.
- When several lines require the same passenger action—board at the same
  boarding point, alight at the same place, and continue with the same next
  action—the guide groups them into one ride step and clearly says that any of
  the listed lines is usable. It retains line-specific direction and stop
  details instead of pretending the services are operationally identical.
- Results rank meaningful route sequences, not scheduled trip instances.
- Exact departure, arrival, wait, trip, and walking time are absent.
- Failure preserves both passenger inputs, identifies whether place discovery
  or route coverage failed, and offers nearby transit choices or endpoint edits.
- The deployed product clearly states bus-only coverage, artifact freshness,
  and unsupported capabilities.
- The route-helper contract remains available as a fallback when Plans 010 and
  011 add multimodal and street-routing behavior.

Include three complete examples: a direct route, a transfer route, and a
recognized-place/no-route result. Examples must use passenger instructions,
not internal IDs or timetable fields.

**Verify**: `rg -n "time-independent|headsign|nearby|must never|multimodal" docs/product/route-helper-contract.md` finds the corresponding normative sections.

### Step 2: Define machine-readable corpus schemas

Under `src/acceptance/route-helper/`, define schemas and parsers for:

- `PlaceSearchCase`: stable case ID, passenger query, optional coordinate,
  expected recognized place names/types/localities, forbidden duplicate labels,
  and rationale/source-review note.
- `RouteGuideCase`: stable case ID, origin passenger place, destination
  passenger place, expected outcome (`Supported` or `KnownGap`), acceptable
  ordered ride-step sequences (including expected interchangeable line-option
  groups and line-specific headsigns), maximum transfer count, required
  boarding and alighting place labels, and rationale/source-review note.
- `UsabilityTask`: stable task ID, scenario stated without stop names, expected
  passenger goal, and objective completion criteria.
- `CorpusManifest`: schema version, reviewed-at date, reviewer identifier or
  role, source artifact version, counts, and the three fixture URLs/paths.

Use `Schema.Struct` and `Schema.TaggedUnion`, branded case IDs, and
`Schema.decodeUnknownEffect` at fixture boundaries. Add a named
`Effect.fn("RouteHelperCorpus.load")` operation that loads already-supplied
JSON text/unknown values; do not add filesystem or network authority to the
service.

Reject duplicate IDs, empty acceptable sequences, a `KnownGap` with fake route
instructions, an interchangeable group with fewer than two distinct lines,
corpus references to nonexistent task/case IDs, and manifests whose declared
counts do not match decoded arrays.

**Verify**: `npm test -- src/acceptance/route-helper` passes schema round-trip,
duplicate-ID, count-mismatch, malformed-case, and deterministic-order tests.

### Step 3: Build the reviewed place-search corpus

Create at least 60 search cases distributed across:

- all five Jakarta administrative cities plus representative edge coverage in
  the supplied TransJakarta network;
- neighbourhoods and administrative areas;
- major landmarks, markets, malls, campuses, hospitals, stadiums, terminals,
  and rail stations;
- exact stop/station names;
- Indonesian abbreviations such as `St.`, `Jl.`, `Ps.`, and common expanded
  forms;
- at least 10 spelling/spacing/punctuation variants;
- at least 10 ambiguous names that require locality/type context;
- at least 10 queries that intentionally have no supported local result.

The corpus must include the audit examples `Kota Tua`, `Grand Indonesia`,
`Universitas Indonesia`, `Blok M`, `Bundaran HI`, `Tanah Abang`, and `Jakarta
International Stadium`. Expected results describe recognizable passenger
places, not whatever the current stop endpoint happens to return.

Review each case against the versioned source artifact and an independent
geographic reference. Store only attribution/reference metadata and the
expected normalized result; do not copy provider payloads into fixtures.

**Verify**: a corpus coverage test prints counts by administrative coverage,
place type, ambiguity, variant, and expected-no-result category, and fails if
any minimum above is missed.

### Step 4: Build the reviewed route-guide corpus

Create at least 50 route cases distributed across:

- at least 15 direct routes;
- at least 15 one-transfer routes;
- at least 8 two-transfer routes;
- at least 6 reverse-direction pairs;
- branches, loops, terminal platforms, parent/child stations, and peripheral
  network coverage;
- at least 6 intentionally unsupported or disputed `KnownGap` cases.

Include the audited pairs Blok M → Bundaran HI, Blok M → Kota, Ragunan →
Harmoni, JIS → Blok M, Kalideres → Pulo Gadung, Tanjung Priok → Lebak Bulus,
and Cawang → Kota. Include a reviewed production example where lines 9 and 9A
can be taken for the same boarding-to-alighting passenger step; the expected
result must be one step with both line options, not two duplicate guides. Do
not automatically bless current API output: reviewers
must classify each case and record the acceptable line/headsign sequence or a
specific known gap.

Do not encode minutes, departure times, arrival times, or expected walking
routes. A supported case must be actionable in both directions where the corpus
claims reverse-direction coverage.

**Verify**: a coverage test prints counts by direct/transfer/reverse/branch/
peripheral/known-gap category and fails below the minima.

### Step 5: Define unfamiliar-user release tasks

Create at least six `UsabilityTask` records. No task may give the tester a stop
name. Include:

- landmark-to-landmark direct guidance;
- area-to-landmark guidance with a nearby-stop choice;
- a transfer journey;
- an ambiguous place-name disambiguation;
- a recognized but unsupported route and recovery;
- use without opening the map.

Across the tasks, explicitly exercise the responsive endpoint interaction:
autocomplete results immediately below the active input, origin/destination
swap, the floating top control on a phone viewport, and the side control on a
desktop viewport. Include one result whose correct interpretation is “take 9
or 9A” within a single ride step.

Define the Plan 016 release threshold: at least five people unfamiliar with the
implementation attempt at least three representative tasks; at least four of
five complete each core task without coaching, being told a stop name, or using
developer tools. Record failures and observed confusion; do not replace failed
tasks with easier ones.

**Verify**: schema tests reject tasks containing prohibited internal GTFS IDs
or explicit boarding-stop answers in their scenario text.

### Step 6: Publish the dependency contract for parallel lanes

Add a final section to the product contract assigning ownership:

- Plan 013 owns canonical passenger-facing transit places and retained static
  boarding/direction evidence.
- Plan 014 owns geographic place artifacts and unified place discovery.
- Plan 015 owns time-independent topology routing and instruction generation.
- Plans 014 and 015 may run in parallel only after Plan 013's public contracts
  merge; neither may modify the other's directories.
- Plan 016 owns HTTP/UI integration, map behavior, localization, performance,
  usability evidence, and the midpoint deployment decision.

List the exact schemas each downstream lane consumes. If the schemas need to
change later, the changing lane must update the corpus decoders and notify the
other active lane before merging.

**Verify**: `npx tsc --noEmit && npx oxlint . && npm test` exits 0.

## Test plan

- `src/acceptance/route-helper/corpus.test.ts` covers all schema invariants,
  deterministic sorting, duplicate IDs, manifest counts, category minima, and
  prohibited timetable fields.
- Model Effect tests after `src/domain/transit/transit.test.ts` and
  `src/testing/effect.ts`; use `it.effect` and supplied values rather than real
  filesystem/network calls.
- Fixtures live under `test/fixtures/route-helper/` and are decoded in every
  test—no unchecked casts.
- The corpus is expected to reveal current gaps. This plan passes when the
  corpus itself is valid and reviewed, not when current production code passes
  all supported cases. Plans 014–016 own those pass gates.

## Done criteria

- [x] The route-helper contract explicitly preserves the final bus + train +
      walk destination while defining the usable bus midpoint.
- [x] At least 60 reviewed place-search cases decode and meet category minima.
- [x] At least 50 reviewed route-guide cases decode and meet category minima.
- [x] At least six unfamiliar-user tasks decode and contain no stop-name hints.
- [x] No route-guide expected result contains timetable or walking-time fields.
- [x] Parallel lane ownership and shared contracts are explicit.
- [x] `npm test -- src/acceptance/route-helper` passes.
- [x] `npx tsc --noEmit && npx oxlint . && npm test` exits 0.
- [x] No production source file outside the in-scope paths changed.
- [x] `plans/README.md` status is updated and a completion report satisfies the
      repository completion-integrity protocol.

## STOP conditions

Stop and report rather than improvising if:

- Reviewers cannot establish defensible expected route sequences for the
  minimum supported corpus.
- The production artifact used to review cases is not versioned or cannot be
  reproduced from the supplied GTFS input.
- Product stakeholders require exact timetable, live vehicle, fare, or
  pedestrian claims in this middle milestone.
- Completing the contract requires choosing a geographic production provider;
  Plan 014 owns that source decision.
- A requested schema change would require modifying production routing, API, or
  UI files in this plan.
- An in-scope file has drifted materially from the current-state description.

## Maintenance notes

The corpus is product evidence, not a second production database. Add cases
when users report failures, when the transit artifact changes materially, and
before multimodal or street-routing changes. Never delete a difficult case to
make a release pass; reclassify it with a reviewed rationale and preserve its
history. Plans 010 and 011 must rerun the route-helper corpus to prove their
fallback remains intact.

## Completion report

Completed on 2026-07-18 against source artifact
`bus-transjakarta-20260629-v1` (active production pair). Branch:
`work/012-route-helper-contract`.

### Scope matrix

| Step / done criterion                                   | Implementation                                       | Evidence                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Product contract with midpoint + multimodal destination | `docs/product/route-helper-contract.md`              | Keyword verify for time-independent/headsign/nearby/must never/multimodal; ownership section present |
| Corpus schemas + `RouteHelperCorpus.load`               | `src/acceptance/route-helper/**`                     | Schema round-trip, invariant, and decode tests in `corpus.test.ts`                                   |
| ≥60 place-search cases + minima                         | `test/fixtures/route-helper/place-search-cases.json` | 91 cases; coverage test prints/enforces minima                                                       |
| ≥50 route-guide cases + minima                          | `test/fixtures/route-helper/route-guide-cases.json`  | 57 cases (50 Supported, 7 KnownGap); coverage test                                                   |
| ≥6 usability tasks without stop hints                   | `test/fixtures/route-helper/usability-tasks.json`    | 6 tasks; prohibited-hint rejection test                                                              |
| No timetable/walk fields in expectations                | loader + coverage assertions                         | Rejects prohibited JSON keys in sequences                                                            |
| Parallel lane ownership                                 | contract final section                               | Plans 013–016 ownership + shared schemas listed                                                      |
| Status + integrity                                      | `plans/README.md`, this report                       | Status `DONE`                                                                                        |

### Entity counts exercised by review

| Entity                 | Count / identity                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source artifact        | `bus-transjakarta-20260629-v1`                                                                                                                    |
| Place-search cases     | 91                                                                                                                                                |
| Place categories       | Landmark 28, Neighbourhood 17, ExactStop 9, Ambiguous 13, AdministrativeCity 16, Abbreviation 8, SpellingVariant 12, ExpectedNoResult 11          |
| Admin coverage         | Pusat 30, Utara 12, Barat 14, Selatan 14, Timur 15, EdgeNetwork 6                                                                                 |
| Route-guide cases      | 57 total; Supported 50; KnownGap 7                                                                                                                |
| Route categories       | Direct 25, OneTransfer 16, TwoTransfer 9, ReversePair 7, Peripheral 9, InterchangeableLines 2, Branch 3, ParentChildStation 3, TerminalPlatform 1 |
| Audited pairs included | Blok M↔Bundaran HI, Blok M↔Kota, Ragunan→Harmoni, JIS→Blok M, Kalideres→Pulo Gadung, Tanjung Priok→Lebak Bulus, Cawang→Kota, Cawang↔Grogol 9/9A   |
| Usability tasks        | 6 covering phone top control, desktop side panel, autocomplete, swap, no-map, 9/9A                                                                |

### Verification commands

```text
npm test -- src/acceptance/route-helper
# 13 passed

npx tsc --noEmit
# exit 0

npx oxlint .
# exit 0

npm test
# 15 files, 112 passed
```

### Omitted / stubbed / fixture-only behaviour

- No production search, routing, HTTP, or UI implementation (out of scope; Plans 013–016).
- Corpus expected sequences are reviewed acceptance evidence, not a claim that
  current Plan 007 timetable APIs already satisfy them.
- Geographic provider selection is deferred to Plan 014.
- Usability participant sessions are defined here; execution is Plan 016.

### Diff audit

In-scope paths only:

- `docs/product/route-helper-contract.md` (create)
- `src/acceptance/route-helper/**` (create)
- `test/fixtures/route-helper/**` (create)
- `plans/012-route-helper-contract-and-corpus.md` (status/report)
- `plans/README.md` (status row)

No changes under `src/domain`, `src/routing`, `src/runtime`, `src/routes`,
`src/features`, or `src/components`.
