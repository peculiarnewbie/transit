# Plan 005: Migrate official train-source adapters

> **Executor instructions**: Migrate source acquisition and decoding, not the
> old app or its static-proxy API. Never write directly into canonical curated
> records.
>
> **Drift check**: `git diff --stat 07703bb..HEAD -- src/import/train test/fixtures/train`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 001
- **Category**: migration / data ingestion
- **Planned at**: commit `07703bb`, 2026-07-18

## Why this matters

The existing `/home/bolt/git/other/jkt-train-api` contains useful official-data
scrapers for KRL, MRT, and LRT, but its published model is designed for station
schedule browsing rather than routing. Migrating adapters into this repository
removes runtime coupling while retaining provenance and failure visibility.

## Current state

Relevant source files in the old repository:

- `scripts/scrape/krl.ts`: fetches 115 KRL station records and per-station
  schedules; the current derived route station arrays are alphabetically sorted
  and must not be reused as topology.
- `scripts/scrape/lrt.ts`: parses one official HTML schedule page; times lack
  destination/line tags. `src/lib/lines.ts` manually defines two ordered lines.
- `scripts/scrape/mrt.ts`: fetches 13 station details with directional schedules
  but no published route topology.
- Raw dumps are about 9.4 MB KRL, 144 KB LRT, and 152 KB MRT.

The old project has uncommitted changes in `package-lock.json` and
`wrangler.jsonc`; do not modify or depend on them.

## Commands

| Purpose             | Command                                         | Expected result                                              |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| Adapter tests       | `npm test -- src/import/train`                  | all pass without network                                     |
| Verification        | `npm run check && npm test`                     | exit 0                                                       |
| Optional live smoke | `npx tsx src/import/train/cli.ts --systems mrt` | decoded snapshot and provenance summary, no committed output |

## Scope

**In scope**:

- `src/import/train/**` (create)
- `test/fixtures/train/**` (create, sanitized official response excerpts)

**Out of scope**:

- Modifying `/home/bolt/git/other/jkt-train-api`
- Old Solid UI, static proxy endpoints, and `public/data/**`
- Canonical station coordinates, final topology, routing, D1, API routes
- Claiming exact schedules where sources lack them

## Git workflow

- Branch/worktree: `work/005-train-adapters`
- Suggested commit: `feat(import): migrate official Jakarta train adapters`

## Steps

### Step 1: Define raw provider schemas and typed errors

Create separate KRL, MRT, and LRT raw schemas beside each adapter. Decode all
unknown HTTP/HTML-derived values at the boundary. Model transport, rejected
status, decode, parse, partial-source, and rate-limit failures as tagged errors
with operation labels and redacted evidence.

Use the Effect HttpClient modules supported by the pinned v4 package. Use raw
`fetch` only if the Workers/Node adapter boundary requires it, and then wire the
abort signal and preserve typed errors.

**Verify**: fixture tests reject changed/malformed provider shapes with the
correct error tag.

### Step 2: Migrate source-specific acquisition

Port the useful fetch/parse logic, replacing sequential manual sleeps with
bounded Effect concurrency and `Schedule` pacing/retry. Retry only idempotent
GET operations and honor provider retry hints where present.

Keep each adapter independent: one provider outage must return a partial import
report rather than erase successful systems.

**Verify**: deterministic tests use fake HTTP layers and TestClock; no real
sleeps or network calls occur.

### Step 3: Emit source snapshots without false topology

Emit source records with provenance, station names/IDs, observed schedules, and
an explicit completeness classification.

- KRL: retain observations keyed by train ID and station but do not use the old
  alphabetically sorted route arrays.
- LRT: retain known manually sourced ordered topology with provenance; classify
  untagged departure lists honestly.
- MRT: retain directional station schedules; mark topology unresolved until
  curated or independently sourced.

Coordinates remain unresolved in this plan.

**Verify**: snapshots decode and every system has an explicit service-
availability state.

### Step 4: Add reproducible fixture and live CLI modes

The default tests run solely from committed fixtures. Add
`src/import/train/cli.ts`, invoked directly with `npx tsx`; do not edit
`package.json` in this parallel lane. The optional CLI performs live acquisition,
writes only to an ignored output path, prints source counts, timestamps,
failures, and a content hash, and exits nonzero only under the documented
all-sources-failed policy.

**Verify**: fixture-mode CLI produces byte-stable output for a fixed timestamp.

## Done criteria

- [ ] KRL, MRT, and LRT adapters have independent typed boundaries.
- [ ] Tests use fake HTTP layers and deterministic time.
- [ ] No old static API/UI code was copied.
- [ ] No alphabetical KRL station list is presented as route order.
- [ ] Incomplete schedules/topology remain explicit.
- [ ] `npm run check && npm test` passes.

## STOP conditions

- Provider use requires credentials or terms not documented in the old source.
- The installed Effect HTTP API differs materially from the repository skill;
  report the exact mismatch before adding a competing client library.
- A provider response cannot be represented without inventing topology or time
  semantics.

## Maintenance notes

Source adapters should be disposable and replaceable. The source snapshot is
evidence; Plan 009 owns projection into a routable network.
