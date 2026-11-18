export const MARVEL_COMICS_URL = 'https://marvel.webtoon.com/';

export const MARVEL_UNLIMITED_CHOICE = 'Marvel Unlimited, until December 7, 2026';

// A comic with a bundled Marvel Comics app link opens that comic itself, so it keeps the plain
// Read label after December 7, when comics without one fall back to searching the website.
export function readerAction(now = new Date(), { app = false } = {}) {
  return app || readerDestination(now) === 'unlimited' ? 'Read' : 'Find on Marvel Comics';
}

// Wording approved by the owner on 17 Nov 2026 (#950).
export function readerClosureNotice(now = new Date()) {
  return readerDestination(now) === 'unlimited'
    ? 'Read now opens comics in the Marvel Comics app when we have a link. Marvel Unlimited ends December 7, 2026. Until then you can still choose it under Reading options.'
    : 'Marvel Unlimited has ended. Read opens the comic in the Marvel Comics app when we have a link, and the Marvel Comics website otherwise.';
}

export function readerDestination(now = new Date()) {
  const day = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  return day < 20261207 ? 'unlimited' : 'comics';
}

export function readerContext(title, now = new Date()) {
  return readerDestination(now) === 'unlimited'
    ? `${title} in Marvel Unlimited (reading ends December 7, 2026)`
    : `Marvel Comics website to find ${title} (not a single-comic link)`;
}

// The whole accessible name of a Read control. The app form is the owner's approved sentence; the
// others keep the label first and the context after a colon, as labelledName builds them.
export function readerName(title, now = new Date(), { app = false } = {}) {
  return app ? `Read ${title} in the Marvel Comics app`
    : `${readerAction(now)}: ${readerContext(title, now)}`;
}

export function launchDestination(query, now = new Date()) {
  const requested = query.getAll('r');
  return requested.length === 1 && ['unlimited', 'comics'].includes(requested[0])
    ? requested[0] : readerDestination(now);
}
