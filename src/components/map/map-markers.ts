import { Option, Schema } from "effect";

import { StopSuggestion } from "../../runtime/api-contracts.js";
import type { Coordinate } from "../../features/passenger/types.js";

export const endpointFeatureCollection = (endpoints: {
  readonly origin?: Coordinate;
  readonly destination?: Coordinate;
}) => ({
  type: "FeatureCollection" as const,
  features: (["origin", "destination"] as const).flatMap((kind) => {
    const coordinate = endpoints[kind];
    return coordinate === undefined
      ? []
      : [
          {
            type: "Feature" as const,
            properties: { kind },
            geometry: {
              type: "Point" as const,
              coordinates: [coordinate.longitude, coordinate.latitude],
            },
          },
        ];
  }),
});

export const stopSuggestionFromMapFeature = (feature: unknown): StopSuggestion | undefined => {
  if (
    typeof feature !== "object" ||
    feature === null ||
    !("properties" in feature) ||
    !("geometry" in feature) ||
    typeof feature.geometry !== "object" ||
    feature.geometry === null ||
    !("type" in feature.geometry) ||
    feature.geometry.type !== "Point" ||
    !("coordinates" in feature.geometry) ||
    !Array.isArray(feature.geometry.coordinates)
  )
    return undefined;
  const [longitude, latitude] = feature.geometry.coordinates;
  if (typeof longitude !== "number" || typeof latitude !== "number") return undefined;
  const decoded = Schema.decodeUnknownOption(StopSuggestion)({
    ...(typeof feature.properties === "object" && feature.properties !== null
      ? feature.properties
      : {}),
    coordinate: { longitude, latitude },
  });
  return Option.getOrUndefined(decoded);
};
