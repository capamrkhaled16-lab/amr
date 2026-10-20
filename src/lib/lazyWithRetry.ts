import { lazy, type ComponentType } from 'react';

const retriedSet = new Set<string>();

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  const key = factory.toString();
  return lazy(() =>
    factory().catch((err: Error) => {
      if (
        err?.message?.includes('Failed to fetch dynamically imported module') ||
        err?.message?.includes('Importing a module script failed') ||
        err?.message?.includes('error loading dynamically imported module')
      ) {
        if (!retriedSet.has(key)) {
          retriedSet.add(key);
          return factory();
        }
      }
      throw err;
    })
  );
}
