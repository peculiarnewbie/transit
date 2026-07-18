import { Schema } from "effect";

import {
  GeographicBounds,
  MatchEvidence,
  PassengerPlaceId,
  PassengerPlaceSearchResult,
} from "../domain/place/index.js";
import { TransitPlaceId } from "../discovery/transit/ids.js";
import { GeometryCoordinate } from "../domain/transit/geometry.js";
import { StopLocation } from "../domain/transit/stop.js";
import {
  GuideAlternative,
  GuideMetrics,
  LineOption,
  PlaceRef,
  TransferEvidence,
} from "../route-guide/model.js";
import { Coordinate } from "./api-contracts.js";

export { Coordinate };

/** Selected passenger place with stable IDs and artifact version. */
export const SelectedPlace = Schema.Struct({
  placeId: PassengerPlaceId,
  displayLabel: Schema.String.check(Schema.isNonEmpty()),
  resultKind: Schema.Literals(["Area", "Landmark", "TransitPlace", "MapPoint", "DeviceCoordinate"]),
  artifactVersion: Schema.String.check(Schema.isNonEmpty()),
  transitPlaceId: Schema.optionalKey(TransitPlaceId),
  coordinate: Schema.optionalKey(Coordinate),
  bounds: Schema.optionalKey(GeographicBounds),
  disambiguatingContext: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
});
export interface SelectedPlace extends Schema.Schema.Type<typeof SelectedPlace> {}

export const NearbyTransitChoiceDto = Schema.Struct({
  transitPlaceId: TransitPlaceId,
  primaryName: Schema.String.check(Schema.isNonEmpty()),
  geographicDistanceMeters: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  servedRouteIds: Schema.Array(Schema.String),
  selectionEvidence: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(
    Schema.isNonEmpty(),
  ),
  representativeLocation: StopLocation,
});
export interface NearbyTransitChoiceDto extends Schema.Schema.Type<typeof NearbyTransitChoiceDto> {}

export const PlaceSearchRequest = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(80)),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }))),
  biasCoordinate: Schema.optionalKey(Coordinate),
  artifactVersion: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
});
export interface PlaceSearchRequest extends Schema.Schema.Type<typeof PlaceSearchRequest> {}

export const PlaceSearchSuccess = Schema.Struct({
  _tag: Schema.Literal("Matches"),
  placesArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  networkArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  results: Schema.Array(PassengerPlaceSearchResult),
});
export interface PlaceSearchSuccess extends Schema.Schema.Type<typeof PlaceSearchSuccess> {}

export const PlaceSearchNoMatch = Schema.Struct({
  _tag: Schema.Literal("NoMatch"),
  placesArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  networkArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  queryText: Schema.String,
});
export interface PlaceSearchNoMatch extends Schema.Schema.Type<typeof PlaceSearchNoMatch> {}

export const PlaceSearchResponse = Schema.Union([PlaceSearchSuccess, PlaceSearchNoMatch]);
export type PlaceSearchResponse = typeof PlaceSearchResponse.Type;

export const NearbyTransitRequest = Schema.Struct({
  placeId: Schema.optionalKey(PassengerPlaceId),
  coordinate: Schema.optionalKey(Coordinate),
  bounds: Schema.optionalKey(GeographicBounds),
  radiusMeters: Schema.optionalKey(
    Schema.Number.check(Schema.isBetween({ minimum: 50, maximum: 5_000 })),
  ),
  maxCount: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 }))),
  artifactVersion: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
});
export interface NearbyTransitRequest extends Schema.Schema.Type<typeof NearbyTransitRequest> {}

export const NearbyTransitSuccess = Schema.Struct({
  _tag: Schema.Literal("Choices"),
  placesArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  networkArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  choices: Schema.Array(NearbyTransitChoiceDto),
});
export interface NearbyTransitSuccess extends Schema.Schema.Type<typeof NearbyTransitSuccess> {}

export const NearbyTransitNone = Schema.Struct({
  _tag: Schema.Literal("NoneWithinCap"),
  placesArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  networkArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  radiusMeters: Schema.Number,
  maxCount: Schema.Int,
});
export interface NearbyTransitNone extends Schema.Schema.Type<typeof NearbyTransitNone> {}

export const NearbyTransitResponse = Schema.Union([NearbyTransitSuccess, NearbyTransitNone]);
export type NearbyTransitResponse = typeof NearbyTransitResponse.Type;

export const TransitEndpointCandidate = Schema.Struct({
  transitPlaceId: TransitPlaceId,
  primaryName: Schema.String.check(Schema.isNonEmpty()),
  geographicDistanceMeters: Schema.optionalKey(
    Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
});
export interface TransitEndpointCandidate extends Schema.Schema.Type<
  typeof TransitEndpointCandidate
> {}

export const RouteGuideRequest = Schema.Struct({
  origin: SelectedPlace,
  destination: SelectedPlace,
  originCandidates: Schema.Array(TransitEndpointCandidate)
    .check(Schema.isNonEmpty())
    .check(Schema.isMaxLength(12)),
  destinationCandidates: Schema.Array(TransitEndpointCandidate)
    .check(Schema.isNonEmpty())
    .check(Schema.isMaxLength(12)),
  networkArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  placesArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  maximumTransfers: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  ),
  maximumAlternatives: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
  ),
});
export interface RouteGuideRequest extends Schema.Schema.Type<typeof RouteGuideRequest> {}

export const GuideRideStepInstruction = Schema.Struct({
  summary: Schema.String.check(Schema.isNonEmpty()),
  lineBadges: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(Schema.isNonEmpty()),
  linePhrase: Schema.String.check(Schema.isNonEmpty()),
  directionSummaries: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
  boardingPlaceName: Schema.String.check(Schema.isNonEmpty()),
  alightingPlaceName: Schema.String.check(Schema.isNonEmpty()),
  boardingMemberDetail: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  alightingMemberDetail: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  intermediatePlaceNamesByOption: Schema.Array(
    Schema.Struct({
      line: Schema.String.check(Schema.isNonEmpty()),
      placeNames: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
    }),
  ),
  /** Structured line options — never flattened into separate alternatives. */
  lineOptions: Schema.Array(LineOption).check(Schema.isNonEmpty()),
  boarding: PlaceRef,
  alighting: PlaceRef,
});
export interface GuideRideStepInstruction extends Schema.Schema.Type<
  typeof GuideRideStepInstruction
> {}

export const GuideTransferStepInstruction = Schema.Struct({
  summary: Schema.String.check(Schema.isNonEmpty()),
  leavePlaceName: Schema.String.check(Schema.isNonEmpty()),
  boardNextPlaceName: Schema.String.check(Schema.isNonEmpty()),
  nextLineBadges: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(Schema.isNonEmpty()),
  nextDirectionLabel: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  platformDetailKnown: Schema.Boolean,
  leavePlace: PlaceRef,
  boardNextPlace: PlaceRef,
  evidence: TransferEvidence,
});
export interface GuideTransferStepInstruction extends Schema.Schema.Type<
  typeof GuideTransferStepInstruction
> {}

export const PassengerGuideAlternative = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  differenceSummary: Schema.String.check(Schema.isNonEmpty()),
  origin: PlaceRef,
  destination: PlaceRef,
  transferCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  rideSteps: Schema.Array(GuideRideStepInstruction).check(Schema.isNonEmpty()),
  transfers: Schema.Array(GuideTransferStepInstruction),
  metrics: GuideMetrics,
  /** Exact bus geometry between boarding and alighting for each ride step. */
  rideGeometry: Schema.Array(Schema.Array(GeometryCoordinate).check(Schema.isMinLength(2))),
  /** Exact ridden geometry with the published color for each passenger line. */
  rideSegments: Schema.Array(
    Schema.Struct({
      coordinates: Schema.Array(GeometryCoordinate).check(Schema.isMinLength(2)),
      color: Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/i)),
    }),
  ),
  /** Raw structured alternative for clients that need full Plan 015 shape. */
  alternative: GuideAlternative,
});
export interface PassengerGuideAlternative extends Schema.Schema.Type<
  typeof PassengerGuideAlternative
> {}

export const CoverageDisclosure = Schema.Struct({
  mode: Schema.Literal("bus-only"),
  networkArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  placesArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  attribution: Schema.String.check(Schema.isNonEmpty()),
  freshnessNote: Schema.String.check(Schema.isNonEmpty()),
});
export interface CoverageDisclosure extends Schema.Schema.Type<typeof CoverageDisclosure> {}

export const RouteGuideFound = Schema.Struct({
  _tag: Schema.Literal("GuidesFound"),
  origin: SelectedPlace,
  destination: SelectedPlace,
  alternatives: Schema.Array(PassengerGuideAlternative).check(Schema.isNonEmpty()),
  coverage: CoverageDisclosure,
});
export interface RouteGuideFound extends Schema.Schema.Type<typeof RouteGuideFound> {}

export const RouteGuideNoRoute = Schema.Struct({
  _tag: Schema.Literal("NoTopologicalRoute"),
  origin: SelectedPlace,
  destination: SelectedPlace,
  originCandidates: Schema.Array(TransitEndpointCandidate),
  destinationCandidates: Schema.Array(TransitEndpointCandidate),
  reason: Schema.String.check(Schema.isNonEmpty()),
  coverage: CoverageDisclosure,
});
export interface RouteGuideNoRoute extends Schema.Schema.Type<typeof RouteGuideNoRoute> {}

export const RouteGuideStale = Schema.Struct({
  _tag: Schema.Literal("StaleSelection"),
  reason: Schema.String.check(Schema.isNonEmpty()),
  expectedNetworkArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  expectedPlacesArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  receivedNetworkArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  receivedPlacesArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
});
export interface RouteGuideStale extends Schema.Schema.Type<typeof RouteGuideStale> {}

export const RouteGuideInvalid = Schema.Struct({
  _tag: Schema.Literal("InvalidCandidateSet"),
  origin: SelectedPlace,
  destination: SelectedPlace,
  reason: Schema.String.check(Schema.isNonEmpty()),
  coverage: CoverageDisclosure,
});
export interface RouteGuideInvalid extends Schema.Schema.Type<typeof RouteGuideInvalid> {}

export const RouteGuideResponse = Schema.Union([
  RouteGuideFound,
  RouteGuideNoRoute,
  RouteGuideStale,
  RouteGuideInvalid,
]);
export type RouteGuideResponse = typeof RouteGuideResponse.Type;

export const ArtifactVersionsResponse = Schema.Struct({
  networkArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  placesArtifactVersion: Schema.String.check(Schema.isNonEmpty()),
  networkSnapshotChecksum: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  ),
  networkGeometryChecksum: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  ),
  placesArtifactChecksum: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  ),
  coverage: CoverageDisclosure,
});
export interface ArtifactVersionsResponse extends Schema.Schema.Type<
  typeof ArtifactVersionsResponse
> {}

export const RouteHelperApiError = Schema.Struct({
  error: Schema.Struct({
    code: Schema.Literals([
      "INVALID_REQUEST",
      "STALE_SELECTION",
      "NO_ROUTE",
      "NO_PLACE_MATCH",
      "SERVICE_UNAVAILABLE",
    ]),
    message: Schema.String,
  }),
});
export interface RouteHelperApiError extends Schema.Schema.Type<typeof RouteHelperApiError> {}

export type { MatchEvidence, PassengerPlaceSearchResult };
