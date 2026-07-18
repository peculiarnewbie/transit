# Passenger shell bundle note

Measured with `npm run build` on 2026-07-18. Values below are Vite's minified
client output; gzip values are shown in parentheses.

| Load phase | Asset                                |                    Size |
| ---------- | ------------------------------------ | ----------------------: |
| Initial    | `index` application runtime          |    146.95 kB (48.46 kB) |
| Initial    | `/` route and passenger controls     |     82.09 kB (28.14 kB) |
| Lazy       | Passenger map boundary               |       1.63 kB (0.95 kB) |
| Lazy       | MapLibre canvas and fixture geometry | 1,029.59 kB (273.83 kB) |
| Lazy       | MapLibre CSS                         |     81.43 kB (12.52 kB) |

The initial JavaScript total is 229.04 kB (76.60 kB gzip). `MapCanvas` and its
MapLibre CSS are absent from the app shell's module preloads and load only after
the passenger controls mount. The map chunk is intentionally large and
replaceable; it never blocks endpoint selection or itinerary rendering.
