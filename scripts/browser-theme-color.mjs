// #834 (UX-28): an installed browser app paints its title bar in the page's theme colour, in place of
// the manifest's. Nothing is installed here, so the colour is read the way the browser picks it: the
// first `theme-color` tag in document order whose media query matches and whose content is a colour,
// which is Chrome 93's rule and Edge's. Runs on the ephemeral port like every scenario not listed for
// the app origin.
const DARK = '#111117';
const LIGHT = '#fafaff';
const OWN = [DARK, LIGHT];
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

// The colour a browser would give the title bar, beside what the page itself is wearing.
function picked(page) {
  return page.evaluate(() => {
    const tags = [...document.querySelectorAll('meta')]
      .filter((tag) => tag.name.toLowerCase() === 'theme-color' && tag.hasAttribute('content'));
    const pick = tags.find((tag) => (!tag.media || matchMedia(tag.media).matches)
      && CSS.supports('color', tag.content));
    return {
      color: pick ? pick.content : null,
      tags: tags.map((tag) => tag.content),
      media: tags.map((tag) => tag.media),
      background: getComputedStyle(document.body).backgroundColor,
      scheme: document.querySelector('meta[name="color-scheme"]')?.content ?? null,
      attribute: document.documentElement.getAttribute('data-theme'),
    };
  });
}

const system = (page, scheme) => page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

// A fresh load with `theme` saved, or nothing saved for null, and the system on `scheme`. From a blank
// page first, so nothing the app wore before carries over.
async function load(page, path, { theme = null, scheme = 'dark', width = 1280 } = {}) {
  await page.setViewport({ width, height: 900 });
  await system(page, scheme);
  await page.goto('about:blank');
  const { identifier } = await page.evaluateOnNewDocument((value) => {
    try {
      if (value === null) localStorage.removeItem('mrt.settings');
      else localStorage.setItem('mrt.settings', JSON.stringify({ theme: value }));
    } catch { /* about:blank has no storage of its own */ }
  }, theme);
  await page.goto(`${page.__origin}${path}`, { waitUntil: 'load' });
  await page.removeScriptToEvaluateOnNewDocument(identifier);
  await settle(page);
}

// The Settings control, as a reader would change it.
async function choose(page, theme) {
  await page.select('#opt-theme', theme);
  await settle(page);
}

const matches = (state, color, tags) => state.color === color && state.background === rgb(color)
  && JSON.stringify(state.tags) === JSON.stringify(tags);

export const themeColor = {
  id: 'theme-color',
  title: 'an installed window\'s title bar takes the theme the page is wearing, system or chosen',
  async run(page, t) {
    try {
      for (const width of [1280, 390]) {
        await load(page, '/#/home', { theme: 'system', scheme: 'dark', width });
        let state = await picked(page);
        t.check(`${width}px: on system with a dark system, the title bar takes the dark page background`,
          matches(state, DARK, OWN) && state.scheme === 'dark light' && state.attribute === null
          && JSON.stringify(state.media) === JSON.stringify(['(prefers-color-scheme: dark)', '(prefers-color-scheme: light)']),
          JSON.stringify(state));
        await system(page, 'light');
        await settle(page);
        state = await picked(page);
        t.check(`${width}px: a live change of the system setting turns it light, with nothing reloaded`,
          matches(state, LIGHT, OWN), JSON.stringify(state));
      }

      await load(page, '/#/data', { theme: 'system', scheme: 'dark' });
      await choose(page, 'light');
      let state = await picked(page);
      t.check('choosing Light in Settings on a dark system gives the title bar the light page background at once',
        matches(state, LIGHT, [LIGHT, LIGHT]) && state.scheme === 'light' && state.attribute === 'light',
        JSON.stringify(state));
      await system(page, 'light');
      await settle(page);
      const lightSystem = await picked(page);
      await system(page, 'dark');
      await settle(page);
      const darkSystem = await picked(page);
      t.check('a chosen theme holds whichever way the system setting then turns',
        matches(lightSystem, LIGHT, [LIGHT, LIGHT]) && matches(darkSystem, LIGHT, [LIGHT, LIGHT]),
        JSON.stringify({ lightSystem, darkSystem }));
      await system(page, 'light');
      await choose(page, 'dark');
      state = await picked(page);
      t.check('choosing Dark straight after Light, on a light system, gives the title bar the dark page background',
        matches(state, DARK, [DARK, DARK]) && state.scheme === 'dark' && state.attribute === 'dark',
        JSON.stringify(state));
      await choose(page, 'system');
      state = await picked(page);
      await system(page, 'dark');
      await settle(page);
      const followed = await picked(page);
      t.check('choosing System hands each tag back its own colour, and the title bar follows the system again',
        matches(state, LIGHT, OWN) && state.scheme === 'dark light' && state.attribute === null
        && matches(followed, DARK, OWN), JSON.stringify({ state, followed }));

      for (const [theme, scheme, color, tags] of [
        ['light', 'dark', LIGHT, [LIGHT, LIGHT]],
        ['dark', 'light', DARK, [DARK, DARK]],
        ['unexpected', 'light', LIGHT, OWN],
      ]) {
        await load(page, '/#/home', { theme, scheme });
        state = await picked(page);
        t.check(`a saved ${theme} theme on a ${scheme} system is worn by the title bar from the start of a fresh visit`,
          matches(state, color, tags), JSON.stringify(state));
        await load(page, '/open.html', { theme, scheme });
        state = await picked(page);
        t.check(`the launch page wears the same for a saved ${theme} theme on a ${scheme} system`,
          matches(state, color, tags), JSON.stringify(state));
      }
      await load(page, '/open.html', { theme: 'system', scheme: 'light' });
      await system(page, 'dark');
      await settle(page);
      state = await picked(page);
      t.check('on system the launch page follows a live change of the system setting too',
        matches(state, DARK, OWN), JSON.stringify(state));

      await load(page, '/#/home', { theme: 'light', scheme: 'dark' });
      page.__themeColorCdp ??= await page.createCDPSession();
      await page.__themeColorCdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
      await settle(page);
      const forced = await picked(page);
      t.check('forced colors leave the tags as the theme set them, so the browser decides its own frame',
        forced.color === LIGHT && JSON.stringify(forced.tags) === JSON.stringify([LIGHT, LIGHT]), JSON.stringify(forced));

      const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest', { cache: 'no-store' })).json());
      t.check('the manifest keeps its identity, scope, start address and colours',
        manifest.id === '/' && manifest.start_url === '/' && manifest.scope === '/'
        && manifest.theme_color === DARK && manifest.background_color === DARK, JSON.stringify(manifest));
    } finally {
      if (page.__themeColorCdp) await page.__themeColorCdp.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
      await page.emulateMediaFeatures([]).catch(() => {});
      await page.setViewport({ width: 1280, height: 900 });
    }
  },
};

// Each mutation breaks one part of the contract, and only the scenario above is aimed at.
export const themeColorMutations = [
  {
    id: 'theme-color-explicit-ignored', breaks: 'theme-color',
    why: 'a chosen theme leaves every tag on its own colour, so the title bar keeps following the system',
    rewriteTheme: (source) => source.replace(
      'return tags.map((tag) => (chosen ? chosen.color : tag.color));',
      'return tags.map((tag) => tag.color);',
    ),
  },
  {
    id: 'theme-color-original-lost', breaks: 'theme-color',
    why: 'the colour a tag was written with is not kept, so after one chosen theme the next takes the wrong colour',
    rewriteTheme: (source) => source.replace(
      'color: written.get(tag) }))',
      "color: tag.getAttribute('content') }))",
    ),
  },
  {
    id: 'theme-color-media-dropped', breaks: 'theme-color',
    why: 'the dark tag names no scheme, so as the first tag it wins on a light system too',
    // Handed to the page as source text, so it carries everything it needs inside it.
    script: () => {
      document.addEventListener('DOMContentLoaded', () => {
        document.querySelector('meta[name="theme-color"]')?.removeAttribute('media');
      });
    },
  },
];
