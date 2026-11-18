// The fixed Marvel Comics app addresses Recap Page builds (#950). Apart from the link table so the
// launcher page can check a number from its query without loading every link. The Android
// navigation policy accepts exactly this shape and nothing near it.
export const MARVEL_COMICS_APP_VIEWER = 'https://www.marvelcomicsapp.com/viewer/';

// Same bound as the build's own check, so a number the table could never hold is refused here too.
const VIEWER = /^[1-9][0-9]{0,8}$/;

export function viewerNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value);
  return VIEWER.test(text) ? text : null;
}

export function appViewerUrl(value) {
  const n = viewerNumber(value);
  return n ? `${MARVEL_COMICS_APP_VIEWER}${n}` : null;
}

export function appMuIssuesUrl(value) {
  const n = viewerNumber(value);
  return n ? `https://www.marvelcomicsapp.com/mu/issues/${n}` : null;
}

export function appLaunchUrl(query) {
  const viewer = query.getAll('a').length === 1 ? appViewerUrl(query.get('a')) : null;
  if (viewer) return viewer;
  if (query.getAll('m').length !== 1 || query.getAll('i').length !== 1
    || query.get('m') !== query.get('i')) return null;
  return appMuIssuesUrl(query.get('m'));
}
