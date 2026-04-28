// T085: NextAuth.js v5 configuration with BMS Session auth
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { validateBmsSession } from '@/lib/auth-utils';
import { assertHospitalAccess } from '@/lib/hospital-access-guard';
import { logger } from '@/lib/logger';

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
        // isn't registered in /admin (exempt: ADMIN role, hcode 00000, 99999).
        // Failure closed so an operator removing a hospital from the admin
        // list immediately blocks new sessions.
        const allowed = await assertHospitalAccess({
          hospitalCode: identity.hospitalCode,
          role: identity.role,
        });
        if (!allowed) {
          logger.warn('bms_login_rejected_unregistered_hospital', {
            hospitalCode: identity.hospitalCode,
            hospitalName: identity.hospitalName,
            role: identity.role,
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
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.userCid = token.userCid;
        session.user.role = token.role;
        session.user.hospitalCode = token.hospitalCode;
        session.user.hospitalName = token.hospitalName;
        session.user.tunnelUrl = token.tunnelUrl;
        session.user.databaseType = token.databaseType;
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
