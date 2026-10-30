// The page's half of the Android app's cloud backup route (#810, P03-T03). The shared transport speaks
// to the Windows host with fetch; here the same calls travel as messages on the app's port, so the
// transport's reading of every answer, a dormant build's 404 included, is the one the Windows host gets.
// Tokens never come here: MainActivity answers with items, bytes and states only.
//
// The app answers only on the port it gave the page last, so a request sent on a port that has gone
// can never be answered, and fails at once rather than waiting out its deadline. A request made before
// any port arrives waits for one, within the deadline the transport sets on it.

function aborted(signal) {
  return signal.reason ?? new DOMException('The cloud request was given up.', 'AbortError');
}

export function createCloudPort() {
  let port = null;
  let sequence = 0;
  const pending = new Map();

  function settle(id) {
    const entry = pending.get(id);
    pending.delete(id);
    entry?.release();
    return entry;
  }

  function send(id, entry) {
    entry.sent = true;
    try {
      port.postMessage(entry.raw);
    } catch {
      settle(id)?.reject(new Error('The Android app connection failed.'));
    }
  }

  // Fails every request already sent on the port that is going; the rest wait for the next.
  function lose() {
    for (const [id, entry] of [...pending]) {
      if (entry.sent) settle(id).reject(new Error('The Android app connection closed before it answered.'));
    }
  }

  function attach(next) {
    lose();
    port = next;
    for (const [id, entry] of [...pending]) {
      if (!entry.sent) send(id, entry);
    }
  }

  function detach() {
    lose();
    port = null;
  }

  function receive(message) {
    if (message?.kind !== 'cloud-result' || !pending.get(message.id)?.sent) return;
    const status = Number.isSafeInteger(message.status) ? message.status : 0;
    const body = message.body ?? null;
    settle(message.id).resolve({ status, json: async () => body });
  }

  function fetch(operation, { body = null, signal = null } = {}) {
    if (signal?.aborted) return Promise.reject(aborted(signal));
    const id = `cloud-${++sequence}`;
    const raw = JSON.stringify({ v: 1, kind: 'cloud', id, op: operation, body: typeof body === 'string' ? body : null });
    return new Promise((resolve, reject) => {
      const onAbort = () => { if (settle(id)) reject(aborted(signal)); };
      signal?.addEventListener('abort', onAbort, { once: true });
      const entry = { raw, sent: false, resolve, reject, release: () => signal?.removeEventListener('abort', onAbort) };
      pending.set(id, entry);
      if (port) send(id, entry);
    });
  }

  return { fetch, attach, detach, receive };
}

// The shared transport over this port, with the operation as its whole path. The Android app holds one
// sign-in for itself alone, which the card and the erase say as "this device".
export function createAndroidCloudTransport(cloud, createTransport) {
  return { ...createTransport({ fetchImpl: cloud.fetch, prefix: '' }), scope: 'device' };
}
