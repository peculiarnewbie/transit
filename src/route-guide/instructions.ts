import type { GuideAlternative, InterchangeableRideStep, TransferInstruction } from "./model.js";

export interface RideStepInstruction {
  readonly summary: string;
  readonly lineBadges: ReadonlyArray<string>;
  readonly directionSummaries: ReadonlyArray<string>;
  readonly boardingPlaceName: string;
  readonly alightingPlaceName: string;
  readonly boardingMemberDetail: string | undefined;
  readonly alightingMemberDetail: string | undefined;
  readonly intermediatePlaceNamesByOption: ReadonlyArray<{
    readonly line: string;
    readonly placeNames: ReadonlyArray<string>;
  }>;
}

export interface TransferStepInstruction {
  readonly summary: string;
  readonly leavePlaceName: string;
  readonly boardNextPlaceName: string;
  readonly nextLineBadges: ReadonlyArray<string>;
  readonly nextDirectionLabel: string | undefined;
  readonly platformDetailKnown: boolean;
  readonly preservesDistinctEndpointNames: boolean;
}

export interface GuideInstructions {
  readonly alternativeId: string;
  readonly rideSteps: ReadonlyArray<RideStepInstruction>;
  readonly transfers: ReadonlyArray<TransferStepInstruction>;
  readonly sharedLinePhrase: ReadonlyArray<string>;
}

const formatLineList = (names: ReadonlyArray<string>): string => {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} or ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
};

const memberDetail = (
  placeName: string,
  member: { stopName: string; platformCode?: string } | undefined,
): string | undefined => {
  if (member === undefined) return undefined;
  if (member.platformCode !== undefined) return `platform ${member.platformCode}`;
  if (member.stopName !== placeName) return member.stopName;
  return undefined;
};

const rideInstruction = (step: InterchangeableRideStep): RideStepInstruction => {
  const lineBadges = step.lineOptions.map((option) => option.passengerLineName);
  const directionSummaries = step.lineOptions.map((option) => {
    const shared =
      step.lineOptions.length > 1 &&
      step.lineOptions.every((other) => other.directionLabel === option.directionLabel);
    if (shared) return `toward ${option.directionLabel}`;
    return `${option.passengerLineName} toward ${option.directionLabel}`;
  });
  const uniqueDirections = [...new Set(directionSummaries)];
  const directionPhrase =
    uniqueDirections.length === 1 ? uniqueDirections[0]! : uniqueDirections.join("; ");
  const boardingDetail = memberDetail(step.boarding.placeName, step.boarding.member);
  const alightingDetail = memberDetail(step.alighting.placeName, step.alighting.member);
  const boardClause =
    boardingDetail === undefined
      ? step.boarding.placeName
      : `${step.boarding.placeName} (${boardingDetail})`;
  const alightClause =
    alightingDetail === undefined
      ? step.alighting.placeName
      : `${step.alighting.placeName} (${alightingDetail})`;

  return {
    summary: `Board at ${boardClause} on ${formatLineList(lineBadges)} ${directionPhrase}, and alight at ${alightClause}.`,
    lineBadges,
    directionSummaries: uniqueDirections,
    boardingPlaceName: step.boarding.placeName,
    alightingPlaceName: step.alighting.placeName,
    boardingMemberDetail: boardingDetail,
    alightingMemberDetail: alightingDetail,
    intermediatePlaceNamesByOption: step.lineOptions.map((option) => ({
      line: option.passengerLineName,
      placeNames: option.intermediatePlaces.map((place) => place.placeName),
    })),
  };
};

const transferInstruction = (transfer: TransferInstruction): TransferStepInstruction => {
  const leaveName = transfer.leavePlace.placeName;
  const boardName = transfer.boardNextPlace.placeName;
  const lines = formatLineList(transfer.nextPassengerLineNames);
  const direction =
    transfer.nextDirectionLabel === undefined ? "" : ` toward ${transfer.nextDirectionLabel}`;
  const platform =
    transfer.platformDetailKnown && transfer.boardNextPlace.member?.platformCode !== undefined
      ? ` at platform ${transfer.boardNextPlace.member.platformCode}`
      : transfer.platformDetailKnown
        ? ""
        : " (platform detail unknown)";
  const distinctNames = leaveName !== boardName;
  const placePhrase = distinctNames
    ? `Leave ${leaveName} and board ${lines}${direction} at ${boardName}${platform}.`
    : `Transfer at ${leaveName} to ${lines}${direction}${platform}.`;

  return {
    summary: placePhrase,
    leavePlaceName: leaveName,
    boardNextPlaceName: boardName,
    nextLineBadges: transfer.nextPassengerLineNames,
    nextDirectionLabel: transfer.nextDirectionLabel,
    platformDetailKnown: transfer.platformDetailKnown,
    preservesDistinctEndpointNames: distinctNames,
  };
};

export const projectInstructions = (alternative: GuideAlternative): GuideInstructions => {
  const rideSteps = alternative.rideSteps.map(rideInstruction);
  const transfers = alternative.transfers.map(transferInstruction);
  return {
    alternativeId: alternative.id,
    rideSteps,
    transfers,
    sharedLinePhrase: rideSteps.map((step) => formatLineList(step.lineBadges)),
  };
};
