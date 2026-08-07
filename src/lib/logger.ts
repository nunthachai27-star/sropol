// Structured JSON logger with PDPA-aware field redaction.
// No external deps — keeps the bundle small and avoids supply-chain risk
// for a healthcare app that handles encrypted patient data.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const REDACTED = '[REDACTED]';

// Field names that must never reach logs (PDPA + auth tokens).
// Match is case-insensitive and substring-based so e.g. "patientCid" is caught.
//
// WHO containment T6 (spec §5 P2, §10.1): 'hn', 'patient_name', 'patientname',
// 'firstname', 'lastname' added — pre-existing `logger.warn('pregnancy_overlap',
// { hn: anc.hn, ... })`-style call sites (services/webhook.ts,
// services/sync/anc.ts) were leaking patient HN into logs unredacted before
// this. Deliberately NOT 'name' (bare) — that would also redact
// non-PHI keys like `eventName`/`hostname`. The substring match does
// over-redact incidental non-PHI keys containing "hn" (e.g. `hnList`, or
// the ProviderID `hnameTh` org-name field) — accepted collateral; the goal
// is zero PHI false negatives, not surgical precision.
const SENSITIVE_KEYS = [
  'cid',
  'password',
  'token',
  'jwt',
  'authorization',
  'apikey',
  'api_key',
  'sessionid',
  'session_id',
  'secret',
  'hn',
  'patient_name',
  'patientname',
  'firstname',
  'lastname',
];

function isSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => lower.includes(s));
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth limit]';
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitive(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

function emit(level: LogLevel, event: string, context: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(redact(context) as Record<string, unknown>),
  });
  // Use the matching console method so output preserves stderr/stdout semantics
  // and existing observability tooling (Docker logs, journald) continues to work.
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug(event: string, context?: Record<string, unknown>): void {
    if (process.env.LOG_LEVEL === 'debug') emit('debug', event, context);
  },
  info(event: string, context?: Record<string, unknown>): void {
    emit('info', event, context);
  },
  warn(event: string, context?: Record<string, unknown>): void {
    emit('warn', event, context);
  },
  error(event: string, context?: Record<string, unknown>): void {
    emit('error', event, context);
  },
};
