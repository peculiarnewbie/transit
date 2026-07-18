import { Effect, Layer, ManagedRuntime, Schema } from "effect";

import { NetworkSnapshot } from "../domain/transit/index.js";
import { Router, RoutingIndex } from "../routing/index.js";
import { ArtifactStore, type LayerOptions } from "./artifact-store.js";
import { PlaceArtifactStore } from "./place-artifact-store.js";
import { RouteHelperQuery } from "./route-helper-query.js";
import { RouteQuery } from "./route-query.js";

const layerFromArtifacts = <E>(artifactLayer: Layer.Layer<ArtifactStore.Service, E>) => {
  const indexLayer = Layer.effect(
    RoutingIndex.Service,
    Effect.gen(function* () {
      const artifacts = yield* ArtifactStore.Service;
      const encodedSnapshot = yield* Schema.encodeUnknownEffect(NetworkSnapshot)(
        artifacts.snapshot,
      );
      return yield* RoutingIndex.make(encodedSnapshot);
    }),
  );
  const routerLayer = Layer.effect(Router.Service, Router.make).pipe(Layer.provide(indexLayer));
  const routingServices = Layer.merge(indexLayer, routerLayer);
  return RouteQuery.layer.pipe(Layer.provide(routingServices), Layer.provide(artifactLayer));
};

export const layer = (defaultManifestUrl: string) =>
  layerFromArtifacts(ArtifactStore.layerConfig(defaultManifestUrl));

export const layerWith = (options: LayerOptions) =>
  layerFromArtifacts(ArtifactStore.layer(options));

export interface HelperLayerOptions {
  readonly networkManifestUrl: string;
  readonly placesManifestUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly allowFixturePlaces?: boolean;
}

const helperServicesLayer = (options: HelperLayerOptions) => {
  const networkLayer = ArtifactStore.layer({
    manifestUrl: options.networkManifestUrl,
    fetch: options.fetch,
  });
  const placesLayer = options.allowFixturePlaces
    ? PlaceArtifactStore.layerAllowingFixtures({
        manifestUrl: options.placesManifestUrl,
        fetch: options.fetch,
      })
    : PlaceArtifactStore.layer({
        manifestUrl: options.placesManifestUrl,
        fetch: options.fetch,
      });
  const artifacts = Layer.merge(networkLayer, placesLayer);
  const helperLayer = Layer.unwrap(
    RouteHelperQuery.composeHelperLayers().pipe(Effect.provide(artifacts)),
  ).pipe(Layer.provide(artifacts));
  return helperLayer;
};

export const helperLayerWith = (options: HelperLayerOptions) => helperServicesLayer(options);

const makeRuntime = (manifestUrl: string, fetcher: typeof globalThis.fetch) =>
  ManagedRuntime.make(layerWith({ manifestUrl, fetch: fetcher }));
type ApplicationRuntime = ReturnType<typeof makeRuntime>;

const makeHelperRuntime = (options: HelperLayerOptions) =>
  ManagedRuntime.make(helperLayerWith(options));
type HelperRuntime = ReturnType<typeof makeHelperRuntime>;

// The Worker isolate owns one immutable application runtime for its lifecycle.
// It never contains request-scoped or user data.
let applicationRuntime: ApplicationRuntime | undefined;
let helperRuntime: HelperRuntime | undefined;

export const runtime = (
  manifestUrl: string,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): ApplicationRuntime => {
  applicationRuntime ??= makeRuntime(manifestUrl, fetcher);
  return applicationRuntime;
};

export const helperRuntimeFor = (options: HelperLayerOptions): HelperRuntime => {
  helperRuntime ??= makeHelperRuntime(options);
  return helperRuntime;
};

export const runJourneys = (
  manifestUrl: string,
  input: unknown,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
) =>
  runtime(manifestUrl, fetcher).runPromise(
    Effect.gen(function* () {
      const query = yield* RouteQuery.Service;
      return yield* query.journeys(input);
    }),
  );

export const runStopSearch = (
  manifestUrl: string,
  input: unknown,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
) =>
  runtime(manifestUrl, fetcher).runPromise(
    Effect.gen(function* () {
      const query = yield* RouteQuery.Service;
      return yield* query.searchStops(input);
    }),
  );

const defaultHelperOptions = (
  networkManifestUrl: string,
  placesManifestUrl: string,
  fetcher: typeof globalThis.fetch,
): HelperLayerOptions => ({
  networkManifestUrl,
  placesManifestUrl,
  fetch: fetcher,
});

export const runPlaceSearch = (
  networkManifestUrl: string,
  placesManifestUrl: string,
  input: unknown,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
) =>
  helperRuntimeFor(defaultHelperOptions(networkManifestUrl, placesManifestUrl, fetcher)).runPromise(
    Effect.gen(function* () {
      const query = yield* RouteHelperQuery.Service;
      return yield* query.searchPlaces(input);
    }),
  );

export const runNearbyTransit = (
  networkManifestUrl: string,
  placesManifestUrl: string,
  input: unknown,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
) =>
  helperRuntimeFor(defaultHelperOptions(networkManifestUrl, placesManifestUrl, fetcher)).runPromise(
    Effect.gen(function* () {
      const query = yield* RouteHelperQuery.Service;
      return yield* query.nearbyTransit(input);
    }),
  );

export const runRouteGuide = (
  networkManifestUrl: string,
  placesManifestUrl: string,
  input: unknown,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
) =>
  helperRuntimeFor(defaultHelperOptions(networkManifestUrl, placesManifestUrl, fetcher)).runPromise(
    Effect.gen(function* () {
      const query = yield* RouteHelperQuery.Service;
      return yield* query.guide(input);
    }),
  );

export const runArtifactVersions = (
  networkManifestUrl: string,
  placesManifestUrl: string,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
) =>
  helperRuntimeFor(defaultHelperOptions(networkManifestUrl, placesManifestUrl, fetcher)).runPromise(
    Effect.gen(function* () {
      const query = yield* RouteHelperQuery.Service;
      return yield* query.versions();
    }),
  );

export * as ApplicationRuntime from "./application.js";
