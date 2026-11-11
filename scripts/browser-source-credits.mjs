import { readFileSync } from 'node:fs';
import { updatedLabel } from '../src/js/lib/catalog.js';

const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const cases = [
  ['catalog', 'catalog', 'x-men-age-of-x', 'Comic Book Herald'],
  ['spotlights', 'spotlights', 'agents-of-atlas-reading-order', 'Comic Book Herald'],
  ['marvel-on-screen', 'marvel-on-screen', 'doctor-strange-multiverse-of-madness', 'Comic Book Herald'],
  ['age-early-modern', 'age-early-modern', 'muir-island-saga', 'Comic Book Reading Orders'],
  ['catalog', 'catalog', 'one-world-under-doom', 'Comic Book Herald',
    'https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/one-world-under-doom/',
    'One World Under Doom Reading Order Checklist', 'Selected by raymond-nassar for Modern Timeline'],
  ['catalog', 'catalog', 'siege-dark-reign-prelude', 'Comic Book Herald',
    'https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/guide-part-13-siege-checklist/',
    'The Complete Issue by Issue Reading Order List', "Project-curated selection from Comic Book Herald's Dark Reign and Siege guides"],
  ['marvel-on-screen', 'marvel-on-screen', 'mcu-prep-shang-chi-and-the-legend-of-the-ten-rings', 'Comic Book Herald',
    'https://www.comicbookherald.com/shang-chi-master-of-kung-fu-reading-order/',
    'Latest Additions:', "Compiled for this project from the owner's selected Comic Book Herald excerpt"],
  ['marvel-on-screen', 'marvel-on-screen', 'mcu-prep-doctor-strange-2016', 'Comic Book Herald',
    'https://www.comicbookherald.com/the-best-comics-to-read-with-doctor-strange-multiverse-of-madness/',
    null, 'Selected by raymond-nassar for MCU Prep'],
];
const lists = cases.map(([, , id]) => {
  const list = catalog.lists.find((entry) => entry.id === id);
  if (!list) throw new Error(`Missing source credit fixture: ${id}`);
  return list;
});
const orders = Object.fromEntries(lists.map((list) => [
  list.file, JSON.parse(readFileSync(new URL(`../src/data/${list.file}`, import.meta.url), 'utf8')),
]));

export const sourceCredits = {
  id: 'source-credits',
  title: 'reading-list sources are visible on cards, in Preview and in About',
  async run(page, t) {
    await page.evaluateOnNewDocument((fixtureLists, fixtureOrders) => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname.endsWith('/catalog.json')) {
          return Promise.resolve(new Response(JSON.stringify({ lists: fixtureLists, paths: [] })));
        }
        const file = url.pathname.split('/').at(-1);
        if (Object.hasOwn(fixtureOrders, file)) {
          return Promise.resolve(new Response(JSON.stringify(fixtureOrders[file])));
        }
        return real(input, init);
      };
    }, lists, orders);

    for (const [route, surface, id, site, expectedUrl, expectedSection, expectedOrigin] of cases) {
      await page.goto(`${page.__origin}/#/${route}`, { waitUntil: 'load' });
      const card = `#${surface}-results [data-story="list:${id}"]`;
      await page.waitForSelector(card, { visible: true });
      const source = await page.$eval(`${card} .result-source`, (node) => ({
        text: node.textContent,
        href: node.querySelector('a')?.href,
        visible: node.querySelector('a')?.checkVisibility(),
        disclosed: Boolean(node.querySelector('details')),
      }));
      const list = lists.find((entry) => entry.id === id);
      t.check(`${surface}: concise source is visible without expanding, with the snapshot left to Preview`,
        source.visible && !source.disclosed && source.href === (expectedUrl ?? list.source)
        && source.text === `Source: ${site}`, JSON.stringify(source));
      await page.focus(`${card} .result-source a`);
      t.check(`${surface}: source is keyboard reachable`,
        await page.evaluate(() => document.activeElement.matches('.result-source a')));
      await page.$eval(`${card} [data-act="preview"]`, (button) => button.click());
      await page.waitForSelector('#preview[open]');
      const preview = await page.$eval('#preview-source', (node) => ({
        text: node.textContent,
        href: node.querySelector('a')?.href,
        visible: node.querySelector('a')?.checkVisibility(),
      }));
      t.check(`${surface}: Preview keeps full attribution, section and snapshot visible`,
        preview.visible && preview.href === (expectedUrl ?? list.source)
        && preview.text.includes(expectedOrigin ?? list.sourceOrigin)
        && (!(expectedSection ?? list.sourceSection) || preview.text.includes(`Section: ${expectedSection ?? list.sourceSection}`))
        && (expectedUrl == null || expectedSection !== null || !preview.text.includes('Section:'))
        && preview.text.includes(`Snapshot taken ${updatedLabel(list)}`), JSON.stringify(preview));
      if (expectedUrl) {
        const checkVisit = async (about, surfaceName) => {
          for (const width of [1280, 390]) {
            await page.setViewport({ width, height: 900 });
            const visit = await page.$eval(about, (node) => {
              const link = node.querySelector('.list-source-link');
              const box = link?.getBoundingClientRect();
              return {
                open: node.open, visible: link?.checkVisibility(),
                text: link?.textContent, href: link?.href,
                target: link?.target, rel: link?.rel,
                fits: box && box.left >= 0 && box.right <= innerWidth,
              };
            });
            t.check(`${id}: ${surfaceName} at ${width}px shows Visit Comic Book Herald`,
              visit.open && visit.visible && visit.fits
              && visit.text === 'Visit Comic Book Herald' && visit.href === expectedUrl
              && visit.target === '_blank' && visit.rel === 'noopener noreferrer',
              JSON.stringify(visit));
          }
        };
        await checkVisit('#preview-about', 'Preview About');
        await page.$eval('#preview-add button[data-act="main"]', (button) => button.click());
        await page.waitForSelector('#preview-add a[data-act="main"]');
        await page.$eval('#preview-add a[data-act="main"]', (link) => link.click());
        await page.waitForSelector('#view-read:not([hidden]) #order-source .list-source-link');
        await checkVisit('#order-desc', 'saved-list About');
        continue;
      }
      await page.keyboard.press('Escape');
    }

    await page.goto(`${page.__origin}/#/catalog`, { waitUntil: 'load' });
    await page.waitForSelector('#catalog-results .catalog-card');
    for (const width of [1280, 640, 360]) {
      await page.setViewport({ width, height: 900 });
      t.check(`${width}px: card source remains visible without horizontal clipping`,
        await page.$eval('#catalog-results .result-source a', (node) => {
          const box = node.getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth && node.checkVisibility();
        }));
      await page.$eval('.app-footer [data-view="about"]', (button) => button.click());
      await page.waitForSelector('#view-about:not([hidden])');
      const layout = await page.evaluate(() => {
        const footer = document.querySelector('.app-footer');
        const about = document.querySelector('#view-about');
        const links = [
          'https://www.comicbookherald.com/',
          'https://comicbookreadingorders.com/',
          'https://github.com/emreparker/marvel-comics',
        ].map((href) => [...about.querySelectorAll('a')].find((link) => link.href === href)).filter(Boolean);
        const fits = (node) => {
          const box = node.getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth && node.checkVisibility();
        };
        return {
          links: links.map((link) => ({ text: link.textContent, href: link.href, target: link.target, rel: link.rel })),
          text: footer.textContent.replace(/\s+/g, ' ').trim(),
          expected: `Unofficial fan project. Metadata and links only. \u00a9 ${new Date().getFullYear()} MARVEL`,
          fits: links.length === 3 && links.every(fits),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      t.check(`${width}px: footer has only the short attribution and opens About`,
        layout.text === layout.expected && await page.$eval('#about-h', (node) => document.activeElement === node),
        JSON.stringify(layout));
      t.check(`${width}px: About credits all external providers with safe links`,
        JSON.stringify(layout.links.map(({ text, href }) => [text, href])) === JSON.stringify([
          ['Comic Book Herald', 'https://www.comicbookherald.com/'],
          ['Comic Book Reading Orders', 'https://comicbookreadingorders.com/'],
          ['emreparker/marvel-comics', 'https://github.com/emreparker/marvel-comics'],
        ]) && layout.links.every((link) => link.target === '_blank' && link.rel === 'noopener noreferrer'),
        JSON.stringify(layout.links));
      t.check(`${width}px: source links wrap without horizontal overflow`,
        layout.fits && !layout.overflow, JSON.stringify(layout));
      await page.evaluate(() => { location.hash = '#/catalog'; });
      await page.waitForSelector('#catalog-results .catalog-card', { visible: true });
    }

    // Source checkouts omit the unbroken revision that expanded the packaged About page.
    const buildLabel = 'android 3000002; development; source 2997ac444933e92250d1e7910d8f8dddc55e7b21.';
    const profiles = [
      { width: 360, body: 24, theme: 'light' },
      { width: 320, body: 32, theme: 'dark' },
      { width: 412, body: 24, theme: 'system' },
      { width: 1280, body: 14, theme: 'dark', desktop: true },
    ];
    for (const profile of profiles) {
      const label = `About ${profile.width}px/${profile.body}px ${profile.theme}`;
      await page.setViewport({ width: profile.width, height: 900, isMobile: !profile.desktop });
      await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: 'light' },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ]);
      await page.goto(`${page.__origin}/?about-reflow=${profile.width}#/about`, { waitUntil: 'load' });
      await page.waitForSelector('#view-about:not([hidden])');
      await page.evaluate(({ body, theme, desktop }, buildLabel) => {
        const root = document.documentElement;
        root.removeAttribute('style');
        if (theme === 'system') root.removeAttribute('data-theme');
        else root.dataset.theme = theme;
        const ramp = desktop ? [12, 14, 18, 20, 28, 40] : [14, 16, 18, 20, 28, 32];
        const names = ['--t-caption', '--t-body', '--t-body-lg', '--t-subtitle', '--t-title', '--t-title-lg'];
        names.forEach((name, index) => root.style.setProperty(name, `${ramp[index] * body / ramp[1]}px`));
        document.querySelector('#about-build').textContent = buildLabel;
        document.querySelector('#view-about details').open = false;
      }, profile, buildLabel);
      await page.evaluate(() => document.fonts.ready);

      for (const expanded of [false, true]) {
        if (expanded) {
          await page.focus('#view-about summary');
          await page.keyboard.press('Enter');
        }
        const geometry = await page.evaluate(() => {
          const root = document.documentElement, about = document.querySelector('#view-about');
          const viewport = visualViewport, clipped = [];
          const walker = document.createTreeWalker(about, NodeFilter.SHOW_TEXT);
          let ranges = 0;
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.textContent.trim() || !node.parentElement.checkVisibility()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const box of range.getClientRects()) {
              if (!box.width || !box.height) continue;
              ranges++;
              if (box.left < viewport.offsetLeft - 1 || box.right > viewport.offsetLeft + viewport.width + 1) {
                clipped.push(node.textContent.trim().slice(0, 80));
              }
              for (let parent = node.parentElement; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent), edge = parent.getBoundingClientRect();
                if (/(hidden|clip)/.test(style.overflowX) && (box.left < edge.left - 1 || box.right > edge.right + 1)) {
                  clipped.push(`clipping ancestor: ${parent.tagName}`);
                }
              }
            }
          }
          return {
            root: root.clientWidth, scroll: root.scrollWidth, inner: innerWidth,
            visual: viewport.width, scale: viewport.scale, ranges, clipped,
            body: parseFloat(getComputedStyle(document.body).fontSize),
            build: document.querySelector('#about-build').textContent,
            open: about.querySelector('details').open,
            rows: about.querySelectorAll('.keys tr').length,
            rootOverflow: getComputedStyle(root).overflowX,
            bodyOverflow: getComputedStyle(document.body).overflowX,
          };
        });
        t.check(`${label}, disclosure ${expanded ? 'open' : 'closed'}: requested viewport and text size retained`,
          geometry.root === profile.width && Math.abs(geometry.visual - profile.width) <= 1
          && geometry.scale === 1 && geometry.body === profile.body && geometry.open === expanded,
          JSON.stringify(geometry));
        t.check(`${label}, disclosure ${expanded ? 'open' : 'closed'}: all About text fits without root clipping`,
          geometry.scroll <= geometry.root + 1 && geometry.inner === geometry.root
          && geometry.ranges > 20 && geometry.clipped.length === 0
          && !/(hidden|clip)/.test(geometry.rootOverflow) && !/(hidden|clip)/.test(geometry.bodyOverflow)
          && geometry.build === buildLabel && geometry.rows === 3, JSON.stringify(geometry));
      }
      await page.focus('#view-about a');
      t.check(`${label}: provider link keeps keyboard focus and its indicator`,
        await page.$eval('#view-about a', (node) => document.activeElement === node
          && node.matches(':focus-visible') && getComputedStyle(node).outlineStyle !== 'none'));
    }
  },
};
