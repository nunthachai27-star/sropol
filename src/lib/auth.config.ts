// Edge-safe NextAuth v5 config. The middleware imports this file directly and
// creates its own `auth()` instance, so this MUST NOT pull in any Node-only
// module (no `crypto`, no DB, no sync services). The full Node-side config
// (with Credentials providers and DB access in `authorize`) lives in `./auth`.
// See https://authjs.dev/guides/edge-compatibility for the pattern.
import type { NextAuthConfig } from 'next-auth';

export const authConfig: NextAuthConfig = {
  providers: [],
  // Pin the server-side Auth.js basePath to the bare "/api/auth". Next.js
  // strips the app basePath (/sr-lrms) BEFORE the request reaches the route
  // handler, so the handler always sees "/api/auth/...". Without this, Auth.js
  // derives basePath from NEXTAUTH_URL's path (/sr-lrms) and rejects every
  // request with "Bad request." The browser client is told the prefixed path
  // separately via <SessionProvider basePath> (see the route-group layouts).
  basePath: '/api/auth',
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
};
