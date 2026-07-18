# Plan 015: Build time-independent bus route guidance

> **Executor instructions**: Follow this plan step by step and verify each
> stage. This is one of two parallel lanes after Plan 013; it may run at the
> same time as Plan 014. Implement a static TransJakarta topology guide, not a
> timetable planner. Do not edit runtime routes or passenger UI. Keep the
> existing scheduled router intact for later products and comparisons. When
> done, update this plan's status in `plans/README.md` unless a reviewer
> maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat b626253..HEAD -- src/domain/transit src/discovery/transit src/routing src/route-guide test/fixtures`
> and
> `git diff --stat -- src/domain/transit src/discovery/transit src/routing src/route-guide test/fixtures`.
> Start from the merge commit containing Plans 012 and 013. If the canonical
> transit-place or direction-evidence contracts differ from this plan, stop and
> reconcile the shared contract rather than duplicating them locally.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: Plans 012 and 013
- **Can run in parallel with**: Plan 014
- **Category**: routing / passenger guidance / correctness
- **Planned at**: commit `b626253`, 2026-07-18

## Why this matters

The current routing contract asks for a service date and departure time and
returns minute estimates. That is outside the agreed middle milestone and can
create false precision. A useful bus route helper instead answers: which line
and direction should I board, where should I get off, what stops will I pass,
and where do I transfer?

This lane builds that answer from static topology and source boarding evidence.
It preserves the scheduled router rather than forcing one engine to serve two
different products. The resulting route-guide service will remain a fallback
inside the later bus + train + street-walk product.

## Commands you will need

| Purpose                     | Command                                               | Expected on success                 |
| --------------------------- | ----------------------------------------------------- | ----------------------------------- |
| Route-guide tests           | `npm test -- src/route-guide`                         | topology and instruction tests pass |
| Scheduled-router regression | `npm test -- src/routing`                             | existing tests remain green         |
| Acceptance corpus           | `npm test -- src/acceptance/route-helper --runInBand` | Plan 012 route cases pass           |
| Typecheck/lint              | `npx tsc --noEmit && npx oxlint .`                    | exit 0                              |
| Full verification           | `npm run check && npm test`                           | exit 0                              |

## Suggested executor toolkit

- Use the repository-local `effect` skill for services, layers, schemas,
  tracing, typed failures, and tests.
- Use `quality-code` if available for branded query/result IDs and exhaustive
  tagged route-guide variants.

## Scope and parallel ownership

**This lane owns**:

- `src/route-guide/**` (create)
- `test/fixtures/route-guide/**` (create)
- route-guide audit scripts under `scripts/route-guide/**` (create)
- route-guide qualification reports under `docs/data/**`
- minimal shared barrel exports required to expose Plan 013 contracts, resolved
  in the receiving branch if they would conflict with Plan 014
- this plan and its `plans/README.md` status

**Do not edit in this lane**:

- `src/import/osm-places/**`, `src/discovery/place/**`, or place artifacts
  (owned by Plan 014)
- `src/runtime/**`, `src/routes/**`, `src/features/**`, `src/components/**`
- the public scheduled `RoutingQuery` or timetable result contract merely to
  make it look like a static guide
- train projection, admin, or street-routing code

## Git workflow

- Branch: `work/015-time-independent-route-guide`
- Base: the merge commit completing Plan 013
- Suggested commit: `feat(route-guide): add static bus guidance`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define a time-independent route-guide contract

Define a `RouteGuideQuery` that accepts bounded non-empty origin and
destination candidate transit-place sets. Each candidate carries its stable
transit-place ID and optional geometric proximity evidence supplied later by
Plan 014. The query must not contain service date, departure/arrival time,
walking duration, or schedule preferences.

Define tagged results for `GuidesFound`, `NoTopologicalRoute`,
`InvalidCandidateSet`, and data/validation failure. A successful alternative
must contain:

- the selected origin and destination transit places;
- an ordered sequence of transit legs;
- a non-empty set of interchangeable line options for each ride step, each
  retaining route identity, passenger-facing name, direction/headsign, evidence
  classification, and option-specific intermediate-stop sequence;
- exact boarding and alighting transit places plus member stop/platform when
  known;
- ordered intermediate passenger-facing transit places;
- explicit transfer instructions between legs;
- geometry references where source geometry exists;
- transfer, boarding, stop, candidate-distance, and ambiguity metrics used for
  ranking.

Do not expose exact wait, departure, arrival, trip, or walking minutes. Do not
describe a topology path as a scheduled trip instance.

**Verify**: schema tests reject empty candidate sets, missing directions,
unordered stops, inconsistent leg boundaries, and any timetable field.

### Step 2: Compile a static guide graph

Build a deterministic immutable index from the canonical `NetworkSnapshot`,
Plan 013's `TransitPlaceIndex`, boarding/alighting policies, route patterns,
published transfers, and `PatternDirectionEvidence`. Preserve direction and
pattern distinctions needed for actionable instructions.

Create boarding and alighting edges only where static policy permits them.
Create a transfer traversal only from an explicit published transfer or source
station relationship whose semantics permit the movement; transit-place
display grouping alone is not proof of a transfer. Retain validation findings
for missing members, broken patterns, direction conflicts, and unusable
transfer endpoints.

Collapse repeated trip instances that represent the same meaningful ordered
route sequence. Do not use stop times to rank or claim availability. If a line
has service variants with different stop sequences, keep the distinct variants
and their coverage limitations visible.

**Verify**: fixtures cover direct, branch, loop, opposite direction, forbidden
pickup/drop-off, explicit transfer, grouped-but-not-transferable platforms, and
duplicate scheduled trips producing one guide sequence.

### Step 3: Search bounded meaningful alternatives

Implement `RouteGuide.Service` with named `Effect.fn` methods, an explicit real
`Layer`, and deterministic test layers. Search across the supplied endpoint
candidate sets with explicit caps on candidates, transfers, alternatives,
expanded states, and runtime.

Rank alternatives lexicographically by passenger usefulness, with the exact
policy documented and tested. At minimum account for:

1. fewer transfers;
2. fewer boardings and less route complexity;
3. lower origin/destination geographic candidate distance when supplied;
4. fewer intermediate stops;
5. less direction/platform ambiguity;
6. deterministic stable-ID tie-breaking.

Do not use fictional minutes to combine these factors. First collapse identical
underlying pattern/trip realizations. Then group line options into one
`InterchangeableRideStep` when the passenger can board any listed option at the
same canonical boarding member/platform, alight at the same canonical
place/member, and perform the same next transfer or finish the journey without
another action. Treat that group as one guide step and one ranked alternative,
not one result card per line.

The lines need not share their complete route outside the ridden segment, and
their intermediate stops within the segment may differ. Preserve each option's
ordered intermediate stops and direction evidence so expanded detail remains
truthful. Use a shared direction label only when the evidence is genuinely
equivalent; otherwise attach a direction/headsign to each line option.

Do not group services merely because they share a route name, geometry, parent
station, origin/destination place, or nearby platforms. Keep them separate when
the passenger must use a different boarding member/platform, alight
differently, make a different transfer, obey different boarding/alighting
policy, or understand a materially different action. Preserve genuinely
different boarding choices or branches when they change what the passenger
must do.

**Verify**: property/fixture tests prove deterministic output, bounded search,
direct-over-transfer preference, meaningful deduplication/grouping, and stable
behavior when candidate or line-option order is permuted. Include the
production 9/9A case as one ride step with two line options, plus negative cases
whose platforms, alighting points, or next transfers differ.

### Step 4: Select defensible passenger directions

Turn Plan 013 direction evidence into a deterministic label policy:

1. use a single stable source headsign when present;
2. use a reviewed route/direction label when source headsigns conflict but a
   documented label exists;
3. otherwise use a clearly classified terminal/final-served-place fallback;
4. retain an ambiguity finding when no label is defensible.

Never silently pick the most common headsign if doing so hides a branch. The
result contract must tell Plan 016 whether the label is authoritative,
reviewed, or fallback so passenger copy can be honest. A result with no useful
direction label cannot pass the release corpus.

**Verify**: tests cover stable, conflicting, missing, loop, short-turn, and
branch headsign evidence in both travel directions.

### Step 5: Generate actionable transfer and stop instructions

Project graph paths into passenger instructions. Each leg begins at an allowed
boarding member, lists ordered intermediate transit places without duplicating
platform members, and ends at an allowed alighting member. Each transfer says
which place to leave, which line/direction to find next, and which platform or
member stop is known. Unknown platform detail is explicit, not fabricated.

When an explicit transfer connects differently named places, preserve both
names and the source transfer evidence. Do not manufacture walking language,
distance, or time. Geometry is display evidence only and must not imply a
pedestrian connection.

For an interchangeable ride step, generate shared copy for the common action
and retain an ordered list of acceptable line badges/names. The instruction
must be expressible as “take 9 or 9A” while expandable detail can show each
line's own direction and intermediate stops. Stable ordering follows documented
passenger-facing line ordering, then stable ID—not search discovery order.

**Verify**: golden instruction tests cover a direct ride, one transfer, two
transfers, parent/platform detail, differently named transfer endpoints,
unknown platform detail, one 9/9A-style interchangeable-line step, and
lookalike lines that must remain separate.

### Step 6: Qualify against the production network and route corpus

Run the service over the complete production bus artifact and every Plan 012
route-guide case. Emit a deterministic report containing:

- supported and `KnownGap` counts by direct/transfer/reverse/branch/peripheral
  category;
- selected line and direction sequences for each case;
- mismatches against acceptable reviewed sequences;
- patterns excluded for data validity, including exact reasons;
- graph size, index time, query latency distribution, expanded-state caps, and
  worst-case queries;
- direction evidence/fallback counts and unresolved ambiguity;
- duplicate-sequence collapse counts;
- interchangeable-line group counts, member lines, and rejected grouping
  candidates with reasons;
- all unsupported cases without rewriting them into false success.

Every `Supported` corpus case must return an acceptable actionable guide in
both directions where required. `KnownGap` cases remain visible in the report
and must produce the contract's recoverable no-route behavior.

**Verify**: `npm run check && npm test` succeeds and the qualification report
names the exact network, transit-place, override, and corpus versions.

## STOP conditions

Stop and report instead of continuing if:

- canonical grouping would need to be reimplemented or changed inside this
  lane;
- a required transfer exists only as geographic proximity;
- a supported instruction cannot provide a defensible direction/headsign;
- the algorithm needs timetable fields or fabricated durations to rank useful
  alternatives;
- passing cases requires fixture-specific path exceptions; or
- bounded-search/performance gates cannot cover the full production graph.

## Done when

- [ ] Static guide contracts contain no timetable or pedestrian claims.
- [ ] The complete bus snapshot compiles into a validated guide graph.
- [ ] Boarding, alighting, grouping, direction, and transfer evidence remain
      distinct and traceable.
- [ ] Returned alternatives are bounded, deterministic, deduplicated, and
      actionable.
- [ ] Interchangeable lines are one passenger step with truthful option-specific
      direction and intermediate-stop detail.
- [ ] Every leg identifies line, direction, board/alight place, and stop order.
- [ ] All supported Plan 012 route cases return acceptable sequences.
- [ ] Known gaps and ambiguous evidence remain visible.
- [ ] Existing scheduled-router tests remain green.
- [ ] `npm run check && npm test` pass.
