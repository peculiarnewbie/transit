import { For, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";

import type {
  GuideRideStepInstruction,
  PassengerGuideAlternative,
  RouteGuideFound,
} from "../../runtime/route-helper-contracts.js";

const directionCopy = (step: GuideRideStepInstruction): string =>
  step.directionSummaries.length === 0
    ? "Arah belum dapat dipastikan; cocokkan nama jalur dan tempat naik."
    : step.directionSummaries.join(" · ");

const platformCopy = (detail: string | undefined, action: "naik" | "turun"): string =>
  detail ?? `Titik ${action} spesifik belum diketahui.`;

export function RideStep(props: {
  readonly step: GuideRideStepInstruction;
  readonly index: number;
}) {
  return (
    <li {...stylex.props(styles.rideStep)}>
      <span {...stylex.props(styles.stepNumber)}>{props.index + 1}</span>
      <div {...stylex.props(styles.stepBody)}>
        <div aria-label={`Naik jalur ${props.step.linePhrase}`} {...stylex.props(styles.badges)}>
          <For each={props.step.lineBadges}>
            {(line, index) => (
              <>
                <Show when={index() > 0}>
                  <span {...stylex.props(styles.orLabel)}>atau</span>
                </Show>
                <span {...stylex.props(styles.lineBadge)}>{line}</span>
              </>
            )}
          </For>
        </div>
        <h4 {...stylex.props(styles.stepHeading)}>
          Naik di {props.step.boardingPlaceName}, turun di {props.step.alightingPlaceName}
        </h4>
        <p {...stylex.props(styles.direction)}>Arah: {directionCopy(props.step)}</p>
        <details {...stylex.props(styles.details)}>
          <summary>Detail jalur dan halte</summary>
          <dl {...stylex.props(styles.platforms)}>
            <dt>Titik naik</dt>
            <dd>{platformCopy(props.step.boardingMemberDetail, "naik")}</dd>
            <dt>Titik turun</dt>
            <dd>{platformCopy(props.step.alightingMemberDetail, "turun")}</dd>
          </dl>
          <For each={props.step.lineOptions}>
            {(option) => {
              const stops = () =>
                props.step.intermediatePlaceNamesByOption.find(
                  (entry) => entry.line === option.passengerLineName,
                )?.placeNames ?? option.intermediatePlaces.map((place) => place.placeName);
              return (
                <section {...stylex.props(styles.lineDetail)}>
                  <h5>
                    Jalur {option.passengerLineName} · {option.directionLabel}
                  </h5>
                  <Show
                    when={stops().length > 0}
                    fallback={<p>Tidak ada halte antara yang dipublikasikan untuk orientasi.</p>}
                  >
                    <p>Urutan halte antara:</p>
                    <ol {...stylex.props(styles.intermediateStops)}>
                      <For each={stops()}>{(placeName) => <li>{placeName}</li>}</For>
                    </ol>
                  </Show>
                </section>
              );
            }}
          </For>
        </details>
      </div>
    </li>
  );
}

export function GuideAlternativeCard(props: {
  readonly alternative: PassengerGuideAlternative;
  readonly index: number;
  readonly selectedOriginLabel?: string;
  readonly selectedDestinationLabel?: string;
  readonly selected?: boolean;
  readonly compact?: boolean;
  readonly onSelect?: () => void;
}) {
  const orderedLines = () => props.alternative.rideSteps.map((step) => step.linePhrase).join(" → ");
  const directions = () =>
    props.alternative.rideSteps
      .flatMap((step) => step.directionSummaries)
      .filter((direction, index, all) => all.indexOf(direction) === index)
      .join(" · ");
  const originConnector = () => {
    const distance = props.alternative.metrics?.originCandidateDistanceMeters;
    if (
      distance === undefined ||
      distance < 1 ||
      props.selectedOriginLabel === undefined ||
      props.selectedOriginLabel === props.alternative.origin.placeName
    )
      return undefined;
    return `${props.selectedOriginLabel} → ${props.alternative.origin.placeName} · ± ${Math.round(distance)} m garis lurus`;
  };
  const destinationConnector = () => {
    const distance = props.alternative.metrics?.destinationCandidateDistanceMeters;
    if (
      distance === undefined ||
      distance < 1 ||
      props.selectedDestinationLabel === undefined ||
      props.selectedDestinationLabel === props.alternative.destination.placeName
    )
      return undefined;
    return `${props.alternative.destination.placeName} → ${props.selectedDestinationLabel} · ± ${Math.round(distance)} m garis lurus`;
  };
  return (
    <article {...stylex.props(styles.card, props.selected && styles.selectedCard)}>
      <button
        type="button"
        aria-pressed={props.selected}
        onClick={props.onSelect}
        {...stylex.props(styles.cardSelect)}
      >
        <div {...stylex.props(styles.cardHeader)}>
          <Show when={!props.compact}>
            <span {...stylex.props(styles.optionLabel)}>Pilihan {props.index + 1}</span>
            <strong>{props.alternative.differenceSummary}</strong>
          </Show>
          <div {...stylex.props(styles.summaryBadges)}>
            <For each={props.alternative.rideSteps.flatMap((step) => step.lineBadges)}>
              {(line) => <span {...stylex.props(styles.lineBadge)}>{line}</span>}
            </For>
          </div>
          <Show
            when={!props.compact}
            fallback={
              <p {...stylex.props(styles.compactSummary)}>
                {props.alternative.origin.placeName} → {props.alternative.destination.placeName}
              </p>
            }
          >
            <p {...stylex.props(styles.decisionSummary)}>
              {orderedLines()} · {directions() || "arah perlu dikonfirmasi"}
            </p>
            <p {...stylex.props(styles.decisionSummary)}>
              Naik di {props.alternative.origin.placeName} ·{" "}
              {props.alternative.transferCount === 0
                ? "langsung tanpa pindah bus"
                : `${props.alternative.transferCount} kali pindah bus`}{" "}
              · turun di {props.alternative.destination.placeName}
            </p>
            <Show when={originConnector() || destinationConnector()}>
              <p {...stylex.props(styles.connectorNote)}>
                Titik sekitar:{" "}
                {[originConnector(), destinationConnector()].filter(Boolean).join(" · ")}. Jarak
                geografis, bukan rute berjalan.
              </p>
            </Show>
          </Show>
        </div>
      </button>
      <Show when={props.selected && !props.compact}>
        <ol
          aria-label={`Langkah ${props.alternative.differenceSummary}`}
          {...stylex.props(styles.steps)}
        >
          <For each={props.alternative.rideSteps}>
            {(step, index) => (
              <>
                <RideStep step={step} index={index()} />
                <Show when={props.alternative.transfers[index()]}>
                  {(transfer) => (
                    <li {...stylex.props(styles.transferStep)}>
                      <strong>Pindah di {transfer().leavePlaceName}</strong>
                      <span>
                        Lanjut naik di {transfer().boardNextPlaceName} dengan jalur{" "}
                        {transfer().nextLineBadges.join(" atau ")}
                        {transfer().nextDirectionLabel === undefined
                          ? ". Arah berikutnya perlu dikonfirmasi."
                          : ` arah ${transfer().nextDirectionLabel}.`}
                      </span>
                      <Show when={!transfer().platformDetailKnown}>
                        <small>Titik pindah spesifik belum diketahui.</small>
                      </Show>
                    </li>
                  )}
                </Show>
              </>
            )}
          </For>
        </ol>
      </Show>
    </article>
  );
}

export default function RouteGuideResults(props: {
  readonly result: RouteGuideFound;
  readonly headingRef?: (element: HTMLHeadingElement) => void;
  readonly selectedAlternativeId?: string;
  readonly compact?: boolean;
  readonly onSelectAlternative?: (alternative: PassengerGuideAlternative) => void;
}) {
  const visibleAlternatives = () => {
    const indexed = props.result.alternatives.map((alternative, index) => ({
      alternative,
      index,
    }));
    if (!props.compact || props.selectedAlternativeId === undefined) return indexed;
    return indexed.filter(({ alternative }) => alternative.id === props.selectedAlternativeId);
  };
  return (
    <div {...stylex.props(styles.results)}>
      <Show when={!props.compact}>
        <h2 ref={props.headingRef} tabIndex={-1} {...stylex.props(styles.heading)}>
          Pilih rute bus
        </h2>
      </Show>
      <Show when={!props.compact}>
        <p {...stylex.props(styles.intro)}>
          Pilih rute untuk menampilkannya pada peta. Tidak ada perkiraan jadwal atau perjalanan
          kaki.
        </p>
      </Show>
      <ol aria-label="Pilihan rute bus" {...stylex.props(styles.alternatives)}>
        <For each={visibleAlternatives()}>
          {({ alternative, index }) => (
            <li>
              <GuideAlternativeCard
                alternative={alternative}
                index={index}
                selectedOriginLabel={props.result.origin.displayLabel}
                selectedDestinationLabel={props.result.destination.displayLabel}
                selected={props.selectedAlternativeId === alternative.id}
                compact={props.compact}
                onSelect={() => props.onSelectAlternative?.(alternative)}
              />
            </li>
          )}
        </For>
      </ol>
      <Show when={!props.compact}>
        <aside {...stylex.props(styles.coverage)}>
          <strong>Cakupan bus saja</strong>
          <span>{props.result.coverage.freshnessNote}</span>
          <details>
            <summary>Versi dan sumber data</summary>
            <p>
              Jaringan: {props.result.coverage.networkArtifactVersion}
              <br />
              Tempat: {props.result.coverage.placesArtifactVersion}
              <br />
              {props.result.coverage.attribution}
            </p>
          </details>
        </aside>
      </Show>
    </div>
  );
}

const styles = stylex.create({
  results: { marginTop: "0.35rem" },
  heading: { fontSize: "1rem", margin: "0.15rem 0" },
  intro: { fontSize: "0.74rem", margin: "0.2rem 0 0.55rem" },
  alternatives: { display: "grid", gap: "0.45rem", listStyle: "none", margin: 0, padding: 0 },
  card: { backgroundColor: "#fffdf5", border: "1px solid #152c3d" },
  selectedCard: { borderColor: "#e0442e", boxShadow: "3px 3px 0 #e0442e" },
  cardSelect: {
    backgroundColor: "transparent",
    border: 0,
    color: "inherit",
    cursor: "pointer",
    display: "block",
    padding: 0,
    textAlign: "left",
    width: "100%",
  },
  cardHeader: { display: "flex", flexDirection: "column", gap: "0.25rem", padding: "0.55rem" },
  optionLabel: {
    fontSize: "0.65rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  summaryBadges: { display: "flex", flexWrap: "wrap", gap: "0.3rem" },
  badges: { alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.3rem" },
  lineBadge: {
    alignItems: "center",
    backgroundColor: "#31556f",
    border: "1px solid #152c3d",
    borderRadius: "0.2rem",
    color: "#fff8e8",
    display: "inline-flex",
    fontSize: "0.72rem",
    fontWeight: 900,
    justifyContent: "center",
    minHeight: "1.8rem",
    minWidth: "1.8rem",
    paddingInline: "0.35rem",
  },
  orLabel: { fontSize: "0.7rem", fontWeight: 800 },
  decisionSummary: { fontSize: "0.75rem", margin: 0 },
  compactSummary: { fontSize: "0.78rem", fontWeight: 800, margin: 0 },
  connectorNote: {
    backgroundColor: "#e7e0cf",
    borderLeft: "3px solid #f5c542",
    fontSize: "0.72rem",
    margin: 0,
    padding: "0.45rem",
  },
  steps: { borderTop: "1px dashed #78909c", listStyle: "none", margin: 0, padding: "0.55rem" },
  rideStep: {
    display: "grid",
    gap: "0.55rem",
    gridTemplateColumns: "2rem minmax(0, 1fr)",
    paddingBottom: "0.8rem",
  },
  stepNumber: {
    alignItems: "center",
    backgroundColor: "#f5c542",
    border: "1px solid #152c3d",
    borderRadius: "50%",
    display: "flex",
    fontSize: "0.7rem",
    fontWeight: 900,
    height: "1.8rem",
    justifyContent: "center",
    width: "1.8rem",
  },
  stepBody: { minWidth: 0 },
  stepHeading: { fontSize: "0.85rem", margin: "0.45rem 0 0.2rem" },
  direction: { fontSize: "0.74rem", margin: 0 },
  details: { fontSize: "0.72rem", marginTop: "0.55rem" },
  platforms: { display: "grid", gridTemplateColumns: "5rem 1fr", marginBottom: "0.5rem" },
  lineDetail: { borderTop: "1px solid #d8d2c0", paddingTop: "0.4rem" },
  intermediateStops: { margin: "0.25rem 0 0", paddingLeft: "1.3rem" },
  transferStep: {
    backgroundColor: "#e7e0cf",
    borderLeft: "3px solid #e0442e",
    display: "flex",
    flexDirection: "column",
    fontSize: "0.74rem",
    gap: "0.2rem",
    margin: "0 0 0.8rem 2rem",
    padding: "0.6rem",
  },
  coverage: {
    backgroundColor: "#e7e0cf",
    border: "1px solid #78909c",
    display: "flex",
    flexDirection: "column",
    fontSize: "0.7rem",
    gap: "0.25rem",
    marginTop: "0.8rem",
    padding: "0.65rem",
  },
});
