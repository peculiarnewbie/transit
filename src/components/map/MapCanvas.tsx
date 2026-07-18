import "maplibre-gl/dist/maplibre-gl.css";

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { AttributionControl, Map, type GeoJSONSource } from "maplibre-gl";
import * as stylex from "@stylexjs/stylex";

import type { Coordinate } from "../../features/passenger/types.js";
import { endpointFeatureCollection } from "./map-markers.js";

export interface MapCanvasProps {
  readonly styleUrl: string;
  readonly selectedJourneyId?: string;
  readonly selectedGeometry: ReadonlyArray<readonly [number, number]>;
  readonly origin?: Coordinate;
  readonly destination?: Coordinate;
  readonly onReady: () => void;
  readonly onFailure: () => void;
}

const emptyGeometry: ReadonlyArray<readonly [number, number]> = [];

export default function MapCanvas(props: MapCanvasProps) {
  const [container, setContainer] = createSignal<HTMLDivElement>();
  let map: Map | undefined;
  let ready = false;
  let readinessTimeout: ReturnType<typeof setTimeout> | undefined;

  const selectedCoordinates = () =>
    props.selectedJourneyId === undefined ? emptyGeometry : props.selectedGeometry;

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
      readinessTimeout = setTimeout(() => {
        if (!ready) props.onFailure();
      }, 15_000);
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
        map.addSource("selected-endpoints", {
          type: "geojson",
          data: endpointFeatureCollection({
            origin: props.origin,
            destination: props.destination,
          }),
        });
        map.addLayer({
          id: "selected-origin",
          type: "circle",
          source: "selected-endpoints",
          filter: ["==", ["get", "kind"], "origin"],
          paint: {
            "circle-color": "#fff8e8",
            "circle-radius": 8,
            "circle-stroke-color": "#e0442e",
            "circle-stroke-width": 5,
          },
        });
        map.addLayer({
          id: "selected-destination",
          type: "circle",
          source: "selected-endpoints",
          filter: ["==", ["get", "kind"], "destination"],
          paint: {
            "circle-color": "#152c3d",
            "circle-radius": 8,
            "circle-stroke-color": "#fff8e8",
            "circle-stroke-width": 4,
          },
        });
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) map.stop();
        ready = true;
        clearTimeout(readinessTimeout);
        props.onReady();
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

  createEffect(() => {
    const data = endpointFeatureCollection({
      origin: props.origin,
      destination: props.destination,
    });
    const source = map?.getSource<GeoJSONSource>("selected-endpoints");
    source?.setData(data);
  });

  onCleanup(() => {
    clearTimeout(readinessTimeout);
    map?.remove();
  });

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
