# Plan 016 Step 1 — passenger surface contract map

Base: merge of Plans 014 + 015 on `main` (`3516932`). Branch: `work/016-usable-bus-route-helper`.

## APIs

| Surface                      | Owner    | Disposition                                                                      |
| ---------------------------- | -------- | -------------------------------------------------------------------------------- |
| `GET /api/stops`             | Plan 007 | **Retain** scheduled stop search for later/expert use; not primary midpoint UI   |
| `POST /api/journeys`         | Plan 007 | **Retain** timetable journey planner beside static guide; not mutated into guide |
| `GET /api/places`            | Plan 016 | **Add** thin place search → Plan 014 discovery                                   |
| `POST /api/nearby-transit`   | Plan 016 | **Add** nearby transit choices → Plan 014                                        |
| `POST /api/route-guide`      | Plan 016 | **Add** time-independent guide → Plan 015 (`lineOptions` preserved)              |
| `GET /api/artifact-versions` | Plan 016 | **Add** production artifact disclosure                                           |

## Runtime

| Module                                          | Disposition                                            |
| ----------------------------------------------- | ------------------------------------------------------ |
| `ArtifactStore` + `RouteQuery` + journeys/stops | Reuse for scheduled path                               |
| `PlaceArtifactStore`                            | **Add** places manifest + production fixture rejection |
| `RouteHelperQuery`                              | **Add** composition of discovery + route-guide         |
| Demo/fixture production fallback                | **Forbidden** in production place load                 |

## UI (later steps)

| Control                                   | Disposition                             |
| ----------------------------------------- | --------------------------------------- |
| Stop-only origin/destination              | Replace with place selection (Step 3)   |
| Date/time / line lock primary flow        | Demote; scheduled retained via API only |
| Reachability filter on destination search | Remove from primary place search        |
| Line prefer/require/lock                  | Secondary/advanced only if kept         |
