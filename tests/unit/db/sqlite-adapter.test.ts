// T019: SqliteAdapter tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import type { DatabaseAdapter } from '@/db/adapter';

describe('SqliteAdapter', () => {
  let db: SqliteAdapter;

  beforeEach(() => {
    db = new SqliteAdapter(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  it('should execute CREATE TABLE and INSERT', async () => {
    await db.execute('CREATE TABLE test (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    await db.execute('INSERT INTO test (id, name) VALUES (?, ?)', ['1', 'Alice']);
    const rows = await db.query<{ id: string; name: string }>('SELECT * FROM test');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ id: '1', name: 'Alice' });
  });

  it('should handle parameterized queries', async () => {
    await db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, value REAL)');
    await db.execute('INSERT INTO items (id, value) VALUES (?, ?)', [1, 3.14]);
    await db.execute('INSERT INTO items (id, value) VALUES (?, ?)', [2, 2.72]);
    const rows = await db.query<{ id: number; value: number }>(
      'SELECT * FROM items WHERE value > ?',
      [3.0],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });

  it('should list table names', async () => {
    await db.execute('CREATE TABLE alpha (id TEXT)');
    await db.execute('CREATE TABLE beta (id TEXT)');
    const tables = await db.getTableNames();
    expect(tables).toContain('alpha');
    expect(tables).toContain('beta');
  });

  it('should get column info', async () => {
    await db.execute(
      'CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER DEFAULT 0)',
    );
    const cols = await db.getColumnInfo('people');
    expect(cols).toHaveLength(3);
    const nameCol = cols.find((c) => c.name === 'name');
    expect(nameCol).toBeDefined();
    expect(nameCol!.nullable).toBe(false);
    // SQLite TEXT carries no enforced width — report null so SchemaSync's
    // widening pass treats it as "unknown" and never tries to ALTER it.
    expect(nameCol!.maxLength).toBeNull();
  });

  it('should support transactions', async () => {
    await db.execute('CREATE TABLE counters (id TEXT PRIMARY KEY, count INTEGER)');
    await db.execute('INSERT INTO counters (id, count) VALUES (?, ?)', ['a', 0]);

    await db.transaction(async (tx: DatabaseAdapter) => {
      await tx.execute('UPDATE counters SET count = count + 1 WHERE id = ?', ['a']);
      await tx.execute('UPDATE counters SET count = count + 1 WHERE id = ?', ['a']);
    });

    const rows = await db.query<{ count: number }>('SELECT count FROM counters WHERE id = ?', [
      'a',
    ]);
    expect(rows[0].count).toBe(2);
  });

  it('should rollback transaction on error', async () => {
    await db.execute('CREATE TABLE vals (id TEXT PRIMARY KEY, v INTEGER)');
    await db.execute('INSERT INTO vals (id, v) VALUES (?, ?)', ['x', 10]);

    await expect(
      db.transaction(async (tx: DatabaseAdapter) => {
        await tx.execute('UPDATE vals SET v = 99 WHERE id = ?', ['x']);
        throw new Error('intentional error');
      }),
    ).rejects.toThrow('intentional error');

    const rows = await db.query<{ v: number }>('SELECT v FROM vals WHERE id = ?', ['x']);
    expect(rows[0].v).toBe(10);
  });

  it('should map boolean as INTEGER 0/1', async () => {
    await db.execute('CREATE TABLE flags (id TEXT, active INTEGER)');
    await db.execute('INSERT INTO flags (id, active) VALUES (?, ?)', ['1', 1]);
    await db.execute('INSERT INTO flags (id, active) VALUES (?, ?)', ['2', 0]);
    const rows = await db.query<{ id: string; active: number }>(
      'SELECT * FROM flags WHERE active = ?',
      [1],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('1');
  });
});
