import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createStaticServer, HOST } from '../../../server.mjs';

const root = new URL('../../../', import.meta.url);
const ids = [
  'evolutionary-war',
  'inferno',
  'atlantis-attacks',
  'days-of-future-present',
];
const driver = [
  process.env.MRT_PUPPETEER,
  join(homedir(), '.mrt-scratch', 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js'),
].find((candidate) => candidate && existsSync(candidate));
const edge = process.env.MRT_EDGE
  ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

assert.ok(driver, 'puppeteer-core is not installed in the external scratch directory');
assert.ok(existsSync(edge), `Microsoft Edge was not found at ${edge}`);

const manifest = JSON.parse(readFileSync(new URL('src/data/curated-lists.json', root), 'utf8'));
const expected = new Map(ids.map((id) => {
  const entry = manifest.lists.find((list) => list.id === id);
  assert.ok(entry, `${id} is absent from the manifest`);
  const payload = JSON.parse(readFileSync(new URL(`src/data/${entry.out}`, root), 'utf8'));
  return [id, { entry, payload }];
}));

const { default: puppeteer } = await import(pathToFileURL(driver).href);
const browser = await puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
});
const server = createStaticServer();

try {
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  const origin = `http://${HOST}:${server.address().port}`;
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  for (const id of ids) {
    const { entry, payload } = expected.get(id);
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await page.waitForSelector('.ri[data-view="browse"]', { timeout: 15000 });
    await page.$eval('.ri[data-view="browse"]', (button) => button.click());
    await page.waitForSelector('#view-browse [data-category="timeline"]', { timeout: 15000 });
    await page.$eval('#view-browse [data-category="timeline"]', (button) => button.click());
    const importSelector = `#catalog-results [data-act="import"][data-key="${id}"]`;
    await page.waitForSelector(importSelector, { timeout: 15000 });

    const card = await page.$eval(importSelector, (button) => {
      const node = button.closest('.catalog-card');
      return {
        title: node?.querySelector('.catalog-card-title')?.textContent.trim(),
        count: node?.querySelector('.catalog-card-meta')?.textContent.trim(),
        source: node?.querySelector('.result-source a')?.href,
      };
    });
    assert.deepEqual(card, {
      title: entry.name,
      count: `${payload.items.length} issues`,
      source: entry.sourcePage,
    });

    await page.$eval(importSelector, (button) => {
      button.closest('.catalog-card')?.querySelector('[data-act="preview"]')?.click();
    });
    await page.waitForFunction(
      (title, count) => document.querySelector('#preview[open] #preview-h')?.textContent.trim() === title
        && document.querySelectorAll('#preview .preview-list > li:not(.preview-group)').length === count,
      {},
      entry.name,
      payload.items.length,
    );
    assert.deepEqual(
      await page.$$eval(
        '#preview .preview-list > li:not(.preview-group) span:last-child',
        (nodes) => nodes.map((node) => node.textContent.trim()),
      ),
      payload.items.map(({ title }) => title),
    );
    await page.$eval('#preview-close', (button) => button.click());
    await page.waitForFunction(() => !document.querySelector('#preview')?.open);

    await page.$eval(importSelector, (button) => button.click());
    await page.waitForFunction(
      (title) => !document.querySelector('#view-read')?.hidden
        && document.querySelector('#order-name')?.textContent.trim() === title,
      {},
      entry.name,
    );
    await page.$eval('#full', (details) => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    await page.waitForFunction(
      (count) => document.querySelectorAll('#rows .row').length === count,
      {},
      payload.items.length,
    );

    const rendered = await page.$$eval('#rows .row', (rows) => rows.map((row) => ({
      issueId: Number(row.querySelector('.cb')?.dataset.key),
      title: row.querySelector('.rt')?.textContent.trim(),
    })));
    assert.deepEqual(
      rendered,
      payload.items.map(({ issueId, title }) => ({ issueId: Number(issueId), title })),
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
      })),
      { width: 1280, height: 900, overflow: false },
    );
    console.log(`PASS ${entry.name}: ${rendered.length} exact rendered issues`);
  }
} finally {
  await browser.close().catch(() => {});
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
