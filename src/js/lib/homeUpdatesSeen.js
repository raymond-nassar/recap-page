export const HOME_UPDATES_SEEN_KEY = 'mrt.homeUpdates.seen.v1';
const MAX_BATCH = 1000000000000000;

function parse(raw) {
  if (raw === null) return { reason: 'missing', value: 0 };
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return { reason: 'malformed', value: 0 };
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= MAX_BATCH
    ? { reason: 'valid', value } : { reason: 'malformed', value: 0 };
}

export function createHomeUpdatesSeen({ storage, locks } = {}) {
  let memory = 0;
  let epoch = 0;
  let absent = null;
  let status = { remembered: false, canceled: false, reason: 'missing', error: null };

  function read() {
    try {
      if (!storage) throw new Error('Browser storage is unavailable.');
      return { ...parse(storage.getItem(HOME_UPDATES_SEEN_KEY)), error: null };
    } catch (error) {
      return { reason: 'unreadable', value: 0, error };
    }
  }

  function observe(value, reset = false) {
    if (value.reason === 'missing') {
      if (reset || absent === false) {
        epoch += 1;
        memory = 0;
        status = { remembered: false, canceled: false, reason: 'reset', error: null };
      }
      absent = true;
    } else if (value.reason !== 'unreadable') {
      absent = false;
      memory = Math.max(memory, value.value);
    }
    return value;
  }

  function finish(token, reason, error = null, remembered = false) {
    if (token !== epoch) return { remembered: false, canceled: true, reason: 'canceled', error: null };
    status = { remembered, canceled: false, reason, error };
    return status;
  }

  const initial = observe(read());
  status = { ...status, reason: initial.reason, error: initial.error };

  async function acknowledge(batchId) {
    if (!Number.isSafeInteger(batchId) || batchId <= 0 || batchId > MAX_BATCH) {
      throw new TypeError('Invalid Home updates batch identity');
    }
    const current = observe(read());
    const token = epoch;
    memory = Math.max(memory, batchId);
    if (current.reason === 'unreadable') return finish(token, 'unreadable', current.error);
    if (!locks?.request) return finish(token, 'locks-unavailable');
    try {
      const result = await locks.request(HOME_UPDATES_SEEN_KEY, () => {
        if (token !== epoch) return finish(token, 'canceled');
        const durable = observe(read());
        if (token !== epoch) return finish(token, 'canceled');
        if (durable.reason === 'unreadable') return finish(token, 'unreadable', durable.error);
        const next = Math.max(memory, durable.value, batchId);
        if (token !== epoch) return finish(token, 'canceled');
        if (durable.value < next || durable.reason === 'malformed') {
          try {
            storage.setItem(HOME_UPDATES_SEEN_KEY, String(next));
          } catch (error) {
            return finish(token, 'write-failed', error);
          }
        }
        const verified = observe(read());
        if (token !== epoch) return finish(token, 'canceled');
        if (verified.reason === 'unreadable') return finish(token, 'unreadable', verified.error);
        if (verified.reason !== 'valid' || verified.value < next) return finish(token, 'write-unverified');
        memory = Math.max(memory, verified.value);
        return finish(token, 'remembered', null, true);
      });
      return token === epoch ? result : finish(token, 'canceled');
    } catch (error) {
      return finish(token, 'locks-rejected', error);
    }
  }

  function handleStorageEvent(event) {
    if (event.storageArea !== storage || (event.key !== HOME_UPDATES_SEEN_KEY && event.key !== null)) return false;
    const durable = observe(read(), true);
    if (durable.reason === 'unreadable' || durable.reason === 'malformed') {
      status = { remembered: false, canceled: false, reason: durable.reason, error: durable.error };
    }
    return true;
  }

  return { current: () => memory, status: () => status, acknowledge, handleStorageEvent };
}
