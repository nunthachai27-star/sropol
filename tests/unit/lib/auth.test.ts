// T083: BMS Session auth provider tests — TDD: write tests FIRST
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapPositionToRole, validateBmsSession } from '@/lib/auth-utils';
import { UserRole } from '@/types/domain';

// Mock fetch for BMS API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('BMS Session Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mapPositionToRole', () => {
    it('maps director to ADMIN', () => {
      expect(mapPositionToRole('director')).toBe(UserRole.ADMIN);
      expect(mapPositionToRole('Director')).toBe(UserRole.ADMIN);
      expect(mapPositionToRole('ผู้อำนวยการ')).toBe(UserRole.ADMIN);
    });

    it('does not promote subordinate director titles to ADMIN', () => {
      expect(mapPositionToRole('Deputy Director')).not.toBe(UserRole.ADMIN);
      expect(mapPositionToRole('Assistant Director')).not.toBe(UserRole.ADMIN);
      expect(mapPositionToRole('รองผู้อำนวยการ')).not.toBe(UserRole.ADMIN);
      expect(mapPositionToRole('ผู้ช่วยผู้อำนวยการ')).not.toBe(UserRole.ADMIN);
    });

    it('does not demote directors whose titles merely contain exclusion substrings', () => {
      expect(mapPositionToRole('Director of Clinical Services')).toBe(UserRole.ADMIN);
      expect(mapPositionToRole('Nursing Services Director')).toBe(UserRole.ADMIN);
    });

    it('still demotes explicit vice directors', () => {
      expect(mapPositionToRole('Vice Director')).not.toBe(UserRole.ADMIN);
    });

    it('maps doctor/obstetrician to OBSTETRICIAN', () => {
      expect(mapPositionToRole('doctor')).toBe(UserRole.OBSTETRICIAN);
      expect(mapPositionToRole('สูติแพทย์')).toBe(UserRole.OBSTETRICIAN);
      expect(mapPositionToRole('แพทย์')).toBe(UserRole.OBSTETRICIAN);
    });

    it('maps other positions to NURSE by default', () => {
      expect(mapPositionToRole('nurse')).toBe(UserRole.NURSE);
      expect(mapPositionToRole('พยาบาล')).toBe(UserRole.NURSE);
      expect(mapPositionToRole('unknown')).toBe(UserRole.NURSE);
      expect(mapPositionToRole('')).toBe(UserRole.NURSE);
    });
  });

  describe('validateBmsSession', () => {
    it('validates session ID and returns user identity from BMS PasteJSON', async () => {
      // BMS PasteJSON API uses GET with Action=GET&code=<session-id>
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            user_info: {
              name: 'Dr. Test',
              position: 'doctor',
              hospital_code: '10670',
              location: 'รพ.ชุมแพ',
              bms_url: 'https://10670-tunnel.hosxp.net',
              bms_database_type: 'PostgreSQL',
            },
            auth_key: 'jwt-token-123',
            expired_second: 28800,
          },
          MessageCode: 200,
          Message: 'OK',
        }),
      });

      const result = await validateBmsSession('test-session-123', 'https://tunnel.example.com');

      expect(result).toBeDefined();
      expect(result!.name).toBe('Dr. Test');
      expect(result!.role).toBe(UserRole.OBSTETRICIAN);
      expect(result!.hospitalCode).toBe('10670');
      expect(result!.hospitalName).toBe('รพ.ชุมแพ');
      expect(result!.tunnelUrl).toBe('https://10670-tunnel.hosxp.net');
      expect(result!.databaseType).toBe('postgresql');
      expect(result!.jwt).toBe('jwt-token-123');
    });

    it('uses hcode as fallback hospital name when location is "server"', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            user_info: {
              name: 'Test User',
              position: 'User',
              hospital_code: '99999',
              location: 'server',
              bms_url: 'https://99999-tunnel.hosxp.net',
              bms_database_type: 'PostgreSQL',
            },
            auth_key: 'jwt-456',
            expired_second: 2592000,
          },
          MessageCode: 200,
          Message: 'OK',
        }),
      });

      const result = await validateBmsSession('dev-session', '');
      expect(result!.hospitalName).toBe('รพ.99999');
    });

    it('returns null for invalid session (MessageCode != 200)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {},
          MessageCode: 500,
          Message: 'No Action',
        }),
      });

      const result = await validateBmsSession('invalid-session', '');
      expect(result).toBeNull();
    });

    it('returns null for HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await validateBmsSession('bad-session', '');
      expect(result).toBeNull();
    });

    it('handles network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await validateBmsSession('test-session', '');
      expect(result).toBeNull();
    });
  });
});
