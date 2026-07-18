import { Schema } from "effect";

const identifier = (brand: string) =>
  Schema.String.check(Schema.isNonEmpty()).pipe(Schema.brand(brand));

export const GuideAlternativeId = identifier("GuideAlternativeId");
export type GuideAlternativeId = typeof GuideAlternativeId.Type;

export const ReviewedDirectionLabelId = identifier("ReviewedDirectionLabelId");
export type ReviewedDirectionLabelId = typeof ReviewedDirectionLabelId.Type;
