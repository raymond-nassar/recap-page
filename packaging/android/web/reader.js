export function digitalReference(value) {
  const text = String(value ?? '');
  return /^[1-9]\d{0,11}$/.test(text) ? text : null;
}

// #1601: the Android launcher opens a verified Marvel Comics app link, and the Marvel Comics website
// for anything else. Marvel Unlimited, its book links, the comic detail pages and the online lookup
// are no longer opened, so an old link that still carries those numbers opens the website too.
export function createAndroidReader({ host, location, elements, destination, comicsUrl, appUrlFor = () => null }) {
  if (destination !== 'comics' || comicsUrl !== 'https://marvel.webtoon.com/') {
    throw new TypeError('An approved reader destination is required');
  }
  const { heading, status, fallback } = elements;
  const query = new URLSearchParams(location.search);
  const reference = query.getAll('r').length === 1 || digitalReference(query.get('i')) || digitalReference(query.get('d'));
  let cancelled = false;
  const title = (query.get('t') || '').slice(0, 120);
  // #950: the viewer address alone is enough (#1601), since a viewer-only comic has no other reference.
  const appUrl = appUrlFor(query);
  fallback.textContent = 'Open in browser';
  fallback.href = appUrl || comicsUrl;
  if (title) heading.textContent = `Opening ${title}`;

  function cancel() {
    cancelled = true;
  }

  function open(url, message) {
    if (cancelled) return;
    fallback.href = url;
    status.textContent = message;
    location.assign(url);
  }

  fallback.addEventListener('click', () => {
    cancel();
    status.textContent = 'Choose a browser if asked. If nothing opens, this link is still available. Reading progress has not changed.';
  });
  host.addEventListener('pagehide', cancel, { once: true });
  host.addEventListener('recap:reader-result', (event) => {
    if (typeof event.detail !== 'boolean') return;
    status.textContent = event.detail
      ? 'The browser was opened. Reading progress has not changed.'
      : 'The browser was not opened. Use Open in browser to try again, or go back to Recap Page.';
  });

  async function start() {
    if (appUrl) {
      open(appUrl, 'Taking you to this comic in the Marvel Comics app.');
      return;
    }
    if (!reference) {
      heading.textContent = 'Nothing to open';
      status.textContent = 'This link was missing a valid issue reference.';
      return;
    }
    heading.textContent = 'Opening Marvel Comics website';
    open(comicsUrl, 'Find this comic on the Marvel Comics website. This is not a single-comic link. Reading progress has not changed.');
  }
  return { start };
}
