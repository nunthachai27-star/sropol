import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgliteAdapter } from '@/db/pglite-adapter';

describe('PgliteAdapter', () => {
  let adapter: PgliteAdapter;

  beforeEach(async () => {
    adapter = new PgliteAdapter(new PGlite());
    await adapter.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)');
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('rewrites ? placeholders to $N for postgres', async () => {
    await adapter.execute('INSERT INTO t (id, name, age) VALUES (?, ?, ?)', [1, 'a', 30]);
    const rows = await adapter.query<{ id: number; name: string; age: number }>(
      'SELECT * FROM t WHERE name = ? AND age >= ?',
      ['a', 18],
    );
    expect(rows).toEqual([{ id: 1, name: 'a', age: 30 }]);
  });

  it('lists table names', async () => {
    const names = await adapter.getTableNames();
    expect(names).toContain('t');
  });

  it('reads column info', async () => {
    const cols = await adapter.getColumnInfo('t');
    expect(cols.map((c) => c.name).sort()).toEqual(['age', 'id', 'name']);
  });

  // Regression for the USE_PGLITE boot crash: schema-sync used the sqlite
  // dialect (boolean -> INTEGER) inside PGlite's real Postgres engine, so the
  // seeders' boolean binds failed with `invalid input syntax for type
  // integer: "true"`. PGlite must always get the postgresql dialect.
  it('round-trips a boolean through a schema-synced table (postgresql dialect)', async () => {
    const { SchemaSync } = await import('@/db/schema-sync');
    await SchemaSync.sync(
      adapter,
      [
        {
          name: 'bool_probe',
          fields: [
            { name: 'id', type: 'string', maxLength: 10, primaryKey: true },
            { name: 'is_active', type: 'boolean', defaultValue: true },
          ],
        },
      ],
      'postgresql',
    );
    await adapter.execute('INSERT INTO bool_probe (id, is_active) VALUES (?, ?)', ['h1', true]);
    const rows = await adapter.query<{ id: string; is_active: boolean }>(
      'SELECT id, is_active FROM bool_probe WHERE is_active = ?',
      [true],
    );
    expect(rows).toEqual([{ id: 'h1', is_active: true }]);
  });
});
