import { Effect, Schema } from "effect";

import {
  ApiError,
  type JourneyResponse,
  JourneyResponse as JourneyResponseSchema,
  type StopSearchResponse,
  StopSearchResponse as StopSearchResponseSchema,
} from "../../runtime/api-contracts.js";
import {
  type ArtifactVersionsResponse,
  ArtifactVersionsResponse as ArtifactVersionsResponseSchema,
  type NearbyTransitResponse,
  NearbyTransitResponse as NearbyTransitResponseSchema,
  type PlaceSearchResponse,
  PlaceSearchResponse as PlaceSearchResponseSchema,
  type RouteGuideResponse,
  RouteGuideResponse as RouteGuideResponseSchema,
  RouteHelperApiError,
} from "../../runtime/route-helper-contracts.js";

const jsonHeaders = { "cache-control": "no-store" } as const;

export const errorResponse = (status: number, code: ApiError["error"]["code"], message: string) =>
  Response.json(ApiError.make({ error: { code, message } }), { status, headers: jsonHeaders });

export const routeHelperErrorResponse = (
  status: number,
  code: RouteHelperApiError["error"]["code"],
  message: string,
) =>
  Response.json(RouteHelperApiError.make({ error: { code, message } }), {
    status,
    headers: jsonHeaders,
  });

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

export const responseForRouteHelperError = (error: unknown) => {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    switch (error._tag) {
      case "RouteHelperQuery.InvalidQuery":
      case "PassengerPlaceDiscovery.Failure":
        return routeHelperErrorResponse(
          400,
          "INVALID_REQUEST",
          "The place or route-guide request is not valid.",
        );
      case "RouteGuide.GuideSearchExceeded":
        return routeHelperErrorResponse(
          503,
          "SERVICE_UNAVAILABLE",
          "Route guidance is temporarily unavailable.",
        );
      case "RouteGuide.MalformedGuideGraph":
      case "ArtifactStore.LoadError":
        return routeHelperErrorResponse(
          503,
          "SERVICE_UNAVAILABLE",
          "Route guidance is temporarily unavailable.",
        );
    }
  }
  return routeHelperErrorResponse(
    503,
    "SERVICE_UNAVAILABLE",
    "Route guidance is temporarily unavailable.",
  );
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

export const placeSearchResponse = async (response: PlaceSearchResponse) => {
  const validated = await Effect.runPromise(
    Schema.decodeUnknownEffect(PlaceSearchResponseSchema)(response),
  );
  return Response.json(validated, { headers: jsonHeaders });
};

export const nearbyTransitResponse = async (response: NearbyTransitResponse) => {
  const validated = await Effect.runPromise(
    Schema.decodeUnknownEffect(NearbyTransitResponseSchema)(response),
  );
  return Response.json(validated, { headers: jsonHeaders });
};

export const routeGuideResponse = async (response: RouteGuideResponse) => {
  const validated = await Effect.runPromise(
    Schema.decodeUnknownEffect(RouteGuideResponseSchema)(response),
  );
  return Response.json(validated, { headers: jsonHeaders });
};

export const artifactVersionsResponse = async (response: ArtifactVersionsResponse) => {
  const validated = await Effect.runPromise(
    Schema.decodeUnknownEffect(ArtifactVersionsResponseSchema)(response),
  );
  return Response.json(validated, {
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
  });
};
