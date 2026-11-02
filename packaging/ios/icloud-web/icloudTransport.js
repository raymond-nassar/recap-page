// iCloud backup in the iOS app (#949, P04). The shared transport speaks to the Windows host with fetch;
// here the same calls travel to the app as messages on its one script handler and come back as its reply,
// so the transport reads every answer, a build without iCloud's 404 included, as it reads the host's.
// Nothing here imports the page's modules, whose paths hold only in the built app, or installs anything,
// so tests can import it; cloud.js beside it does both.

function aborted(signal) {
  return signal.reason ?? new DOMException('The cloud request was given up.', 'AbortError');
}

// The app's reply is { v: 1, kind: 'cloud-result', status, body }, with the body the JSON text the
// transport parses. Anything else is a fault in the app rather than an answer.
export function createICloudFetch(native) {
  return function fetchImpl(operation, { body = null, signal = null } = {}) {
    if (signal?.aborted) return Promise.reject(aborted(signal));
    if (!native || typeof native.postMessage !== 'function') {
      return Promise.reject(new Error('The Recap Page app could not be reached.'));
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(aborted(signal));
      signal?.addEventListener('abort', onAbort, { once: true });
      let sent;
      try {
        sent = Promise.resolve(native.postMessage({ v: 1, kind: 'cloud', op: operation, body: typeof body === 'string' ? body : '' }));
      } catch (error) {
        sent = Promise.reject(error);
      }
      sent.then((reply) => {
        if (reply?.v !== 1 || reply.kind !== 'cloud-result' || !Number.isSafeInteger(reply.status) || typeof reply.body !== 'string') {
          throw new Error('The Recap Page app answered in a way this page does not expect.');
        }
        const text = reply.body;
        return { status: reply.status, json: async () => JSON.parse(text) };
      }).then(resolve, reject).finally(() => signal?.removeEventListener('abort', onAbort));
    });
  };
}

// iPadOS asks for desktop pages, so its web view can say Macintosh; a touch screen tells them apart.
export function iosDeviceLabel(nav = globalThis.navigator) {
  const agent = String(nav?.userAgent ?? '');
  const iPad = /\biPad\b/.test(agent) || (/\bMacintosh\b/.test(agent) && Number(nav?.maxTouchPoints) > 1);
  return iPad ? 'Recap Page on iPad' : 'Recap Page on iPhone';
}

// The account is the one this device is signed in to, so a connection reaches this device alone, which
// the card and the erase say as "this device".
export function createICloudTransport({ native, nav = globalThis.navigator, createTransport }) {
  return {
    ...createTransport({ fetchImpl: createICloudFetch(native), prefix: '' }),
    scope: 'device',
    device: iosDeviceLabel(nav),
  };
}
