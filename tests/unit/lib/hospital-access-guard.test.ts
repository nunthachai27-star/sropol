// Policy gate: which BMS-session identities may hold a KK-LRMS session.
// Runs against a fresh PGlite DB so the `hospitals` lookup is real and not
// mocked — the policy must stay aligned with the live schema.
import { describe, it, expect, beforeAll } from 'vitest';
import { isHospitalAccessAllowed } from '@/lib/hospital-access-guard';
import { UserRole } from '@/types/domain';
import { createPgliteApp, type PgliteAppContext } from '@/../tests/helpers/createPgliteApp';

// createPgliteApp seeds ~11k geo lookup rows which takes ~4-10s depending on
// parallel load. All five tests below are read-only against the same DB, so
// build it once via beforeAll (with a generous hook timeout) instead of per
// test. Saves ~40s on the full suite and avoids sporadic hook timeouts.
describe('isHospitalAccessAllowed', { timeout: 30000 }, () => {
  let ctx: PgliteAppContext;

  beforeAll(async () => {
    ctx = await createPgliteApp();
  }, 60000);

  // Policy (see hospital-access-guard.ts): the role-based ADMIN bypass was
  // deliberately REMOVED — mapPositionToRole() promotes anyone whose position
  // contains "director"/"ผู้อำนวยการ" to ADMIN, so an ADMIN from an
  // unregistered hcode must NOT get in. Cross-province admins use an exempt
  // hcode (00000/99999) instead, which the next test covers.
  it('denies an ADMIN whose hcode is not registered (role does not bypass the registry)', async () => {
    const allowed = await isHospitalAccessAllowed(
      { hospitalCode: '88888', role: UserRole.ADMIN },
      ctx.db,
    );
    expect(allowed).toBe(false);
  });

  it('allows an ADMIN on a reserved exempt hcode (the sanctioned cross-province path)', async () => {
    const allowed = await isHospitalAccessAllowed(
      { hospitalCode: '99999', role: UserRole.ADMIN },
      ctx.db,
    );
    expect(allowed).toBe(true);
  });

  it('allows the reserved 00000 hcode even with non-admin role', async () => {
    const allowed = await isHospitalAccessAllowed(
      { hospitalCode: '00000', role: UserRole.NURSE },
      ctx.db,
    );
    expect(allowed).toBe(true);
  });

  it('allows the reserved 99999 hcode even with non-admin role', async () => {
    const allowed = await isHospitalAccessAllowed(
      { hospitalCode: '99999', role: UserRole.OBSTETRICIAN },
      ctx.db,
    );
    expect(allowed).toBe(true);
  });

  it('allows a non-admin whose hcode is in the registered hospitals table', async () => {
    const allowed = await isHospitalAccessAllowed(
      { hospitalCode: '10670', role: UserRole.NURSE },
      ctx.db,
    );
    expect(allowed).toBe(true);
  });

  it('rejects a non-admin whose hcode is not in the registered hospitals', async () => {
    const allowed = await isHospitalAccessAllowed(
      { hospitalCode: '88888', role: UserRole.NURSE },
      ctx.db,
    );
    expect(allowed).toBe(false);
  });
});
