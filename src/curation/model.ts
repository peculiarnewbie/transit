import { Schema } from "effect";

const stringId = (brand: string) =>
  Schema.String.check(Schema.isNonEmpty()).pipe(Schema.brand(brand));

export const PlaceId = stringId("PlaceId");
export type PlaceId = typeof PlaceId.Type;

export const BoardingPointId = stringId("BoardingPointId");
export type BoardingPointId = typeof BoardingPointId.Type;

export const CuratedLineId = stringId("CuratedLineId");
export type CuratedLineId = typeof CuratedLineId.Type;

export const TopologyId = stringId("TopologyId");
export type TopologyId = typeof TopologyId.Type;

export const CuratedTransferId = stringId("CuratedTransferId");
export type CuratedTransferId = typeof CuratedTransferId.Type;

export const ImportRunId = stringId("ImportRunId");
export type ImportRunId = typeof ImportRunId.Type;

export const ImportedSourceStationId = stringId("ImportedSourceStationId");
export type ImportedSourceStationId = typeof ImportedSourceStationId.Type;

export const RevisionId = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("CurationRevisionId"),
);
export type RevisionId = typeof RevisionId.Type;

export const RevisionVersion = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("CurationRevisionVersion"),
);
export type RevisionVersion = typeof RevisionVersion.Type;

export const Actor = Schema.String.check(Schema.isNonEmpty()).pipe(Schema.brand("CurationActor"));
export type Actor = typeof Actor.Type;

export const Timestamp = Schema.DateTimeUtcFromString;
export type Timestamp = typeof Timestamp.Type;

export const PlacementStatus = Schema.Literals(["Unresolved", "Approximate", "Verified"]);
export type PlacementStatus = typeof PlacementStatus.Type;

export const Accessibility = Schema.Literals(["Unknown", "Accessible", "Inaccessible"]);
export type Accessibility = typeof Accessibility.Type;

export const RevisionStatus = Schema.Literals(["Draft", "Published", "Superseded"]);

export const ImportRun = Schema.Struct({
  id: ImportRunId,
  source: Schema.String.check(Schema.isNonEmpty()),
  contentHash: Schema.String.check(Schema.isNonEmpty()),
  artifactRef: Schema.String.check(Schema.isNonEmpty()),
  retrievedAt: Timestamp,
  status: Schema.Literals(["Pending", "Complete", "Failed"]),
});
export interface ImportRun extends Schema.Schema.Type<typeof ImportRun> {}

export const ImportedSourceStation = Schema.Struct({
  id: ImportedSourceStationId,
  importRunId: ImportRunId,
  source: Schema.String.check(Schema.isNonEmpty()),
  sourceRecordId: Schema.String.check(Schema.isNonEmpty()),
  name: Schema.String.check(Schema.isNonEmpty()),
  contentHash: Schema.String.check(Schema.isNonEmpty()),
  artifactRef: Schema.String.check(Schema.isNonEmpty()),
});
export interface ImportedSourceStation extends Schema.Schema.Type<typeof ImportedSourceStation> {}

export const RegisterImportInput = Schema.Struct({
  run: ImportRun,
  stations: Schema.Array(ImportedSourceStation),
});
export interface RegisterImportInput extends Schema.Schema.Type<typeof RegisterImportInput> {}

export const Revision = Schema.Struct({
  id: RevisionId,
  parentRevisionId: Schema.NullOr(RevisionId),
  version: RevisionVersion,
  status: RevisionStatus,
  actor: Actor,
  notes: Schema.String,
  createdAt: Timestamp,
  publishedAt: Schema.NullOr(Timestamp),
});
export interface Revision extends Schema.Schema.Type<typeof Revision> {}

export const StationPlacement = Schema.Struct({
  placeId: PlaceId,
  name: Schema.String.check(Schema.isNonEmpty()),
  latitudeMicrodegrees: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: -90_000_000, maximum: 90_000_000 })),
  ),
  longitudeMicrodegrees: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: -180_000_000, maximum: 180_000_000 })),
  ),
  placementStatus: PlacementStatus,
  notes: Schema.String,
});
export interface StationPlacement extends Schema.Schema.Type<typeof StationPlacement> {}

export const SourceStationMapping = Schema.Struct({
  sourceStationId: ImportedSourceStationId,
  placeId: PlaceId,
});
export interface SourceStationMapping extends Schema.Schema.Type<typeof SourceStationMapping> {}

export const StationAlias = Schema.Struct({
  placeId: PlaceId,
  alias: Schema.String.check(Schema.isNonEmpty()),
});
export interface StationAlias extends Schema.Schema.Type<typeof StationAlias> {}

export const BoardingPoint = Schema.Struct({
  id: BoardingPointId,
  placeId: PlaceId,
  name: Schema.String.check(Schema.isNonEmpty()),
  latitudeMicrodegrees: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: -90_000_000, maximum: 90_000_000 })),
  ),
  longitudeMicrodegrees: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: -180_000_000, maximum: 180_000_000 })),
  ),
  accessibility: Accessibility,
  notes: Schema.String,
});
export interface BoardingPoint extends Schema.Schema.Type<typeof BoardingPoint> {}

export const CuratedLine = Schema.Struct({
  id: CuratedLineId,
  mode: Schema.Literals(["Bus", "CommuterRail", "Mrt", "Lrt"]),
  name: Schema.String.check(Schema.isNonEmpty()),
});
export interface CuratedLine extends Schema.Schema.Type<typeof CuratedLine> {}

export const TopologyStop = Schema.Struct({
  placeId: PlaceId,
  boardingPointId: Schema.NullOr(BoardingPointId),
});
export interface TopologyStop extends Schema.Schema.Type<typeof TopologyStop> {}

export const LineTopology = Schema.Struct({
  id: TopologyId,
  line: CuratedLine,
  branch: Schema.String,
  direction: Schema.String,
  active: Schema.Boolean,
  stops: Schema.Array(TopologyStop),
});
export interface LineTopology extends Schema.Schema.Type<typeof LineTopology> {}

export const CuratedTransfer = Schema.Struct({
  id: CuratedTransferId,
  fromPlaceId: PlaceId,
  toPlaceId: PlaceId,
  fromBoardingPointId: Schema.NullOr(BoardingPointId),
  toBoardingPointId: Schema.NullOr(BoardingPointId),
  walkingDurationSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
  directionality: Schema.Literals(["Directed", "Bidirectional"]),
  accessibility: Accessibility,
  verificationStatus: Schema.Literals(["Unverified", "Verified"]),
  notes: Schema.String,
});
export interface CuratedTransfer extends Schema.Schema.Type<typeof CuratedTransfer> {}

export const CurationSnapshot = Schema.Struct({
  revision: Revision,
  placements: Schema.Array(StationPlacement),
  sourceMappings: Schema.Array(SourceStationMapping),
  aliases: Schema.Array(StationAlias),
  boardingPoints: Schema.Array(BoardingPoint),
  topologies: Schema.Array(LineTopology),
  transfers: Schema.Array(CuratedTransfer),
});
export interface CurationSnapshot extends Schema.Schema.Type<typeof CurationSnapshot> {}

export const ValidationFinding = Schema.Struct({
  severity: Schema.Literals(["Error", "Warning"]),
  code: Schema.Literals([
    "UnresolvedTopologyStation",
    "MissingOrderedStops",
    "DuplicateConsecutiveStop",
    "DanglingTransfer",
    "ImpossibleCoordinates",
    "DisappearedSourceRecord",
    "LargeGeographicJump",
  ]),
  message: Schema.String.check(Schema.isNonEmpty()),
  entityId: Schema.String,
});
export interface ValidationFinding extends Schema.Schema.Type<typeof ValidationFinding> {}

export const ValidationReport = Schema.Struct({
  revisionId: RevisionId,
  publishable: Schema.Boolean,
  findings: Schema.Array(ValidationFinding),
});
export interface ValidationReport extends Schema.Schema.Type<typeof ValidationReport> {}

const EditMetadata = {
  revisionId: RevisionId,
  expectedVersion: RevisionVersion,
  actor: Actor,
  notes: Schema.String,
  editedAt: Timestamp,
};

export const CreateDraftInput = Schema.Struct({
  actor: Actor,
  notes: Schema.String,
  createdAt: Timestamp,
  baseRevisionId: Schema.optionalKey(RevisionId),
});
export interface CreateDraftInput extends Schema.Schema.Type<typeof CreateDraftInput> {}

export const UpsertPlacementInput = Schema.Struct({
  ...EditMetadata,
  placement: StationPlacement,
});
export interface UpsertPlacementInput extends Schema.Schema.Type<typeof UpsertPlacementInput> {}

export const SetAliasesInput = Schema.Struct({
  ...EditMetadata,
  placeId: PlaceId,
  aliases: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
});
export interface SetAliasesInput extends Schema.Schema.Type<typeof SetAliasesInput> {}

export const MapSourceStationInput = Schema.Struct({
  ...EditMetadata,
  mapping: SourceStationMapping,
});
export interface MapSourceStationInput extends Schema.Schema.Type<typeof MapSourceStationInput> {}

export const UpsertBoardingPointInput = Schema.Struct({
  ...EditMetadata,
  boardingPoint: BoardingPoint,
});
export interface UpsertBoardingPointInput extends Schema.Schema.Type<
  typeof UpsertBoardingPointInput
> {}

export const SetTopologyInput = Schema.Struct({
  ...EditMetadata,
  topology: LineTopology,
});
export interface SetTopologyInput extends Schema.Schema.Type<typeof SetTopologyInput> {}

export const UpsertTransferInput = Schema.Struct({
  ...EditMetadata,
  transfer: CuratedTransfer,
});
export interface UpsertTransferInput extends Schema.Schema.Type<typeof UpsertTransferInput> {}

export const PublishInput = Schema.Struct({
  revisionId: RevisionId,
  expectedVersion: RevisionVersion,
  actor: Actor,
  notes: Schema.String,
  publishedAt: Timestamp,
});
export interface PublishInput extends Schema.Schema.Type<typeof PublishInput> {}

export const RollbackInput = Schema.Struct({
  revisionId: RevisionId,
  actor: Actor,
  notes: Schema.String,
  createdAt: Timestamp,
});
export interface RollbackInput extends Schema.Schema.Type<typeof RollbackInput> {}
