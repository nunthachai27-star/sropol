// T021: SchemaSync tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PgliteAdapter, createPglite } from '@/db/pglite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import type { TableDefinition } from '@/db/table-definition';

describe('SchemaSync', () => {
  let db: PgliteAdapter;

  beforeEach(() => {
    // Fresh instance per test: these tests exercise DDL from a blank
    // database, so the shared truncate-reset harness doesn't apply.
    db = new PgliteAdapter(createPglite());
  });

  afterEach(async () => {
    await db.close();
  });

  it('should create a missing table', async () => {
    const tables: TableDefinition[] = [
      {
        name: 'users',
        fields: [
          { name: 'id', type: 'uuid', primaryKey: true },
          { name: 'name', type: 'string', maxLength: 255 },
          { name: 'active', type: 'boolean', defaultValue: true },
        ],
      },
    ];

    await SchemaSync.sync(db, tables, 'postgresql');
    const tableNames = await db.getTableNames();
    expect(tableNames).toContain('users');

    const cols = await db.getColumnInfo('users');
    expect(cols.map((c) => c.name)).toContain('id');
    expect(cols.map((c) => c.name)).toContain('name');
    expect(cols.map((c) => c.name)).toContain('active');
  });

  it('should add a missing column to existing table', async () => {
    await db.execute('CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT)');

    const tables: TableDefinition[] = [
      {
        name: 'items',
        fields: [
          { name: 'id', type: 'uuid', primaryKey: true },
          { name: 'name', type: 'string', maxLength: 255 },
          { name: 'price', type: 'decimal', nullable: true },
        ],
      },
    ];

    await SchemaSync.sync(db, tables, 'postgresql');
    const cols = await db.getColumnInfo('items');
    expect(cols.map((c) => c.name)).toContain('price');
  });

  it('should create indexes', async () => {
    const tables: TableDefinition[] = [
      {
        name: 'logs',
        fields: [
          { name: 'id', type: 'uuid', primaryKey: true },
          { name: 'user_id', type: 'uuid' },
          { name: 'action', type: 'string', maxLength: 50 },
        ],
        indexes: [{ name: 'idx_logs_user_id', columns: ['user_id'] }],
      },
    ];

    await SchemaSync.sync(db, tables, 'postgresql');

    // Verify table exists and has correct columns
    const cols = await db.getColumnInfo('logs');
    expect(cols).toHaveLength(3);
  });

  it('should be idempotent on re-runs', async () => {
    const tables: TableDefinition[] = [
      {
        name: 'settings',
        fields: [
          { name: 'id', type: 'uuid', primaryKey: true },
          { name: 'key', type: 'string', maxLength: 100 },
          { name: 'value', type: 'text' },
        ],
      },
    ];

    await SchemaSync.sync(db, tables, 'postgresql');
    // Second run should not throw
    await SchemaSync.sync(db, tables, 'postgresql');

    const tableNames = await db.getTableNames();
    expect(tableNames).toContain('settings');
  });

  it('should handle nullable and default values', async () => {
    const tables: TableDefinition[] = [
      {
        name: 'records',
        fields: [
          { name: 'id', type: 'uuid', primaryKey: true },
          { name: 'status', type: 'string', maxLength: 20, defaultValue: 'ACTIVE' },
          { name: 'notes', type: 'text', nullable: true },
        ],
      },
    ];

    await SchemaSync.sync(db, tables, 'postgresql');

    // Insert with defaults
    await db.execute("INSERT INTO records (id) VALUES (?)", ['test-1']);
    const rows = await db.query<{ id: string; status: string; notes: string | null }>(
      'SELECT * FROM records',
    );
    expect(rows[0].status).toBe('ACTIVE');
    expect(rows[0].notes).toBeNull();
  });

  it('should handle all abstract types', async () => {
    const tables: TableDefinition[] = [
      {
        name: 'all_types',
        fields: [
          { name: 'id', type: 'uuid', primaryKey: true },
          { name: 'str', type: 'string', maxLength: 100 },
          { name: 'txt', type: 'text', nullable: true },
          { name: 'num', type: 'integer', nullable: true },
          { name: 'dec', type: 'decimal', nullable: true },
          { name: 'flag', type: 'boolean', defaultValue: false },
          { name: 'ts', type: 'datetime', nullable: true },
          { name: 'obj', type: 'json', nullable: true },
          { name: 'tags', type: 'string[]', nullable: true },
        ],
      },
    ];

    await SchemaSync.sync(db, tables, 'postgresql');
    const cols = await db.getColumnInfo('all_types');
    expect(cols).toHaveLength(9);
  });
});
