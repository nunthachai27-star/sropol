// Hook to trigger immediate data sync for the user's hospital.
'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

interface SyncResult {
  synced: boolean;
  reason: string;
  lastSyncAt: string | null;
  patientsCount?: number;
}

interface SyncJob {
  hospitalId: string;
  status: 'idle' | 'queued' | 'running' | 'completed' | 'failed';
  running: boolean;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: SyncResult | null;
  error: string | null;
}

interface SyncApiResponse {
  queued?: boolean;
  hcode?: string | null;
  job: SyncJob | null;
  reason?: string;
}

export function useSyncTrigger(onSyncComplete?: () => void) {
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncApiResponse | null>(null);
  const notifiedFinishedAt = useRef<string | null>(null);

  const applyStatus = useCallback((payload: SyncApiResponse) => {
    setLastResult(payload);
    const job = payload.job;
    setSyncing(job?.running ?? false);

    if (
      job?.finishedAt &&
      job.finishedAt !== notifiedFinishedAt.current &&
      job.result?.synced
    ) {
      notifiedFinishedAt.current = job.finishedAt;
      onSyncComplete?.();
    }
  }, [onSyncComplete]);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/sync/status', { cache: 'no-store' });
      if (response.ok) {
        applyStatus(await response.json() as SyncApiResponse);
      } else {
        setSyncing(false);
      }
    } catch {
      setSyncing(false);
    }
  }, [applyStatus]);

  const triggerSync = useCallback(async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/sync/trigger', {
        method: 'POST',
      });

      if (response.ok) {
        applyStatus(await response.json() as SyncApiResponse);
      } else {
        setSyncing(false);
      }
    } catch {
      // Best-effort — dashboard still shows cached data
      setSyncing(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    if (!syncing) return;

    const interval = setInterval(() => {
      void refreshStatus();
    }, 2000);

    return () => clearInterval(interval);
  }, [refreshStatus, syncing]);

  return { syncing, lastResult, triggerSync };
}
