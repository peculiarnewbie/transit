import { and, eq, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import {
  boardingPoints,
  curatedLines,
  curatedTransfers,
  curationOperations,
  curationRevisions,
  importRuns,
  lineTopologies,
  physicalPlaces,
  sourceStationMappings,
  sourceStations,
  stationAliases,
  stationPlacements,
  topologyStops,
} from "../db/schema.js";
import { ConflictError, NotFoundError, PersistenceError, ValidationError } from "./errors.js";
import { CurationDatabase, type Database } from "./database.js";
import {
  CurationSnapshot,
  type CreateDraftInput,
  type CurationSnapshot as CurationSnapshotType,
  type MapSourceStationInput,
  type PublishInput,
  type RegisterImportInput,
  type Revision,
  Revision as RevisionSchema,
  type RevisionId,
  type RollbackInput,
  type SetAliasesInput,
  type SetTopologyInput,
  type UpsertBoardingPointInput,
  type UpsertPlacementInput,
  type UpsertTransferInput,
  type ValidationFinding,
  type ValidationReport,
} from "./model.js";

type RepositoryError = PersistenceError | ConflictError | NotFoundError | ValidationError;
type EditInput =
  | UpsertPlacementInput
  | SetAliasesInput
  | MapSourceStationInput
  | UpsertBoardingPointInput
  | SetTopologyInput
  | UpsertTransferInput;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Pick<Database, "all" | "run">;

class InternalConflict {
  readonly _tag = "InternalConflict";
  constructor(
    readonly revisionId: RevisionId,
    readonly expectedVersion: EditInput["expectedVersion"],
  ) {}
}

class InternalNotFound {
  readonly _tag = "InternalNotFound";
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {}
}

const iso = (value: DateTime.Utc) => DateTime.formatIso(value);

const mapRepositoryError = (operation: string, cause: unknown): RepositoryError => {
  if (cause instanceof InternalConflict) {
    return new ConflictError({
      revisionId: cause.revisionId,
      expectedVersion: cause.expectedVersion,
    });
  }
  if (cause instanceof InternalNotFound) {
    return new NotFoundError({ entity: cause.entity, id: cause.id });
  }
  return new PersistenceError({ operation, cause });
};

const repositoryPromise = <A>(operation: string, evaluate: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => mapRepositoryError(operation, cause),
  });

const loadRevision = async (executor: Executor, revisionId: number) => {
  const rows = await executor.all<{
    id: number;
    parentRevisionId: number | null;
    version: number;
    status: string;
    actor: string;
    notes: string;
    createdAt: string;
    publishedAt: string | null;
  }>(sql`
    select id, parent_revision_id as parentRevisionId, version, status, actor, notes,
           created_at as createdAt, published_at as publishedAt
    from curation_revisions where id = ${revisionId}
  `);
  const row = rows[0];
  if (!row) throw new InternalNotFound("Revision", String(revisionId));
  return row;
};

const loadSnapshotRows = async (executor: Executor, revisionId: number) => {
  const revision = await loadRevision(executor, revisionId);
  const placements = await executor.all(sql`
        select place_id as placeId, name, latitude_microdegrees as latitudeMicrodegrees,
               longitude_microdegrees as longitudeMicrodegrees,
               placement_status as placementStatus, notes
        from station_placements where revision_id = ${revisionId} order by place_id
      `);
  const mappings = await executor.all(sql`
        select source_station_id as sourceStationId, place_id as placeId
        from source_station_mappings where revision_id = ${revisionId}
        order by source_station_id
      `);
  const aliases = await executor.all(sql`
        select place_id as placeId, alias from station_aliases
        where revision_id = ${revisionId} order by place_id, alias
      `);
  const points = await executor.all(sql`
        select id, place_id as placeId, name,
               latitude_microdegrees as latitudeMicrodegrees,
               longitude_microdegrees as longitudeMicrodegrees,
               accessibility, notes
        from boarding_points where revision_id = ${revisionId} order by id
      `);
  const topologyRows = await executor.all<{
    id: string;
    lineId: string;
    mode: string;
    lineName: string;
    branch: string;
    direction: string;
    active: number;
  }>(sql`
        select t.id, t.line_id as lineId, l.mode, l.name as lineName,
               t.branch, t.direction, t.active
        from line_topologies t join curated_lines l on l.id = t.line_id
        where t.revision_id = ${revisionId} order by t.id
      `);
  const stopRows = await executor.all<{
    topologyId: string;
    sequence: number;
    placeId: string;
    boardingPointId: string | null;
  }>(sql`
        select topology_id as topologyId, sequence, place_id as placeId,
               boarding_point_id as boardingPointId
        from topology_stops where revision_id = ${revisionId}
        order by topology_id, sequence
      `);
  const transfers = await executor.all(sql`
        select id, from_place_id as fromPlaceId, to_place_id as toPlaceId,
               from_boarding_point_id as fromBoardingPointId,
               to_boarding_point_id as toBoardingPointId,
               walking_duration_seconds as walkingDurationSeconds,
               directionality, accessibility, verification_status as verificationStatus, notes
        from curated_transfers where revision_id = ${revisionId} order by id
      `);

  const topologies = topologyRows.map((topology) => ({
    id: topology.id,
    line: { id: topology.lineId, mode: topology.mode, name: topology.lineName },
    branch: topology.branch,
    direction: topology.direction,
    active: topology.active === 1,
    stops: stopRows
      .filter((stop) => stop.topologyId === topology.id)
      .map(({ placeId, boardingPointId }) => ({ placeId, boardingPointId })),
  }));

  return {
    revision,
    placements,
    sourceMappings: mappings,
    aliases,
    boardingPoints: points,
    topologies,
    transfers,
  };
};

const decodeSnapshot = (operation: string, rows: unknown) =>
  Schema.decodeUnknownEffect(CurationSnapshot)(rows).pipe(
    Effect.mapError((cause) => new PersistenceError({ operation, cause })),
  );

const validateSnapshot = (
  snapshot: CurationSnapshotType,
  disappearedSourceIds: ReadonlySet<string>,
): ValidationReport => {
  const findings: Array<ValidationFinding> = [];
  const placements = new Map(
    snapshot.placements.map((placement) => [placement.placeId, placement]),
  );
  const boardingPointIds = new Set(snapshot.boardingPoints.map((point) => point.id));

  for (const topology of snapshot.topologies.filter((item) => item.active)) {
    if (topology.stops.length < 2) {
      findings.push({
        severity: "Error",
        code: "MissingOrderedStops",
        message: `Active topology ${topology.id} must contain at least two ordered stops`,
        entityId: topology.id,
      });
    }
    for (const [index, stop] of topology.stops.entries()) {
      const placement = placements.get(stop.placeId);
      if (!placement || placement.placementStatus === "Unresolved") {
        findings.push({
          severity: "Error",
          code: "UnresolvedTopologyStation",
          message: `Topology ${topology.id} uses unresolved place ${stop.placeId}`,
          entityId: stop.placeId,
        });
      }
      const next = topology.stops[index + 1];
      if (next?.placeId === stop.placeId) {
        findings.push({
          severity: "Error",
          code: "DuplicateConsecutiveStop",
          message: `Topology ${topology.id} repeats ${stop.placeId} consecutively`,
          entityId: topology.id,
        });
      }
      if (
        placement !== undefined &&
        placement.latitudeMicrodegrees !== null &&
        placement.longitudeMicrodegrees !== null
      ) {
        const valid =
          Math.abs(placement.latitudeMicrodegrees) <= 90_000_000 &&
          Math.abs(placement.longitudeMicrodegrees) <= 180_000_000;
        if (!valid) {
          findings.push({
            severity: "Error",
            code: "ImpossibleCoordinates",
            message: `Place ${stop.placeId} has coordinates outside WGS84 bounds`,
            entityId: stop.placeId,
          });
        }
      }
      if (next) {
        const nextPlacement = placements.get(next.placeId);
        if (
          placement !== undefined &&
          placement.latitudeMicrodegrees !== null &&
          placement.longitudeMicrodegrees !== null &&
          nextPlacement !== undefined &&
          nextPlacement.latitudeMicrodegrees !== null &&
          nextPlacement.longitudeMicrodegrees !== null &&
          (Math.abs(placement.latitudeMicrodegrees - nextPlacement.latitudeMicrodegrees) >
            2_000_000 ||
            Math.abs(placement.longitudeMicrodegrees - nextPlacement.longitudeMicrodegrees) >
              2_000_000)
        ) {
          findings.push({
            severity: "Warning",
            code: "LargeGeographicJump",
            message: `Topology ${topology.id} has an unusually large jump after ${stop.placeId}`,
            entityId: topology.id,
          });
        }
      }
    }
  }

  for (const transfer of snapshot.transfers) {
    const dangling =
      !placements.has(transfer.fromPlaceId) ||
      !placements.has(transfer.toPlaceId) ||
      (transfer.fromBoardingPointId !== null &&
        !boardingPointIds.has(transfer.fromBoardingPointId)) ||
      (transfer.toBoardingPointId !== null && !boardingPointIds.has(transfer.toBoardingPointId));
    if (dangling) {
      findings.push({
        severity: "Error",
        code: "DanglingTransfer",
        message: `Transfer ${transfer.id} references an endpoint absent from this revision`,
        entityId: transfer.id,
      });
    }
  }

  for (const mapping of snapshot.sourceMappings) {
    if (disappearedSourceIds.has(mapping.sourceStationId)) {
      findings.push({
        severity: "Error",
        code: "DisappearedSourceRecord",
        message: `Mapped source station ${mapping.sourceStationId} is absent from its source's latest import`,
        entityId: mapping.sourceStationId,
      });
    }
  }

  return {
    revisionId: snapshot.revision.id,
    publishable: findings.every((finding) => finding.severity !== "Error"),
    findings,
  };
};

const loadDisappearedSourceIds = async (executor: Executor, revisionId: number) => {
  const rows = await executor.all<{ sourceStationId: string }>(sql`
    select m.source_station_id as sourceStationId
    from source_station_mappings m
    join source_stations s on s.id = m.source_station_id
    where m.revision_id = ${revisionId}
      and not exists (
        select 1
        from source_stations latest_station
        join import_runs latest_run on latest_run.id = latest_station.import_run_id
        where latest_run.status = 'Complete'
          and latest_station.source = s.source
          and latest_station.source_record_id = s.source_record_id
          and latest_run.retrieved_at = (
            select max(candidate.retrieved_at) from import_runs candidate
            where candidate.source = s.source and candidate.status = 'Complete'
          )
      )
  `);
  return new Set(rows.map((row) => row.sourceStationId));
};

const updateDraftVersion = async (tx: Transaction, input: EditInput, operation: string) => {
  const updated = await tx
    .update(curationRevisions)
    .set({ version: input.expectedVersion + 1 })
    .where(
      and(
        eq(curationRevisions.id, input.revisionId),
        eq(curationRevisions.version, input.expectedVersion),
        eq(curationRevisions.status, "Draft"),
      ),
    )
    .returning({ id: curationRevisions.id });
  if (updated.length === 0) {
    const existing = await tx
      .select({ id: curationRevisions.id })
      .from(curationRevisions)
      .where(eq(curationRevisions.id, input.revisionId));
    if (existing.length === 0) throw new InternalNotFound("Revision", String(input.revisionId));
    throw new InternalConflict(input.revisionId, input.expectedVersion);
  }
  await tx.insert(curationOperations).values({
    revisionId: input.revisionId,
    baseVersion: input.expectedVersion,
    resultingVersion: input.expectedVersion + 1,
    operation,
    actor: input.actor,
    notes: input.notes,
    createdAt: iso(input.editedAt),
  });
};

const copyRevision = async (tx: Transaction, fromRevisionId: number, toRevisionId: number) => {
  for (const statement of [
    sql`insert into station_placements select ${toRevisionId}, place_id, name, latitude_microdegrees, longitude_microdegrees, placement_status, notes from station_placements where revision_id = ${fromRevisionId}`,
    sql`insert into source_station_mappings select ${toRevisionId}, source_station_id, place_id from source_station_mappings where revision_id = ${fromRevisionId}`,
    sql`insert into station_aliases select ${toRevisionId}, place_id, alias from station_aliases where revision_id = ${fromRevisionId}`,
    sql`insert into boarding_points select ${toRevisionId}, id, place_id, name, latitude_microdegrees, longitude_microdegrees, accessibility, notes from boarding_points where revision_id = ${fromRevisionId}`,
    sql`insert into line_topologies select ${toRevisionId}, id, line_id, branch, direction, active from line_topologies where revision_id = ${fromRevisionId}`,
    sql`insert into topology_stops select ${toRevisionId}, topology_id, sequence, place_id, boarding_point_id from topology_stops where revision_id = ${fromRevisionId}`,
    sql`insert into curated_transfers select ${toRevisionId}, id, from_place_id, to_place_id, from_boarding_point_id, to_boarding_point_id, walking_duration_seconds, directionality, accessibility, verification_status, notes from curated_transfers where revision_id = ${fromRevisionId}`,
  ]) {
    await tx.run(statement);
  }
};

export interface Interface {
  readonly registerImport: (input: RegisterImportInput) => Effect.Effect<void, RepositoryError>;
  readonly createDraft: (input: CreateDraftInput) => Effect.Effect<Revision, RepositoryError>;
  readonly getRevision: (
    revisionId: RevisionId,
  ) => Effect.Effect<CurationSnapshotType, RepositoryError>;
  readonly getPublished: () => Effect.Effect<CurationSnapshotType, RepositoryError>;
  readonly upsertPlacement: (input: UpsertPlacementInput) => Effect.Effect<void, RepositoryError>;
  readonly setAliases: (input: SetAliasesInput) => Effect.Effect<void, RepositoryError>;
  readonly mapSourceStation: (input: MapSourceStationInput) => Effect.Effect<void, RepositoryError>;
  readonly upsertBoardingPoint: (
    input: UpsertBoardingPointInput,
  ) => Effect.Effect<void, RepositoryError>;
  readonly setTopology: (input: SetTopologyInput) => Effect.Effect<void, RepositoryError>;
  readonly upsertTransfer: (input: UpsertTransferInput) => Effect.Effect<void, RepositoryError>;
  readonly validate: (revisionId: RevisionId) => Effect.Effect<ValidationReport, RepositoryError>;
  readonly publish: (input: PublishInput) => Effect.Effect<CurationSnapshotType, RepositoryError>;
  readonly rollbackToNewDraft: (input: RollbackInput) => Effect.Effect<Revision, RepositoryError>;
}

export class Service extends Context.Service<Service, Interface>()("@transit/CurationRepository") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* CurationDatabase.Service;

    const registerImport = Effect.fn("CurationRepository.registerImport")(
      (input: RegisterImportInput) =>
        repositoryPromise("CurationRepository.registerImport", () =>
          db.transaction(async (tx) => {
            await tx.insert(importRuns).values({
              ...input.run,
              retrievedAt: iso(input.run.retrievedAt),
            });
            if (input.stations.length > 0) {
              await tx.insert(sourceStations).values([...input.stations]);
            }
          }),
        ),
    );

    const createDraft = Effect.fn("CurationRepository.createDraft")(function* (
      input: CreateDraftInput,
    ) {
      const row = yield* repositoryPromise("CurationRepository.createDraft", () =>
        db.transaction(async (tx) => {
          let baseRevisionId: number | undefined = input.baseRevisionId;
          if (baseRevisionId === undefined) {
            const published = await tx
              .select({ id: curationRevisions.id })
              .from(curationRevisions)
              .where(eq(curationRevisions.status, "Published"));
            baseRevisionId = published[0]?.id;
          } else {
            await loadRevision(tx, baseRevisionId);
          }
          const inserted = await tx
            .insert(curationRevisions)
            .values({
              parentRevisionId: baseRevisionId ?? null,
              version: 0,
              status: "Draft",
              actor: input.actor,
              notes: input.notes,
              createdAt: iso(input.createdAt),
            })
            .returning();
          const revision = inserted[0];
          if (!revision) throw new Error("D1 did not return the inserted revision");
          if (baseRevisionId !== undefined) await copyRevision(tx, baseRevisionId, revision.id);
          return revision;
        }),
      );
      return yield* Schema.decodeUnknownEffect(RevisionSchema)(row).pipe(
        Effect.mapError(
          (cause) =>
            new PersistenceError({ operation: "CurationRepository.createDraft.decode", cause }),
        ),
      );
    });

    const getRevision = Effect.fn("CurationRepository.getRevision")(function* (
      revisionId: RevisionId,
    ) {
      const rows = yield* repositoryPromise("CurationRepository.getRevision", () =>
        loadSnapshotRows(db, revisionId),
      );
      return yield* decodeSnapshot("CurationRepository.getRevision.decode", rows);
    });

    const getPublished = Effect.fn("CurationRepository.getPublished")(function* () {
      const rows = yield* repositoryPromise("CurationRepository.getPublished", async () => {
        const published = await db
          .select({ id: curationRevisions.id })
          .from(curationRevisions)
          .where(eq(curationRevisions.status, "Published"));
        const revision = published[0];
        if (!revision) throw new InternalNotFound("PublishedRevision", "current");
        return loadSnapshotRows(db, revision.id);
      });
      return yield* decodeSnapshot("CurationRepository.getPublished.decode", rows);
    });

    const upsertPlacement = Effect.fn("CurationRepository.upsertPlacement")(
      (input: UpsertPlacementInput) =>
        repositoryPromise("CurationRepository.upsertPlacement", () =>
          db.transaction(async (tx) => {
            await updateDraftVersion(tx, input, "UpsertPlacement");
            await tx
              .insert(physicalPlaces)
              .values({
                id: input.placement.placeId,
                createdAt: iso(input.editedAt),
                createdBy: input.actor,
              })
              .onConflictDoNothing();
            await tx
              .insert(stationPlacements)
              .values({ revisionId: input.revisionId, ...input.placement })
              .onConflictDoUpdate({
                target: [stationPlacements.revisionId, stationPlacements.placeId],
                set: {
                  name: input.placement.name,
                  latitudeMicrodegrees: input.placement.latitudeMicrodegrees,
                  longitudeMicrodegrees: input.placement.longitudeMicrodegrees,
                  placementStatus: input.placement.placementStatus,
                  notes: input.placement.notes,
                },
              });
          }),
        ),
    );

    const setAliases = Effect.fn("CurationRepository.setAliases")((input: SetAliasesInput) =>
      repositoryPromise("CurationRepository.setAliases", () =>
        db.transaction(async (tx) => {
          await updateDraftVersion(tx, input, "SetAliases");
          await tx
            .delete(stationAliases)
            .where(
              and(
                eq(stationAliases.revisionId, input.revisionId),
                eq(stationAliases.placeId, input.placeId),
              ),
            );
          const aliases = [...new Set(input.aliases.map((alias) => alias.trim()))].filter(Boolean);
          if (aliases.length > 0) {
            await tx.insert(stationAliases).values(
              aliases.map((alias) => ({
                revisionId: input.revisionId,
                placeId: input.placeId,
                alias,
              })),
            );
          }
        }),
      ),
    );

    const mapSourceStation = Effect.fn("CurationRepository.mapSourceStation")(
      (input: MapSourceStationInput) =>
        repositoryPromise("CurationRepository.mapSourceStation", () =>
          db.transaction(async (tx) => {
            await updateDraftVersion(tx, input, "MapSourceStation");
            await tx
              .insert(sourceStationMappings)
              .values({ revisionId: input.revisionId, ...input.mapping })
              .onConflictDoUpdate({
                target: [sourceStationMappings.revisionId, sourceStationMappings.sourceStationId],
                set: { placeId: input.mapping.placeId },
              });
          }),
        ),
    );

    const upsertBoardingPoint = Effect.fn("CurationRepository.upsertBoardingPoint")(
      (input: UpsertBoardingPointInput) =>
        repositoryPromise("CurationRepository.upsertBoardingPoint", () =>
          db.transaction(async (tx) => {
            await updateDraftVersion(tx, input, "UpsertBoardingPoint");
            await tx
              .insert(boardingPoints)
              .values({ revisionId: input.revisionId, ...input.boardingPoint })
              .onConflictDoUpdate({
                target: [boardingPoints.revisionId, boardingPoints.id],
                set: {
                  placeId: input.boardingPoint.placeId,
                  name: input.boardingPoint.name,
                  latitudeMicrodegrees: input.boardingPoint.latitudeMicrodegrees,
                  longitudeMicrodegrees: input.boardingPoint.longitudeMicrodegrees,
                  accessibility: input.boardingPoint.accessibility,
                  notes: input.boardingPoint.notes,
                },
              });
          }),
        ),
    );

    const setTopology = Effect.fn("CurationRepository.setTopology")((input: SetTopologyInput) =>
      repositoryPromise("CurationRepository.setTopology", () =>
        db.transaction(async (tx) => {
          await updateDraftVersion(tx, input, "SetTopology");
          await tx
            .insert(curatedLines)
            .values({
              ...input.topology.line,
              createdAt: iso(input.editedAt),
              createdBy: input.actor,
            })
            .onConflictDoUpdate({
              target: curatedLines.id,
              set: { name: input.topology.line.name, mode: input.topology.line.mode },
            });
          await tx
            .insert(lineTopologies)
            .values({
              revisionId: input.revisionId,
              id: input.topology.id,
              lineId: input.topology.line.id,
              branch: input.topology.branch,
              direction: input.topology.direction,
              active: input.topology.active,
            })
            .onConflictDoUpdate({
              target: [lineTopologies.revisionId, lineTopologies.id],
              set: {
                lineId: input.topology.line.id,
                branch: input.topology.branch,
                direction: input.topology.direction,
                active: input.topology.active,
              },
            });
          await tx
            .delete(topologyStops)
            .where(
              and(
                eq(topologyStops.revisionId, input.revisionId),
                eq(topologyStops.topologyId, input.topology.id),
              ),
            );
          if (input.topology.stops.length > 0) {
            await tx.insert(topologyStops).values(
              input.topology.stops.map((stop, sequence) => ({
                revisionId: input.revisionId,
                topologyId: input.topology.id,
                sequence,
                ...stop,
              })),
            );
          }
        }),
      ),
    );

    const upsertTransfer = Effect.fn("CurationRepository.upsertTransfer")(
      (input: UpsertTransferInput) =>
        repositoryPromise("CurationRepository.upsertTransfer", () =>
          db.transaction(async (tx) => {
            await updateDraftVersion(tx, input, "UpsertTransfer");
            await tx
              .insert(curatedTransfers)
              .values({ revisionId: input.revisionId, ...input.transfer })
              .onConflictDoUpdate({
                target: [curatedTransfers.revisionId, curatedTransfers.id],
                set: input.transfer,
              });
          }),
        ),
    );

    const validate = Effect.fn("CurationRepository.validate")(function* (revisionId: RevisionId) {
      const [rows, disappeared] = yield* Effect.all([
        repositoryPromise("CurationRepository.validate.snapshot", () =>
          loadSnapshotRows(db, revisionId),
        ),
        repositoryPromise("CurationRepository.validate.sources", () =>
          loadDisappearedSourceIds(db, revisionId),
        ),
      ]);
      const snapshot = yield* decodeSnapshot("CurationRepository.validate.decode", rows);
      return validateSnapshot(snapshot, disappeared);
    });

    const publish = Effect.fn("CurationRepository.publish")(function* (input: PublishInput) {
      const raw = yield* repositoryPromise("CurationRepository.publish.snapshot", () =>
        loadSnapshotRows(db, input.revisionId),
      );
      const snapshot = yield* decodeSnapshot("CurationRepository.publish.decodeInput", raw);
      const disappeared = yield* repositoryPromise("CurationRepository.publish.sources", () =>
        loadDisappearedSourceIds(db, input.revisionId),
      );
      const report = validateSnapshot(snapshot, disappeared);
      const blocking = report.findings.filter((finding) => finding.severity === "Error");
      if (blocking.length > 0) {
        return yield* new ValidationError({
          message: "The revision has blocking publication findings",
          findings: blocking,
        });
      }

      yield* repositoryPromise("CurationRepository.publish", async () => {
        const publishRevision = db.$client
          .prepare(`
          update curation_revisions
          set status = case when id = ? then 'Published' else 'Superseded' end,
              version = case when id = ? then ? else version end,
              published_at = case when id = ? then ? else published_at end
          where (id = ? or status = 'Published')
            and exists (
              select 1 from curation_revisions candidate
              where candidate.id = ?
                and candidate.status = 'Draft'
                and candidate.version = ?
            )
        `)
          .bind(
            input.revisionId,
            input.revisionId,
            input.expectedVersion + 1,
            input.revisionId,
            iso(input.publishedAt),
            input.revisionId,
            input.revisionId,
            input.expectedVersion,
          );
        const audit = db.$client
          .prepare(`
          insert into curation_operations
            (revision_id, base_version, resulting_version, operation, actor, notes, created_at)
          select ?, ?, ?, 'Publish', ?, ?, ?
          where exists (
            select 1 from curation_revisions
            where id = ?
              and status = 'Published'
              and version = ?
          )
        `)
          .bind(
            input.revisionId,
            input.expectedVersion,
            input.expectedVersion + 1,
            input.actor,
            input.notes,
            iso(input.publishedAt),
            input.revisionId,
            input.expectedVersion + 1,
          );
        await db.$client.batch([publishRevision, audit]);
        const published = await loadRevision(db, input.revisionId);
        if (published.status !== "Published" || published.version !== input.expectedVersion + 1) {
          throw new InternalConflict(input.revisionId, input.expectedVersion);
        }
      });

      const rows = yield* repositoryPromise("CurationRepository.publish.result", () =>
        loadSnapshotRows(db, input.revisionId),
      );
      return yield* decodeSnapshot("CurationRepository.publish.decode", rows);
    });

    const rollbackToNewDraft = Effect.fn("CurationRepository.rollbackToNewDraft")(function* (
      input: RollbackInput,
    ) {
      return yield* createDraft({
        actor: input.actor,
        notes: input.notes,
        createdAt: input.createdAt,
        baseRevisionId: input.revisionId,
      });
    });

    return Service.of({
      registerImport,
      createDraft,
      getRevision,
      getPublished,
      upsertPlacement,
      setAliases,
      mapSourceStation,
      upsertBoardingPoint,
      setTopology,
      upsertTransfer,
      validate,
      publish,
      rollbackToNewDraft,
    } satisfies Interface);
  }),
);

export * as CurationRepository from "./repository.js";
