// T020: PostgresAdapter — pg.Pool connection pooling for production

import { Pool, types as pgTypes, type PoolConfig } from 'pg';
import { DatabaseAdapter, type ColumnInfo } from './adapter';

// By default `pg` returns int8/bigint (OID 20) as a string because JS numbers
// can't safely represent values > 2^53. In this app all IDs are UUIDs and the
// only bigints in practice are `COUNT(*)` / `SUM(...)` results, which are
// always safely within Number range. Leaving the default string behaviour
// caused dashboard aggregations to string-concat ("0" + "0" + ... → "000...").
pgTypes.setTypeParser(20, (val: string) => parseInt(val, 10));

// The codebase writes SQL with `?` placeholders (SQLite dialect). `pg` only
// understands `$1, $2, …` so every query arriving at this adapter must be
// rewritten. We walk the string instead of a global replace so `?` inside a
// single-quoted literal is left alone (with SQL's '' escape handled).
function convertPlaceholders(sql: string): string {
  let out = '';
  let i = 0;
  let idx = 1;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      out += "'";
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += "''";
          i += 2;
        } else if (sql[i] === "'") {
          out += "'";
          i++;
          break;
        } else {
          out += sql[i];
          i++;
        }
      }
    } else if (c === '?') {
      out += '$' + idx++;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export class PostgresAdapter extends DatabaseAdapter {
  private pool: Pool;

  constructor(connectionString: string, poolConfig?: Partial<PoolConfig>) {
    super();
    this.pool = new Pool({
      connectionString,
      max: poolConfig?.max ?? 10,
      idleTimeoutMillis: poolConfig?.idleTimeoutMillis ?? 30000,
      connectionTimeoutMillis: poolConfig?.connectionTimeoutMillis ?? 5000,
      ...poolConfig,
    });
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.pool.query(convertPlaceholders(sql), params);
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(convertPlaceholders(sql), params);
    return result.rows as T[];
  }

  async getTableNames(): Promise<string[]> {
    const result = await this.pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    return result.rows.map((r: { table_name: string }) => r.table_name);
  }

  async getColumnInfo(table: string): Promise<ColumnInfo[]> {
    const result = await this.pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table],
    );
    return result.rows.map(
      (r: {
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }) => ({
        name: r.column_name,
        type: r.data_type,
        nullable: r.is_nullable === 'YES',
        defaultValue: r.column_default,
      }),
    );
  }

  async transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Create a transactional adapter that uses this specific client
      const txAdapter = new PostgresTransactionAdapter(client as unknown as PgClient);
      const result = await fn(txAdapter);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Internal adapter for transactions — uses a single client instead of pool
interface PgClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

class PostgresTransactionAdapter extends DatabaseAdapter {
  private client: PgClient;

  constructor(client: PgClient) {
    super();
    this.client = client;
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.client.query(convertPlaceholders(sql), params);
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.client.query(convertPlaceholders(sql), params);
    return result.rows as T[];
  }

  async getTableNames(): Promise<string[]> {
    throw new Error('getTableNames not available in transaction context');
  }

  async getColumnInfo(): Promise<ColumnInfo[]> {
    throw new Error('getColumnInfo not available in transaction context');
  }

  async transaction<T>(): Promise<T> {
    throw new Error('Nested transactions not supported');
  }

  async close(): Promise<void> {
    // No-op: client released by parent
  }
}
