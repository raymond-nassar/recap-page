import { isAllowedApiBase } from '../js/lib/apiBase.js';
import { issuePageUrl } from '../js/lib/issuePageUrl.js';
import { createAndroidReader } from './reader.js';

window.opener = null;

const paragraph = document.createElement('p');
const appLink = document.createElement('a');
paragraph.append(appLink);
const fallback = document.getElementById('fallback');
fallback.parentElement.before(paragraph);
const disclosure = document.createElement('p');
disclosure.textContent = 'Known digital issue IDs ask Marvel for an app link. Without one, a recorded issue page whose metadata lookup was already refused opens in your browser. Other issues still request metadata. Lists, notes and reading progress are not sent.';
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
    appLink,
  },
  readApiBase,
  validateIssuePageUrl: issuePageUrl,
}).start();
