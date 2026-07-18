import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { DateTime, Effect, Exit, Layer, Schema } from "effect";
import { expect } from "vitest";

import { itEffect } from "../testing/effect.js";
import { CurationDatabase } from "./database.js";
import {
  Actor,
  CuratedLineId,
  CuratedTransferId,
  ImportRunId,
  ImportedSourceStationId,
  PlaceId,
  RevisionVersion,
  TopologyId,
  type SetTopologyInput,
  type UpsertPlacementInput,
} from "./model.js";
import { CurationService } from "./service.js";
import { SqliteD1Database } from "./testing/sqlite-d1.js";

const actor = Actor.make("curator@example.com");
const at = (value: string) => Schema.decodeUnknownSync(Schema.DateTimeUtcFromString)(value);
const t0 = at("2026-07-18T00:00:00.000Z");
const t1 = at("2026-07-18T01:00:00.000Z");

const loadMigration = async () => {
  const entries = await readdir("drizzle", { withFileTypes: true });
  const migrationDirectory = entries.find((entry) => entry.isDirectory());
  if (!migrationDirectory) throw new Error("Generated Drizzle migration is missing");
  return readFile(join("drizzle", migrationDirectory.name, "migration.sql"), "utf8");
};

const withCuration = <A, E>(
  use: (binding: D1Database) => Effect.Effect<A, E, CurationService.Service>,
) =>
  Effect.acquireUseRelease(
    Effect.tryPromise(async () => {
      const binding = new SqliteD1Database();
      const migration = (await loadMigration()).replaceAll("--> statement-breakpoint", "");
      await binding.exec(migration);
      return binding;
    }),
    (binding) =>
      use(binding).pipe(
        Effect.provide(CurationService.layer.pipe(Layer.provide(CurationDatabase.layer(binding)))),
      ),
    (binding) => Effect.sync(() => binding.close()),
  );

const placementInput = (input: {
  readonly revisionId: UpsertPlacementInput["revisionId"];
  readonly version: number;
  readonly placeId: string;
  readonly name?: string;
  readonly status?: "Unresolved" | "Approximate" | "Verified";
  readonly latitude?: number | null;
  readonly longitude?: number | null;
}): UpsertPlacementInput => ({
  revisionId: input.revisionId,
  expectedVersion: RevisionVersion.make(input.version),
  actor,
  notes: "place station",
  editedAt: t0,
  placement: {
    placeId: PlaceId.make(input.placeId),
    name: input.name ?? input.placeId,
    latitudeMicrodegrees: input.latitude ?? null,
    longitudeMicrodegrees: input.longitude ?? null,
    placementStatus: input.status ?? "Unresolved",
    notes: "",
  },
});

const topologyInput = (input: {
  readonly revisionId: SetTopologyInput["revisionId"];
  readonly version: number;
  readonly id?: string;
  readonly stops: ReadonlyArray<string>;
}): SetTopologyInput => ({
  revisionId: input.revisionId,
  expectedVersion: RevisionVersion.make(input.version),
  actor,
  notes: "order stops",
  editedAt: t0,
  topology: {
    id: TopologyId.make(input.id ?? "topology-main"),
    line: {
      id: CuratedLineId.make("line-red"),
      mode: "CommuterRail",
      name: "Red Line",
    },
    branch: input.id ?? "main",
    direction: "outbound",
    active: true,
    stops: input.stops.map((placeId) => ({
      placeId: PlaceId.make(placeId),
      boardingPointId: null,
    })),
  },
});

itEffect(
  "publishes a valid revision atomically and keeps draft edits private",
  withCuration(() =>
    Effect.gen(function* () {
      const service = yield* CurationService.Service;
      const draft = yield* service.createDraft({ actor, notes: "initial", createdAt: t0 });
      yield* service.upsertPlacement(
        placementInput({
          revisionId: draft.id,
          version: 0,
          placeId: "place-a",
          status: "Verified",
          latitude: -6_200_000,
          longitude: 106_800_000,
        }),
      );
      yield* service.upsertPlacement(
        placementInput({
          revisionId: draft.id,
          version: 1,
          placeId: "place-b",
          status: "Verified",
          latitude: -6_210_000,
          longitude: 106_810_000,
        }),
      );
      yield* service.setTopology(
        topologyInput({ revisionId: draft.id, version: 2, stops: ["place-a", "place-b"] }),
      );

      const beforePublish = yield* Effect.exit(service.published());
      expect(Exit.isFailure(beforePublish)).toBe(true);
      const report = yield* service.validate(draft.id);
      expect(report.publishable).toBe(true);

      const published = yield* service.publish({
        revisionId: draft.id,
        expectedVersion: RevisionVersion.make(3),
        actor,
        notes: "approved",
        publishedAt: t1,
      });
      expect(published.revision.status).toBe("Published");
      expect(published.revision.version).toBe(4);
      expect((yield* service.published()).revision.id).toBe(draft.id);

      const rollback = yield* service.rollbackToNewDraft({
        revisionId: draft.id,
        actor,
        notes: "restore this snapshot as a new revision",
        createdAt: t1,
      });
      const republished = yield* service.publish({
        revisionId: rollback.id,
        expectedVersion: RevisionVersion.make(0),
        actor,
        notes: "publish rollback revision",
        publishedAt: t1,
      });
      expect(republished.topologies[0]?.stops).toHaveLength(2);
      expect((yield* service.preview(draft.id)).revision.status).toBe("Superseded");
    }),
  ),
);

itEffect(
  "rejects stale optimistic edits without changing the draft",
  withCuration(() =>
    Effect.gen(function* () {
      const service = yield* CurationService.Service;
      const draft = yield* service.createDraft({ actor, notes: "conflict", createdAt: t0 });
      yield* service.upsertPlacement(
        placementInput({ revisionId: draft.id, version: 0, placeId: "place-a" }),
      );
      const conflict = yield* Effect.exit(
        service.upsertPlacement(
          placementInput({ revisionId: draft.id, version: 0, placeId: "place-b" }),
        ),
      );
      expect(Exit.isFailure(conflict)).toBe(true);
      const preview = yield* service.preview(draft.id);
      expect(preview.revision.version).toBe(1);
      expect(preview.placements.map((placement) => placement.placeId)).toEqual(["place-a"]);
    }),
  ),
);

itEffect(
  "reports unresolved, missing, and duplicate ordered stops as blocking findings",
  withCuration(() =>
    Effect.gen(function* () {
      const service = yield* CurationService.Service;
      const draft = yield* service.createDraft({ actor, notes: "invalid topology", createdAt: t0 });
      yield* service.upsertPlacement(
        placementInput({ revisionId: draft.id, version: 0, placeId: "place-a" }),
      );
      yield* service.setTopology(
        topologyInput({
          revisionId: draft.id,
          version: 1,
          id: "topology-empty",
          stops: [],
        }),
      );
      yield* service.setTopology(
        topologyInput({
          revisionId: draft.id,
          version: 2,
          id: "topology-duplicate",
          stops: ["place-a", "place-a"],
        }),
      );
      const report = yield* service.validate(draft.id);
      expect(report.publishable).toBe(false);
      expect(new Set(report.findings.map((finding) => finding.code))).toEqual(
        new Set(["MissingOrderedStops", "UnresolvedTopologyStation", "DuplicateConsecutiveStop"]),
      );
    }),
  ),
);

itEffect(
  "blocks dangling transfers and source mappings missing from the latest import",
  withCuration((binding) =>
    Effect.gen(function* () {
      const service = yield* CurationService.Service;
      yield* service.registerImport({
        run: {
          id: ImportRunId.make("run-old"),
          source: "krl",
          contentHash: "hash-old",
          artifactRef: "r2://imports/hash-old",
          retrievedAt: t0,
          status: "Complete",
        },
        stations: [
          {
            id: ImportedSourceStationId.make("source-old"),
            importRunId: ImportRunId.make("run-old"),
            source: "krl",
            sourceRecordId: "station-1",
            name: "Old Station",
            contentHash: "station-hash",
            artifactRef: "r2://imports/station-hash",
          },
        ],
      });
      yield* service.registerImport({
        run: {
          id: ImportRunId.make("run-new"),
          source: "krl",
          contentHash: "hash-new",
          artifactRef: "r2://imports/hash-new",
          retrievedAt: t1,
          status: "Complete",
        },
        stations: [],
      });

      const draft = yield* service.createDraft({ actor, notes: "stale source", createdAt: t0 });
      yield* service.upsertPlacement(
        placementInput({
          revisionId: draft.id,
          version: 0,
          placeId: "place-a",
          status: "Verified",
          latitude: -6_200_000,
          longitude: 106_800_000,
        }),
      );
      yield* service.mapSourceStation({
        revisionId: draft.id,
        expectedVersion: RevisionVersion.make(1),
        actor,
        notes: "map evidence",
        editedAt: t0,
        mapping: {
          sourceStationId: ImportedSourceStationId.make("source-old"),
          placeId: PlaceId.make("place-a"),
        },
      });
      yield* Effect.tryPromise(() =>
        binding
          .prepare("insert into physical_places (id, created_at, created_by) values (?, ?, ?)")
          .bind("place-dangling", DateTime.formatIso(t0), actor)
          .run(),
      );
      yield* service.upsertTransfer({
        revisionId: draft.id,
        expectedVersion: RevisionVersion.make(2),
        actor,
        notes: "dangling endpoint",
        editedAt: t0,
        transfer: {
          id: CuratedTransferId.make("transfer-1"),
          fromPlaceId: PlaceId.make("place-a"),
          toPlaceId: PlaceId.make("place-dangling"),
          fromBoardingPointId: null,
          toBoardingPointId: null,
          walkingDurationSeconds: 300,
          directionality: "Bidirectional",
          accessibility: "Unknown",
          verificationStatus: "Unverified",
          notes: "",
        },
      });
      const report = yield* service.validate(draft.id);
      expect(new Set(report.findings.map((finding) => finding.code))).toEqual(
        new Set(["DanglingTransfer", "DisappearedSourceRecord"]),
      );
    }),
  ),
);

itEffect(
  "enforces coordinate, sequence, self-transfer, and source-mapping constraints in D1",
  withCuration((binding) =>
    Effect.gen(function* () {
      yield* Effect.tryPromise(() =>
        binding
          .prepare(
            "insert into curation_revisions (status, actor, notes, created_at) values ('Draft', ?, '', ?)",
          )
          .bind(actor, DateTime.formatIso(t0))
          .run(),
      );
      yield* Effect.tryPromise(() =>
        binding
          .prepare("insert into physical_places (id, created_at, created_by) values (?, ?, ?)")
          .bind("place-a", DateTime.formatIso(t0), actor)
          .run(),
      );
      yield* Effect.tryPromise(() =>
        binding.exec(`
          insert into physical_places (id, created_at, created_by)
            values ('place-b', '2026-07-18T00:00:00.000Z', 'curator@example.com');
          insert into import_runs (id, source, content_hash, artifact_ref, retrieved_at, status)
            values ('run', 'krl', 'run-hash', 'r2://imports/run-hash', '2026-07-18T00:00:00.000Z', 'Complete');
          insert into source_stations (id, import_run_id, source, source_record_id, name, content_hash, artifact_ref)
            values ('source-a', 'run', 'krl', 'station-a', 'A', 'hash-a', 'r2://imports/hash-a');
          insert into source_stations (id, import_run_id, source, source_record_id, name, content_hash, artifact_ref)
            values ('source-b', 'run', 'krl', 'station-b', 'B', 'hash-b', 'r2://imports/hash-b');
          insert into source_station_mappings (revision_id, source_station_id, place_id)
            values (1, 'source-a', 'place-a');
          insert into source_station_mappings (revision_id, source_station_id, place_id)
            values (1, 'source-b', 'place-a');
          insert into curated_lines (id, mode, name, created_at, created_by)
            values ('line', 'CommuterRail', 'Line', '2026-07-18T00:00:00.000Z', 'curator@example.com');
          insert into line_topologies (revision_id, id, line_id, branch, direction, active)
            values (1, 'topology', 'line', 'main', 'outbound', 1);
          insert into topology_stops (revision_id, topology_id, sequence, place_id)
            values (1, 'topology', 0, 'place-a');
        `),
      );
      const invalidCoordinates = yield* Effect.exit(
        Effect.tryPromise(() =>
          binding
            .prepare(
              "insert into station_placements (revision_id, place_id, name, latitude_microdegrees, longitude_microdegrees, placement_status, notes) values (1, 'place-a', 'A', 91000000, 106000000, 'Verified', '')",
            )
            .run(),
        ),
      );
      const selfTransfer = yield* Effect.exit(
        Effect.tryPromise(() =>
          binding
            .prepare(
              "insert into curated_transfers (revision_id, id, from_place_id, to_place_id, walking_duration_seconds, directionality, accessibility, verification_status, notes) values (1, 'transfer', 'place-a', 'place-a', 10, 'Directed', 'Unknown', 'Unverified', '')",
            )
            .run(),
        ),
      );
      const duplicateSourceMapping = yield* Effect.exit(
        Effect.tryPromise(() =>
          binding
            .prepare(
              "insert into source_station_mappings (revision_id, source_station_id, place_id) values (1, 'source-a', 'place-b')",
            )
            .run(),
        ),
      );
      const duplicateSequence = yield* Effect.exit(
        Effect.tryPromise(() =>
          binding
            .prepare(
              "insert into topology_stops (revision_id, topology_id, sequence, place_id) values (1, 'topology', 0, 'place-b')",
            )
            .run(),
        ),
      );
      expect(Exit.isFailure(invalidCoordinates)).toBe(true);
      expect(Exit.isFailure(selfTransfer)).toBe(true);
      expect(Exit.isFailure(duplicateSourceMapping)).toBe(true);
      expect(Exit.isFailure(duplicateSequence)).toBe(true);

      const manyToOne = yield* Effect.tryPromise(() =>
        binding
          .prepare(
            "select count(*) as count from source_station_mappings where revision_id = 1 and place_id = 'place-a'",
          )
          .first<{ count: number }>(),
      );
      expect(manyToOne?.count).toBe(2);
    }),
  ),
);
