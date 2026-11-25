export const MARVEL_COMICS_URL = 'https://marvel.webtoon.com/';

// #1601: Marvel Unlimited is no longer a destination on any platform. A comic with a verified Marvel
// Comics app link opens that comic; any other comic opens the Marvel Comics website, never a
// prefilled search or a guessed issue. The date arguments are kept so older callers still work.
export function readerAction(_now = new Date(), { app = false } = {}) {
  return app ? 'Read' : 'Find on Marvel Comics';
}

// Wording approved by the owner for #1601, byte for byte, apostrophe included.
export function readerClosureNotice() {
  return 'Read opens a comic directly in the Marvel Comics app. If there’s no direct link, use Find on Marvel Comics to open the website.';
}

export function readerDestination() {
  return 'comics';
}

export function readerContext(title) {
  return `Marvel Comics website to find ${title} (not a single-comic link)`;
}

// The whole accessible name of a Read control. The app form names its destination; the website
// form adds context after the approved action label.
export function readerName(title, _now = new Date(), { app = false } = {}) {
  return app ? `Read ${title} in the Marvel Comics app`
    : `Find on Marvel Comics: ${readerContext(title)}`;
}

// An old bookmark may still ask for Marvel Unlimited; it now opens the website like any other.
export function launchDestination() {
  return 'comics';
}
