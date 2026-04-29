// T085: NextAuth.js v5 configuration with BMS Session auth
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { mapPositionToRole, validateBmsSession } from '@/lib/auth-utils';
import { assertHospitalAccess } from '@/lib/hospital-access-guard';
import { logger } from '@/lib/logger';
import { UserRole } from '@/types/domain';
import {
  consumeProviderPendingSession,
} from '@/lib/provider-id-session-store';
import { extractProviderScopes } from '@/lib/provider-id';

export { mapPositionToRole, validateBmsSession } from '@/lib/auth-utils';
export type { BmsUserIdentity } from '@/lib/auth-utils';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: 'BMS Session',
      credentials: {
        sessionId: { label: 'BMS Session ID', type: 'text' },
      },
      async authorize(credentials) {
        const sessionId = credentials?.sessionId as string;
        if (!sessionId) return null;

        const tunnelUrl = process.env.DEV_HOSPITAL_TUNNEL_URL ?? '';
        const identity = await validateBmsSession(sessionId, tunnelUrl);
        if (!identity) return null;

        // Reject the login when the BMS identity belongs to a hospital that
        // isn't registered (or is deactivated). Exempt only: hcode 00000 /
        // 99999 (system + provincial admin). Role does NOT bypass — even
        // ADMIN role from an unregistered hospital is denied; cross-province
        // admins must use one of the exempt hcodes. Failure closed so an
        // operator removing a hospital from the admin list immediately
        // blocks new sessions.
        const access = await assertHospitalAccess({
          hospitalCode: identity.hospitalCode,
          role: identity.role,
        });
        if (!access.allowed) {
          logger.warn('bms_login_rejected', {
            hospitalCode: identity.hospitalCode,
            hospitalName: identity.hospitalName,
            role: identity.role,
            reason: access.reason,
          });
          return null;
        }

        return {
          id: sessionId,
          name: identity.name,
          userCid: identity.userCid,
          role: identity.role,
          hospitalCode: identity.hospitalCode,
          hospitalName: identity.hospitalName,
          tunnelUrl: identity.tunnelUrl,
          databaseType: identity.databaseType,
          authProvider: 'bms',
          accessMode: 'readwrite',
        };
      },
    }),
    Credentials({
      id: 'provider-id',
      name: 'ProviderID',
      credentials: {
        token: { label: 'ProviderID one-time token', type: 'text' },
        organizationIndex: { label: 'Organization index', type: 'text' },
      },
      async authorize(credentials) {
        const token = typeof credentials?.token === 'string' ? credentials.token : '';
        const organizationIndex = Number(credentials?.organizationIndex ?? 0);
        if (!token || !Number.isInteger(organizationIndex)) return null;

        const pending = consumeProviderPendingSession(token, organizationIndex);
        if (!pending) return null;

        const { data } = pending;
        const org = data.organizations[pending.organizationIndex];
        if (!org?.hcode) return null;

        const mappedRole = mapPositionToRole(org.position ?? '');
        const readonlyRole = mappedRole === UserRole.ADMIN ? UserRole.NURSE : mappedRole;

        const access = await assertHospitalAccess({
          hospitalCode: org.hcode,
          role: readonlyRole,
        });
        if (!access.allowed) {
          logger.warn('provider_id_login_rejected', {
            hospitalCode: org.hcode,
            hospitalName: org.hname_th,
            providerId: data.user.provider_id,
            reason: access.reason,
          });
          return null;
        }

        return {
          id: `provider:${data.user.provider_id}`,
          name: `${data.user.title_th ?? ''}${data.user.name_th ?? data.user.name_eng}`.trim(),
          userCid: data.user.cid ?? '',
          role: readonlyRole,
          hospitalCode: org.hcode,
          hospitalName: org.hname_th || org.hname_eng || `รพ.${org.hcode}`,
          tunnelUrl: '',
          databaseType: '',
          authProvider: 'provider-id',
          accessMode: 'readonly',
          providerId: data.user.provider_id,
          providerCidHash: data.user.cid_hash,
          providerOrgHcode: org.hcode,
          providerScopes: extractProviderScopes(org),
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userCid = user.userCid;
        token.role = user.role;
        token.hospitalCode = user.hospitalCode;
        token.hospitalName = user.hospitalName;
        token.tunnelUrl = user.tunnelUrl;
        token.databaseType = user.databaseType;
        token.authProvider = user.authProvider;
        token.accessMode = user.accessMode;
        token.providerId = user.providerId;
        token.providerCidHash = user.providerCidHash;
        token.providerOrgHcode = user.providerOrgHcode;
        token.providerScopes = user.providerScopes;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? '';
        session.user.userCid = token.userCid;
        session.user.role = token.role;
        session.user.hospitalCode = token.hospitalCode;
        session.user.hospitalName = token.hospitalName;
        session.user.tunnelUrl = token.tunnelUrl;
        session.user.databaseType = token.databaseType;
        session.user.authProvider = token.authProvider;
        session.user.accessMode = token.accessMode;
        session.user.providerId = token.providerId;
        session.user.providerCidHash = token.providerCidHash;
        session.user.providerOrgHcode = token.providerOrgHcode;
        session.user.providerScopes = token.providerScopes;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },
  // SameSite=None + Secure required so the session cookie travels when KK-LRMS
  // is embedded as an iframe inside HOSxP / marketplace / partner portals
  // (cross-origin). In dev over http://localhost we fall back to Lax because
  // browsers reject Secure cookies on plain HTTP.
  useSecureCookies: process.env.NODE_ENV === 'production',
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-authjs.session-token'
          : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
});
