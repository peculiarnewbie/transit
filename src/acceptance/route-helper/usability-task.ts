import { Schema } from "effect";

import { PlaceSearchCaseId, RouteGuideCaseId, UsabilityTaskId } from "./ids.js";

export const UsabilityViewport = Schema.Literals(["Phone", "Desktop", "Either"]);
export type UsabilityViewport = typeof UsabilityViewport.Type;

export const UsabilityInteraction = Schema.Literals([
  "AutocompleteBelowActiveInput",
  "OriginDestinationSwap",
  "FloatingTopControlPhone",
  "FloatingSidePanelDesktop",
  "InterchangeableLineStep",
  "WithoutOpeningMap",
]);
export type UsabilityInteraction = typeof UsabilityInteraction.Type;

export const UsabilityTask = Schema.Struct({
  id: UsabilityTaskId,
  scenario: Schema.String.check(Schema.isNonEmpty()),
  expectedGoal: Schema.String.check(Schema.isNonEmpty()),
  completionCriteria: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(
    Schema.isNonEmpty(),
  ),
  viewport: UsabilityViewport,
  interactions: Schema.Array(UsabilityInteraction).check(Schema.isNonEmpty()),
  relatedPlaceCaseIds: Schema.Array(PlaceSearchCaseId),
  relatedRouteCaseIds: Schema.Array(RouteGuideCaseId),
});
export interface UsabilityTask extends Schema.Schema.Type<typeof UsabilityTask> {}
