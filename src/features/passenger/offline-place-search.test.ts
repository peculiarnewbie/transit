import { describe, expect, it, vi } from "vitest";

import { createOfflinePlaceSearch, mergePlaceResults } from "./offline-place-search.js";

const index = {
  schemaVersion: "1",
  placesArtifactVersion: "places-v1",
  networkArtifactVersion: "network-v1",
  entries: [
    {
      placeId: "place:transit-ref:place:source:stop:grogol",
      displayLabel: "Grogol",
      aliases: [],
      disambiguatingContext: "Halte bus · Jakarta",
      resultKind: "TransitPlace",
      transitPlaceId: "place:source:stop:grogol",
      representativeLocation: { _tag: "Placed", latitude: -6.16, longitude: 106.78 },
    },
  ],
};

describe("offline passenger place search", () => {
  it("returns a stop from the local index without the API", async () => {
    const fetcher = vi.fn(async () => Response.json(index));
    const search = createOfflinePlaceSearch(fetcher as typeof fetch, undefined);

    const response = await search.search("grog");

    expect(response._tag).toBe("Matches");
    expect(response._tag === "Matches" && response.results[0]?.displayLabel).toBe("Grogol");
    expect(response._tag === "Matches" && response.results[0]?.transitPlaceId).toBe(
      "place:source:stop:grogol",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("puts authoritative server matches first and removes local duplicates", () => {
    const localValue = {
      placeId: "place:offline-stop:grogol",
      displayLabel: "Grogol",
      disambiguatingContext: "Halte bus · Jakarta",
      resultKind: "TransitPlace",
      representativeLocation: { _tag: "Placed", latitude: -6.16, longitude: 106.78 },
      matchEvidence: [{ _tag: "Token", tokens: ["grogol"] }],
      rankScore: 1_000,
    };
    const local = localValue as never;
    const server = { ...localValue, placeId: "place:server:grogol" } as never;

    expect(mergePlaceResults([local], [server])).toEqual([server]);
  });
});
