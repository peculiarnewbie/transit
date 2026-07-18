import { Effect, Schema } from "effect";

import {
  load as loadRouteHelperCorpus,
  type RouteGuideCase,
} from "../acceptance/route-helper/index.js";
import type { TransitPlace } from "../discovery/transit/transit-place.js";
import type { GuideGraph } from "./graph.js";
import { compileGuideGraph } from "./graph.js";
import { projectInstructions } from "./instructions.js";
import type { GuideAlternative, RouteGuideResult } from "./model.js";
import { searchGuidePaths } from "./search.js";

export const QualificationCaseResult = Schema.Struct({
  caseId: Schema.String,
  outcome: Schema.Literals(["Supported", "KnownGap"]),
  categories: Schema.Array(Schema.String),
  status: Schema.Literals([
    "Matched",
    "NoRoute",
    "Mismatch",
    "UnresolvedPlace",
    "ExpectedGap",
    "UnexpectedSuccess",
  ]),
  selectedSequence: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        lines: Schema.Array(Schema.String),
        directions: Schema.Array(Schema.String),
        boarding: Schema.String,
        alighting: Schema.String,
      }),
    ),
  ),
  detail: Schema.String,
  latencyMs: Schema.Number,
});
export interface QualificationCaseResult extends Schema.Schema.Type<
  typeof QualificationCaseResult
> {}

export const RouteGuideQualificationReport = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  networkArtifact: Schema.String,
  transitPlaceSourceArtifactVersion: Schema.String,
  overrideArtifact: Schema.optionalKey(Schema.String),
  corpusManifestVersion: Schema.String,
  generatedAt: Schema.String,
  graph: Schema.Struct({
    patternCount: Schema.Int,
    placeCount: Schema.Int,
    transferEdgeEndpointCount: Schema.Int,
    indexTimeMs: Schema.Number,
    duplicateSequenceCollapseCount: Schema.Int,
    findingCounts: Schema.Record(Schema.String, Schema.Int),
  }),
  directionEvidence: Schema.Struct({
    authoritative: Schema.Int,
    reviewed: Schema.Int,
    fallback: Schema.Int,
    ambiguous: Schema.Int,
  }),
  interchangeableGroups: Schema.Struct({
    groupCount: Schema.Int,
    memberLineExamples: Schema.Array(Schema.Array(Schema.String)),
  }),
  queryLatencyMs: Schema.Struct({
    p50: Schema.Number,
    p95: Schema.Number,
    max: Schema.Number,
  }),
  countsByCategory: Schema.Record(
    Schema.String,
    Schema.Struct({
      matched: Schema.Int,
      mismatch: Schema.Int,
      noRoute: Schema.Int,
      expectedGap: Schema.Int,
    }),
  ),
  cases: Schema.Array(QualificationCaseResult),
});
export interface RouteGuideQualificationReport extends Schema.Schema.Type<
  typeof RouteGuideQualificationReport
> {}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface PlaceLabelAlias {
  readonly label: string;
  readonly alsoMatchPlaceNames: ReadonlyArray<string>;
}

/**
 * Word-boundary-aware "starts with" check. Plain `String#startsWith` treats
 * "kampus ui" as a prefix of "kampus uin 1" because "ui" is a character
 * prefix of "uin" — that falsely resolved "Universitas Indonesia" (UI Depok)
 * to "Kampus Uin 1/2" (an unrelated Islamic university campus). Comparing
 * whitespace-delimited words instead of raw characters fixes that class of
 * false positive while still matching genuine word-level prefixes (e.g.
 * "blok m" against "blok m jalur 2").
 */
const startsWithWords = (haystack: string, needle: string): boolean => {
  const haystackWords = haystack.split(" ");
  const needleWords = needle.split(" ");
  if (needleWords.length > haystackWords.length) return false;
  return needleWords.every((word, index) => haystackWords[index] === word);
};

export const resolvePlacesByLabel = (
  graph: GuideGraph,
  label: string,
  aliases: ReadonlyArray<PlaceLabelAlias> = [],
): ReadonlyArray<TransitPlace> => {
  const needles = new Set<string>([normalize(label)]);
  for (const alias of aliases) {
    if (normalize(alias.label) === normalize(label)) {
      for (const name of alias.alsoMatchPlaceNames) needles.add(normalize(name));
    }
  }

  const places = [...graph.placesById.values()];
  const scored: Array<{ place: TransitPlace; score: number }> = [];
  for (const place of places) {
    const primary = normalize(place.primaryName);
    const aliasNames = place.aliases.map(normalize);
    let score = 0;
    for (const needle of needles) {
      if (primary === needle) score = Math.max(score, 100);
      else if (aliasNames.includes(needle)) score = Math.max(score, 90);
      else if (startsWithWords(primary, needle) || startsWithWords(needle, primary))
        score = Math.max(score, 70);
      else if (primary.includes(needle) || needle.includes(primary)) score = Math.max(score, 40);
      else if (aliasNames.some((alias) => alias.includes(needle) || needle.includes(alias))) {
        score = Math.max(score, 35);
      }
    }
    if (score > 0) {
      if (place.groupingEvidence._tag === "SourceParent") score += 5;
      if (place.groupingEvidence._tag === "ReviewedComplex") score += 8;
      score += Math.min(10, place.servedRouteIds.length);
      scored.push({ place, score });
    }
  }
  return scored
    .sort((left, right) => right.score - left.score || left.place.id.localeCompare(right.place.id))
    .filter((entry, index, all) => {
      const best = all[0]?.score ?? 0;
      if (best >= 90) return entry.score >= 90;
      if (best >= 70) return entry.score >= 70;
      return index < 6;
    })
    .map((entry) => entry.place)
    .slice(0, 8);
};

/**
 * Corpus cases can author multiple acceptable boarding/alighting labels
 * (`requiredBoardingLabels`/`requiredAlightingLabels`) for a single origin or
 * destination — e.g. a terminal-platform label alongside its parent stop
 * label, or an area label alongside the corridor stop passengers actually
 * board at. Resolve every declared label and merge the candidate places so
 * qualification reflects the full set of boarding options the corpus author
 * intended, not just `origin.label`/`destination.label`.
 */
const resolvePlacesByAnyLabel = (
  graph: GuideGraph,
  labels: ReadonlyArray<string>,
  aliases: ReadonlyArray<PlaceLabelAlias>,
): ReadonlyArray<TransitPlace> => {
  const seen = new Set<string>();
  const merged: Array<TransitPlace> = [];
  for (const label of labels) {
    for (const place of resolvePlacesByLabel(graph, label, aliases)) {
      if (seen.has(place.id)) continue;
      seen.add(place.id);
      merged.push(place);
    }
  }
  return merged;
};

const sequenceFromAlternative = (alternative: GuideAlternative) =>
  alternative.rideSteps.map((step) => ({
    lines: step.lineOptions.map((option) => option.passengerLineName),
    directions: step.lineOptions.map((option) => option.directionLabel),
    boarding: step.boarding.placeName,
    alighting: step.alighting.placeName,
  }));

const lineSetEqual = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) => {
  const a = [...left].map(normalize).sort();
  const b = [...right].map(normalize).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

const placeMatches = (
  actual: string,
  expected: string,
  aliases: ReadonlyArray<PlaceLabelAlias>,
) => {
  const left = normalize(actual);
  const right = normalize(expected);
  if (left === right || left.includes(right) || right.includes(left)) return true;
  for (const alias of aliases) {
    if (
      normalize(alias.label) !== right &&
      !alias.alsoMatchPlaceNames.some((name) => normalize(name) === right)
    ) {
      continue;
    }
    const names = [alias.label, ...alias.alsoMatchPlaceNames].map(normalize);
    if (names.some((name) => left === name || left.includes(name) || name.includes(left))) {
      return true;
    }
  }
  return false;
};

const matchesAcceptable = (
  alternative: GuideAlternative,
  routeCase: RouteGuideCase,
  aliases: ReadonlyArray<PlaceLabelAlias>,
): boolean => {
  if (routeCase.acceptableSequences.length === 0) return false;
  const actual = sequenceFromAlternative(alternative);
  return routeCase.acceptableSequences.some((acceptable) => {
    if (acceptable.steps.length !== actual.length) return false;
    return acceptable.steps.every((step, index) => {
      const got = actual[index];
      if (got === undefined) return false;
      const expectedLines = step.lineOptions.map((option) => option.line);
      if (!lineSetEqual(got.lines, expectedLines)) return false;
      if (!placeMatches(got.boarding, step.boardingPlaceLabel, aliases)) return false;
      if (!placeMatches(got.alighting, step.alightingPlaceLabel, aliases)) return false;
      return true;
    });
  });
};

const percentile = (values: ReadonlyArray<number>, ratio: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio));
  return sorted[index]!;
};

export interface QualifyOptions {
  readonly snapshot: unknown;
  readonly networkArtifact: string;
  readonly sourceArtifactVersion: string;
  readonly overrides?: unknown;
  readonly overrideArtifact?: string;
  readonly placeLabelAliases?: ReadonlyArray<PlaceLabelAlias>;
  readonly corpus: {
    readonly manifest: unknown;
    readonly placeSearchCases: unknown;
    readonly routeGuideCases: unknown;
    readonly usabilityTasks: unknown;
  };
}

export const qualifyRouteGuide = Effect.fn("RouteGuide.qualify")(function* (
  options: QualifyOptions,
) {
  const indexStarted = Date.now();
  const graph = yield* compileGuideGraph({
    snapshot: options.snapshot,
    sourceArtifactVersion: options.sourceArtifactVersion,
    ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
  });
  const indexTimeMs = Date.now() - indexStarted;

  const corpus = yield* loadRouteHelperCorpus(options.corpus);
  const caseResults: Array<QualificationCaseResult> = [];
  const latencies: Array<number> = [];
  let interchangeableGroupCount = 0;
  const memberLineExamples: Array<ReadonlyArray<string>> = [];

  const aliases = options.placeLabelAliases ?? [];
  for (const routeCase of corpus.routeGuideCases) {
    const started = Date.now();
    const origins = resolvePlacesByAnyLabel(
      graph,
      [routeCase.origin.label, ...routeCase.requiredBoardingLabels],
      aliases,
    );
    const destinations = resolvePlacesByAnyLabel(
      graph,
      [routeCase.destination.label, ...routeCase.requiredAlightingLabels],
      aliases,
    );
    if (origins.length === 0 || destinations.length === 0) {
      const latencyMs = Date.now() - started;
      latencies.push(latencyMs);
      caseResults.push({
        caseId: routeCase.id,
        outcome: routeCase.outcome,
        categories: routeCase.categories,
        status: "UnresolvedPlace",
        detail: `Could not resolve places for ${routeCase.origin.label} → ${routeCase.destination.label}`,
        latencyMs,
      });
      continue;
    }

    const result: RouteGuideResult = yield* searchGuidePaths(graph, {
      origins: origins.slice(0, 4).map((place, index) => ({
        transitPlaceId: place.id,
        geographicDistanceMeters: index * 10,
      })),
      destinations: destinations.slice(0, 4).map((place, index) => ({
        transitPlaceId: place.id,
        geographicDistanceMeters: index * 10,
      })),
      maximumTransfers: Math.min(3, routeCase.maximumTransferCount),
      maximumOriginCandidates: 4,
      maximumDestinationCandidates: 4,
      maximumAlternatives: 16,
      maximumExpandedStates: 100_000,
    });
    const latencyMs = Date.now() - started;
    latencies.push(latencyMs);

    if (result._tag !== "GuidesFound") {
      caseResults.push({
        caseId: routeCase.id,
        outcome: routeCase.outcome,
        categories: routeCase.categories,
        status: routeCase.outcome === "KnownGap" ? "ExpectedGap" : "NoRoute",
        detail: result._tag === "NoTopologicalRoute" ? result.reason : result._tag,
        latencyMs,
      });
      continue;
    }

    for (const alternative of result.alternatives) {
      for (const step of alternative.rideSteps) {
        if (step.lineOptions.length > 1) {
          interchangeableGroupCount += 1;
          if (memberLineExamples.length < 12) {
            memberLineExamples.push(step.lineOptions.map((option) => option.passengerLineName));
          }
        }
      }
    }

    const matched = result.alternatives.find((alternative) =>
      matchesAcceptable(alternative, routeCase, aliases),
    );
    if (routeCase.outcome === "KnownGap") {
      caseResults.push({
        caseId: routeCase.id,
        outcome: routeCase.outcome,
        categories: routeCase.categories,
        status: "UnexpectedSuccess",
        selectedSequence: sequenceFromAlternative(result.alternatives[0]!),
        detail: "KnownGap case returned a guide",
        latencyMs,
      });
      continue;
    }

    if (matched !== undefined) {
      const instructions = projectInstructions(matched);
      caseResults.push({
        caseId: routeCase.id,
        outcome: routeCase.outcome,
        categories: routeCase.categories,
        status: "Matched",
        selectedSequence: sequenceFromAlternative(matched),
        detail: instructions.sharedLinePhrase.join(" | "),
        latencyMs,
      });
    } else {
      caseResults.push({
        caseId: routeCase.id,
        outcome: routeCase.outcome,
        categories: routeCase.categories,
        status: "Mismatch",
        selectedSequence: sequenceFromAlternative(result.alternatives[0]!),
        detail: "No alternative matched reviewed acceptable sequences",
        latencyMs,
      });
    }
  }

  const findingCounts: Record<string, number> = {};
  for (const finding of graph.findings) {
    findingCounts[finding._tag] = (findingCounts[finding._tag] ?? 0) + 1;
  }

  let authoritative = 0;
  let reviewed = 0;
  let fallback = 0;
  let ambiguous = 0;
  for (const pattern of graph.patterns) {
    if (pattern.direction.authority === "Authoritative") authoritative += 1;
    else if (pattern.direction.authority === "Reviewed") reviewed += 1;
    else if (pattern.direction.authority === "Fallback") fallback += 1;
    else ambiguous += 1;
  }

  const countsByCategory: Record<
    string,
    { matched: number; mismatch: number; noRoute: number; expectedGap: number }
  > = {};
  const bump = (category: string, field: "matched" | "mismatch" | "noRoute" | "expectedGap") => {
    const current = countsByCategory[category] ?? {
      matched: 0,
      mismatch: 0,
      noRoute: 0,
      expectedGap: 0,
    };
    current[field] += 1;
    countsByCategory[category] = current;
  };
  for (const result of caseResults) {
    for (const category of result.categories) {
      if (result.status === "Matched") bump(category, "matched");
      else if (result.status === "Mismatch" || result.status === "UnexpectedSuccess")
        bump(category, "mismatch");
      else if (result.status === "ExpectedGap") bump(category, "expectedGap");
      else bump(category, "noRoute");
    }
  }

  return yield* Schema.decodeUnknownEffect(RouteGuideQualificationReport)({
    schemaVersion: "1",
    networkArtifact: options.networkArtifact,
    transitPlaceSourceArtifactVersion: options.sourceArtifactVersion,
    ...(options.overrideArtifact === undefined
      ? {}
      : { overrideArtifact: options.overrideArtifact }),
    corpusManifestVersion: options.sourceArtifactVersion,
    generatedAt: new Date().toISOString(),
    graph: {
      patternCount: graph.patterns.length,
      placeCount: graph.placesById.size,
      transferEdgeEndpointCount: graph.transferEdgesFrom.size,
      indexTimeMs,
      duplicateSequenceCollapseCount: graph.duplicateSequenceCollapseCount,
      findingCounts,
    },
    directionEvidence: { authoritative, reviewed, fallback, ambiguous },
    interchangeableGroups: {
      groupCount: interchangeableGroupCount,
      memberLineExamples: memberLineExamples.map((lines) => [...lines]),
    },
    queryLatencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length === 0 ? 0 : Math.max(...latencies),
    },
    countsByCategory,
    cases: caseResults,
  });
});
