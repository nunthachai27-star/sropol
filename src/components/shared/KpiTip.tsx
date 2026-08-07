// KpiTip — shared hover tooltip for KPI cells, panels, and cards.
//
// Same affordance the dashboard's AlertBar/ProvinceVitalsStrip established:
// hovering any important number explains, in Thai, exactly what it counts —
// copy mirrors the SQL/config definitions so the explanation can't drift
// from the metric without a code change. The `trigger` element keeps all of
// its own props (onClick, testids, styling); its content goes in `children`.
'use client';

import type { ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function KpiTip({
  title,
  body,
  trigger,
  children,
  side = 'bottom',
}: {
  title: string;
  body: ReactNode;
  /** Element rendered as the tooltip trigger — keeps its props/handlers. */
  trigger: ReactElement;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={trigger}>{children}</TooltipTrigger>
      <TooltipContent side={side} className="max-w-sm whitespace-normal text-left leading-snug">
        <div className="space-y-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[13px] opacity-90">{body}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
