// #1412 decision 10: when the Microsoft Store app's window opens from its offline copy and the local
// engine is not running, the notice offers Reconnect. Reconnect asks Windows to start the engine once
// through the package's recap-page: protocol, without turning on automatic startup. The manifest gives
// that protocol one fixed token and no %1, so nothing this page writes reaches the launcher, and the
// browser asks the reader before it hands the address to Windows. Nothing here reports a connection:
// only the engine's own ready answer does.

import { APP_ORIGIN } from './install.js';
import {
  LOCAL_SERVER_GENERATION_HEADER_NAME, LOCAL_SERVER_HEADER_NAME, LOCAL_SERVER_HEADER_VALUE, LOCAL_SERVER_STATUS,
} from './localServer.js';

export const RECONNECT_ADDRESS = 'recap-page:';
// Device-local: whether the engine that last answered here came from the Store package, which alone
// registers recap-page:. Only the MSIX packager writes a generation, so the portable download and a
// checkout answer "development" and clear it, and they keep today's notice. Complete and cloud backups
// list their keys explicitly, so it never travels to another device.
export const STORE_ENGINE_KEY = 'mrt.reconnect.storeEngine.v1';
// The engine is ready within the launcher's own 10 second wait once Windows starts it, but the browser
// first asks the reader whether to open the app, and that answer takes as long as the reader takes.
export const RECONNECT_WAIT_MS = 60_000;
export const RECONNECT_POLL_MS = 1_000;
const DEVELOPMENT = 'development';

// Wraps the health request's fetch so a ready answer also records which engine gave it. An answer that
// is not the engine's own ready answer, or a failed request, changes nothing.
export function observeEngine(fetchImpl, storage) {
  return async (...args) => {
    const response = await fetchImpl(...args);
    try {
      if (response?.status === 204
        && response.headers?.get?.(LOCAL_SERVER_HEADER_NAME) === LOCAL_SERVER_HEADER_VALUE) {
        const generation = response.headers.get(LOCAL_SERVER_GENERATION_HEADER_NAME);
        if (generation && generation !== DEVELOPMENT) storage.setItem(STORE_ENGINE_KEY, 'store');
        else storage.removeItem(STORE_ENGINE_KEY);
      }
    } catch {
      // Unreadable storage leaves the last answer in place, so the notice is today's at worst.
    }
    return response;
  };
}

// Reconnect is offered only in an app window at the fixed origin whose last engine was the Store
// package's, and only when nothing answers there: something else answering is not fixed by starting
// the engine, so that keeps today's notice.
export function reconnectAvailable(status, { scope = globalThis, storage, appOrigin = APP_ORIGIN } = {}) {
  if (status !== LOCAL_SERVER_STATUS.UNREACHABLE) return false;
  try {
    return scope.location.origin === appOrigin
      && scope.matchMedia('(display-mode: standalone)').matches
      && (storage ?? scope.localStorage).getItem(STORE_ENGINE_KEY) === 'store';
  } catch {
    return false;
  }
}

// Called inside the reader's click, before anything is awaited, because the browser opens an app for
// an address only while the click's activation lasts.
export function launchReconnect(scope = globalThis) {
  scope.location.assign(RECONNECT_ADDRESS);
}

// Checks until the engine answers ready or the wait ends. Returns true only for a ready answer, and
// false as soon as isCurrent says a newer attempt or check has taken over.
export async function waitForEngine(probe, {
  waitMs = RECONNECT_WAIT_MS, pollMs = RECONNECT_POLL_MS, now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)), isCurrent = () => true,
} = {}) {
  const deadline = now() + waitMs;
  for (;;) {
    const status = await probe();
    if (!isCurrent()) return false;
    if (status === LOCAL_SERVER_STATUS.READY) return true;
    if (now() + pollMs > deadline) return false;
    await sleep(pollMs);
    if (!isCurrent()) return false;
  }
}
