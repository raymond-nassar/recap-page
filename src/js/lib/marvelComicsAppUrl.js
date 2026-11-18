// The one Marvel Comics app address Recap Page builds (#950). Kept apart from the link table so the
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
