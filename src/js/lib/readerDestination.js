export const MARVEL_COMICS_URL = 'https://marvel.webtoon.com/';

export function readerAction(now = new Date()) {
  return readerDestination(now) === 'unlimited' ? 'Read' : 'Find on Marvel Comics';
}

export function readerClosureNotice(now = new Date()) {
  return (readerDestination(now) === 'unlimited'
    ? 'Marvel Unlimited reading ends December 7, 2026. Until that date, Read uses its web reader when a link is recorded.'
    : 'Reading in Marvel Unlimited ended December 7, 2026.')
    + ' From December 7, Read opens the Marvel Comics website, not a single-comic link. Your saved lists, progress and backups stay unchanged.';
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

export function launchDestination(query, now = new Date()) {
  const requested = query.getAll('r');
  return requested.length === 1 && ['unlimited', 'comics'].includes(requested[0])
    ? requested[0] : readerDestination(now);
}
