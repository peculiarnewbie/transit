# TransJakarta route-helper product contract

This document is the normative product boundary for the usable bus midpoint
(Plans 012–016). It is not a timetable, live vehicle, fare, or pedestrian
routing contract.

## Destination and midpoint

The committed long-term product remains multimodal: TransJakarta bus, curated
train topology, and street-routed walking (Plans 008–011).

The middle milestone is a **time-independent TransJakarta bus route helper**.
It helps an unfamiliar passenger choose ordinary Jakarta places and receive
clear boarding, line, direction, transfer, and alighting instructions. Exact
departure, arrival, wait, trip, and walking minutes are absent. Live vehicles
and fares are absent.

When Plans 010 and 011 add multimodal schedules or street-routed walking, this
route-helper contract **must remain available as a complete fallback** whenever
those capabilities are unavailable.

## Passenger inputs

A passenger may express an endpoint as any of:

- a passenger-facing transit place (station, terminal, platform complex, or
  stop);
- a neighbourhood or administrative area;
- a landmark or point of interest (market, mall, campus, hospital, stadium,
  terminal, rail station, and similar);
- a map point chosen on the map;
- a device coordinate after an explicit permission action.

A passenger does **not** need to know a GTFS stop name or stop ID.

## Geographic proximity rules

A geographic place resolves to a **bounded set of nearby transit boarding
places**. Straight-line distance may rank or describe those choices as
“nearby” / approximate geographic distance.

Straight-line distance **must never** be shown as:

- walking time;
- pedestrian feasibility;
- street directions;
- a transfer edge;
- proof that a path is safely walkable.

Street-routed access and egress remain Plan 011.

## Search visibility

Search must **never hide a recognized destination** merely because the current
bus graph cannot produce a route. Reachability is not a search filter.
Recognized places remain visible; route coverage failures are a separate,
recoverable result.

## Route guidance requirements

Every returned transit ride step must identify:

1. the route/line (or interchangeable line options);
2. the direction or headsign for each line option;
3. the boarding place (and member stop/platform when known);
4. the alighting place (and member stop/platform when known);
5. the ordered intermediate passenger-facing stops for orientation;
6. explicit transfer instructions when another ride follows.

Results rank **meaningful route sequences**, not scheduled trip instances.

### Interchangeable lines

When several lines require the **same passenger action**—board at the same
boarding point, alight at the same place, and continue with the same next
action (transfer or finish)—the guide groups them into **one ride step** and
clearly says that any of the listed lines is usable (for example,
“9 or 9A” / “9 atau 9A”).

The guide retains line-specific direction/headsign and intermediate-stop
detail. It must **not** pretend the complete services are operationally
identical.

Do **not** group lines that require different platforms, alighting points,
boarding/alighting policies, or onward transfers.

## Absent capabilities (middle milestone)

The midpoint product must not expose or imply:

- exact departure or arrival times;
- wait, trip, or walking minutes;
- live vehicle positions;
- fares;
- pedestrian routing, walkability, or street directions.

The scheduled routing core may remain in the repository for later products and
comparisons; it must not fabricate precision in the midpoint UI.

## Failure and recovery

Failure preserves both passenger inputs. It identifies whether **place
discovery** or **route coverage** failed, and offers nearby transit choices or
endpoint edits. Distinct recoveries include:

- no text match;
- recognized place but no bus route;
- no nearby transit choice within the discovery cap;
- stale artifact/selection;
- offline or transient failure;
- map failure while text guidance remains usable.

## Deployment disclosure

The deployed product must clearly state:

- bus-only coverage for this midpoint;
- artifact freshness / version;
- unsupported capabilities (timetable, live vehicles, fares, pedestrian
  routing).

## Endpoint selection interaction

The endpoint selector follows the familiar map-product interaction model
(behaviour only—not another product’s branding or assets):

- floating top control on phone-sized viewports;
- floating side panel on wider desktop viewports;
- autocomplete directly below the active input;
- one obvious atomic origin/destination reverse action.

## Complete examples

Examples use passenger instructions only. They do not use internal GTFS IDs or
timetable fields.

### Example A — Direct route

**Passenger goal:** From Blok M to Bundaran HI.

**Guide:**

1. Board at **Blok M** on line **1** toward **Kota**.
2. Ride through ordered stops such as ASEAN, Masjid Agung, Bundaran Senayan,
   Gelora Bung Karno, Polda Metro, and Dukuh Atas.
3. Alight at **Bundaran HI Astra**.

No transfer. No minutes. No walk claim.

### Example B — Transfer route

**Passenger goal:** From Ragunan to Harmoni.

**Guide:**

1. Board at **Ragunan** on line **6** / **6A** / **6B** (acceptable reviewed
   options may vary by boarding member) toward the city centre, and alight at
   a named transfer place such as **Galunggung** or **Balai Kota** according
   to the selected sequence.
2. Transfer at that place to the next stated line and direction.
3. Alight at **Harmoni**.

Each ride step still names board place, line(s), direction, intermediate
stops, and alight place. No minutes. No pedestrian connector language.

### Example C — Recognized place, no route

**Passenger goal:** From a recognized landmark near the network edge to another
recognized place that the current bus topology cannot connect within the guide
caps.

**Result:**

- Both selected places remain visible.
- The product states that no bus route sequence was found.
- Nearby transit boarding choices for each place remain available for editing.
- The failure is classified as route coverage, not as “place unknown”.

## Parallel lane ownership

| Plan | Owns | Consumes / publishes |
| --- | --- | --- |
| **013** | Canonical passenger-facing transit places and retained static boarding/direction evidence | Publishes `TransitPlace`, `TransitPlaceIndex`, boarding/alighting policy fields, and `PatternDirectionEvidence` |
| **014** | Geographic place artifacts and unified place discovery | Consumes Plan 013 `TransitPlace` / coordinates / aliases / served-route summary; publishes place search + nearby transit choice results |
| **015** | Time-independent topology routing and instruction generation | Consumes Plan 013 membership, policies, patterns, and direction evidence; publishes `RouteGuideQuery` / guide results with interchangeable `lineOptions` |
| **016** | HTTP/UI integration, map behaviour, localization, performance, usability evidence, midpoint deployment | Consumes Plan 014 discovery and Plan 015 route-guide services; owns passenger APIs and UI |

Plans **014** and **015** may run in parallel **only after** Plan 013’s public
contracts merge. Neither may modify the other’s directories. Plan **016** is the
only midpoint lane that joins those contracts into the public product.

### Shared schemas consumed by downstream lanes

Downstream lanes decode and respect these Plan 012 acceptance schemas as
release evidence (not as the production place database):

- `PlaceSearchCase`
- `RouteGuideCase`
- `UsabilityTask`
- `CorpusManifest`

If a shared schema must change later, the changing lane updates the corpus
decoders and notifies the other active lane before merging.

### Production qualification rule

Production qualification uses broad versioned artifacts and this reviewed
corpus. Demo-only fixtures and curated facades must not substitute for
production composition.
