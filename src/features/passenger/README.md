# Passenger shell bundle note

Measured with `npm run build` on 2026-07-18. Values below are Vite's minified
client output; gzip values are shown in parentheses.

| Load phase | Asset                            |                    Size |
| ---------- | -------------------------------- | ----------------------: |
| Initial    | `index` application runtime      |    146.96 kB (48.47 kB) |
| Initial    | `/` route and passenger controls |     85.06 kB (29.17 kB) |
| Lazy       | Passenger map boundary           |       1.68 kB (0.96 kB) |
| Lazy       | MapLibre canvas                  | 1,029.29 kB (273.73 kB) |
| Lazy       | MapLibre CSS                     |     81.43 kB (12.52 kB) |

The initial JavaScript total is 232.02 kB (77.64 kB gzip). `MapCanvas` and its
MapLibre CSS are absent from the app shell's module preloads and load only after
the passenger controls mount. The map chunk is intentionally large and
replaceable; it never blocks endpoint selection or itinerary rendering.

Production stop suggestions and journeys come from `/api/stops` and
`/api/journeys`. Component tests retain the deterministic fixture adapter. The
selected journey's geometry travels with the bounded journey response; the map
never loads the complete geometry sidecar or a fixture geometry table.
