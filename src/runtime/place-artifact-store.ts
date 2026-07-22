import { Context, Effect, Layer, Schema } from "effect";

import {
  decodePassengerPlaceArtifact,
  type PassengerPlaceArtifact,
} from "../domain/place/index.js";
import { LoadError } from "./artifact-store.js";

export const PlaceArtifactManifest = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  version: Schema.String.check(Schema.isNonEmpty()),
  networkArtifactVersion: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  artifactUrl: Schema.String.check(Schema.isNonEmpty()),
  artifactChecksum: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  license: Schema.String.check(Schema.isNonEmpty()),
  attribution: Schema.String.check(Schema.isNonEmpty()),
  inputChecksum: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  outputChecksum: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
  placeCount: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export interface PlaceArtifactManifest extends Schema.Schema.Type<typeof PlaceArtifactManifest> {}

export interface PlaceArtifacts {
  readonly version: string;
  readonly networkArtifactVersion: string;
  readonly artifactChecksum: string;
  readonly attribution: string;
  readonly license: string;
  readonly artifact: PassengerPlaceArtifact;
}

export interface Interface extends PlaceArtifacts {}

export class Service extends Context.Service<Service, Interface>()("@transit/PlaceArtifactStore") {}

export interface LayerOptions {
  readonly manifestUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly onLoad?: (url: string) => void;
}

const parseJson = (text: string): unknown => JSON.parse(text);

const decodeJson = <A>(schema: Schema.ConstraintDecoder<A>, url: string, text: string) =>
  Effect.try({
    try: () => parseJson(text),
    catch: (error) => new LoadError({ url, reason: `Invalid JSON: ${String(error)}` }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError((error) =>
      error instanceof LoadError
        ? error
        : new LoadError({ url, reason: `Schema validation failed: ${String(error)}` }),
    ),
  );

const responseText = async (response: Response, url: string, maximumBytes: number) => {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes)
    throw new LoadError({ url, reason: `Artifact exceeds ${maximumBytes} bytes` });
  if (response.body === null) throw new LoadError({ url, reason: "Artifact body is missing" });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel("Artifact is too large");
      throw new LoadError({ url, reason: `Artifact exceeds ${maximumBytes} bytes` });
    }
    text += decoder.decode(next.value, { stream: true });
  }
  return text + decoder.decode();
};

const sha256 = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const readText = Effect.fn("PlaceArtifactStore.readText")(function* (
  fetcher: typeof globalThis.fetch,
  url: string,
  maximumBytes: number,
  onLoad?: (url: string) => void,
) {
  onLoad?.(url);
  const response = yield* Effect.tryPromise({
    try: () => fetcher(url),
    catch: (error) => new LoadError({ url, reason: `Fetch failed: ${String(error)}` }),
  });
  if (!response.ok)
    return yield* Effect.fail(
      new LoadError({ url, reason: `Artifact returned HTTP ${response.status}` }),
    );
  return yield* Effect.tryPromise({
    try: () => responseText(response, url, maximumBytes),
    catch: (error) =>
      error instanceof LoadError
        ? error
        : new LoadError({ url, reason: `Body read failed: ${String(error)}` }),
  });
});

export const load = Effect.fn("PlaceArtifactStore.load")(function* (options: LayerOptions) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const manifestText = yield* readText(fetcher, options.manifestUrl, 65_536, options.onLoad);
  const manifest = yield* decodeJson(PlaceArtifactManifest, options.manifestUrl, manifestText);
  if (manifest.networkArtifactVersion === undefined || manifest.artifactChecksum === undefined) {
    return yield* Effect.fail(
      new LoadError({
        url: options.manifestUrl,
        reason: "Production place manifest is missing compatibility or checksum metadata",
      }),
    );
  }
  const artifactUrl = new URL(manifest.artifactUrl, options.manifestUrl).href;
  const artifactText = yield* readText(fetcher, artifactUrl, 16 * 1024 * 1024, options.onLoad);
  const artifactChecksum = yield* Effect.promise(() => sha256(artifactText));
  if (artifactChecksum !== manifest.artifactChecksum) {
    return yield* Effect.fail(
      new LoadError({
        url: artifactUrl,
        reason: `Checksum mismatch: expected ${manifest.artifactChecksum}, received ${artifactChecksum}`,
      }),
    );
  }
  const raw = yield* Effect.try({
    try: () => parseJson(artifactText),
    catch: (error) => new LoadError({ url: artifactUrl, reason: `Invalid JSON: ${String(error)}` }),
  });
  const artifact = yield* decodePassengerPlaceArtifact(raw).pipe(
    Effect.mapError(
      (error) =>
        new LoadError({
          url: artifactUrl,
          reason: `Place artifact validation failed: ${String(error)}`,
        }),
    ),
  );
  if (artifact.artifactVersion !== manifest.version) {
    return yield* Effect.fail(
      new LoadError({
        url: options.manifestUrl,
        reason: `Place manifest version ${manifest.version} does not match artifact ${artifact.artifactVersion}`,
      }),
    );
  }
  if (
    manifest.version.includes("fixture") ||
    manifest.version.includes("demo") ||
    artifact.artifactVersion.includes("fixture") ||
    artifact.artifactVersion.includes("demo")
  ) {
    return yield* Effect.fail(
      new LoadError({
        url: options.manifestUrl,
        reason: `Production place runtime rejected demo/fixture artifact ${manifest.version}`,
      }),
    );
  }
  return Service.of({
    version: manifest.version,
    networkArtifactVersion: manifest.networkArtifactVersion,
    artifactChecksum: manifest.artifactChecksum,
    attribution: manifest.attribution,
    license: manifest.license,
    artifact,
  });
});

export const layer = (options: LayerOptions): Layer.Layer<Service, LoadError> =>
  Layer.effect(Service, load(options));

/** Test-only loader that allows fixture artifacts. */
export const loadAllowingFixtures = Effect.fn("PlaceArtifactStore.loadAllowingFixtures")(function* (
  options: LayerOptions,
) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const manifestText = yield* readText(fetcher, options.manifestUrl, 65_536, options.onLoad);
  const manifest = yield* decodeJson(PlaceArtifactManifest, options.manifestUrl, manifestText);
  const artifactUrl = new URL(manifest.artifactUrl, options.manifestUrl).href;
  const artifactText = yield* readText(fetcher, artifactUrl, 16 * 1024 * 1024, options.onLoad);
  const raw = yield* Effect.try({
    try: () => parseJson(artifactText),
    catch: (error) => new LoadError({ url: artifactUrl, reason: `Invalid JSON: ${String(error)}` }),
  });
  const artifact = yield* decodePassengerPlaceArtifact(raw).pipe(
    Effect.mapError(
      (error) =>
        new LoadError({
          url: artifactUrl,
          reason: `Place artifact validation failed: ${String(error)}`,
        }),
    ),
  );
  return Service.of({
    version: manifest.version,
    networkArtifactVersion: manifest.networkArtifactVersion ?? "fixture-network",
    artifactChecksum: manifest.artifactChecksum ?? "fixture-checksum",
    attribution: manifest.attribution,
    license: manifest.license,
    artifact,
  });
});

export const layerAllowingFixtures = (options: LayerOptions): Layer.Layer<Service, LoadError> =>
  Layer.effect(Service, loadAllowingFixtures(options));

export * as PlaceArtifactStore from "./place-artifact-store.js";
