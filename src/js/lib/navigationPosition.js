// Positions belong to history entries, not routes: visiting the same list twice can start in
// different places. Keep them in browser history only, alongside the existing opener identities.
export function createNavigationPosition({ window, document, history }) {
  let restoring = false;
  let stopRestore = () => {};
  const entry = () => history.state?.readingPosition;
  const position = () => ({
    depth: Number.isSafeInteger(entry()?.depth) && entry().depth >= 0 ? entry().depth : 0,
    x: Number.isFinite(entry()?.x) && entry().x >= 0 ? entry().x : 0,
    y: Number.isFinite(entry()?.y) && entry().y >= 0 ? entry().y : 0,
  });
  const state = () => history.state && typeof history.state === 'object' ? history.state : {};
  function capture() {
    if (restoring) return;
    if (entry()?.x === window.scrollX && entry()?.y === window.scrollY) return;
    history.replaceState({
      ...state(), readingPosition: { ...position(), x: window.scrollX, y: window.scrollY },
    }, '', window.location.href);
  }
  function push(url) {
    stopRestore();
    restoring = false;
    const depth = position().depth + 1;
    history.pushState({ readingPosition: { depth, x: 0, y: 0 } }, '', url);
  }
  function replace(url) {
    history.replaceState(state(), '', url);
  }
  function beginRestore() {
    stopRestore();
    restoring = true;
  }
  function restore() {
    beginRestore();
    const target = position();
    const stop = () => {
      restoring = false;
      observer?.disconnect();
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      for (const name of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
        window.removeEventListener(name, stop, true);
      }
    };
    stopRestore = stop;
    const place = () => {
      if (!restoring) return;
      window.scrollTo({ left: target.x, top: target.y, behavior: 'instant' });
    };
    // Catalogs render after the route is shown. Keep the requested position while they grow,
    // but give control back immediately if the reader acts instead of waiting for that layout.
    const observer = new window.ResizeObserver(place);
    observer.observe(document.body);
    for (const name of ['pointerdown', 'touchstart', 'wheel', 'keydown']) {
      window.addEventListener(name, stop, { capture: true, passive: true });
    }
    place();
    const frame = window.requestAnimationFrame(place);
    const timer = window.setTimeout(stop, 2000);
  }
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  return {
    capture, push, replace, beginRestore, restore,
    cancel() { stopRestore(); restoring = false; },
    get restoring() { return restoring; },
    get canGoBack() { return position().depth > 0; },
  };
}
