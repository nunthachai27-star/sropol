// Phase 2 — clinical-chat tool definitions for GLM-5.2 function calling.
//
// Tools are declared as OpenAI-compatible function specs. Arguments stay
// PHI-free (HN/AN strings only — never raw name/CID/cid_hash) so tool calls
// don't leak identifiers into the model's tool-args JSON.
import type { ChatCompletionTool } from '@/lib/llm-client';

export const getPatientContextTool = {
  type: 'function',
  function: {
    name: 'get_patient_context',
    description:
      'ดึงข้อมูลผู้ป่วยที่อยู่ในโรงพยาบาลปัจจุบันตาม HN หรือ AN (รหัสผู้ป่วยรายบุคคล ปลอดภัย ไม่มีข้อมูลระบุตัว)',
    parameters: {
      type: 'object',
      properties: {
        hn: { type: 'string', description: 'Hospital number (HN) ของผู้ป่วย' },
        an: { type: 'string', description: 'Admission number (AN) ของผู้ป่วย' },
      },
      additionalProperties: false,
    } as ChatCompletionTool['function']['parameters'],
  },
} as const satisfies ChatCompletionTool;

export const chatTools: ChatCompletionTool[] = [getPatientContextTool];
