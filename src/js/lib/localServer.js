export const LOCAL_SERVER_HEALTH_PATH = '/__recap_page_health__';
export const LOCAL_SERVER_HEADER_NAME = 'X-Recap-Page-Server';
export const LOCAL_SERVER_HEADER_VALUE = '1';
export const LOCAL_SERVER_TIMEOUT_MS = 2500;

export const LOCAL_SERVER_STATUS = Object.freeze({
  READY: 'ready',
  UNREACHABLE: 'unreachable',
  UNEXPECTED: 'unexpected',
});

export async function checkLocalServer({
  fetchImpl = globalThis.fetch,
  timeoutMs = LOCAL_SERVER_TIMEOUT_MS,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeoutImpl(() => controller.abort(), timeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl(LOCAL_SERVER_HEALTH_PATH, {
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch {
      return LOCAL_SERVER_STATUS.UNREACHABLE;
    }

    const identity = response?.headers?.get?.(LOCAL_SERVER_HEADER_NAME);
    return response?.status === 204 && identity === LOCAL_SERVER_HEADER_VALUE
      ? LOCAL_SERVER_STATUS.READY
      : LOCAL_SERVER_STATUS.UNEXPECTED;
  } finally {
    clearTimeoutImpl(timer);
  }
}
