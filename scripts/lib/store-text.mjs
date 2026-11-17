import { validateReleaseNotes } from '../check-store-release.mjs';

// Published limits, retrieved 2026-11-16. Google Play: "Release notes: 500 characters per
// language" (https://support.google.com/googleplay/android-developer/answer/9859348). App Store
// Connect: What's New in This Version, 4000 characters
// (https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information).
// The Microsoft Store file check already caps every approved text at 1500, so these only bind
// if that cap is ever raised; they stay explicit so no store can be sent more than it accepts.
export const STORE_LIMITS = Object.freeze({ 'google-play': 500, 'app-store': 4000 });

export class StoreTextError extends Error {}

export const storeTextPath = (version) => `docs/releases/${version}-store.json`;

// Both counts are taken and the larger must fit, because a store that counts UTF-16 units would
// see more characters than one that counts code points, and stopping is the only safe answer.
export function textLength(text) {
  return Math.max([...text].length, text.length);
}

export function approvedStoreText(bytes, version, store) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new StoreTextError(`store text: version ${JSON.stringify(version)} is not x.y.z`);
  }
  const limit = STORE_LIMITS[store];
  if (!limit) throw new StoreTextError(`store text: unknown store ${JSON.stringify(store)}`);
  const path = storeTextPath(version);
  let parsed;
  try {
    parsed = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes);
  } catch {
    throw new StoreTextError(`store text: ${path} is not valid JSON`);
  }
  try {
    validateReleaseNotes(parsed, `${version}.0`);
  } catch (error) {
    throw new StoreTextError(`store text: ${path}: ${error.message}`);
  }
  const length = textLength(parsed.text);
  if (length > limit) {
    throw new StoreTextError(`store text: ${store} accepts at most ${limit} characters and ${path} `
      + `holds ${length}. Shorten the approved text in a reviewed change; nothing was sent or truncated.`);
  }
  return { path, version, locale: parsed.locale, text: parsed.text, length, limit };
}
