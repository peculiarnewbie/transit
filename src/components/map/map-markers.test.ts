import { describe, expect, it } from "vitest";

import { endpointFeatureCollection } from "./map-markers.js";

describe("endpoint map markers", () => {
  it("places selected origin and destination coordinates on the map", () => {
    const collection = endpointFeatureCollection({
      origin: { longitude: 106.8229, latitude: -6.1944 },
      destination: { longitude: 106.8317, latitude: -6.2186 },
    });

    expect(collection.features).toEqual([
      expect.objectContaining({
        properties: { kind: "origin" },
        geometry: { type: "Point", coordinates: [106.8229, -6.1944] },
      }),
      expect.objectContaining({
        properties: { kind: "destination" },
        geometry: { type: "Point", coordinates: [106.8317, -6.2186] },
      }),
    ]);
  });

  it("omits endpoints that have not been selected", () => {
    expect(endpointFeatureCollection({}).features).toEqual([]);
  });
});
