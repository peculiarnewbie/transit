import { Duration, Effect, Schedule } from "effect";

import type { AcquisitionError } from "./errors.js";

const isRetryable = (error: AcquisitionError): boolean =>
  error._tag === "TrainImport.TransportError" ||
  error._tag === "TrainImport.RateLimitError" ||
  (error._tag === "TrainImport.RejectedStatusError" && error.status >= 500);

const retrySchedule: Schedule.Schedule<AcquisitionError, AcquisitionError> = Schedule.exponential(
  "100 millis",
).pipe(
  Schedule.setInputType<AcquisitionError>(),
  Schedule.upTo({ times: 3 }),
  Schedule.passthrough,
  Schedule.modifyDelay(({ input, duration }) =>
    Effect.succeed(
      input._tag === "TrainImport.RateLimitError" && input.retryAfterMs !== undefined
        ? Duration.max(duration, Duration.millis(input.retryAfterMs))
        : duration,
    ),
  ),
);

export const retryAcquisition = <A>(effect: Effect.Effect<A, AcquisitionError>) =>
  effect.pipe(Effect.retry({ schedule: retrySchedule, while: isRetryable }));
