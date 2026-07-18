/** Derive passenger-facing aliases from GTFS / station primary names. */
export const generatePassengerAliases = (primaryName: string): ReadonlyArray<string> => {
  const aliases = new Set<string>();
  const trimmed = primaryName.trim();
  if (trimmed === "") return [];

  const withoutJalur = trimmed.replace(/\s+Jalur\s+\d+\s*$/i, "").trim();
  if (withoutJalur !== trimmed) aliases.add(withoutJalur);

  const withoutTrailingNumber = trimmed.replace(/\s+\d+\s*$/g, "").trim();
  if (withoutTrailingNumber !== trimmed) aliases.add(withoutTrailingNumber);

  // "Bundaran HI Astra" → "Bundaran HI" (trailing sponsor / qualifier token).
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 3) {
    aliases.add(parts.slice(0, -1).join(" "));
  }

  // Compact form without spaces for variant queries like "blokm".
  const compact = trimmed.replace(/\s+/g, "");
  if (compact !== trimmed) aliases.add(compact);

  const initials = trimmed
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]!)
    .join("")
    .toUpperCase();
  if (initials.length >= 2 && initials.length <= 6) {
    aliases.add(initials);
  }

  aliases.delete(trimmed);
  return [...aliases];
};
