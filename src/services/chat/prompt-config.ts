// Clinical-chat prompt templates + PDPA-safe context rendering.
//
// Constitution: no hardcoded conditions for LLM prompts — the system template
// and the patient-context block are centralized here, versioned, and (Phase 2+)
// override-able from config. Everything rendered into a prompt is allow-listed
// and already redacted by context-builder; renderContextBlock only formats.
import type { ChatContext } from './context-builder';

/** Chat mode: maternity-ward = per-patient clinical RAG; statistics = dashboard
 *  aggregate counts (deterministic injection, no PHI lists). */
export type ClinicalChatMode = 'clinical' | 'statistics';

const SYSTEM_PROMPT =
  'คุณคือผู้ช่วยทางการแพทย์ด้านสูติกรรมของระบบ KK-LRMS ต่อคำถามของพยาบาล/แพทย์ ' +
  'ตอบเป็นภาษาไทย สั้น ตรงประเด็น ให้คำแนะนำที่ปลอดภัย และบอกเมื่อไม่แน่ใจ';

const STATISTICS_SYSTEM_PROMPT =
  'คุณคือผู้ช่วยวิเคราะห์สถิติด้านสูติกรรมของระบบ KK-LRMS ประจำหน่วยงาน ' +
  'ตอบเป็นภาษาไทย ใช้ตัวเลขจากบริบทสถิติที่ให้มาเท่านั้น ถ้าไม่มีตัวเลข ให้ตอบว่าไม่มีข้อมูล ' +
  'ห้ามเดาตัวเลขเอง และบอกช่วงเวลา/ขอบเขตของตัวเลขอย่างชัดเจน';

export function clinicalSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function statisticsSystemPrompt(): string {
  return STATISTICS_SYSTEM_PROMPT;
}

/**
 * Renders the PDPA-redacted patient context into a prompt block. The input is
 * ALREADY safe (maskName/maskCid by context-builder); this function must not
 * re-introduce identifiers — if a field is added here it must come from the
 * allow-list in context-builder. NEVER log the raw prompt body with patient
 * PHI (see risk register in the plan).
 */
export function renderContextBlock(ctx: ChatContext | null): string {
  if (!ctx || ctx.patients.length === 0) return '';
  const lines = ctx.patients.map((p) => {
    const ga = p.gaWeeks != null ? `${p.gaWeeks} สัปดาห์` : 'ไม่ทราบ';
    const g = p.gravida != null ? String(p.gravida) : '?';
    const pa = p.para != null ? String(p.para) : '?';
    // Pseudonymous case label + masked identifiers only (allow-list).
    return (
      `- ผู้ป่วย ${p.name} (HN ${p.hn}${p.an ? `, AN ${p.an}` : ''}) ` +
      `อายุ ${p.age} ปี · GA ${ga} · G${g}P${pa}`
    );
  });
  return `ผู้ป่วยในความดูแลของโรงพยาบาลนี้ (${ctx.hospitalId}):\n${lines.join('\n')}`;
}
