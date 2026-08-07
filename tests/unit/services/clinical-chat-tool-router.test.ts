// Phase 2 TDD — clinical-chat tool router (plan 2026-08-03-clinical-chatbot-glm).
// Codex-flagged risk: "model-selected tools hallucinate scope (requesting
// another hospital's patient)". The router MUST enforce the session-hospital
// scope — a patient the model asks about that lives in a DIFFERENT hospital
// resolves to an explicit "not in this hospital" result, never a guess. Tool
// arguments are PHI-free: HN/AN strings only (no raw name/CID/cid_hash).
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey, encrypt, getEncryptionKey } from '@/lib/encryption';
import { executeToolCall } from '@/services/chat/tool-router';
import { getPatientContextTool } from '@/services/chat/tools';

let db: DatabaseAdapter;
const KEY = generateKey();

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

async function seedHospitalPatient(hospitalId: string, hn: string, an: string) {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
     VALUES (?, ?, ?, 'M2', true, 'ONLINE', ?, ?)`,
    [hospitalId, hospitalId, `รพ.${hospitalId}`, now, now],
  );
  await db.execute(
    `INSERT INTO cached_patients (id, hospital_id, hn, an, name, cid, cid_hash, age, gravida, para, ga_weeks, admit_date, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 30, 2, 1, 28, ?, ?, ?, ?)`,
    [
      `p-${hospitalId}-${hn}`,
      hospitalId,
      hn,
      an,
      encrypt('ชัยพร สุรเตมีย์กุล', getEncryptionKey()),
      encrypt('3320500282121', getEncryptionKey()),
      'sha256cidhash',
      now,
      now,
      now,
      now,
    ],
  );
}

describe('executeToolCall — hospital-scope enforcement + PHI-free args', () => {
  it('resolves a patient in the session hospital by HN', async () => {
    db = await createTestDb();
    await seedHospitalPatient('h1', 'HN-1', 'AN-1');
    const res = await executeToolCall(db, 'h1', getPatientContextTool.function.name, {
      hn: 'HN-1',
    });
    expect(res.ok).toBe(true);
    expect(res.patient?.hn).toBe('HN-1');
    // Masked, no raw PHI in the result.
    expect(res.patient?.name).not.toContain('ชัยพร สุรเตมีย์กุล');
    expect(res.patient?.cid).not.toContain('3320500282121');
    await db.close?.();
  });

  it('DENIES a patient that only exists in a different hospital', async () => {
    db = await createTestDb();
    await seedHospitalPatient('h1', 'HN-1', 'AN-1'); // patient lives ONLY at h1
    // Model asks about HN-1 while the session hospital is h2.
    const res = await executeToolCall(db, 'h2', getPatientContextTool.function.name, {
      hn: 'HN-1',
    });
    expect(res.ok).toBe(false);
    expect(res.notInScope).toBe(true);
    expect(res.message).toContain('ไม่พบผู้ป่วยนี้ในโรงพยาบาลปัจจุบัน');
    await db.close?.();
  });

  it('keeps tool ARGUMENTS PHI-free (no raw name / CID / cid_hash in args)', async () => {
    const argsJson = JSON.stringify({
      hn: 'HN-1',
      an: 'AN-1',
    });
    expect(argsJson).not.toContain('ชัยพร');
    expect(argsJson).not.toContain('33205');
    expect(argsJson).not.toContain('sha256cidhash');
    // The OpenAI tool schema declares ONLY hn/an as properties.
    const params = getPatientContextTool.function.parameters.properties as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual(['an', 'hn']);
  });

  it('rejects unknown tool names', async () => {
    db = await createTestDb();
    const res = await executeToolCall(db, 'h1', 'not_a_tool', {});
    expect(res.ok).toBe(false);
    await db.close?.();
  });
});
