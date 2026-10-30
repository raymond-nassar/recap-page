// The two requests behind the hand-entry lookup.
//
// This is deliberately the only file in the page that talks to a third party the reader did not ask
// for by installing it. Constraint 3 promises no accounts, no cloud services and no telemetry. Its one
// exception, cloud backup (#810), sends saved data only to the reader's own account, only after they
// turn it on, and from the host rather than this page. So a new outbound request has to earn its place:
//
//   * it is never automatic. Nothing here runs unless the reader presses the lookup button.
//   * it sends the words in the Title box and nothing else. No list, no progress, no issue id,
//     no cookie and no referrer. The two options that guarantee the last two are set below.
//   * it is disclosed beside the button that fires it, and in the three places the privacy copy
//     test holds to the same standard.
//
// It is also the only file that talks to this host, so the whole of the app's exposure to the
// wiki is one function with an injectable fetch, which is what lets the request shape be tested
// without a network.

import { issueFacts, isVolumePage } from './wikitext.js';

export const WIKI_API = 'https://marvel.fandom.com/api.php';

// MediaWiki answers a cross-origin read only when the request asks for one by parameter. Measured
// on 2026-08-18: with `origin=*` the response carries Access-Control-Allow-Origin: *, and without
// it the header is absent and the browser discards the body it just downloaded. URLSearchParams
// leaves `*` unescaped, so this reaches the wire as the literal that was measured; the
// percent-encoded form was measured too and is also accepted, so neither serializer breaks it.
const CORS = { format: 'json', origin: '*' };

// Enough candidates to survive a fuzzy match without turning one press into a large download.
// The search is fuzzy: "X-Men Vol 7 26" returns the series page and issue 25 above issue 26, so a
// single top hit would frequently be the wrong page and a chooser is not optional.
const SEARCH_LIMIT = 6;

// MediaWiki accepts 50 titles per request. We never approach it, but the bound is what makes one
// batched request the correct shape rather than one request per candidate.
const MAX_TITLES = 50;

const TIMEOUT_MS = 8000;

export function searchUrl(query, limit = SEARCH_LIMIT) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: String(query),
    srlimit: String(limit),
    // Article space only. Without this the search reaches user and talk pages, which carry no
    // issue template and would fill the chooser with candidates that can never be picked.
    srnamespace: '0',
    ...CORS,
  });
  return `${WIKI_API}?${params}`;
}

export function wikitextUrl(titles) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'revisions',
    rvslots: '*',
    rvprop: 'content',
    titles: titles.slice(0, MAX_TITLES).join('|'),
    ...CORS,
  });
  return `${WIKI_API}?${params}`;
}

async function getJson(url, fetchImpl, signal) {
  const res = await fetchImpl(url, {
    signal,
    // No cookies are sent and none are accepted, so a reader with a Fandom account is not
    // identified to it by this app, and no state survives the request.
    credentials: 'omit',
    mode: 'cors',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) throw Object.assign(new Error(`wiki responded ${res.status}`), { status: res.status });
  return res.json();
}

// The search returns titles; the batch returns their wikitext; the parser turns each into facts
// and rejects anything that is not an issue page. Candidates come back in the search's own
// ranking order, because that ranking is the only signal available about which one was meant.
export async function lookupIssue(query, {
  fetchImpl = globalThis.fetch,
  limit = SEARCH_LIMIT,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  const phrase = String(query ?? '').trim();
  if (!phrase) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const found = await getJson(searchUrl(phrase, limit), fetchImpl, controller.signal);
    const titles = (found?.query?.search ?? [])
      .map((hit) => hit?.title)
      .filter((title) => typeof title === 'string' && title);
    if (!titles.length) return [];

    const got = await getJson(wikitextUrl(titles), fetchImpl, controller.signal);

    // MediaWiki may answer under a normalized title rather than the one we asked for, and it says
    // so rather than leaving it to be guessed. Without this the pages arrive and match nothing.
    const renamed = new Map();
    for (const pair of got?.query?.normalized ?? []) {
      if (pair?.from && pair?.to) renamed.set(pair.from, pair.to);
    }

    const wikitextByTitle = new Map();
    for (const page of Object.values(got?.query?.pages ?? {})) {
      const text = page?.revisions?.[0]?.slots?.main?.['*'];
      if (typeof page?.title === 'string' && typeof text === 'string') {
        wikitextByTitle.set(page.title, text);
      }
    }

    const out = [];
    for (const title of titles) {
      const text = wikitextByTitle.get(renamed.get(title) ?? title);
      if (typeof text !== 'string') continue;
      if (isVolumePage(text)) continue;
      const facts = issueFacts(text, title);
      if (!facts) continue;
      out.push({ title, ...facts });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}
