import { DatabaseAdapter, type ColumnInfo } from '@/db/adapter';

/**
 * Wraps a real adapter and throws on any execute/query whose SQL matches
 * `failOn`. transaction() re-wraps the tx adapter, so an injected failure
 * inside db.transaction() exercises a real ROLLBACK on PGlite/Postgres.
 */
export class FailingAdapter extends DatabaseAdapter {
  constructor(
    private readonly inner: DatabaseAdapter,
    private readonly failOn: RegExp,
  ) {
    super();
  }

  private check(sql: string): void {
    if (this.failOn.test(sql)) {
      throw new Error(`injected failure on: ${sql.slice(0, 80)}`);
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    this.check(sql);
    return this.inner.execute(sql, params);
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    this.check(sql);
    return this.inner.query<T>(sql, params);
  }

  getTableNames(): Promise<string[]> {
    return this.inner.getTableNames();
  }

  getColumnInfo(table: string): Promise<ColumnInfo[]> {
    return this.inner.getColumnInfo(table);
  }

  transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    return this.inner.transaction((tx) => fn(new FailingAdapter(tx, this.failOn)));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
