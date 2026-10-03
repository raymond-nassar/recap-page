import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStaticServer } from '../server.mjs';
import { prepareAndroid } from './prepare-android.mjs';
import { createEmptyState, createList, addIssuesToList, markRead } from '../src/js/lib/model.js';
import { KEY } from '../src/js/storage.js';
import { SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE } from '../src/js/lib/saveEducation.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const driver = process.env.MRT_PUPPETEER || join(homedir(), '.mrt-scratch', 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js');
const edge = process.env.MRT_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
assert.ok(existsSync(driver) && existsSync(edge), 'Use installed Edge and the external puppeteer-core driver, not a repository dependency.');
const puppeteer = (await import(pathToFileURL(driver).href)).default;
const catalog = JSON.parse(await readFile(join(root, 'src', 'data', 'catalog.json'), 'utf8'));
const entry = catalog.lists.find((list) => list.id === 'house-of-m');
assert.ok(entry, 'The canonical House of M fixture is required.');
const order = JSON.parse(await readFile(join(root, 'src', 'data', entry.file), 'utf8'));
const listId = 'screen-assessment-house-of-m';
let fixture = createList(createEmptyState(), {
  id: listId, name: order.name, description: order.description, catalogId: entry.id,
});
fixture = addIssuesToList(fixture, listId, order.items).state;
for (const item of order.items.slice(0, 2)) fixture = markRead(fixture, item.issueId, true, 1790985600000);
const issueId = order.items[2].issueId;
const profiles = [
  { id: 'desktop', width: 1280, height: 900, android: false },
  { id: 'phone', width: 390, height: 844, android: false },
  { id: 'android', width: 390, height: 844, android: true },
  { id: 'large-text', width: 320, height: 740, android: true, textScale: 2 },
];
const profileArg = process.argv.find((arg) => arg.startsWith('--profile='))?.slice('--profile='.length);
const caseArg = process.argv.find((arg) => arg.startsWith('--case='))?.slice('--case='.length);
const cases = ['reading', 'details', 'adding', 'timeline', 'settings'];
const profileIds = profileArg?.split(',');
const selectedCases = caseArg === undefined ? cases : caseArg.split(',');
assert.ok(!profileIds || profileIds.every((id) => profiles.some((profile) => profile.id === id)), 'Unknown reader-first profile.');
assert.ok(selectedCases.every((id) => cases.includes(id)), 'Unknown reader-first case.');
const selectedProfiles = profileIds ? profiles.filter((profile) => profileIds.includes(profile.id)) : profiles;
const output = process.env.MRT_READER_FIRST_OUTPUT;
const screenshots = process.env.MRT_READER_FIRST_SCREENSHOTS;
if (screenshots) await mkdir(screenshots, { recursive: true });
const evidence = { profiles: [], checks: 0, failures: [], pageErrors: [], unexpectedRequests: [] };

function check(condition, message, detail) {
  evidence.checks += 1;
  if (!condition) evidence.failures.push({ message, detail });
}

const shared = createStaticServer();
await new Promise((done) => shared.listen(0, '127.0.0.1', done));
const sharedOrigin = `http://127.0.0.1:${shared.address().port}`;
let android;
let androidOrigin;
let browser;
try {
  if (selectedProfiles.some((profile) => profile.android)) {
    const prepared = await prepareAndroid();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
    android = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        if (pathname === prepared.config.health.path) {
          response.writeHead(204, prepared.config.health.headers).end();
          return;
        }
        const target = resolve(prepared.directory, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
        if (!target.startsWith(prepared.directory + sep)) {
          response.writeHead(403).end('Outside assets');
          return;
        }
        const content = await readFile(target);
        response.writeHead(200, {
          ...prepared.config.securityHeaders,
          'content-type': types[extname(target)] || 'application/octet-stream',
          'cache-control': 'no-store',
        }).end(content);
      } catch (error) {
        if (error.code === 'ENOENT') response.writeHead(404).end('Not found');
        else {
          evidence.pageErrors.push(String(error));
          response.writeHead(500).end('Fixture server failed');
        }
      }
    });
    await new Promise((done) => android.listen(0, '127.0.0.1', done));
    androidOrigin = `http://127.0.0.1:${android.address().port}`;
  }
  browser = await puppeteer.launch({
    executablePath: edge, headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  async function click(page, selector) {
    await page.waitForSelector(selector, { visible: true });
    await page.$eval(selector, (node) => node.click());
  }

  for (const profile of selectedProfiles) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: profile.width, height: profile.height });
    page.on('pageerror', (error) => evidence.pageErrors.push(`${profile.id}: ${String(error)}`));
    await page.evaluateOnNewDocument((state, key, educationKey, education, title) => {
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem(educationKey, education);
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, theme: 'light' }));
      window.__readerFirst = { unexpected: [], searches: 0 };
      const original = window.fetch.bind(window);
      window.fetch = (input, options) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.origin === location.origin) return original(input, options);
        const json = (value) => Promise.resolve(new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json' },
        }));
        if (url.pathname.endsWith('/health')) return json({ status: 'ok' });
        if (url.pathname.endsWith('/search/issues')) {
          window.__readerFirst.searches += 1;
          return json({ items: [], total: 0 });
        }
        const id = /^\/v1\/issues\/(\d+)$/.exec(url.pathname)?.[1];
        if (id && state.issues[id]) return json(state.issues[id]);
        window.__readerFirst.unexpected.push(url.href);
        return Promise.reject(new Error(`${title}: unexpected request ${url.href}`));
      };
    }, fixture, KEY, SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE.COMPLETE, profile.id);
    const origin = profile.android ? androidOrigin : sharedOrigin;
    const result = { id: profile.id, width: profile.width, height: profile.height, textScale: profile.textScale || 1, screens: [] };
    evidence.profiles.push(result);
    const prefix = (message) => `${profile.id}: ${message}`;

    async function load(view, hash = `#/${view}`) {
      await page.goto(`${origin}/index.html${hash}`, { waitUntil: 'load' });
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector(`#view-${view}:not([hidden])`);
      if (view === 'read') await page.waitForSelector('#hero:not([hidden])');
      if (view === 'issue') await page.waitForSelector('#issue-focus-card:not([hidden])');
      if (view === 'catalog') await page.waitForSelector('#modern-timeline-feature');
      if (profile.textScale) {
        await page.evaluate((scale) => {
          for (const name of ['--t-caption', '--t-body', '--t-body-lg', '--t-subtitle', '--t-title', '--t-title-lg']) {
            const size = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
            document.documentElement.style.setProperty(name, `${size * scale}px`);
          }
        }, profile.textScale);
      }
      await page.evaluate(() => scrollTo(0, 0));
    }

    async function capture(view, controls) {
      const snapshot = await page.evaluate((ids) => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        overflowElements: [...document.querySelectorAll('.view:not([hidden]) *')]
          .filter((node) => node.checkVisibility() && node.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 8).map((node) => ({
            tag: node.tagName, id: node.id, class: node.className, text: node.textContent.slice(0, 80),
            right: node.getBoundingClientRect().right,
          })),
        controls: ids.map((id) => {
          const node = document.querySelector(id);
          const { x, y, width, height, bottom, right } = node.getBoundingClientRect();
          return { id, text: node.textContent.trim(), x, y, width, height, bottom, right };
        }),
      }), controls);
      check(!snapshot.overflow, prefix(`${view} has no document overflow`), snapshot);
      for (const control of snapshot.controls) {
        check(control.width > 0 && control.x >= -1 && control.right <= profile.width + 1,
          prefix(`${control.id} fits horizontally`), control);
        if (profile.width <= 700) check(control.height >= 48, prefix(`${control.id} has a 48px target`), control);
      }
      result.screens.push({ view, ...snapshot });
      if (screenshots && profile.id === 'android') {
        await page.screenshot({ path: join(screenshots, `reader-first-after-${view}.png`) });
      }
      return snapshot;
    }

    if (selectedCases.includes('reading')) {
      await load('read', `#/read/${listId}`);
      const geometry = await capture('read', ['#btn-hero-read', '#btn-hero-done', '#btn-hero-inspect', '#hero-more-actions > summary']);
      if (profile.height === 844) {
        check(geometry.controls.slice(0, 2).every((node) => node.y >= 0 && node.bottom <= profile.height),
          prefix('Read and Done are fully in the first viewport'), geometry);
      }
      check(await page.$eval('#hero-more-actions', (node) => !node.open), prefix('comic options start closed'));
      check(await page.$eval('#btn-hero-defer', (node) => !node.checkVisibility()), prefix('closed options hide Defer'));
      await click(page, '#btn-hero-done');
      await page.waitForFunction((id) => JSON.parse(localStorage.getItem('mrt.state.v2')).read[id] != null, {}, issueId);
      await click(page, '#hero-more-actions > summary');
      await click(page, '#btn-hero-defer');
      const changed = await page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')));
      check(changed.read[issueId] != null && changed.lists[listId].deferredIssueIds.length === 1,
        prefix('Done marks read and Defer changes only the queue'));
      await page.evaluate((state, key) => {
        for (const id of state.lists[state.active].itemIds) state.read[id] = 1790985600000;
        const oldValue = localStorage.getItem(key);
        const newValue = JSON.stringify(state);
        localStorage.setItem(key, newValue);
        dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue }));
      }, fixture, KEY);
      await page.waitForSelector('#all-read:not([hidden])');
      await click(page, '#all-read [data-view="browse"]');
      await page.waitForSelector('#view-browse:not([hidden])');
      check(true, prefix('finished-list Browse opens discovery'));
    }

    if (selectedCases.includes('details')) {
      await load('issue', `#/issue/${issueId}?list=${listId}`);
      const geometry = await capture('issue', ['#btn-issue-read', '#reader-link-heading']);
      if (profile.height === 844) {
        check(geometry.controls[0].y >= 0 && geometry.controls[0].bottom <= profile.height,
          prefix('comic-details Read is fully in the first viewport'), geometry);
      }
      const before = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
      check(await page.$eval('#reader-link-help', (node) => !node.open), prefix('troubleshooting starts closed'));
      check(await page.$eval('#reader-link-edit', (node) => !node.checkVisibility()), prefix('technical controls are not rendered while closed'));
      check(await page.evaluate(() => {
        const availability = document.querySelector('#issue-focus-availability');
        return !availability.checkVisibility() && availability.textContent.includes('In Unlimited')
          && !document.querySelector('#issue-focus-facts').textContent.includes('In Unlimited');
      }), prefix('availability is retained in closed troubleshooting, not the main facts'));
      await click(page, '#reader-link-heading');
      check(await page.$eval('#issue-focus-availability', (node) => node.checkVisibility()),
        prefix('availability becomes readable when troubleshooting opens'));
      await click(page, '#reader-link-edit');
      await page.$eval('#reader-link-input', (node) => {
        node.value = 'https://read.marvel.com/#/book/22';
        node.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await click(page, '#reader-link-apply');
      await click(page, '#reader-link-heading');
      const temporary = await page.evaluate(() => {
        const node = document.querySelector('#reader-link-temporary');
        return { visible: !!node.getClientRects().length, insideHelp: !!node.closest('details'), text: node.textContent };
      });
      check(temporary.visible && !temporary.insideHelp && /does not verify comic identity or access/.test(temporary.text),
        prefix('active temporary-link lifetime and warning remain outside closed help'), temporary);
      check(await page.evaluate((raw) => localStorage.getItem('mrt.state.v2') === raw, before),
        prefix('comic details and temporary editing preserve saved data'));
      await click(page, '#reader-link-heading');
      await click(page, '#reader-link-edit');
      await page.keyboard.press('Escape');
      check(await page.evaluate(() => document.querySelector('#reader-link-form').hidden
        && document.activeElement.id === 'reader-link-edit'), prefix('Escape closes editing and restores visible focus'));
      check(await page.evaluate(() => window.__readerFirst.searches === 0), prefix('inspecting does not fetch a story summary'));
    }

    if (selectedCases.includes('adding')) {
      await load('add');
      await capture('add', ['#add-primary-methods [data-view="add-search"]', '#add-primary-methods [data-view="add-series"]', '#add-other-methods > summary']);
      check(await page.$eval('#add-other-methods', (node) => !node.open), prefix('other adding methods start closed'));
      await click(page, '#add-other-methods > summary');
      check(await page.$$eval('#add-other-methods [data-view]', (nodes) => nodes.length === 3
        && nodes.every((node) => node.getClientRects().length)), prefix('all secondary adding methods remain visible when requested'));
      await load('add-search');
      await capture('add-search', ['#form-search button', '#search-alternatives > summary']);
      const before = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
      await page.$eval('#search-q', (node) => { node.value = 'Reader-first no-match fixture'; });
      await click(page, '#form-search button');
      await page.waitForFunction(() => [...document.querySelectorAll('#search-results .notice-act button')]
        .some((node) => node.textContent === 'Add an issue by hand'));
      await click(page, '#search-results .notice-act button');
      await page.waitForSelector('#view-add-manual:not([hidden])');
      check(await page.$eval('#view-add-manual .add-target', (node) => node.textContent.includes('House of M')),
        prefix('empty-search manual entry retains the destination'));
      check(await page.evaluate((raw) => localStorage.getItem('mrt.state.v2') === raw, before),
        prefix('manual guidance does not save or look up a comic'));
    }

    if (selectedCases.includes('timeline')) {
      await load('catalog');
      await capture('catalog', ['#modern-timeline-feature .setup-guide-about > summary']);
      const copy = await page.$eval('#modern-timeline-feature', (node) => ({
        intro: node.querySelector('.setup-guide-context > p:not(.eyebrow)').textContent,
        closed: !node.querySelector('.setup-guide-about').open,
        full: node.querySelector('.setup-guide-about > p').textContent,
      }));
      check(copy.closed && copy.intro.split(/\s+/).length <= 25 && /optional.*directly/i.test(copy.intro),
        prefix('Setup starts with concise, optional guidance'), copy);
      await click(page, '#modern-timeline-feature .setup-guide-about > summary');
      check(await page.$eval('#modern-timeline-feature .setup-guide-about > p', (node) => (
        !!node.getClientRects().length && /1998.*not an official Marvel editorial-era boundary/.test(node.textContent)
      )), prefix('full historical context remains accessible'));
    }

    if (selectedCases.includes('settings')) {
      await load('data');
      await capture('data', ['#btn-export-json', '#backup-export-options > summary', '#metadata-settings > summary']);
      if (profile.width <= 700) {
        check(await page.$$eval('#view-data .setting-more > summary',
          (nodes) => nodes.every((node) => node.getBoundingClientRect().height >= 48)),
        prefix('preference-help disclosure targets are at least 48 pixels high'));
      }
      check(await page.evaluate(() => {
        const backup = document.querySelector('#btn-export-json');
        const restore = document.querySelector('#restore-file');
        const optional = document.querySelector('#backup-export-options');
        return !!restore.getClientRects().length && !!backup.getClientRects().length && !optional.open
          && restore.getBoundingClientRect().top < optional.getBoundingClientRect().top
          && !document.querySelector('#metadata-settings').open;
      }), prefix('backup and restore lead; exports and metadata configuration start closed'));
      check(await page.evaluate(() => ['restore-report', 'btn-undo-restore', 'salvage-list', 'salvage-report', 'api-report', 'cache-report', 'btn-wipe']
        .every((id) => !document.getElementById(id).closest('#backup-export-options, #metadata-settings'))),
      prefix('recovery, undo and error regions stay outside optional disclosures'));
      await click(page, '#backup-export-options > summary');
      check(await page.$eval('#btn-export-order-2', (node) => !!node.getClientRects().length), prefix('order-only export remains reachable'));
      await click(page, '#metadata-settings > summary');
      await page.focus('#api-base');
      check(await page.$eval('#api-base', (node) => document.activeElement === node && !!node.getClientRects().length),
        prefix('advanced configuration supports visible keyboard focus'));
    }
    evidence.unexpectedRequests.push(...await page.evaluate(() => window.__readerFirst.unexpected));
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise((done) => shared.close(done));
  if (android) await new Promise((done) => android.close(done));
  if (output) await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
}
assert.deepEqual(evidence.pageErrors, [], 'Reader-first pages must not raise errors.');
assert.deepEqual(evidence.unexpectedRequests, [], 'Reader-first checks must not contact unapproved providers.');
assert.deepEqual(evidence.failures, [], 'Reader-first layout or behavior failed.');
console.log(`Reader-first browser: ${evidence.checks} checks passed across ${selectedProfiles.length} profiles and ${selectedCases.length} cases.`);
