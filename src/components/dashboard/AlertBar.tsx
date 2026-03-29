'use client';

import { AlertTriangle, Clock, Truck } from 'lucide-react';
import type { DashboardAlerts } from '@/types/api';

interface AlertBarProps {
  alerts: DashboardAlerts;
}

export function AlertBar({ alerts }: AlertBarProps) {
  if (alerts.referralAlerts === 0 && alerts.overdueAnc === 0 && alerts.inTransitReferrals === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {alerts.referralAlerts > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          <div>
            <div className="text-sm font-medium text-orange-800">แจ้งเตือนส่งต่อ</div>
            <div className="text-xs text-orange-600">{alerts.referralAlerts} รายเกินศักยภาพ</div>
          </div>
          <span className="ml-auto text-lg font-bold text-orange-600">{alerts.referralAlerts}</span>
        </div>
      )}
      {alerts.overdueAnc > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <Clock className="h-5 w-5 text-red-500" />
          <div>
            <div className="text-sm font-medium text-red-800">ANC เลยนัด</div>
            <div className="text-xs text-red-600">{alerts.overdueAnc} รายไม่มาตามนัด</div>
          </div>
          <span className="ml-auto text-lg font-bold text-red-600">{alerts.overdueAnc}</span>
        </div>
      )}
      {alerts.inTransitReferrals > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <Truck className="h-5 w-5 text-amber-500" />
          <div>
            <div className="text-sm font-medium text-amber-800">กำลังส่งต่อ</div>
            <div className="text-xs text-amber-600">{alerts.inTransitReferrals} รายระหว่างเดินทาง</div>
          </div>
          <span className="ml-auto text-lg font-bold text-amber-600">{alerts.inTransitReferrals}</span>
        </div>
      )}
    </div>
  );
}
