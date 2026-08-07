// T064: HighRiskAlert dialog — auto-opens when CPD >= 10
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CpdBadge } from '@/components/shared/CpdBadge';
import { RiskLevel } from '@/types/domain';
import { HIGH_RISK_RECOMMENDATION, isHighRisk } from '@/config/risk-levels';

interface HighRiskAlertProps {
  score: number;
  an: string;
  patientName?: string;
  onDismiss?: () => void;
}

export function HighRiskAlert({ score, an, patientName, onDismiss }: HighRiskAlertProps) {
  const [dismissed, setDismissed] = useState(false);

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  if (!isHighRisk(score)) return null;

  const open = !dismissed;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleDismiss();
      }}
    >
      <DialogContent className="border-2 border-red-500 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-lg text-red-600">
            แจ้งเตือนผู้คลอดเสี่ยงสูง
          </DialogTitle>
          <DialogDescription className="text-center">AN: {an}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <CpdBadge score={score} riskLevel={RiskLevel.HIGH} size="lg" />
          <p className="text-center text-lg font-bold text-red-600">{HIGH_RISK_RECOMMENDATION}</p>
        </div>

        <DialogFooter>
          <Button onClick={handleDismiss} variant="outline" className="w-full">
            รับทราบ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
