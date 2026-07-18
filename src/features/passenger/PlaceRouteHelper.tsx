import {
  For,
  Show,
  Suspense,
  batch,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  onMount,
} from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Effect, Schedule } from "effect";

import type {
  ArtifactVersionsResponse,
  PassengerGuideAlternative,
  PassengerPlaceSearchResult,
  RouteGuideRequest,
  RouteGuideResponse,
} from "../../runtime/route-helper-contracts.js";
import {
  candidatesForEndpoint,
  editEndpointText,
  emptyPlaceEndpoint,
  reverseEndpoints,
  selectPlaceResult,
  type EndpointPair,
  type PlaceEndpointState,
} from "./place-endpoint-state.js";
import { routeHelperAdapter, type RouteHelperAdapter } from "./route-helper-adapter.js";
import { mergePlaceResults } from "./offline-place-search.js";
import RouteGuideResults from "./RouteGuideResults.js";

const LazyPassengerMap = lazy(() => import("../../components/map/PassengerMap.js"));
const defaultMapStyleUrl = "https://tiles.openfreemap.org/styles/positron";
const searchDelayMilliseconds = 250;
const nearbyRetrySchedule = Schedule.exponential("100 millis").pipe(Schedule.upTo({ times: 2 }));
const guideRetrySchedule = Schedule.exponential("200 millis").pipe(Schedule.upTo({ times: 2 }));

const resolveNearbyWithRetry = Effect.fn("Passenger.resolveNearby")(function* (
  adapter: RouteHelperAdapter,
  request: Parameters<RouteHelperAdapter["nearbyTransit"]>[0],
  signal: AbortSignal,
) {
  return yield* Effect.tryPromise({
    try: () => adapter.nearbyTransit(request, { signal }),
    catch: (error) => (error instanceof Error ? error : new Error("Pilihan transit gagal dimuat.")),
  }).pipe(
    Effect.retry({
      schedule: nearbyRetrySchedule,
      while: () => !signal.aborted,
    }),
  );
});

const resolveGuideWithRetry = Effect.fn("Passenger.resolveGuide")(function* (
  adapter: RouteHelperAdapter,
  request: RouteGuideRequest,
  signal: AbortSignal,
) {
  return yield* Effect.tryPromise({
    try: () => adapter.guide(request, { signal }),
    catch: (error) => (error instanceof Error ? error : new Error("Panduan rute gagal dimuat.")),
  }).pipe(
    Effect.retry({
      schedule: guideRetrySchedule,
      while: () => !signal.aborted,
    }),
  );
});

type EndpointKind = "origin" | "destination";
type PlaceSearchState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Short" }
  | { readonly _tag: "Searching" }
  | {
      readonly _tag: "Ready";
      readonly results: ReadonlyArray<PassengerPlaceSearchResult>;
      readonly source: "local" | "combined" | "offline";
    }
  | { readonly _tag: "Empty" }
  | { readonly _tag: "Failed"; readonly message: string };
type GuideState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Searching" }
  | { readonly _tag: "Ready"; readonly response: RouteGuideResponse }
  | { readonly _tag: "Failed"; readonly message: string };

export interface PlaceRouteHelperProps {
  readonly adapter?: RouteHelperAdapter;
  readonly mapStyleUrl?: string;
}

const kindLabel = (kind: PassengerPlaceSearchResult["resultKind"]): string =>
  kind === "Area" ? "Kawasan" : kind === "Landmark" ? "Tempat" : "Halte/stasiun";

const endpointCoordinate = (endpoint: PlaceEndpointState) => endpoint.selected?.coordinate;

export const schedulePlaceSearch = (
  query: string,
  search: (query: string) => void,
): (() => void) => {
  const timeout = setTimeout(() => search(query), searchDelayMilliseconds);
  return () => clearTimeout(timeout);
};

export const routeGuideRequestFor = (
  pair: EndpointPair,
  versions: ArtifactVersionsResponse | undefined,
): RouteGuideRequest | undefined => {
  const origin = pair.origin.selected;
  const destination = pair.destination.selected;
  const originCandidates = candidatesForEndpoint(pair.origin);
  const destinationCandidates = candidatesForEndpoint(pair.destination);
  if (
    versions === undefined ||
    origin === undefined ||
    destination === undefined ||
    originCandidates.length === 0 ||
    destinationCandidates.length === 0
  )
    return undefined;
  return {
    origin,
    destination,
    originCandidates,
    destinationCandidates,
    networkArtifactVersion: versions.networkArtifactVersion,
    placesArtifactVersion: versions.placesArtifactVersion,
    maximumTransfers: 3,
    maximumAlternatives: 4,
  };
};

export const guideRequestKeyFor = (request: RouteGuideRequest) =>
  JSON.stringify({
    origin: request.origin,
    destination: request.destination,
    originCandidates: request.originCandidates,
    destinationCandidates: request.destinationCandidates,
    networkArtifactVersion: request.networkArtifactVersion,
    placesArtifactVersion: request.placesArtifactVersion,
    maximumTransfers: request.maximumTransfers,
    maximumAlternatives: request.maximumAlternatives,
  });

interface DerivedGuideRequest {
  readonly key: string;
  readonly request: RouteGuideRequest;
}

export default function PlaceRouteHelper(props: PlaceRouteHelperProps) {
  const adapter = () => props.adapter ?? routeHelperAdapter;
  const [originEndpoint, setOriginEndpoint] = createSignal(emptyPlaceEndpoint());
  const [destinationEndpoint, setDestinationEndpoint] = createSignal(emptyPlaceEndpoint());
  const endpoints = createMemo<EndpointPair>(() => ({
    origin: originEndpoint(),
    destination: destinationEndpoint(),
  }));
  const [activeEndpoint, setActiveEndpoint] = createSignal<EndpointKind>();
  const [searchState, setSearchState] = createSignal<PlaceSearchState>({ _tag: "Idle" });
  const [activeResult, setActiveResult] = createSignal(0);
  const [searchAttempt, setSearchAttempt] = createSignal(0);
  const [versions, setVersions] = createSignal<ArtifactVersionsResponse>();
  const [guideState, setGuideState] = createSignal<GuideState>({ _tag: "Idle" });
  const [selectedAlternativeId, setSelectedAlternativeId] = createSignal<string>();
  const [sheetExpanded, setSheetExpanded] = createSignal(true);
  const [guideAttempt, setGuideAttempt] = createSignal(0);
  const [mapPointEndpoint, setMapPointEndpoint] = createSignal<EndpointKind>();
  const [locationMessage, setLocationMessage] = createSignal<string>();
  let guideHeading: HTMLHeadingElement | undefined;

  onMount(
    () =>
      void adapter()
        .warmLocalPlaces?.()
        .catch(() => undefined),
  );

  const endpoint = (kind: EndpointKind) =>
    kind === "origin" ? originEndpoint() : destinationEndpoint();
  const updateEndpoint = (
    kind: EndpointKind,
    update: (current: PlaceEndpointState) => PlaceEndpointState,
  ) => (kind === "origin" ? setOriginEndpoint(update) : setDestinationEndpoint(update));
  const updateEndpoints = (update: (current: EndpointPair) => EndpointPair) => {
    const next = update(endpoints());
    batch(() => {
      setOriginEndpoint(next.origin);
      setDestinationEndpoint(next.destination);
    });
  };

  createEffect(() => {
    const kind = activeEndpoint();
    searchAttempt();
    if (kind === undefined) return;
    const query = endpoint(kind).typedText.trim();
    if (query.length < 2) {
      setSearchState(query.length === 0 ? { _tag: "Idle" } : { _tag: "Short" });
      return;
    }
    const controller = new AbortController();
    setSearchState({ _tag: "Searching" });
    setActiveResult(0);
    const cancel = schedulePlaceSearch(query, (scheduledQuery) => {
      void (async () => {
        let localResults: ReadonlyArray<PassengerPlaceSearchResult> = [];
        try {
          const localResponse = await adapter().searchLocalPlaces?.(scheduledQuery);
          if (controller.signal.aborted) return;
          if (localResponse !== undefined)
            setVersions({
              networkArtifactVersion: localResponse.networkArtifactVersion,
              placesArtifactVersion: localResponse.placesArtifactVersion,
              coverage: versions()?.coverage ?? {
                mode: "bus-only",
                networkArtifactVersion: localResponse.networkArtifactVersion,
                placesArtifactVersion: localResponse.placesArtifactVersion,
                attribution: "© OpenStreetMap contributors",
                freshnessNote:
                  "Indeks halte tersimpan di perangkat; hasil server sedang disinkronkan.",
              },
            });
          if (localResponse !== undefined) {
            localResults = localResponse._tag === "Matches" ? localResponse.results : [];
            if (localResults.length > 0)
              setSearchState({ _tag: "Ready", results: localResults, source: "local" });
          }
        } catch {
          // The server search below remains available when the offline cache is cold or corrupt.
        }
        try {
          const response = await adapter().searchPlaces(scheduledQuery, {
            signal: controller.signal,
            artifactVersion: versions()?.placesArtifactVersion,
          });
          if (controller.signal.aborted) return;
          setVersions({
            networkArtifactVersion: response.networkArtifactVersion,
            placesArtifactVersion: response.placesArtifactVersion,
            coverage: versions()?.coverage ?? {
              mode: "bus-only",
              networkArtifactVersion: response.networkArtifactVersion,
              placesArtifactVersion: response.placesArtifactVersion,
              attribution: "Data sumber tercantum setelah rute dimuat.",
              freshnessNote: "Panduan bus tanpa jadwal.",
            },
          });
          const serverResults = response._tag === "Matches" ? response.results : [];
          const results = mergePlaceResults(localResults, serverResults);
          setSearchState(
            results.length > 0 ? { _tag: "Ready", results, source: "combined" } : { _tag: "Empty" },
          );
        } catch (error) {
          if (!controller.signal.aborted) {
            if (localResults.length > 0)
              setSearchState({ _tag: "Ready", results: localResults, source: "offline" });
            else
              setSearchState({
                _tag: "Failed",
                message: error instanceof Error ? error.message : "Pencarian tempat gagal.",
              });
          }
        }
      })();
    });
    onCleanup(() => {
      cancel();
      controller.abort();
    });
  });

  createEffect(() => {
    const tag = guideState()._tag;
    if (tag === "Ready" || tag === "Failed") queueMicrotask(() => guideHeading?.focus());
  });

  const observeNearby = (kind: EndpointKind) =>
    createEffect(() => {
      const selected = endpoint(kind);
      const place = selected.selected;
      if (place === undefined || selected.nearby._tag !== "Loading") return;
      const controller = new AbortController();
      void Effect.runPromise(
        resolveNearbyWithRetry(
          adapter(),
          {
            placeId: place.placeId,
            ...(place.coordinate === undefined ? {} : { coordinate: place.coordinate }),
            ...(place.bounds === undefined ? {} : { bounds: place.bounds }),
            radiusMeters: 800,
            maxCount: 6,
            artifactVersion: place.artifactVersion,
          },
          controller.signal,
        ),
      ).then(
        (response) =>
          updateEndpoint(kind, (current) => {
            if (current.selected?.placeId !== place.placeId) return current;
            return response._tag === "NoneWithinCap"
              ? { ...current, nearby: { _tag: "None" } }
              : { ...current, nearby: { _tag: "Ready", choices: response.choices } };
          }),
        (error) => {
          if (controller.signal.aborted) return;
          updateEndpoint(kind, (current) =>
            current.selected?.placeId === place.placeId
              ? {
                  ...current,
                  nearby: {
                    _tag: "Failed",
                    message:
                      error instanceof Error ? error.message : "Pilihan transit gagal dimuat.",
                  },
                }
              : current,
          );
        },
      );
      onCleanup(() => controller.abort());
    });

  observeNearby("origin");
  observeNearby("destination");

  const selectResult = (result: PassengerPlaceSearchResult) => {
    const kind = activeEndpoint();
    const currentVersions = versions();
    if (kind === undefined || currentVersions === undefined) return;
    const selected = selectPlaceResult(result, currentVersions.placesArtifactVersion);
    updateEndpoint(kind, () => selected);
    setActiveEndpoint(undefined);
    setSearchState({ _tag: "Idle" });
    setGuideState({ _tag: "Idle" });
  };

  const guideRequest = createMemo<DerivedGuideRequest | undefined>((previous) => {
    const request = routeGuideRequestFor(endpoints(), versions());
    if (request === undefined) return undefined;
    const key = guideRequestKeyFor(request);
    return previous?.key === key ? previous : { key, request };
  });

  createEffect(() => {
    guideAttempt();
    const derived = guideRequest();
    if (derived === undefined) return;
    const controller = new AbortController();
    batch(() => {
      setGuideState({ _tag: "Searching" });
      setSelectedAlternativeId(undefined);
      setSheetExpanded(true);
    });
    void Effect.runPromise(
      resolveGuideWithRetry(adapter(), derived.request, controller.signal),
    ).then(
      (response) => {
        if (controller.signal.aborted) return;
        batch(() => {
          setGuideState({ _tag: "Ready", response });
          setSelectedAlternativeId(undefined);
          setSheetExpanded(true);
        });
      },
      (error) => {
        if (controller.signal.aborted) return;
        setGuideState({
          _tag: "Failed",
          message: error instanceof Error ? error.message : "Panduan rute gagal dimuat.",
        });
      },
    );
    onCleanup(() => controller.abort());
  });

  createEffect(() => {
    const pair = endpoints();
    if (pair.origin.selected === undefined || pair.destination.selected === undefined) return;
    if (guideRequest() !== undefined) return;
    const unresolved = (["origin", "destination"] as const).find((kind) => {
      const current = pair[kind];
      return (
        candidatesForEndpoint(current).length === 0 &&
        (current.nearby._tag === "Failed" || current.nearby._tag === "None")
      );
    });
    if (unresolved === undefined) return;
    setGuideState({
      _tag: "Failed",
      message: `Jaringan bus di sekitar ${unresolved === "origin" ? "asal" : "tujuan"} belum dapat ditentukan. Pilihan tempat tetap tersimpan.`,
    });
  });

  const retryRouting = () => {
    let retriedNearby = false;
    const resetUnresolved = (current: PlaceEndpointState): PlaceEndpointState => {
      if (
        current.selected === undefined ||
        (current.nearby._tag !== "Failed" && current.nearby._tag !== "None")
      )
        return current;
      retriedNearby = true;
      return { ...current, nearby: { _tag: "Loading" } };
    };
    updateEndpoints((current) => ({
      origin: resetUnresolved(current.origin),
      destination: resetUnresolved(current.destination),
    }));
    if (!retriedNearby) setGuideAttempt((attempt) => attempt + 1);
  };

  const reverse = () => {
    batch(() => {
      updateEndpoints(() => reverseEndpoints(endpoints()));
      setActiveEndpoint((kind) =>
        kind === "origin" ? "destination" : kind === "destination" ? "origin" : undefined,
      );
      setGuideState({ _tag: "Idle" });
    });
  };

  const useDeviceLocation = async (kind: EndpointKind) => {
    setLocationMessage(undefined);
    if (typeof navigator === "undefined" || navigator.geolocation === undefined) {
      setLocationMessage("Lokasi perangkat tidak tersedia. Cari tempat dengan nama.");
      return;
    }
    let currentVersions = versions();
    try {
      currentVersions ??= await adapter().versions();
      setVersions(currentVersions);
    } catch {
      setLocationMessage("Versi data belum dapat dimuat. Coba lagi.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinate = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        const selected: PlaceEndpointState = {
          typedText: "Lokasi saya",
          selected: {
            placeId:
              `coordinate:device:${coordinate.latitude.toFixed(5)},${coordinate.longitude.toFixed(5)}` as NonNullable<
                PlaceEndpointState["selected"]
              >["placeId"],
            displayLabel: "Lokasi saya",
            resultKind: "DeviceCoordinate",
            artifactVersion: currentVersions.placesArtifactVersion,
            coordinate,
          },
          nearby: { _tag: "Loading" },
        };
        updateEndpoint(kind, () => selected);
        setActiveEndpoint(undefined);
        setGuideState({ _tag: "Idle" });
      },
      () => setLocationMessage("Izin lokasi ditolak. Pilihan tempat lain tetap tersimpan."),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const beginMapPointSelection = async (kind: EndpointKind) => {
    setLocationMessage(undefined);
    try {
      const currentVersions = versions() ?? (await adapter().versions());
      setVersions(currentVersions);
      setMapPointEndpoint(kind);
      setActiveEndpoint(undefined);
    } catch {
      setLocationMessage("Peta belum dapat digunakan. Cari tempat dengan nama atau coba lagi.");
    }
  };

  const selectMapPoint = (coordinate: {
    readonly latitude: number;
    readonly longitude: number;
  }) => {
    const kind = mapPointEndpoint();
    const currentVersions = versions();
    if (kind === undefined || currentVersions === undefined) return;
    const selected: PlaceEndpointState = {
      typedText: "Titik pada peta",
      selected: {
        placeId:
          `coordinate:map:${coordinate.latitude.toFixed(5)},${coordinate.longitude.toFixed(5)}` as NonNullable<
            PlaceEndpointState["selected"]
          >["placeId"],
        displayLabel: "Titik pada peta",
        resultKind: "MapPoint",
        artifactVersion: currentVersions.placesArtifactVersion,
        coordinate,
      },
      nearby: { _tag: "Loading" },
    };
    updateEndpoint(kind, () => selected);
    setMapPointEndpoint(undefined);
    setGuideState({ _tag: "Idle" });
  };
  const selectedAlternative = createMemo(() => {
    const state = guideState();
    if (state._tag !== "Ready" || state.response._tag !== "GuidesFound") return undefined;
    return state.response.alternatives.find(
      (alternative) => alternative.id === selectedAlternativeId(),
    );
  });
  const selectedGuideSegments = createMemo(() => selectedAlternative()?.rideSegments ?? []);
  const routingStatus = createMemo(() => {
    const pair = endpoints();
    if (pair.origin.selected === undefined || pair.destination.selected === undefined)
      return undefined;
    if (guideState()._tag === "Searching") return "Mencari rute bus…";
    if (pair.origin.nearby._tag === "Loading" || pair.destination.nearby._tag === "Loading")
      return "Menyiapkan rute bus…";
    return undefined;
  });

  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.mapStage)}>
        <Suspense fallback={<div role="status">Memuat peta…</div>}>
          <LazyPassengerMap
            styleUrl={props.mapStyleUrl ?? import.meta.env.VITE_MAP_STYLE_URL ?? defaultMapStyleUrl}
            selectedGeometry={[]}
            selectedGuideSegments={selectedGuideSegments()}
            selectedColor="#31556f"
            origin={endpointCoordinate(endpoints().origin)}
            destination={endpointCoordinate(endpoints().destination)}
            selectionKind={mapPointEndpoint()}
            onStopSelect={() => undefined}
            onMapPointSelect={selectMapPoint}
          />
        </Suspense>
      </div>

      <section aria-label="Cari rute bus" {...stylex.props(styles.controlPanel)}>
        <header {...stylex.props(styles.header)}>
          <span aria-hidden="true" {...stylex.props(styles.roundel)}>
            T
          </span>
          <div>
            <p {...stylex.props(styles.kicker)}>Jakarta · panduan bus tanpa jadwal</p>
            <h1 {...stylex.props(styles.title)}>Mau ke mana?</h1>
          </div>
        </header>

        <div {...stylex.props(styles.endpointStack)}>
          <EndpointField
            kind="origin"
            label="Dari"
            endpoint={endpoints().origin}
            active={activeEndpoint() === "origin"}
            searchState={searchState()}
            activeResult={activeResult()}
            onFocus={() => setActiveEndpoint("origin")}
            onInput={(text) => {
              updateEndpoint("origin", (current) => editEndpointText(current, text));
              setActiveEndpoint("origin");
              setGuideState({ _tag: "Idle" });
            }}
            onActiveResult={setActiveResult}
            onSelect={selectResult}
            onUseLocation={() => void useDeviceLocation("origin")}
            onUseMap={() => void beginMapPointSelection("origin")}
            onRetry={() => setSearchAttempt((attempt) => attempt + 1)}
          />
          <button
            type="button"
            aria-label="Tukar tempat asal dan tujuan"
            onClick={reverse}
            {...stylex.props(styles.reverseButton)}
          >
            ⇅
          </button>
          <EndpointField
            kind="destination"
            label="Ke"
            endpoint={endpoints().destination}
            active={activeEndpoint() === "destination"}
            searchState={searchState()}
            activeResult={activeResult()}
            onFocus={() => setActiveEndpoint("destination")}
            onInput={(text) => {
              updateEndpoint("destination", (current) => editEndpointText(current, text));
              setActiveEndpoint("destination");
              setGuideState({ _tag: "Idle" });
            }}
            onActiveResult={setActiveResult}
            onSelect={selectResult}
            onUseLocation={() => void useDeviceLocation("destination")}
            onUseMap={() => void beginMapPointSelection("destination")}
            onRetry={() => setSearchAttempt((attempt) => attempt + 1)}
          />
        </div>

        <Show when={locationMessage()}>{(message) => <p role="status">{message()}</p>}</Show>
      </section>

      <Show when={routingStatus()}>
        <div role="status" aria-live="polite" {...stylex.props(styles.routingStatus)}>
          <span aria-hidden="true" {...stylex.props(styles.loadingSpinner)} />
          <span>{routingStatus()}</span>
        </div>
      </Show>

      <Show when={guideState()._tag === "Ready" || guideState()._tag === "Failed"}>
        <aside
          aria-label="Pilihan rute bus"
          {...stylex.props(styles.resultSheet, !sheetExpanded() && styles.collapsedSheet)}
        >
          <button
            type="button"
            aria-expanded={sheetExpanded()}
            onClick={() => setSheetExpanded((expanded) => !expanded)}
            {...stylex.props(styles.sheetHandle)}
          >
            <span aria-hidden="true" {...stylex.props(styles.grabber)} />
            {sheetExpanded() ? "Turunkan panel rute" : "Lihat detail rute"}
          </button>
          <GuideOutcome
            state={guideState()}
            headingRef={(element) => (guideHeading = element)}
            selectedAlternativeId={selectedAlternativeId()}
            compact={!sheetExpanded()}
            onSelectAlternative={(alternative) => {
              setSelectedAlternativeId(alternative.id);
              setSheetExpanded(false);
            }}
            onRetry={retryRouting}
            onEdit={(kind) => setActiveEndpoint(kind)}
            onRefresh={() => {
              setVersions(undefined);
              setActiveEndpoint("origin");
              setSearchAttempt((attempt) => attempt + 1);
            }}
          />
        </aside>
      </Show>
    </main>
  );
}

function EndpointField(props: {
  readonly kind: EndpointKind;
  readonly label: string;
  readonly endpoint: PlaceEndpointState;
  readonly active: boolean;
  readonly searchState: PlaceSearchState;
  readonly activeResult: number;
  readonly onFocus: () => void;
  readonly onInput: (text: string) => void;
  readonly onActiveResult: (index: number) => void;
  readonly onSelect: (result: PassengerPlaceSearchResult) => void;
  readonly onUseLocation: () => void;
  readonly onUseMap: () => void;
  readonly onRetry: () => void;
}) {
  const results = () => (props.searchState._tag === "Ready" ? props.searchState.results : []);
  const listId = `${props.kind}-place-results`;
  return (
    <div {...stylex.props(styles.endpointField)}>
      <label for={`${props.kind}-place`} {...stylex.props(styles.endpointLabel)}>
        {props.label}
      </label>
      <input
        id={`${props.kind}-place`}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={props.active && props.endpoint.typedText.trim().length >= 2}
        aria-activedescendant={
          props.searchState._tag === "Ready"
            ? `${props.kind}-result-${props.activeResult}`
            : undefined
        }
        autocomplete="off"
        maxlength={80}
        value={props.endpoint.typedText}
        placeholder={props.kind === "origin" ? "Kawasan, tempat, atau halte" : "Contoh: Kota Tua"}
        onFocus={props.onFocus}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (results().length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            props.onActiveResult(Math.min(results().length - 1, props.activeResult + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            props.onActiveResult(Math.max(0, props.activeResult - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const result = results()[props.activeResult];
            if (result !== undefined) props.onSelect(result);
          } else if (event.key === "Escape") {
            event.currentTarget.blur();
          }
        }}
        {...stylex.props(styles.endpointInput)}
      />
      <Show when={props.endpoint.selected !== undefined}>
        <span {...stylex.props(styles.selectedMark)}>Terpilih</span>
      </Show>
      <Show when={props.active}>
        <div id={listId} {...stylex.props(styles.resultPopover)}>
          <p role="status" aria-live="polite" {...stylex.props(styles.searchStatus)}>
            {props.searchState._tag === "Idle"
              ? "Ketik nama kawasan, tempat penting, halte, atau stasiun."
              : props.searchState._tag === "Short"
                ? "Ketik minimal 2 karakter."
                : props.searchState._tag === "Searching"
                  ? "Mencari tempat…"
                  : props.searchState._tag === "Empty"
                    ? "Tempat tidak ditemukan. Coba nama kawasan atau landmark lain."
                    : props.searchState._tag === "Failed"
                      ? props.searchState.message
                      : props.searchState.source === "local"
                        ? `${props.searchState.results.length} hasil lokal; menyinkronkan server…`
                        : props.searchState.source === "offline"
                          ? `${props.searchState.results.length} hasil dari cache offline.`
                          : `${props.searchState.results.length} tempat ditemukan.`}
          </p>
          <Show when={props.searchState._tag === "Failed"}>
            <button type="button" onClick={props.onRetry} {...stylex.props(styles.retryButton)}>
              Coba lagi tanpa menghapus pilihan lain
            </button>
          </Show>
          <Show when={props.searchState._tag === "Ready"}>
            <ul role="listbox" {...stylex.props(styles.resultList)}>
              <For each={results()}>
                {(result, index) => (
                  <li
                    id={`${props.kind}-result-${index()}`}
                    role="option"
                    aria-selected={index() === props.activeResult}
                  >
                    <button
                      type="button"
                      onClick={() => props.onSelect(result)}
                      {...stylex.props(
                        styles.resultButton,
                        index() === props.activeResult && styles.activeResult,
                      )}
                    >
                      <strong>{result.displayLabel}</strong>
                      <span>
                        {kindLabel(result.resultKind)} · {result.disambiguatingContext}
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <button
            type="button"
            onClick={props.onUseLocation}
            {...stylex.props(styles.locationButton)}
          >
            Gunakan lokasi perangkat
          </button>
          <button type="button" onClick={props.onUseMap} {...stylex.props(styles.locationButton)}>
            Pilih titik pada peta
          </button>
        </div>
      </Show>
    </div>
  );
}

function GuideOutcome(props: {
  readonly state: GuideState;
  readonly headingRef: (element: HTMLHeadingElement) => void;
  readonly onRetry: () => void;
  readonly onEdit: (kind: EndpointKind) => void;
  readonly onRefresh: () => void;
  readonly selectedAlternativeId?: string;
  readonly compact?: boolean;
  readonly onSelectAlternative: (alternative: PassengerGuideAlternative) => void;
}) {
  const response = () => (props.state._tag === "Ready" ? props.state.response : undefined);
  const found = () => {
    const current = response();
    return current?._tag === "GuidesFound" ? current : undefined;
  };
  const noRoute = () => {
    const current = response();
    return current?._tag === "NoTopologicalRoute" ? current : undefined;
  };
  return (
    <>
      <Show when={response()}>
        {(_response) => (
          <section aria-live="polite" {...stylex.props(styles.outcome)}>
            <Show when={found()}>
              {(result) => (
                <RouteGuideResults
                  result={result()}
                  headingRef={props.headingRef}
                  selectedAlternativeId={props.selectedAlternativeId}
                  compact={props.compact}
                  onSelectAlternative={props.onSelectAlternative}
                />
              )}
            </Show>
            <Show when={noRoute()}>
              {(result) => (
                <>
                  <h2 ref={props.headingRef} tabIndex={-1}>
                    Belum ada rute bus yang dapat ditampilkan
                  </h2>
                  <p>
                    Kami belum memiliki sambungan bus untuk pilihan ini. Pilihan asal dan tujuan
                    tetap tersimpan.
                  </p>
                  <p>
                    {result().originCandidates.length} pilihan naik dan{" "}
                    {result().destinationCandidates.length} pilihan turun telah diperiksa.
                  </p>
                  <NearbyCandidateSummary
                    label="Pilihan naik yang diperiksa"
                    names={result().originCandidates.map((candidate) => candidate.primaryName)}
                  />
                  <NearbyCandidateSummary
                    label="Pilihan turun yang diperiksa"
                    names={result().destinationCandidates.map((candidate) => candidate.primaryName)}
                  />
                  <button type="button" onClick={() => props.onEdit("origin")}>
                    Ubah asal
                  </button>{" "}
                  <button type="button" onClick={() => props.onEdit("destination")}>
                    Ubah tujuan
                  </button>
                </>
              )}
            </Show>
            <Show when={response()?._tag === "InvalidCandidateSet"}>
              <h2 ref={props.headingRef} tabIndex={-1}>
                Pilihan transit belum dapat dipakai
              </h2>
            </Show>
            <Show when={response()?._tag === "StaleSelection"}>
              <>
                <h2 ref={props.headingRef} tabIndex={-1}>
                  Data rute telah diperbarui
                </h2>
                <p>
                  Teks tempat tetap tersimpan. Cari ulang salah satu tempat untuk menyegarkan
                  pilihan.
                </p>
                <button type="button" onClick={props.onRefresh}>
                  Segarkan pilihan tempat
                </button>
              </>
            </Show>
          </section>
        )}
      </Show>
      <Show when={props.state._tag === "Failed" ? props.state : undefined}>
        {(failed) => (
          <section role="alert" {...stylex.props(styles.outcome)}>
            <h2 ref={props.headingRef} tabIndex={-1}>
              Panduan sedang tidak tersedia
            </h2>
            <p>{failed().message}</p>
            <button type="button" onClick={props.onRetry}>
              Coba lagi
            </button>
          </section>
        )}
      </Show>
    </>
  );
}

function NearbyCandidateSummary(props: {
  readonly label: string;
  readonly names: ReadonlyArray<string>;
}) {
  return (
    <div {...stylex.props(styles.candidateSummary)}>
      <strong>{props.label}</strong>
      <span>{props.names.length === 0 ? "Tidak ada" : props.names.join(", ")}</span>
    </div>
  );
}

const styles = stylex.create({
  page: { backgroundColor: "#d8d2c0", color: "#152c3d", minHeight: "100dvh", position: "relative" },
  mapStage: { height: "100dvh", inset: 0, position: "fixed", width: "100vw" },
  mapPlaceholder: {
    alignItems: "center",
    backgroundColor: "#d8d2c0",
    display: "flex",
    flexDirection: "column",
    gap: "0.8rem",
    inset: 0,
    justifyContent: "center",
    overflow: "hidden",
    position: "absolute",
    textAlign: "center",
  },
  mapGrid: {
    backgroundImage:
      "linear-gradient(#b8b4a6 1px, transparent 1px), linear-gradient(90deg, #b8b4a6 1px, transparent 1px)",
    backgroundSize: "32px 32px",
    inset: 0,
    opacity: 0.7,
    position: "absolute",
  },
  controlPanel: {
    backgroundColor: "#fff8e8",
    border: "1px solid #152c3d",
    boxShadow: "6px 6px 0 #152c3d",
    left: "clamp(1rem, 4vw, 3rem)",
    padding: "0.9rem",
    position: "relative",
    top: "1.5rem",
    width: "min(28rem, calc(100vw - 2rem))",
    zIndex: 5,
    "@media (max-width: 700px)": {
      boxShadow: "3px 3px 0 #152c3d",
      left: "0.5rem",
      padding: "0.5rem",
      top: "0.5rem",
      width: "calc(100vw - 1rem)",
    },
  },
  header: {
    alignItems: "center",
    display: "flex",
    gap: "0.7rem",
    marginBottom: "0.7rem",
    "@media (max-width: 700px)": { display: "none" },
  },
  roundel: {
    alignItems: "center",
    backgroundColor: "#e0442e",
    border: "2px solid #152c3d",
    borderRadius: "50%",
    color: "#fff8e8",
    display: "flex",
    fontWeight: 900,
    height: "2.7rem",
    justifyContent: "center",
    width: "2.7rem",
  },
  kicker: {
    fontSize: "0.65rem",
    fontWeight: 800,
    letterSpacing: "0.08em",
    margin: 0,
    textTransform: "uppercase",
  },
  title: { fontSize: "1.8rem", letterSpacing: "-0.04em", margin: 0 },
  endpointStack: { display: "grid", gap: "0.35rem", position: "relative" },
  endpointField: { position: "relative" },
  endpointLabel: {
    display: "block",
    fontSize: "0.68rem",
    fontWeight: 900,
    marginBottom: "0.25rem",
    textTransform: "uppercase",
    "@media (max-width: 700px)": { fontSize: "0.58rem", marginBottom: "0.1rem" },
  },
  endpointInput: {
    backgroundColor: "#fffdf5",
    border: "1px solid #152c3d",
    borderRadius: 0,
    color: "#152c3d",
    font: "inherit",
    minHeight: "3rem",
    padding: "0.65rem 4.5rem 0.65rem 0.75rem",
    width: "100%",
    ":focus-visible": { outline: "3px solid #f5c542", outlineOffset: "2px" },
    "@media (max-width: 700px)": {
      minHeight: "2.4rem",
      padding: "0.35rem 3.6rem 0.35rem 0.5rem",
    },
  },
  selectedMark: {
    color: "#28735a",
    fontSize: "0.62rem",
    fontWeight: 900,
    position: "absolute",
    right: "0.65rem",
    textTransform: "uppercase",
    top: "2.15rem",
    "@media (max-width: 700px)": { right: "0.5rem", top: "1.65rem" },
  },
  reverseButton: {
    alignItems: "center",
    backgroundColor: "#f5c542",
    border: "1px solid #152c3d",
    borderRadius: "50%",
    cursor: "pointer",
    display: "flex",
    fontSize: "1.1rem",
    height: "2.2rem",
    justifyContent: "center",
    position: "absolute",
    right: "0.7rem",
    top: "4rem",
    width: "2.2rem",
    zIndex: 4,
    "@media (max-width: 700px)": {
      fontSize: "0.9rem",
      height: "1.85rem",
      right: "0.45rem",
      top: "2.85rem",
      width: "1.85rem",
    },
  },
  resultPopover: {
    backgroundColor: "#fff8e8",
    border: "1px solid #152c3d",
    boxShadow: "3px 3px 0 #152c3d",
    left: 0,
    marginTop: "0.25rem",
    maxHeight: "min(26rem, calc(100dvh - 10rem))",
    overflowY: "auto",
    overscrollBehavior: "contain",
    position: "absolute",
    right: 0,
    zIndex: 10,
  },
  searchStatus: { fontSize: "0.72rem", margin: 0, padding: "0.65rem" },
  resultList: { listStyle: "none", margin: 0, padding: 0 },
  resultButton: {
    backgroundColor: "transparent",
    border: 0,
    borderTop: "1px solid #d8d2c0",
    color: "#152c3d",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    minHeight: "3.3rem",
    padding: "0.6rem",
    textAlign: "left",
    width: "100%",
  },
  activeResult: { backgroundColor: "#fff1bc" },
  locationButton: {
    backgroundColor: "#e7e0cf",
    border: 0,
    borderTop: "1px solid #152c3d",
    cursor: "pointer",
    fontWeight: 800,
    minHeight: "2.75rem",
    width: "100%",
  },
  retryButton: { minHeight: "2.75rem", width: "100%" },
  routingStatus: {
    alignItems: "center",
    backgroundColor: "#152c3d",
    bottom: "1rem",
    color: "#fff8e8",
    display: "flex",
    fontSize: "0.75rem",
    fontWeight: 800,
    gap: "0.45rem",
    left: "50%",
    margin: 0,
    padding: "0.45rem 0.7rem",
    position: "fixed",
    transform: "translateX(-50%)",
    zIndex: 7,
  },
  loadingSpinner: {
    animationDuration: "700ms",
    animationIterationCount: "infinite",
    animationName: stylex.keyframes({ to: { transform: "rotate(360deg)" } }),
    animationTimingFunction: "linear",
    border: "2px solid rgba(255, 248, 232, 0.38)",
    borderRadius: "50%",
    borderTopColor: "#fff8e8",
    height: "0.85rem",
    width: "0.85rem",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  resultSheet: {
    animationDuration: "220ms",
    animationName: stylex.keyframes({
      from: { transform: "translateY(100%)" },
      to: { transform: "translateY(0)" },
    }),
    animationTimingFunction: "ease-out",
    backgroundColor: "#fff8e8",
    border: "1px solid #152c3d",
    bottom: "1.5rem",
    boxShadow: "6px 6px 0 #152c3d",
    maxHeight: "min(72dvh, 44rem)",
    overflowY: "auto",
    padding: "0 0.65rem 0.65rem",
    position: "fixed",
    right: "1.5rem",
    transition: "max-height 180ms ease",
    width: "min(31rem, calc(100vw - 2rem))",
    zIndex: 6,
    "@media (max-width: 700px)": {
      borderBottom: 0,
      borderLeft: 0,
      borderRight: 0,
      bottom: 0,
      boxShadow: "0 -4px 0 rgba(21, 44, 61, 0.22)",
      left: 0,
      maxHeight: "46dvh",
      padding: "0 0.5rem 0.5rem",
      right: 0,
      width: "100%",
    },
    "@media (prefers-reduced-motion: reduce)": { animationName: "none", transition: "none" },
  },
  collapsedSheet: {
    maxHeight: "7.25rem",
    overflowY: "hidden",
    "@media (max-width: 700px)": { maxHeight: "7.25rem" },
  },
  sheetHandle: {
    alignItems: "center",
    backgroundColor: "#fff8e8",
    border: 0,
    color: "#152c3d",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    fontSize: "0.65rem",
    fontWeight: 800,
    gap: "0.2rem",
    minHeight: "2rem",
    padding: "0.3rem",
    position: "sticky",
    top: 0,
    width: "100%",
    zIndex: 2,
  },
  grabber: {
    backgroundColor: "#78909c",
    borderRadius: "999px",
    height: "0.22rem",
    width: "2.4rem",
  },
  outcome: { margin: 0, padding: 0 },
  candidateSummary: {
    display: "flex",
    flexDirection: "column",
    fontSize: "0.72rem",
    marginBlock: "0.45rem",
  },
});
