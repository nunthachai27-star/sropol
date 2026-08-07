// Layout for the in-call room: dark full-screen chrome shared by provincial
// and hospital users (both route groups link here on accept). Auth gating is
// handled by middleware.ts like every other private route.
import { SessionProvider } from 'next-auth/react';

export default function CallsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="min-h-screen bg-slate-950">{children}</div>
    </SessionProvider>
  );
}
