import { Context, DateTime, Effect, Layer, Schema } from "effect";

import {
  type MatchEvidence,
  type PassengerPlace,
  type PassengerPlaceArtifact,
  type PassengerPlaceId,
  type PassengerPlaceSearchResult,
  PassengerPlaceArtifact as PassengerPlaceArtifactSchema,
  decodePassengerPlaceArtifact,
} from "../../domain/place/index.js";
import type { TransitPlace, TransitPlaceIndex } from "../transit/transit-place.js";
import {
  compactSearchText,
  normalizeSearchText,
  tokenize,
  tokensAreOrderedPrefixes,
} from "./normalize.js";
import { generatePassengerAliases } from "./transit-aliases.js";
import {
  NearbyTransitOutcome,
  NearbyTransitQuery,
  PlaceDiscoveryFailure,
  PlaceSearchOutcome,
  PlaceSearchQuery,
} from "./model.js";

const EARTH_RADIUS_METERS = 6_371_000;

export const haversineMeters = (
  a: { readonly latitude: number; readonly longitude: number },
  b: { readonly latitude: number; readonly longitude: number },
): number => {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Distance to point, or to nearest edge of bounds when the point is outside. */
export const geographicDistanceMeters = (input: {
  readonly origin: { readonly latitude: number; readonly longitude: number };
  readonly target: { readonly latitude: number; readonly longitude: number };
  readonly bounds?:
    | {
        readonly west: number;
        readonly south: number;
        readonly east: number;
        readonly north: number;
      }
    | undefined;
}): number => {
  const { origin, target, bounds } = input;
  if (bounds === undefined) {
    return haversineMeters(origin, target);
  }
  const inside =
    origin.longitude >= bounds.west &&
    origin.longitude <= bounds.east &&
    origin.latitude >= bounds.south &&
    origin.latitude <= bounds.north;
  if (inside) return 0;
  const clamped = {
    longitude: Math.min(bounds.east, Math.max(bounds.west, origin.longitude)),
    latitude: Math.min(bounds.north, Math.max(bounds.south, origin.latitude)),
  };
  return haversineMeters(origin, clamped);
};

const resultKind = (place: PassengerPlace): PassengerPlaceSearchResult["resultKind"] => {
  if (place._tag === "Area") return "Area";
  if (place._tag === "Landmark") return "Landmark";
  return "TransitPlace";
};

const disambiguatingContext = (place: PassengerPlace): string => {
  const kind =
    place._tag === "Area"
      ? place.areaKind
      : place._tag === "Landmark"
        ? place.landmarkKind
        : "Transit place";
  return `${kind} · ${place.locality.municipality}`;
};

const placedCoordinate = (place: PassengerPlace) => {
  if (place.representativeLocation._tag !== "Placed") return undefined;
  return {
    latitude: place.representativeLocation.latitude,
    longitude: place.representativeLocation.longitude,
  };
};

interface RankedHit {
  readonly result: PassengerPlaceSearchResult;
  readonly rankScore: number;
  readonly nameKey: string;
  readonly placeId: string;
}

const scorePlace = (input: {
  readonly place: PassengerPlace;
  readonly queryNormalized: string;
  readonly queryTokens: ReadonlyArray<string>;
  readonly bias?: { readonly latitude: number; readonly longitude: number };
}): RankedHit | undefined => {
  const { place, queryNormalized, queryTokens, bias } = input;
  if (queryNormalized === "") return undefined;

  const primary = normalizeSearchText(place.primaryName);
  const primaryCompact = compactSearchText(primary);
  const queryCompact = compactSearchText(queryNormalized);
  const localityNormalized = normalizeSearchText(
    [place.locality.municipality, place.locality.adminDistrict, place.locality.neighbourhood]
      .filter((value): value is string => value !== undefined)
      .join(" "),
  );
  const localityTokens = new Set(tokenize(localityNormalized));
  const aliasNormalized = place.aliases.map((alias) => ({
    alias,
    normalized: normalizeSearchText(alias),
    compact: compactSearchText(normalizeSearchText(alias)),
  }));

  const evidence: MatchEvidence[] = [];
  let score = 0;
  let matchedAlias: string | undefined;
  let displayLabel = place.primaryName;

  const tokensMatchName = (nameNormalized: string) => {
    const nameTokens = tokenize(nameNormalized);
    const nameTokenSet = new Set(nameTokens);
    if (tokensAreOrderedPrefixes(queryTokens, nameTokens)) return "prefix";
    const leftover = queryTokens.filter(
      (token) => !nameTokenSet.has(token) && !localityTokens.has(token),
    );
    const covered = queryTokens.length - leftover.length;
    if (leftover.length === 0 && covered > 0) return "all";
    // Allow initialism alias + locality: query [ui, depok] vs name [universitas, indonesia] + loc depok
    return undefined;
  };

  if (
    primary === queryNormalized ||
    (queryCompact.length >= 3 && primaryCompact === queryCompact)
  ) {
    evidence.push({ _tag: "ExactPrimaryName" });
    score += 1000;
  } else {
    const exactAlias = aliasNormalized.find(
      (entry) =>
        entry.normalized === queryNormalized ||
        (queryCompact.length >= 3 && entry.compact === queryCompact),
    );
    if (exactAlias !== undefined) {
      evidence.push({ _tag: "ExactAlias", alias: exactAlias.alias });
      matchedAlias = exactAlias.alias;
      // Prefer a multi-word passenger label over an initialism for display.
      if (
        (exactAlias.normalized === queryNormalized || exactAlias.compact === queryCompact) &&
        (/\s/.test(exactAlias.alias) || !/^[A-Za-z]{2,6}$/.test(exactAlias.alias))
      ) {
        displayLabel = exactAlias.alias;
      }
      score += 900;
    } else if (primary.startsWith(queryNormalized) && queryNormalized.length >= 2) {
      evidence.push({ _tag: "Prefix", matchedText: place.primaryName });
      score += 700 + Math.min(50, queryNormalized.length);
    } else {
      const aliasPrefix = aliasNormalized.find(
        (entry) => entry.normalized.startsWith(queryNormalized) && queryNormalized.length >= 2,
      );
      if (aliasPrefix !== undefined) {
        evidence.push({ _tag: "Prefix", matchedText: aliasPrefix.alias });
        matchedAlias = aliasPrefix.alias;
        displayLabel = aliasPrefix.alias;
        score += 650;
      } else if (queryTokens.length > 0) {
        const primaryMatch = tokensMatchName(primary);
        if (primaryMatch !== undefined) {
          evidence.push({ _tag: "Token", tokens: [...queryTokens] });
          score += (primaryMatch === "prefix" ? 500 : 420) + queryTokens.length * 20;
        } else {
          for (const entry of aliasNormalized) {
            // Initialism or short alias plus locality tokens: "UI Depok", "JIS Jakarta".
            const aliasTokens = new Set(tokenize(entry.normalized));
            aliasTokens.add(entry.normalized);
            const leftover = queryTokens.filter(
              (token) => !aliasTokens.has(token) && !localityTokens.has(token),
            );
            const hitAlias = queryTokens.some((token) => aliasTokens.has(token));
            if (hitAlias && leftover.length === 0) {
              evidence.push({ _tag: "Token", tokens: [...queryTokens] });
              matchedAlias = entry.alias;
              if (!/^[A-Za-z]{2,6}$/.test(entry.alias)) {
                displayLabel = entry.alias;
              }
              score += 460 + queryTokens.length * 20;
              break;
            }
            if (tokensAreOrderedPrefixes(queryTokens, tokenize(entry.normalized))) {
              evidence.push({ _tag: "Token", tokens: [...queryTokens] });
              matchedAlias = entry.alias;
              displayLabel = entry.alias;
              score += 480 + queryTokens.length * 20;
              break;
            }
          }
        }
      }
    }
  }

  // Abbreviation evidence when normalization changed the surface form.
  const rawFolded = place.primaryName.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (score > 0 && rawFolded !== primary && primary.includes(queryNormalized)) {
    evidence.push({
      _tag: "Abbreviation",
      ruleId: "normalized-token",
      matchedText: place.primaryName,
    });
    score += 15;
  }

  if (score === 0) return undefined;

  const coordinate = placedCoordinate(place);
  if (bias !== undefined && coordinate !== undefined) {
    const distance = haversineMeters(bias, coordinate);
    evidence.push({ _tag: "CoordinateBias", geographicDistanceMeters: distance });
    // Soft bias: never outrank a strong textual match elsewhere.
    score += Math.max(0, 80 - Math.min(80, distance / 250));
  }

  // Prefer transit places slightly when scores otherwise tie on exact names.
  if (place._tag === "TransitPlaceReference") score += 5;
  if (place._tag === "Landmark") score += 2;

  return {
    placeId: place.id,
    nameKey: primary,
    rankScore: score,
    result: {
      placeId: place.id,
      displayLabel,
      disambiguatingContext: disambiguatingContext(place),
      ...(matchedAlias === undefined ? {} : { matchedAlias }),
      resultKind: resultKind(place),
      representativeLocation: place.representativeLocation,
      ...(place.bounds === undefined ? {} : { bounds: place.bounds }),
      ...(place._tag === "TransitPlaceReference" ? { transitPlaceId: place.transitPlaceId } : {}),
      matchEvidence: evidence,
      rankScore: score,
    },
  };
};

const compareHits = (left: RankedHit, right: RankedHit) => {
  if (right.rankScore !== left.rankScore) return right.rankScore - left.rankScore;
  const byName = left.nameKey.localeCompare(right.nameKey);
  if (byName !== 0) return byName;
  return left.placeId.localeCompare(right.placeId);
};

export interface PassengerPlaceDiscovery {
  readonly search: (input: unknown) => Effect.Effect<PlaceSearchOutcome, PlaceDiscoveryFailure>;
  readonly nearbyTransit: (
    input: unknown,
    transitIndex: TransitPlaceIndex,
  ) => Effect.Effect<NearbyTransitOutcome, PlaceDiscoveryFailure>;
}

export class Service extends Context.Service<Service, PassengerPlaceDiscovery>()(
  "@transit/PassengerPlaceDiscovery",
) {}

const transitPlaceAsPassenger = (
  place: TransitPlace,
  artifactVersion: string,
  retrievedAt: string,
): PassengerPlace => ({
  _tag: "TransitPlaceReference",
  id: `place:transit-ref:${place.id}` as PassengerPlaceId,
  primaryName: place.primaryName,
  aliases: [...new Set([...place.aliases, ...generatePassengerAliases(place.primaryName)])].sort(
    (a, b) => a.localeCompare(b),
  ),
  locality: { municipality: "Jakarta" },
  representativeLocation: place.representativeLocation,
  sourceRefs: [
    {
      system: "transit-place",
      recordId: place.id as never,
      retrievedAt: DateTime.makeUnsafe(retrievedAt),
      source: artifactVersion,
      classification: place.groupingEvidence._tag,
    },
  ],
  artifactVersion,
  transitPlaceId: place.id,
});

export const make = Effect.fn("PassengerPlaceDiscovery.make")(function* (options: {
  readonly artifact: unknown;
  readonly transitIndex?: TransitPlaceIndex;
  readonly retrievedAt?: string;
}) {
  // Encode first when given a decoded artifact so DateTime fields become ISO strings.
  const rawInput = yield* Schema.encodeUnknownEffect(PassengerPlaceArtifactSchema)(
    options.artifact as PassengerPlaceArtifact,
  ).pipe(Effect.orElseSucceed(() => options.artifact));
  const artifact = yield* decodePassengerPlaceArtifact(rawInput).pipe(
    Effect.mapError(
      (error) =>
        new PlaceDiscoveryFailure({
          reason: `Place artifact decode failed: ${String(error)}`,
        }),
    ),
  );

  const retrievedAt = options.retrievedAt ?? "2026-06-30T00:00:00.000Z";
  const geographicPlaces = artifact.places.filter(
    (place) => place._tag !== "TransitPlaceReference",
  );
  const transitPlaces =
    options.transitIndex === undefined
      ? artifact.places.filter((place) => place._tag === "TransitPlaceReference")
      : Object.values(options.transitIndex.placesById).map((place) =>
          transitPlaceAsPassenger(place, options.transitIndex!.sourceArtifactVersion, retrievedAt),
        );

  // Index transit places once at primary search level (Plan 013 grouping preserved).
  const places: ReadonlyArray<PassengerPlace> = [...geographicPlaces, ...transitPlaces];
  const placesById = new Map(places.map((place) => [place.id, place]));

  const search = Effect.fn("PassengerPlaceDiscovery.search")(function* (input: unknown) {
    const query = yield* Schema.decodeUnknownEffect(PlaceSearchQuery)(input).pipe(
      Effect.mapError(
        (error) => new PlaceDiscoveryFailure({ reason: `Invalid search query: ${String(error)}` }),
      ),
    );
    const queryNormalized = normalizeSearchText(query.text);
    if (queryNormalized === "") {
      return { _tag: "NoMatch" as const, queryText: query.text };
    }
    const queryTokens = tokenize(queryNormalized);

    const collectHits = (normalized: string, tokens: ReadonlyArray<string>) => {
      const hits: RankedHit[] = [];
      for (const place of places) {
        const hit = scorePlace({
          place,
          queryNormalized: normalized,
          queryTokens: tokens,
          bias: query.biasCoordinate,
        });
        if (hit !== undefined) hits.push(hit);
      }
      return hits;
    };

    let hits = collectHits(queryNormalized, queryTokens);

    // If the query is "Jl. …" / "St. …" and that form misses, retry without the
    // leading thoroughfare/station token so "St. Bundaran HI" still finds the stop.
    if (hits.length === 0 && queryTokens.length >= 2) {
      const head = queryTokens[0];
      if (head === "jalan" || head === "stasiun" || head === "pasar" || head === "kampus") {
        const restTokens = queryTokens.slice(1);
        const rest = restTokens.join(" ");
        hits = collectHits(rest, restTokens).map((hit) => ({
          ...hit,
          rankScore: hit.rankScore - 25,
          result: {
            ...hit.result,
            rankScore: hit.result.rankScore - 25,
            matchEvidence: [
              ...hit.result.matchEvidence,
              {
                _tag: "Abbreviation" as const,
                ruleId: `leading-${head}`,
                matchedText: query.text,
              },
            ],
          },
        }));
      }
    }

    // For strong Area hits, also surface nearby landmarks so neighbourhood
    // queries stay passenger-ambiguous (e.g. Senayan → Gelora Bung Karno).
    const areaHits = hits.filter((hit) => hit.result.resultKind === "Area" && hit.rankScore >= 900);
    const nearbyLandmarkRadiusMeters = 1_500;
    for (const areaHit of areaHits) {
      if (areaHit.result.representativeLocation._tag !== "Placed") continue;
      const origin = {
        latitude: areaHit.result.representativeLocation.latitude,
        longitude: areaHit.result.representativeLocation.longitude,
      };
      for (const place of places) {
        if (place._tag !== "Landmark") continue;
        if (place.representativeLocation._tag !== "Placed") continue;
        const target = {
          latitude: place.representativeLocation.latitude,
          longitude: place.representativeLocation.longitude,
        };
        const distance = haversineMeters(origin, target);
        const bounds = areaHit.result.bounds;
        const insideBounds =
          bounds !== undefined &&
          target.longitude >= bounds.west &&
          target.longitude <= bounds.east &&
          target.latitude >= bounds.south &&
          target.latitude <= bounds.north;
        const within = insideBounds || distance <= nearbyLandmarkRadiusMeters;
        if (!within) continue;
        if (hits.some((hit) => hit.placeId === place.id)) continue;
        hits.push({
          placeId: place.id,
          nameKey: normalizeSearchText(place.primaryName),
          rankScore: 820 - Math.min(120, distance / 10),
          result: {
            placeId: place.id,
            displayLabel: place.primaryName,
            disambiguatingContext: disambiguatingContext(place),
            resultKind: "Landmark",
            representativeLocation: place.representativeLocation,
            ...(place.bounds === undefined ? {} : { bounds: place.bounds }),
            matchEvidence: [
              {
                _tag: "CoordinateBias" as const,
                geographicDistanceMeters: distance,
              },
            ],
            rankScore: 820 - Math.min(120, distance / 10),
          },
        });
      }
    }

    hits.sort(compareHits);
    // Deduplicate by transitPlaceId / placeId keeping best rank.
    const seen = new Set<string>();
    const deduped: RankedHit[] = [];
    for (const hit of hits) {
      const key = hit.result.transitPlaceId ?? hit.placeId;
      if (seen.has(key)) continue;
      // Also collapse identical display labels at primary rank for transit places.
      const labelKey = `${hit.result.resultKind}:${hit.result.displayLabel.toLowerCase()}`;
      if (seen.has(labelKey)) continue;
      seen.add(key);
      seen.add(labelKey);
      deduped.push(hit);
    }

    const results = deduped.slice(0, query.limit).map((hit) => hit.result);
    if (results.length === 0) {
      return { _tag: "NoMatch" as const, queryText: query.text };
    }
    return { _tag: "Matches" as const, results };
  });

  const nearbyTransit = Effect.fn("PassengerPlaceDiscovery.nearbyTransit")(function* (
    input: unknown,
    transitIndex: TransitPlaceIndex,
  ) {
    const query = yield* Schema.decodeUnknownEffect(NearbyTransitQuery)(input).pipe(
      Effect.mapError(
        (error) => new PlaceDiscoveryFailure({ reason: `Invalid nearby query: ${String(error)}` }),
      ),
    );

    let origin = query.coordinate;
    let bounds = query.bounds;
    if (query.placeId !== undefined) {
      const place = placesById.get(query.placeId);
      if (place === undefined) {
        return yield* Effect.fail(
          new PlaceDiscoveryFailure({ reason: `Unknown place id: ${query.placeId}` }),
        );
      }
      const coordinate = placedCoordinate(place);
      if (coordinate === undefined) {
        return yield* Effect.fail(
          new PlaceDiscoveryFailure({
            reason: `Place ${query.placeId} has no usable coordinate`,
          }),
        );
      }
      origin = coordinate;
      bounds = place.bounds ?? bounds;
    }
    if (origin === undefined) {
      return yield* Effect.fail(
        new PlaceDiscoveryFailure({ reason: "nearbyTransit requires placeId or coordinate" }),
      );
    }

    const scored = Object.values(transitIndex.placesById).flatMap((place) => {
      if (place.representativeLocation._tag !== "Placed") return [];
      const target = {
        latitude: place.representativeLocation.latitude,
        longitude: place.representativeLocation.longitude,
      };
      const distance = geographicDistanceMeters({
        origin: origin!,
        target,
        bounds,
      });
      if (distance > query.radiusMeters) return [];
      return [
        {
          transitPlaceId: place.id,
          primaryName: place.primaryName,
          geographicDistanceMeters: distance,
          servedRouteIds: place.servedRouteIds.map(String),
          selectionEvidence: [
            `geographicDistanceMeters=${Math.round(distance)}`,
            `servedRouteCount=${place.servedRouteIds.length}`,
          ],
          representativeLocation: place.representativeLocation,
          routeCount: place.servedRouteIds.length,
        },
      ];
    });

    scored.sort((left, right) => {
      if (left.geographicDistanceMeters !== right.geographicDistanceMeters) {
        return left.geographicDistanceMeters - right.geographicDistanceMeters;
      }
      if (right.routeCount !== left.routeCount) return right.routeCount - left.routeCount;
      return (
        left.primaryName.localeCompare(right.primaryName) ||
        left.transitPlaceId.localeCompare(right.transitPlaceId)
      );
    });

    const choices = scored
      .slice(0, query.maxCount)
      .map(({ routeCount: _routeCount, ...choice }) => choice);
    if (choices.length === 0) {
      return {
        _tag: "NoneWithinCap" as const,
        radiusMeters: query.radiusMeters,
        maxCount: query.maxCount,
      };
    }
    return { _tag: "Choices" as const, choices };
  });

  return { search, nearbyTransit } satisfies PassengerPlaceDiscovery;
});

export const layer = (options: {
  readonly artifact: unknown;
  readonly transitIndex?: TransitPlaceIndex;
  readonly retrievedAt?: string;
}) => Layer.effect(Service)(make(options));

export type { PassengerPlaceArtifact };
