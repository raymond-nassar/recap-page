import { setDownloadHandler } from '../js/lib/download.js';
import { createAndroidBackHandler, createAndroidBridge } from './bridge.js';
import { wireMobileUi } from './mobile-ui.js';

let closeHomeUpdatesPanel = () => false;

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
  handleBack: createAndroidBackHandler({
    document,
    isNarrow: () => window.matchMedia('(max-width: 880px)').matches,
    closeHomeUpdates: (options) => closeHomeUpdatesPanel(options),
  }),
});

setDownloadHandler(bridge.save);
// The APK already contains the offline shell. A service worker could retain files from an older APK.
const main = await import('../js/main.js');
closeHomeUpdatesPanel = main.closeHomeUpdatesPanel;
main.boot();
wireMobileUi();
let cloudConfigured = false;
bridge.cloud.subscribeAvailability((supported) => {
  if (!supported || cloudConfigured) return;
  cloudConfigured = true;
  void main.configureCloudProviders({ client: bridge.cloud, qualification: true, label: 'Android device' }).catch(() => {
    report.hidden = false;
    report.textContent = 'Native cloud setup was not confirmed. Local reading and backups remain available.';
  });
});
