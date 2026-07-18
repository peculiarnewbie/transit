import { Schema } from "effect";

import {
  GeographicBounds,
  MatchEvidence,
  PassengerPlaceId,
  PassengerPlaceSearchResult,
} from "../../domain/place/index.js";
import { TransitPlaceId } from "../transit/ids.js";
import { StopLocation } from "../../domain/transit/stop.js";

export const PlaceSearchQuery = Schema.Struct({
  text: Schema.String,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
  biasCoordinate: Schema.optionalKey(
    Schema.Struct({
      longitude: Schema.Number.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
      latitude: Schema.Number.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
    }),
  ),
});
export interface PlaceSearchQuery extends Schema.Schema.Type<typeof PlaceSearchQuery> {}

export const PlaceSearchOutcome = Schema.TaggedUnion({
  Matches: {
    results: Schema.Array(PassengerPlaceSearchResult),
  },
  NoMatch: {
    queryText: Schema.String,
  },
});
export type PlaceSearchOutcome = typeof PlaceSearchOutcome.Type;

export const NearbyTransitChoice = Schema.Struct({
  transitPlaceId: TransitPlaceId,
  primaryName: Schema.String.check(Schema.isNonEmpty()),
  geographicDistanceMeters: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  servedRouteIds: Schema.Array(Schema.String),
  selectionEvidence: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(
    Schema.isNonEmpty(),
  ),
  representativeLocation: StopLocation,
});
export interface NearbyTransitChoice extends Schema.Schema.Type<typeof NearbyTransitChoice> {}

export const NearbyTransitOutcome = Schema.TaggedUnion({
  Choices: {
    choices: Schema.Array(NearbyTransitChoice),
  },
  NoneWithinCap: {
    radiusMeters: Schema.Number,
    maxCount: Schema.Int,
  },
});
export type NearbyTransitOutcome = typeof NearbyTransitOutcome.Type;

export const NearbyTransitQuery = Schema.Struct({
  /** Selected geographic place id, or omit when using coordinate-only. */
  placeId: Schema.optionalKey(PassengerPlaceId),
  coordinate: Schema.optionalKey(
    Schema.Struct({
      longitude: Schema.Number.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
      latitude: Schema.Number.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
    }),
  ),
  /** Optional area bounds — distance uses bounds edge when practical. */
  bounds: Schema.optionalKey(GeographicBounds),
  radiusMeters: Schema.Number.check(Schema.isGreaterThan(0)),
  maxCount: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 })),
});
export interface NearbyTransitQuery extends Schema.Schema.Type<typeof NearbyTransitQuery> {}

export class PlaceDiscoveryFailure extends Schema.TaggedErrorClass<PlaceDiscoveryFailure>()(
  "PassengerPlaceDiscovery.Failure",
  {
    reason: Schema.String,
  },
) {}

// Re-export match evidence for discover consumers.
export type { MatchEvidence };
