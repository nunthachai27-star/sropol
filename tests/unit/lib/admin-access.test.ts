// W6 (TDD, tests FIRST): the single source of truth for admin authorization.
// Both src/middleware.ts (Edge) and src/lib/admin-guard.ts (Node route
// handlers) MUST route through isAdminAuthorized so the role/CID/readonly rule
// can never diverge, and the BMS authorize() in src/lib/auth.ts routes through
// promoteRoleByAllowedCid so the allow-list's GRANT side lives here too.
import { describe, it, expect, afterEach } from 'vitest';
import {
  isAdminAuthorized,
  parseAdminAllowedCids,
  promoteRoleByAllowedCid,
} from '@/lib/admin-access';
import { UserRole } from '@/types/domain';

describe('parseAdminAllowedCids', () => {
  it('returns an empty list for undefined / empty / whitespace', () => {
    expect(parseAdminAllowedCids(undefined)).toEqual([]);
    expect(parseAdminAllowedCids('')).toEqual([]);
    expect(parseAdminAllowedCids('   ')).toEqual([]);
    expect(parseAdminAllowedCids(',,')).toEqual([]);
  });

  it('splits on commas and trims each entry', () => {
    expect(parseAdminAllowedCids('1111111111111,2222222222222')).toEqual([
      '1111111111111',
      '2222222222222',
    ]);
    expect(parseAdminAllowedCids(' 1111111111111 , 2222222222222 ')).toEqual([
      '1111111111111',
      '2222222222222',
    ]);
  });

  it('drops empty segments produced by stray commas', () => {
    expect(parseAdminAllowedCids('1111111111111,,3333333333333,')).toEqual([
      '1111111111111',
      '3333333333333',
    ]);
  });

  const ORIGINAL = process.env.ADMIN_ALLOWED_CIDS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_ALLOWED_CIDS;
    else process.env.ADMIN_ALLOWED_CIDS = ORIGINAL;
  });

  it('falls back to process.env.ADMIN_ALLOWED_CIDS when no arg is passed', () => {
    process.env.ADMIN_ALLOWED_CIDS = 'aaa,bbb';
    expect(parseAdminAllowedCids()).toEqual(['aaa', 'bbb']);
    delete process.env.ADMIN_ALLOWED_CIDS;
    expect(parseAdminAllowedCids()).toEqual([]);
  });
});

describe('isAdminAuthorized', () => {
  describe('role gate', () => {
    it('accepts an ADMIN with an empty allow-list OUTSIDE production only', () => {
      expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: '1' }, [], false)).toBe(true);
    });

    it('rejects non-admin roles regardless of CID', () => {
      expect(isAdminAuthorized({ role: UserRole.NURSE, userCid: '1' }, [])).toBe(false);
      expect(isAdminAuthorized({ role: UserRole.OBSTETRICIAN, userCid: '1' }, [])).toBe(false);
    });

    it('rejects a missing / unknown role', () => {
      expect(isAdminAuthorized({ role: undefined, userCid: '1' }, [])).toBe(false);
      expect(isAdminAuthorized({ role: null, userCid: '1' }, [])).toBe(false);
      expect(isAdminAuthorized({ role: 'SUPERUSER', userCid: '1' }, [])).toBe(false);
    });
  });

  describe('CID allow-list gate', () => {
    const LIST = ['1111111111111', '2222222222222'];

    it('accepts an ADMIN whose CID is on a non-empty allow-list', () => {
      expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: '1111111111111' }, LIST)).toBe(
        true,
      );
    });

    it('rejects an ADMIN whose CID is NOT on a non-empty allow-list', () => {
      expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: '9999999999999' }, LIST)).toBe(
        false,
      );
    });

    it('rejects an ADMIN with an empty / missing CID when the list is non-empty', () => {
      expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: '' }, LIST)).toBe(false);
      expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: undefined }, LIST)).toBe(false);
      expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: null }, LIST)).toBe(false);
    });

    it('rejects an ADMIN with an empty allow-list IN production (fail closed)', () => {
      expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: '1' }, [], true)).toBe(false);
      expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: '' }, [], true)).toBe(false);
      expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: undefined }, [], true)).toBe(false);
    });

    it('still enforces the CID gate in production when the list is non-empty', () => {
      expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: '1' }, ['1'], true)).toBe(true);
      expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: '2' }, ['1'], true)).toBe(false);
    });
  });

  describe('promotion via allow-list (promoteRoleByAllowedCid)', () => {
    const LIST = ['1111111111111', '2222222222222'];

    it('promotes a readwrite identity whose CID is on the allow-list to ADMIN', () => {
      expect(
        promoteRoleByAllowedCid(
          UserRole.NURSE,
          {
            userCid: '1111111111111',
            accessMode: 'readwrite',
          },
          LIST,
        ),
      ).toBe(UserRole.ADMIN);
      expect(
        promoteRoleByAllowedCid(
          UserRole.OBSTETRICIAN,
          {
            userCid: '2222222222222',
            accessMode: 'readwrite',
          },
          LIST,
        ),
      ).toBe(UserRole.ADMIN);
    });

    it('keeps an already-ADMIN role as ADMIN', () => {
      expect(
        promoteRoleByAllowedCid(
          UserRole.ADMIN,
          {
            userCid: '1111111111111',
            accessMode: 'readwrite',
          },
          LIST,
        ),
      ).toBe(UserRole.ADMIN);
    });

    it('leaves the role unchanged when the CID is not on the list', () => {
      expect(
        promoteRoleByAllowedCid(
          UserRole.NURSE,
          {
            userCid: '9999999999999',
            accessMode: 'readwrite',
          },
          LIST,
        ),
      ).toBe(UserRole.NURSE);
    });

    it('NEVER promotes a readonly (ProviderID) session even when its CID is listed', () => {
      expect(
        promoteRoleByAllowedCid(
          UserRole.NURSE,
          {
            userCid: '1111111111111',
            accessMode: 'readonly',
          },
          LIST,
        ),
      ).toBe(UserRole.NURSE);
    });

    it('fails closed when accessMode is missing — promotion requires an explicit readwrite session', () => {
      expect(promoteRoleByAllowedCid(UserRole.NURSE, { userCid: '1111111111111' }, LIST)).toBe(
        UserRole.NURSE,
      );
      expect(
        promoteRoleByAllowedCid(
          UserRole.NURSE,
          {
            userCid: '1111111111111',
            accessMode: null,
          },
          LIST,
        ),
      ).toBe(UserRole.NURSE);
    });

    it('does not promote with an empty allow-list or an empty / missing CID', () => {
      expect(
        promoteRoleByAllowedCid(
          UserRole.NURSE,
          {
            userCid: '1111111111111',
            accessMode: 'readwrite',
          },
          [],
        ),
      ).toBe(UserRole.NURSE);
      expect(
        promoteRoleByAllowedCid(UserRole.NURSE, { userCid: '', accessMode: 'readwrite' }, LIST),
      ).toBe(UserRole.NURSE);
      expect(
        promoteRoleByAllowedCid(
          UserRole.NURSE,
          {
            userCid: undefined,
            accessMode: 'readwrite',
          },
          LIST,
        ),
      ).toBe(UserRole.NURSE);
    });

    const ORIGINAL_CIDS = process.env.ADMIN_ALLOWED_CIDS;
    afterEach(() => {
      if (ORIGINAL_CIDS === undefined) delete process.env.ADMIN_ALLOWED_CIDS;
      else process.env.ADMIN_ALLOWED_CIDS = ORIGINAL_CIDS;
    });

    it('falls back to process.env.ADMIN_ALLOWED_CIDS when no list arg is passed', () => {
      process.env.ADMIN_ALLOWED_CIDS = '1111111111111';
      expect(
        promoteRoleByAllowedCid(UserRole.NURSE, {
          userCid: '1111111111111',
          accessMode: 'readwrite',
        }),
      ).toBe(UserRole.ADMIN);
    });

    it('a promoted identity passes isAdminAuthorized end-to-end (menu + /admin gates agree)', () => {
      const promoted = promoteRoleByAllowedCid(
        UserRole.OBSTETRICIAN,
        {
          userCid: '1111111111111',
          accessMode: 'readwrite',
        },
        LIST,
      );
      expect(
        isAdminAuthorized(
          { role: promoted, userCid: '1111111111111', accessMode: 'readwrite' },
          LIST,
          true,
        ),
      ).toBe(true);
    });
  });

  describe('readonly rejection', () => {
    it('rejects a readonly session even if it somehow carries the ADMIN role', () => {
      // ProviderID sessions downgrade ADMIN → NURSE, but requireAdmin is
      // defense-in-depth: a readonly access mode is never allowed into /admin.
      expect(
        isAdminAuthorized({ role: UserRole.ADMIN, userCid: '1', accessMode: 'readonly' }, []),
      ).toBe(false);
    });

    it('accepts a readwrite ADMIN', () => {
      expect(
        isAdminAuthorized({ role: UserRole.ADMIN, userCid: '1', accessMode: 'readwrite' }, []),
      ).toBe(true);
    });
  });
});
