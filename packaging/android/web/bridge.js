export const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const TYPES = new Map([
  ['application/json', '.json'],
  ['text/markdown', '.md'],
  ['text/plain', '.txt'],
]);

export function createAndroidBackHandler({ document, isNarrow, closeHomeUpdates }) {
  return () => {
    const dialog = document.querySelector('dialog[open]');
    if (dialog) {
      if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close('');
      return true;
    }
    const toggle = document.querySelector('#btn-rail-toggle');
    if (isNarrow() && toggle && !toggle.hidden && toggle.getAttribute('aria-expanded') === 'true') {
      toggle.click();
      return true;
    }
    return closeHomeUpdates({ restoreFocus: true }) === true;
  };
}

export function validateExport({ filename, type, text }) {
  if (typeof filename !== 'string' || filename.length > 180
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename)
    || !TYPES.has(type) || !filename.endsWith(TYPES.get(type))) {
    throw new Error('This download is not a supported text file.');
  }
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_EXPORT_BYTES) {
    throw new Error('This download is too large for the Android prototype.');
  }
}

export function createAndroidBridge({ host, report, handleBack }) {
  let port = null;
  let pending = null;
  let sequence = 0;

  function finish(saved, message) {
    const request = pending;
    pending = null;
    if (message) report(message);
    request?.resolve(saved);
  }

  function closePort(message) {
    finish(false, message);
    port?.close();
    port = null;
  }

  function disconnect() {
    closePort(pending ? 'Download interrupted. Nothing was confirmed saved; please try again.' : null);
  }

  function receive(event, activePort) {
    if (port !== activePort) return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      finish(false, 'Android sent an unreadable response. Please try the download again.');
      return;
    }
    if (message?.v !== 1 || typeof message.id !== 'string') {
      finish(false, 'Android sent an unsupported response. Reopen the app and try again.');
      return;
    }
    if (message.kind === 'back') {
      activePort.postMessage(JSON.stringify({
        v: 1, kind: 'back-result', id: message.id, handled: handleBack(),
      }));
      return;
    }
    if (message.kind !== 'save-result' || message.id !== pending?.id) return;
    if (message.status === 'saved') {
      finish(true, 'File saved to the location you chose.');
    } else if (message.status === 'cancelled') {
      finish(false, 'Download cancelled. Your saved reading data is unchanged.');
    } else {
      finish(false, `File was not confirmed saved. ${message.message || 'Please try again.'}`);
    }
  }

  function connect(event) {
    // Native postWebMessage has no source Window. Ordinary page messages cannot install a port.
    if (event.source !== null || !['', 'null'].includes(event.origin)
      || event.data !== 'recap:connect:v1' || event.ports?.length !== 1) return;
    disconnect();
    port = event.ports[0];
    const activePort = port;
    port.onmessage = (message) => receive(message, activePort);
    port.onmessageerror = () => {
      if (port !== activePort) return;
      closePort('The Android download connection failed. Reopen the app and try again.');
    };
    port.start();
  }

  host.addEventListener('message', connect);
  host.addEventListener('pagehide', disconnect);

  async function save(file) {
    validateExport(file);
    if (!port) {
      report('Android file saving is not ready. Reopen the app and try again.');
      return false;
    }
    if (pending) {
      report('Finish or cancel the open file picker before starting another download.');
      return false;
    }
    const id = `save-${++sequence}`;
    return new Promise((resolve) => {
      pending = { id, resolve };
      report('Choose an on-device location in the Android file picker. The file is not saved yet.');
      try {
        port.postMessage(JSON.stringify({ v: 1, kind: 'save', id, ...file }));
      } catch (error) {
        finish(false, `Could not send the download to Android: ${error.message}`);
      }
    });
  }

  return { save, disconnect };
}
