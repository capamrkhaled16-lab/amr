const inflight = new Map<string, Promise<unknown>>();

export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

const pendingOps = new Map<string, { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }>();

export function idempotencyGuard(
  key: string,
  ttl: number = 5000,
): { isDuplicate: boolean; complete: (ok: boolean) => void } {
  if (pendingOps.has(key)) {
    return { isDuplicate: true, complete: () => {} };
  }
  let resolveFn: (ok: boolean) => void = () => {};
  const timer = setTimeout(() => {
    pendingOps.delete(key);
    resolveFn(false);
  }, ttl);
  pendingOps.set(key, { resolve: resolveFn, timer });
  return {
    isDuplicate: false,
    complete: (ok: boolean) => {
      const entry = pendingOps.get(key);
      if (entry) {
        clearTimeout(entry.timer);
        pendingOps.delete(key);
      }
      resolveFn(ok);
    },
  };
}

export function generateOpKey(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}:${parts.join(':')}`;
}
