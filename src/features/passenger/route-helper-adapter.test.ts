import { afterEach, describe, expect, it, vi } from "vitest";

import { createRouteHelperAdapter } from "./route-helper-adapter.js";

describe("route-helper passenger adapter", () => {
  afterEach(() => vi.useRealTimers());

  it("searches ordinary places without scheduled reachability parameters", async () => {
    const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return Response.json({
        _tag: "NoMatch",
        placesArtifactVersion: "places-v1",
        networkArtifactVersion: "network-v1",
        queryText: "menteng",
      });
    };
    const adapter = createRouteHelperAdapter(fetcher);

    await adapter.searchPlaces("menteng", { artifactVersion: "places-v1" });

    expect(requests[0]?.url).toBe("/api/places?q=menteng&limit=8&artifact=places-v1");
    expect(requests[0]?.url).not.toContain("from=");
    expect(requests[0]?.url).not.toContain("departure=");
  });

  it("posts bounded nearby-transit input as JSON", async () => {
    let body: unknown;
    const fetcher: typeof globalThis.fetch = async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({
        _tag: "NoneWithinCap",
        placesArtifactVersion: "places-v1",
        networkArtifactVersion: "network-v1",
        radiusMeters: 800,
        maxCount: 6,
      });
    };
    const adapter = createRouteHelperAdapter(fetcher);

    await adapter.nearbyTransit({
      placeId: "place:menteng" as never,
      radiusMeters: 800,
      maxCount: 6,
    });

    expect(body).toEqual({ placeId: "place:menteng", radiusMeters: 800, maxCount: 6 });
  });

  it("ends a server place search instead of leaving the UI searching forever", async () => {
    vi.useFakeTimers();
    const fetcher: typeof globalThis.fetch = async (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        ),
      );
    const adapter = createRouteHelperAdapter(fetcher);

    const pending = adapter.searchPlaces("grogol");
    const rejection = expect(pending).rejects.toThrow(
      "Pencarian server tidak menjawab dalam 12 detik.",
    );
    await vi.advanceTimersByTimeAsync(12_000);

    await rejection;
  });

  it("turns a route-guide server failure into a passenger-safe retry message", async () => {
    const adapter = createRouteHelperAdapter(async () =>
      Response.json(
        { error: { code: "SERVICE_UNAVAILABLE", message: "internal failure" } },
        { status: 500 },
      ),
    );

    await expect(
      adapter.guide({
        origin: {
          placeId: "place:grogol" as never,
          displayLabel: "Grogol",
          resultKind: "TransitPlace",
          artifactVersion: "places-v1",
          coordinate: { latitude: -6.16, longitude: 106.79 },
        },
        destination: {
          placeId: "place:semanggi" as never,
          displayLabel: "Semanggi",
          resultKind: "TransitPlace",
          artifactVersion: "places-v1",
          coordinate: { latitude: -6.22, longitude: 106.82 },
        },
        originCandidates: [],
        destinationCandidates: [],
        networkArtifactVersion: "network-v1",
        placesArtifactVersion: "places-v1",
        maximumTransfers: 3,
        maximumAlternatives: 4,
      }),
    ).rejects.toThrow("Panduan rute sedang tidak tersedia. Coba lagi sebentar lagi.");
  });
});
