import { useState, useEffect, useCallback } from 'react';
import { getLastSynced, onSyncChange, getPendingQueueCount, flushQueue } from '@/lib/cache';

/**
 * Tracks the last successful server sync timestamp and pending write count.
 * Exposes a manual flush function so users can force-sync.
 */
export function useSyncStatus() {
  const [lastSynced, setLastSynced] = useState<number | null>(getLastSynced());
  const [pendingCount, setPendingCount] = useState(getPendingQueueCount());
  const [flushing, setFlushing] = useState(false);

  useEffect(() => {
    const unsub = onSyncChange((ts) => {
      setLastSynced(ts);
      setPendingCount(getPendingQueueCount());
    });
    const interval = setInterval(() => {
      setPendingCount(getPendingQueueCount());
      setLastSynced(getLastSynced());
    }, 5000);
    return () => { unsub(); clearInterval(interval); };
  }, []);

  const flush = useCallback(async () => {
    setFlushing(true);
    try {
      await flushQueue();
      setPendingCount(getPendingQueueCount());
      setLastSynced(getLastSynced());
    } finally {
      setFlushing(false);
    }
  }, []);

  return { lastSynced, pendingCount, flushing, flush };
}

/**
 * Returns a human-readable relative time string in Arabic.
 */
export function formatSyncTime(ts: number | null): string {
  if (!ts) return 'غير معروف';
  const diff = Date.now() - ts;
  if (diff < 5000) return 'الآن';
  if (diff < 60_000) return `قبل ${Math.floor(diff / 1000)} ثانية`;
  if (diff < 3_600_000) return `قبل ${Math.floor(diff / 60_000)} دقيقة`;
  if (diff < 86_400_000) return `قبل ${Math.floor(diff / 3_600_000)} ساعة`;
  return `قبل ${Math.floor(diff / 86_400_000)} يوم`;
}
