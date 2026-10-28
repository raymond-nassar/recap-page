export function wireInstallation({ scope = globalThis, notify }) {
  const card = scope.document.getElementById('pwa-install');
  const button = scope.document.getElementById('btn-install');
  const nextControl = scope.document.getElementById('btn-check-local-connection');
  const standalone = scope.matchMedia('(display-mode: standalone)');
  let installed = scope.navigator.standalone === true || standalone.matches;
  let offer = null;
  let pending = false;

  function render() {
    card.hidden = installed || (!offer && !pending);
    button.disabled = pending;
    button.textContent = pending ? 'Waiting for browser…' : 'Install Recap Page';
    if (card.hidden && scope.document.activeElement === button) nextControl.focus();
  }

  scope.addEventListener('beforeinstallprompt', (event) => {
    if (installed || typeof event.prompt !== 'function') return;
    event.preventDefault();
    offer = event;
    render();
  });
  scope.addEventListener('appinstalled', () => {
    installed = true;
    offer = null;
    render();
  });
  standalone.addEventListener('change', () => {
    installed = scope.navigator.standalone === true || standalone.matches;
    offer = null;
    render();
  });

  button.addEventListener('click', async () => {
    if (!offer || pending || installed) return;
    const event = offer;
    // A deferred event is single-use, even when the reader cancels or the browser refuses it.
    offer = null;
    pending = true;
    render();
    try {
      // Keep prompt() on the click's user-activation stack.
      await event.prompt();
      const choice = await event.userChoice;
      if (!installed && choice.outcome === 'dismissed') {
        notify('#app-report', 'Installation canceled. You can still use Recap Page in this browser.');
      }
    } catch (error) {
      scope.console.error('Recap Page installation failed:', error);
      if (!installed) {
        notify('#app-report', 'Recap Page could not open or complete installation. Try the install option in your browser menu.', 'error');
      }
    } finally {
      pending = false;
      render();
    }
  });
  render();
}
