// Hospital route group layout — wraps the maternity-ward kiosk in
// SessionProvider (NextAuth) + BmsSessionProvider (BMS tunnel session) plus
// the shared TopNavBar. Auth gating is handled by middleware.ts (redirect to
// /login?callbackUrl=…&bms-session-id=…), so this layout doesn't perform its
// own session check.
import { SessionProvider } from 'next-auth/react';
import { BmsSessionProvider } from '@/contexts/BmsSessionContext';
import { TopNavBar } from '@/components/layout/TopNavBar';
import { withBasePath } from '@/lib/base-path';

export default function HospitalLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath={withBasePath('/api/auth')}>
      <BmsSessionProvider>
        <div className="flex min-h-screen flex-col bg-slate-50/50">
          <TopNavBar variant="hospital" />
          <main className="flex-1">{children}</main>
        </div>
      </BmsSessionProvider>
    </SessionProvider>
  );
}
