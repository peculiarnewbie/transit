# Plan 013: Project canonical passenger-facing transit places and static guidance evidence

> **Executor instructions**: Follow this plan step by step. Run each
> verification command before continuing. This is the shared data-contract gate
> for the two parallel lanes in Plans 014 and 015. Merge it before either lane
> starts production work. Do not implement geographic places, passenger HTTP
> routes, route-guide search, or UI here. Stop and report any condition listed
> below rather than hiding ambiguous stop relationships. When done, update this
> plan's row in `plans/README.md` unless a reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat b626253..HEAD -- src/domain/transit src/import/gtfs src/discovery scripts/gtfs test/fixtures/gtfs public/artifacts`
> and
> `git diff --stat -- src/domain/transit src/import/gtfs src/discovery scripts/gtfs test/fixtures/gtfs public/artifacts`.
> The working tree already contained Plan 007 artifact and routing changes when
> this plan was authored. Do not overwrite them. If the stop/trip/pattern
> contracts below have drifted, stop and reconcile the model before editing.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 012 and Plan 002
- **Category**: data model / import / correctness
- **Planned at**: commit `b626253`, 2026-07-18

## Why this matters

GTFS records are operational nodes, not automatically the places passengers
recognize. The current feed contains stations, platforms, poles, and related
records, but the canonical model retains only a name, location, and optional
parent. This produces duplicate search results and discards platform,
accessibility, and boarding/alighting evidence needed for clear guidance.

This plan retains static source semantics and builds a deterministic
passenger-facing transit-place projection without inventing pedestrian
connections. It establishes contracts shared by geographic discovery in Plan
014, time-independent route guidance in Plan 015, and later train curation and
multimodal composition in Plans 008–011.

## Current state

- `src/import/gtfs/raw.ts:47-53` ignores `location_type`, `stop_code`,
  `wheelchair_boarding`, and `platform_code` from `stops.txt`.
- `src/import/gtfs/raw.ts:66-72` ignores `pickup_type`, `drop_off_type`, and
  `stop_headsign` from `stop_times.txt`.
- `src/domain/transit/stop.ts:18-24` stores only ID, source refs, name,
  location, and optional parent.
- `src/domain/transit/route-pattern.ts:6-13` stores ordered stop IDs and
  direction ID but no passenger direction label.
- `src/domain/transit/trip.ts:44-51` already preserves an optional trip
  headsign. In the supplied production feed all 730 trips have one.
- The production feed has 8,243 stops, including 291 `location_type=1`
  stations, 607 child records referencing 273 unique parents, and many
  unparented terminal/platform records. Source parentage is authoritative where
  present, but it is not enough by itself to suppress every passenger-facing
  duplicate.
- `src/routing/network-index.ts:16-24` already builds stop and parent-child
  indexes. Do not move passenger-display grouping rules into this scheduled
  routing index.

Follow the repository's domain patterns: `Schema.Struct` plus same-name
interfaces, constrained branded IDs, `Schema.TaggedUnion` for reusable variants,
`Schema.TaggedErrorClass` for expected failures, and named `Effect.fn` operations.
Model the new projection as its own domain/service rather than adding UI fields
to runtime response DTOs.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| GTFS tests | `npm test -- src/import/gtfs` | all GTFS tests pass |
| Discovery tests | `npm test -- src/discovery/transit` | all transit-place tests pass |
| Domain tests | `npm test -- src/domain/transit` | all domain tests pass |
| Typecheck/lint | `npx tsc --noEmit && npx oxlint .` | exit 0 |
| Full verification | `npm run check && npm test` | exit 0 |

## Suggested executor toolkit

- Use the repository-local `effect` skill, especially its schema, service/layer,
  and testing references.
- Use `quality-code` if available for branded IDs, immutable projections, and
  full-artifact characterization tests.

## Scope

**In scope**:

- `src/domain/transit/stop.ts`
- `src/domain/transit/trip.ts`
- `src/domain/transit/route-pattern.ts` only if a pattern-level direction field
  is proven necessary by the full-feed audit
- `src/domain/transit/network-snapshot.ts` and barrel exports required by the
  above contract changes
- `src/import/gtfs/raw.ts`
- `src/import/gtfs/compiler.ts`
- `src/import/gtfs/compiler.test.ts`
- `src/discovery/transit/**` (create)
- `scripts/gtfs/**` only for deterministic production audit/report commands
- `test/fixtures/gtfs/**`
- artifact documentation under `docs/` only when schema publication changes
- this plan and its `plans/README.md` status

**Out of scope**:

- `src/routing/**`, `src/runtime/**`, `src/routes/**`
- `src/features/**`, `src/components/**`
- Geographic neighbourhood/landmark data or OSM ingestion (Plan 014)
- Route-guide algorithms and passenger instruction DTOs (Plan 015)
- Passenger UI and API integration (Plan 016)
- Adding proximity-derived transit transfers
- Treating a platform cluster as a zero-cost transfer unless source parentage
  or a published transfer already establishes that topology
- Editing the source GTFS ZIP or hand-editing generated network JSON

## Git workflow

- Branch: `work/013-canonical-transit-places`
- Suggested commit: `feat(transit): project passenger-facing transit places`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Retain static GTFS stop and stop-time semantics

Extend raw schemas and canonical records to retain only fields with a concrete
route-helper or future multimodal use:

- Stop location kind normalized from GTFS `location_type` into an explicit
  tagged/literal domain value. Support all standard values defensively even
  though the current feed primarily uses stops/platforms and stations.
- `stop_code` and `platform_code` as optional non-empty passenger identifiers.
- `wheelchair_boarding` as an explicit `Unknown | Possible | NotPossible`
  value; do not turn unknown into false.
- Stop-time pickup and drop-off policy as explicit values, preserving normal,
  forbidden, phone-agency, and coordinate-with-driver semantics rather than a
  lossy boolean.
- Optional stop-level headsign only if the source field is non-empty.

Preserve encoded compatibility deliberately. If changing `NetworkSnapshot`
requires a schema-version bump, implement a documented v2 artifact rather than
silently interpreting old v1 JSON differently. Keep source column names inside
the GTFS adapter.

Add fixture rows for station, platform, unparented stop, platform code,
accessibility unknown/possible/not-possible, pickup forbidden, drop-off
forbidden, and stop headsign.

**Verify**: `npm test -- src/import/gtfs src/domain/transit` passes and schema
round trips prove every retained static value survives compile → encode →
decode.

### Step 2: Define passenger-facing transit-place contracts

Under `src/discovery/transit/`, define:

- `TransitPlaceId`, distinct from `StopId`.
- `TransitPlace`: stable ID, primary name, aliases, representative coordinate,
  member stop IDs, optional parent/source station ID, optional platform summary,
  served route IDs, source refs, and a grouping-evidence variant.
- Grouping evidence variants such as `SourceParent`, `ReviewedComplex`, and
  `Standalone`. Do not add a generic `Inferred` result without the exact facts
  and review status that produced it.
- `TransitPlaceIndex`: places by ID, transit place by member stop, and unresolved
  grouping findings.
- Typed errors for malformed membership, duplicate membership, missing
  representative coordinates, and conflicting authoritative parents.

One stop ID belongs to exactly one passenger-facing transit place. A transit
place may contain several boarding points, but membership alone does not assert
that passengers can transfer between all members.

Provide `TransitPlaceProjection.Service` with named methods to project an
already-decoded `NetworkSnapshot` and retrieve its validation report. Build its
real layer explicitly; provide a deterministic test layer backed by the same
interface.

**Verify**: `npm test -- src/discovery/transit` covers branded IDs, source-parent
grouping, standalone stops, membership uniqueness, and typed failures.

### Step 3: Implement conservative deterministic grouping

Apply grouping in this order:

1. Use valid GTFS `parent_station` relationships as authoritative display
   membership.
2. Keep a station record and its children as one passenger-facing transit place
   while preserving each boarding-point ID and platform code.
3. Keep unrelated standalone stops separate by default.
4. Generate review findings—not automatic membership—for unparented records
   that look like one complex based on proximity, normalized name, platform
   suffix, and overlapping served routes.
5. Accept reviewed complex memberships only through a small versioned override
   artifact with provenance, rationale, and source-artifact version. This
   artifact supplements deterministic source grouping; it must never replace
   broad source processing with a hand-picked demo catalog.

The projection may choose a station coordinate or deterministic member-derived
representative coordinate for display. It must preserve every member coordinate
for later map/boarding detail.

Do not create transfer edges while grouping. Plan 015 may traverse members only
where the canonical network's source parentage or published transfers truthfully
permit it.

**Verify**: tests cover one parent with multiple platforms, same-name stops that
must remain separate, opposing-direction curb stops, a reviewed terminal
complex, and rejection of stale overrides against a different source version.

### Step 4: Preserve usable direction evidence

Audit all trips grouped by route pattern in the supplied production feed.
Produce a deterministic report containing:

- patterns with one stable non-empty trip headsign;
- patterns with several distinct headsigns;
- patterns with no headsign;
- differences between trip headsign, stop headsign, final stop name, and the
  custom `route_list.txt` records where available.

Define a `PatternDirectionEvidence` projection containing all defensible
candidate labels and their provenance. Do not select final passenger copy here;
Plan 015 owns the deterministic selection/fallback policy. Do not include time
windows merely because `route_list.txt` contains them—the middle product is
time-independent.

If retaining `route_list.txt` requires making an optional GTFS table reader,
keep it optional and emit a warning when absent. The canonical network must
remain routable without that non-standard table.

**Verify**: a fixture with stable, conflicting, and absent headsigns produces
the exact evidence variants and report counts.

### Step 5: Audit boarding/alighting validity and display coverage

Run the projection over the complete production artifact/source and write a
machine-readable report with:

- raw stop count by location kind;
- source-parent group count and member distribution;
- standalone transit-place count;
- unresolved proposed-complex count and reasons;
- stops missing usable coordinates or names;
- platform-code and wheelchair-evidence counts;
- stop times by pickup/drop-off policy;
- patterns by direction-evidence classification;
- duplicate primary-name groups requiring locality or platform context;
- zero silently dropped stops, patterns, trips, and policy records.

Add regression assertions for the known full-feed counts at the selected
artifact version, while allowing a deliberate artifact update to change them
only through an explicit expected-version fixture update.

**Verify**: the production audit exits 0, decodes every record, and writes a
report whose input/output reconciliation contains no unexplained count loss.

### Step 6: Publish the lane contract for Plans 014 and 015

Document and export only the stable public surfaces:

- Plan 014 consumes `TransitPlace`, its representative/member coordinates,
  aliases, and served-route summary for unified discovery.
- Plan 015 consumes transit-place membership, boarding/alighting policies,
  ordered patterns, and direction evidence for route guidance.
- Neither downstream plan may mutate grouping or headsign evidence ad hoc.
- Any disputed group remains a visible validation finding until a versioned
  reviewed override resolves it.

Run both downstream fixture adapters against the exported schema shapes with
compile-only contract tests so the two lanes can start from the same merge
commit.

**Verify**: `npm run check && npm test` exits 0.

## Test plan

- Extend `src/import/gtfs/compiler.test.ts` using the existing zipped fixture
  pattern; do not call the live network.
- Add `src/discovery/transit/transit-place-projection.test.ts` using `it.effect`
  and explicit layers.
- Add full-artifact audit tests/scripts that are deterministic and read only the
  explicitly supplied production input; ordinary unit CI must still use small
  committed fixtures.
- Cover malformed `location_type`, invalid parent kind, duplicate stop
  membership, opposing-direction stops, stale review override, conflicting
  headsigns, and every pickup/drop-off policy.

## Done criteria

- [ ] Canonical schemas retain location kind, passenger stop/platform codes,
      accessibility evidence, pickup/drop-off policy, and optional stop
      headsign without GTFS field names leaking into the domain.
- [ ] Every stop belongs to exactly one passenger-facing transit place.
- [ ] Authoritative parent grouping is automatic; ambiguous spatial/name
      clusters are reported rather than silently merged.
- [ ] Reviewed complex overrides are versioned, attributed, and never substitute
      for whole-feed processing.
- [ ] No grouping operation creates a transit transfer.
- [ ] Pattern direction evidence is available with provenance for every pattern.
- [ ] Full-feed report reconciles all 8,243 source stops and all route patterns
      for the selected artifact version, with every ambiguity listed.
- [ ] `npm run check && npm test` exits 0.
- [ ] No files outside scope changed, except the generated plan status row.
- [ ] Completion report satisfies `plans/README.md` integrity requirements.

## STOP conditions

Stop and report if:

- Canonical artifact compatibility cannot be preserved without a schema-version
  migration not reviewed by the operator.
- The source uses location or boarding policy values that cannot be represented
  truthfully by the proposed variants.
- More than one authoritative parent claims the same stop.
- A proposed grouping rule requires proximity to imply a transfer or pedestrian
  connection.
- Direction labels conflict across a material share of patterns and no
  provenance-preserving evidence model can retain the ambiguity.
- A production source/artifact needed for the audit is absent or does not match
  its declared version.
- In-scope files drifted materially since plan authoring.

## Maintenance notes

Passenger transit places are a projection over canonical operational stops, not
a replacement for them. Preserve member IDs and source evidence so Plan 008 can
later curate complexes and Plans 009–011 can compose train and pedestrian
detail. Re-run the whole-feed grouping and direction audit on every GTFS update;
reviewed overrides must declare which artifact versions they support.
