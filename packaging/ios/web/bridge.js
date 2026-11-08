export const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const TYPES = new Map([
  ['application/json', '.json'],
  ['text/markdown', '.md'],
  ['text/plain', '.txt'],
]);

export function validateIosExport({ filename, type, text }) {
  if (typeof filename !== 'string' || filename.length > 180
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename)
    || !TYPES.has(type) || !filename.endsWith(TYPES.get(type))) {
    throw new Error('This download is not a supported text file.');
  }
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_EXPORT_BYTES) {
    throw new Error('This download is too large for the iOS app.');
  }
}

// The edge swipe goes back through the web view's own history, which knows nothing of the page's
// dialogs, so a swipe under an open confirmation changed the screen behind it. Android's system Back
// closes the dialog first; here the shell turns the gesture off while any dialog is open instead.
// The state is posted at start, so a page that reloads with nothing open always re-enables it.
export function watchModalDialogs({ document, Observer, post, diagnose }) {
  let last = null;
  let generation = 0;
  let active = true;
  const update = () => {
    if (!active) return;
    const enabled = !document.querySelector('dialog[open]');
    if (enabled === last) return;
    last = enabled;
    const request = ++generation;
    const failed = (message) => {
      if (!active || request !== generation) return;
      last = null;
      diagnose(message);
    };
    try {
      Promise.resolve(post({ v: 1, kind: 'back-gesture', enabled })).then((reply) => {
        if (!active || request !== generation) return;
        if (reply?.v !== 1 || reply.kind !== 'back-gesture-result' || reply.enabled !== enabled) {
          failed('The iOS back gesture response was invalid.');
        }
      }, () => failed('The iOS back gesture request was rejected.'));
    } catch {
      failed('The iOS back gesture request could not be sent.');
    }
  };
  const observer = new Observer(update);
  observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });
  update();
  return {
    update,
    disconnect: () => {
      active = false;
      generation += 1;
      observer.disconnect();
    },
  };
}

export function createIosBridge({ host, native, report }) {
  let pending = null;
  let sequence = 0;

  function finish(id, saved, message) {
    if (pending?.id !== id) return;
    const request = pending;
    pending = null;
    if (message) report(message);
    request.resolve(saved);
  }

  function disconnect() {
    const request = pending;
    pending = null;
    if (!request) return;
    report('Download interrupted. Nothing was confirmed saved; please try again.');
    request.resolve(false);
  }

  host.addEventListener('pagehide', disconnect);

  async function save(file) {
    validateIosExport(file);
    if (!native || typeof native.postMessage !== 'function') {
      report('iOS file saving is not ready. Reopen the app and try again.');
      return false;
    }
    if (pending) {
      report('Finish or cancel the open Files picker before starting another download.');
      return false;
    }

    const id = `save-${++sequence}`;
    return new Promise((resolve) => {
      pending = { id, resolve };
      report('Choose a location in the Files picker. The file is not saved yet.');
      try {
        Promise.resolve(native.postMessage({ v: 1, kind: 'save', id, ...file })).then((message) => {
          if (pending?.id !== id) return;
          if (message?.v !== 1 || message.kind !== 'save-result' || message.id !== id) {
            finish(id, false, 'iOS sent an unsupported response. Reopen the app and try again.');
          } else if (message.status === 'saved') {
            finish(id, true, 'File saved to the location you chose.');
          } else if (message.status === 'cancelled') {
            finish(id, false, 'Download cancelled. Your saved reading data is unchanged.');
          } else {
            finish(id, false, `File was not confirmed saved. ${message.message || 'Please try again.'}`);
          }
        }).catch((error) => {
          finish(id, false, `The iOS download failed: ${error.message || 'Please try again.'}`);
        });
      } catch (error) {
        finish(id, false, `Could not send the download to iOS: ${error.message || 'Please try again.'}`);
      }
    });
  }

  return { save, disconnect };
}
