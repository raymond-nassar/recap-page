// Which theme the page is wearing, separated from the DOM that wears it.
//
// The decision is made by functions that touch nothing, so each can be tested directly. The one
// that writes, `applyThemeMeta`, writes only the meta tags of the document it is handed, so a test
// can hand it a stand-in. `src/js/main.js` and `src/open.js` keep setting the attribute themselves.

export const THEMES = ['system', 'dark', 'light'];

export const DEFAULT_THEME = 'system';

// 'system' writes no attribute at all, which is what hands the decision back to the stylesheet's
// `prefers-color-scheme` block. Writing `data-theme="system"` instead would match neither the dark
// selector nor the light one, so the page would fall through to the bare `:root` defaults and sit
// on dark while the control claimed to be following the system.
//
// Anything unrecognised resolves the same way. A value can reach here from a settings blob written
// by an older version or edited by hand, and the safe reading of "I do not know this theme" is to
// let the system decide rather than to write an attribute nobody styles.
export function themeAttribute(theme) {
  return theme === 'dark' || theme === 'light' ? theme : null;
}

// Used on the way in from storage and on the way in from the control, so an unknown value is
// normalised once rather than at each call site.
export function normaliseTheme(theme) {
  return THEMES.includes(theme) ? theme : DEFAULT_THEME;
}

// The scheme a `theme-color` tag is written for, read from its media query: 'dark' or 'light', or
// null for a tag whose query names neither.
export function themeColorScheme(media) {
  const match = /^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/.exec(String(media ?? '').trim());
  return match ? match[1] : null;
}

// The colour each of the page's `theme-color` tags should carry. An installed browser app paints its
// title bar in the page's theme colour, in place of the manifest's, and takes it from the first tag
// whose media query matches (#834). So the head carries one tag per scheme, written with that scheme's
// page background, and on 'system' each keeps its own colour: the title bar follows the system setting,
// and any later change of it, with no script, as the stylesheet does. A media query cannot see an
// explicit theme, so for one every tag carries the chosen scheme's colour, and whichever tag the browser
// picks says the same thing.
//
// `tags` are the tags as written, in document order: the media query each was written for and the
// colour it was written with. Anything unrecognised resolves to 'system', as `themeAttribute` does, and
// so does a theme the head has no tag for, rather than painting a colour nobody wrote.
export function themeColors(theme, tags) {
  const scheme = themeAttribute(theme);
  const chosen = scheme ? tags.find((tag) => themeColorScheme(tag.media) === scheme) : null;
  return tags.map((tag) => (chosen ? chosen.color : tag.color));
}

// Each tag's colour as written in the markup, kept from the first write on: an explicit theme rewrites
// a tag's own colour, and going back to 'system' has to put it back.
const written = new WeakMap();

// Points the head's meta tags at `theme`. The colour scheme tells the browser what to paint scrollbars
// and form controls in before any CSS applies, and the theme colour what to paint an installed app's
// title bar in.
export function applyThemeMeta(theme, doc = globalThis.document) {
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content', themeAttribute(theme) ?? 'dark light');
  const tags = [...doc.querySelectorAll('meta[name="theme-color"]')];
  for (const tag of tags) if (!written.has(tag)) written.set(tag, tag.getAttribute('content'));
  const colors = themeColors(theme, tags.map((tag) => ({ media: tag.getAttribute('media'), color: written.get(tag) })));
  tags.forEach((tag, index) => tag.setAttribute('content', colors[index]));
}
