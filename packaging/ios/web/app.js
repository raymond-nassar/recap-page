import { arrivalHeading, boot } from '../js/main.js';
import { wireMobileUi } from '../mobile/mobile-ui.js';
import { setDownloadHandler } from '../js/lib/download.js';
import { createIosBridge } from './bridge.js';

const report = document.createElement('p');
report.id = 'ios-report';
report.className = 'notice';
report.setAttribute('role', 'status');
report.setAttribute('aria-live', 'polite');
report.hidden = true;
document.querySelector('.wrap').prepend(report);

window.addEventListener('recapios:external-open', (event) => {
  report.hidden = false;
  report.textContent = event.detail?.status === 'opened'
    ? 'Opening the link in your browser.'
    : 'The link could not be opened. Check your browser and try again.';
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
