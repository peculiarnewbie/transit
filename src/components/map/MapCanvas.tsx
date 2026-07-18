import "maplibre-gl/dist/maplibre-gl.css";

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import {
  AttributionControl,
  Map,
  NavigationControl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type GeoJSONSourceSpecification,
} from "maplibre-gl";
import * as stylex from "@stylexjs/stylex";

import type { Coordinate, EndpointKind, StopSuggestion } from "../../features/passenger/types.js";
import { endpointFeatureCollection, stopSuggestionFromMapFeature } from "./map-markers.js";

export interface MapCanvasProps {
  readonly styleUrl: string;
  readonly selectedJourneyId?: string;
  readonly selectedGeometry: ReadonlyArray<readonly [number, number]>;
  readonly selectedColor: string;
  readonly origin?: Coordinate;
  readonly destination?: Coordinate;
  readonly selectionKind?: EndpointKind;
  readonly onStopSelect: (stop: StopSuggestion) => void;
  readonly onReady: () => void;
  readonly onFailure: () => void;
}

const emptyGeometry: ReadonlyArray<readonly [number, number]> = [];
const overviewOpacity: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  10,
  0.24,
  14,
  0.5,
];
const fadedOverviewOpacity = 0.075;

const routeMapUrlFrom = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || !("routeMapUrl" in value)) return undefined;
  return typeof value.routeMapUrl === "string" ? value.routeMapUrl : undefined;
};

const loadRouteMap = async (): Promise<GeoJSONSourceSpecification["data"] | undefined> => {
  const response = await fetch("/artifacts/active.json", { cache: "no-store" });
  if (!response.ok) return undefined;
  const routeMapUrl = routeMapUrlFrom(await response.json());
  if (routeMapUrl === undefined) return undefined;
  const routeResponse = await fetch(new URL(routeMapUrl, response.url));
  if (!routeResponse.ok) return undefined;
  const routeMap: unknown = await routeResponse.json();
  if (
    typeof routeMap !== "object" ||
    routeMap === null ||
    !("type" in routeMap) ||
    routeMap.type !== "FeatureCollection"
  )
    return undefined;
  return routeMap as GeoJSONSourceSpecification["data"];
};

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
      map.addControl(new NavigationControl({ showCompass: false }), "top-right");
      readinessTimeout = setTimeout(() => {
        if (!ready) props.onFailure();
      }, 15_000);
      map.once("style.load", () => {
        if (map === undefined) return;
        void loadRouteMap()
          .then((routeMap) => {
            if (map === undefined || routeMap === undefined || map.getSource("network-routes"))
              return;
            map.addSource("network-routes", { type: "geojson", data: routeMap });
            map.addLayer(
              {
                id: "network-routes",
                type: "line",
                source: "network-routes",
                paint: {
                  "line-color": ["coalesce", ["get", "color"], "#31556f"],
                  "line-opacity":
                    props.selectedJourneyId === undefined ? overviewOpacity : fadedOverviewOpacity,
                  "line-opacity-transition": { duration: 260 },
                  "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.7, 14, 2.2],
                },
              },
              map.getLayer("selected-journey-shadow") === undefined
                ? undefined
                : "selected-journey-shadow",
            );
            const firstSelectedLayer = map.getLayer("selected-journey-shadow")?.id;
            map.addLayer(
              {
                id: "network-stops",
                type: "circle",
                source: "network-routes",
                minzoom: 14,
                filter: ["==", ["get", "kind"], "stop"],
                paint: {
                  "circle-color": props.selectionKind === undefined ? "#fff8e8" : "#f5c542",
                  "circle-opacity": props.selectionKind === undefined ? 0.55 : 0.95,
                  "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3.5, 17, 6],
                  "circle-stroke-color": "#152c3d",
                  "circle-stroke-width": 1.5,
                },
              },
              firstSelectedLayer,
            );
            map.addLayer(
              {
                id: "network-stop-labels",
                type: "symbol",
                source: "network-routes",
                minzoom: 15,
                filter: ["==", ["get", "kind"], "stop"],
                layout: {
                  "text-field": ["get", "name"],
                  "text-font": ["Noto Sans Regular"],
                  "text-size": 11,
                  "text-offset": [0, 1.15],
                  "text-anchor": "top",
                },
                paint: {
                  "text-color": "#152c3d",
                  "text-halo-color": "#fff8e8",
                  "text-halo-width": 1.5,
                },
              },
              firstSelectedLayer,
            );
            map.on("mouseenter", "network-stops", () => {
              if (map !== undefined && props.selectionKind !== undefined)
                map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", "network-stops", () => {
              if (map !== undefined) map.getCanvas().style.cursor = "";
            });
            map.on("click", "network-stops", (event) => {
              if (props.selectionKind === undefined) return;
              const stop = stopSuggestionFromMapFeature(event.features?.[0]);
              if (stop !== undefined) props.onStopSelect(stop);
            });
          })
          .catch(() => undefined);
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
          paint: { "line-color": props.selectedColor, "line-width": 5.5 },
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
    if (map?.getLayer("network-routes") !== undefined)
      map.setPaintProperty(
        "network-routes",
        "line-opacity",
        props.selectedJourneyId === undefined ? overviewOpacity : fadedOverviewOpacity,
      );
    if (map?.getLayer("selected-journey") !== undefined)
      map.setPaintProperty("selected-journey", "line-color", props.selectedColor);
  });

  createEffect(() => {
    const selectable = props.selectionKind !== undefined;
    if (map?.getLayer("network-stops") === undefined) return;
    map.setPaintProperty("network-stops", "circle-color", selectable ? "#f5c542" : "#fff8e8");
    map.setPaintProperty("network-stops", "circle-opacity", selectable ? 0.95 : 0.55);
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
