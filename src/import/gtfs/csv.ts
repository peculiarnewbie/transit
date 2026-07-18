import { Effect, Result, Schema } from "effect";

import { GtfsTableError } from "./errors.js";

export interface CsvRecord {
  readonly rowNumber: number;
  readonly values: Readonly<Record<string, string>>;
}

const parseRows = (table: string, input: string) => {
  const rows: Array<{ readonly rowNumber: number; readonly values: Array<string> }> = [];
  let fields: Array<string> = [];
  let field = "";
  let quoted = false;
  let rowNumber = 1;
  let rowStart = 1;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
        if (character === "\n") rowNumber += 1;
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) {
        return Effect.fail(
          new GtfsTableError({
            table,
            rowNumber,
            reason: "Unexpected quote in an unquoted field",
          }),
        );
      }
      quoted = true;
    } else if (character === ",") {
      fields.push(field);
      field = "";
    } else if (character === "\n") {
      fields.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      rows.push({ rowNumber: rowStart, values: fields });
      fields = [];
      field = "";
      rowNumber += 1;
      rowStart = rowNumber;
    } else {
      field += character;
    }
  }

  if (quoted) {
    return Effect.fail(
      new GtfsTableError({
        table,
        rowNumber,
        reason: "Unterminated quoted field",
      }),
    );
  }

  if (field.length > 0 || fields.length > 0) {
    fields.push(field.endsWith("\r") ? field.slice(0, -1) : field);
    rows.push({ rowNumber: rowStart, values: fields });
  }

  return Effect.succeed(rows);
};

export const parseCsv = Effect.fn("Gtfs.parseCsv")(function* (table: string, input: string) {
  const rows = yield* parseRows(table, input.replace(/^\uFEFF/, ""));
  const header = rows[0];
  if (header === undefined) {
    return yield* new GtfsTableError({
      table,
      rowNumber: 1,
      reason: "Table is empty",
    });
  }

  const seen = new Set<string>();
  for (const column of header.values) {
    if (column.length === 0 || seen.has(column)) {
      return yield* new GtfsTableError({
        table,
        rowNumber: 1,
        reason:
          column.length === 0 ? "Header contains an empty column" : `Duplicate column: ${column}`,
      });
    }
    seen.add(column);
  }

  const records: Array<CsvRecord> = [];
  for (const row of rows.slice(1)) {
    if (row.values.length === 1 && row.values[0] === "") continue;
    if (row.values.length !== header.values.length) {
      return yield* new GtfsTableError({
        table,
        rowNumber: row.rowNumber,
        reason: `Expected ${header.values.length} fields but found ${row.values.length}`,
      });
    }

    const values: Record<string, string> = {};
    for (let index = 0; index < header.values.length; index += 1) {
      const value = row.values[index];
      const column = header.values[index];
      if (value !== undefined && value !== "" && column !== undefined) values[column] = value;
    }
    records.push({ rowNumber: row.rowNumber, values });
  }
  return { header: header.values, records };
});

export const decodeTable = Effect.fn("Gtfs.decodeTable")(function* <A>(options: {
  readonly table: string;
  readonly input: string;
  readonly schema: Schema.ConstraintDecoder<A>;
  readonly requiredColumns: ReadonlyArray<string>;
}) {
  const parsed = yield* parseCsv(options.table, options.input);
  for (const column of options.requiredColumns) {
    if (!parsed.header.includes(column)) {
      return yield* new GtfsTableError({
        table: options.table,
        rowNumber: 1,
        reason: `Missing required column: ${column}`,
      });
    }
  }

  const decoded: Array<A> = [];
  for (const record of parsed.records) {
    const result = Schema.decodeUnknownResult(options.schema)(record.values);
    if (Result.isFailure(result)) {
      return yield* new GtfsTableError({
        table: options.table,
        rowNumber: record.rowNumber,
        reason: "Malformed required or typed field",
      });
    }
    decoded.push(result.success);
  }
  return decoded;
});
