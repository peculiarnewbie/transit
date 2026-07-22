import { createFileRoute } from "@tanstack/solid-router";

import { ApplicationRuntime } from "../../runtime/application.js";
import { artifactVersionsResponse, responseForRouteHelperError } from "./-http.js";

export type ArtifactVersionsExecutor = (
  networkManifestUrl: string,
  placesManifestUrl: string,
) => Promise<Awaited<ReturnType<typeof ApplicationRuntime.runArtifactVersions>>>;

const runArtifactVersionsFromAssets: ArtifactVersionsExecutor = async (
  networkManifestUrl,
  placesManifestUrl,
) => {
  const { env } = await import("cloudflare:workers");
  return ApplicationRuntime.runArtifactVersions(
    networkManifestUrl,
    placesManifestUrl,
    env.ASSETS.fetch.bind(env.ASSETS),
  );
};

export const handleArtifactVersionsRequest = async (
  request: Request,
  execute: ArtifactVersionsExecutor = runArtifactVersionsFromAssets,
) => {
  try {
    const networkManifestUrl = new URL("/artifacts/active.json", request.url).href;
    const placesManifestUrl = new URL("/artifacts/places/active.json", request.url).href;
    return await artifactVersionsResponse(await execute(networkManifestUrl, placesManifestUrl));
  } catch (error) {
    return responseForRouteHelperError(error);
  }
};

export const Route = createFileRoute("/api/artifact-versions")({
  server: { handlers: { GET: ({ request }) => handleArtifactVersionsRequest(request) } },
});
