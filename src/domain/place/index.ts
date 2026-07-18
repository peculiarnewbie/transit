import { Effect, Schema } from "effect";

import {
  DuplicatePlaceId,
  DuplicateSourceIdentity,
  EmptyPlaceName,
  InvalidBounds,
  PassengerPlace,
  PassengerPlaceArtifact,
  UnusableCoordinate,
} from "./passenger-place.js";

export * from "./ids.js";
export * from "./passenger-place.js";

const sourceKey = (system: string, recordId: string) => `${system}\0${recordId}`;

/**
 * Decode a passenger-place artifact and reject duplicate IDs / source identities
 * with typed errors that retain record context.
 */
export const decodePassengerPlaceArtifact = Effect.fn("PassengerPlace.decodeArtifact")(function* (
  input: unknown,
) {
  const artifact = yield* Schema.decodeUnknownEffect(PassengerPlaceArtifact)(input);

  const seenIds = new Map<string, true>();
  const seenSources = new Map<string, string>();

  for (const place of artifact.places) {
    if (seenIds.has(place.id)) {
      return yield* Effect.fail(new DuplicatePlaceId({ placeId: place.id }));
    }
    seenIds.set(place.id, true);

    if (place.primaryName.trim() === "") {
      return yield* Effect.fail(new EmptyPlaceName({ placeId: place.id, recordContext: place.id }));
    }

    if (place.representativeLocation._tag === "Unplaced") {
      return yield* Effect.fail(
        new UnusableCoordinate({
          placeId: place.id,
          recordContext: place.id,
          reason: place.representativeLocation.reason,
        }),
      );
    }

    if (place.bounds !== undefined) {
      const { west, east, south, north } = place.bounds;
      if (!(west < east && south < north)) {
        return yield* Effect.fail(
          new InvalidBounds({
            placeId: place.id,
            recordContext: place.id,
            reason: "west < east and south < north required",
          }),
        );
      }
    }

    for (const ref of place.sourceRefs) {
      const key = sourceKey(ref.system, ref.recordId);
      const prior = seenSources.get(key);
      if (prior !== undefined && prior !== place.id) {
        return yield* Effect.fail(
          new DuplicateSourceIdentity({
            system: ref.system,
            recordId: ref.recordId,
            placeIds: [prior, place.id],
          }),
        );
      }
      seenSources.set(key, place.id);
    }
  }

  return artifact;
});

export const decodePassengerPlace = Effect.fn("PassengerPlace.decode")(function* (input: unknown) {
  return yield* Schema.decodeUnknownEffect(PassengerPlace)(input);
});
