import { Schema } from "effect";

export const TransitMode = Schema.Literals(["Bus", "CommuterRail", "Mrt", "Lrt", "Walk"]);

export type TransitMode = typeof TransitMode.Type;
