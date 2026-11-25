// Marvel Comics app links for single comics (#950). The table is bundled with the app and read
// synchronously, so Read can choose the app link inside the click without awaiting anything before
// window.open (constraint 7). A link says where a comic can be opened; it never says the comic is
// available, and nothing here touches the availability record (constraint 6).
import { marvelComicsAppLinkPairs } from '../../data/marvelComicsAppLinks.js';
import { marvelComicsAppMuIssueIds } from '../../data/marvelComicsAppMuIssues.js';
import { appMuIssuesUrl, appViewerUrl, viewerFromKey, viewerNumber } from './marvelComicsAppUrl.js';

let table = null;

function links() {
  if (!table) table = new Map(marvelComicsAppLinkPairs);
  return table;
}

// Keyed by the comic, not the list, so a comic saved before this table existed finds its link too.
export function appViewerFor(issueId) {
  if (typeof issueId !== 'number' && typeof issueId !== 'string') return null;
  if (/^-[1-9][0-9]{15}$/.test(String(issueId))) return viewerFromKey(Number(issueId));
  if (!/^[1-9][0-9]{0,11}$/.test(String(issueId))) return null;
  const n = links().get(Number(issueId));
  return n === undefined ? null : viewerNumber(n);
}

const muIssues = new Set(marvelComicsAppMuIssueIds);

export function appLinkFor(issueId) {
  const viewer = appViewerFor(issueId);
  if (viewer) return appViewerUrl(viewer);
  const url = appMuIssuesUrl(issueId);
  return url && muIssues.has(Number(issueId)) ? url : null;
}
