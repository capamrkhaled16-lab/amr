import { invalidateCache, invalidateByPrefix, optimisticWrite } from './cache';
import { idempotencyGuard, generateOpKey } from './idempotency';

const MAX_RETRIES = 2;
const BASE_DELAY = 800;
const WRITE_TIMEOUT = 15_000;

function isTransient(error: string): boolean {
  const lower = error.toLowerCase();
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
    lower.includes('failed to fetch')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withWriteTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('write_timeout')), WRITE_TIMEOUT);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

export type SaveOptions = {
  opKey: string;
  cacheKeys?: string[];
  cachePrefixes?: string[];
  skipDedupe?: boolean;
  /**
   * When true, the write fires in the background and the function resolves
   * immediately. Transient failures are queued for silent retry via the
   * optimistic write queue. The user never sees an error for network issues.
   * Non-transient errors (e.g. validation) are still thrown.
   */
  optimistic?: boolean;
};

/**
 * safeWrite executes a write operation with retries and cache invalidation.
 *
 * In optimistic mode (optimistic: true), the function resolves immediately
 * and the write happens in the background. Transient network errors are
 * silently queued for retry — the caller never sees "تعذر الحفظ".
 * Non-transient errors (validation, locked records) are still thrown
 * synchronously so the UI can show business-logic errors.
 */
export async function safeWrite<T>(
  fn: () => Promise<T>,
  options: SaveOptions
): Promise<T> {
  const { opKey, cacheKeys = [], cachePrefixes = [], skipDedupe = false, optimistic = false } = options;

  if (optimistic) {
    // Fire-and-forget: resolve immediately, write in background.
    // optimisticWrite already dedupes by opKey internally, so we skip
    // the idempotency guard here — it would block rapid re-saves within
    // 10s and surface as "تعذّر الحفظ" to the user.
    for (const key of cacheKeys) invalidateCache(key);
    for (const prefix of cachePrefixes) invalidateByPrefix(prefix);

    optimisticWrite(fn, { opKey, cacheKeys, cachePrefixes });

    // Return undefined — the caller proceeds as if the write succeeded.
    return undefined as unknown as T;
  }

  const guard = (!skipDedupe) ? idempotencyGuard(opKey, 5_000) : null;
  if (guard?.isDuplicate) {
    return undefined as unknown as T;
  }

  let lastError: Error = new Error('unknown');

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await withWriteTimeout(fn());

      for (const key of cacheKeys) invalidateCache(key);
      for (const prefix of cachePrefixes) invalidateByPrefix(prefix);

      guard?.complete(true);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message.toLowerCase();

      if (msg.includes('مقفلة') || msg.includes('تجاوز الدرجة') || msg.includes('لا يمكن أن تكون الدرجة سالبة')) {
        guard?.complete(false);
        throw lastError;
      }

      // The write may already have committed; retrying could duplicate it.
      if (msg === 'write_timeout') {
        guard?.complete(false);
        throw new Error('انتهت مهلة الحفظ ولم يتأكد النظام من نجاح العملية. تحقق من السجل قبل إعادة المحاولة.');
      }

      if (attempt < MAX_RETRIES && isTransient(msg)) {
        await sleep(BASE_DELAY * (attempt + 1));
        continue;
      }

      guard?.complete(false);
      throw lastError;
    }
  }

  guard?.complete(false);
  throw lastError;
}

export { generateOpKey };
