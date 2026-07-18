# Transit-place lane contracts (Plans 014 and 015)

Plan 013 publishes these stable surfaces. Downstream lanes must consume them
without mutating grouping or headsign evidence ad hoc.

## Plan 014 consumes

- `TransitPlace`
- representative and member coordinates (`representativeLocation`, member stop
  locations via `memberStopIds`)
- `aliases`
- `servedRouteIds`
- `TransitPlaceIndex` (`placesById`, `placeIdByStopId`)

## Plan 015 consumes

- transit-place membership (`TransitPlaceIndex`)
- boarding/alighting policies on canonical `StopTime`
- ordered `RoutePattern` stop sequences
- `PatternDirectionEvidence` / `DirectionEvidenceReport`

## Shared rules

- Neither Plan 014 nor Plan 015 may invent transfers from display grouping.
- Disputed groups remain `unresolvedFindings` until a versioned reviewed
  override resolves them.
- Reviewed overrides declare `sourceArtifactVersion` and are rejected when
  stale.

## Compile-only contract tests

`src/discovery/transit/lane-contract.test.ts` asserts the exported schema shapes
required by both lanes.
