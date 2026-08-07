// Phase 1 TDD — clinical-chat context builder with PDPA redaction (plan:
// docs/superpowers/plans/2026-08-03-clinical-chatbot-glm.md). The HIGHEST-RISK
// item is PDPA leakage through RAG assembly: the prompt block must never
// contain a raw patient name, raw CID, or cid_hash. Self-hosting relaxes only
// external-egress risk — minimization/access/log-safety still fully apply.
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey, encrypt, getEncryptionKey } from '@/lib/encryption';
import { buildChatContext } from '@/services/chat/context-builder';
import { maskName, maskCid } from '@/lib/pii-mask';

let db: DatabaseAdapter;
const KEY = generateKey();

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

async function seedHospitalAndPatient() {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
     VALUES ('h1', '10670', 'รพ.ทดสอบ', 'M2', true, 'ONLINE', ?, ?)`,
    [now, now],
  );
  const nameEnc = encrypt('ชัยพร สุรเตมีย์กุล', getEncryptionKey());
  const cidEnc = encrypt('3320500282121', getEncryptionKey());
  await db.execute(
    `INSERT INTO cached_patients (id, hospital_id, hn, an, name, cid, cid_hash, age, gravida, para, ga_weeks, admit_date, synced_at, created_at, updated_at)
     VALUES ('p1', 'h1', 'HN-1', 'AN-1', ?, ?, ?, 30, 2, 1, 28, ?, ?, ?, ?)`,
    [nameEnc, cidEnc, 'sha256cidhash', now, now, now, now],
  );
}

describe('buildChatContext — PDPA redaction allow-list', () => {
  it('emits masked name/masked CID and NEVER raw name, raw CID, or cid_hash', async () => {
    db = await createTestDb();
    await seedHospitalAndPatient();
    const ctx = await buildChatContext(db, 'h1', { hn: 'HN-1' });

    const block = JSON.stringify(ctx);
    // Raw identifiers must NOT leak.
    expect(block).not.toContain('ชัยพร สุรเตมีย์กุล');
    expect(block).not.toContain('3320500282121');
    expect(block).not.toContain('sha256cidhash');
    // Masked display values ARE present (allow-list).
    const maskedName = maskName('ชัยพร สุรเตมีย์กุล');
    const maskedCid = maskCid('3320500282121');
    expect(block).toContain(maskedName);
    expect(block).toContain(maskedCid);
    // Clinical fields survive (useful, non-identifying).
    expect(ctx.patients).toHaveLength(1);
    expect(ctx.patients[0].age).toBe(30);
    expect(ctx.patients[0].gaWeeks).toBe(28);
    expect(ctx.patients[0].gravida).toBe(2);
    expect(ctx.patients[0].para).toBe(1);
    await db.close?.();
  });

  it('returns empty context when no patient matches', async () => {
    db = await createTestDb();
    const ctx = await buildChatContext(db, 'h1', { hn: 'NOPE' });
    expect(ctx.patients).toHaveLength(0);
    await db.close?.();
  });
});
