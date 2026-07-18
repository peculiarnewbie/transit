# Plan 016: Integrate and release the usable bus route helper

> **Executor instructions**: Follow this plan step by step. This is the serial
> integration and release gate after the parallel Plans 014 and 015 merge. It
> owns passenger APIs, routes, state, and presentation. Do not reimplement
> discovery, grouping, or route-guide rules in handlers or components. The
> shipped middle milestone is bus-only and time-independent; timetable,
> departure/arrival, live vehicle, fare, and pedestrian-routing features are
> out of scope. When done, update this plan's status in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat b626253..HEAD -- src/runtime src/routes src/features/passenger src/components src/routeTree.gen.ts public plans`
> and
> `git diff --stat -- src/runtime src/routes src/features/passenger src/components src/routeTree.gen.ts public plans`.
> Plans 007 and the current working tree already touch these paths. Review both
> committed and uncommitted differences before editing; preserve unrelated
> work. Start only after Plans 014 and 015 are merged and verified together.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: Plans 014 and 015
- **Category**: vertical integration / UX / release
- **Planned at**: commit `b626253`, 2026-07-18

## Why this matters

Correct data and algorithms do not make a usable product by themselves. The
first deployed demo must work for an unfamiliar passenger without a presenter
who knows internal stop names, hidden controls, or curated happy paths. This
plan joins broad place discovery and static bus guidance into one resilient,
mobile-first task: choose ordinary places, understand the available boarding
choices, and receive actionable line/direction/transfer instructions.

This is the public midpoint before Plans 008–011 add curated train topology,
multimodal composition, and street-routed walking. Its static bus helper remains
available later when schedules or walking data are absent.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| API/runtime tests | `npm test -- src/runtime src/routes` | all API contracts and handlers pass |
| Passenger tests | `npm test -- src/features/passenger src/components` | state and component tests pass |
| Full verification | `npm run check && npm test` | exit 0 |
| Production build | `npm run build` | exit 0 with deployable Worker/assets |
| Artifact qualification | project script added in Step 7 | exact production versions pass |

## Suggested executor toolkit

- Use the repository-local `effect` skill for API schemas, services/layers,
  thin handlers, typed recovery, and Effect-aware integration tests.
- Use `frontend-design` if available for the production passenger flow while
  retaining the repository's existing visual language and SPA constraints.
- Use `write-better-error-messages` if available for recognized-place,
  unsupported-route, artifact, and network failure states.

## Scope

**In scope**:

- `src/runtime/**`
- passenger API file routes under `src/routes/api/**`
- passenger pages under `src/routes/**`
- `src/features/passenger/**`
- passenger map/presentation components under `src/components/**`
- `src/routeTree.gen.ts` through the normal route generator
- static artifact wiring and cache metadata under `public/**`
- release/qualification scripts and documentation
- this plan and `plans/README.md`

**Out of scope**:

- changing the algorithms or production data contracts owned by Plans 013–015
  except through a reviewed upstream fix with regression evidence;
- train ingestion/curation, multimodal graph composition, or admin UI;
- schedules, departure/arrival selection, service calendars, live vehicles,
  wait/trip/walk minutes, fares, and accessibility routing claims;
- street or pedestrian routing;
- silently deleting the existing scheduled journey endpoint if another
  consumer still uses it.

## Git workflow

- Branch: `work/016-usable-bus-route-helper`
- Base: merge commit containing completed Plans 014 and 015
- Suggested commit: `feat(passenger): ship place-aware bus route helper`
- Do not deploy, push, or open a PR unless instructed.

## Steps

### Step 1: Reconcile the existing Plan 007 vertical slice

Inventory the current passenger flow, `/api/stops`, `/api/journeys`, runtime
composition, generated routes, map behavior, and tests. Classify each surface:

- reusable implementation detail;
- scheduled capability retained for later use but removed from the midpoint's
  primary flow;
- incompatible passenger contract requiring versioned replacement;
- dead demo-only behavior safe to remove with test evidence.

Do not mutate the scheduled routing model into the static guide model. Add the
new route-helper surface beside it, migrate the passenger UI, and deprecate or
restrict old endpoints deliberately. Record any remaining consumer before
removing an API. Remove fixture/demo shortcuts from production composition;
test fixtures remain test-only.

**Verify**: a written contract map identifies the owner and disposition of
every current passenger API field and primary UI control.

### Step 2: Add thin typed place and route-guide APIs

Publish versioned contracts for two capabilities, whether as separate routes
or a documented equivalent:

- place search and nearby transit choices;
- time-independent route-guide search.

Decode all query/body/artifact boundaries with Effect `Schema`. Route handlers
must delegate to the Plan 014 discovery and Plan 015 route-guide services via
runtime layers; they must not contain fuzzy matching, candidate selection,
pathfinding, grouping, or headsign fallback rules.

Use stable selected-place IDs plus artifact version. Preserve both passenger
selections on every result. Return tagged success, recognized-place/no-route,
no-place-match, stale-selection, validation, artifact, and transient server
failure variants. Bound text length, result count, endpoint candidates, and
request work. Apply cache headers deliberately: immutable versioned artifacts
may be cached; personalized/device coordinates and query results must not leak
through shared caches.

**Verify**: contract and handler tests cover schema rejection, stale versions,
recognized-place/no-route, bounded results, production layer composition, and
failure redaction without losing useful recovery context.

### Step 3: Build one ordinary-place endpoint-selection flow

Replace stop-only origin/destination inputs with a unified searchable place
control accepting areas, landmarks, transit places, and exact stop/station
names. The control must:

- distinguish ambiguous results using type and locality;
- preserve stable selection IDs rather than only labels;
- allow keyboard, touch, and screen-reader operation;
- show loading, empty, offline/failure, and retry states without clearing the
  other endpoint;
- support endpoint swap and editing after a result;
- optionally accept a map point or device coordinate only after an explicit
  user action and permission;
- work completely without opening the map or granting location permission.

After a geographic selection, show a small set of nearby transit choices when
the choice materially changes boarding. Label distance as approximate
geographic distance. Do not call it a walking distance/time or promise
accessibility. Never hide a recognized place because the bus guide has no path.

Keep line preference/require/lock controls out of the primary flow. If retained
for expert use, place them in a clearly secondary advanced section and ensure
the ordinary task never depends on them.

**Verify**: component/state tests cover search, ambiguity, select, clear, swap,
map/device opt-in denial, stale selection, endpoint recovery, and recognized
place with no supported route.

### Step 4: Present actionable bus guidance

Render alternatives as passenger decisions, not graph diagnostics. The summary
must lead with ordered line badges/names, directions/headsigns, boarding place,
transfer count, and alighting place. Expanded detail must show:

- the exact member stop/platform when known;
- ordered intermediate stops for orientation;
- explicit transfer place and next line/direction;
- alternate nearby boarding choices where they produce a meaningfully
  different guide;
- fallback/uncertain direction or platform copy without internal evidence
  codes;
- bus-only coverage and source artifact freshness.

Do not show departure, arrival, wait, trip, or walk minutes. Do not label a
straight connector as a walking leg. If route geometry is available, draw the
transit legs and stop markers; avoid drawing unverified pedestrian connectors.
The text instructions remain complete when the map cannot load.

Alternative cards must explain their useful difference (for example fewer
transfers or a different boarding place) and must not expose duplicate
underlying patterns that require identical passenger actions.

**Verify**: component tests and visual review cover direct, one-transfer,
two-transfer, branch/direction fallback, platform unknown, no geometry, and
multiple nearby boarding choices.

### Step 5: Design honest recovery and low-bandwidth behavior

Implement distinct recovery for:

- no text match: edit query and examples of supported place types;
- recognized place but no bus route: retain both places, show considered nearby
  transit choices, allow changing either choice, and say coverage may be
  incomplete;
- no nearby transit choice: retain the place and allow a map point or different
  endpoint;
- stale artifact/selection: refresh discovery while preserving the typed text;
- offline/transient failure: retry without clearing selections;
- map failure: continue with the complete text guide.

Use Bahasa Indonesia as the primary product language, or provide genuinely
equivalent Bahasa Indonesia and English paths if the existing product requires
both. Test copy with passenger vocabulary rather than GTFS terms. Ensure focus
movement and announcements make asynchronous search and result changes usable
with assistive technology.

Load the map and route geometry on demand after the text task is usable. Do not
download or render the entire network overlay during initial interaction. Keep
the existing client-only SPA constraint and dynamically import MapLibre after
mount.

**Verify**: throttled-network tests prove search and text results remain usable;
accessibility checks cover labels, focus order, announcements, contrast, touch
targets, and keyboard completion.

### Step 6: Integrate real production artifacts end to end

Compose the exact published place, transit-place, bus-network, direction, and
override versions in the production runtime. Fail startup/build qualification
for incompatible schema or cross-artifact versions rather than silently
falling back to a demo fixture. Display artifact freshness and coverage in a
small passenger-readable disclosure, with detailed versions available for
support/debugging.

Exercise the deployed-build equivalent from HTTP request through services to
rendered passenger instructions using production artifacts. Tests must prove
that broad search data, canonical boarding places, and route-guide results—not
fixture substitutions—drive the flow.

**Verify**: production composition tests record artifact IDs/checksums and fail
if a fixture/demo artifact is selected.

### Step 7: Enforce performance, reliability, and corpus release gates

Add a deterministic release qualification command covering every Plan 012
place and route case against production composition. Record:

- search recognition/top-result acceptance and route-sequence acceptance;
- every known gap and regression;
- cold/warm place index construction and query latency;
- guide index construction, query latency, and worst expanded-state count;
- API response sizes and latency;
- initial app-shell assets, lazy map/geometry assets, and route result payloads;
- low-bandwidth and low-memory behavior against explicit budgets agreed in the
  Plan 012 contract.

The command must fail on an unexpected supported-case regression, artifact
version mismatch, missing attribution/freshness metadata, accidental timetable
field, pedestrian claim, or production fixture fallback.

**Verify**: `npm run check && npm test && npm run build` plus the qualification
command all exit 0 using the release-candidate artifact set.

### Step 8: Run unfamiliar-user usability acceptance

Test at least five people who did not build or routinely demo the product
against all six or more Plan 012 tasks on a phone-sized viewport. The operator
may explain the product in one neutral sentence but may not name stops, point
to controls, or choose the journey. Record for every task:

- completion without assistance;
- whether the chosen origin/destination matched intent;
- whether the person could state the line, direction, boarding place,
  alighting place, and transfer action;
- wrong turns, hesitation points, and recovery success;
- completion time as usability evidence, not a transit estimate.

Use Plan 012's pre-agreed release threshold: at least four of five participants
complete each core task without presenter assistance, and no participant may
leave with a materially wrong boarding direction or fabricated walking/timing
belief. Treat any repeated critical-task failure as systemic even if the raw
threshold passes. Fix systemic problems and rerun affected tasks. Do not change
the corpus or scripted task to conceal a usability failure.

**Verify**: a redacted report maps every task to evidence, issue disposition,
and rerun result. Any unresolved critical failure blocks release.

## STOP conditions

Stop and report instead of continuing if:

- Plans 014 and 015 do not pass together on the same artifact versions;
- the production runtime selects a curated demo fixture or live geocoder;
- the primary task still requires a known GTFS stop name, line constraint,
  map, timetable input, or presenter assistance;
- a response implies a pedestrian path, walking time, or scheduled service;
- a recognized endpoint is hidden because routing fails;
- critical corpus or unfamiliar-user tasks fail; or
- production budgets can be met only by reducing place/network coverage to a
  curated facade.

## Done when

- [ ] An unfamiliar passenger can route between ordinary Jakarta places
      without knowing stop names.
- [ ] Areas, landmarks, transit places, map points, and device coordinates have
      honest, recoverable selection paths.
- [ ] Every successful leg clearly states line, direction, board/alight place,
      intermediate stops, and transfers.
- [ ] Timetable, live, fare, and pedestrian-routing claims are absent.
- [ ] Text guidance works without the map and under the agreed low-bandwidth
      budgets.
- [ ] Production artifacts, not demo fixtures, pass all acceptance cases.
- [ ] At least five unfamiliar-user sessions meet the agreed task thresholds.
- [ ] Known gaps, artifact freshness, and bus-only coverage are visible.
- [ ] The static bus helper is documented as a fallback for Plans 010–011.
- [ ] `npm run check && npm test && npm run build` and release qualification
      all pass.
