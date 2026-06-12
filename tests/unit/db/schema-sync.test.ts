// T021: SchemaSync tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync, columnWidenSql } from '@/db/schema-sync';
import type { TableDefinition } from '@/db/table-definition';
import type { ColumnInfo } from '@/db/adapter';

describe('SchemaSync', () => {
  let db: SqliteAdapter;

  beforeEach(() => {
    db = new SqliteAdapter(':memory:');
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

    await SchemaSync.sync(db, tables, 'sqlite');
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

    await SchemaSync.sync(db, tables, 'sqlite');
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

    await SchemaSync.sync(db, tables, 'sqlite');

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

    await SchemaSync.sync(db, tables, 'sqlite');
    // Second run should not throw
    await SchemaSync.sync(db, tables, 'sqlite');

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

    await SchemaSync.sync(db, tables, 'sqlite');

    // Insert with defaults
    await db.execute("INSERT INTO records (id) VALUES (?)", ['test-1']);
    const rows = await db.query<{ id: string; status: string; notes: string | null }>(
      'SELECT * FROM records',
    );
    expect(rows[0].status).toBe('ACTIVE');
    expect(rows[0].notes).toBeNull();
  });

  // Regression: HOSxP free-text lab values (anc_service.albumin/sugar) overflowed
  // cached_anc_visits.urine_protein varchar(10) and aborted the whole 500-row ANC
  // batch. schema-sync was ADD-COLUMN-only and never widened an existing column,
  // so bumping maxLength in the table def couldn't heal a deployed prod DB.
  describe('columnWidenSql', () => {
    const field = { name: 'urine_protein', type: 'string', maxLength: 20, nullable: true } as const;
    const existing: ColumnInfo = { name: 'urine_protein', type: 'character varying', nullable: true, defaultValue: null, maxLength: 10 };

    it('emits ALTER COLUMN TYPE when the def is wider than the live column (postgresql)', () => {
      expect(columnWidenSql('cached_anc_visits', field, existing, 'postgresql')).toBe(
        'ALTER TABLE cached_anc_visits ALTER COLUMN urine_protein TYPE VARCHAR(20)',
      );
    });

    it('returns null when the live column already meets the def width', () => {
      expect(columnWidenSql('t', field, { ...existing, maxLength: 20 }, 'postgresql')).toBeNull();
    });

    it('never shrinks — returns null when the def is narrower than the live column', () => {
      expect(columnWidenSql('t', { ...field, maxLength: 5 }, existing, 'postgresql')).toBeNull();
    });

    it('returns null on sqlite (TEXT has no enforced width)', () => {
      expect(columnWidenSql('t', field, existing, 'sqlite')).toBeNull();
    });

    it('returns null for non-string fields', () => {
      const intField = { name: 'n', type: 'integer' } as const;
      expect(columnWidenSql('t', intField, { name: 'n', type: 'integer', nullable: true, defaultValue: null, maxLength: null }, 'postgresql')).toBeNull();
    });

    it('returns null when the live width is unknown (maxLength null)', () => {
      expect(columnWidenSql('t', field, { ...existing, maxLength: null }, 'postgresql')).toBeNull();
    });

    // A `text` def over a live bounded varchar must convert: HOSxP free-text
    // lab values outgrew every fixed width, so the urine_* columns moved to TEXT.
    const textField = { name: 'urine_protein', type: 'text', nullable: true } as const;

    it('converts a live varchar column to TEXT when the def is text (postgresql)', () => {
      expect(columnWidenSql('cached_anc_visits', textField, existing, 'postgresql')).toBe(
        'ALTER TABLE cached_anc_visits ALTER COLUMN urine_protein TYPE TEXT',
      );
    });

    it('returns null when the column is already TEXT (maxLength null)', () => {
      expect(columnWidenSql('t', textField, { ...existing, maxLength: null }, 'postgresql')).toBeNull();
    });

    it('returns null for a text def on sqlite', () => {
      expect(columnWidenSql('t', textField, existing, 'sqlite')).toBeNull();
    });
  });

  it('widens an existing too-narrow column on postgresql during sync', async () => {
    // Fake postgres adapter: the table already exists with urine_protein as a
    // VARCHAR(10), but the definition now asks for VARCHAR(20).
    const executed: string[] = [];
    const fake = {
      getTableNames: async () => ['cached_anc_visits'],
      getColumnInfo: async (): Promise<ColumnInfo[]> => [
        { name: 'id', type: 'character varying', nullable: false, defaultValue: null, maxLength: 36 },
        { name: 'urine_protein', type: 'character varying', nullable: true, defaultValue: null, maxLength: 10 },
      ],
      execute: async (sql: string) => {
        executed.push(sql);
      },
    } as unknown as SqliteAdapter;

    const tables: TableDefinition[] = [
      {
        name: 'cached_anc_visits',
        fields: [
          { name: 'id', type: 'uuid', primaryKey: true },
          { name: 'urine_protein', type: 'string', maxLength: 20, nullable: true },
        ],
      },
    ];

    await SchemaSync.sync(fake, tables, 'postgresql');

    expect(executed).toContain(
      'ALTER TABLE cached_anc_visits ALTER COLUMN urine_protein TYPE VARCHAR(20)',
    );
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

    await SchemaSync.sync(db, tables, 'sqlite');
    const cols = await db.getColumnInfo('all_types');
    expect(cols).toHaveLength(9);
  });
});
