import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const healthChecks = sqliteTable("health_checks", {
  id: integer("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});

export const importRuns = sqliteTable(
  "import_runs",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    contentHash: text("content_hash").notNull(),
    artifactRef: text("artifact_ref").notNull(),
    retrievedAt: text("retrieved_at").notNull(),
    status: text("status", { enum: ["Pending", "Complete", "Failed"] }).notNull(),
  },
  (table) => [
    uniqueIndex("import_runs_source_hash_unique").on(table.source, table.contentHash),
    check("import_runs_content_hash_nonempty", sql`length(${table.contentHash}) > 0`),
    check("import_runs_artifact_ref_nonempty", sql`length(${table.artifactRef}) > 0`),
  ],
);

/** Immutable station evidence discovered in one import run. */
export const sourceStations = sqliteTable(
  "source_stations",
  {
    id: text("id").primaryKey(),
    importRunId: text("import_run_id")
      .notNull()
      .references(() => importRuns.id, { onDelete: "restrict" }),
    source: text("source").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    name: text("name").notNull(),
    contentHash: text("content_hash").notNull(),
    artifactRef: text("artifact_ref").notNull(),
  },
  (table) => [
    uniqueIndex("source_stations_run_record_unique").on(table.importRunId, table.sourceRecordId),
    index("source_stations_identity_idx").on(table.source, table.sourceRecordId),
    check("source_stations_record_id_nonempty", sql`length(${table.sourceRecordId}) > 0`),
    check("source_stations_name_nonempty", sql`length(${table.name}) > 0`),
  ],
);

/** Stable curated identity. Revisioned attributes live in station_placements. */
export const physicalPlaces = sqliteTable("physical_places", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
});

/** Stable line identity. Ordered branches are revisioned separately. */
export const curatedLines = sqliteTable("curated_lines", {
  id: text("id").primaryKey(),
  mode: text("mode", { enum: ["Bus", "CommuterRail", "Mrt", "Lrt"] }).notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
});

export const curationRevisions = sqliteTable(
  "curation_revisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    parentRevisionId: integer("parent_revision_id"),
    version: integer("version").notNull().default(0),
    status: text("status", { enum: ["Draft", "Published", "Superseded"] }).notNull(),
    actor: text("actor").notNull(),
    notes: text("notes").notNull(),
    createdAt: text("created_at").notNull(),
    publishedAt: text("published_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.parentRevisionId],
      foreignColumns: [table.id],
      name: "curation_revisions_parent_fk",
    }).onDelete("restrict"),
    uniqueIndex("curation_revisions_single_published")
      .on(table.status)
      .where(sql`${table.status} = 'Published'`),
    check("curation_revisions_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const stationPlacements = sqliteTable(
  "station_placements",
  {
    revisionId: integer("revision_id")
      .notNull()
      .references(() => curationRevisions.id, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => physicalPlaces.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    latitudeMicrodegrees: integer("latitude_microdegrees"),
    longitudeMicrodegrees: integer("longitude_microdegrees"),
    placementStatus: text("placement_status", {
      enum: ["Unresolved", "Approximate", "Verified"],
    }).notNull(),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.placeId] }),
    check("station_placements_name_nonempty", sql`length(${table.name}) > 0`),
    check(
      "station_placements_coordinates_pair",
      sql`(${table.latitudeMicrodegrees} is null and ${table.longitudeMicrodegrees} is null) or (${table.latitudeMicrodegrees} is not null and ${table.longitudeMicrodegrees} is not null)`,
    ),
    check(
      "station_placements_latitude_range",
      sql`${table.latitudeMicrodegrees} is null or ${table.latitudeMicrodegrees} between -90000000 and 90000000`,
    ),
    check(
      "station_placements_longitude_range",
      sql`${table.longitudeMicrodegrees} is null or ${table.longitudeMicrodegrees} between -180000000 and 180000000`,
    ),
    check(
      "station_placements_unresolved_coordinates",
      sql`(${table.placementStatus} = 'Unresolved' and ${table.latitudeMicrodegrees} is null) or (${table.placementStatus} <> 'Unresolved' and ${table.latitudeMicrodegrees} is not null)`,
    ),
  ],
);

/** A revision can map many source stations onto one physical place, never vice versa. */
export const sourceStationMappings = sqliteTable(
  "source_station_mappings",
  {
    revisionId: integer("revision_id")
      .notNull()
      .references(() => curationRevisions.id, { onDelete: "cascade" }),
    sourceStationId: text("source_station_id")
      .notNull()
      .references(() => sourceStations.id, { onDelete: "restrict" }),
    placeId: text("place_id")
      .notNull()
      .references(() => physicalPlaces.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.sourceStationId] }),
    index("source_station_mappings_place_idx").on(table.revisionId, table.placeId),
  ],
);

export const stationAliases = sqliteTable(
  "station_aliases",
  {
    revisionId: integer("revision_id")
      .notNull()
      .references(() => curationRevisions.id, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => physicalPlaces.id, { onDelete: "restrict" }),
    alias: text("alias").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.placeId, table.alias] }),
    check("station_aliases_nonempty", sql`length(trim(${table.alias})) > 0`),
  ],
);

export const boardingPoints = sqliteTable(
  "boarding_points",
  {
    revisionId: integer("revision_id")
      .notNull()
      .references(() => curationRevisions.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    placeId: text("place_id")
      .notNull()
      .references(() => physicalPlaces.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    latitudeMicrodegrees: integer("latitude_microdegrees"),
    longitudeMicrodegrees: integer("longitude_microdegrees"),
    accessibility: text("accessibility", { enum: ["Unknown", "Accessible", "Inaccessible"] })
      .notNull()
      .default("Unknown"),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.id] }),
    check("boarding_points_name_nonempty", sql`length(${table.name}) > 0`),
    check(
      "boarding_points_coordinates_pair",
      sql`(${table.latitudeMicrodegrees} is null and ${table.longitudeMicrodegrees} is null) or (${table.latitudeMicrodegrees} is not null and ${table.longitudeMicrodegrees} is not null)`,
    ),
    check(
      "boarding_points_latitude_range",
      sql`${table.latitudeMicrodegrees} is null or ${table.latitudeMicrodegrees} between -90000000 and 90000000`,
    ),
    check(
      "boarding_points_longitude_range",
      sql`${table.longitudeMicrodegrees} is null or ${table.longitudeMicrodegrees} between -180000000 and 180000000`,
    ),
  ],
);

export const lineTopologies = sqliteTable(
  "line_topologies",
  {
    revisionId: integer("revision_id")
      .notNull()
      .references(() => curationRevisions.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    lineId: text("line_id")
      .notNull()
      .references(() => curatedLines.id, { onDelete: "restrict" }),
    branch: text("branch").notNull(),
    direction: text("direction").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.id] }),
    uniqueIndex("line_topologies_branch_direction_unique").on(
      table.revisionId,
      table.lineId,
      table.branch,
      table.direction,
    ),
  ],
);

export const topologyStops = sqliteTable(
  "topology_stops",
  {
    revisionId: integer("revision_id").notNull(),
    topologyId: text("topology_id").notNull(),
    sequence: integer("sequence").notNull(),
    placeId: text("place_id")
      .notNull()
      .references(() => physicalPlaces.id, { onDelete: "restrict" }),
    boardingPointId: text("boarding_point_id"),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.topologyId, table.sequence] }),
    foreignKey({
      columns: [table.revisionId, table.topologyId],
      foreignColumns: [lineTopologies.revisionId, lineTopologies.id],
      name: "topology_stops_topology_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.revisionId, table.boardingPointId],
      foreignColumns: [boardingPoints.revisionId, boardingPoints.id],
      name: "topology_stops_boarding_point_fk",
    }).onDelete("restrict"),
    check("topology_stops_sequence_nonnegative", sql`${table.sequence} >= 0`),
  ],
);

export const curatedTransfers = sqliteTable(
  "curated_transfers",
  {
    revisionId: integer("revision_id")
      .notNull()
      .references(() => curationRevisions.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    fromPlaceId: text("from_place_id")
      .notNull()
      .references(() => physicalPlaces.id, { onDelete: "restrict" }),
    toPlaceId: text("to_place_id")
      .notNull()
      .references(() => physicalPlaces.id, { onDelete: "restrict" }),
    fromBoardingPointId: text("from_boarding_point_id"),
    toBoardingPointId: text("to_boarding_point_id"),
    walkingDurationSeconds: integer("walking_duration_seconds").notNull(),
    directionality: text("directionality", { enum: ["Directed", "Bidirectional"] }).notNull(),
    accessibility: text("accessibility", {
      enum: ["Unknown", "Accessible", "Inaccessible"],
    }).notNull(),
    verificationStatus: text("verification_status", {
      enum: ["Unverified", "Verified"],
    }).notNull(),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.id] }),
    foreignKey({
      columns: [table.revisionId, table.fromBoardingPointId],
      foreignColumns: [boardingPoints.revisionId, boardingPoints.id],
      name: "curated_transfers_from_boarding_point_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.revisionId, table.toBoardingPointId],
      foreignColumns: [boardingPoints.revisionId, boardingPoints.id],
      name: "curated_transfers_to_boarding_point_fk",
    }).onDelete("restrict"),
    check("curated_transfers_not_self", sql`${table.fromPlaceId} <> ${table.toPlaceId}`),
    check("curated_transfers_duration_positive", sql`${table.walkingDurationSeconds} > 0`),
  ],
);

export const curationOperations = sqliteTable(
  "curation_operations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    revisionId: integer("revision_id")
      .notNull()
      .references(() => curationRevisions.id, { onDelete: "cascade" }),
    baseVersion: integer("base_version").notNull(),
    resultingVersion: integer("resulting_version").notNull(),
    operation: text("operation").notNull(),
    actor: text("actor").notNull(),
    notes: text("notes").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("curation_operations_revision_version_unique").on(
      table.revisionId,
      table.resultingVersion,
    ),
    check(
      "curation_operations_version_increment",
      sql`${table.resultingVersion} = ${table.baseVersion} + 1`,
    ),
  ],
);
