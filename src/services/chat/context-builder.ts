// Phase 1 — clinical-chat context builder (direct SQL RAG, PDPA-redacted).
//
// Builds the allow-listed clinical context block that is injected into the chat
// prompt. Everything this function emits is safe for GLM-5.2:
//   - raw name / raw CID / cid_hash NEVER leak (decrypt + maskName/maskCid)
//   - clinical fields (age, GA, gravida/para, per-plan) travel as-is
// This is the highest-PDPA-risk surface — anything added here must be
// non-identifying or masked (constitution: PDPA for all patient data).
import type { DatabaseAdapter } from '@/db/adapter';
import { decryptSafe } from '@/lib/encryption';
import { maskName, maskCid } from '@/lib/pii-mask';

export interface ChatPatientContext {
  hn: string;
  an: string;
  name: string;
  cid: string;
  age: number;
  gaWeeks: number | null;
  gravida: number | null;
  para: number | null;
}

export interface ChatContext {
  hospitalId: string;
  patients: ChatPatientContext[];
}

export interface ChatContextFilter {
  hn?: string;
  an?: string;
}

export async function buildChatContext(
  db: DatabaseAdapter,
  hospitalId: string,
  filter: ChatContextFilter = {},
): Promise<ChatContext> {
  // Codebase canonical SQL placeholder is `?` (adapters rewrite ? -> $N; see
  // pglite-adapter/postgres-adapter). Never hand-write $N here.
  const where = ['hospital_id = ?'];
  const params: unknown[] = [hospitalId];
  if (filter.hn) {
    params.push(filter.hn);
    where.push('hn = ?');
  }
  if (filter.an) {
    params.push(filter.an);
    where.push('an = ?');
  }
  // Newest patients first; cap to keep the prompt bounded (cost: token cap).
  const rows = await db.query<{
    hn: string;
    an: string;
    name: string | null;
    cid: string | null;
    age: number;
    ga_weeks: number | null;
    gravida: number | null;
    para: number | null;
  }>(
    `SELECT hn, an, name, cid, age, ga_weeks, gravida, para
     FROM cached_patients
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 10`,
    params,
  );

  const patients: ChatPatientContext[] = rows.map((r) => ({
    hn: r.hn,
    an: r.an,
    name: maskName(decryptSafe(r.name)),
    cid: maskCid(decryptSafe(r.cid)),
    age: r.age,
    gaWeeks: r.ga_weeks,
    gravida: r.gravida,
    para: r.para,
  }));

  return { hospitalId, patients };
}
