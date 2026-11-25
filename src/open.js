// Launch page for a comic: the Marvel Comics app when a verified viewer link exists, and the
// Marvel Comics website otherwise (#1601). Marvel Unlimited is no longer opened from here; an old
// bookmark that still asks for it, or carries a book or issue number, opens the website instead.
//
// Why this page exists at all: the app opens it synchronously from the click, so the browser never
// treats the tab as an unsolicited popup, and `opener` is severed below before any navigation.
//
// Deliberately not an open redirector: only digits cross the query, and every destination is
// rebuilt from a fixed address.
//
// This lives in its own file rather than an inline <script> so the server can send a
// Content-Security-Policy with `script-src 'self'`. That is the directive that stops a
// compromised or hostile metadata response from executing script it smuggled into a
// title or description, so it is worth keeping strict enough to be meaningful.
//
// open.html loads it at the end of <body>, and module scripts are deferred, so the elements
// looked up below are parsed by the time this runs.
import { themeAttribute, normaliseTheme, applyThemeMeta } from './js/lib/theme.js';
import { MARVEL_COMICS_URL } from './js/lib/readerDestination.js';
import { appLaunchUrl } from './js/lib/marvelComicsAppUrl.js';

// Disown the opener before anything else, and in particular before any navigation.
// The opener belongs to the tab rather than to the document, so severing it here also
// covers the Marvel Comics app and website, which this tab is about to replace itself with.
//
// The app's own launcher already passes 'noopener' (src/js/reader.js), so nothing in this
// repository needs it. This page is a plain URL, though, and anything else that reaches it,
// a bookmark, an external link, or another site calling window.open without 'noopener',
// would otherwise leave the destination holding a handle it can navigate the opener with.
// Measured before this line existed: the destination did hold one.
//
// Nothing here needs the opener. Every path leaves via location.replace, and no message is
// ever posted back to the app.
window.opener = null;

const q = new URLSearchParams(location.search);
const digits = (v) => (/^[1-9]\d{0,11}$/.test(v || '') ? v : null);

const digitalId = digits(q.get('d'));
const issueId = digits(q.get('i'));
const title = (q.get('t') || '').slice(0, 120);
// #950: only numbers cross the query, and addresses are rebuilt from fixed prefixes.
const appUrl = appLaunchUrl(q);

const h = document.getElementById('h');
const p = document.getElementById('p');
const fallback = document.getElementById('fallback');
const settingsStatus = document.getElementById('settings-status');

let settings = {};
let settingsMessage = '';
let parsed;
let readFailed = false;
try {
  parsed = localStorage.getItem('mrt.settings');
} catch {
  readFailed = true;
  settingsMessage = 'Saved display settings could not be read. Using the system theme.';
}
if (!readFailed) {
  try {
    const raw = JSON.parse(parsed || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      settings = raw;
      if (raw.theme != null && raw.theme !== normaliseTheme(raw.theme)) {
        settingsMessage = 'Saved theme is not recognized. Using the system theme.';
      }
    } else {
      settingsMessage = 'Saved settings are not readable. Using the system theme.';
    }
  } catch {
    settingsMessage = 'Saved settings are not readable. Using the system theme.';
  }
}
const chosenTheme = themeAttribute(settings.theme);
if (chosenTheme) document.documentElement.setAttribute('data-theme', chosenTheme);
else document.documentElement.removeAttribute('data-theme');
applyThemeMeta(settings.theme);
settingsStatus.textContent = settingsMessage;
settingsStatus.hidden = !settingsMessage;

const presentation = {
  'missing-reference': ['Nothing to open', 'This link was missing an issue reference.'],
  comics: ['Opening Marvel Comics website', 'Find this comic on the Marvel Comics website. This is not a single-comic link. Reading progress has not changed.'],
  app: ['Opening the Marvel Comics app', 'Taking you to this comic in the Marvel Comics app.'],
};

function present(state) {
  const [heading, caption] = presentation[state];
  document.documentElement.setAttribute('data-state', state);
  document.title = `${heading} - Recap Page`;
  h.textContent = title && state === 'app' ? `Opening ${title}...` : heading;
  p.textContent = caption;
  fallback.hidden = state === 'missing-reference';
}

function go(url) {
  fallback.href = url;
  location.replace(url);
}

// A viewer address alone is enough (#1601): it is rebuilt from digits under a fixed prefix. Without
// one, a launch from the app carries its destination as `r`, and an older bookmark carries a book
// or issue number; both open the website rather than a guessed issue.
if (appUrl) {
  present('app');
  go(appUrl);
} else if (q.getAll('r').length === 1 || digitalId || issueId) {
  present('comics');
  go(MARVEL_COMICS_URL);
} else {
  present('missing-reference');
}
