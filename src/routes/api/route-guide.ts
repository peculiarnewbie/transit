import { createFileRoute } from "@tanstack/solid-router";

import { ApplicationRuntime } from "../../runtime/application.js";
import {
  readBoundedJson,
  RequestBodyError,
  responseForRouteHelperError,
  routeGuideResponse,
  routeHelperErrorResponse,
} from "./-http.js";

export type RouteGuideExecutor = (
  networkManifestUrl: string,
  placesManifestUrl: string,
  input: unknown,
) => Promise<Awaited<ReturnType<typeof ApplicationRuntime.runRouteGuide>>>;

const runRouteGuideFromAssets: RouteGuideExecutor = async (
  networkManifestUrl,
  placesManifestUrl,
  input,
) => {
  const { env } = await import("cloudflare:workers");
  return ApplicationRuntime.runRouteGuide(
    networkManifestUrl,
    placesManifestUrl,
    input,
    env.ASSETS.fetch.bind(env.ASSETS),
  );
};

export const handleRouteGuideRequest = async (
  request: Request,
  execute: RouteGuideExecutor = runRouteGuideFromAssets,
) => {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return routeHelperErrorResponse(
      415,
      "INVALID_REQUEST",
      "Send the request as application/json.",
    );
  try {
    const input = await readBoundedJson(request, 65_536);
    const networkManifestUrl = new URL("/artifacts/active.json", request.url).href;
    const placesManifestUrl = new URL("/artifacts/places/active.json", request.url).href;
    return await routeGuideResponse(await execute(networkManifestUrl, placesManifestUrl, input));
  } catch (error) {
    if (error instanceof RequestBodyError)
      return routeHelperErrorResponse(400, "INVALID_REQUEST", error.message);
    return responseForRouteHelperError(error);
  }
};

export const Route = createFileRoute("/api/route-guide")({
  server: { handlers: { POST: ({ request }) => handleRouteGuideRequest(request) } },
});
