/**
 * Minimal promise wrapper over the native `indexedDB` API — one database,
 * one object store, keyed access only (get/set/delete by string key). No
 * cursors, no indexes: the one caller (`autosave.ts`) only ever needs a
 * single record, so there's nothing here beyond what that needs. Kept
 * dependency-free (no `idb` package) the same way `App.tsx`'s test setup
 * hand-stubs missing jsdom APIs instead of pulling in a polyfill — this is
 * a thin enough surface that wrapping it by hand is less weight than a
 * dependency would be.
 */

const DB_NAME_PREFIX = 'enlace-ui';
const DB_VERSION = 1;
const STORE_NAME = 'autosave';

/**
 * IndexedDB is scoped to the browser *origin* (scheme+host+port) only, not
 * path — so two different Enlace-mounted apps reverse-proxied onto the
 * *same* origin at different paths (a real, supported topology: see
 * vite.config.ts's `base: './'` and types.ts's `resolveBaseUrl`, both
 * written specifically so one adapter can be mounted at `/app1/`, another
 * at `/app2/`, on the same host) would otherwise silently share one
 * database and overwrite each other's autosave. Namespacing the database
 * name by mount path keeps them apart. A literal `index.html` suffix and a
 * trailing slash are normalized away first so the *same* mount doesn't get
 * treated as a different one just because its URL was typed slightly
 * differently (`/app1`, `/app1/`, and `/app1/index.html` are all one
 * mount). `location` is absent outside a browser (this module is only
 * ever imported client-side, but exported for `indexedDb.test.ts` to
 * exercise directly).
 */
export function dbName(): string {
  if (typeof location === 'undefined') return DB_NAME_PREFIX;
  const path = location.pathname.replace(/\/index\.html$/, '').replace(/\/+$/, '') || '/';
  return `${DB_NAME_PREFIX}::${path}`;
}

/** False in any environment without IndexedDB at all (older/locked-down browsers, jsdom in tests) — callers use this to skip straight to "no persistence" without an error round-trip. */
export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }
    const request = indexedDB.open(dbName(), DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

/** Runs `run` against a fresh connection, always closing it afterward — simpler than holding a long-lived connection open for what's at most one debounced write every few hundred ms. */
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
      tx.oncomplete = () => resolve(request.result as T);
    });
  } finally {
    db.close();
  }
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return withStore('readonly', (store) => store.get(key));
}

export function idbSet(key: string, value: unknown): Promise<void> {
  return withStore('readwrite', (store) => store.put(value, key)).then(() => undefined);
}

export function idbDelete(key: string): Promise<void> {
  return withStore('readwrite', (store) => store.delete(key)).then(() => undefined);
}
