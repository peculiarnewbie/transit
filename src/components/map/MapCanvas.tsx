import "maplibre-gl/dist/maplibre-gl.css";

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { AttributionControl, Map, type GeoJSONSource } from "maplibre-gl";
import * as stylex from "@stylexjs/stylex";

import type { Coordinate } from "../../features/passenger/types.js";
import { journeyGeometry } from "./map-geometry.js";

export interface MapCanvasProps {
  readonly styleUrl: string;
  readonly selectedJourneyId?: string;
  readonly onMapEndpoint: (coordinate: Coordinate) => void;
  readonly onReady: () => void;
  readonly onFailure: () => void;
}

const emptyGeometry: ReadonlyArray<readonly [number, number]> = [];

export default function MapCanvas(props: MapCanvasProps) {
  const [container, setContainer] = createSignal<HTMLDivElement>();
  let map: Map | undefined;
  let ready = false;

  const selectedCoordinates = () =>
    props.selectedJourneyId === undefined
      ? emptyGeometry
      : (journeyGeometry[props.selectedJourneyId] ?? emptyGeometry);

  onMount(() => {
    const mapContainer = container();
    if (mapContainer === undefined) return;

    try {
      map = new Map({
        container: mapContainer,
        style: props.styleUrl,
        center: [106.827, -6.205],
        zoom: 12.2,
        minZoom: 10,
        maxZoom: 18,
        maxBounds: [
          [106.68, -6.38],
          [107.02, -6.05],
        ],
        renderWorldCopies: false,
        pitch: 0,
        maxPitch: 0,
        pitchWithRotate: false,
        dragRotate: false,
        canvasContextAttributes: { antialias: false },
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        attributionControl: false,
      });
      map.addControl(new AttributionControl({ compact: true }), "bottom-right");
      map.once("style.load", () => {
        if (map === undefined) return;
        map.addSource("selected-journey", {
          type: "geojson",
          data: lineFeature(selectedCoordinates()),
        });
        map.addLayer({
          id: "selected-journey-shadow",
          type: "line",
          source: "selected-journey",
          paint: { "line-color": "#fff8e8", "line-width": 8, "line-opacity": 0.9 },
        });
        map.addLayer({
          id: "selected-journey",
          type: "line",
          source: "selected-journey",
          paint: { "line-color": "#e0442e", "line-width": 4 },
        });
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) map.stop();
        ready = true;
        props.onReady();
      });
      map.on("click", (event) =>
        props.onMapEndpoint({ longitude: event.lngLat.lng, latitude: event.lngLat.lat }),
      );
      map.on("error", () => {
        if (!ready) props.onFailure();
      });
    } catch {
      props.onFailure();
    }
  });

  createEffect(() => {
    const coordinates = selectedCoordinates();
    const source = map?.getSource<GeoJSONSource>("selected-journey");
    source?.setData(lineFeature(coordinates));
  });

  onCleanup(() => map?.remove());

  return (
    <div
      ref={setContainer}
      aria-label="Interactive Jakarta route map"
      {...stylex.props(styles.canvas)}
    />
  );
}

const lineFeature = (coordinates: ReadonlyArray<readonly [number, number]>) => ({
  type: "Feature" as const,
  properties: {},
  geometry: {
    type: "LineString" as const,
    coordinates: coordinates.map(([longitude, latitude]) => [longitude, latitude]),
  },
});

const styles = stylex.create({
  canvas: {
    height: "100%",
    minHeight: "18rem",
    width: "100%",
  },
});
