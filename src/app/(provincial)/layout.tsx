import { SessionProvider } from 'next-auth/react';
import { BmsSessionProvider } from '@/contexts/BmsSessionContext';
import { CallProvider } from '@/components/calls/CallProvider';
import { TopNavBarSlot } from '@/components/layout/TopNavBarSlot';
import { ContentFrameSlot } from '@/components/layout/ContentFrameSlot';
import { BreadcrumbProvider } from '@/components/layout/BreadcrumbContext';
import { DbHealthBanner } from '@/components/layout/DbHealthBanner';
import { ClinicalChatPanel } from '@/components/chat/ClinicalChatPanel';

// BmsSessionProvider is mounted here (in addition to the (hospital) layout)
// so the provincial dashboard can participate in the BMS session flow —
// specifically for `useOnboardHosxpWebhook` on `/`, which auto-provisions
// HOSxP's webhook_setting row when a marketplace_token is in the URL. The
// provider no-ops when no bms-session-id is present, so it's safe for users
// who arrive at `/` without marketplace context.
export default function ProvincialLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <BmsSessionProvider>
        <CallProvider>
          <BreadcrumbProvider>
            <div className="flex min-h-screen flex-col bg-slate-50/50">
              <DbHealthBanner />
              <TopNavBarSlot />
              <main className="flex-1">
                <ContentFrameSlot>{children}</ContentFrameSlot>
              </main>
              {/* Clinical chatbot — statistics mode (provincial dashboard
                  aggregates). Clinical drilldown pages can override per-page. */}
              <ClinicalChatPanel mode="statistics" />
            </div>
          </BreadcrumbProvider>
        </CallProvider>
      </BmsSessionProvider>
    </SessionProvider>
  );
}
