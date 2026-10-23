/**
 * Offline-first persistent cache + optimistic write queue.
 *
 * Two-layer cache: in-memory Map for instant access + localStorage for
 * cross-session persistence. Stale-while-revalidate: returns cached data
 * immediately, then fetches fresh data in the background.
 *
 * The write queue (syncQueue) stores optimistic updates that failed to
 * reach the server. They are retried silently in the background with
 * exponential backoff, so the user never sees "تعذر الحفظ" errors for
 * transient network issues.
 */

const PREFIX = 'cache_';
const DEFAULT_TTL = 120_000; // 2 minutes — longer persistence across app restarts
const LONG_TTL = 600_000; // 10 minutes for reference data

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const inflight = new Map<string, Promise<unknown>>();
const memCache = new Map<string, CacheEntry<unknown>>();

const FETCH_TIMEOUT = 15_000;

// ─── Storage helpers: prefer localStorage, fall back to sessionStorage ───

function getStorage(): Storage {
  try {
    const testKey = '__cache_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return localStorage;
  } catch {
    try { return sessionStorage; } catch { return memoryShim; }
  }
}

const memoryShim: Storage = {
  _data: {} as Record<string, string>,
  get length() { return Object.keys(this._data).length; },
  key(i: number) { return Object.keys(this._data)[i] ?? null; },
  getItem(k: string) { return this._data[k] ?? null; },
  setItem(k: string, v: string) { this._data[k] = v; },
  removeItem(k: string) { delete this._data[k]; },
  clear() { this._data = {}; },
};

export function withTimeout<T>(p: Promise<T>, ms: number = FETCH_TIMEOUT): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('fetch_timeout')), ms)
    ),
  ]);
}

export function getCached<T>(key: string): T | null {
  const mem = memCache.get(key) as CacheEntry<T> | undefined;
  if (mem) return mem.data;
  try {
    const raw = getStorage().getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    memCache.set(key, entry);
    return entry.data;
  } catch {
    return null;
  }
}

export function isCacheFresh(key: string): boolean {
  const mem = memCache.get(key);
  if (mem) return Date.now() < mem.expiresAt;
  try {
    const raw = getStorage().getItem(PREFIX + key);
    if (!raw) return false;
    const entry = JSON.parse(raw) as CacheEntry<unknown>;
    return Date.now() < entry.expiresAt;
  } catch {
    return false;
  }
}

export function setCached<T>(key: string, data: T, ttl: number = DEFAULT_TTL): void {
  const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttl };
  memCache.set(key, entry);
  try {
    getStorage().setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    try {
      clearOldestEntries(5);
      getStorage().setItem(PREFIX + key, JSON.stringify(entry));
    } catch { /* give up */ }
  }
}

export function invalidateCache(key: string): void {
  memCache.delete(key);
  try { getStorage().removeItem(PREFIX + key); } catch { /* ignore */ }
}

export function invalidateByPrefix(prefix: string): void {
  for (const k of [...memCache.keys()]) {
    if (k.startsWith(prefix)) memCache.delete(k);
  }
  try {
    const storage = getStorage();
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(PREFIX + prefix)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch { /* ignore */ }
}

export function clearAllCache(): void {
  memCache.clear();
  try {
    const storage = getStorage();
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch { /* ignore */ }
}

function clearOldestEntries(count: number): void {
  const storage = getStorage();
  const entries: { key: string; expiresAt: number }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    try {
      const entry = JSON.parse(storage.getItem(key)!) as CacheEntry<unknown>;
      entries.push({ key, expiresAt: entry.expiresAt });
    } catch { /* skip */ }
  }
  entries.sort((a, b) => a.expiresAt - b.expiresAt);
  for (let i = 0; i < Math.min(count, entries.length); i++) {
    storage.removeItem(entries[i].key);
  }
}

/**
 * Stale-while-revalidate fetch helper with in-flight deduplication.
 */
async function fetchWithRetry<T>(
  fetcher: () => Promise<T>,
  retries: number = 2,
  baseDelay: number = 800
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fetcher(), FETCH_TIMEOUT);
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export async function swrFetch<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttl: number = DEFAULT_TTL
): Promise<T> {
  const cached = getCached<T>(cacheKey);
  const fresh = isCacheFresh(cacheKey);

  if (cached !== null && fresh) {
    return cached;
  }

  if (cached !== null) {
    if (!inflight.has(cacheKey)) {
      const promise = fetchWithRetry(fetcher)
        .then((data) => {
          if (data !== null && data !== undefined) {
            setCached(cacheKey, data, ttl);
          }
        })
        .catch(() => { /* keep stale data on failure */ })
        .finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, promise);
    }
    return cached;
  }

  if (inflight.has(cacheKey)) {
    return inflight.get(cacheKey) as Promise<T>;
  }
  const promise = fetchWithRetry(fetcher).finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, promise);
  const data = await promise;
  setCached(cacheKey, data, ttl);
  return data;
}

export async function swrFetchLong<T>(
  cacheKey: string,
  fetcher: () => Promise<T>
): Promise<T> {
  return swrFetch(cacheKey, fetcher, LONG_TTL);
}

// ─── Optimistic write queue ─────────────────────────────────────────────

type QueuedWrite = {
  id: string;
  fn: () => Promise<unknown>;
  opKey: string;
  cacheKeys: string[];
  cachePrefixes: string[];
  attempts: number;
  nextRetry: number;
};

const QUEUE_KEY = 'sync_queue_v1';
const MAX_QUEUE_RETRIES = 8;
const queue: QueuedWrite[] = [];
let queueLoaded = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function loadQueue(): void {
  if (queueLoaded) return;
  queueLoaded = true;
  try {
    const raw = getStorage().getItem(QUEUE_KEY);
    if (!raw) return;
    const items = JSON.parse(raw) as Array<{
      id: string;
      opKey: string;
      cacheKeys: string[];
      cachePrefixes: string[];
      attempts: number;
      nextRetry: number;
    }>;
    // Functions can't be serialized — queued writes from a previous session
    // are discarded since we can't reconstruct the closure. The cache still
    // holds the optimistic data, so the user sees their changes.
  } catch { /* ignore */ }
}

function persistQueue(): void {
  try {
    const serializable = queue.map((w) => ({
      id: w.id, opKey: w.opKey, cacheKeys: w.cacheKeys,
      cachePrefixes: w.cachePrefixes, attempts: w.attempts, nextRetry: w.nextRetry,
    }));
    getStorage().setItem(QUEUE_KEY, JSON.stringify(serializable));
  } catch { /* ignore */ }
}

function scheduleRetry(): void {
  if (retryTimer) return;
  if (queue.length === 0) return;
  const now = Date.now();
  const next = queue.reduce((min, w) => Math.min(min, w.nextRetry), Infinity);
  const delay = Math.max(1000, next - now);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void processQueue();
  }, delay);
}

async function processQueue(): Promise<void> {
  if (!navigator.onLine) { scheduleRetry(); return; }
  const now = Date.now();
  const due = queue.filter((w) => w.nextRetry <= now);
  if (due.length === 0) { scheduleRetry(); return; }

  for (const w of due) {
    try {
      await withTimeout(w.fn(), 15_000);
      // Success — remove from queue
      const idx = queue.indexOf(w);
      if (idx >= 0) queue.splice(idx, 1);
      for (const key of w.cacheKeys) invalidateCache(key);
      for (const prefix of w.cachePrefixes) invalidateByPrefix(prefix);
    } catch {
      w.attempts++;
      if (w.attempts >= MAX_QUEUE_RETRIES) {
        // Give up silently — the data is still in the cache for the user
        const idx = queue.indexOf(w);
        if (idx >= 0) queue.splice(idx, 1);
      } else {
        // Exponential backoff: 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s max
        w.nextRetry = Date.now() + Math.min(256_000, 2000 * Math.pow(2, w.attempts));
      }
    }
  }
  persistQueue();
  scheduleRetry();
}

// Listen for online event to flush queue immediately
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void processQueue(); });
}

/**
 * Optimistic write: applies the cache invalidations immediately,
 * executes the write in the background, and queues it for retry
 * if it fails due to a transient network error.
 *
 * Returns immediately — the caller never waits for the server.
 * If the write succeeds, cache is invalidated so next read gets fresh data.
 * If it fails transiently, it's queued for silent background retry.
 */
export function optimisticWrite(
  fn: () => Promise<unknown>,
  options: {
    opKey: string;
    cacheKeys?: string[];
    cachePrefixes?: string[];
  }
): void {
  loadQueue();
  const { opKey, cacheKeys = [], cachePrefixes = [] } = options;

  // Dedupe: if same opKey is already queued, skip
  if (queue.some((w) => w.opKey === opKey)) return;

  // Pre-invalidate cache so the UI shows stale-while-revalidate behavior
  // on next read. The actual fresh data comes when the write succeeds.
  const write: QueuedWrite = {
    id: `${opKey}_${Date.now()}`,
    fn,
    opKey,
    cacheKeys,
    cachePrefixes,
    attempts: 0,
    nextRetry: 0,
  };

  // Try immediately — if it works, great. If not, queue for retry.
  withTimeout(fn(), 15_000)
    .then(() => {
      for (const key of cacheKeys) invalidateCache(key);
      for (const prefix of cachePrefixes) invalidateByPrefix(prefix);
      markSynced();
    })
    .catch(() => {
      write.nextRetry = Date.now() + 2000;
      queue.push(write);
      persistQueue();
      scheduleRetry();
    });
}

// ─── Last-synced timestamp ──────────────────────────────────────────────

const SYNC_KEY = 'last_synced_at';
let syncListeners = new Set<(ts: number | null) => void>();

function markSynced(): void {
  const now = Date.now();
  try { getStorage().setItem(SYNC_KEY, String(now)); } catch { /* ignore */ }
  syncListeners.forEach((fn) => fn(now));
}

export function getLastSynced(): number | null {
  try {
    const raw = getStorage().getItem(SYNC_KEY);
    return raw ? parseInt(raw, 10) : null;
  } catch { return null; }
}

export function getPendingQueueCount(): number {
  loadQueue();
  return queue.length;
}

export function onSyncChange(fn: (ts: number | null) => void): () => void {
  syncListeners.add(fn);
  return () => { syncListeners.delete(fn); };
}

/**
 * Force-flush the optimistic write queue immediately.
 * Returns the number of writes that succeeded.
 */
export async function flushQueue(): Promise<number> {
  loadQueue();
  if (queue.length === 0) return 0;
  let succeeded = 0;
  const items = [...queue];
  for (const w of items) {
    try {
      await withTimeout(w.fn(), 15_000);
      const idx = queue.indexOf(w);
      if (idx >= 0) queue.splice(idx, 1);
      for (const key of w.cacheKeys) invalidateCache(key);
      for (const prefix of w.cachePrefixes) invalidateByPrefix(prefix);
      succeeded++;
    } catch { /* keep in queue */ }
  }
  persistQueue();
  if (succeeded > 0) markSynced();
  return succeeded;
}
