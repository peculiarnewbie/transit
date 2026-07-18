import { Context, Effect, Layer } from "effect";

import { ConflictError, NotFoundError, PersistenceError, ValidationError } from "./errors.js";
import type {
  CreateDraftInput,
  CurationSnapshot,
  MapSourceStationInput,
  PublishInput,
  RegisterImportInput,
  Revision,
  RevisionId,
  RollbackInput,
  SetAliasesInput,
  SetTopologyInput,
  UpsertBoardingPointInput,
  UpsertPlacementInput,
  UpsertTransferInput,
  ValidationFinding,
  ValidationReport,
} from "./model.js";
import { CurationRepository } from "./repository.js";

type ServiceError = PersistenceError | ConflictError | NotFoundError | ValidationError;

export interface Interface {
  readonly registerImport: (input: RegisterImportInput) => Effect.Effect<void, ServiceError>;
  readonly createDraft: (input: CreateDraftInput) => Effect.Effect<Revision, ServiceError>;
  readonly preview: (revisionId: RevisionId) => Effect.Effect<CurationSnapshot, ServiceError>;
  readonly published: () => Effect.Effect<CurationSnapshot, ServiceError>;
  readonly upsertPlacement: (input: UpsertPlacementInput) => Effect.Effect<void, ServiceError>;
  readonly setAliases: (input: SetAliasesInput) => Effect.Effect<void, ServiceError>;
  readonly mapSourceStation: (input: MapSourceStationInput) => Effect.Effect<void, ServiceError>;
  readonly upsertBoardingPoint: (
    input: UpsertBoardingPointInput,
  ) => Effect.Effect<void, ServiceError>;
  readonly setTopology: (input: SetTopologyInput) => Effect.Effect<void, ServiceError>;
  readonly upsertTransfer: (input: UpsertTransferInput) => Effect.Effect<void, ServiceError>;
  readonly validate: (revisionId: RevisionId) => Effect.Effect<ValidationReport, ServiceError>;
  readonly publish: (input: PublishInput) => Effect.Effect<CurationSnapshot, ServiceError>;
  readonly rollbackToNewDraft: (input: RollbackInput) => Effect.Effect<Revision, ServiceError>;
}

export class Service extends Context.Service<Service, Interface>()("@transit/CurationService") {}

const invalidCoordinates = (
  entityId: string,
  latitude: number | null,
  longitude: number | null,
  status?: "Unresolved" | "Approximate" | "Verified",
): ReadonlyArray<ValidationFinding> => {
  const pairIsInvalid = (latitude === null) !== (longitude === null);
  const statusIsInvalid =
    status !== undefined &&
    ((status === "Unresolved" && latitude !== null) ||
      (status !== "Unresolved" && latitude === null));
  return pairIsInvalid || statusIsInvalid
    ? [
        {
          severity: "Error",
          code: "ImpossibleCoordinates",
          message: "Latitude and longitude must be supplied together and match placement status",
          entityId,
        },
      ]
    : [];
};

const failFindings = (findings: ReadonlyArray<ValidationFinding>) =>
  findings.length > 0
    ? Effect.fail(
        new ValidationError({
          message: "The edit is invalid",
          findings,
        }),
      )
    : Effect.void;

const layerWithoutRepository = Layer.effect(
  Service,
  Effect.gen(function* () {
    const repository = yield* CurationRepository.Service;

    const registerImport = Effect.fn("CurationService.registerImport")(repository.registerImport);
    const createDraft = Effect.fn("CurationService.createDraft")(repository.createDraft);
    const preview = Effect.fn("CurationService.preview")(repository.getRevision);
    const published = Effect.fn("CurationService.published")(repository.getPublished);

    const upsertPlacement = Effect.fn("CurationService.upsertPlacement")(function* (
      input: UpsertPlacementInput,
    ) {
      yield* failFindings(
        invalidCoordinates(
          input.placement.placeId,
          input.placement.latitudeMicrodegrees,
          input.placement.longitudeMicrodegrees,
          input.placement.placementStatus,
        ),
      );
      yield* repository.upsertPlacement(input);
    });

    const setAliases = Effect.fn("CurationService.setAliases")(repository.setAliases);
    const mapSourceStation = Effect.fn("CurationService.mapSourceStation")(
      repository.mapSourceStation,
    );

    const upsertBoardingPoint = Effect.fn("CurationService.upsertBoardingPoint")(function* (
      input: UpsertBoardingPointInput,
    ) {
      yield* failFindings(
        invalidCoordinates(
          input.boardingPoint.id,
          input.boardingPoint.latitudeMicrodegrees,
          input.boardingPoint.longitudeMicrodegrees,
        ),
      );
      yield* repository.upsertBoardingPoint(input);
    });

    const setTopology = Effect.fn("CurationService.setTopology")(repository.setTopology);
    const upsertTransfer = Effect.fn("CurationService.upsertTransfer")(repository.upsertTransfer);
    const validate = Effect.fn("CurationService.validate")(repository.validate);
    const publish = Effect.fn("CurationService.publish")(repository.publish);
    const rollbackToNewDraft = Effect.fn("CurationService.rollbackToNewDraft")(
      repository.rollbackToNewDraft,
    );

    return Service.of({
      registerImport,
      createDraft,
      preview,
      published,
      upsertPlacement,
      setAliases,
      mapSourceStation,
      upsertBoardingPoint,
      setTopology,
      upsertTransfer,
      validate,
      publish,
      rollbackToNewDraft,
    });
  }),
);

export const layer = layerWithoutRepository.pipe(Layer.provide(CurationRepository.layer));

export * as CurationService from "./service.js";
