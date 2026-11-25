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

// #1601: a comic known only by its Marvel Comics app viewer number is saved under a reserved negative
// key, never under the bare viewer number. 5,438 old catalog numbers equal some viewer number
// (viewer 12618 is Runaways #1, catalog 12618 is Black Panther #49), so the two must not share a
// range. The offset sits far below catalog placeholders (about -2.1e9) and hand-added comics
// (-Date.now(), about -1.8e12) and stays a safe integer, and the key depends on the viewer alone,
// so one comic keeps one checkmark in every guide that lists it.
export const VIEWER_KEY_OFFSET = 8_000_000_000_000_000;

export function viewerKey(value) {
  const n = viewerNumber(value);
  return n ? -(VIEWER_KEY_OFFSET + Number(n)) : null;
}

export function viewerFromKey(key) {
  if (!Number.isSafeInteger(key) || key >= 0) return null;
  return viewerNumber(String(-key - VIEWER_KEY_OFFSET));
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
