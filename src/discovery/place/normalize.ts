/**
 * Indonesian / Jakarta abbreviation equivalence for passenger place search.
 * Reviewed rule table — not derived from the Plan 012 corpus.
 */
export interface AbbreviationRule {
  readonly id: string;
  readonly canonical: string;
  readonly forms: ReadonlyArray<string>;
}

export const ABBREVIATION_RULES: ReadonlyArray<AbbreviationRule> = [
  { id: "jalan", canonical: "jalan", forms: ["jl", "jl.", "jln", "jln.", "jalan"] },
  {
    id: "stasiun",
    canonical: "stasiun",
    forms: ["st", "st.", "sta", "sta.", "stasiun", "station"],
  },
  { id: "pasar", canonical: "pasar", forms: ["ps", "ps.", "pasar", "market"] },
  { id: "rumah-sakit", canonical: "rumah sakit", forms: ["rs", "rs.", "rumah sakit", "hospital"] },
  {
    id: "universitas",
    canonical: "universitas",
    forms: ["univ", "univ.", "universitas", "university"],
  },
  { id: "gang", canonical: "gang", forms: ["gg", "gg.", "gang"] },
  { id: "kampung", canonical: "kampung", forms: ["kp", "kp.", "kampung"] },
];

const formToCanonical = new Map<string, string>();
for (const rule of ABBREVIATION_RULES) {
  for (const form of rule.forms) {
    formToCanonical.set(form.toLowerCase(), rule.canonical);
  }
}

/** Normalize for matching without corrupting the original display label. */
export const normalizeSearchText = (value: string): string => {
  const folded = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    // Treat dotted initials as letters: "H.I." → "h i" → later joined carefully
    .replace(/([a-z])\.(?=[a-z])/g, "$1 ")
    .replace(/[_/,]+/g, " ")
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (folded === "") return "";

  return folded
    .split(" ")
    .map((token) => {
      const stripped = token.replace(/\.+$/g, "");
      const withDot = `${stripped}.`;
      return (
        formToCanonical.get(token) ??
        formToCanonical.get(stripped) ??
        formToCanonical.get(withDot) ??
        stripped
      );
    })
    .filter((token) => token.length > 0)
    .join(" ");
};

/** Compact form for variants like "blokm" / "pulogadung". */
export const compactSearchText = (normalized: string): string => normalized.replace(/\s+/g, "");

export const tokenize = (normalized: string): ReadonlyArray<string> =>
  normalized === "" ? [] : normalized.split(" ");

/** True when every query token is a prefix of a distinct name token (order-preserving). */
export const tokensAreOrderedPrefixes = (
  queryTokens: ReadonlyArray<string>,
  nameTokens: ReadonlyArray<string>,
): boolean => {
  if (queryTokens.length === 0 || queryTokens.length > nameTokens.length) return false;
  let cursor = 0;
  for (const queryToken of queryTokens) {
    let found = false;
    while (cursor < nameTokens.length) {
      const nameToken = nameTokens[cursor]!;
      cursor += 1;
      if (nameToken.startsWith(queryToken)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
};
