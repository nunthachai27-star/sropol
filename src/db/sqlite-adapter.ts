// T019: SqliteAdapter — better-sqlite3 in-memory mode for tests

import Database from 'better-sqlite3';
import { DatabaseAdapter, type ColumnInfo } from './adapter';

export class SqliteAdapter extends DatabaseAdapter {
  private db: Database.Database;

  constructor(path: string = ':memory:') {
    super();
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  // better-sqlite3 only binds numbers/strings/bigints/buffers/null. JS booleans
  // throw — but Postgres + pglite accept them. To let the seeders + business
  // code use idiomatic `true/false` for BOOLEAN columns, coerce here at the
  // adapter boundary (SQLite stores them as INTEGER 1/0 either way).
  private static coerceParams(params: unknown[]): unknown[] {
    return params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p));
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...SqliteAdapter.coerceParams(params));
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...SqliteAdapter.coerceParams(params)) as T[];
  }

  async getTableNames(): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  async getColumnInfo(table: string): Promise<ColumnInfo[]> {
    const rows = this.db.prepare(`PRAGMA table_info("${table}")`).all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }[];
    return rows.map((r) => ({
      name: r.name,
      type: r.type,
      nullable: r.notnull === 0,
      defaultValue: r.dflt_value,
      // SQLite columns are dynamically typed (TEXT has no width) — report null
      // so SchemaSync never attempts a VARCHAR widening on the SQLite path.
      maxLength: null,
    }));
  }

  async transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.db.prepare('SAVEPOINT sp').run();
    try {
      const result = await fn(this);
      this.db.prepare('RELEASE sp').run();
      return result;
    } catch (error) {
      this.db.prepare('ROLLBACK TO sp').run();
      this.db.prepare('RELEASE sp').run();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
