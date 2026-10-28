import { arrivalHeading, boot } from '../js/main.js';
import { wireMobileUi } from '../mobile/mobile-ui.js';

const report = document.createElement('p');
report.id = 'ios-report';
report.className = 'notice';
report.setAttribute('role', 'status');
report.setAttribute('aria-live', 'polite');
report.hidden = true;
document.querySelector('.wrap').prepend(report);

// iOS can end a web view's content process while the app is in the background. The shell reloads
// the page when that happens and then sends this event, so the reader learns why the page started
// over and that nothing saved was lost: saved data lives outside the process that ended.
window.addEventListener('recap:ios-restarted', () => {
  report.hidden = false;
  report.textContent = 'Recap Page reloaded because iOS stopped its page. Saved reading progress is retained.';
});

// The app bundle already holds every Reading List, and no service worker runs in it, as in the
// Android app (#928). Preview's offline controls could only say they were unavailable, so they are
// removed before Preview draws into them.
for (const id of ['preview-offline', 'preview-offline-status']) document.getElementById(id)?.remove();
boot();
wireMobileUi({ arrivalHeading });
