import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const meta = (changes = 0, lastRowId = 0): D1Meta & Record<string, unknown> => ({
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: changes,
  last_row_id: lastRowId,
  changed_db: changes > 0,
  changes,
});

class SqliteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
    private readonly values: ReadonlyArray<unknown> = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1Statement(this.database, this.query, values);
  }

  private parameters(): ReadonlyArray<SQLInputValue> {
    return this.values.map((value) => {
      if (typeof value === "boolean") return value ? 1 : 0;
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint" ||
        value instanceof Uint8Array
      ) {
        return value;
      }
      throw new TypeError(`Unsupported D1 test parameter: ${typeof value}`);
    });
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const row = this.database.prepare(this.query).get(...this.parameters()) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return (colName === undefined ? row : row[colName]) as T;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const statement = this.database.prepare(this.query);
    if (statement.columns().length > 0) {
      const results = statement.all(...this.parameters()) as T[];
      return { success: true, results, meta: meta() };
    }
    const result = statement.run(...this.parameters());
    return {
      success: true,
      results: [],
      meta: meta(Number(result.changes), Number(result.lastInsertRowid)),
    };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.database.prepare(this.query).all(...this.parameters()) as T[];
    return { success: true, results, meta: meta() };
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const statement = this.database.prepare(this.query);
    statement.setReturnArrays(true);
    const rows = statement.all(...this.parameters()) as T[];
    if (options?.columnNames === true) {
      return [statement.columns().map((column) => column.name), ...rows];
    }
    return rows;
  }
}

class SqliteD1Session implements D1DatabaseSession {
  constructor(private readonly owner: SqliteD1Database) {}

  prepare(query: string): D1PreparedStatement {
    return this.owner.prepare(query);
  }

  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return this.owner.batch<T>(statements);
  }

  getBookmark(): string | null {
    return null;
  }
}

/** Real in-memory SQLite behind the D1 protocol; only used by integration tests. */
export class SqliteD1Database implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec("pragma foreign_keys = on");
  }

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.sqlite, query);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec("begin");
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) results.push(await statement.run<T>());
      this.sqlite.exec("commit");
      return results;
    } catch (cause) {
      this.sqlite.exec("rollback");
      throw cause;
    }
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.sqlite.exec(query);
    return { count: 1, duration: 0 };
  }

  withSession(): D1DatabaseSession {
    return new SqliteD1Session(this);
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }

  close(): void {
    this.sqlite.close();
  }
}
