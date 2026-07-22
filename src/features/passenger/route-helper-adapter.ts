import { Effect, Schema } from "effect";

import {
  ArtifactVersionsResponse,
  NearbyTransitResponse,
  PlaceSearchResponse,
  RouteGuideResponse,
  type NearbyTransitRequest,
  type RouteGuideRequest,
} from "../../runtime/route-helper-contracts.js";
import { createOfflinePlaceSearch } from "./offline-place-search.js";

const errorMessage = async (response: Response): Promise<string> => {
  if (response.status >= 500) return "Panduan rute sedang tidak tersedia. Coba lagi sebentar lagi.";
  try {
    const body = (await response.json()) as { readonly error?: { readonly message?: string } };
    return body.error?.message ?? "Permintaan rute tidak dapat diproses.";
  } catch {
    return "Permintaan rute tidak dapat diproses.";
  }
};

const decode = async <A>(schema: Schema.ConstraintDecoder<A>, response: Response): Promise<A> => {
  if (!response.ok) throw new Error(await errorMessage(response));
  return Effect.runPromise(Schema.decodeUnknownEffect(schema)(await response.json()));
};

const fetchWithin = async (
  fetcher: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  milliseconds: number,
  timeoutMessage: string,
) => {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(init?.signal?.reason);
  init?.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, milliseconds);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error(timeoutMessage);
    throw error;
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", abortFromCaller);
  }
};

export interface RouteHelperAdapter {
  readonly warmLocalPlaces?: () => Promise<void>;
  readonly searchLocalPlaces?: (text: string) => Promise<PlaceSearchResponse>;
  readonly versions: (options?: {
    readonly signal?: AbortSignal;
  }) => Promise<ArtifactVersionsResponse>;
  readonly searchPlaces: (
    text: string,
    options?: { readonly signal?: AbortSignal; readonly artifactVersion?: string },
  ) => Promise<PlaceSearchResponse>;
  readonly nearbyTransit: (
    request: NearbyTransitRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<NearbyTransitResponse>;
  readonly guide: (
    request: RouteGuideRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<RouteGuideResponse>;
}

export const createRouteHelperAdapter = (
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): RouteHelperAdapter => {
  const offline = createOfflinePlaceSearch(fetcher);
  return {
    warmLocalPlaces: offline.warm,
    searchLocalPlaces: offline.search,
    versions: async (options) =>
      decode(
        ArtifactVersionsResponse,
        await fetchWithin(
          fetcher,
          "/api/artifact-versions",
          { signal: options?.signal },
          12_000,
          "Versi data tidak menjawab dalam 12 detik.",
        ),
      ),
    searchPlaces: async (text, options) => {
      const parameters = new URLSearchParams({ q: text, limit: "8" });
      if (options?.artifactVersion !== undefined)
        parameters.set("artifact", options.artifactVersion);
      return decode(
        PlaceSearchResponse,
        await fetchWithin(
          fetcher,
          `/api/places?${parameters}`,
          { signal: options?.signal },
          12_000,
          "Pencarian server tidak menjawab dalam 12 detik.",
        ),
      );
    },
    nearbyTransit: async (request, options) =>
      decode(
        NearbyTransitResponse,
        await fetchWithin(
          fetcher,
          "/api/nearby-transit",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
            signal: options?.signal,
          },
          15_000,
          "Pilihan transit tidak menjawab dalam 15 detik.",
        ),
      ),
    guide: async (request, options) =>
      decode(
        RouteGuideResponse,
        await fetchWithin(
          fetcher,
          "/api/route-guide",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
            signal: options?.signal,
          },
          20_000,
          "Pencarian rute tidak menjawab dalam 20 detik.",
        ),
      ),
  };
};

export const routeHelperAdapter = createRouteHelperAdapter();
