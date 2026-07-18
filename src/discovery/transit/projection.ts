import { Context, Effect, Layer, Schema } from "effect";

import { NetworkSnapshot, SourceRef, StopId, type Stop } from "../../domain/transit/index.js";
import { TransitPlaceId } from "./ids.js";
import { ReviewedComplexOverrideSet, type ReviewedComplexOverride } from "./reviewed-override.js";
import {
  DuplicateMembership,
  MalformedMembership,
  MissingRepresentativeCoordinate,
  TransitPlace,
  TransitPlaceIndex,
  type TransitPlaceError,
  type UnresolvedGroupingFinding,
} from "./transit-place.js";

export interface ProjectOptions {
  readonly snapshot: unknown;
  readonly sourceArtifactVersion: string;
  readonly overrides?: unknown;
}

export interface ValidationReport {
  readonly placeCount: number;
  readonly sourceParentGroupCount: number;
  readonly standaloneCount: number;
  readonly reviewedComplexCount: number;
  readonly unresolvedFindingCount: number;
  readonly findings: ReadonlyArray<UnresolvedGroupingFinding>;
}

export interface Interface {
  readonly project: (
    options: ProjectOptions,
  ) => Effect.Effect<TransitPlaceIndex, TransitPlaceError>;
  readonly validationReport: (index: TransitPlaceIndex) => Effect.Effect<ValidationReport, never>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@transit/TransitPlaceProjection",
) {}

const haversineMeters = (
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) => {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const earth = 6_371_000;
  const dLat = toRad(right.latitude - left.latitude);
  const dLon = toRad(right.longitude - left.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(left.latitude)) * Math.cos(toRad(right.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
};

const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(jalur|platform|halte|stasiun|terminal)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const nameTokens = (name: string) =>
  new Set(
    normalizeName(name)
      .split(" ")
      .filter(
        (token: string) =>
          token.length > 2 && !["arah", "barat", "timur", "utara", "selatan"].includes(token),
      ),
  );

const namesRelated = (left: string, right: string) => {
  const leftName = normalizeName(left);
  const rightName = normalizeName(right);
  if (leftName.length === 0 || rightName.length === 0) return false;
  if (leftName === rightName || leftName.includes(rightName) || rightName.includes(leftName)) {
    return true;
  }
  const leftTokens = nameTokens(left);
  const rightTokens = nameTokens(right);
  for (const token of leftTokens) {
    if (rightTokens.has(token)) return true;
  }
  return false;
};
const placedCoordinate = (stop: Stop) =>
  stop.location._tag === "Placed"
    ? { latitude: stop.location.latitude, longitude: stop.location.longitude }
    : undefined;

const servedRoutesByStop = (snapshot: NetworkSnapshot) => {
  const routeByPattern = new Map(snapshot.patterns.map((pattern) => [pattern.id, pattern.routeId]));
  const served = new Map<string, Set<string>>();
  for (const trip of snapshot.trips) {
    const routeId = routeByPattern.get(trip.patternId);
    if (routeId === undefined) continue;
    const pattern = snapshot.patterns.find((candidate) => candidate.id === trip.patternId);
    if (pattern === undefined) continue;
    for (const stopId of pattern.stopIds) {
      const routes = served.get(stopId) ?? new Set<string>();
      routes.add(routeId);
      served.set(stopId, routes);
    }
  }
  return served;
};

const chooseRepresentative = (members: ReadonlyArray<Stop>) => {
  const station = members.find((stop) => stop.locationKind === "Station" && placedCoordinate(stop));
  if (station !== undefined) return station.location;
  const placed = members
    .map((stop) => placedCoordinate(stop))
    .filter(
      (coordinate): coordinate is { latitude: number; longitude: number } =>
        coordinate !== undefined,
    )
    .sort((left, right) => left.latitude - right.latitude || left.longitude - right.longitude);
  if (placed.length === 0) return undefined;
  const mid = placed[Math.floor((placed.length - 1) / 2)]!;
  return { _tag: "Placed" as const, latitude: mid.latitude, longitude: mid.longitude };
};

const platformSummary = (members: ReadonlyArray<Stop>) => {
  const codes = [
    ...new Set(
      members.map((stop) => stop.platformCode).filter((code): code is string => code !== undefined),
    ),
  ].sort((left, right) => left.localeCompare(right));
  if (codes.length === 0 && members.length <= 1) return undefined;
  return { codes, memberCount: members.length };
};

const buildPlace = Effect.fn("TransitPlaceProjection.buildPlace")(function* (input: {
  id: string;
  members: ReadonlyArray<Stop>;
  groupingEvidence: TransitPlace["groupingEvidence"];
  parentStationStopId?: StopId;
  aliases?: ReadonlyArray<string>;
  primaryName?: string;
  served: ReadonlyMap<string, Set<string>>;
}) {
  const sortedMembers = [...input.members].sort((left, right) => left.id.localeCompare(right.id));
  const representativeLocation = chooseRepresentative(sortedMembers);
  if (representativeLocation === undefined) {
    return yield* Effect.fail(
      new MissingRepresentativeCoordinate({
        transitPlaceId: input.id as typeof TransitPlaceId.Type,
        memberStopIds: sortedMembers.map((stop) => stop.id),
      }),
    );
  }
  const servedRouteIds = [
    ...new Set(
      sortedMembers.flatMap((stop) => [...(input.served.get(stop.id) ?? new Set<string>())]),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const primary =
    input.primaryName ??
    sortedMembers.find((stop) => stop.locationKind === "Station")?.name ??
    sortedMembers[0]!.name;
  const summary = platformSummary(sortedMembers);
  const sourceRefs = yield* Effect.forEach(
    sortedMembers.flatMap((stop) => stop.sourceRefs),
    (ref) =>
      Schema.encodeEffect(SourceRef)(ref).pipe(
        Effect.mapError(
          (error) =>
            new MalformedMembership({
              stopId: sortedMembers[0]!.id,
              reason: `SourceRef encode failed: ${String(error)}`,
            }),
        ),
      ),
    { concurrency: 1 },
  );
  return yield* Schema.decodeUnknownEffect(TransitPlace)({
    id: input.id,
    primaryName: primary,
    aliases: [...(input.aliases ?? [])].sort((left, right) => left.localeCompare(right)),
    representativeLocation,
    memberStopIds: sortedMembers.map((stop) => stop.id),
    ...(input.parentStationStopId === undefined
      ? {}
      : { parentStationStopId: input.parentStationStopId }),
    ...(summary === undefined ? {} : { platformSummary: summary }),
    servedRouteIds,
    sourceRefs,
    groupingEvidence: input.groupingEvidence,
  }).pipe(
    Effect.mapError(
      (error) =>
        new MalformedMembership({
          stopId: sortedMembers[0]!.id,
          reason: `Transit place decode failed: ${String(error)}`,
        }),
    ),
  );
});

const proposeComplexes = (
  standalone: ReadonlyArray<Stop>,
  served: ReadonlyMap<string, Set<string>>,
) => {
  const findings: Array<UnresolvedGroupingFinding> = [];
  const candidates = standalone.filter((stop) => placedCoordinate(stop) !== undefined);
  const used = new Set<string>();
  for (let index = 0; index < candidates.length; index += 1) {
    const seed = candidates[index]!;
    if (used.has(seed.id)) continue;
    const group = [seed];
    const seedCoord = placedCoordinate(seed)!;
    const seedRoutes = served.get(seed.id) ?? new Set<string>();
    for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex += 1) {
      const other = candidates[otherIndex]!;
      if (used.has(other.id)) continue;
      const otherCoord = placedCoordinate(other)!;
      const distance = haversineMeters(seedCoord, otherCoord);
      if (distance > 75) continue;
      const nameRelated = namesRelated(seed.name, other.name);
      const otherRoutes = served.get(other.id) ?? new Set<string>();
      const overlappingRoutes = [...seedRoutes].some((routeId) => otherRoutes.has(routeId));
      const platformHint =
        (seed.platformCode !== undefined || other.platformCode !== undefined) && nameRelated;
      if ((nameRelated && overlappingRoutes) || platformHint) {
        group.push(other);
      }
    }
    if (group.length < 2) continue;
    for (const member of group) used.add(member.id);
    findings.push({
      _tag: "ProposedComplex",
      candidateStopIds: group
        .map((stop) => stop.id)
        .sort((left, right) => left.localeCompare(right)),
      reasons: [
        "proximity_within_75m",
        "normalized_name_overlap",
        "overlapping_or_platform_evidence",
      ],
    });
  }
  return findings;
};

export const project = Effect.fn("TransitPlaceProjection.project")(function* (
  options: ProjectOptions,
) {
  const snapshot = yield* Schema.decodeUnknownEffect(NetworkSnapshot)(options.snapshot).pipe(
    Effect.mapError(
      (error) =>
        new MalformedMembership({
          stopId: StopId.make("stop:unknown"),
          reason: `NetworkSnapshot decode failed: ${String(error)}`,
        }),
    ),
  );
  const overrideSet =
    options.overrides === undefined
      ? undefined
      : yield* Schema.decodeUnknownEffect(ReviewedComplexOverrideSet)(options.overrides).pipe(
          Effect.mapError(
            (error) =>
              new MalformedMembership({
                stopId: StopId.make("stop:unknown"),
                reason: `Override decode failed: ${String(error)}`,
              }),
          ),
        );

  if (
    overrideSet !== undefined &&
    overrideSet.sourceArtifactVersion !== options.sourceArtifactVersion
  ) {
    return yield* Effect.fail(
      new MalformedMembership({
        stopId: StopId.make("stop:unknown"),
        reason: `Reviewed overrides target ${overrideSet.sourceArtifactVersion}, not ${options.sourceArtifactVersion}`,
      }),
    );
  }

  const stopById = new Map<string, Stop>(snapshot.stops.map((stop) => [stop.id, stop]));
  const served = servedRoutesByStop(snapshot);
  const claimed = new Set<string>();
  const places: Array<TransitPlace> = [];
  const findings: Array<UnresolvedGroupingFinding> = [];

  for (const stop of snapshot.stops) {
    if (stop.parentStopId === undefined) continue;
    const parent = stopById.get(stop.parentStopId);
    if (parent === undefined) {
      return yield* Effect.fail(
        new MalformedMembership({
          stopId: stop.id,
          reason: `Missing parent stop ${stop.parentStopId}`,
        }),
      );
    }
    if (parent.locationKind !== "Station" && parent.locationKind !== "Stop") {
      return yield* Effect.fail(
        new MalformedMembership({
          stopId: stop.id,
          reason: `Parent ${parent.id} has unsupported kind ${parent.locationKind}`,
        }),
      );
    }
  }

  const childrenByParent = new Map<string, Array<Stop>>();
  for (const stop of snapshot.stops) {
    if (stop.parentStopId === undefined) continue;
    const children = childrenByParent.get(stop.parentStopId) ?? [];
    children.push(stop);
    childrenByParent.set(stop.parentStopId, children);
  }

  for (const [parentId, children] of [...childrenByParent.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const parent = stopById.get(parentId);
    if (parent === undefined) continue;
    const members = [parent, ...children];
    for (const member of members) {
      if (claimed.has(member.id)) {
        return yield* Effect.fail(
          new DuplicateMembership({
            stopId: member.id,
            placeIds: [`place:source:${parentId}`],
          }),
        );
      }
      claimed.add(member.id);
    }
    places.push(
      yield* buildPlace({
        id: `place:source:${parentId}`,
        members,
        parentStationStopId: parent.id,
        groupingEvidence: { _tag: "SourceParent", parentStopId: parent.id },
        served,
      }),
    );
  }

  const overrides = [...(overrideSet?.overrides ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  for (const override of overrides) {
    const members = [];
    for (const stopId of override.memberStopIds) {
      const stop = stopById.get(stopId);
      if (stop === undefined) {
        return yield* Effect.fail(
          new MalformedMembership({
            stopId,
            reason: `Reviewed override ${override.id} references missing stop`,
          }),
        );
      }
      if (claimed.has(stop.id)) {
        return yield* Effect.fail(
          new DuplicateMembership({
            stopId: stop.id,
            placeIds: [`place:reviewed:${override.id}`],
          }),
        );
      }
      members.push(stop);
    }
    for (const member of members) claimed.add(member.id);
    places.push(
      yield* buildPlace({
        id: `place:reviewed:${override.id}`,
        members,
        primaryName: override.primaryName,
        aliases: override.aliases,
        groupingEvidence: {
          _tag: "ReviewedComplex",
          overrideId: override.id,
          rationale: override.rationale,
          sourceArtifactVersion: override.sourceArtifactVersion,
        },
        served,
      }),
    );
  }

  const remaining = snapshot.stops
    .filter((stop) => !claimed.has(stop.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  findings.push(...proposeComplexes(remaining, served));

  for (const stop of remaining) {
    claimed.add(stop.id);
    places.push(
      yield* buildPlace({
        id: `place:standalone:${stop.id}`,
        members: [stop],
        groupingEvidence: { _tag: "Standalone" },
        served,
      }),
    );
  }

  const placesById: Record<string, TransitPlace> = {};
  const placeIdByStopId: Record<string, string> = {};
  for (const place of places.sort((left, right) => left.id.localeCompare(right.id))) {
    placesById[place.id] = place;
    for (const stopId of place.memberStopIds) {
      if (placeIdByStopId[stopId] !== undefined) {
        return yield* Effect.fail(
          new DuplicateMembership({
            stopId,
            placeIds: [placeIdByStopId[stopId] as never, place.id],
          }),
        );
      }
      placeIdByStopId[stopId] = place.id;
    }
  }

  for (const stop of snapshot.stops) {
    if (placeIdByStopId[stop.id] === undefined) {
      return yield* Effect.fail(
        new MalformedMembership({
          stopId: stop.id,
          reason: "Stop was not assigned to exactly one transit place",
        }),
      );
    }
  }

  return {
    schemaVersion: "1" as const,
    sourceArtifactVersion: options.sourceArtifactVersion,
    placesById,
    placeIdByStopId,
    unresolvedFindings: findings,
  } satisfies TransitPlaceIndex;
});

const validationReport = Effect.fn("TransitPlaceProjection.validationReport")(function* (
  index: TransitPlaceIndex,
) {
  const places = Object.values(index.placesById);
  return yield* Effect.succeed({
    placeCount: places.length,
    sourceParentGroupCount: places.filter((place) => place.groupingEvidence._tag === "SourceParent")
      .length,
    standaloneCount: places.filter((place) => place.groupingEvidence._tag === "Standalone").length,
    reviewedComplexCount: places.filter(
      (place) => place.groupingEvidence._tag === "ReviewedComplex",
    ).length,
    unresolvedFindingCount: index.unresolvedFindings.length,
    findings: index.unresolvedFindings,
  } satisfies ValidationReport);
});

export const layer = Layer.succeed(
  Service,
  Service.of({
    project,
    validationReport,
  }),
);

export const testLayer = layer;

export type { ReviewedComplexOverride };
