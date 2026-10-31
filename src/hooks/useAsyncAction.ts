import { useState, useCallback, useRef } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'verified' | 'error';

/**
 * Wraps an async action so it can only run once at a time.
 * Prevents double-submit / duplicate requests via an in-flight ref guard.
 *
 * Returns a granular saveState for visual feedback:
 *   'idle'     → nothing happening
 *   'saving'   → request in progress (button disabled, spinner)
 *   'saved'    → optimistic success, data updated locally
 *   'verified' → server confirmed the write
 *   'error'    → business-logic error (validation, locked record)
 *
 * Network failures are surfaced as 'error' with a message asking the user to verify
 * before retrying, so a save is never reported as successful unless it was confirmed.
 */
export function useAsyncAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>
) {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const execute = useCallback(async (...args: TArgs): Promise<TResult | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSaveState('saving');
    setError(null);
    if (savedTimer.current) { clearTimeout(savedTimer.current); savedTimer.current = null; }
    try {
      const result = await fn(...args);
      setSaveState('saved');
      savedTimer.current = setTimeout(() => setSaveState('idle'), 2000);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      // Only surface business-logic errors, not transient network failures
      const isBusinessError = !isTransientNetworkError(msg);
      setError(isBusinessError ? msg : 'تعذّر تأكيد الحفظ بسبب ضعف الاتصال. تحقق من السجل قبل إعادة المحاولة.');
      setSaveState('error');
      console.error('[useAsyncAction]', err);
      return null;
    } finally {
      inFlight.current = false;
    }
  }, [fn]);

  const reset = useCallback(() => {
    setSaveState('idle');
    setError(null);
    if (savedTimer.current) { clearTimeout(savedTimer.current); savedTimer.current = null; }
  }, []);

  return { saveState, loading: saveState === 'saving', error, execute, setError, reset };
}

function isTransientNetworkError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('timeout') ||
    lower.includes('network') ||
    lower.includes('fetch') ||
    lower.includes('connection') ||
    lower.includes('temporarily') ||
    lower.includes('rate limit') ||
    lower.includes('econnreset') ||
    lower.includes('socket') ||
    lower.includes('offline') ||
    lower.includes('failed to fetch') ||
    lower.includes('write_timeout')
  );
}
