// IndexedDB-backed response cache.
//
// This is why the app is served from http://127.0.0.1:8787 rather than opened as a file:
// Chromium restricts IndexedDB on file:// origins, and file://, localhost and 127.0.0.1 are
// three separate storage buckets. Pinning one origin keeps the cache and your progress together.

import { cacheKey, isExpired, selectEvictions, sizeOf, ttlFor, DEFAULT_BUDGET_BYTES } from './lib/cachePolicy.js';

export const ACTIVE_DB_NAME = 'mrt-cache-v2';
export const LEGACY_DB_NAME = 'mrt-cache';
const DB_VERSION = 1;
const STORE = 'responses';

export class ResponseCache {
  constructor({ baseUrl, schemaVersion = 2, budget = DEFAULT_BUDGET_BYTES } = {}) {
    this.baseUrl = baseUrl;
    this.schemaVersion = schemaVersion;
    this.budget = budget;
    this.dbPromise = null;
    this.indexedDB = globalThis.indexedDB;
    this.available = typeof this.indexedDB !== 'undefined';
  }

  open() {
    if (!this.available) return Promise.resolve(null);
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        let req;
        try {
          req = this.indexedDB.open(ACTIVE_DB_NAME, DB_VERSION);
        } catch {
          this.available = false;
          return resolve(null);
        }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('lastAccess', 'lastAccess');
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            db.close();
            this.available = false;
            this.dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = () => {
          // Caching is an optimisation. Losing it must never break the app.
          this.available = false;
          resolve(null);
        };
        req.onblocked = () => resolve(null);
      });
    }
    return this.dbPromise;
  }

  key(path) {
    return cacheKey({ baseUrl: this.baseUrl, schemaVersion: this.schemaVersion, path });
  }

  async get(path) {
    const db = await this.open();
    if (!db) return null;
    const key = this.key(path);
    const entry = await idbReq(db, STORE, 'readonly', (s) => s.get(key));
    if (!entry || isExpired(entry)) return null;
    entry.lastAccess = Date.now();
    idbReq(db, STORE, 'readwrite', (s) => s.put(entry)).catch(() => {});
    return entry.value;
  }

  async set(path, value) {
    const db = await this.open();
    if (!db) return;
    const bytes = sizeOf(value);
    await this.evictFor(bytes);
    const entry = {
      key: this.key(path),
      value,
      bytes,
      ttl: ttlFor(path),
      storedAt: Date.now(),
      lastAccess: Date.now(),
    };
    try {
      await idbReq(db, STORE, 'readwrite', (s) => s.put(entry));
    } catch {
      /* cache write failures are non-fatal */
    }
  }

  async entries() {
    const db = await this.open();
    if (!db) return [];
    const all = (await idbReq(db, STORE, 'readonly', (s) => s.getAll())) ?? [];
    return all.map(({ key, bytes, ttl, storedAt, lastAccess }) => ({ key, bytes, ttl, storedAt, lastAccess }));
  }

  async evictFor(incoming) {
    const db = await this.open();
    if (!db) return;
    const entries = await this.entries();
    const doomed = selectEvictions(entries, { budget: this.budget, incoming });
    for (const key of doomed) {
      try {
        await idbReq(db, STORE, 'readwrite', (s) => s.delete(key));
      } catch {
        /* ignore */
      }
    }
  }

  // Reports whether the store is actually empty afterwards, which the previous version did not.
  //
  // A caller that records "this has been done" has to know it was. The one-time purge that drops
  // synopsis prose written by builds before BL-134 writes a marker so it never runs again, and a
  // clear that failed while reporting nothing would advance that marker over prose still sitting in
  // the store, permanently. The button in the settings pane has the same need for a different
  // reason: it tells the reader their cached metadata is gone.
  //
  // A store that would not open counts as cleared. There is nothing in it to remove, and treating
  // it as a failure would make the purge retry on every boot in a browser that has IndexedDB turned
  // off, which is exactly where it can never succeed.
  async clear({ requireAccess = false } = {}) {
    const db = await this.open();
    if (!db) return !requireAccess;
    try {
      await idbReq(db, STORE, 'readwrite', (s) => s.clear());
      return true;
    } catch {
      return false;
    }
  }

  deleteLegacy({ onBlocked = () => {} } = {}) {
    if (!this.indexedDB) {
      return Promise.resolve({ status: 'unavailable', blocked: false, error: null });
    }
    return new Promise((resolve) => {
      let req;
      let blocked = false;
      try {
        req = this.indexedDB.deleteDatabase(LEGACY_DB_NAME);
      } catch (error) {
        resolve({ status: 'failed', blocked, error });
        return;
      }
      req.onblocked = () => {
        blocked = true;
        onBlocked();
      };
      req.onsuccess = () => resolve({ status: 'deleted', blocked });
      req.onerror = () => resolve({
        status: 'failed',
        blocked,
        error: req.error ?? new Error('The legacy cache could not be deleted.'),
      });
    });
  }

  async usage() {
    const entries = await this.entries();
    return {
      count: entries.length,
      bytes: entries.reduce((n, e) => n + (e.bytes || 0), 0),
      budget: this.budget,
    };
  }
}

// Resolves when the transaction commits, not when the request succeeds. Those are different moments
// and the gap between them is where a false success lives: a clear() whose request succeeded and
// whose transaction then aborted has removed nothing, and reporting true for it advances the
// one-time purge marker over prose still sitting in the store, permanently. IndexedDB rolls the
// whole transaction back on an abort, so the request's own success says only that it was accepted.
function idbReq(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeName, mode);
    } catch (err) {
      return reject(err);
    }
    const req = fn(tx.objectStore(storeName));
    let result;
    req.onsuccess = () => { result = req.result; };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error);
  });
}
