import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger } from '@/lib/logger';

describe('logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('emits structured JSON with event and timestamp', () => {
    logger.info('test_event', { foo: 'bar' });
    expect(logSpy).toHaveBeenCalledOnce();
    const line = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(line.level).toBe('info');
    expect(line.event).toBe('test_event');
    expect(line.foo).toBe('bar');
    expect(line.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('redacts cid, token, password, jwt, apiKey fields (case-insensitive)', () => {
    logger.error('auth_failed', {
      cid: '1234567890123',
      Token: 'secret',
      password: 'p@ss',
      jwt: 'ey.foo.bar',
      apiKey: 'kklrms_xxx',
      userId: 'visible',
    });
    const line = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(line.cid).toBe('[REDACTED]');
    expect(line.Token).toBe('[REDACTED]');
    expect(line.password).toBe('[REDACTED]');
    expect(line.jwt).toBe('[REDACTED]');
    expect(line.apiKey).toBe('[REDACTED]');
    expect(line.userId).toBe('visible');
  });

  it('redacts sensitive fields in nested objects', () => {
    logger.warn('nested', { user: { id: 'u1', sessionId: 'should-redact' } });
    const line = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(line.user.id).toBe('u1');
    expect(line.user.sessionId).toBe('[REDACTED]');
  });

  it('serializes Error objects with message and stack', () => {
    const err = new Error('boom');
    logger.error('caught', { error: err });
    const line = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(line.error.message).toBe('boom');
    expect(line.error.name).toBe('Error');
    expect(line.error.stack).toContain('boom');
  });

  it('routes error level to console.error and warn to console.warn', () => {
    logger.warn('w');
    logger.error('e');
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('skips debug logs unless LOG_LEVEL=debug', () => {
    delete process.env.LOG_LEVEL;
    logger.debug('hidden');
    expect(logSpy).not.toHaveBeenCalled();

    process.env.LOG_LEVEL = 'debug';
    logger.debug('shown');
    expect(logSpy).toHaveBeenCalledOnce();
    delete process.env.LOG_LEVEL;
  });

  // WHO containment T6 — HN and patient-name keys were not in SENSITIVE_KEYS,
  // so any log call carrying them (e.g. the pre-existing `hn: patient.hn`
  // sites in services/webhook.ts and services/sync/anc.ts) leaked PHI into
  // docker/journald logs. §5 P2 / §10.1 require these redacted before any
  // new telemetry (the T4/T5 counters) is allowed to log context.
  describe('PHI-safe key redaction (WHO containment T6)', () => {
    it('redacts hn, patient_name, patientName, firstname, lastname (case-insensitive)', () => {
      logger.warn('anc_ingest_anomalies', {
        hn: '12345',
        patient_name: 'x',
        patientName: 'x',
        firstname: 'x',
        lastname: 'x',
        hospitalId: 'visible-hosp-id',
      });
      const line = JSON.parse(warnSpy.mock.calls[0][0] as string);
      expect(line.hn).toBe('[REDACTED]');
      expect(line.patient_name).toBe('[REDACTED]');
      expect(line.patientName).toBe('[REDACTED]');
      expect(line.firstname).toBe('[REDACTED]');
      expect(line.lastname).toBe('[REDACTED]');
      expect(line.hospitalId).toBe('visible-hosp-id');
    });

    it('substring-matches hn (e.g. hnList) — accepted over-redaction, not a false negative', () => {
      logger.info('ok_event', { hnList: ['a', 'b'] });
      const line = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(line.hnList).toBe('[REDACTED]');
    });

    it('does NOT redact eventName or hostname — no bare "name" substring in SENSITIVE_KEYS', () => {
      logger.info('ok_event', { eventName: 'ok', hostname: 'h' });
      const line = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(line.eventName).toBe('ok');
      expect(line.hostname).toBe('h');
    });

    it('the new ANC ingestion-anomaly event context carries no PHI keys', () => {
      logger.warn('anc_ingest_anomalies', {
        hospitalId: 'h1',
        downgradesBlocked: 2,
        visitConflicts: 1,
      });
      const line = JSON.parse(warnSpy.mock.calls[0][0] as string);
      expect(line).not.toHaveProperty('hn');
      expect(line).not.toHaveProperty('cid');
      expect(line.downgradesBlocked).toBe(2);
      expect(line.visitConflicts).toBe(1);
    });
  });
});
