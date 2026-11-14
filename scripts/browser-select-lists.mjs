// #1298: an open dropdown list on Windows was unreadable in dark mode, near white text on a white
// list. The list Edge draws is not part of the page, so no check can screenshot it. It is painted
// from what the page can see, though: the select's own background, measured while the pointer is on
// it, as it is the moment it is clicked, and each option's colours. A translucent hover background
// was composited onto the list's white canvas while the options kept the dark theme's light text.
// So the contract is that every option carries an opaque background with readable text, and that a
// hovered select keeps an opaque background, in every pairing of a saved theme with the system one.
const ROUTES = ['/#/data', '/#/catalog', '/#/marvel-on-screen', '/#/genres', '/#/library-rated', '/#/add-search'];
const COMBINATIONS = [
  { theme: 'dark', scheme: 'light', expected: 'dark' },
  { theme: 'dark', scheme: 'dark', expected: 'dark' },
  { theme: 'light', scheme: 'dark', expected: 'light' },
  { theme: 'light', scheme: 'light', expected: 'light' },
  { theme: 'system', scheme: 'dark', expected: 'dark' },
  { theme: 'system', scheme: 'light', expected: 'light' },
];
const system = (page, scheme) => page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

async function load(page, { theme, scheme }) {
  await page.setViewport({ width: 1280, height: 900 });
  await system(page, scheme);
  await page.goto('about:blank');
  const { identifier } = await page.evaluateOnNewDocument((value) => {
    try { localStorage.setItem('mrt.settings', JSON.stringify({ theme: value })); } catch { /* about:blank */ }
  }, theme);
  await page.goto(`${page.__origin}/#/home`, { waitUntil: 'load' });
  await page.removeScriptToEvaluateOnNewDocument(identifier);
  await settle(page);
}

// Every colour is resolved by painting it, so rgb(), color-mix() and color() all measure alike, and a
// translucent foreground is measured over the background it is drawn on.
function measure(page, hoveredId = null) {
  return page.evaluate((hovered) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const paint = (...colors) => {
      context.clearRect(0, 0, 1, 1);
      for (const color of colors) { context.fillStyle = color; context.fillRect(0, 0, 1, 1); }
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const luminance = (rgb) => {
      const [r, g, b] = rgb.slice(0, 3).map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a, b) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
    };
    const selects = [...document.querySelectorAll('select')];
    return {
      scheme: getComputedStyle(document.documentElement).colorScheme,
      hovered: hovered ? (() => {
        const select = document.getElementById(hovered);
        return { id: hovered, matches: select.matches(':hover'), alpha: paint(getComputedStyle(select).backgroundColor)[3] };
      })() : null,
      options: selects.flatMap((select) => [...select.options].map((option) => {
        const style = getComputedStyle(option);
        const background = paint(style.backgroundColor);
        const text = paint(style.backgroundColor, style.color);
        return {
          select: select.id || select.name,
          option: option.textContent.trim().slice(0, 40),
          disabled: option.disabled,
          alpha: background[3],
          contrast: contrast(background, text),
        };
      })),
    };
  }, hoveredId);
}

export const selectLists = {
  id: 'select-lists',
  title: 'every dropdown list stays readable in every saved theme against every system theme',
  async run(page, t) {
    try {
      for (const combination of COMBINATIONS) {
        await load(page, combination);
        const label = `${combination.theme} theme on a ${combination.scheme} system`;
        const options = new Map();
        const hovered = [];
        let scheme = null;
        for (const route of ROUTES) {
          await page.evaluate((hash) => { location.hash = hash; }, route.slice(1));
          await page.waitForFunction((view) => document.querySelector(`#view-${view}`)
            && !document.querySelector(`#view-${view}`).hidden, { timeout: 15000 }, route.slice(3));
          await settle(page);
          const visible = await page.evaluate(() => [...document.querySelectorAll('select')]
            .filter((select) => select.id && select.getClientRects().length && !select.disabled)
            .map((select) => select.id));
          for (const id of visible) {
            await page.hover(`#${id}`);
            await settle(page);
            const state = await measure(page, id);
            hovered.push(state.hovered);
            await page.mouse.move(0, 0);
          }
          const state = await measure(page);
          scheme = state.scheme;
          for (const option of state.options) options.set(`${option.select}|${option.option}`, option);
        }
        const all = [...options.values()];
        const selects = new Set(all.map((option) => option.select));
        t.check(`${label}: the page wears the ${combination.expected} colour scheme, which the native list follows`,
          scheme === combination.expected, scheme);
        t.check(`${label}: the dropdowns on Settings, Modern Timeline, MCU Prep, Genres and ratings are all measured`,
          ['opt-theme', 'catalog-path', 'rated-min', 'rated-character', 'rated-sort', 'marvel-on-screen-sort', 'genres-type', 'genres-tone']
            .every((id) => selects.has(id)) && selects.size >= 8, JSON.stringify([...selects]));
        t.check(`${label}: every option is painted on an opaque background, not the list's own canvas`,
          all.length > 0 && all.every((option) => option.alpha === 255),
          JSON.stringify(all.filter((option) => option.alpha !== 255).slice(0, 6)));
        t.check(`${label}: every available option reads at 4.5:1 or better against its background`,
          all.filter((option) => !option.disabled).every((option) => option.contrast >= 4.5),
          JSON.stringify(all.filter((option) => !option.disabled && option.contrast < 4.5).slice(0, 6)));
        t.check(`${label}: a hovered select keeps an opaque background for the list to open on`,
          hovered.length >= 2 && hovered.every((entry) => entry.matches && entry.alpha === 255),
          JSON.stringify(hovered));
      }

      await load(page, { theme: 'dark', scheme: 'light' });
      page.__selectListsCdp ??= await page.createCDPSession();
      await page.__selectListsCdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
      await page.evaluate(() => { location.hash = '/data'; });
      await page.waitForFunction(() => !document.querySelector('#view-data').hidden);
      await settle(page);
      const forced = await page.evaluate(() => {
        const option = document.querySelector('#opt-theme option');
        const probe = document.createElement('span');
        probe.style.color = 'CanvasText';
        probe.style.backgroundColor = 'Canvas';
        document.body.append(probe);
        const system = getComputedStyle(probe);
        const result = {
          forced: matchMedia('(forced-colors: active)').matches,
          color: getComputedStyle(option).color,
          background: getComputedStyle(option).backgroundColor,
          canvasText: system.color,
          canvas: system.backgroundColor,
        };
        probe.remove();
        return result;
      });
      t.check('forced colors replace the option colours with the system pair',
        forced.forced && forced.color === forced.canvasText && forced.background === forced.canvas,
        JSON.stringify(forced));
    } finally {
      if (page.__selectListsCdp) await page.__selectListsCdp.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
      await page.emulateMediaFeatures([]).catch(() => {});
      await page.setViewport({ width: 1280, height: 900 });
    }
  },
};

// Each mutation removes one half of the fix, and only the scenario above is aimed at.
export const selectListsMutations = [
  {
    id: 'select-lists-option-transparent', breaks: 'select-lists',
    why: 'options lose their own background, so the list is painted on the platform canvas',
    rewriteStyles: (source) => source.replace(
      'select option, select optgroup { background-color: var(--card-2);',
      'select option, select optgroup { background-color: transparent;',
    ),
  },
  {
    id: 'select-lists-hover-translucent', breaks: 'select-lists',
    why: 'a hovered select goes back to a translucent tint, which the open list is composited from',
    rewriteStyles: (source) => source.replace(
      'background-color: color-mix(in srgb, rgb(var(--tint-base)) 5.098%, var(--card-2)); }',
      'background-color: rgb(var(--tint-base) / 5.098%); }',
    ),
  },
];
