const DEFAULT_TIMEOUT = 10_000;

export type QueryResult<T> =
  | { data: T; error: null; status: 'success' }
  | { data: null; error: string; status: 'error' }
  | { data: null; error: string; status: 'timeout' };

export function withTimeout<T>(
  promise: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  ms: number = DEFAULT_TIMEOUT,
): Promise<{ data: T | null; error: string | null; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ data: null; error: null; timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ data: null, error: null, timedOut: true }), ms);
  });
  return Promise.race([
    (promise as Promise<{ data: T | null; error: { message: string } | null }>)
      .then((r) => ({ data: r.data, error: r.error?.message ?? null, timedOut: false as const })),
    timeout,
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  status: 'idle' | 'loading' | 'success' | 'error' | 'empty';
};

export function initAsyncState<T>(): AsyncState<T> {
  return { data: null, loading: false, error: null, status: 'idle' };
}

export function loadingState<T>(prev: AsyncState<T>): AsyncState<T> {
  return { data: prev.data, loading: true, error: null, status: 'loading' };
}

export function successState<T>(data: T): AsyncState<T> {
  const isEmpty = Array.isArray(data) && data.length === 0;
  return { data, loading: false, error: null, status: isEmpty ? 'empty' : 'success' };
}

export function errorState<T>(error: string): AsyncState<T> {
  return { data: null, loading: false, error, status: 'error' };
}
