import { createFileRoute } from "@tanstack/solid-router";

import { ApplicationRuntime } from "../../runtime/application.js";
import { responseForError, stopResponse } from "./-http.js";

export type StopSearchExecutor = (
  manifestUrl: string,
  input: unknown,
) => Promise<Awaited<ReturnType<typeof ApplicationRuntime.runStopSearch>>>;

const numberParameter = (value: string | null) => (value === null ? undefined : Number(value));

export const handleStopRequest = async (
  request: Request,
  execute: StopSearchExecutor = ApplicationRuntime.runStopSearch,
) => {
  try {
    const url = new URL(request.url);
    const latitude = numberParameter(url.searchParams.get("lat"));
    const longitude = numberParameter(url.searchParams.get("lng"));
    const coordinate =
      latitude === undefined || longitude === undefined ? undefined : { latitude, longitude };
    const input = {
      ...(url.searchParams.has("q") ? { query: url.searchParams.get("q") ?? "" } : {}),
      ...(coordinate === undefined ? {} : { coordinate }),
      limit: numberParameter(url.searchParams.get("limit")) ?? 8,
    };
    const manifestUrl = new URL("/artifacts/active.json", request.url).href;
    return await stopResponse(await execute(manifestUrl, input));
  } catch (error) {
    return responseForError(error);
  }
};

export const Route = createFileRoute("/api/stops")({
  server: { handlers: { GET: ({ request }) => handleStopRequest(request) } },
});
