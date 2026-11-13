import { readFileSync } from 'node:fs';
import { createEmptyState, createList, addIssuesToList, exportBackup } from '../src/js/lib/model.js';
import { editionEvidence } from '../src/js/lib/collectedEditions.js';

const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const ids = ['civil-war-avengers', 'nebula-reading-order', 'avengers-doomsday-secret-wars', 'realm-of-kings', 'the-unbeatable-squirrel-girl'];
const lists = catalog.lists.filter((list) => ids.includes(list.id));
if (lists.length !== 5) throw new Error('Collected-edition browser fixtures require all five pilot lists');
const orders = Object.fromEntries(lists.map((list) => [list.file,
  JSON.parse(readFileSync(new URL(`../src/data/${list.file}`, import.meta.url), 'utf8'))]));
let state = createEmptyState();
for (const list of lists) {
  state = createList(state, { id: `edition-${list.id}`, name: list.name, catalogId: list.id });
  state = addIssuesToList(state, `edition-${list.id}`, orders[list.file].items).state;
}
const seed = exportBackup(state);
const click = (page, selector) => page.$eval(selector, (node) => node.click());

export const collectedEditions = {
  id: 'collected-editions',
  title: 'verified issue labels and permission-gated book destinations in Preview and saved lists',
  async run(page, t) {
    const external = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== page.__origin) external.push(request.url());
    });
    await page.evaluateOnNewDocument((saved, chosen, fixtureOrders) => {
      localStorage.setItem('mrt.state.v2', JSON.stringify(saved));
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      window.__mrtBlockExternal = true;
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname.endsWith('/catalog.json')) return Promise.resolve(new Response(JSON.stringify({ lists: chosen, paths: [] })));
        const file = url.pathname.split('/').at(-1);
        if (fixtureOrders[file]) return Promise.resolve(new Response(JSON.stringify(fixtureOrders[file])));
        return real(input, init);
      };
    }, seed, lists, orders);

    for (const list of lists) {
      const expected = editionEvidence.relations.filter((relation) => relation.catalogId === list.id);
      await page.goto(`${page.__origin}/#/preview/${list.id}`, { waitUntil: 'load' });
      await page.waitForSelector('#preview[open] .preview-list li');
      const before = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
      t.check(`${list.id}: Preview labels exactly the eligible issue count`,
        await page.$$eval('#preview .collected-edition', (nodes) => nodes.length) === expected.length);
      t.check(`${list.id}: Preview shows credit exactly when relations are displayed`,
        await page.$$eval('#preview .edition-credit', (nodes) => nodes.length) === (expected.length ? 1 : 0));
      await page.keyboard.press('Escape');
      await page.evaluate((id) => { location.hash = `#/read/edition-${id}`; }, list.id);
      await page.waitForSelector('#view-read:not([hidden])');
      await page.evaluate(() => { document.querySelector('#full').open = true; });
      await page.waitForSelector('#rows .row');
      t.check(`${list.id}: saved list labels match Preview`,
        await page.$$eval('#rows .collected-edition', (nodes) => nodes.length) === expected.length);
      t.check(`${list.id}: saved list has one shared credit, not a row of repeated links`,
        await page.$$eval('#rows .edition-credit', (nodes) => nodes.length) === (expected.length ? 1 : 0));
      if (expected.length) {
        for (const index of [0, 1]) {
          const retained = await page.evaluate((index) => {
            const link = document.querySelectorAll('#rows .edition-credit a')[index];
            link.focus();
            const focused = document.activeElement === link;
            window.dispatchEvent(new Event('focus'));
            return focused && link.isConnected && document.activeElement === link;
          }, index);
          t.check(`${list.id}: credit link ${index + 1} retains the same focused element after window focus`, retained);
        }
      }
      // Route traversal may change the active list, but rendering must not change its contents.
      const changed = await page.evaluate((snapshot) => {
        const a = JSON.parse(snapshot), b = JSON.parse(localStorage.getItem('mrt.state.v2'));
        return JSON.stringify(a.issues) !== JSON.stringify(b.issues)
          || JSON.stringify(a.lists) !== JSON.stringify(b.lists);
      }, before);
      t.check(`${list.id}: inspecting labels preserves saved comics and custom headings`, !changed);
    }

    const list = lists.find((entry) => entry.id === 'civil-war-avengers');
    for (const profile of [
      { width: 1280, forced: false, large: false, theme: 'light' },
      { width: 390, forced: false, large: true, theme: 'dark' },
      { width: 1280, forced: true, large: true, theme: 'system' },
      { width: 390, forced: true, large: true, theme: 'system' },
    ]) {
      await page.setViewport({ width: profile.width, height: 900 });
      const cdp = await page.createCDPSession();
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: profile.forced ? 'active' : 'none' }] });
      for (const surface of ['preview', 'saved']) {
        const root = surface === 'preview' ? '#preview' : '#rows';
        await page.goto(`${page.__origin}/#/${surface === 'preview' ? `preview/${list.id}` : `read/edition-${list.id}`}`, { waitUntil: 'load' });
        if (surface === 'saved') {
          await page.waitForSelector('#view-read:not([hidden])');
          await page.evaluate(() => { document.querySelector('#full').open = true; });
        }
        await page.waitForSelector(`${root} .collected-edition`);
        await page.evaluate(({ large, theme }) => {
          document.documentElement.removeAttribute('style');
          document.documentElement.dataset.theme = theme;
          if (large) for (const name of ['--t-caption', '--t-body', '--t-body-lg', '--t-subtitle', '--t-title', '--t-title-lg']) {
            const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
            document.documentElement.style.setProperty(name, `${value * 2}px`);
          }
        }, profile);
        const result = await page.$eval(root, (container) => {
          const labels = [...container.querySelectorAll('.collected-edition')];
          return {
            count: labels.length,
            fits: labels.every((node) => {
              const rect = node.getBoundingClientRect();
              return rect.left >= 0 && rect.right <= innerWidth && node.scrollWidth <= node.clientWidth + 1;
            }),
            rowStops: labels.some((node) => node.querySelector('a,button,[tabindex]')),
            issue: labels.every((node) => node.closest('li')?.querySelector('[data-issue-id]')),
            credit: container.querySelectorAll('.edition-credit a').length,
            bodyOverflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        const name = `${surface} ${profile.width}px forced=${profile.forced} large=${profile.large}`;
        t.check(`${name}: all 13 labels wrap with their issues and no row tab stop`,
          result.count === 13 && result.fits && !result.rowStops && result.issue && !result.bodyOverflow, JSON.stringify(result));
        t.check(`${name}: required credit retains both licence/source links`, result.credit === 2);
        const ax = await cdp.send('Accessibility.getFullAXTree');
        t.check(`${name}: label text is exposed in the accessibility tree`,
          ax.nodes.some((node) => node.name?.value === 'Collected in Civil War'));
        const policyResult = await page.evaluate(async (root) => {
          const { collectedEditionLabels } = await import('./js/views/shared/collected-editions.js');
          const make = (tag, props, children = []) => {
            const node = document.createElement(tag);
            for (const [key, value] of Object.entries(props)) {
              if (key === 'text') node.textContent = value;
              else if (key === 'class') node.className = value;
              else node.setAttribute(key, value);
            }
            node.append(...[].concat(children));
            return node;
          };
          const issue = { issueId: 7, seriesId: 8, number: '1' };
          const evidence = { relations: [{ ...issue, catalogId: 'fixture', editionId: 'book',
            status: 'verified', portion: 'full', conflicts: [], source: 'fixture', checkedAt: '2026-11-10' }] };
          const catalog = { providers: {
            hoopla: { name: 'Hoopla', basis: 'owner-approval',
              basisEvidence: 'https://github.com/raymond-nassar/recap-page/issues/1203#issuecomment-6839342560' },
            libby: { name: 'Libby', basis: 'owner-approval',
              basisEvidence: 'https://github.com/raymond-nassar/recap-page/issues/1203#issuecomment-6839342560' } },
          editions: { book: { title: 'Stand-in book', destinations: [
            { provider: 'hoopla', checkedAt: '2026-11-12', url: 'https://www.hoopladigital.com/title/123456789' },
            { provider: 'libby', checkedAt: '2026-11-12', url: 'https://share.libbyapp.com/title/123456' }] } } };
          const unconfirmed = collectedEditionLabels(make, 'fixture', issue, catalog, evidence);
          const hidden = unconfirmed.querySelectorAll('a').length === 0;
          for (const destination of catalog.editions.book.destinations) destination.confirmedBy = 'owner';
          const shown = collectedEditionLabels(make, 'fixture', issue, catalog, evidence);
          const host = document.querySelector(`${root} .collected-editions`);
          host.append(shown);
          const links = [...shown.querySelectorAll('a')];
          links[1].focus();
          const rects = links.map((link) => link.getBoundingClientRect());
          const result = { hidden, count: links.length, focused: document.activeElement === links[1],
            targets: links.map((link) => link.target), rels: links.map((link) => link.rel),
            texts: links.map((link) => link.textContent), names: links.map((link) => link.getAttribute('aria-label')),
            fits: rects.every((rect) => rect.width <= host.clientWidth + 1),
            height: Math.min(...rects.map((rect) => rect.height)) };
          shown.remove();
          return result;
        }, root);
        t.check(`${name}: only owner-confirmed stand-in destinations expose accessible hedged book links`,
          policyResult.hidden && policyResult.count === 2 && policyResult.focused
          && policyResult.targets.every((target) => target === '_blank')
          && policyResult.rels.every((rel) => rel === 'noopener noreferrer')
          && policyResult.texts.join('|') === 'Look for this book on Hoopla|Look for this book in Libby'
          && policyResult.names.every((label) => label.includes('Stand-in book') && label.includes('opens outside'))
          && policyResult.fits && policyResult.height >= 24,
          JSON.stringify(policyResult));
        if (surface === 'preview') await page.keyboard.press('Escape');
      }
      await cdp.detach();
    }
    t.check('edition display makes no external network requests', external.length === 0, JSON.stringify(external));
    t.check('production DOM shows only owner-confirmed provider addresses from the bundled catalog',
      await page.evaluate(async () => {
        const { editionCatalog } = await import('./data/collectedEditionCatalog.js');
        const allowed = new Set(Object.values(editionCatalog.editions).flatMap((book) => book.destinations)
          .filter((destination) => destination.confirmedBy === 'owner').map((destination) => destination.url));
        return [...document.querySelectorAll('a[href*="hoopladigital"], a[href*="libbyapp"]')]
          .every((link) => allowed.has(link.href));
      }));
    await click(page, '.brand[data-view="home"]');
  },
};
