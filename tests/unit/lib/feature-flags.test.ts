import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isSimulationEnabled,
  isMaternalScreenIngestEnabled,
  isMaternalScreenShadowMode,
  isMaternalScreenUiEnabled,
  isMaternalScreenEventsEnabled,
} from '@/lib/feature-flags';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isSimulationEnabled', () => {
  it('is ALWAYS false in production, even when the flag says true', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_SIMULATION_ENABLED', 'true');
    expect(isSimulationEnabled()).toBe(false);
  });

  it('is false in production with the flag unset', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_SIMULATION_ENABLED', '');
    expect(isSimulationEnabled()).toBe(false);
  });

  it('defaults to enabled outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_SIMULATION_ENABLED', '');
    expect(isSimulationEnabled()).toBe(true);
  });

  it('can be explicitly disabled outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_SIMULATION_ENABLED', 'false');
    expect(isSimulationEnabled()).toBe(false);
  });
});

describe('isMaternalScreenIngestEnabled', () => {
  it('defaults to false when unset', () => {
    vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', '');
    expect(isMaternalScreenIngestEnabled()).toBe(false);
  });

  it('returns true when explicitly set to true', () => {
    vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'true');
    expect(isMaternalScreenIngestEnabled()).toBe(true);
  });

  it('returns false for non-truthy values', () => {
    vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'false');
    expect(isMaternalScreenIngestEnabled()).toBe(false);

    vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', '1');
    expect(isMaternalScreenIngestEnabled()).toBe(false);

    vi.stubEnv('MATERNAL_SCREEN_INGEST_ENABLED', 'yes');
    expect(isMaternalScreenIngestEnabled()).toBe(false);
  });
});

describe('isMaternalScreenShadowMode', () => {
  it('defaults to true when unset', () => {
    vi.stubEnv('MATERNAL_SCREEN_SHADOW_MODE', '');
    expect(isMaternalScreenShadowMode()).toBe(true);
  });

  it('returns false when explicitly set to false', () => {
    vi.stubEnv('MATERNAL_SCREEN_SHADOW_MODE', 'false');
    expect(isMaternalScreenShadowMode()).toBe(false);
  });

  it('returns true when set to other values', () => {
    vi.stubEnv('MATERNAL_SCREEN_SHADOW_MODE', 'true');
    expect(isMaternalScreenShadowMode()).toBe(true);

    vi.stubEnv('MATERNAL_SCREEN_SHADOW_MODE', '1');
    expect(isMaternalScreenShadowMode()).toBe(true);

    vi.stubEnv('MATERNAL_SCREEN_SHADOW_MODE', 'yes');
    expect(isMaternalScreenShadowMode()).toBe(true);
  });
});

describe('isMaternalScreenUiEnabled', () => {
  // Operator decision 2026-07-16: shadow-labeled read-only UI defaults ON
  // (same default-true convention as isMaternalScreenShadowMode).
  it('defaults to true when unset', () => {
    vi.stubEnv('MATERNAL_SCREEN_UI_ENABLED', '');
    expect(isMaternalScreenUiEnabled()).toBe(true);
  });

  it('returns true when explicitly set to true', () => {
    vi.stubEnv('MATERNAL_SCREEN_UI_ENABLED', 'true');
    expect(isMaternalScreenUiEnabled()).toBe(true);
  });

  it('returns false only when explicitly disabled', () => {
    vi.stubEnv('MATERNAL_SCREEN_UI_ENABLED', 'false');
    expect(isMaternalScreenUiEnabled()).toBe(false);
  });
});

describe('isMaternalScreenEventsEnabled', () => {
  it('defaults to false when unset', () => {
    vi.stubEnv('MATERNAL_SCREEN_EVENTS_ENABLED', '');
    expect(isMaternalScreenEventsEnabled()).toBe(false);
  });

  it('returns true when explicitly set to true', () => {
    vi.stubEnv('MATERNAL_SCREEN_EVENTS_ENABLED', 'true');
    expect(isMaternalScreenEventsEnabled()).toBe(true);
  });

  it('returns false for non-truthy values', () => {
    vi.stubEnv('MATERNAL_SCREEN_EVENTS_ENABLED', 'false');
    expect(isMaternalScreenEventsEnabled()).toBe(false);

    vi.stubEnv('MATERNAL_SCREEN_EVENTS_ENABLED', '1');
    expect(isMaternalScreenEventsEnabled()).toBe(false);

    vi.stubEnv('MATERNAL_SCREEN_EVENTS_ENABLED', 'yes');
    expect(isMaternalScreenEventsEnabled()).toBe(false);
  });
});
