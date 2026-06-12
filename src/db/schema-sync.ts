// T021: SchemaSync engine — introspects DB schema and creates/alters tables to match definitions

import type { DatabaseAdapter, ColumnInfo } from './adapter';
import type { TableDefinition, FieldDefinition, AbstractFieldType } from './table-definition';

export type DriverType = 'sqlite' | 'postgresql';

/**
 * Returns the `ALTER TABLE ... ALTER COLUMN ... TYPE …` needed to widen an
 * existing column to match the table definition, or `null` when no change is
 * needed/safe. Two widening cases:
 *
 *   - `string` def with a larger `maxLength` than the live column → VARCHAR(n)
 *   - `text` def over a live bounded VARCHAR → TEXT (HOSxP free-text columns
 *     that outgrew every fixed width; TEXT ⊇ any VARCHAR, so this never loses
 *     data and Postgres treats varchar→text as a no-rewrite, binary-coercible
 *     change)
 *
 * Only ever widens — never shrinks (that would truncate live data). Postgres
 * only: SQLite stores strings as TEXT with no enforced width, so there is
 * nothing to alter. A column whose live width is unknown (`maxLength` null —
 * already TEXT or a non-string type) is left untouched.
 */
export function columnWidenSql(
  tableName: string,
  field: FieldDefinition,
  existing: ColumnInfo,
  driver: DriverType,
): string | null {
  if (driver !== 'postgresql') return null;
  // Only a live *bounded* VARCHAR can be too narrow; null width means TEXT or a
  // non-string type, both already wide enough.
  if (existing.maxLength == null) return null;
  if (field.type === 'text') {
    return `ALTER TABLE ${tableName} ALTER COLUMN ${field.name} TYPE TEXT`;
  }
  if (field.type !== 'string' || !field.maxLength) return null;
  if (field.maxLength <= existing.maxLength) return null;
  return `ALTER TABLE ${tableName} ALTER COLUMN ${field.name} TYPE VARCHAR(${field.maxLength})`;
}

const TYPE_MAP: Record<DriverType, Record<AbstractFieldType, string>> = {
  sqlite: {
    uuid: 'TEXT',
    string: 'TEXT',
    text: 'TEXT',
    integer: 'INTEGER',
    decimal: 'REAL',
    boolean: 'INTEGER',
    datetime: 'TEXT',
    json: 'TEXT',
    'string[]': 'TEXT',
  },
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
  if (field.type === 'string' && field.maxLength && driver === 'postgresql') {
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
    } else if (typeof val === 'boolean') {
      if (driver === 'sqlite') {
        parts.push(`DEFAULT ${val ? 1 : 0}`);
      } else {
        parts.push(`DEFAULT ${val}`);
      }
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
    const existingByName = new Map(existingCols.map((c) => [c.name, c]));

    for (const field of table.fields) {
      const existing = existingByName.get(field.name);
      if (!existing) {
        const colDef = buildColumnDef(field, driver);
        // ALTER TABLE ADD COLUMN — remove PRIMARY KEY and UNIQUE constraints
        const alterDef = colDef
          .replace(' PRIMARY KEY', '')
          .replace(' UNIQUE', '');
        await db.execute(`ALTER TABLE ${table.name} ADD COLUMN ${alterDef}`);
        continue;
      }
      // Column exists — widen it if the definition outgrew the live width.
      // (ADD COLUMN above never runs for existing columns, so a bumped
      // maxLength would otherwise never reach a deployed Postgres DB.)
      const widenSql = columnWidenSql(table.name, field, existing, driver);
      if (widenSql) {
        await db.execute(widenSql);
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
