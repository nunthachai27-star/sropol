import { SessionProvider } from 'next-auth/react';
import { withBasePath } from '@/lib/base-path';

// next-auth's React client (signIn/useSession) defaults to the bare "/api/auth"
// path because it can't read the server-only NEXTAUTH_URL. Under a basePath
// deployment (/sr-lrms) that 404s, breaking login. The login page lives in this
// route group and has no other SessionProvider, so we pin the client basePath
// here. withBasePath('/api/auth') is just "/api/auth" when no basePath is set,
// so root deployments are unaffected.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <SessionProvider basePath={withBasePath('/api/auth')}>{children}</SessionProvider>;
}
