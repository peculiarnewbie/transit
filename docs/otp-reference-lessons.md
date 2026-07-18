# Lessons from OpenTripPlanner

OpenTripPlanner (OTP) is a useful reference implementation for Transit, not a
runtime dependency or an architectural template. OTP is designed for large,
long-lived public deployments with a JVM service, an OpenStreetMap street graph,
multi-feed graph builds, and substantial operational capacity. Transit is a
solo-maintained, Worker-first Jakarta planner whose V1 routes only between
explicitly selected stops or stations.

The useful comparison is therefore about engineering discipline: make data,
policy, and results reproducible and inspectable while keeping the routing
runtime small.

## Practices to adopt

### Give every feed a stable identity

OTP requires unique feed IDs when it builds a network from multiple GTFS or
NeTEx sources. Do the same before combining TransJakarta with any generated or
curated train feed.

The GTFS compiler must accept a validated, stable `feedId`; all canonical IDs
and source references must derive from it. Feed identity is not a content hash:
it identifies a producer across refreshes. Content hashes identify a particular
artifact version.

At publication, compose one immutable network manifest containing:

- the published network version/content hash;
- each source artifact and its hash;
- curation revision IDs;
- compiler and schema versions; and
- the routing-policy version.

Atomically activate one manifest, and include its network version in stop and
journey API responses. This lets an operator reproduce a passenger report
against the exact data and policy that produced it.

**Where it belongs:** the feed identity seam precedes multi-feed composition;
the manifest belongs with Plans 009 and 010.

### Treat import and publication findings as data

OTP accumulates structured import findings and produces a report after a graph
build. Transit already validates inputs, but some compiler warnings are only
strings. Publish a small common `ValidationFinding` schema instead:

- stable code;
- severity (`Info`, `Warning`, or `Error`);
- source/entity references;
- safe human-readable message; and
- optional suggested operator action.

Import, curation validation, train projection, and final composition should all
produce these findings. Only explicit `Error` findings block publication.
Persisting them makes a stale source mapping, an unresolved station, or an
ambiguous source geometry reviewable without reconstructing history from logs.

**Where it belongs:** Plans 006 and 009.

### Make transfer meaning affect routing

The canonical `Transfer` model distinguishes `Recommended`, `Timed`,
`MinimumTime`, and `Forbidden`. The router must preserve that distinction.

Create one routing-local transfer-policy function that resolves the transfer
duration, any safety buffer, preference cost, and rider explanation from the
curated transfer kind and verification state. In particular, an absent minimum
duration must not silently become a zero-second transfer. `Timed` should remain
labeled as such, but must not claim a connection guarantee unless the available
schedule data can prove one.

This is deliberately narrower than OTP's street-derived transfer machinery: V1
uses only published, reviewed transfer edges.

**Where it belongs:** the next routing increment, before multimodal public
routing.

### Separate routing from alternative policy

OTP routes first, then uses a policy stage to sort, group, suppress, and
decorate itineraries. Transit currently scores, Pareto-filters, deduplicates,
and limits alternatives at the end of the search.

Keep the search responsible for generating valid candidate itineraries. Add a
small deterministic post-search policy stage for:

1. Pareto dominance;
2. near-duplicate or same-route-sequence suppression;
3. final result limits and sorting; and
4. a debug-only trace recording why a candidate was suppressed.

Passenger responses should remain compact. The trace is for authenticated admin
diagnostics and tests, not a second public API.

**Where it belongs:** Plan 010, after the bus vertical slice has a stable API.

### Build a real Jakarta journey corpus

The existing synthetic benchmark is valuable for detecting algorithmic
explosions and preserving deterministic results. It cannot show whether a
particular real transfer, constrained route, or incomplete train service remains
truthful after data changes.

Maintain a compact, named corpus against a pinned published snapshot. Each case
should assert semantic outcomes rather than incidental full JSON:

- boarded routes and ordered transfer stops;
- required, excluded, preferred, and locked-line behavior;
- missed connections and no-service cases;
- explicit transfer duration and uncertainty text; and
- scheduled versus frequency-only or topology-only service behavior.

Run the same corpus against the Worker and browser Web Worker implementations.
They must produce equivalent results for the same immutable network version.

**Where it belongs:** begin with the routing test suite; use it as the Plan 010
runtime-selection gate.

### Make limits and failures observable

The bounded search has caps on expansions, retained labels, and destination
candidates. Preserve those caps, but return an internal `SearchOutcome` that
records the stop reason and relevant counts. A cap hit must not be
indistinguishable from an authoritative `NoRoute` result.

At the HTTP boundary, return stable, Schema-validated error codes such as
`invalid_query`, `no_route`, `search_limited`, `network_unavailable`, and
`internal`. Include a request ID and the network version. Map those codes to
local passenger copy; do not expose internal stacks, raw provider data, or the
full diagnostic trace.

**Where it belongs:** Plan 007.

## Performance sequence

Before changing algorithms, improve the compact immutable routing index:

- direct pattern and trip lookup by ID;
- stop positions per pattern, retaining every position for circular patterns;
- existing stop-to-pattern, pattern-to-trip, transfer, and calendar indexes.

Measure these changes with the Jakarta corpus and the synthetic benchmark. A
true round-based RAPTOR rewrite is a later option only if the published Jakarta
snapshot violates documented Worker or browser budgets. Such a rewrite must
retain the existing frequency, circular-pattern, constraints, and locked-leg
behavior.

## Explicit non-goals

Do not adopt these OTP capabilities without evidence that Transit needs them:

- a JVM service or large graph-build operation;
- OpenStreetMap-based arbitrary-coordinate access, egress, or transfers;
- dynamic multi-minute searches, parallel heuristics, or a general street graph;
- OTP's generic GraphQL/debug client or a multi-service product surface; or
- realtime overlays before a reliable Jakarta realtime source and expiry policy
  exist.

The passenger product remains a small typed REST adapter and a list-first,
weak-network-friendly UI. OTP is a correctness and design reference; it is not
the production architecture.

## Reference locations

- `../OpenTripPlanner/raptor/src/main/java/org/opentripplanner/raptor/package.md`
  for OTP's routing and performance trade-offs.
- `../OpenTripPlanner/application/src/main/java/org/opentripplanner/routing/algorithm/filterchain/package.md`
  for its post-routing itinerary policy design.
- `../OpenTripPlanner/application/src/main/java/org/opentripplanner/graph_builder/issue/api/DataImportIssueStore.java`
  for structured import findings.
- `../OpenTripPlanner/doc/user/features-explained/Feed-ID.md` for multi-feed
  identity requirements.
- `src/routing/DESIGN.md`, `src/routing/BENCHMARK.md`, and the Plans 006, 007,
  009, and 010 documents for Transit-specific constraints and execution order.
