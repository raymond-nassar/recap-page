import { isAllowedApiBase } from '../js/lib/apiBase.js';
import { issuePageUrl } from '../js/lib/issuePageUrl.js';
import { createAndroidReader } from './reader.js';
import { launchDestination, MARVEL_COMICS_URL } from '../js/lib/readerDestination.js';
import { appViewerUrl } from '../js/lib/marvelComicsAppUrl.js';

window.opener = null;

const fallback = document.getElementById('fallback');
const disclosure = document.createElement('p');
disclosure.textContent = 'Read opens your installed browser. A comic with a Marvel Comics app link opens there. Before December 7, 2026, Read may look up the Marvel Unlimited link online for a comic without one. From that date it opens the general Marvel Comics website without a lookup. Lists, notes and reading progress are not sent.';
document.querySelector('.box').append(disclosure);

function readApiBase() {
  try {
    const settings = JSON.parse(localStorage.getItem('mrt.settings') || '{}');
    const base = String(settings.apiBase || 'https://marvel.emreparker.com/v1').replace(/\/+$/, '');
    return isAllowedApiBase(base) ? base : null;
  } catch {
    return null;
  }
}

createAndroidReader({
  host: window,
  location: window.location,
  elements: {
    heading: document.getElementById('h'),
    status: document.getElementById('p'),
    fallback,
  },
  readApiBase,
  destination: launchDestination(new URLSearchParams(window.location.search)),
  comicsUrl: MARVEL_COMICS_URL,
  validateIssuePageUrl: issuePageUrl,
  appUrlFor: appViewerUrl,
}).start();
