import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { currentMonthKey as getSystemMonthKey } from '@/lib/data';
import { clearAllCache } from '@/lib/cache';

export function generateMonthOptions(count: number = 12): { key: string; label: string }[] {
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const now = new Date();
  const options: { key: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${months[d.getMonth()]} ${d.getFullYear()}`;
    options.push({ key, label });
  }
  return options;
}

type MonthContextValue = {
  monthKey: string;
  monthLabel: string;
  setMonthKey: (key: string) => void;
  isCurrentMonth: boolean;
  isStaleRequest: (requestMonthKey: string) => boolean;
  monthOptions: { key: string; label: string }[];
};

const MonthContext = createContext<MonthContextValue | null>(null);

const STORAGE_KEY = 'alkhaled_active_month';

function getStoredMonthKey(): string {
  // Always default to the system current month on fresh load.
  // Previous-month viewing is a within-session action only; we never
  // persist a stale month across sessions to prevent data bleeding.
  return getSystemMonthKey();
}

export function MonthProvider({ children }: { children: ReactNode }) {
  const [monthKey, setMonthKeyState] = useState<string>(getStoredMonthKey);
  const monthRef = useRef(monthKey);
  monthRef.current = monthKey;

  const monthOptions = generateMonthOptions(12);
  const currentLabel = monthOptions.find((m) => m.key === monthKey)?.label ?? monthKey;
  const isCurrentMonth = monthKey === getSystemMonthKey();

  const setMonthKey = useCallback((key: string) => {
    if (key === monthRef.current) return;
    monthRef.current = key;
    setMonthKeyState(key);
    try { localStorage.setItem(STORAGE_KEY, key); } catch { /* ignore */ }
    // Invalidate all month-scoped caches so new month data is fetched fresh.
    // This does NOT delete database records — only clears the in-memory/session SWR cache.
    clearAllCache();
  }, []);

  // On mount: always reset to the system current month to prevent
  // stale month data from bleeding into a new session.
  useEffect(() => {
    const sysKey = getSystemMonthKey();
    if (sysKey !== monthRef.current) {
      monthRef.current = sysKey;
      setMonthKeyState(sysKey);
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      clearAllCache();
    }
  }, []);

  const isStaleRequest = useCallback((requestMonthKey: string) => {
    return requestMonthKey !== monthRef.current;
  }, []);

  return (
    <MonthContext.Provider value={{ monthKey, monthLabel: currentLabel, setMonthKey, isCurrentMonth, isStaleRequest, monthOptions }}>
      {children}
    </MonthContext.Provider>
  );
}

export function useMonth(): MonthContextValue {
  const ctx = useContext(MonthContext);
  if (!ctx) {
    // Fallback for components not yet wrapped in MonthProvider
    const key = getSystemMonthKey();
    return {
      monthKey: key,
      monthLabel: key,
      setMonthKey: () => {},
      isCurrentMonth: true,
      isStaleRequest: () => false,
      monthOptions: generateMonthOptions(12),
    };
  }
  return ctx;
}
