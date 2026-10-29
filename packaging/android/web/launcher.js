import { isAllowedApiBase } from '../js/lib/apiBase.js';
import { issuePageUrl } from '../js/lib/issuePageUrl.js';
import { createAndroidReader } from './reader.js';
import { launchDestination, MARVEL_COMICS_URL } from '../js/lib/readerDestination.js';

window.opener = null;

const fallback = document.getElementById('fallback');
const disclosure = document.createElement('p');
disclosure.textContent = 'Read opens your installed browser, not the Marvel Unlimited app. Before December 7, 2026, an issue without a recorded reader link may request metadata. From that date Read opens the general Marvel Comics website without a metadata lookup. Recap Page no longer contacts Bifrost. Lists, notes and reading progress are not sent.';
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
}).start();
