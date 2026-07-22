import { createFileRoute } from "@tanstack/solid-router";

import { ApplicationRuntime } from "../../runtime/application.js";
import {
  placeSearchResponse,
  RequestBodyError,
  responseForRouteHelperError,
  routeHelperErrorResponse,
} from "./-http.js";

export type PlaceSearchExecutor = (
  networkManifestUrl: string,
  placesManifestUrl: string,
  input: unknown,
) => Promise<Awaited<ReturnType<typeof ApplicationRuntime.runPlaceSearch>>>;

const runPlaceSearchFromAssets: PlaceSearchExecutor = async (
  networkManifestUrl,
  placesManifestUrl,
  input,
) => {
  const { env } = await import("cloudflare:workers");
  return ApplicationRuntime.runPlaceSearch(
    networkManifestUrl,
    placesManifestUrl,
    input,
    env.ASSETS.fetch.bind(env.ASSETS),
  );
};

const numberParameter = (value: string | null) => (value === null ? undefined : Number(value));

export const handlePlaceSearchRequest = async (
  request: Request,
  execute: PlaceSearchExecutor = runPlaceSearchFromAssets,
) => {
  try {
    const url = new URL(request.url);
    const text = url.searchParams.get("q") ?? "";
    if (text.length > 80)
      return routeHelperErrorResponse(400, "INVALID_REQUEST", "Search text is too long.");
    const latitude = numberParameter(url.searchParams.get("lat"));
    const longitude = numberParameter(url.searchParams.get("lng"));
    const biasCoordinate =
      latitude === undefined || longitude === undefined ? undefined : { latitude, longitude };
    const input = {
      text,
      limit: numberParameter(url.searchParams.get("limit")) ?? 8,
      ...(biasCoordinate === undefined ? {} : { biasCoordinate }),
      ...(url.searchParams.has("artifact")
        ? { artifactVersion: url.searchParams.get("artifact") ?? "" }
        : {}),
    };
    const networkManifestUrl = new URL("/artifacts/active.json", request.url).href;
    const placesManifestUrl = new URL("/artifacts/places/active.json", request.url).href;
    return await placeSearchResponse(await execute(networkManifestUrl, placesManifestUrl, input));
  } catch (error) {
    if (error instanceof RequestBodyError)
      return routeHelperErrorResponse(400, "INVALID_REQUEST", error.message);
    return responseForRouteHelperError(error);
  }
};

export const Route = createFileRoute("/api/places")({
  server: { handlers: { GET: ({ request }) => handlePlaceSearchRequest(request) } },
});
