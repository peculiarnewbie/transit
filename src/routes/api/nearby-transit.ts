import { createFileRoute } from "@tanstack/solid-router";

import { ApplicationRuntime } from "../../runtime/application.js";
import {
  nearbyTransitResponse,
  RequestBodyError,
  readBoundedJson,
  responseForRouteHelperError,
  routeHelperErrorResponse,
} from "./-http.js";

export type NearbyTransitExecutor = (
  networkManifestUrl: string,
  placesManifestUrl: string,
  input: unknown,
) => Promise<Awaited<ReturnType<typeof ApplicationRuntime.runNearbyTransit>>>;

const runNearbyTransitFromAssets: NearbyTransitExecutor = async (
  networkManifestUrl,
  placesManifestUrl,
  input,
) => {
  const { env } = await import("cloudflare:workers");
  return ApplicationRuntime.runNearbyTransit(
    networkManifestUrl,
    placesManifestUrl,
    input,
    env.ASSETS.fetch.bind(env.ASSETS),
  );
};

export const handleNearbyTransitRequest = async (
  request: Request,
  execute: NearbyTransitExecutor = runNearbyTransitFromAssets,
) => {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return routeHelperErrorResponse(
      415,
      "INVALID_REQUEST",
      "Send the request as application/json.",
    );
  try {
    const input = await readBoundedJson(request);
    const networkManifestUrl = new URL("/artifacts/active.json", request.url).href;
    const placesManifestUrl = new URL("/artifacts/places/active.json", request.url).href;
    return await nearbyTransitResponse(await execute(networkManifestUrl, placesManifestUrl, input));
  } catch (error) {
    if (error instanceof RequestBodyError)
      return routeHelperErrorResponse(400, "INVALID_REQUEST", error.message);
    return responseForRouteHelperError(error);
  }
};

export const Route = createFileRoute("/api/nearby-transit")({
  server: { handlers: { POST: ({ request }) => handleNearbyTransitRequest(request) } },
});
