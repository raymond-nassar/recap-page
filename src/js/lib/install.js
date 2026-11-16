// Constraint 5: saved progress belongs to this exact origin, so an app installed from any other
// origin, localhost or a temporary port included, would open on an empty storage bucket.
export const APP_ORIGIN = 'http://127.0.0.1:8787';

// Device-local, like the Marvel Unlimited acknowledgement: whether this browser offered to install
// is a fact about this browser, so complete and cloud backups, which list their keys explicitly,
// never carry it to another one.
export const APP_WINDOW_INVITATION_KEY = 'mrt.appWindowInvitation.dismissed.v1';

// #1412 decisions 3 and 4. Only Edge and Chrome on Windows install the app window the Windows
// launcher opens, so only they are invited. Firefox is the one browser identified as unable to,
// and is told so. Anything else, Brave and Opera included, is left exactly as before: a missing
// install offer proves nothing about a browser, so it is never read as a reason to warn.
export function appWindowBrowser(navigator) {
  const data = navigator?.userAgentData;
  if (data?.platform === 'Windows' && Array.isArray(data.brands)
    && data.brands.some(({ brand }) => brand === 'Microsoft Edge' || brand === 'Google Chrome')) {
    return 'installable';
  }
  const agent = String(navigator?.userAgent ?? '');
  if (/\bWindows NT\b/.test(agent) && /\bFirefox\/\d/.test(agent)) return 'unsupported';
  return 'other';
}

export function wireInstallation({ scope = globalThis, notify, appOrigin = APP_ORIGIN, storage }) {
  const card = scope.document.getElementById('pwa-install');
  const button = scope.document.getElementById('btn-install');
  const nextControl = scope.document.getElementById('btn-check-local-connection');
  const report = scope.document.getElementById('pwa-install-report');
  const invitation = scope.document.getElementById('app-window-invitation');
  const inviteButton = scope.document.getElementById('btn-invitation-install');
  const laterButton = scope.document.getElementById('btn-invitation-later');
  const notice = scope.document.getElementById('app-window-notice');
  const noticeDismiss = scope.document.getElementById('app-window-notice-dismiss');
  const homeHeading = scope.document.getElementById('home-h');
  const standalone = scope.matchMedia('(display-mode: standalone)');
  const fixedOrigin = scope.location.origin === appOrigin;
  const browserKind = appWindowBrowser(scope.navigator);
  let installed = scope.navigator.standalone === true || standalone.matches;
  let offer = null;
  let pending = false;
  let dismissedThisPage = false;

  function dismissed() {
    if (dismissedThisPage) return true;
    try {
      // Read lazily: with site data blocked, merely reading localStorage throws.
      return (storage ?? scope.localStorage).getItem(APP_WINDOW_INVITATION_KEY) === 'dismissed';
    } catch {
      return false;
    }
  }

  function dismiss() {
    dismissedThisPage = true;
    try {
      (storage ?? scope.localStorage).setItem(APP_WINDOW_INVITATION_KEY, 'dismissed');
    } catch (error) {
      // Hidden for this page either way; an unsaved answer is asked again next visit, not lost.
      scope.console.error('Recap Page could not remember the app window answer:', error);
    }
  }

  function toHome(control) {
    if (scope.document.activeElement !== control || !homeHeading) return;
    homeHeading.setAttribute('tabindex', '-1');
    homeHeading.focus({ preventScroll: true });
  }

  function render() {
    card.hidden = installed || (!offer && !pending);
    // Not button.disabled: measured in Edge 155 (see src/js/views/completion.js), a focused button
    // disabled across a rendered frame sends focus to the page, and Edge's own install dialog stays
    // open across many frames. The click handler ignores presses while pending.
    for (const control of [button, inviteButton]) {
      if (!control) continue;
      if (pending) control.setAttribute('aria-disabled', 'true');
      else control.removeAttribute('aria-disabled');
      control.textContent = pending ? 'Waiting for browser…' : 'Install Recap Page';
    }
    if (invitation) {
      invitation.hidden = !fixedOrigin || browserKind !== 'installable' || installed || dismissed()
        || (!offer && !pending);
      if (invitation.hidden) {
        toHome(inviteButton);
        toHome(laterButton);
      }
    }
    if (notice) {
      notice.hidden = !fixedOrigin || browserKind !== 'unsupported' || installed || dismissed();
      if (notice.hidden) toHome(noticeDismiss);
    }
    if (card.hidden && scope.document.activeElement === button) nextControl.focus();
  }

  scope.addEventListener('beforeinstallprompt', (event) => {
    if (!fixedOrigin || installed || typeof event.prompt !== 'function') return;
    event.preventDefault();
    offer = event;
    render();
  });
  scope.addEventListener('appinstalled', () => {
    report.replaceChildren();
    installed = true;
    offer = null;
    render();
  });
  standalone.addEventListener('change', () => {
    installed = scope.navigator.standalone === true || standalone.matches;
    if (installed) report.replaceChildren();
    offer = null;
    render();
  });

  function install(trigger, successor, reportTo) {
    if (!offer || pending || installed) return Promise.resolve();
    return prompt(trigger, successor, reportTo);
  }

  async function prompt(trigger, successor, reportTo) {
    const event = offer;
    const hadFocus = scope.document.activeElement === trigger;
    // A deferred event is single-use, even when the reader cancels or the browser refuses it.
    offer = null;
    pending = true;
    report.replaceChildren();
    render();
    try {
      // Keep prompt() on the click's user-activation stack.
      await event.prompt();
      const choice = await event.userChoice;
      if (!installed && choice.outcome === 'dismissed') {
        // #1412: canceling the browser's own dialog is an answer, so Home does not ask again.
        if (browserKind === 'installable') dismiss();
        notify(reportTo, 'Installation canceled. You can still use Recap Page in this browser.');
      }
    } catch (error) {
      scope.console.error('Recap Page installation failed:', error);
      if (!installed) {
        notify(reportTo, 'Recap Page could not open or complete installation. Try the install option in your browser menu.', 'error');
      }
    } finally {
      pending = false;
      render();
      // The browser may have moved focus to the page while its dialog was open. Return it only from
      // there, never from a control the reader chose meanwhile.
      const active = scope.document.activeElement;
      if (hadFocus && (!active || active === scope.document.body)) successor();
    }
  }

  button.addEventListener('click', () => install(button, () => nextControl.focus(), '#pwa-install-report'));
  // The Home invitation reports to the page-wide pane: the settings pane sits in a view the reader
  // is not looking at.
  inviteButton?.addEventListener('click', () => install(inviteButton, () => {
    homeHeading.setAttribute('tabindex', '-1');
    homeHeading.focus({ preventScroll: true });
  }, '#app-report'));
  laterButton?.addEventListener('click', () => {
    if (pending) return;
    dismiss();
    render();
  });
  noticeDismiss?.addEventListener('click', () => {
    dismiss();
    render();
  });
  render();
}
