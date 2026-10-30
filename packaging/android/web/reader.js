const REQUEST_OPTIONS = {
  headers: { accept: 'application/json' },
  cache: 'no-store',
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  redirect: 'error',
};

export function digitalReference(value) {
  const text = String(value ?? '');
  return /^[1-9]\d{0,11}$/.test(text) ? text : null;
}

export function createAndroidReader({
  host, location, elements, readApiBase, validateIssuePageUrl, destination, comicsUrl, fetchImpl = fetch,
}) {
  if (typeof validateIssuePageUrl !== 'function') throw new TypeError('An issue-page validator is required');
  if (!['unlimited', 'comics'].includes(destination) || comicsUrl !== 'https://marvel.webtoon.com/') {
    throw new TypeError('An approved reader destination is required');
  }
  const { heading, status, fallback } = elements;
  const query = new URLSearchParams(location.search);
  const issueId = digitalReference(query.get('i'));
  let digitalId = digitalReference(query.get('d'));
  const pageUrl = issueId && query.getAll('u').length === 1 ? validateIssuePageUrl(query.get('u'), issueId) : null;
  const knownPage = pageUrl && query.getAll('p').length === 1 && query.get('p') === '1';
  let cancelled = false;
  let timedOut = false;
  let timer;
  const controller = new AbortController();
  const title = (query.get('t') || '').slice(0, 120);
  const readerUrl = (id) => `https://read.marvel.com/#/book/${id}`;
  const detailUrl = (id) => `https://www.marvel.com/comics/issue/${id}/`;
  fallback.textContent = 'Open in browser';
  fallback.href = destination === 'comics' ? comicsUrl
    : digitalId ? readerUrl(digitalId) : pageUrl || (issueId ? detailUrl(issueId) : comicsUrl);
  if (title) heading.textContent = `Opening ${title}`;

  function cancel() {
    cancelled = true;
    host.clearTimeout(timer);
    controller.abort();
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
    if (!digitalId && !issueId) {
      heading.textContent = 'Nothing to open';
      status.textContent = 'This link was missing a valid issue reference.';
      return;
    }
    if (destination === 'comics') {
      heading.textContent = 'Opening Marvel Comics website';
      open(comicsUrl, 'Find this comic on the Marvel Comics website. This is not a single-comic link. Reading progress has not changed.');
      return;
    }
    const readingMessage = 'Opening the Marvel Unlimited web reader in your browser. Reading ends December 7, 2026. Reading progress has not changed.';
    if (digitalId) {
      open(readerUrl(digitalId), readingMessage);
      return;
    }
    if (knownPage) {
      open(pageUrl, 'Opening the Marvel issue page in your browser. Reading progress has not changed.');
      return;
    }
    status.textContent = 'Looking up the Marvel Unlimited reader link. Reading ends December 7, 2026.';
    timer = host.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8000);
    try {
      const base = readApiBase();
      if (!base) throw new Error('invalid-metadata-address');
      const response = await fetchImpl(`${base}/issues/${issueId}`,
        { ...REQUEST_OPTIONS, signal: controller.signal });
      if (!response.ok) throw new Error('metadata-unavailable');
      const body = await response.json();
      if (cancelled) return;
      if (controller.signal.aborted) throw new Error('lookup-aborted');
      digitalId = digitalReference(body?.digitalId);
      if (!digitalId) throw new Error('missing-digital-reference');
      open(readerUrl(digitalId), readingMessage);
    } catch (error) {
      if (cancelled) return;
      if (timedOut) {
        status.textContent = 'The reader-link lookup timed out. Use Open in browser to visit the comic details page.';
      } else if (error?.message === 'missing-digital-reference') {
        status.textContent = 'No digital reader link is recorded for this issue. Use Open in browser to visit its Marvel page.';
      } else if (error?.message === 'invalid-metadata-address') {
        status.textContent = 'The configured metadata address could not be read. Use Open in browser.';
      } else {
        status.textContent = 'Could not look up the Marvel Unlimited reader link. Use Open in browser to visit the comic details page.';
      }
    } finally {
      host.clearTimeout(timer);
    }
  }
  return { start };
}
