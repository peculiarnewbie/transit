CREATE TABLE `boarding_points` (
	`revision_id` integer NOT NULL,
	`id` text NOT NULL,
	`place_id` text NOT NULL,
	`name` text NOT NULL,
	`latitude_microdegrees` integer,
	`longitude_microdegrees` integer,
	`accessibility` text DEFAULT 'Unknown' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	CONSTRAINT `boarding_points_pk` PRIMARY KEY(`revision_id`, `id`),
	CONSTRAINT `fk_boarding_points_revision_id_curation_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `curation_revisions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_boarding_points_place_id_physical_places_id_fk` FOREIGN KEY (`place_id`) REFERENCES `physical_places`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "boarding_points_name_nonempty" CHECK(length("name") > 0),
	CONSTRAINT "boarding_points_coordinates_pair" CHECK(("latitude_microdegrees" is null and "longitude_microdegrees" is null) or ("latitude_microdegrees" is not null and "longitude_microdegrees" is not null)),
	CONSTRAINT "boarding_points_latitude_range" CHECK("latitude_microdegrees" is null or "latitude_microdegrees" between -90000000 and 90000000),
	CONSTRAINT "boarding_points_longitude_range" CHECK("longitude_microdegrees" is null or "longitude_microdegrees" between -180000000 and 180000000)
);
--> statement-breakpoint
CREATE TABLE `curated_lines` (
	`id` text PRIMARY KEY,
	`mode` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `curated_transfers` (
	`revision_id` integer NOT NULL,
	`id` text NOT NULL,
	`from_place_id` text NOT NULL,
	`to_place_id` text NOT NULL,
	`from_boarding_point_id` text,
	`to_boarding_point_id` text,
	`walking_duration_seconds` integer NOT NULL,
	`directionality` text NOT NULL,
	`accessibility` text NOT NULL,
	`verification_status` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	CONSTRAINT `curated_transfers_pk` PRIMARY KEY(`revision_id`, `id`),
	CONSTRAINT `fk_curated_transfers_revision_id_curation_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `curation_revisions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_curated_transfers_from_place_id_physical_places_id_fk` FOREIGN KEY (`from_place_id`) REFERENCES `physical_places`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_curated_transfers_to_place_id_physical_places_id_fk` FOREIGN KEY (`to_place_id`) REFERENCES `physical_places`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `curated_transfers_from_boarding_point_fk` FOREIGN KEY (`revision_id`,`from_boarding_point_id`) REFERENCES `boarding_points`(`revision_id`,`id`) ON DELETE RESTRICT,
	CONSTRAINT `curated_transfers_to_boarding_point_fk` FOREIGN KEY (`revision_id`,`to_boarding_point_id`) REFERENCES `boarding_points`(`revision_id`,`id`) ON DELETE RESTRICT,
	CONSTRAINT "curated_transfers_not_self" CHECK("from_place_id" <> "to_place_id"),
	CONSTRAINT "curated_transfers_duration_positive" CHECK("walking_duration_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE `curation_operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`revision_id` integer NOT NULL,
	`base_version` integer NOT NULL,
	`resulting_version` integer NOT NULL,
	`operation` text NOT NULL,
	`actor` text NOT NULL,
	`notes` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_curation_operations_revision_id_curation_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `curation_revisions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "curation_operations_version_increment" CHECK("resulting_version" = "base_version" + 1)
);
--> statement-breakpoint
CREATE TABLE `curation_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`parent_revision_id` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`actor` text NOT NULL,
	`notes` text NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text,
	CONSTRAINT `curation_revisions_parent_fk` FOREIGN KEY (`parent_revision_id`) REFERENCES `curation_revisions`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "curation_revisions_version_nonnegative" CHECK("version" >= 0)
);
--> statement-breakpoint
CREATE TABLE `health_checks` (
	`id` integer PRIMARY KEY,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_runs` (
	`id` text PRIMARY KEY,
	`source` text NOT NULL,
	`content_hash` text NOT NULL,
	`artifact_ref` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`status` text NOT NULL,
	CONSTRAINT "import_runs_content_hash_nonempty" CHECK(length("content_hash") > 0),
	CONSTRAINT "import_runs_artifact_ref_nonempty" CHECK(length("artifact_ref") > 0)
);
--> statement-breakpoint
CREATE TABLE `line_topologies` (
	`revision_id` integer NOT NULL,
	`id` text NOT NULL,
	`line_id` text NOT NULL,
	`branch` text NOT NULL,
	`direction` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT `line_topologies_pk` PRIMARY KEY(`revision_id`, `id`),
	CONSTRAINT `fk_line_topologies_revision_id_curation_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `curation_revisions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_line_topologies_line_id_curated_lines_id_fk` FOREIGN KEY (`line_id`) REFERENCES `curated_lines`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `physical_places` (
	`id` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_station_mappings` (
	`revision_id` integer NOT NULL,
	`source_station_id` text NOT NULL,
	`place_id` text NOT NULL,
	CONSTRAINT `source_station_mappings_pk` PRIMARY KEY(`revision_id`, `source_station_id`),
	CONSTRAINT `fk_source_station_mappings_revision_id_curation_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `curation_revisions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_source_station_mappings_source_station_id_source_stations_id_fk` FOREIGN KEY (`source_station_id`) REFERENCES `source_stations`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_source_station_mappings_place_id_physical_places_id_fk` FOREIGN KEY (`place_id`) REFERENCES `physical_places`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `source_stations` (
	`id` text PRIMARY KEY,
	`import_run_id` text NOT NULL,
	`source` text NOT NULL,
	`source_record_id` text NOT NULL,
	`name` text NOT NULL,
	`content_hash` text NOT NULL,
	`artifact_ref` text NOT NULL,
	CONSTRAINT `fk_source_stations_import_run_id_import_runs_id_fk` FOREIGN KEY (`import_run_id`) REFERENCES `import_runs`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "source_stations_record_id_nonempty" CHECK(length("source_record_id") > 0),
	CONSTRAINT "source_stations_name_nonempty" CHECK(length("name") > 0)
);
--> statement-breakpoint
CREATE TABLE `station_aliases` (
	`revision_id` integer NOT NULL,
	`place_id` text NOT NULL,
	`alias` text NOT NULL,
	CONSTRAINT `station_aliases_pk` PRIMARY KEY(`revision_id`, `place_id`, `alias`),
	CONSTRAINT `fk_station_aliases_revision_id_curation_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `curation_revisions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_station_aliases_place_id_physical_places_id_fk` FOREIGN KEY (`place_id`) REFERENCES `physical_places`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "station_aliases_nonempty" CHECK(length(trim("alias")) > 0)
);
--> statement-breakpoint
CREATE TABLE `station_placements` (
	`revision_id` integer NOT NULL,
	`place_id` text NOT NULL,
	`name` text NOT NULL,
	`latitude_microdegrees` integer,
	`longitude_microdegrees` integer,
	`placement_status` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	CONSTRAINT `station_placements_pk` PRIMARY KEY(`revision_id`, `place_id`),
	CONSTRAINT `fk_station_placements_revision_id_curation_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `curation_revisions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_station_placements_place_id_physical_places_id_fk` FOREIGN KEY (`place_id`) REFERENCES `physical_places`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "station_placements_name_nonempty" CHECK(length("name") > 0),
	CONSTRAINT "station_placements_coordinates_pair" CHECK(("latitude_microdegrees" is null and "longitude_microdegrees" is null) or ("latitude_microdegrees" is not null and "longitude_microdegrees" is not null)),
	CONSTRAINT "station_placements_latitude_range" CHECK("latitude_microdegrees" is null or "latitude_microdegrees" between -90000000 and 90000000),
	CONSTRAINT "station_placements_longitude_range" CHECK("longitude_microdegrees" is null or "longitude_microdegrees" between -180000000 and 180000000),
	CONSTRAINT "station_placements_unresolved_coordinates" CHECK(("placement_status" = 'Unresolved' and "latitude_microdegrees" is null) or ("placement_status" <> 'Unresolved' and "latitude_microdegrees" is not null))
);
--> statement-breakpoint
CREATE TABLE `topology_stops` (
	`revision_id` integer NOT NULL,
	`topology_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`place_id` text NOT NULL,
	`boarding_point_id` text,
	CONSTRAINT `topology_stops_pk` PRIMARY KEY(`revision_id`, `topology_id`, `sequence`),
	CONSTRAINT `fk_topology_stops_place_id_physical_places_id_fk` FOREIGN KEY (`place_id`) REFERENCES `physical_places`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `topology_stops_topology_fk` FOREIGN KEY (`revision_id`,`topology_id`) REFERENCES `line_topologies`(`revision_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT `topology_stops_boarding_point_fk` FOREIGN KEY (`revision_id`,`boarding_point_id`) REFERENCES `boarding_points`(`revision_id`,`id`) ON DELETE RESTRICT,
	CONSTRAINT "topology_stops_sequence_nonnegative" CHECK("sequence" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `curation_operations_revision_version_unique` ON `curation_operations` (`revision_id`,`resulting_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `curation_revisions_single_published` ON `curation_revisions` (`status`) WHERE "curation_revisions"."status" = 'Published';--> statement-breakpoint
CREATE UNIQUE INDEX `import_runs_source_hash_unique` ON `import_runs` (`source`,`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `line_topologies_branch_direction_unique` ON `line_topologies` (`revision_id`,`line_id`,`branch`,`direction`);--> statement-breakpoint
CREATE INDEX `source_station_mappings_place_idx` ON `source_station_mappings` (`revision_id`,`place_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_stations_run_record_unique` ON `source_stations` (`import_run_id`,`source_record_id`);--> statement-breakpoint
CREATE INDEX `source_stations_identity_idx` ON `source_stations` (`source`,`source_record_id`);