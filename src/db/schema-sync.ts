// T021: SchemaSync engine — introspects DB schema and creates/alters tables to match definitions

import type { DatabaseAdapter } from './adapter';
import type { TableDefinition, FieldDefinition, AbstractFieldType } from './table-definition';

// PostgreSQL is the only dialect: PostgresAdapter in production, pglite
// (a real Postgres engine) in dev/test. The SQLite mapping was removed with
// the SQLite driver.
type DriverType = 'postgresql';

const TYPE_MAP: Record<DriverType, Record<AbstractFieldType, string>> = {
  postgresql: {
    uuid: 'VARCHAR(36)',
    string: 'VARCHAR',
    text: 'TEXT',
    integer: 'INTEGER',
    decimal: 'DECIMAL(10,2)',
    boolean: 'BOOLEAN',
    datetime: 'TIMESTAMPTZ',
    json: 'JSONB',
    // The only `string[]` field today (cpd_scores.missing_factors) is written
    // via JSON.stringify and read via JSON.parse, so storage is JSON in TEXT
    // rather than a native Postgres array. Mapping to TEXT[] here would
    // reject the JSON literal at INSERT time.
    'string[]': 'TEXT',
  },
};

function mapFieldType(field: FieldDefinition, driver: DriverType): string {
  const baseType = TYPE_MAP[driver][field.type];
  if (field.type === 'string' && field.maxLength) {
    return `VARCHAR(${field.maxLength})`;
  }
  return baseType;
}

function buildColumnDef(field: FieldDefinition, driver: DriverType): string {
  const parts: string[] = [field.name, mapFieldType(field, driver)];

  if (field.primaryKey) {
    parts.push('PRIMARY KEY');
  }

  if (!field.nullable && !field.primaryKey) {
    parts.push('NOT NULL');
  }

  if (field.unique) {
    parts.push('UNIQUE');
  }

  if (field.defaultValue !== undefined && field.defaultValue !== null) {
    const val = field.defaultValue;
    if (typeof val === 'string') {
      parts.push(`DEFAULT '${val}'`);
    } else {
      parts.push(`DEFAULT ${val}`);
    }
  } else if (field.nullable) {
    parts.push('DEFAULT NULL');
  }

  if (field.references) {
    parts.push(`REFERENCES ${field.references.table}(${field.references.column})`);
  }

  return parts.join(' ');
}

export class SchemaSync {
  static async sync(
    db: DatabaseAdapter,
    tables: TableDefinition[],
    driver: DriverType,
  ): Promise<void> {
    const existingTables = await db.getTableNames();

    for (const table of tables) {
      if (existingTables.includes(table.name)) {
        // Table exists — add missing columns
        await this.syncColumns(db, table, driver);
      } else {
        // Create table
        await this.createTable(db, table, driver);
      }

      // Create missing indexes
      if (table.indexes) {
        await this.syncIndexes(db, table);
      }
    }
  }

  private static async createTable(
    db: DatabaseAdapter,
    table: TableDefinition,
    driver: DriverType,
  ): Promise<void> {
    const columnDefs = table.fields.map((f) => buildColumnDef(f, driver));
    const sql = `CREATE TABLE ${table.name} (\n  ${columnDefs.join(',\n  ')}\n)`;
    await db.execute(sql);
  }

  private static async syncColumns(
    db: DatabaseAdapter,
    table: TableDefinition,
    driver: DriverType,
  ): Promise<void> {
    const existingCols = await db.getColumnInfo(table.name);
    const existingNames = existingCols.map((c) => c.name);

    for (const field of table.fields) {
      if (!existingNames.includes(field.name)) {
        const colDef = buildColumnDef(field, driver);
        // ALTER TABLE ADD COLUMN — remove PRIMARY KEY and UNIQUE constraints
        const alterDef = colDef
          .replace(' PRIMARY KEY', '')
          .replace(' UNIQUE', '');
        await db.execute(`ALTER TABLE ${table.name} ADD COLUMN ${alterDef}`);
      }
    }
  }

  private static async syncIndexes(db: DatabaseAdapter, table: TableDefinition): Promise<void> {
    if (!table.indexes) return;

    for (const idx of table.indexes) {
      const uniqueStr = idx.unique ? 'UNIQUE ' : '';
      const sql = `CREATE ${uniqueStr}INDEX IF NOT EXISTS ${idx.name} ON ${table.name} (${idx.columns.join(', ')})`;
      try {
        await db.execute(sql);
      } catch {
        // Index might already exist — skip
      }
    }
  }
}
