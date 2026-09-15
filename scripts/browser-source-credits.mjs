import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const cases = [
  ['catalog', 'catalog', 'x-men-age-of-x', 'Comic Book Herald'],
  ['spotlights', 'spotlights', 'agents-of-atlas-reading-order', 'Comic Book Herald'],
  ['marvel-on-screen', 'marvel-on-screen', 'doctor-strange-multiverse-of-madness', 'Comic Book Herald'],
  ['age-early-modern', 'age-early-modern', 'muir-island-saga', 'Comic Book Reading Orders'],
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
  title: 'reading-list sources are visible on cards, in Preview and in the footer',
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

    for (const [route, surface, id, site] of cases) {
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
      t.check(`${surface}: concise source and snapshot are visible without expanding`,
        source.visible && !source.disclosed && source.href === list.source
        && source.text.startsWith(`Source: ${site} · Snapshot taken `)
        && !source.text.includes('Section:'), JSON.stringify(source));
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
      t.check(`${surface}: Preview keeps full attribution and section visible`,
        preview.visible && preview.href === list.source && preview.text.includes(list.sourceOrigin)
        && (!list.sourceSection || preview.text.includes(`Section: ${list.sourceSection}`)), JSON.stringify(preview));
      await page.keyboard.press('Escape');
    }

    await page.goto(`${page.__origin}/#/catalog`, { waitUntil: 'load' });
    await page.waitForSelector('#catalog-results .catalog-card');
    for (const width of [1280, 640, 360]) {
      await page.setViewport({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const footer = document.querySelector('.app-footer');
        const links = [...footer.querySelectorAll('a')];
        const cardLink = document.querySelector('#catalog-results .result-source a');
        const fits = (node) => {
          const box = node.getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth && node.checkVisibility();
        };
        return {
          links: links.map((link) => ({ text: link.textContent, href: link.href, target: link.target, rel: link.rel })),
          fits: links.length === 3 && [...links, cardLink].every(fits),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      t.check(`${width}px: footer credits all external curators with safe links`,
        JSON.stringify(layout.links.map(({ text, href }) => [text, href])) === JSON.stringify([
          ['Comic Book Herald', 'https://www.comicbookherald.com/'],
          ['Comic Book Reading Orders', 'https://comicbookreadingorders.com/'],
          ['emreparker/marvel-comics', 'https://github.com/emreparker/marvel-comics'],
        ]) && layout.links.every((link) => link.target === '_blank' && link.rel === 'noopener noreferrer'),
        JSON.stringify(layout.links));
      t.check(`${width}px: source links wrap without horizontal overflow`,
        layout.fits && !layout.overflow, JSON.stringify(layout));
    }
  },
};
