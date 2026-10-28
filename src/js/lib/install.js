// Constraint 5: saved progress belongs to this exact origin, so an app installed from any other
// origin, localhost or a temporary port included, would open on an empty storage bucket.
export const APP_ORIGIN = 'http://127.0.0.1:8787';

export function wireInstallation({ scope = globalThis, notify, appOrigin = APP_ORIGIN }) {
  const card = scope.document.getElementById('pwa-install');
  const button = scope.document.getElementById('btn-install');
  const nextControl = scope.document.getElementById('btn-check-local-connection');
  const report = scope.document.getElementById('pwa-install-report');
  const standalone = scope.matchMedia('(display-mode: standalone)');
  const fixedOrigin = scope.location.origin === appOrigin;
  let installed = scope.navigator.standalone === true || standalone.matches;
  let offer = null;
  let pending = false;

  function render() {
    card.hidden = installed || (!offer && !pending);
    // Not button.disabled: measured in Edge 155 (see src/js/views/completion.js), a focused button
    // disabled across a rendered frame sends focus to the page, and Edge's own install dialog stays
    // open across many frames. The click handler ignores presses while pending.
    if (pending) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
    button.textContent = pending ? 'Waiting for browser…' : 'Install Recap Page';
    if (card.hidden && scope.document.activeElement === button) nextControl.focus();
  }

  scope.addEventListener('beforeinstallprompt', (event) => {
    if (!fixedOrigin || installed || typeof event.prompt !== 'function') return;
    event.preventDefault();
    report.replaceChildren();
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

  button.addEventListener('click', async () => {
    if (!offer || pending || installed) return;
    const event = offer;
    const hadFocus = scope.document.activeElement === button;
    // A deferred event is single-use, even when the reader cancels or the browser refuses it.
    offer = null;
    pending = true;
    render();
    try {
      // Keep prompt() on the click's user-activation stack.
      await event.prompt();
      const choice = await event.userChoice;
      if (!installed && choice.outcome === 'dismissed') {
        notify('#pwa-install-report', 'Installation canceled. You can still use Recap Page in this browser.');
      }
    } catch (error) {
      scope.console.error('Recap Page installation failed:', error);
      if (!installed) {
        notify('#pwa-install-report', 'Recap Page could not open or complete installation. Try the install option in your browser menu.', 'error');
      }
    } finally {
      pending = false;
      render();
      // The browser may have moved focus to the page while its dialog was open. Return it only from
      // there, never from a control the reader chose meanwhile.
      const active = scope.document.activeElement;
      if (hadFocus && (!active || active === scope.document.body)) nextControl.focus();
    }
  });
  render();
}
