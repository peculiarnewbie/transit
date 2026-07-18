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
