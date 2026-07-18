import { Effect, Schema } from "effect";

import { ParseError } from "../errors.js";
import { ParsedStation } from "./raw.js";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const decodeEntities = (text: string): string =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractTimes = (html: string): Array<string> => {
  const small = [...html.matchAll(/<small[^>]*>([^<]*)<\/small>/gi)]
    .map((match) => decodeEntities(match[1] ?? ""))
    .filter((time) => TIME_RE.test(time));
  return small.length > 0
    ? small
    : [...html.matchAll(/>(\d{2}:\d{2})</g)]
        .map((match) => match[1] ?? "")
        .filter((time) => TIME_RE.test(time));
};

const extractPane = (html: string, stationId: string): string | undefined =>
  html.match(
    new RegExp(
      `<div[^>]*\\bid=["']pills-${stationId}["'][^>]*>([\\s\\S]*?)(?=<div[^>]*\\bid=["']pills-|$)`,
      "i",
    ),
  )?.[1];

export const parseSchedulePage = Effect.fn("LrtSourceAdapter.parseSchedulePage")(function* (
  source: string,
  html: string,
) {
  const tabs = [...html.matchAll(/data-bs-target="#pills-([^"]+)"[^>]*>\s*([^<]+?)\s*</gi)];
  const seen = new Set<string>();
  const stations: Array<unknown> = [];
  for (const tab of tabs) {
    const id = (tab[1] ?? "").trim();
    const name = decodeEntities(tab[2] ?? "");
    if (!id || !name || seen.has(id) || id.startsWith("footer") || id.startsWith("submenu"))
      continue;
    seen.add(id);
    const pane = extractPane(html, id);
    if (pane === undefined) continue;
    const weekdays: Array<string> = [];
    const weekends: Array<string> = [];
    for (const section of pane.matchAll(
      /<h3[^>]*>\s*([\s\S]*?)\s*<\/h3>\s*<table[^>]*class="[^"]*table-jadwal-tarif[^"]*"[^>]*>([\s\S]*?)<\/table>/gi,
    )) {
      const heading = decodeEntities((section[1] ?? "").replace(/<[^>]+>/g, " ")).toLowerCase();
      const times = extractTimes(section[2] ?? "");
      if (heading.includes("hari biasa")) weekdays.push(...times);
      if (heading.includes("hari libur")) weekends.push(...times);
    }
    stations.push({ id, name, weekdays, weekends });
  }
  if (stations.length === 0) {
    return yield* new ParseError({
      operation: "LrtSourceAdapter.parseSchedulePage",
      system: "lrt",
      source,
      detail: "No station schedule tabs matched the official page shape.",
    });
  }
  return yield* Schema.decodeUnknownEffect(Schema.Array(ParsedStation))(stations).pipe(
    Effect.mapError(
      () =>
        new ParseError({
          operation: "LrtSourceAdapter.parseSchedulePage",
          system: "lrt",
          source,
          detail: "Parsed station schedules contained invalid times or identifiers.",
        }),
    ),
  );
});
