import type {
  PassengerPlaceSearchResult,
  PlaceSearchResponse,
} from "../../runtime/route-helper-contracts.js";
import { normalizeSearchText, tokenize } from "../../discovery/place/normalize.js";

const indexUrl = "/artifacts/places/offline-search-20260718-v2.json";
const cacheName = "transit-offline-place-search-v2";

interface OfflineEntry {
  readonly placeId: string;
  readonly displayLabel: string;
  readonly aliases: ReadonlyArray<string>;
  readonly disambiguatingContext: string;
  readonly resultKind: "Area" | "Landmark" | "TransitPlace";
  readonly representativeLocation: {
    readonly _tag: "Placed";
    readonly latitude: number;
    readonly longitude: number;
  };
  readonly bounds?: PassengerPlaceSearchResult["bounds"];
  readonly transitPlaceId?: string;
}

interface OfflineIndex {
  readonly schemaVersion: "1";
  readonly placesArtifactVersion: string;
  readonly networkArtifactVersion: string;
  readonly entries: ReadonlyArray<OfflineEntry>;
}

const readIndex = async (response: Response): Promise<OfflineIndex> => {
  if (!response.ok) throw new Error(`Indeks halte lokal mengembalikan HTTP ${response.status}.`);
  const value = (await response.json()) as Partial<OfflineIndex>;
  if (
    value.schemaVersion !== "1" ||
    typeof value.placesArtifactVersion !== "string" ||
    typeof value.networkArtifactVersion !== "string" ||
    !Array.isArray(value.entries)
  )
    throw new Error("Indeks halte lokal tidak valid.");
  return value as OfflineIndex;
};

const scoreEntry = (entry: OfflineEntry, query: string, queryTokens: ReadonlyArray<string>) => {
  const names = [entry.displayLabel, ...entry.aliases].map(normalizeSearchText);
  if (names.some((name) => name === query)) return 1_000;
  if (names.some((name) => name.startsWith(query))) return 800;
  if (
    names.some((name) => {
      const nameTokens = tokenize(name);
      return queryTokens.every((token) =>
        nameTokens.some((nameToken) => nameToken.startsWith(token)),
      );
    })
  )
    return 600;
  if (names.some((name) => name.includes(query))) return 400;
  return 0;
};

export const mergePlaceResults = (
  local: ReadonlyArray<PassengerPlaceSearchResult>,
  server: ReadonlyArray<PassengerPlaceSearchResult>,
  limit = 8,
): ReadonlyArray<PassengerPlaceSearchResult> => {
  const merged = new Map<string, PassengerPlaceSearchResult>();
  for (const result of server) merged.set(result.placeId, result);
  for (const result of local) {
    const identity = `${normalizeSearchText(result.displayLabel)}|${
      result.representativeLocation._tag === "Placed"
        ? `${result.representativeLocation.latitude.toFixed(5)},${result.representativeLocation.longitude.toFixed(5)}`
        : result.placeId
    }`;
    const duplicate = [...merged.values()].some((candidate) => {
      const candidateIdentity = `${normalizeSearchText(candidate.displayLabel)}|${
        candidate.representativeLocation._tag === "Placed"
          ? `${candidate.representativeLocation.latitude.toFixed(5)},${candidate.representativeLocation.longitude.toFixed(5)}`
          : candidate.placeId
      }`;
      return identity === candidateIdentity;
    });
    if (!duplicate && !merged.has(result.placeId)) merged.set(result.placeId, result);
  }
  return [...merged.values()].slice(0, limit);
};

export const createOfflinePlaceSearch = (
  fetcher: typeof globalThis.fetch = globalThis.fetch,
  cacheStorage: CacheStorage | undefined = typeof globalThis.caches === "undefined"
    ? undefined
    : globalThis.caches,
) => {
  let loaded: Promise<OfflineIndex> | undefined;
  const load = () => {
    loaded ??= (async () => {
      const cache = await cacheStorage?.open(cacheName);
      const cached = await cache?.match(indexUrl);
      if (cached !== undefined) return readIndex(cached);
      const response = await fetcher(indexUrl);
      if (response.ok) await cache?.put(indexUrl, response.clone());
      return readIndex(response);
    })();
    return loaded;
  };

  return {
    warm: async () => {
      await load();
    },
    search: async (text: string): Promise<PlaceSearchResponse> => {
      const index = await load();
      const query = normalizeSearchText(text);
      const queryTokens = tokenize(query);
      const results = index.entries
        .map((entry) => ({ entry, score: scoreEntry(entry, query, queryTokens) }))
        .filter(({ score }) => score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.entry.displayLabel.localeCompare(right.entry.displayLabel, "id-ID"),
        )
        .slice(0, 8)
        .map(
          ({ entry, score }) =>
            ({
              placeId: entry.placeId,
              displayLabel: entry.displayLabel,
              disambiguatingContext: entry.disambiguatingContext,
              resultKind: entry.resultKind,
              representativeLocation: entry.representativeLocation,
              ...(entry.bounds === undefined ? {} : { bounds: entry.bounds }),
              ...(entry.transitPlaceId === undefined
                ? {}
                : { transitPlaceId: entry.transitPlaceId }),
              matchEvidence: [{ _tag: "Token", tokens: queryTokens }],
              rankScore: score,
            }) as unknown as PassengerPlaceSearchResult,
        );
      return results.length === 0
        ? {
            _tag: "NoMatch",
            placesArtifactVersion: index.placesArtifactVersion,
            networkArtifactVersion: index.networkArtifactVersion,
            queryText: text,
          }
        : {
            _tag: "Matches",
            placesArtifactVersion: index.placesArtifactVersion,
            networkArtifactVersion: index.networkArtifactVersion,
            results,
          };
    },
  };
};
