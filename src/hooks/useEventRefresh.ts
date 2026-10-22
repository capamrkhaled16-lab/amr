import { useEffect, useRef } from 'react';
import { eventBus } from '@/lib/eventBus';
import { invalidateCache, invalidateByPrefix } from '@/lib/cache';

/**
 * Maps event bus events to the SWR cache keys/prefixes they should invalidate.
 * When a mutation emits an event (e.g. emitSessionsChanged), every component
 * that calls useEventRefresh will have its relevant cache entries busted,
 * causing the next render cycle to re-fetch fresh data via swrFetch.
 */
const EVENT_CACHE_MAP: Record<string, { keys?: string[]; prefixes?: string[] }> = {
  'students:changed': { prefixes: ['students_', 'all_students', 'kpi_', 'hof_'] },
  'attendance:changed': { prefixes: ['attendance_', 'kpi_', 'sessions_'] },
  'payments:changed': { prefixes: ['payments_', 'kpi_', 'feestotals_', 'finoverview_', 'dailycollections_', 'subscriptions_'] },
  'grades:changed': { prefixes: ['center_grades_', 'online_grades_', 'hof_', 'kpi_'] },
  'homework:changed': { prefixes: ['hw_', 'homework_', 'kpi_'] },
  'behavior:changed': { prefixes: ['behavior_', 'kpi_'] },
  'sessions:changed': { prefixes: ['sessions_', 'kpi_', 'attendance_'] },
  'groups:changed': { prefixes: ['groups_', 'kpi_'] },
  'exams:changed': { prefixes: ['exams_', 'center_exams_', 'online_exams_'] },
  'cache:invalidated': {},
};

/**
 * Subscribe to the event bus and invalidate relevant SWR cache entries
 * whenever a data-changing event fires. This gives instant cross-screen
 * sync: when attendance is saved in one module, the dashboard's KPI cache
 * is busted and its next render pulls fresh data.
 *
 * Pass `onInvalidate` to trigger a component-level re-fetch after cache
 * busting (e.g. call your loadData function).
 */
export function useEventRefresh(
  events: string[],
  onInvalidate?: () => void
): void {
  const callbackRef = useRef(onInvalidate);
  callbackRef.current = onInvalidate;

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    for (const eventName of events) {
      const handler = () => {
        const mapping = EVENT_CACHE_MAP[eventName];
        if (mapping) {
          for (const key of mapping.keys ?? []) invalidateCache(key);
          for (const prefix of mapping.prefixes ?? []) invalidateByPrefix(prefix);
        }
        if (callbackRef.current) callbackRef.current();
      };

      unsubs.push(
        eventBus.on(eventName as never, handler as never) as unknown as () => void
      );
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [events.join('|')]); // stable deps per event combination
}
