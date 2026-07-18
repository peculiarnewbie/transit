# Plan 014: Build broad geographic passenger-place discovery

> **Executor instructions**: Follow this plan step by step and run each
> verification command before continuing. This is one of two parallel lanes
> after Plan 013; it may run at the same time as Plan 015. Stay within the
> paths listed below so both branches merge cleanly. This lane discovers and
> ranks places and nearby transit choices. It must not implement routing,
> passenger HTTP routes, or UI, and it must not describe geometric distance as
> a walk. When done, update this plan's status in `plans/README.md` unless a
> reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat b626253..HEAD -- src/discovery src/import public/artifacts scripts test/fixtures docs/data`
> and
> `git diff --stat -- src/discovery src/import public/artifacts scripts test/fixtures docs/data`.
> Start from the merge commit containing Plans 012 and 013. If Plan 013's
> exported transit-place contract has changed, stop and reconcile this plan
> before writing an adapter.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MEDIUM
- **Depends on**: Plans 012 and 013
- **Can run in parallel with**: Plan 015
- **Category**: place data / search / discovery
- **Planned at**: commit `b626253`, 2026-07-18

## Why this matters

A route helper that accepts only GTFS stop names transfers the data model's
burden to the passenger. People begin with places such as Kota Tua, a campus,
a neighbourhood, or a point on the map. This lane builds a broad, reproducible
Jabodetabek place index and resolves recognized places to nearby passenger-
facing transit places. It deliberately stops before claiming that any nearby
choice is safely walkable; street-routed access remains Plan 011.

The production index must come from a versioned geographic source, not a list
curated around demonstration journeys. The reviewed corpus from Plan 012 is an
acceptance test, not the product database.

## Commands you will need

| Purpose            | Command                                               | Expected on success                 |
| ------------------ | ----------------------------------------------------- | ----------------------------------- |
| Place import tests | `npm test -- src/import/osm-places`                   | import and artifact tests pass      |
| Discovery tests    | `npm test -- src/discovery/place`                     | search and nearby-choice tests pass |
| Acceptance corpus  | `npm test -- src/acceptance/route-helper --runInBand` | all Plan 012 place cases pass       |
| Typecheck/lint     | `npx tsc --noEmit && npx oxlint .`                    | exit 0                              |
| Full verification  | `npm run check && npm test`                           | exit 0                              |

## Suggested executor toolkit

- Use the repository-local `effect` skill for schemas, services, layers,
  expected errors, and Effect-aware tests.
- Use `quality-code` if available for branded place/source IDs and
  discriminated result variants.

## Scope and parallel ownership

**This lane owns**:

- `src/domain/place/**` (create, if a separate domain package is warranted)
- `src/import/osm-places/**` (create)
- `src/discovery/place/**` (create)
- `scripts/places/**` (create)
- versioned place artifacts under `public/artifacts/places/**`
- `test/fixtures/places/**` (create)
- place-data attribution and build documentation under `docs/data/**`
- this plan and its `plans/README.md` status

**Do not edit in this lane**:

- Plan 013's `src/discovery/transit/**` public contracts except through a
  separately reviewed shared-contract change
- `src/route-guide/**` (owned by Plan 015)
- `src/routing/**`, `src/runtime/**`, `src/routes/**`
- `src/features/**`, `src/components/**`, `src/routeTree.gen.ts`
- train curation or street-routing code

## Git workflow

- Branch: `work/014-passenger-place-discovery`
- Base: the merge commit completing Plan 013
- Suggested commit: `feat(discovery): index passenger places and nearby transit`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define a source-neutral passenger-place model

Define explicit variants for `Area`, `Landmark`, and `TransitPlaceReference`.
Every searchable place must have a stable branded ID, primary name, aliases,
place type, locality/admin context, representative coordinate, optional bounds,
source references, and artifact version. Preserve the source's classification;
do not flatten every object into an untyped name/coordinate pair.

Define a separate `PassengerPlaceSearchResult` projection containing the
display label, disambiguating context, matched alias, result kind, coordinate
or bounds, and match/rank evidence. Keep passenger result DTOs independent of
raw OSM tags.

Decode raw input and the published artifact with Effect `Schema`. Reject
missing stable IDs, unusable coordinates, invalid bounds, empty names, and
duplicate source identities with typed errors carrying record context.

**Verify**: round-trip tests cover every place variant, Unicode Indonesian
names, bounds, aliases, duplicate IDs, and malformed coordinates.

### Step 2: Build a reproducible broad place artifact

Create an offline compiler for a pinned, documented OSM-derived Jabodetabek
input. The build must:

- record source date/version, geographic boundary, extraction rules, compiler
  version, license/attribution, input checksum, and output checksum;
- include neighbourhood and administrative areas plus passenger-relevant
  landmarks such as markets, malls, campuses, hospitals, stadiums, terminals,
  and rail stations;
- retain enough admin/locality context to disambiguate repeated names;
- normalize source records deterministically and sort output stably;
- merge exact source duplicates without merging merely similar nearby places;
- emit counts by type, municipality/regency, source classification, missing
  field, rejection reason, and duplicate handling;
- publish a compact versioned artifact and manifest suitable for static Worker
  delivery.

Raw regional extracts may remain outside Git if their size or license makes
that appropriate, but the repository must contain a documented, repeatable
command and a small representative fixture. CI and the deployed application
must not call a live geocoder or public OSM API. A production artifact update
must be reviewable as a data-version change, never an unrecorded fetch.

**Verify**: two builds from the same pinned input produce byte-identical output
and checksums; the full artifact audit accounts for every accepted and rejected
source feature.

### Step 3: Implement Indonesian-aware place search

Provide a `PassengerPlaceDiscovery.Service` using `Context.Service`, an
explicit production `Layer`, and a deterministic test layer. Give public
methods named `Effect.fn` operations. Search must support:

- Unicode/case/whitespace/punctuation normalization without corrupting the
  original display label;
- common Jakarta/Indonesian abbreviation equivalence such as `Jl.`/`Jalan`,
  `St.`/`Stasiun`, and `Ps.`/`Pasar` through a reviewed rule table;
- exact names, aliases, prefixes, and tolerant token matching;
- type and locality context for ambiguous names;
- optional query-coordinate bias while still returning textually strong
  results elsewhere;
- deterministic ranking and a bounded result count;
- a tagged no-match result distinct from artifact/service failure.

Do not add an origin-reachability filter. A recognized destination remains
visible even when the current bus graph cannot produce a route. Do not use the
Plan 012 corpus itself as synonyms or ranking data.

**Verify**: ranking tests cover exact/alias/abbreviation/typo/ambiguous cases,
coordinate bias, deterministic ties, and recognized places outside current bus
coverage.

### Step 4: Integrate canonical transit places into unified discovery

Index Plan 013's `TransitPlace` projection alongside geographic places without
copying or changing its grouping rules. Ensure a station/platform complex is
shown once at the primary search level and retains member boarding points for
later detail. A place that represents a rail station may link to, but must not
silently replace, the canonical transit-place identity.

Search results must expose stable IDs and tagged kinds so Plan 016 can preserve
the passenger's selected place instead of falling back to a fragile label.
Duplicate labels must carry locality, type, or transit context sufficient for
an unfamiliar user to choose.

**Verify**: tests cover a parent station with several platforms, a landmark and
station sharing a name, repeated neighbourhood names, and stable selected IDs
across reloads of the same artifact version.

### Step 5: Resolve a place to nearby transit choices

Add an operation that accepts a selected geographic place or coordinate and a
`TransitPlaceIndex`, and returns a bounded, deterministically ranked set of
candidate transit places. Return geometric distance, served-route summary, and
selection evidence. Use bounds-aware distance for areas where practical;
document the exact representative-point fallback.

Candidate expansion must use explicit caps for radius, count, and computation.
It may prefer closer and more broadly served choices, but it must not invent a
transfer or remove all candidates solely because the router cannot currently
connect them. Preserve enough candidates for Plan 015 to compare viable route
sequences.

Name the measurement `geographicDistanceMeters` or equally unambiguous
language. Do not return walk minutes, walkability, pedestrian directions, or
“nearest” when the bounded index has not proven global nearestness.

**Verify**: tests cover an area with choices on different sides, a landmark
with several nearby stops, no choice within the cap, stable tie-breaking, and
a geometrically close stop separated by an unknown barrier without making a
walking claim.

### Step 6: Qualify the complete artifact against the acceptance corpus

Run the full published place artifact plus the complete production
`TransitPlaceIndex` against all Plan 012 place cases. Publish a deterministic
report with:

- pass/fail counts by place category, municipality/regency, ambiguity,
  spelling variant, and expected-no-result case;
- top-result and acceptable-result-set accuracy;
- search latency and index size at cold construction and warm query;
- artifact counts, rejected input counts, and missing attribution;
- every failing query with rank evidence, never a silently amended fixture.

All required cases must meet the contract's acceptable-result criteria. Fix
general import, normalization, or ranking behavior; do not add one-off aliases
whose only justification is making an acceptance case green.

**Verify**: `npm run check && npm test` succeeds and the committed qualification
report names the exact place and transit artifact versions.

## STOP conditions

Stop and report instead of continuing if:

- no legally usable, versionable broad geographic source is available;
- the build can only succeed through a live third-party geocoder in production
  or CI;
- passing the corpus would require a hand-picked production catalog;
- Plan 013 transit-place IDs or membership are unstable or ambiguous;
- nearby-choice output is being interpreted as pedestrian routing or walking
  time; or
- production artifact size/latency exceeds the budgets agreed in Plan 012 and
  no measured mitigation preserves broad coverage.

## Done when

- [ ] A pinned broad Jabodetabek place source compiles reproducibly.
- [ ] Published place and manifest artifacts are versioned and attributed.
- [ ] Unified search covers areas, landmarks, and canonical transit places.
- [ ] Nearby transit choices are bounded, stable, and explicitly geometric.
- [ ] No route reachability, timetable, or pedestrian claim leaks into search.
- [ ] All Plan 012 place-search acceptance cases meet their reviewed criteria.
- [ ] Full-artifact reconciliation, performance, and coverage reports pass.
- [ ] `npm run check && npm test` pass.
