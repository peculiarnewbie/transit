import { createFileRoute } from "@tanstack/solid-router";

import { ApplicationRuntime } from "../../runtime/application.js";
import {
  errorResponse,
  journeyResponse,
  readBoundedJson,
  RequestBodyError,
  responseForError,
} from "./-http.js";

export type JourneyExecutor = (
  manifestUrl: string,
  input: unknown,
) => Promise<Awaited<ReturnType<typeof ApplicationRuntime.runJourneys>>>;

const runJourneysFromAssets: JourneyExecutor = async (manifestUrl, input) => {
  const { env } = await import("cloudflare:workers");
  return ApplicationRuntime.runJourneys(manifestUrl, input, env.ASSETS.fetch.bind(env.ASSETS));
};

export const handleJourneyRequest = async (
  request: Request,
  execute: JourneyExecutor = runJourneysFromAssets,
) => {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return errorResponse(415, "INVALID_REQUEST", "Send the request as application/json.");
  try {
    const input = await readBoundedJson(request);
    const manifestUrl = new URL("/artifacts/active.json", request.url).href;
    return await journeyResponse(await execute(manifestUrl, input));
  } catch (error) {
    if (error instanceof RequestBodyError)
      return errorResponse(400, "INVALID_REQUEST", error.message);
    return responseForError(error);
  }
};

export const Route = createFileRoute("/api/journeys")({
  server: { handlers: { POST: ({ request }) => handleJourneyRequest(request) } },
});
