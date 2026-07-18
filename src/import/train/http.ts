import { Context, Effect, Layer } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";

import {
  type AcquisitionError,
  RateLimitError,
  RejectedStatusError,
  TransportError,
} from "./errors.js";
import type { TrainSystem } from "./model.js";

export interface RequestContext {
  readonly operation: string;
  readonly system: TrainSystem;
  readonly url: string;
}

export interface Interface {
  readonly getJson: (context: RequestContext) => Effect.Effect<unknown, AcquisitionError>;
  readonly getText: (context: RequestContext) => Effect.Effect<string, AcquisitionError>;
}

export class Service extends Context.Service<Service, Interface>()("@transit/TrainSourceHttp") {}

const retryAfterMs = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1_000));
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
};

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const request = Effect.fn("TrainSourceHttp.request")(function* (context: RequestContext) {
      const response = yield* client
        .get(context.url, { headers: { accept: "*/*", "user-agent": "transit-source-import/1" } })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TransportError({
                operation: context.operation,
                system: context.system,
                source: context.url,
                cause,
              }),
          ),
        );
      if (response.status === 429) {
        return yield* new RateLimitError({
          operation: context.operation,
          system: context.system,
          source: context.url,
          ...(retryAfterMs(response.headers["retry-after"]) === undefined
            ? {}
            : { retryAfterMs: retryAfterMs(response.headers["retry-after"]) }),
        });
      }
      if (response.status < 200 || response.status >= 300) {
        return yield* new RejectedStatusError({
          operation: context.operation,
          system: context.system,
          source: context.url,
          status: response.status,
        });
      }
      return response;
    });

    return Service.of({
      getJson: Effect.fn("TrainSourceHttp.getJson")(function* (context) {
        const response = yield* request(context);
        return yield* response.json.pipe(
          Effect.mapError(
            (cause) =>
              new TransportError({
                operation: context.operation,
                system: context.system,
                source: context.url,
                cause,
              }),
          ),
        );
      }),
      getText: Effect.fn("TrainSourceHttp.getText")(function* (context) {
        const response = yield* request(context);
        return yield* response.text.pipe(
          Effect.mapError(
            (cause) =>
              new TransportError({
                operation: context.operation,
                system: context.system,
                source: context.url,
                cause,
              }),
          ),
        );
      }),
    });
  }),
);

export * as TrainSourceHttp from "./http.js";
