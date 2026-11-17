// This adapter exists only in the public-site sandbox. The installed app never imports it.
function memoryStorage(onChange = () => {}) {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(String(key)) ?? null,
    setItem(key, value) {
      values.set(String(key), String(value));
      onChange();
    },
    removeItem: (key) => values.delete(String(key)),
    clear: () => values.clear(),
  };
}

const $ = (selector) => document.querySelector(selector);
const report = (message) => { $('#demo-step').textContent = message; };

async function startDemo() {
  // Fail closed on direct navigation: the sandbox, not these adapters, is the data boundary.
  if (window.parent === window || window.origin !== 'null') throw new Error('Open the guided demo from the project homepage.');
  let onStateChange = () => {};
  const storage = memoryStorage(() => queueMicrotask(() => onStateChange()));
  Object.defineProperties(window, {
    localStorage: { value: storage },
    sessionStorage: { value: memoryStorage() },
    indexedDB: { value: undefined },
    caches: { value: undefined },
    BroadcastChannel: { value: undefined },
  });
  Object.defineProperties(navigator, {
    locks: { value: undefined },
    serviceWorker: { value: undefined },
  });
  const samples = JSON.parse($('#demo-samples').textContent);
  window.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input, location.href);
    if (url.pathname.endsWith('/data/catalog.json')) {
      return new Response(JSON.stringify({ lists: samples.map(({ entry }) => entry), paths: [] }));
    }
    throw new Error('Live requests are unavailable in this sample. Install Recap Page to use the full app.');
  };
  window.open = () => {
    report('In the app, Read opens a separate comic service. Here, try Done to mark the sample comic read.');
    return null;
  };
  const model = await import('https://recap.invalid/js/lib/model.js');
  const { KEY } = await import('https://recap.invalid/js/storage.js');
  let state = model.createEmptyState();
  for (const { entry, order } of samples) {
    state = model.createList(state, { name: order.name, description: order.description, catalogId: entry.id });
    state = model.addIssuesToList(state, state.listOrder.at(-1), order.items.map((item) => ({
      ...item, source: 'curated',
    }))).state;
  }
  storage.setItem(KEY, JSON.stringify(state));
  history.replaceState(null, '', '#/library');
  const { boot } = await import('https://recap.invalid/js/main.js');
  boot();

  let lastStep = '';
  function guide() {
    const current = JSON.parse(storage.getItem(KEY));
    const reading = !$('#view-read').hidden;
    const progress = reading ? model.listProgress(current, current.active) : { read: 0 };
    const finished = reading && progress.total > 0 && progress.read === progress.total;
    const step = !reading ? 'choose' : finished ? 'finished' : progress.read ? 'complete' : 'read';
    const target = !reading ? $('#library-yours') : finished ? $('#all-read') : $('#hero');
    for (const marked of document.querySelectorAll('.demo-highlight')) marked.classList.remove('demo-highlight');
    target.classList.add('demo-highlight');
    $('#demo-install').hidden = !['complete', 'finished'].includes(step);
    if (step === lastStep) return;
    lastStep = step;
    report(step === 'choose'
      ? '1 of 3: Choose a reading list from this sample library.'
      : step === 'read'
        ? '2 of 3: This is your next comic. Read opens a comic service in the full app; try it here for an explanation, then press Done.'
        : finished
          ? 'Sample complete: all three comics are marked read. Choose another list or get the app to keep your real progress.'
          : '3 of 3: Your progress updated and the next comic is ready. Keep trying, choose another list, or get the app.');
    if (reading) target.scrollIntoView({ block: 'start' });
    if (finished) $('#demo-install').focus({ preventScroll: true });
  }

  // Keep the guided surface bounded; Read is explained rather than opening a reader. The frame
  // also denies popups, downloads, forms and parent navigation even if a future app control changes.
  document.addEventListener('click', (event) => {
    const control = event.target.closest('a, button, summary, input, select');
    if (!control || control.closest('#demo-guide')) return;
    if (control.id === 'btn-hero-read') {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.open();
      return;
    }
    const allowed = control.matches('#btn-hero-done, #order-desc > summary')
      || (control.matches('a') && control.getAttribute('href')?.startsWith('#/read'));
    if (!allowed) {
      event.preventDefault();
      event.stopImmediatePropagation();
      report('This guided sample focuses on choosing a list and marking comics read. Use Choose another list to restart, or get the app for all features.');
    } else {
      setTimeout(guide, 0);
    }
  }, true);
  $('#demo-restart').addEventListener('click', () => location.reload());
  $('#demo-install').addEventListener('click', () => parent.postMessage({ type: 'recap-demo-install' }, '*'));
  window.addEventListener('hashchange', guide);
  onStateChange = guide;
  guide();
  document.body.dataset.demoReady = 'true';
  parent.postMessage({ type: 'recap-demo-ready' }, '*');
}

startDemo().catch((error) => {
  report(`The demo could not start: ${error.message} Use Reset demo on the homepage to try again.`);
  $('#shell').hidden = true;
  console.error('Guided demo failed:', error);
  parent.postMessage({ type: 'recap-demo-error' }, '*');
});
