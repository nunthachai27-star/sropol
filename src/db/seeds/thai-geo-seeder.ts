// Seeds the Thai MOPH lookup tables from src/data/thai-geo JSONs.
// Runs once per fresh DB (skips if `provinces` already has rows). All four
// tables are populated in one transaction so the lookup set is atomic.
import type { DatabaseAdapter } from '../adapter';
import { DataSeeder } from './seeder';
import { THAI_PROVINCES, THAI_DISTRICTS, THAI_TAMBONS, MOPH_HOSPITALS } from '@/data/thai-geo';

export class ThaiGeoSeeder extends DataSeeder {
  getName(): string {
    return 'ThaiGeoSeeder';
  }

  async shouldRun(db: DatabaseAdapter): Promise<boolean> {
    const rows = await db.query<{ count: number }>('SELECT COUNT(*) as count FROM provinces');
    return Number(rows[0].count) === 0;
  }

  // Multi-row INSERT chunks: ~8,900 single-row statements took >5s on pglite
  // (one WASM round-trip per statement) and slow real Postgres boots too.
  // 900 binds per statement stays under SQLite's historic 999-variable floor
  // and far under Postgres' 65535 limit.
  private async insertChunked(
    db: DatabaseAdapter,
    table: string,
    columns: string[],
    rows: unknown[][],
  ): Promise<number> {
    const rowsPerChunk = Math.max(1, Math.floor(900 / columns.length));
    for (let i = 0; i < rows.length; i += rowsPerChunk) {
      const chunk = rows.slice(i, i + rowsPerChunk);
      const placeholders = chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
      await db.execute(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`,
        chunk.flat(),
      );
    }
    return rows.length;
  }

  async seed(db: DatabaseAdapter): Promise<number> {
    let count = 0;

    count += await this.insertChunked(
      db,
      'provinces',
      ['province_code', 'province_name'],
      THAI_PROVINCES.map((p) => [p.province_code, p.province_name]),
    );

    count += await this.insertChunked(
      db,
      'districts',
      ['district_code', 'district_name', 'province_code'],
      THAI_DISTRICTS.map((d) => [d.district_code, d.district_name, d.province_code]),
    );

    count += await this.insertChunked(
      db,
      'tambons',
      ['tambon_code', 'tambon_name', 'district_code'],
      THAI_TAMBONS.map((t) => [t.tambol_code, t.tambol_name, t.district_code]),
    );

    count += await this.insertChunked(
      db,
      'moph_hospitals',
      [
        'hcode',
        'name',
        'hospital_type_id',
        'hospital_level_id',
        'bed_count',
        'province_code',
        'district_code',
        'tambon_code',
        'address',
        'phone',
        'active_status',
      ],
      MOPH_HOSPITALS.map((h) => {
        // MOPH district/tambon codes are built by concatenating chwpart+amppart
        // (+tmbpart). Guard against rows where any segment is missing — we
        // still keep the row but leave derived codes NULL so lookups don't
        // match a nonexistent district/tambon.
        const provinceCode = h.chwpart ?? null;
        const districtCode = h.chwpart && h.amppart ? `${h.chwpart}${h.amppart}` : null;
        const tambonCode =
          h.chwpart && h.amppart && h.tmbpart ? `${h.chwpart}${h.amppart}${h.tmbpart}` : null;
        return [
          h.hospcode,
          h.name,
          h.hospital_type_id,
          h.hospital_level_id,
          h.bed_count,
          provinceCode,
          districtCode,
          tambonCode,
          h.addrpart,
          h.hospital_phone,
          h.active_status,
        ];
      }),
    );

    return count;
  }
}
