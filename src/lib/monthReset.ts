import { clearAllCache } from './cache';

const STORAGE_KEY = 'alkhaled_last_month';

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Detects when the calendar month has advanced since the last app load.
 * When it has, clears stale local/session cache keys that could bleed
 * last month's data (attendance, grades, homework) into the new month's
 * clean-slate view, then records the new month so subsequent loads are no-ops.
 *
 * Returns true if a month transition was handled (caller may force-refresh).
 */
export function checkMonthReset(): boolean {
  const thisMonth = currentMonthKey();
  let lastMonth: string | null = null;
  try {
    lastMonth = localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }

  if (lastMonth === thisMonth) return false;

  // Month advanced (or first-ever load with a stored previous month).
  try {
    const keysToClear: string[] = [];
    const localKeys = Object.keys(localStorage);
    for (const key of localKeys) {
      if (key.startsWith('attendance_')) keysToClear.push(key);
    }
    for (const key of keysToClear) localStorage.removeItem(key);

    // Clear ALL session-scoped persistence: attendance state, scroll positions,
    // and critically the SWR cache (cache_ prefix) which holds last month's
    // fetched data (sessions, grades, homework, timeline, hall_of_fame, etc.).
    // Without this, stale August data bleeds into September views or causes
    // zeroed/empty displays when cached month-scoped keys don't match the new month.
    const sessionKeys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith('attendance_') || k.startsWith('att_session_') || k.startsWith('att_scroll_') || k.startsWith('cache_'))) {
        sessionKeys.push(k);
      }
    }
    for (const key of sessionKeys) sessionStorage.removeItem(key);

    // Also clear the in-memory SWR cache Map, which holds month-scoped
    // data (sessions, grades, homework, timeline, hall_of_fame) from last
    // month. Without this, swrFetch returns stale in-memory data immediately
    // and never re-fetches for the new month — causing both August/September
    // overlap and zeroed displays when cached keys don't match new-month queries.
    clearAllCache();
  } catch {
    // ignore storage errors
  }

  try {
    localStorage.setItem(STORAGE_KEY, thisMonth);
  } catch {
    // ignore
  }

  return lastMonth !== null;
}
