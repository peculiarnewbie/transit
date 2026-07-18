import {
  For,
  Show,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
} from "solid-js";
import * as stylex from "@stylexjs/stylex";

import type { RouteId } from "../../domain/transit/index.js";
import { apiPassengerAdapter } from "./api-adapter.js";
import { fixtureStops } from "./fixtures.js";
import { runPassengerSearch, setLineConstraint, setLockedLeg } from "./passenger-state.js";
import {
  endpointLabel,
  type Coordinate,
  type EndpointKind,
  type Journey,
  type JourneyEndpoint,
  type LineConstraint,
  type PassengerRoutingAdapter,
  type PassengerState,
  type RouteQuery,
  type StopSuggestion,
  type TransitLeg,
} from "./types.js";

const LazyPassengerMap = lazy(() => import("../../components/map/PassengerMap.js"));
const defaultMapStyleUrl = "https://tiles.openfreemap.org/styles/positron";

export interface PassengerExplorerProps {
  readonly adapter?: PassengerRoutingAdapter;
  readonly mapStyleUrl?: string;
}

type StopSearchState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "WaitingForInput" }
  | { readonly _tag: "Searching" }
  | { readonly _tag: "Ready" }
  | { readonly _tag: "Failed" };

const stopSearchDebounceMilliseconds = 350;

export const scheduleStopSearch = ({
  query,
  onSearch,
}: {
  readonly query: string;
  readonly onSearch: (query: string) => void;
}) => {
  const timeout = setTimeout(
    () => onSearch(query),
    query === "" ? 0 : stopSearchDebounceMilliseconds,
  );
  return () => clearTimeout(timeout);
};

const coordinateForEndpoint = (endpoint: JourneyEndpoint | undefined): Coordinate | undefined =>
  endpoint?._tag === "Stop" ? endpoint.stop.coordinate : endpoint?.coordinate;

export const endpointSearchText = (endpoint: JourneyEndpoint | undefined): string =>
  endpoint === undefined ? "" : endpointLabel(endpoint);

export default function PassengerExplorer(props: PassengerExplorerProps) {
  const adapter = () => props.adapter ?? apiPassengerAdapter;
  const [origin, setOrigin] = createSignal<JourneyEndpoint>();
  const [destination, setDestination] = createSignal<JourneyEndpoint>();
  const [activeEndpoint, setActiveEndpoint] = createSignal<EndpointKind>();
  const [state, setState] = createSignal<PassengerState>({ _tag: "Idle" });
  const [suggestions, setSuggestions] = createSignal<ReadonlyArray<StopSuggestion>>(
    props.adapter === undefined ? [] : fixtureStops,
  );
  const [stopQuery, setStopQuery] = createSignal("");
  const [stopSearchState, setStopSearchState] = createSignal<StopSearchState>({ _tag: "Idle" });
  let searchController: AbortController | undefined;
  let statusHeading: HTMLHeadingElement | undefined;
  let stopSearchInput: HTMLInputElement | undefined;

  const canSearch = createMemo(() => origin() !== undefined && destination() !== undefined);
  const currentQuery = (): RouteQuery | undefined => {
    const from = origin();
    const to = destination();
    if (from === undefined || to === undefined) return undefined;
    const current = state();
    if ("query" in current) return { ...current.query, origin: from, destination: to };
    return { origin: from, destination: to, lineConstraints: [] };
  };

  createEffect(() => {
    const tag = state()._tag;
    if (tag === "Results" || tag === "NoRoute" || tag === "Failed") {
      queueMicrotask(() => statusHeading?.focus());
    }
  });

  createEffect(() => {
    const endpointKind = activeEndpoint();
    const searchStops = adapter().searchStops;
    if (endpointKind === undefined || searchStops === undefined) return;
    const query = stopQuery().trim();
    if (query.length === 1) {
      setSuggestions([]);
      setStopSearchState({ _tag: "WaitingForInput" });
      return;
    }
    const controller = new AbortController();
    const selectedOrigin = origin();
    const reachableFromStopId =
      endpointKind === "destination" && selectedOrigin?._tag === "Stop"
        ? selectedOrigin.stop.id
        : undefined;
    const cancelScheduled = scheduleStopSearch({
      query,
      onSearch: (scheduledQuery) => {
        setStopSearchState({ _tag: "Searching" });
        void searchStops(scheduledQuery, { signal: controller.signal, reachableFromStopId })
          .then((stops) => {
            if (controller.signal.aborted) return;
            setSuggestions(stops);
            setStopSearchState({ _tag: "Ready" });
          })
          .catch(() => {
            if (!controller.signal.aborted) setStopSearchState({ _tag: "Failed" });
          });
      },
    });
    onCleanup(() => {
      cancelScheduled();
      controller.abort();
    });
  });

  onCleanup(() => searchController?.abort());

  const chooseEndpoint = (kind: EndpointKind) => {
    const endpoint = kind === "origin" ? origin() : destination();
    setStopQuery(endpointSearchText(endpoint));
    setActiveEndpoint(kind);
    setState({ _tag: "ChoosingEndpoint", endpoint: kind });
    queueMicrotask(() => {
      stopSearchInput?.focus();
      if (endpoint !== undefined) stopSearchInput?.select();
    });
  };

  const selectStop = (stop: StopSuggestion) => {
    setEndpoint(activeEndpoint() ?? "origin", { _tag: "Stop", stop });
  };

  const setEndpoint = (kind: EndpointKind, endpoint: JourneyEndpoint) => {
    if (kind === "origin") setOrigin(endpoint);
    else setDestination(endpoint);
    setActiveEndpoint(undefined);
    setState({ _tag: "Idle" });
  };

  const search = async (query = currentQuery()) => {
    if (query === undefined) return;
    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;
    await runPassengerSearch({
      adapter: adapter(),
      query,
      onState: setState,
      signal: controller.signal,
    });
    if (searchController === controller) searchController = undefined;
  };

  const refineLine = async (routeId: RouteId, constraint: LineConstraint["_tag"]) => {
    const query = currentQuery();
    if (query === undefined) return;
    await search(setLineConstraint({ query, routeId, constraint }));
  };

  const lockLeg = async (_journey: Journey, leg: TransitLeg, _legIndex: number) => {
    const query = currentQuery();
    if (query === undefined) return;
    await search(
      setLockedLeg({
        query,
        lockedLeg: leg.lock,
      }),
    );
  };

  const selectedJourneyId = () => {
    const current = state();
    return current._tag === "Results" ? current.selectedJourneyId : undefined;
  };

  const selectedJourneyGeometry = () => {
    const current = state();
    if (current._tag !== "Results") return [];
    return (
      current.journeys.find((journey) => journey.id === current.selectedJourneyId)?.geometry ?? []
    );
  };

  const selectedJourneyColor = () => {
    const current = state();
    if (current._tag !== "Results") return "#31556f";
    return (
      current.journeys
        .find((journey) => journey.id === current.selectedJourneyId)
        ?.legs.find((leg) => leg._tag === "Transit")?.color ?? "#31556f"
    );
  };

  const mapSelectionKind = (): EndpointKind | undefined =>
    activeEndpoint() ??
    (origin() === undefined ? "origin" : destination() === undefined ? "destination" : undefined);

  const selectMapStop = async (stop: StopSuggestion) => {
    const kind = mapSelectionKind();
    if (kind === undefined) return;
    const selectedOrigin = origin();
    const searchStops = adapter().searchStops;
    if (kind === "destination" && selectedOrigin?._tag === "Stop" && searchStops !== undefined) {
      let matching: ReadonlyArray<StopSuggestion>;
      try {
        matching = await searchStops(stop.name, {
          reachableFromStopId: selectedOrigin.stop.id,
        });
      } catch {
        setStopQuery(stop.name);
        setSuggestions([]);
        setStopSearchState({ _tag: "Failed" });
        setActiveEndpoint("destination");
        setState({ _tag: "ChoosingEndpoint", endpoint: "destination" });
        return;
      }
      const validStop = matching.find((candidate) => candidate.id === stop.id);
      if (validStop === undefined) {
        setStopQuery(stop.name);
        setSuggestions([]);
        setStopSearchState({ _tag: "Ready" });
        setActiveEndpoint("destination");
        setState({ _tag: "ChoosingEndpoint", endpoint: "destination" });
        return;
      }
      setEndpoint("destination", { _tag: "Stop", stop: validStop });
      return;
    }
    setEndpoint(kind, { _tag: "Stop", stop });
  };

  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.masthead)}>
        <div {...stylex.props(styles.brandBlock)}>
          <span aria-hidden="true" {...stylex.props(styles.roundel)}>
            T
          </span>
          <div>
            <p {...stylex.props(styles.kicker)}>Jakarta, one leg at a time</p>
            <h1 {...stylex.props(styles.brand)}>Transit</h1>
          </div>
        </div>
        <p {...stylex.props(styles.promise)}>
          Bus-first directions that still work when your signal doesn’t.
        </p>
      </header>

      <div {...stylex.props(styles.workspace)}>
        <section aria-label="Plan a journey" {...stylex.props(styles.sheet)}>
          <div {...stylex.props(styles.sheetHeading)}>
            <span {...stylex.props(styles.stepNumber)}>01</span>
            <div>
              <p {...stylex.props(styles.overline)}>Plan your trip</p>
              <h2 {...stylex.props(styles.heading)}>Where are you going?</h2>
            </div>
          </div>

          <div {...stylex.props(styles.endpoints)}>
            <EndpointButton
              kind="origin"
              value={origin()}
              active={activeEndpoint() === "origin"}
              onChoose={chooseEndpoint}
            />
            <span aria-hidden="true" {...stylex.props(styles.endpointRail)} />
            <EndpointButton
              kind="destination"
              value={destination()}
              active={activeEndpoint() === "destination"}
              onChoose={chooseEndpoint}
            />
          </div>

          <Show when={activeEndpoint() !== undefined}>
            <div {...stylex.props(styles.suggestions)}>
              <label {...stylex.props(styles.stopSearchLabel)}>
                Search stops
                <input
                  ref={(element) => (stopSearchInput = element)}
                  type="search"
                  value={stopQuery()}
                  onInput={(event) => setStopQuery(event.currentTarget.value)}
                  placeholder="Try Tosari or Bundaran HI"
                  autocomplete="off"
                  maxlength={80}
                  spellcheck={false}
                  {...stylex.props(styles.stopSearchInput)}
                />
              </label>
              <p aria-live="polite" {...stylex.props(styles.suggestionLabel)}>
                {stopSearchState()._tag === "WaitingForInput"
                  ? "Type at least 2 characters"
                  : stopSearchState()._tag === "Searching"
                    ? "Searching…"
                    : stopQuery().trim() === ""
                      ? "Suggested stops"
                      : `${suggestions().length} matching ${suggestions().length === 1 ? "stop" : "stops"}`}
              </p>
              <ul {...stylex.props(styles.suggestionList)}>
                <For each={suggestions()}>
                  {(stop) => (
                    <li>
                      <button
                        type="button"
                        onClick={() => selectStop(stop)}
                        {...stylex.props(styles.suggestionButton)}
                      >
                        <span>{stop.name}</span>
                        <small>{stop.area}</small>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={stopSearchState()._tag === "Ready" && suggestions().length === 0}>
                <p {...stylex.props(styles.mapHint)}>No stops match that search.</p>
              </Show>
              <Show when={stopSearchState()._tag === "Failed"}>
                <p role="alert" {...stylex.props(styles.mapHint)}>
                  Stop search is unavailable. Try again.
                </p>
              </Show>
            </div>
          </Show>

          <button
            type="button"
            disabled={!canSearch() || state()._tag === "Searching"}
            onClick={() => void search()}
            {...stylex.props(styles.searchButton)}
          >
            {state()._tag === "Searching" ? "Checking the network…" : "Show routes"}
            <span aria-hidden="true">→</span>
          </button>

          <JourneyResults
            state={state()}
            headingRef={(element) => (statusHeading = element)}
            onSelect={(journeyId) => {
              const current = state();
              if (current._tag === "Results")
                setState({ ...current, selectedJourneyId: journeyId });
            }}
            onLineConstraint={(routeId, constraint) => void refineLine(routeId, constraint)}
            onLockLeg={(journey, leg, index) => void lockLeg(journey, leg, index)}
            onRetry={() => void search()}
            onClearRules={() => {
              const query = currentQuery();
              if (query !== undefined)
                void search({ ...query, lineConstraints: [], lockedLeg: undefined });
            }}
            onChangeStops={() => chooseEndpoint("destination")}
          />
        </section>

        <div {...stylex.props(styles.mapColumn)}>
          <div {...stylex.props(styles.mapLabel)}>
            <span>02</span>
            <strong>Route context</strong>
            <small>Map optional</small>
          </div>
          <Suspense fallback={<MapFallback />}>
            <LazyPassengerMap
              styleUrl={
                props.mapStyleUrl ?? import.meta.env.VITE_MAP_STYLE_URL ?? defaultMapStyleUrl
              }
              selectedJourneyId={selectedJourneyId()}
              selectedGeometry={selectedJourneyGeometry()}
              selectedColor={selectedJourneyColor()}
              origin={coordinateForEndpoint(origin())}
              destination={coordinateForEndpoint(destination())}
              selectionKind={mapSelectionKind()}
              onStopSelect={(stop) => void selectMapStop(stop)}
            />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

export function EndpointButton(props: {
  readonly kind: EndpointKind;
  readonly value?: JourneyEndpoint;
  readonly active: boolean;
  readonly onChoose: (kind: EndpointKind) => void;
}) {
  const label = () => (props.kind === "origin" ? "From" : "To");
  return (
    <button
      type="button"
      aria-expanded={props.active}
      onClick={() => props.onChoose(props.kind)}
      {...stylex.props(styles.endpointButton, props.active && styles.endpointActive)}
    >
      <span
        aria-hidden="true"
        {...stylex.props(styles.endpointDot, props.kind === "destination" && styles.destinationDot)}
      />
      <span {...stylex.props(styles.endpointCopy)}>
        <small>{label()}</small>
        <strong>
          {props.value === undefined
            ? `Choose ${label().toLowerCase()}`
            : endpointLabel(props.value)}
        </strong>
      </span>
      <span aria-hidden="true" {...stylex.props(styles.editMark)}>
        ⌄
      </span>
    </button>
  );
}

export function JourneyResults(props: {
  readonly state: PassengerState;
  readonly headingRef?: (element: HTMLHeadingElement) => void;
  readonly onSelect: (journeyId: string) => void;
  readonly onLineConstraint: (routeId: RouteId, constraint: LineConstraint["_tag"]) => void;
  readonly onLockLeg: (journey: Journey, leg: TransitLeg, index: number) => void;
  readonly onRetry: () => void;
  readonly onClearRules: () => void;
  readonly onChangeStops: () => void;
}) {
  const results = () => (props.state._tag === "Results" ? props.state : undefined);

  return (
    <div
      aria-live="polite"
      aria-busy={props.state._tag === "Searching"}
      {...stylex.props(styles.results)}
    >
      <Show when={props.state._tag === "Searching"}>
        <div role="status" {...stylex.props(styles.loadingState)}>
          <span {...stylex.props(styles.loadingBar)} />
          <strong>Reading the corridors…</strong>
          <span>The controls stay available while routes load.</span>
        </div>
      </Show>

      <Show when={props.state._tag === "NoRoute"}>
        {(() => {
          const hasRules =
            props.state._tag === "NoRoute" && props.state.query.lineConstraints.length > 0;
          return (
            <EmptyState
              heading={
                hasRules ? "No route fits those line rules" : "No route found between these stops"
              }
              body={
                hasRules
                  ? "Your stops are unchanged. Remove the line rules to see more options."
                  : "No service is available between these stops at this time. Choose another nearby stop or try again later."
              }
              action={hasRules ? "Clear route rules" : "Choose another stop"}
              headingRef={props.headingRef}
              onAction={hasRules ? props.onClearRules : props.onChangeStops}
            />
          );
        })()}
      </Show>

      <Show when={props.state._tag === "Failed"}>
        <EmptyState
          heading="Routes are offline"
          body={
            props.state._tag === "Failed"
              ? props.state.message
              : "Try again when your connection returns."
          }
          action="Try again"
          headingRef={props.headingRef}
          onAction={props.onRetry}
        />
      </Show>

      <Show when={results()}>
        {(result) => (
          <section aria-label="Journey options" tabIndex={0} {...stylex.props(styles.routeOptions)}>
            <div {...stylex.props(styles.resultHeading)}>
              <h2 ref={props.headingRef} tabIndex={-1}>
                Choose a route
              </h2>
              <span>{result().journeys.length} options</span>
            </div>
            <ol {...stylex.props(styles.journeyList)}>
              <For each={result().journeys}>
                {(journey, journeyIndex) => (
                  <li>
                    <article
                      {...stylex.props(
                        styles.journeyCard,
                        result().selectedJourneyId === journey.id && styles.selectedCard,
                      )}
                    >
                      <button
                        type="button"
                        aria-pressed={result().selectedJourneyId === journey.id}
                        onClick={() => props.onSelect(journey.id)}
                        {...stylex.props(styles.journeySelect)}
                      >
                        <span {...stylex.props(styles.optionLabel)}>
                          Option {journeyIndex() + 1}
                        </span>
                        <strong {...stylex.props(styles.duration)}>
                          {journey.minutes}
                          <small> min</small>
                        </strong>
                        <span {...stylex.props(styles.journeyLabel)}>{journey.label}</span>
                        <span {...stylex.props(styles.summary)}>
                          {journey.transfers === 0 ? "Direct" : `${journey.transfers} transfer`} ·{" "}
                          {journey.walkingMinutes} min walk
                        </span>
                      </button>
                      <ol aria-label={`${journey.label} legs`} {...stylex.props(styles.legList)}>
                        <For each={journey.legs}>
                          {(leg, legIndex) => (
                            <li {...stylex.props(styles.leg)}>
                              <Show
                                when={leg._tag === "Transit" ? leg : undefined}
                                fallback={<span {...stylex.props(styles.walkToken)}>Walk</span>}
                              >
                                {(transit) => (
                                  <span
                                    {...stylex.props(styles.routeToken, toneStyles[transit().tone])}
                                  >
                                    {transit().line}
                                  </span>
                                )}
                              </Show>
                              <span {...stylex.props(styles.legCopy)}>
                                <strong>
                                  {leg.from} → {leg.to}
                                </strong>
                                <small>
                                  {leg._tag === "Transit"
                                    ? `${leg.stops} stops · ${leg.minutes} min`
                                    : `${leg.meters} m · ${leg.minutes} min`}
                                </small>
                              </span>
                              <Show when={leg._tag === "Transit" ? leg : undefined}>
                                {(transit) => (
                                  <details {...stylex.props(styles.lineRules)}>
                                    <summary aria-label={`Set rules for line ${transit().line}`}>
                                      •••
                                    </summary>
                                    <div {...stylex.props(styles.ruleMenu)}>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          props.onLineConstraint(transit().routeId, "Prefer")
                                        }
                                        {...stylex.props(styles.ruleButton)}
                                      >
                                        Prefer {transit().line}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          props.onLineConstraint(transit().routeId, "Require")
                                        }
                                        {...stylex.props(styles.ruleButton)}
                                      >
                                        Require {transit().line}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          props.onLineConstraint(transit().routeId, "Exclude")
                                        }
                                        {...stylex.props(styles.ruleButton)}
                                      >
                                        Avoid {transit().line}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          props.onLockLeg(journey, transit(), legIndex())
                                        }
                                        {...stylex.props(styles.ruleButton)}
                                      >
                                        Lock this leg
                                      </button>
                                    </div>
                                  </details>
                                )}
                              </Show>
                            </li>
                          )}
                        </For>
                      </ol>
                    </article>
                  </li>
                )}
              </For>
            </ol>
          </section>
        )}
      </Show>
    </div>
  );
}

function EmptyState(props: {
  readonly heading: string;
  readonly body: string;
  readonly action: string;
  readonly headingRef?: (element: HTMLHeadingElement) => void;
  readonly onAction: () => void;
}) {
  return (
    <section {...stylex.props(styles.emptyState)}>
      <span aria-hidden="true" {...stylex.props(styles.emptyMark)}>
        !
      </span>
      <h2 ref={props.headingRef} tabIndex={-1}>
        {props.heading}
      </h2>
      <p>{props.body}</p>
      <button type="button" onClick={props.onAction}>
        {props.action}
      </button>
    </section>
  );
}

function MapFallback() {
  return (
    <div role="status" {...stylex.props(styles.mapFallback)}>
      <strong>Map loading in the background</strong>
      <span>You can plan and read every route without it.</span>
    </div>
  );
}

const styles = stylex.create({
  page: {
    backgroundColor: "#f2ead8",
    color: "#152c3d",
    minHeight: "100dvh",
    paddingBottom: "2rem",
  },
  masthead: {
    alignItems: "end",
    borderBottom: "1px solid #152c3d",
    display: "flex",
    justifyContent: "space-between",
    marginInline: "auto",
    maxWidth: "90rem",
    padding: "1.25rem clamp(1rem, 4vw, 3rem)",
    gap: "1rem",
    "@media (max-width: 640px)": { alignItems: "start", flexDirection: "column" },
  },
  brandBlock: { alignItems: "center", display: "flex", gap: "0.8rem" },
  roundel: {
    alignItems: "center",
    backgroundColor: "#e0442e",
    border: "2px solid #152c3d",
    borderRadius: "50%",
    color: "#fff8e8",
    display: "flex",
    fontSize: "1.4rem",
    fontWeight: 900,
    height: "3.2rem",
    justifyContent: "center",
    width: "3.2rem",
  },
  kicker: {
    fontSize: "0.66rem",
    fontWeight: 800,
    letterSpacing: "0.14em",
    margin: 0,
    textTransform: "uppercase",
  },
  brand: {
    fontSize: "clamp(2.2rem, 5vw, 4.7rem)",
    letterSpacing: "-0.075em",
    lineHeight: 0.8,
    margin: "0.2rem 0 0",
  },
  promise: {
    fontSize: "0.82rem",
    fontWeight: 650,
    margin: 0,
    maxWidth: "23rem",
    textAlign: "right",
    "@media (max-width: 640px)": { textAlign: "left" },
  },
  workspace: {
    display: "grid",
    gap: "1.25rem",
    gridTemplateColumns: "minmax(20rem, 31rem) minmax(0, 1fr)",
    marginInline: "auto",
    maxWidth: "90rem",
    padding: "1.25rem clamp(1rem, 4vw, 3rem) 0",
    "@media (max-width: 840px)": { display: "flex", flexDirection: "column" },
    "@media (max-width: 520px)": { gap: "0.85rem", padding: "0.75rem 0.75rem 0" },
  },
  sheet: {
    backgroundColor: "#fff8e8",
    border: "1px solid #152c3d",
    boxShadow: "6px 6px 0 #152c3d",
    padding: "clamp(1rem, 3vw, 1.5rem)",
    "@media (max-width: 520px)": { boxShadow: "3px 3px 0 #152c3d", padding: "1rem" },
  },
  sheetHeading: { alignItems: "center", display: "flex", gap: "0.75rem", marginBottom: "1.25rem" },
  stepNumber: {
    backgroundColor: "#f5c542",
    border: "1px solid #152c3d",
    fontSize: "0.72rem",
    fontWeight: 900,
    padding: "0.35rem",
  },
  overline: {
    fontSize: "0.68rem",
    fontWeight: 800,
    letterSpacing: "0.12em",
    margin: 0,
    textTransform: "uppercase",
  },
  heading: { fontSize: "clamp(1.5rem, 3vw, 2.2rem)", letterSpacing: "-0.045em", margin: 0 },
  endpoints: { position: "relative" },
  endpointRail: {
    backgroundColor: "#152c3d",
    height: "1.2rem",
    left: "1.05rem",
    position: "absolute",
    top: "3.55rem",
    width: "2px",
  },
  endpointButton: {
    alignItems: "center",
    backgroundColor: "#fffdf5",
    border: "1px solid #78909c",
    color: "#152c3d",
    cursor: "pointer",
    display: "flex",
    gap: "0.8rem",
    marginBottom: "0.55rem",
    padding: "0.8rem",
    textAlign: "left",
    width: "100%",
    ":hover": { borderColor: "#152c3d" },
    ":focus-visible": { outline: "3px solid #f5c542", outlineOffset: "2px" },
  },
  endpointActive: { backgroundColor: "#fff1bc", borderColor: "#152c3d" },
  endpointDot: {
    backgroundColor: "#fff8e8",
    border: "4px solid #e0442e",
    borderRadius: "50%",
    height: "0.65rem",
    width: "0.65rem",
  },
  destinationDot: { backgroundColor: "#152c3d", borderColor: "#152c3d" },
  endpointCopy: { display: "flex", flex: 1, flexDirection: "column", minWidth: 0 },
  editMark: { fontSize: "1.2rem" },
  suggestions: {
    backgroundColor: "#e7e0cf",
    border: "1px solid #152c3d",
    marginBottom: "0.75rem",
    padding: "0.75rem",
  },
  suggestionLabel: {
    fontSize: "0.68rem",
    fontWeight: 900,
    letterSpacing: "0.12em",
    margin: "0 0 0.45rem",
    textTransform: "uppercase",
  },
  stopSearchLabel: {
    display: "flex",
    flexDirection: "column",
    fontSize: "0.68rem",
    fontWeight: 900,
    gap: "0.35rem",
    letterSpacing: "0.1em",
    marginBottom: "0.7rem",
    textTransform: "uppercase",
  },
  stopSearchInput: {
    backgroundColor: "#fffdf5",
    border: "1px solid #152c3d",
    borderRadius: 0,
    color: "#152c3d",
    font: "inherit",
    fontSize: "0.82rem",
    fontWeight: 650,
    letterSpacing: 0,
    padding: "0.7rem 0.75rem",
    textTransform: "none",
    width: "100%",
    ":focus-visible": { outline: "3px solid #f5c542", outlineOffset: "2px" },
  },
  suggestionList: {
    display: "grid",
    gap: "0.35rem",
    gridTemplateColumns: "1fr 1fr",
    listStyle: "none",
    margin: 0,
    padding: 0,
    "@media (max-width: 430px)": { gridTemplateColumns: "1fr" },
  },
  suggestionButton: {
    backgroundColor: "#fff8e8",
    border: "1px solid #78909c",
    color: "#152c3d",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    minHeight: "3.5rem",
    padding: "0.55rem",
    textAlign: "left",
    width: "100%",
    ":hover": { borderColor: "#e0442e" },
  },
  mapHint: { fontSize: "0.72rem", margin: "0.55rem 0 0" },
  searchButton: {
    alignItems: "center",
    backgroundColor: "#e0442e",
    border: "1px solid #152c3d",
    boxShadow: "3px 3px 0 #152c3d",
    color: "#fff8e8",
    cursor: "pointer",
    display: "flex",
    fontSize: "0.9rem",
    fontWeight: 850,
    justifyContent: "space-between",
    letterSpacing: "0.03em",
    marginTop: "0.8rem",
    padding: "0.85rem 1rem",
    textTransform: "uppercase",
    width: "100%",
    ":disabled": { backgroundColor: "#b5aa99", boxShadow: "none", cursor: "not-allowed" },
    ":focus-visible": { outline: "3px solid #f5c542", outlineOffset: "2px" },
  },
  results: { marginTop: "1.6rem" },
  routeOptions: {
    maxHeight: "min(38rem, calc(100dvh - 19rem))",
    outline: "none",
    overflowY: "auto",
    overscrollBehavior: "contain",
    paddingRight: "0.4rem",
    scrollbarGutter: "stable",
    ":focus-visible": { outline: "3px solid #f5c542", outlineOffset: "3px" },
    "@media (max-width: 840px)": { maxHeight: "26rem" },
  },
  loadingState: {
    borderTop: "1px solid #152c3d",
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    paddingTop: "1rem",
  },
  loadingBar: {
    animationName: stylex.keyframes({
      "0%": { transform: "scaleX(0.08)" },
      "100%": { transform: "scaleX(1)" },
    }),
    animationDuration: "1.2s",
    animationIterationCount: "infinite",
    animationDirection: "alternate",
    backgroundColor: "#e0442e",
    height: "0.25rem",
    transformOrigin: "left",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none", transform: "scaleX(0.55)" },
  },
  resultHeading: {
    alignItems: "baseline",
    borderTop: "1px solid #152c3d",
    display: "flex",
    justifyContent: "space-between",
    paddingTop: "1rem",
  },
  journeyList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.8rem",
    listStyle: "none",
    margin: "0.8rem 0 0",
    padding: 0,
  },
  journeyCard: { border: "1px solid #78909c", backgroundColor: "#fffdf5" },
  selectedCard: { borderColor: "#152c3d", boxShadow: "3px 3px 0 #f5c542" },
  journeySelect: {
    backgroundColor: "transparent",
    border: 0,
    color: "#152c3d",
    cursor: "pointer",
    display: "grid",
    gridTemplateColumns: "1fr auto",
    padding: "0.8rem",
    textAlign: "left",
    width: "100%",
  },
  optionLabel: {
    fontSize: "0.65rem",
    fontWeight: 900,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
  duration: { fontSize: "1.5rem", gridRow: "1 / span 2", gridColumn: 2, letterSpacing: "-0.05em" },
  journeyLabel: { fontWeight: 800, marginTop: "0.2rem" },
  summary: { fontSize: "0.72rem", gridColumn: "1 / -1", marginTop: "0.35rem" },
  legList: {
    borderTop: "1px dashed #78909c",
    listStyle: "none",
    margin: 0,
    padding: "0.45rem 0.8rem 0.7rem",
  },
  leg: {
    alignItems: "center",
    display: "flex",
    gap: "0.55rem",
    minHeight: "2.8rem",
    position: "relative",
  },
  routeToken: {
    alignItems: "center",
    border: "1px solid #152c3d",
    borderRadius: "0.2rem",
    color: "white",
    display: "flex",
    flexShrink: 0,
    fontSize: "0.7rem",
    fontWeight: 900,
    height: "1.7rem",
    justifyContent: "center",
    minWidth: "1.7rem",
    paddingInline: "0.15rem",
  },
  routeRed: { backgroundColor: "#c6312c" },
  routeBlue: { backgroundColor: "#176b87" },
  routeYellow: { backgroundColor: "#e6ae23", color: "#152c3d" },
  routeGreen: { backgroundColor: "#28735a" },
  walkToken: {
    color: "#506773",
    flexShrink: 0,
    fontSize: "0.65rem",
    fontWeight: 850,
    width: "2.1rem",
  },
  legCopy: { display: "flex", flex: 1, flexDirection: "column", fontSize: "0.72rem", minWidth: 0 },
  lineRules: { position: "relative" },
  ruleMenu: {
    backgroundColor: "#152c3d",
    display: "flex",
    flexDirection: "column",
    padding: "0.35rem",
    position: "absolute",
    right: 0,
    width: "9rem",
    zIndex: 5,
  },
  ruleButton: {
    backgroundColor: "transparent",
    border: 0,
    color: "#fff8e8",
    cursor: "pointer",
    fontSize: "0.72rem",
    padding: "0.45rem",
    textAlign: "left",
    ":hover": { backgroundColor: "#27475c" },
  },
  emptyState: { borderTop: "1px solid #152c3d", paddingTop: "1rem" },
  emptyMark: {
    alignItems: "center",
    backgroundColor: "#f5c542",
    border: "1px solid #152c3d",
    borderRadius: "50%",
    display: "flex",
    fontWeight: 900,
    height: "2rem",
    justifyContent: "center",
    width: "2rem",
  },
  mapColumn: {
    display: "flex",
    flexDirection: "column",
    minHeight: "calc(100dvh - 9rem)",
    "@media (max-width: 840px)": { minHeight: "18rem" },
  },
  mapLabel: {
    alignItems: "center",
    backgroundColor: "#152c3d",
    color: "#fff8e8",
    display: "flex",
    gap: "0.6rem",
    padding: "0.55rem 0.7rem",
  },
  mapFallback: {
    alignItems: "center",
    backgroundColor: "#d8d2c0",
    border: "1px solid #152c3d",
    display: "flex",
    flex: 1,
    flexDirection: "column",
    justifyContent: "center",
    minHeight: "18rem",
    padding: "2rem",
    textAlign: "center",
  },
});

const toneStyles = {
  red: styles.routeRed,
  blue: styles.routeBlue,
  yellow: styles.routeYellow,
  green: styles.routeGreen,
} as const;
