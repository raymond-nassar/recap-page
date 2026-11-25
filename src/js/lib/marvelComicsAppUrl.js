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

export function appViewerFromUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(MARVEL_COMICS_APP_VIEWER)) return null;
  const viewer = url.slice(MARVEL_COMICS_APP_VIEWER.length);
  return appViewerUrl(viewer) === url ? viewer : null;
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

// The key alone never names a viewer. A record says which viewer it is in its own `appViewer` field,
// and that is believed only when the key is the one derived from it. No release before this wrote
// either half, and an older build drops the unknown field when it saves, so a saved or restored
// record in this range without the field stays an ordinary unopenable comic rather than being read
// as somebody else's viewer number: -8000000000012618 with an unrelated title is not Runaways #1.
export function taggedViewer(issue) {
  if (!issue || typeof issue !== 'object') return null;
  const n = viewerNumber(issue.appViewer);
  return n && viewerKey(n) === issue.issueId ? n : null;
}

export function appLaunchUrl(query) {
  return query.getAll('a').length === 1 ? appViewerUrl(query.get('a')) : null;
}
