import { Effect, Layer, ManagedRuntime, Schema } from "effect";

import { NetworkSnapshot } from "../domain/transit/index.js";
import { Router, RoutingIndex } from "../routing/index.js";
import { ArtifactStore, type LayerOptions } from "./artifact-store.js";
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

const makeRuntime = (manifestUrl: string, fetcher: typeof globalThis.fetch) =>
  ManagedRuntime.make(layerWith({ manifestUrl, fetch: fetcher }));
type ApplicationRuntime = ReturnType<typeof makeRuntime>;

// The Worker isolate owns one immutable application runtime for its lifecycle.
// It never contains request-scoped or user data.
let applicationRuntime: ApplicationRuntime | undefined;

export const runtime = (
  manifestUrl: string,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): ApplicationRuntime => {
  applicationRuntime ??= makeRuntime(manifestUrl, fetcher);
  return applicationRuntime;
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

export * as ApplicationRuntime from "./application.js";
