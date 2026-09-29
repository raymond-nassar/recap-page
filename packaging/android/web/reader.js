const DRN = /^drn:src:marvel:unison::prod:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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

export async function resolveMarvelIssue(digitalId, fetchImpl, signal) {
  const id = digitalReference(digitalId);
  if (!id) throw new Error('invalid-reference');
  const response = await fetchImpl(`https://bifrost.marvel.com/unison/legacy?digitalId=${id}`,
    { ...REQUEST_OPTIONS, signal });
  if (!response.ok) throw new Error('resolver-unavailable');
  const body = await response.json();
  const result = body?.data?.dynamicQueryOrError;
  const contents = result?.entity?.contents;
  if ((body?.errors && (!Array.isArray(body.errors) || body.errors.length))
    || result?.error || !Array.isArray(contents) || contents.length !== 1) {
    throw new Error('no-app-link');
  }
  const drn = contents[0]?.content?.id;
  if (typeof drn !== 'string' || !DRN.test(drn)) throw new Error('no-app-link');
  return `marvelunlimited://issue/${drn}`;
}

export function createAndroidReader({ host, location, elements, readApiBase, validateIssuePageUrl, fetchImpl = fetch }) {
  if (typeof validateIssuePageUrl !== 'function') throw new TypeError('An issue-page validator is required');
  const { heading, status, fallback, appLink } = elements;
  const query = new URLSearchParams(location.search);
  const issueId = digitalReference(query.get('i'));
  let digitalId = digitalReference(query.get('d'));
  const pageUrl = issueId && query.getAll('u').length === 1 ? validateIssuePageUrl(query.get('u'), issueId) : null;
  const knownPage = pageUrl && query.getAll('p').length === 1 && query.get('p') === '1';
  let cancelled = false;
  let attempted = false;
  let timedOut = false;
  let timer;
  const controller = new AbortController();
  const title = (query.get('t') || '').slice(0, 120);
  const readerUrl = (id) => `https://read.marvel.com/#/book/${id}`;
  const detailUrl = (id) => `https://www.marvel.com/comics/issue/${id}/`;
  fallback.textContent = 'Open in browser';
  fallback.href = digitalId ? readerUrl(digitalId)
    : pageUrl || (issueId ? detailUrl(issueId) : 'https://www.marvel.com/unlimited');
  appLink.hidden = true;
  if (title) heading.textContent = `Opening ${title}…`;

  function cancel() {
    cancelled = true;
    attempted = false;
    host.clearTimeout(timer);
    controller.abort();
  }
  function opening() {
    attempted = true;
    status.textContent = 'Opening Marvel Unlimited. If the comic does not load, use Open in browser.';
  }
  fallback.addEventListener('click', () => {
    cancel();
    status.textContent = 'Choose a browser if asked. If nothing opens, this link is still available.';
  });
  host.addEventListener('pagehide', cancel, { once: true });
  appLink.addEventListener('click', opening);
  host.addEventListener('recap:reader-result', (event) => {
    if (!attempted || typeof event.detail !== 'boolean') return;
    status.textContent = event.detail
      ? 'Marvel Unlimited was opened. If the comic did not load, use Open in browser. Reading progress has not changed.'
      : 'Marvel Unlimited could not be opened. Install or enable it, or use Open in browser.';
    appLink.textContent = 'Try Marvel Unlimited again';
  });

  async function start() {
    if (!digitalId && !issueId) {
      heading.textContent = 'Nothing to open';
      status.textContent = 'This link was missing a valid issue reference.';
      return;
    }
    if (!digitalId && knownPage) {
      status.textContent = 'Opening the Marvel issue page in your browser. Reading progress has not changed.';
      location.assign(pageUrl);
      return;
    }
    status.textContent = 'Looking up the Marvel Unlimited app link…';
    timer = host.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8000);
    try {
      if (!digitalId) {
        const base = readApiBase();
        if (!base) throw new Error('invalid-metadata-address');
        const response = await fetchImpl(`${base}/issues/${issueId}`,
          { ...REQUEST_OPTIONS, signal: controller.signal });
        if (!response.ok) throw new Error('metadata-unavailable');
        const body = await response.json();
        digitalId = digitalReference(body?.digitalId);
        if (!digitalId) throw new Error('missing-digital-reference');
      }
      if (cancelled) return;
      if (controller.signal.aborted) throw new Error('lookup-aborted');
      fallback.href = readerUrl(digitalId);
      const url = await resolveMarvelIssue(digitalId, fetchImpl, controller.signal);
      if (cancelled) return;
      if (controller.signal.aborted) throw new Error('lookup-aborted');
      appLink.href = url;
      appLink.textContent = 'Open Marvel Unlimited';
      appLink.hidden = false;
      opening();
      location.assign(url);
    } catch (error) {
      if (cancelled) return;
      if (timedOut) {
        status.textContent = 'The app-link lookup timed out. Use Open in browser.';
      } else if (error?.message === 'missing-digital-reference') {
        status.textContent = 'No digital reader link is recorded for this issue. Use Open in browser to visit its Marvel page.';
      } else if (error?.message === 'invalid-metadata-address') {
        status.textContent = 'The configured metadata address could not be read. Use Open in browser.';
      } else {
        status.textContent = 'Could not resolve the Marvel Unlimited app link. Use Open in browser.';
      }
    } finally {
      host.clearTimeout(timer);
    }
  }
  return { start };
}
