import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { getLastSynced, onSyncChange } from '@/lib/cache';
import { formatArabicDate } from '@/lib/format';

function formatSyncLabel(ts: number | null): string {
  if (!ts) return 'غير معروف';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'منذ لحظات';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  return formatArabicDate(new Date(ts));
}

export default function OfflineBanner() {
  const online = useOnlineStatus();
  const [lastSync, setLastSync] = useState<number | null>(getLastSynced());
  const [wasOffline, setWasOffline] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return onSyncChange((ts) => setLastSync(ts));
  }, []);

  useEffect(() => {
    if (!online) {
      setWasOffline(true);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      return;
    }
    if (!wasOffline) return;
    // On reconnect: wait briefly for network to stabilize, then emit a
    // cache:invalidated event so any screen listening can refresh in the
    // background. We never reload the page — the SWR layer re-fetches
    // stale entries on next access automatically.
    reconnectTimer.current = setTimeout(() => {
      import('@/lib/eventBus').then(({ eventBus }) => {
        eventBus.emit('cache:invalidated', { key: undefined });
      });
      setLastSync(getLastSynced());
      setWasOffline(false);
    }, 1500);
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [online, wasOffline]);

  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="fixed top-0 inset-x-0 z-[60] px-3 pt-2 pointer-events-none"
          role="status"
          aria-live="polite"
        >
          <div className="mx-auto max-w-md pointer-events-auto">
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-amber-500/15 backdrop-blur-md border border-amber-500/40 shadow-lg">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/20 flex-shrink-0">
                <WifiOff size={16} className="text-amber-300" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-amber-200 leading-tight">
                  غير متصل — تعرض بيانات محفوظة
                </p>
                <p className="text-[10px] text-amber-300/80 leading-tight mt-0.5 truncate">
                  آخر تحديث: {formatSyncLabel(lastSync)}
                </p>
              </div>
              <RefreshCw size={13} className="text-amber-300/60 animate-spin flex-shrink-0" style={{ animationDuration: '2s' }} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
