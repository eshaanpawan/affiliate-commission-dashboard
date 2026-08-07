'use client';

// Tiny client-side cache helpers for stale-while-revalidate rendering.
//
// Two tiers, no dependencies:
//  - memoryCache: module-level Map. Survives client-side navigations, lost on
//    hard reload. Read synchronously in useState initializers so pages paint
//    cached data on the very first render.
//  - IndexedDB (idbGet/idbSet): survives hard reloads. Used for the big
//    ~1.4MB /api/dashboard payload — several period keys would blow the ~5MB
//    localStorage quota, and IDB avoids blocking the main thread with a
//    multi-MB JSON.stringify. Reads resolve in a few ms, so the cached paint
//    lands well before the network response.
//  - localStorage (lsGet/lsSet): for small payloads (insight cards) where a
//    synchronous first-render hydrate is worth it.
//
// All helpers are safe to call during SSR (they no-op / return null).

export const memoryCache = new Map<string, unknown>();

/* --------------------------- global refresh state -------------------------- */
// Every stale-while-revalidate fetch registers here so the UI can show one
// consistent "updating…" indicator while old data stays on screen.

let inflightCount = 0;
const refreshSubscribers = new Set<() => void>();

function notifyRefresh(): void {
  refreshSubscribers.forEach((cb) => cb());
}

/** Wrap a background revalidation promise so the global indicator tracks it. */
export function trackRefresh<T>(promise: Promise<T>): Promise<T> {
  inflightCount++;
  notifyRefresh();
  return promise.finally(() => {
    inflightCount = Math.max(0, inflightCount - 1);
    notifyRefresh();
  });
}

export function getRefreshCount(): number {
  return inflightCount;
}

export function subscribeRefresh(cb: () => void): () => void {
  refreshSubscribers.add(cb);
  return () => { refreshSubscribers.delete(cb); };
}

export function memGet<T>(key: string): T | null {
  return (memoryCache.get(key) as T | undefined) ?? null;
}

export function memSet(key: string, value: unknown): void {
  memoryCache.set(key, value);
}

/* ------------------------------ localStorage ------------------------------ */

const LS_PREFIX = 'affdash:';

export function lsGet<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or private mode — cache is best-effort.
  }
}

/* ------------------------------- IndexedDB -------------------------------- */

const DB_NAME = 'affiliate-dashboard-cache';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error('indexedDB open failed'));
      };
      req.onblocked = () => {
        dbPromise = null;
        reject(new Error('indexedDB open blocked'));
      };
    });
  }
  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Fire-and-forget write; never throws. */
export function idbSet(key: string, value: unknown): void {
  if (typeof indexedDB === 'undefined') return;
  openDb()
    .then((db) => {
      db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
    })
    .catch(() => {});
}
