import { createHash } from "node:crypto";

import { Effect, Schema } from "effect";

import {
  type AreaPlace,
  type LandmarkPlace,
  type PassengerPlace,
  type PassengerPlaceId,
  PassengerPlaceArtifact,
} from "../../domain/place/index.js";
import { OsmPlacesDecodeError, OsmPlacesValidationError } from "./errors.js";
import { OsmPlaceExtract, type OsmPlaceFeature } from "./raw.js";

export const PLACE_COMPILER_VERSION = "1";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const asPlaceId = (value: string) => value as PassengerPlaceId;

const stableStringify = (value: unknown, pretty = false, indent = 0): string => {
  const pad = pretty ? "\n" + "  ".repeat(indent) : "";
  const padIn = pretty ? "\n" + "  ".repeat(indent + 1) : "";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => stableStringify(item, pretty, indent + 1));
    return pretty ? `[${padIn}${items.join("," + padIn)}${pad}]` : `[${items.join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length === 0) return "{}";
  const fields = keys.map(
    (key) =>
      `${JSON.stringify(key)}:${pretty ? " " : ""}${stableStringify(record[key], pretty, indent + 1)}`,
  );
  return pretty ? `{${padIn}${fields.join("," + padIn)}${pad}}` : `{${fields.join(",")}}`;
};

const osmRecordId = (feature: OsmPlaceFeature) => `osm:${feature.osmType}:${feature.osmId}`;

const placeIdFor = (kind: "area" | "landmark", feature: OsmPlaceFeature) =>
  `place:${kind}:${feature.osmType}:${feature.osmId}`;

const comparePlaces = (left: PassengerPlace, right: PassengerPlace) =>
  left.id.localeCompare(right.id);

export interface ClassificationDecision {
  readonly place: PassengerPlace | undefined;
  readonly sourceClassification: string;
  readonly rejectionReason: string | undefined;
}

const tag = (feature: OsmPlaceFeature, key: string) => feature.tags[key];

const classifyLandmarkKind = (
  feature: OsmPlaceFeature,
): LandmarkPlace["landmarkKind"] | undefined => {
  const amenity = tag(feature, "amenity");
  const shop = tag(feature, "shop");
  const tourism = tag(feature, "tourism");
  const railway = tag(feature, "railway");
  const highway = tag(feature, "highway");
  const leisure = tag(feature, "leisure");
  const aeroway = tag(feature, "aeroway");
  const building = tag(feature, "building");

  if (shop === "mall" || shop === "department_store" || building === "mall") return "Mall";
  if (amenity === "marketplace" || shop === "market") return "Market";
  if (amenity === "university" || amenity === "college") return "Campus";
  if (amenity === "hospital") return "Hospital";
  if (leisure === "stadium") return "Stadium";
  if (amenity === "bus_station" || highway === "bus_station" || aeroway === "terminal") {
    return "Terminal";
  }
  if (railway === "station" || railway === "halt") return "RailStation";
  if (tourism === "attraction" || tourism === "museum" || tourism === "zoo") return "Landmark";
  if (
    amenity === "place_of_worship" &&
    (tourism !== undefined || tag(feature, "name") !== undefined)
  ) {
    return "Landmark";
  }
  return undefined;
};

const classifyAreaKind = (feature: OsmPlaceFeature): AreaPlace["areaKind"] | undefined => {
  const place = tag(feature, "place");
  if (place === "neighbourhood" || place === "quarter" || place === "city_block") {
    return "Neighbourhood";
  }
  if (place === "suburb" || place === "borough" || place === "district") return "District";
  if (
    place === "city" ||
    place === "municipality" ||
    place === "town" ||
    place === "village" ||
    place === "hamlet"
  ) {
    return "Administrative";
  }
  const adminLevel = tag(feature, "admin_level");
  if (adminLevel === "5" || adminLevel === "6" || adminLevel === "7") return "Administrative";
  if (adminLevel === "8" || adminLevel === "9") return "District";
  if (adminLevel === "10") return "Neighbourhood";
  return undefined;
};

const localityOf = (feature: OsmPlaceFeature) => ({
  municipality: feature.municipality ?? "Jabodetabek",
  ...(feature.adminDistrict === undefined ? {} : { adminDistrict: feature.adminDistrict }),
  ...(feature.neighbourhood === undefined ? {} : { neighbourhood: feature.neighbourhood }),
});

const aliasesOf = (feature: OsmPlaceFeature) => {
  const values = new Set<string>();
  for (const alias of feature.altNames) {
    if (alias !== feature.name) values.add(alias);
  }
  if (feature.nameId !== undefined && feature.nameId !== feature.name) values.add(feature.nameId);
  for (const key of ["name:en", "alt_name", "short_name", "official_name"] as const) {
    const value = tag(feature, key);
    if (value !== undefined && value !== feature.name) values.add(value);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
};

const cleanLabel = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * Prefer a shorter multi-word passenger label when OSM's primary name is a
 * branded/long form that still begins with that label (e.g. "Grand Indonesia
 * Shopping Town" + alias "Grand Indonesia"). Also promote a longer seed alias
 * when OSM returned a truncated head token ("Kota" + "Kota Tua").
 */
const passengerPrimaryAndAliases = (
  osmName: string,
  aliases: ReadonlyArray<string>,
): { readonly primaryName: string; readonly aliases: ReadonlyArray<string> } => {
  const pool = new Set(aliases.map(cleanLabel).filter((value) => value.length > 0));
  let primary = cleanLabel(osmName);

  for (const alias of pool) {
    const aliasFold = alias.toLowerCase();
    const primaryFold = primary.toLowerCase();
    if (primaryFold.startsWith(`${aliasFold} `) && alias.includes(" ")) {
      pool.add(primary);
      primary = alias;
      pool.delete(alias);
      break;
    }
  }

  for (const alias of pool) {
    const aliasFold = alias.toLowerCase();
    const primaryFold = primary.toLowerCase();
    if (aliasFold.startsWith(`${primaryFold} `) && alias.split(/\s+/).length > 1) {
      pool.add(primary);
      // Prefer title-ish casing from the longer alias when OSM truncated the name.
      primary = alias.replace(/\b\w/g, (char) => char.toUpperCase());
      pool.delete(alias);
      break;
    }
  }

  pool.delete(primary);

  // Initialism aliases: "Grand Indonesia" → "GI", "Rumah Sakit Cipto Mangunkusumo" → "RSCM".
  const initials = primary
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]!)
    .join("")
    .toUpperCase();
  if (initials.length >= 2 && initials.length <= 6) {
    pool.add(initials);
  }
  if (/^rumah sakit\b/i.test(primary)) {
    pool.add(primary.replace(/^rumah sakit/i, "RS").trim());
  }

  // Common landmark short names observed in Jakarta passenger queries.
  if (/^monumen nasional\b/i.test(primary)) pool.add("Monas");
  if (/^monas\b/i.test(primary)) pool.add("Monumen Nasional");

  return {
    primaryName: primary,
    aliases: [...pool].sort((a, b) => a.localeCompare(b)),
  };
};

const geometryFields = (feature: OsmPlaceFeature) => {
  if (feature.geometry._tag === "Point") {
    return {
      representativeLocation: {
        _tag: "Placed" as const,
        latitude: feature.geometry.latitude,
        longitude: feature.geometry.longitude,
      },
    };
  }
  return {
    representativeLocation: {
      _tag: "Placed" as const,
      latitude: feature.geometry.latitude,
      longitude: feature.geometry.longitude,
    },
    bounds: {
      west: feature.geometry.west,
      south: feature.geometry.south,
      east: feature.geometry.east,
      north: feature.geometry.north,
    },
  };
};

export const classifyFeature = (
  feature: OsmPlaceFeature,
  options: {
    readonly artifactVersion: string;
    readonly retrievedAt: string;
    readonly source: string;
  },
): ClassificationDecision => {
  const sourceClassification =
    tag(feature, "place") !== undefined
      ? `place=${tag(feature, "place")}`
      : tag(feature, "amenity") !== undefined
        ? `amenity=${tag(feature, "amenity")}`
        : tag(feature, "shop") !== undefined
          ? `shop=${tag(feature, "shop")}`
          : tag(feature, "railway") !== undefined
            ? `railway=${tag(feature, "railway")}`
            : tag(feature, "tourism") !== undefined
              ? `tourism=${tag(feature, "tourism")}`
              : tag(feature, "leisure") !== undefined
                ? `leisure=${tag(feature, "leisure")}`
                : "unclassified";

  const named = passengerPrimaryAndAliases(feature.name.trim(), aliasesOf(feature));
  const common = {
    primaryName: named.primaryName,
    aliases: named.aliases,
    locality: localityOf(feature),
    ...geometryFields(feature),
    sourceRefs: [
      {
        system: "osm",
        recordId: osmRecordId(feature),
        retrievedAt: options.retrievedAt,
        source: options.source,
        classification: sourceClassification,
      },
    ],
    artifactVersion: options.artifactVersion,
  };

  if (common.primaryName === "") {
    return {
      place: undefined,
      sourceClassification,
      rejectionReason: "empty_name",
    };
  }

  const areaKind = classifyAreaKind(feature);
  if (areaKind !== undefined) {
    return {
      place: {
        _tag: "Area",
        id: asPlaceId(placeIdFor("area", feature)),
        ...common,
        areaKind,
      } as unknown as PassengerPlace,
      sourceClassification,
      rejectionReason: undefined,
    };
  }

  const landmarkKind = classifyLandmarkKind(feature);
  if (landmarkKind !== undefined) {
    return {
      place: {
        _tag: "Landmark",
        id: asPlaceId(placeIdFor("landmark", feature)),
        ...common,
        landmarkKind,
      } as unknown as PassengerPlace,
      sourceClassification,
      rejectionReason: undefined,
    };
  }

  return {
    place: undefined,
    sourceClassification,
    rejectionReason: "unsupported_classification",
  };
};

export interface CompileAudit {
  accepted: number;
  rejected: number;
  exactDuplicatesMerged: number;
  byType: Record<string, number>;
  byMunicipality: Record<string, number>;
  bySourceClassification: Record<string, number>;
  byRejectionReason: Record<string, number>;
  missingField: Record<string, number>;
}

const bump = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

export interface CompilePlacesOptions {
  readonly extract: unknown;
  readonly artifactVersion: string;
  readonly retrievedAt: string;
}

export interface CompilePlacesResult {
  readonly artifact: PassengerPlaceArtifact;
  readonly artifactJson: string;
  readonly audit: CompileAudit;
}

export const compileOsmPlaces = Effect.fn("OsmPlaces.compile")(function* (
  options: CompilePlacesOptions,
) {
  const extract = yield* Schema.decodeUnknownEffect(OsmPlaceExtract)(options.extract).pipe(
    Effect.mapError(
      (error) =>
        new OsmPlacesDecodeError({ reason: `OsmPlaceExtract decode failed: ${String(error)}` }),
    ),
  );

  const inputChecksum = digest(stableStringify(extract));
  const audit: CompileAudit = {
    accepted: 0,
    rejected: 0,
    exactDuplicatesMerged: 0,
    byType: {},
    byMunicipality: {},
    bySourceClassification: {},
    byRejectionReason: {},
    missingField: {},
  };

  const bySourceId = new Map<string, PassengerPlace>();

  for (const [index, feature] of extract.features.entries()) {
    if (feature.municipality === undefined) bump(audit.missingField, "municipality");
    const decision = classifyFeature(feature, {
      artifactVersion: options.artifactVersion,
      retrievedAt: options.retrievedAt,
      source: extract.sourceName,
    });
    bump(audit.bySourceClassification, decision.sourceClassification);

    if (decision.place === undefined) {
      audit.rejected += 1;
      bump(audit.byRejectionReason, decision.rejectionReason ?? "unknown");
      continue;
    }

    const sourceId = osmRecordId(feature);
    const existing = bySourceId.get(sourceId);
    if (existing !== undefined) {
      audit.exactDuplicatesMerged += 1;
      // Prefer the record that already won insertion order; exact duplicates merge.
      continue;
    }

    // Guard against two different OSM identities collapsing to one place id.
    for (const prior of bySourceId.values()) {
      if (prior.id === decision.place.id) {
        return yield* Effect.fail(
          new OsmPlacesValidationError({
            code: "DUPLICATE_PLACE_ID",
            message: `Place id collision for ${decision.place.id}`,
            recordContext: `features[${index}]`,
          }),
        );
      }
    }

    bySourceId.set(sourceId, decision.place);
    audit.accepted += 1;
    bump(audit.byType, decision.place._tag);
    bump(audit.byMunicipality, decision.place.locality.municipality);
  }

  const places = [...bySourceId.values()].sort(comparePlaces);
  const artifactWithoutChecksum = {
    schemaVersion: "1" as const,
    artifactVersion: options.artifactVersion,
    source: {
      name: extract.sourceName,
      dateOrVersion: extract.sourceDateOrVersion,
      license: extract.license,
      attribution: extract.attribution,
      boundaryDescription: extract.boundaryDescription,
      inputChecksum,
      compilerVersion: PLACE_COMPILER_VERSION,
    },
    outputChecksum: "pending",
    places,
  };

  const outputChecksum = digest(
    stableStringify({ ...artifactWithoutChecksum, outputChecksum: "" }),
  );
  const artifact = yield* Schema.decodeUnknownEffect(PassengerPlaceArtifact)({
    ...artifactWithoutChecksum,
    outputChecksum,
  }).pipe(
    Effect.mapError(
      (error) =>
        new OsmPlacesValidationError({
          code: "ARTIFACT_ENCODE",
          message: `PassengerPlaceArtifact encode failed: ${String(error)}`,
        }),
    ),
  );

  // Encode back to JSON-ready values (DateTime → ISO string) for byte-stable publish.
  const encoded = yield* Schema.encodeUnknownEffect(PassengerPlaceArtifact)(artifact).pipe(
    Effect.mapError(
      (error) =>
        new OsmPlacesValidationError({
          code: "ARTIFACT_ENCODE",
          message: `PassengerPlaceArtifact encode failed: ${String(error)}`,
        }),
    ),
  );

  return {
    artifact,
    artifactJson: `${stableStringify(encoded, true)}\n`,
    audit,
  } satisfies CompilePlacesResult;
});
