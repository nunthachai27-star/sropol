// Phase 2 — clinical-chat tool dispatch with hospital-scope enforcement (plan
// 2026-08-03-clinical-chatbot-glm.md, codex risk #2: model-selected tools
// hallucinate scope by asking about another hospital's patient). Every tool
// invocation resolves against the SESSION hospital; a miss is an explicit
// "not in this hospital" result, never a cross-hospital guess.
import type { DatabaseAdapter } from '@/db/adapter';
import { buildChatContext, type ChatPatientContext } from './context-builder';
import { getPatientContextTool } from './tools';

export interface ToolResult {
  ok: boolean;
  notInScope?: boolean;
  message?: string;
  patient?: ChatPatientContext;
}

const TOOL_BY_NAME: Record<string, { name: string }> = {
  [getPatientContextTool.function.name]: getPatientContextTool as unknown as { name: string },
};

/**
 * Dispatches a model-requested tool call. `hospitalCode` is the session
 * hospital — the ONLY scope in which patient context is allowed to resolve.
 */
export async function executeToolCall(
  db: DatabaseAdapter,
  hospitalCode: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!TOOL_BY_NAME[toolName]) {
    return { ok: false, message: `เครื่องมือไม่รู้จัก: ${toolName}` };
  }
  if (toolName === getPatientContextTool.function.name) {
    const hn = typeof args.hn === 'string' && args.hn ? args.hn : undefined;
    const an = typeof args.an === 'string' && args.an ? args.an : undefined;
    if (!hn && !an) {
      return { ok: false, message: 'ต้องระบุ HN หรือ AN ของผู้ป่วย' };
    }
    const ctx = await buildChatContext(db, hospitalCode, { hn, an });
    const patient = ctx.patients.find((p) => (hn && p.hn === hn) || (an && p.an === an));
    if (!patient) {
      // The HN/AN exists elsewhere, or doesn't exist at all — either way the
      // model must not fabricate a cross-hospital answer.
      return {
        ok: false,
        notInScope: true,
        message: `ไม่พบผู้ป่วยนี้ในโรงพยาบาลปัจจุบัน (HN ${hn ?? '-'})`,
      };
    }
    // patient is already PDPA-masked (context-builder applies maskName/maskCid).
    return { ok: true, patient };
  }
  return { ok: false, message: `เครื่องมือยังไม่รองรับ: ${toolName}` };
}
