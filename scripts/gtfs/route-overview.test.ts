import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { GeometrySidecar, NetworkSnapshot } from "../../src/domain/transit/index.js";
import { networkFixture } from "../../src/routing/fixtures/network.js";
import { routeOverviewFeatures } from "./route-overview.js";

describe("route overview artifact", () => {
  it("includes each published route stop as a selectable point", () => {
    const snapshot = Schema.decodeUnknownSync(NetworkSnapshot)(networkFixture);
    const geometry = Schema.decodeUnknownSync(GeometrySidecar)({
      schemaVersion: "1",
      generatedAt: "2026-07-18T00:00:00.000Z",
      geometries: [],
    });

    const stops = routeOverviewFeatures(snapshot, geometry).filter(
      (feature) => feature.geometry.type === "Point",
    );

    expect(stops).toHaveLength(snapshot.stops.length);
    expect(stops[0]).toMatchObject({
      properties: { kind: "stop", id: "stop:A", name: "stop:A" },
      geometry: { type: "Point", coordinates: [106.8, -6.2] },
    });
  });
});
