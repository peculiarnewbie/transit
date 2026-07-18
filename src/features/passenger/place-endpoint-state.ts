import type {
  NearbyTransitChoiceDto,
  PassengerPlaceSearchResult,
  SelectedPlace,
  TransitEndpointCandidate,
} from "../../runtime/route-helper-contracts.js";

export type NearbyState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Ready"; readonly choices: ReadonlyArray<NearbyTransitChoiceDto> }
  | { readonly _tag: "None" }
  | { readonly _tag: "Failed"; readonly message: string };

export interface PlaceEndpointState {
  readonly typedText: string;
  readonly selected?: SelectedPlace;
  readonly nearby: NearbyState;
}

export interface EndpointPair {
  readonly origin: PlaceEndpointState;
  readonly destination: PlaceEndpointState;
}

export const emptyPlaceEndpoint = (): PlaceEndpointState => ({
  typedText: "",
  nearby: { _tag: "Idle" },
});

export const editEndpointText = (
  endpoint: PlaceEndpointState,
  typedText: string,
): PlaceEndpointState =>
  typedText === endpoint.typedText ? endpoint : { typedText, nearby: { _tag: "Idle" } };

export const selectedPlaceFromResult = (
  result: PassengerPlaceSearchResult,
  artifactVersion: string,
): SelectedPlace => ({
  placeId: result.placeId,
  displayLabel: result.displayLabel,
  resultKind: result.resultKind,
  artifactVersion,
  ...(result.transitPlaceId === undefined ? {} : { transitPlaceId: result.transitPlaceId }),
  ...(result.representativeLocation._tag === "Placed"
    ? {
        coordinate: {
          latitude: result.representativeLocation.latitude,
          longitude: result.representativeLocation.longitude,
        },
      }
    : {}),
  ...(result.bounds === undefined ? {} : { bounds: result.bounds }),
  disambiguatingContext: result.disambiguatingContext,
});

export const selectPlaceResult = (
  result: PassengerPlaceSearchResult,
  artifactVersion: string,
): PlaceEndpointState => ({
  typedText: result.displayLabel,
  selected: selectedPlaceFromResult(result, artifactVersion),
  nearby: { _tag: "Loading" },
});

export const reverseEndpoints = (pair: EndpointPair): EndpointPair => ({
  origin: pair.destination,
  destination: pair.origin,
});

export const candidatesForEndpoint = (
  endpoint: PlaceEndpointState,
): ReadonlyArray<TransitEndpointCandidate> => {
  if (endpoint.nearby._tag === "Loading") return [];
  if (endpoint.nearby._tag !== "Ready") {
    const transitPlaceId = endpoint.selected?.transitPlaceId;
    return transitPlaceId === undefined
      ? []
      : [
          {
            transitPlaceId,
            primaryName: endpoint.selected?.displayLabel ?? endpoint.typedText,
            geographicDistanceMeters: 0,
          },
        ];
  }
  return endpoint.nearby.choices.map((choice) => ({
    transitPlaceId: choice.transitPlaceId,
    primaryName: choice.primaryName,
    geographicDistanceMeters: choice.geographicDistanceMeters,
  }));
};
