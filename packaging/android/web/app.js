import { boot } from '../js/main.js';
import { setDownloadHandler } from '../js/lib/download.js';
import { createAndroidBridge } from './bridge.js';
import { wireMobileUi } from './mobile-ui.js';

const report = document.createElement('p');
report.id = 'android-report';
report.className = 'notice';
report.setAttribute('role', 'status');
report.setAttribute('aria-live', 'polite');
report.hidden = true;
document.querySelector('.wrap').prepend(report);

const bridge = createAndroidBridge({
  host: window,
  report(message) {
    report.hidden = false;
    report.textContent = message;
    report.scrollIntoView({ block: 'nearest' });
  },
  handleBack() {
    const dialog = document.querySelector('dialog[open]');
    if (dialog) {
      if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close('');
      return true;
    }
    const toggle = document.querySelector('#btn-rail-toggle');
    if (window.matchMedia('(max-width: 880px)').matches && toggle?.getAttribute('aria-expanded') === 'true') {
      toggle.click();
      return true;
    }
    return false;
  },
});

setDownloadHandler(bridge.save);
// The APK already contains the offline shell. A service worker could retain files from an older APK.
boot();
wireMobileUi();
