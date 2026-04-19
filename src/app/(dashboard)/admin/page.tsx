'use client';

import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import { Settings, KeyRound, Database } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BmsConfigTab } from '@/components/admin/BmsConfigTab';
import { WebhookKeysTab } from '@/components/admin/WebhookKeysTab';

export default function AdminPage() {
  useSetBreadcrumbs([
    { label: 'แดชบอร์ด', href: '/' },
    { label: 'ตั้งค่า' },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100">
          <Settings className="h-5 w-5 text-teal-700" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-800">ตั้งค่าระบบ</h1>
          <p className="text-sm text-slate-400">
            จัดการการเชื่อมต่อ HOSxP และ Webhook API Keys
          </p>
        </div>
      </div>

      <Tabs defaultValue="bms-config">
        <TabsList>
          <TabsTrigger value="bms-config" className="gap-2 px-4">
            <Database className="h-4 w-4" />
            BMS Tunnel
          </TabsTrigger>
          <TabsTrigger value="webhook-keys" className="gap-2 px-4">
            <KeyRound className="h-4 w-4" />
            Webhook API Keys
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bms-config" className="mt-4">
          <BmsConfigTab />
        </TabsContent>

        <TabsContent value="webhook-keys" className="mt-4">
          <WebhookKeysTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
