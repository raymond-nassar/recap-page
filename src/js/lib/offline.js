// Registering the offline worker, kept out of main.js so it can be tested without a browser.
//
// The worker itself is src/sw.js and the reason it exists is written there. This is only the
// wiring, and the wiring has one job beyond calling register: it must never be able to stop the
// app booting. A reader whose browser refuses service workers, or who has them switched off, or
// who is somehow on an origin that is not treated as secure, still has a working tracker. The
// offline launch is the thing that is lost, and it is the only thing that is lost.

// Resolved against the document rather than against this module. The worker's scope is the
// directory it is served from, so a worker fetched from js/lib/ would only ever see requests for
// js/lib/, and the navigation that matters is the one for the page itself. index.html sits at
// the root of what is served, so this reaches src/sw.js and takes the whole app as its scope.
export const WORKER_URL = './sw.js';

// Every reason to do nothing, as a returned string rather than a thrown error or a silent
// return. The caller logs it, and a name is what turns "offline did not work" into a question
// with an answer.
export const SKIPPED = {
  unsupported: 'this browser has no service worker support',
  insecure: 'this address is not treated as a secure origin',
  uncontrolled: 'the worker did not take control in time to warm the shell',
};

// How long to wait for the worker to take control before giving up on the warm-up. Measured in
// Edge on a first visit with a cleared profile: control arrives well inside a second. Five is
// slack for a slower machine, and giving up costs the reader nothing except a second visit
// before the icon works offline.
const CONTROL_WAIT_MS = 5000;

// What the page actually loaded, asked of the browser rather than written down. A precache list
// is a list somebody has to keep complete, and a module added later and left off it breaks the
// offline launch silently. Resource timing already knows every URL this page fetched, so the
// shell describes itself and cannot fall behind.
//
// The document's own address is added separately because a page is not a resource of itself, and
// it is the one entry that has to be there: it is what the installed icon opens.
export function shellUrls(scope = globalThis) {
  const origin = scope.location.origin;
  const urls = new Set();
  // Fragments are stripped because the Cache API matches without them anyway, so keeping /#/home
  // and / apart here would only mean fetching the same page twice.
  const bare = (href) => {
    const u = new URL(href);
    u.hash = '';
    return u.href;
  };
  try {
    urls.add(bare(scope.location.href));
  } catch {
    return [];
  }
  const perf = scope.performance;
  const entries = perf && typeof perf.getEntriesByType === 'function'
    ? perf.getEntriesByType('resource')
    : [];
  for (const entry of entries) {
    try {
      const url = new URL(entry.name);
      if (url.origin === origin) urls.add(bare(url.href));
    } catch {
      // A resource entry whose name is not a URL is nothing this can fetch.
    }
  }
  return [...urls];
}

// The first visit is the one this exists for. Nothing the page loaded before the worker took
// control passed through it, so without this the cache is empty until a second visit, and a
// reader who installs the app straight away and then stops the server gets the error page the
// worker was added to prevent. Measured before it was written: one visit, then the server
// stopped, gave 0 cached entries and "can't reach this page".
//
// Re-fetching is cheap here and paid once. The responses are still in the browser's own HTTP
// cache from moments earlier, and every one of them goes through the worker on the way back,
// which is what puts them where an offline load can find them.
export function warmShell(scope = globalThis) {
  const nav = scope.navigator;
  if (!nav || !nav.serviceWorker) return Promise.resolve({ warmed: 0, reason: SKIPPED.unsupported });
  return whenControlled(nav, scope).then((controlled) => {
    if (!controlled) return { warmed: 0, reason: SKIPPED.uncontrolled };
    const urls = shellUrls(scope);
    let warmed = 0;
    return Promise.all(urls.map((url) => Promise.resolve()
      .then(() => scope.fetch(url))
      .then(() => { warmed += 1; })
      // One unreachable file is not a reason to abandon the rest, and there is nothing the
      // reader could do about it if it were reported.
      .catch(() => {}))).then(() => ({ warmed, reason: null }));
  });
}

// Control arrives after the worker activates and claims, which is a moment later than the
// register promise resolving. Waiting on the event rather than polling means the common case
// costs nothing, and the timeout is what stops a browser that never claims from leaving this
// promise pending for the life of the page.
function whenControlled(nav, scope) {
  if (nav.serviceWorker.controller) return Promise.resolve(true);
  if (typeof nav.serviceWorker.addEventListener !== 'function') return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (typeof nav.serviceWorker.removeEventListener === 'function') {
        nav.serviceWorker.removeEventListener('controllerchange', finish);
      }
      resolve(Boolean(nav.serviceWorker.controller));
    };
    nav.serviceWorker.addEventListener('controllerchange', finish);
    if (typeof scope.setTimeout === 'function') scope.setTimeout(finish, CONTROL_WAIT_MS);
  });
}

export function registerOffline(scope = globalThis) {
  const nav = scope.navigator;
  if (!nav || !nav.serviceWorker) return Promise.resolve({ ok: false, reason: SKIPPED.unsupported, warmed: 0 });
  // Checked rather than assumed. http://127.0.0.1 is a secure origin and so is localhost, which
  // is why this app can have a worker at all without a certificate, but a reader who reached the
  // page some other way would otherwise get a rejected promise and a console error naming
  // nothing they could act on.
  if (scope.isSecureContext === false) return Promise.resolve({ ok: false, reason: SKIPPED.insecure, warmed: 0 });

  // Read before registering, because registering is what changes it. A page that is already
  // controlled fetched its whole shell through the worker on the way in, so it is already stored
  // and warming again would be a second download of every file on every visit forever.
  const controlledOnArrival = Boolean(nav.serviceWorker.controller);

  return nav.serviceWorker.register(WORKER_URL, { updateViaCache: 'none' })
    .then(() => {
      if (controlledOnArrival) return { ok: true, reason: null, warmed: 0 };
      return warmShell(scope).then((warm) => ({ ok: true, reason: null, warmed: warm.warmed }));
    })
    // The failure that matters in practice is a checkout with no src/sw.js in it, which answers
    // the register with the index page under the wrong content type. There is nothing the reader
    // can do about it and nothing on screen it should change, so it is reported to the console
    // and the app carries on exactly as it did before this file existed.
    .catch((err) => ({ ok: false, reason: String(err && err.message ? err.message : err), warmed: 0 }));
}
