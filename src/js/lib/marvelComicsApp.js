// Marvel Comics app links for single comics (#950). The table is bundled with the app and read
// synchronously, so Read can choose the app link inside the click without awaiting anything before
// window.open (constraint 7). A link says where a comic can be opened; it never says the comic is
// available, and nothing here touches the availability record (constraint 6).
//
// #1601: only a viewer address is a direct link. The old Marvel Unlimited issue route is no longer
// offered, so a comic that only had one now shows Find on Marvel Comics.
import { marvelComicsAppLinkPairs } from '../../data/marvelComicsAppLinks.js';
import { appViewerUrl, taggedViewer, viewerNumber } from './marvelComicsAppUrl.js';

let table = null;
let reverse = null;

function links() {
  if (!table) table = new Map(marvelComicsAppLinkPairs);
  return table;
}

// Keyed by the comic, not the list, so a comic saved before this table existed finds its link too.
// Takes the saved comic itself where one is to hand, because a viewer-only comic is recognized by
// its own record and never by its number (#1601); a bare number is only ever an old catalog number.
export function appViewerFor(issue) {
  if (issue && typeof issue === 'object') return taggedViewer(issue) ?? appViewerFor(issue.issueId);
  if (typeof issue !== 'number' && typeof issue !== 'string') return null;
  if (!/^[1-9][0-9]{0,11}$/.test(String(issue))) return null;
  const n = links().get(Number(issue));
  return n === undefined ? null : viewerNumber(n);
}

export function appLinkFor(issue) {
  const viewer = appViewerFor(issue);
  return viewer ? appViewerUrl(viewer) : null;
}

// Every old catalog number the bundled table joins to this viewer. More than one means the join
// cannot say which comic was meant, so callers treat anything but exactly one as no match.
export function catalogIdsForViewer(viewer, pairs = marvelComicsAppLinkPairs) {
  const n = viewerNumber(viewer);
  if (!n) return [];
  if (pairs !== marvelComicsAppLinkPairs) {
    return pairs.filter(([, v]) => viewerNumber(v) === n).map(([c]) => Number(c));
  }
  if (!reverse) {
    reverse = new Map();
    for (const [c, v] of marvelComicsAppLinkPairs) {
      const key = viewerNumber(v);
      if (!key) continue;
      if (!reverse.has(key)) reverse.set(key, []);
      reverse.get(key).push(Number(c));
    }
  }
  return reverse.get(n) ?? [];
}
