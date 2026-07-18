# Plan 002: Compile TransJakarta GTFS into a canonical snapshot

> **Executor instructions**: Work only in the GTFS lane. Do not add API routes,
> edit central runtime wiring, or commit the downloaded production ZIP. Update
> `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 07703bb..HEAD -- src/domain/transit src/import/gtfs scripts/gtfs test/fixtures/gtfs`
> Confirm Plan 001 is merged and its domain contracts still match.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: Plan 001
- **Category**: feature / data ingestion
- **Planned at**: commit `07703bb`, 2026-07-18

## Why this matters

The downloaded TransJakarta feed is the most complete source and should produce
the first routable network. The compiler must turn GTFS-specific CSV tables into
the canonical domain without loading 12.5 MB of shape rows into every browser.
It also creates a stable fixture boundary for the routing lane.

## Current state

The external source file is `/home/bolt/git/other/file_gtfs.zip`. It contains 13
tables and about 15.3 MB uncompressed. `shapes.txt` is about 12.5 MB;
`stop_times.txt` is about 2.1 MB; `stops.txt` is about 0.5 MB. The feed contains
routes, trips, frequencies, calendars, transfers, ordered stop times, and shape
geometry.

The ZIP is input evidence, not a repository dependency. Tests must use a tiny
committed synthetic fixture.

## Commands

| Purpose | Command | Expected result |
|---|---|---|
| Unit/integration tests | `npm test -- src/import/gtfs` | all pass |
| Compile production feed locally | `npx tsx scripts/gtfs/compile.ts --input /home/bolt/git/other/file_gtfs.zip --output var/transit/transjakarta.json` | summary reports nonzero agencies, stops, routes, patterns, trips |
| Full verification | `npm run check && npm test` | exit 0 |

## Scope

**In scope**:

- `src/import/gtfs/**` (create)
- `scripts/gtfs/**` (create)
- `test/fixtures/gtfs/**` (create)
- `.gitignore` only to ignore generated `var/transit/**`

**Out of scope**:

- `/home/bolt/git/other/file_gtfs.zip` and other production data
- `src/routes/**`, `src/routeTree.gen.ts`, MapLibre
- D1 writes and schema migrations
- Routing algorithms or train data

## Git workflow

- Branch/worktree: `work/002-gtfs-compiler`
- Suggested commit: `feat(gtfs): compile canonical transit snapshots`

## Steps

### Step 1: Create raw GTFS boundary schemas and CSV reader

Implement streaming or bounded-memory ZIP/CSV reading using the baseline's
`fflate` dependency. Define raw schemas for every consumed table and decode
rows at the boundary. Preserve GTFS times beyond `24:00:00`; do not parse them
as JavaScript `Date` values. Model service-day seconds as a constrained number.

Required tables: agency, calendar, calendar_dates, routes, stops, trips,
stop_times, frequencies, transfers, and shapes. Unknown extra columns are
ignored; required malformed values produce a typed error containing table and
row number without dumping whole rows.

**Verify**: fixture tests cover quoted commas, CRLF, missing required fields,
`25:10:00`, and empty optional fields.

### Step 2: Normalize routes, ordered patterns, trips, and calendars

Group trips into route patterns by route, direction, and exact ordered stop
sequence. Preserve stop order from `stop_sequence`; never alphabetize. Normalize
service calendars plus exceptions and retain frequency windows.

All source IDs must be namespaced through canonical branded IDs while retaining
`SourceRef` evidence.

**Verify**: a fixture with two trips sharing a pattern emits one pattern; a
branch variant emits a second pattern.

### Step 3: Normalize transfers and validate graph integrity

Import explicit GTFS transfers. Reject dangling stop references, non-monotonic
stop sequences, trips without patterns, and shapes referenced but absent when
geometry is declared. Produce a structured validation summary with counts,
warnings, and typed fatal errors.

Do not infer arbitrary proximity transfers in this plan.

**Verify**: malformed fixtures fail with the expected tagged error and valid
fixtures have no dangling references.

### Step 4: Build compact geometry indexes

Deduplicate shared shapes, reduce unnecessary coordinate precision, and retain
only properties needed by the UI. Keep routing topology separate from display
geometry so the routing lane can load without parsing all shape coordinates.

Emit one versioned `NetworkSnapshot` plus a geometry sidecar, both JSON for the
first implementation. Compression/PMTiles conversion is deferred.

**Verify**: compile the production ZIP and report output sizes; topology output
must be materially smaller than the 15.3 MB expanded feed and contain no shape
coordinate arrays.

### Step 5: Add the deterministic CLI

Add `scripts/gtfs/compile.ts`, invoked as
`npx tsx scripts/gtfs/compile.ts --input <zip> --output <path>`. Do not edit
`package.json` in this parallel lane. The command must produce stable ordering
and byte-identical output for identical input, aside from an explicitly supplied
`--generated-at` value. It must print counts and a content hash suitable for
later publication.

**Verify**: compile the same fixture twice with fixed `--generated-at`; `cmp`
reports identical files.

## Test plan

- Unit tests for times, CSV parsing, ID namespacing, pattern grouping, calendars,
  frequencies, transfers, and errors.
- Integration test compiles a tiny zipped feed end to end and decodes the result
  with the canonical `NetworkSnapshot` schema.
- Production ZIP is a manual verification input only.

## Done criteria

- [ ] Production GTFS compiles successfully with nonzero entity counts.
- [ ] Snapshot decoding succeeds through Effect Schema.
- [ ] Route patterns retain stop order and branches.
- [ ] Topology and geometry are separate outputs.
- [ ] Generated outputs are deterministic and ignored by Git.
- [ ] No API, database, routing, or UI files changed.
- [ ] `npm run check && npm test` passes.

## STOP conditions

- Plan 001 contracts cannot represent GTFS service-day times above 24 hours.
- The feed contains malformed relationships requiring silent data loss.
- A new runtime dependency appears necessary; report it instead of editing the
  shared package manifest in this parallel lane.

## Maintenance notes

Future feed refresh jobs should invoke this compiler rather than duplicate its
logic. Keep raw schemas local to the GTFS adapter; canonical contracts must not
acquire GTFS column names.
