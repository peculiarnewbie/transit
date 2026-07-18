import { Effect, Schema } from "effect";

import {
  ApiError,
  type JourneyResponse,
  JourneyResponse as JourneyResponseSchema,
  type StopSearchResponse,
  StopSearchResponse as StopSearchResponseSchema,
} from "../../runtime/api-contracts.js";

const jsonHeaders = { "cache-control": "no-store" } as const;

export const errorResponse = (status: number, code: ApiError["error"]["code"], message: string) =>
  Response.json(ApiError.make({ error: { code, message } }), { status, headers: jsonHeaders });

export const responseForError = (error: unknown) => {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    switch (error._tag) {
      case "RouteQuery.InvalidQuery":
      case "Routing.InvalidConstraint":
        return errorResponse(400, "INVALID_REQUEST", "The journey request is not valid.");
      case "Routing.NoRoute":
        return errorResponse(404, "NO_ROUTE", "No journey satisfies those stops and rules.");
    }
  }
  return errorResponse(503, "SERVICE_UNAVAILABLE", "Journey planning is temporarily unavailable.");
};

export const readBoundedJson = async (request: Request, maximumBytes = 32_768) => {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes)
    throw new RequestBodyError("Request body is too large");
  if (request.body === null) throw new RequestBodyError("Request body is required");

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel("Request body is too large");
      throw new RequestBodyError("Request body is too large");
    }
    text += decoder.decode(next.value, { stream: true });
  }
  text += decoder.decode();
  try {
    return parseJson(text);
  } catch {
    throw new RequestBodyError("Request body is not valid JSON");
  }
};

const parseJson = (text: string): unknown => JSON.parse(text);

export class RequestBodyError extends Error {}

export const journeyResponse = async (response: JourneyResponse) => {
  const validated = await Effect.runPromise(
    Schema.decodeUnknownEffect(JourneyResponseSchema)(response),
  );
  return Response.json(validated, { headers: jsonHeaders });
};

export const stopResponse = async (response: StopSearchResponse) => {
  const validated = await Effect.runPromise(
    Schema.decodeUnknownEffect(StopSearchResponseSchema)(response),
  );
  return Response.json(validated, {
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
  });
};
