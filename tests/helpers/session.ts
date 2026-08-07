import { UserRole } from '@/types/domain';

/**
 * Session-user fabricator with REAL domain values. Never use ad-hoc literals
 * like role: 'user' or accessMode: 'full' — they are outside the type domain
 * and silently pass accessMode/role gates, masking authorization regressions.
 */
export function testSessionUser(input: {
  hospitalCode: string;
  id?: string;
  name?: string;
  userCid?: string;
  role?: UserRole;
  hospitalName?: string;
  accessMode?: 'readwrite' | 'readonly';
}) {
  return {
    id: input.id ?? `u-${input.hospitalCode}`,
    name: input.name ?? 'พว.ทดสอบ ระบบ',
    userCid: input.userCid ?? '1100500090006',
    role: input.role ?? UserRole.NURSE,
    hospitalCode: input.hospitalCode,
    hospitalName: input.hospitalName ?? `รพ.${input.hospitalCode}`,
    tunnelUrl: '',
    databaseType: '',
    authProvider: 'bms' as const,
    accessMode: input.accessMode ?? ('readwrite' as const),
  };
}
