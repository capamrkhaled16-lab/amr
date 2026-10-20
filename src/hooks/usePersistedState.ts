import { useState, useEffect } from 'react';

/**
 * Persists state to localStorage (cross-session) instead of sessionStorage.
 * Falls back to sessionStorage if localStorage is unavailable.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = getStorage().getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      getStorage().setItem(key, JSON.stringify(state));
    } catch {
      /* ignore quota errors */
    }
  }, [key, state]);

  return [state, setState];
}

function getStorage(): Storage {
  try {
    const testKey = '__persist_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return localStorage;
  } catch {
    return sessionStorage;
  }
}

export function getPersistedId(key: string): string | null {
  try {
    const v = getStorage().getItem(key);
    return v ? (JSON.parse(v) as string) : null;
  } catch {
    return null;
  }
}

export function setPersistedId(key: string, id: string | null): void {
  try {
    if (id) getStorage().setItem(key, JSON.stringify(id));
    else getStorage().removeItem(key);
  } catch {
    /* ignore */
  }
}
