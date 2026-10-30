import { arrivalHeading, boot } from '../js/main.js';
import { wireMobileUi } from '../mobile/mobile-ui.js';
import { setDownloadHandler } from '../js/lib/download.js';
import { createIosBridge } from './bridge.js';

const DATA_LOSS_COPY = Object.freeze({
  messageBeforeLink: 'Your saved reading data is missing from this device. Restore from a backup file in ',
  settingsLink: 'Backup & settings',
  messageAfterLink: '.',
  dismiss: 'Dismiss',
  dismissalFailure: 'The missing-data notice could not be dismissed. Try again.',
});

const report = document.createElement('p');
report.id = 'ios-report';
report.className = 'notice';
report.setAttribute('role', 'status');
report.setAttribute('aria-live', 'polite');
report.hidden = true;
document.querySelector('.wrap').prepend(report);

const dataLossNotice = document.createElement('section');
dataLossNotice.id = 'ios-data-loss-notice';
dataLossNotice.className = 'notice';
dataLossNotice.setAttribute('role', 'status');
dataLossNotice.setAttribute('aria-live', 'polite');
dataLossNotice.hidden = true;
const dataLossMessage = document.createElement('p');
dataLossMessage.id = 'ios-data-loss-message';
dataLossMessage.append(document.createTextNode(DATA_LOSS_COPY.messageBeforeLink));
const dataLossSettingsLink = document.createElement('a');
dataLossSettingsLink.href = '#/data';
dataLossSettingsLink.className = 'quiet';
dataLossSettingsLink.id = 'ios-data-loss-settings';
dataLossSettingsLink.textContent = DATA_LOSS_COPY.settingsLink;
dataLossMessage.append(dataLossSettingsLink, document.createTextNode(DATA_LOSS_COPY.messageAfterLink));
const dismissDataLossNotice = document.createElement('button');
dismissDataLossNotice.type = 'button';
dismissDataLossNotice.id = 'ios-data-loss-dismiss';
dismissDataLossNotice.textContent = DATA_LOSS_COPY.dismiss;
dataLossNotice.append(dataLossMessage, dismissDataLossNotice);
document.querySelector('.wrap').prepend(dataLossNotice);

const native = window.webkit?.messageHandlers?.recap;

function showBridgeError(message) {
  report.hidden = false;
  report.textContent = message;
}

function postDataLossMessage(kind) {
  if (!native || typeof native.postMessage !== 'function') return Promise.resolve(null);
  try {
    return Promise.resolve(native.postMessage({ v: 1, kind, present: kind === 'saved-data-present' }));
  } catch (error) {
    return Promise.reject(error);
  }
}

function noteSavedDataPresent() {
  dataLossNotice.hidden = true;
  window.recapIosDataLossNoticeDismissed = false;
  postDataLossMessage('saved-data-present').then((reply) => {
    if (reply && (reply.v !== 1 || reply.kind !== 'data-loss-result' || reply.status !== 'recorded')) {
      showBridgeError('iOS could not record that saved reading data exists.');
    }
  }).catch(() => showBridgeError('iOS could not record that saved reading data exists.'));
}

let readingDataPresent = null;
try {
  readingDataPresent = localStorage.getItem('mrt.state.v2') !== null;
} catch {
  showBridgeError('iOS could not check whether saved reading data exists.');
}

if (readingDataPresent === true) {
  noteSavedDataPresent();
} else if (readingDataPresent === false
  && window.recapIosHadSavedData === true
  && window.recapIosDataLossNoticeDismissed !== true) {
  dataLossNotice.hidden = false;
}

dismissDataLossNotice.addEventListener('click', async () => {
  dismissDataLossNotice.disabled = true;
  try {
    const reply = await postDataLossMessage('dismiss-data-loss');
    if (reply?.v !== 1 || reply.kind !== 'data-loss-result' || reply.status !== 'dismissed') {
      throw new Error('The iOS app did not confirm the dismissal.');
    }
    window.recapIosDataLossNoticeDismissed = true;
    dataLossNotice.hidden = true;
  } catch {
    showBridgeError(DATA_LOSS_COPY.dismissalFailure);
  } finally {
    dismissDataLossNotice.disabled = false;
  }
});

const originalSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (key, value) {
  const result = Reflect.apply(originalSetItem, this, [key, value]);
  if (this === localStorage && key === 'mrt.state.v2') noteSavedDataPresent();
  return result;
};

window.addEventListener('recapios:external-open', (event) => {
  report.hidden = false;
  report.textContent = event.detail?.status === 'opened'
    ? 'Opening the link outside Recap Page.'
    : 'The link could not be opened. Try again.';
});

const downloadBridge = createIosBridge({
  host: window,
  native: window.webkit?.messageHandlers?.recap,
  report: (message) => {
    report.hidden = false;
    report.textContent = message;
  },
});
setDownloadHandler(downloadBridge.save);

// iOS can end a web view's content process while the app is in the background. The shell then
// reloads the page with this flag set before any page script runs, so the reader learns why the page
// started over and that nothing saved was lost: saved data lives outside the process that ended. An
// event sent once the reload finished did reach the page on both Simulator runtimes, yet the notice
// stayed hidden, so the page reads the flag when it starts instead of waiting to be told.
if (window.recapIosRestarted === true) {
  report.hidden = false;
  report.textContent = 'Recap Page reloaded because iOS stopped its page. Saved reading progress is retained.';
}

// The app bundle already holds every Reading List, and no service worker runs in it, as in the
// Android app (#928). Preview's offline controls could only say they were unavailable, so they are
// removed before Preview draws into them.
for (const id of ['preview-offline', 'preview-offline-status']) document.getElementById(id)?.remove();
boot();
wireMobileUi({ arrivalHeading });
