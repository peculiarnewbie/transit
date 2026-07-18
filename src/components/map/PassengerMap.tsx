import { lazy, onMount, Show, Suspense, createSignal } from "solid-js";
import * as stylex from "@stylexjs/stylex";

import type { Coordinate } from "../../features/passenger/types.js";

const LazyMapCanvas = lazy(() => import("./MapCanvas.js"));

export interface PassengerMapProps {
  readonly styleUrl: string;
  readonly selectedJourneyId?: string;
  readonly selectedGeometry: ReadonlyArray<readonly [number, number]>;
  readonly origin?: Coordinate;
  readonly destination?: Coordinate;
}

export default function PassengerMap(props: PassengerMapProps) {
  const [mounted, setMounted] = createSignal(false);
  const [status, setStatus] = createSignal<"loading" | "ready" | "failed">("loading");

  onMount(() => setMounted(true));

  return (
    <section aria-label="Route map" {...stylex.props(styles.frame)}>
      <Show when={status() !== "ready"}>
        <div role="status" {...stylex.props(styles.placeholder)}>
          <span {...stylex.props(styles.mapMark)}>JKT</span>
          <strong>{status() === "failed" ? "Map unavailable" : "Loading street map…"}</strong>
          <span>Your route details remain available in the journey sheet.</span>
        </div>
      </Show>
      <Show when={mounted()}>
        <Suspense>
          <LazyMapCanvas
            styleUrl={props.styleUrl}
            selectedJourneyId={props.selectedJourneyId}
            selectedGeometry={props.selectedGeometry}
            origin={props.origin}
            destination={props.destination}
            onReady={() => setStatus("ready")}
            onFailure={() => setStatus("failed")}
          />
        </Suspense>
      </Show>
      <p {...stylex.props(styles.attribution)}>
        © OpenStreetMap contributors · Selected stops appear on the map
      </p>
    </section>
  );
}

const styles = stylex.create({
  frame: {
    backgroundColor: "#d8d2c0",
    border: "1px solid #152c3d",
    flex: 1,
    minHeight: "18rem",
    overflow: "hidden",
    position: "relative",
  },
  placeholder: {
    alignItems: "center",
    backgroundColor: "#d8d2c0",
    backgroundImage:
      "linear-gradient(#b8b4a6 1px, transparent 1px), linear-gradient(90deg, #b8b4a6 1px, transparent 1px)",
    backgroundSize: "32px 32px",
    color: "#152c3d",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    inset: 0,
    justifyContent: "center",
    padding: "2rem",
    position: "absolute",
    textAlign: "center",
    zIndex: 2,
  },
  mapMark: {
    alignItems: "center",
    backgroundColor: "#f5c542",
    border: "2px solid #152c3d",
    borderRadius: "50%",
    display: "flex",
    fontSize: "0.7rem",
    fontWeight: 900,
    height: "3rem",
    justifyContent: "center",
    letterSpacing: "0.1em",
    width: "3rem",
  },
  attribution: {
    backgroundColor: "rgba(255, 248, 232, 0.9)",
    bottom: 0,
    color: "#152c3d",
    fontSize: "0.68rem",
    left: 0,
    margin: 0,
    padding: "0.35rem 0.5rem",
    position: "absolute",
    zIndex: 3,
  },
});
