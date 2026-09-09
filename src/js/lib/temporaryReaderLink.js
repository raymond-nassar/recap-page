import { digitalIdFromUrl } from './markdown.js';
import { readerUrl } from '../reader.js';

export const REPORT_LINK = Object.freeze({
  href: 'https://github.com/raymond-nassar/recap-page/issues/new?template=data-order.yml',
  target: '_blank',
  rel: 'noopener noreferrer',
  referrerpolicy: 'no-referrer',
});

export const TEMPORARY_LINK_LIFETIME =
  'Only in this tab until the page reloads or closes. Replacing saved data or losing this comic reference also clears it.';

const MAX_INPUT = 500;
const MAX_LABEL = 200;

function refusal(error) {
  return { ok: false, error };
}

export function savedReaderIssue(state, issueId) {
  if (typeof issueId !== 'number' && typeof issueId !== 'string') return null;
  const id = Number(issueId);
  if (!Number.isSafeInteger(id) || id === 0
    || (typeof issueId !== 'number' && issueId !== String(id))) return null;
  if (!state?.issues || !Object.hasOwn(state.issues, String(id))) return null;
  const issue = state.issues[id];
  return issue?.issueId === id ? issue : null;
}

function bookUrl(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (!/^\d{1,12}$/.test(String(value))) return null;
  return readerUrl(value);
}

export function parseTemporaryReaderLink(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return refusal('Paste the address from the Marvel Unlimited reader.');
  }
  // eslint-disable-next-line no-control-regex -- Reject raw controls before URL can normalize them away.
  if (value.length > MAX_INPUT || /[\u0000-\u001f\u007f\\]/.test(value)) {
    return refusal('That address is too long or contains unsupported characters.');
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return refusal('Enter a complete Marvel Unlimited reader address.');
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.hostname !== 'read.marvel.com' || url.username || url.password
    || url.port || url.pathname !== '/') {
    return refusal('Paste the address from read.marvel.com, not the comic information page.');
  }
  if (!/^#\/book\/\d{1,12}(?:\/|$)/.test(url.hash)) {
    return refusal('The address needs a complete numeric reader book reference.');
  }
  const digitalId = digitalIdFromUrl(url.href);
  if (digitalId === null) return refusal('That reader book reference is not usable.');
  return { ok: true, digitalId, url: readerUrl(digitalId) };
}

function label(value, fallback = '') {
  // eslint-disable-next-line no-control-regex -- Report labels replace stored control characters with spaces.
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL) || fallback;
}

export function originalReaderLink(issue) {
  return bookUrl(issue?.digitalId);
}

export function originalReaderDescription(issue) {
  const direct = originalReaderLink(issue);
  if (direct) return direct;
  return issue?.issueId > 0
    ? 'No direct reader link recorded; Read looks it up'
    : 'No original reader reference';
}

export function readerLinkReport(issue, digitalId = null) {
  const lines = [
    `Comic: ${label(issue?.title, 'Untitled saved comic')}`,
    issue?.issueId > 0 && Number.isSafeInteger(issue.issueId)
      ? `Marvel comic ID: ${issue.issueId}\nComic page: https://www.marvel.com/comics/issue/${issue.issueId}/`
      : 'Marvel comic ID: Not recorded; this is a local manual/reader-only entry',
    `Original reader link: ${originalReaderDescription(issue)}`,
    `Proposed reader link: ${bookUrl(digitalId) ?? 'Not supplied'}`,
    'This is my suggested same-comic destination, not independently verified.',
  ];
  return lines.join('\n');
}

// This factory owns document memory only. Reconciliation receives existing operation outcomes;
// a new state object or an unrelated foreign save is not evidence of dataset replacement.
export function createTemporaryReaderLinks() {
  const links = new Map();
  let known = true;
  let epoch = 0;

  function get(state, issueId) {
    if (!known) return null;
    if (!savedReaderIssue(state, issueId)) {
      if (typeof issueId === 'number') links.delete(issueId);
      return null;
    }
    return links.get(Number(issueId)) ?? null;
  }

  function clear() {
    const removed = links.size;
    links.clear();
    epoch += 1;
    return removed;
  }

  function reconcile(state, { changed = false, confirmed = false } = {}) {
    if (changed !== true && changed !== false && changed !== null) {
      throw new TypeError('A saved-data outcome must be true, false or null.');
    }
    if (changed !== false) {
      const removed = clear();
      known = changed !== null;
      return { removed, known, replaced: changed === true };
    }
    if (confirmed) known = true;
    let removed = 0;
    for (const id of links.keys()) {
      if (!savedReaderIssue(state, id)) {
        links.delete(id);
        removed += 1;
      }
    }
    return { removed, known, replaced: false };
  }

  function use(state, issueId, value) {
    if (!known) return refusal('Saved comic references are uncertain. Resolve saved data before using a temporary link.');
    if (!savedReaderIssue(state, issueId)) return refusal('That comic is no longer a matching saved issue.');
    const parsed = parseTemporaryReaderLink(value);
    if (!parsed.ok) return parsed;
    const id = Number(issueId);
    const changed = links.get(id) !== parsed.digitalId;
    links.set(id, parsed.digitalId);
    return { ...parsed, changed };
  }

  function remove(state, issueId) {
    if (!known) return refusal('Saved comic references are uncertain. Resolve saved data first.');
    if (!savedReaderIssue(state, issueId)) return refusal('That comic is no longer a matching saved issue.');
    return { ok: true, changed: links.delete(Number(issueId)) };
  }

  function resolve(state, issue, { source } = {}) {
    if (!['saved', 'bundled', 'api'].includes(source)) {
      return refusal('The comic source is not recognized.');
    }
    if (!issue) return refusal('No comic was selected.');
    if (!known) {
      if (source === 'saved') return refusal('Saved comic references are uncertain. Resolve saved data before opening this comic.');
      return { ok: true, issue, temporary: false };
    }
    const saved = savedReaderIssue(state, issue?.issueId);
    const digitalId = get(state, issue?.issueId);
    if (!saved && source === 'saved') {
      const id = issue.issueId;
      const listed = Number.isSafeInteger(id) && id > 0 && !Object.hasOwn(state.issues, id)
        && Object.values(state.lists).some((list) => list.itemIds.includes(id));
      if (listed) return { ok: true, issue: { issueId: id, title: `Issue ${id}` }, temporary: false };
      return refusal('That comic is no longer a matching saved issue.');
    }
    const base = saved ?? issue;
    return {
      ok: true,
      issue: digitalId === null ? base : { ...base, digitalId },
      temporary: digitalId !== null,
    };
  }

  return {
    get,
    use,
    remove,
    resolve,
    reconcile,
    clear,
    get known() { return known; },
    get epoch() { return epoch; },
    get size() { return links.size; },
  };
}
