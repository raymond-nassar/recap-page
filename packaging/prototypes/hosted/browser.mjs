/* global DataTransfer, Event, File, Request, Response, URL, console, document, localStorage, location, navigator, process, window */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { checkArtifact, startHeaderHarness } from './check.mjs';

const DEFAULT_EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DEFAULT_DRIVER = join(
  homedir(),
  '.mrt-scratch',
  'node_modules',
  'puppeteer-core',
  'lib',
  'puppeteer',
  'puppeteer-core.js',
);
const READING_KEY = 'mrt.state.v2';

function option(prefix) {
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function installBrowserStubs(page) {
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, theme: 'dark' }));
    window.__hostedEvidence = { externalRequests: [], unexpectedRequests: [], downloads: [] };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin === location.origin) return nativeFetch(input, init);
      window.__hostedEvidence.externalRequests.push(url.href);
      if (!navigator.onLine) return new Response('offline fixture', { status: 503 });
      if (url.pathname.endsWith('/health')) {
        return new Response(JSON.stringify({ issue_count: 0 }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (/\/search\/issues(?:\/|$)/.test(url.pathname)) {
        return new Response(JSON.stringify({ items: [], total: 0 }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (/\/issues\/\d+$/.test(url.pathname)) {
        return new Response('synthetic upstream failure', { status: 503 });
      }
      window.__hostedEvidence.unexpectedRequests.push(url.href);
      return new Response('unexpected synthetic request', { status: 503 });
    };
    const createUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      Promise.resolve(blob.text()).then((text) => {
        window.__hostedEvidence.downloads.push({ type: blob.type, text });
      });
      return createUrl(blob);
    };
  });
}

async function blockExternalRequests(page, origin, blockedRequests) {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith(origin)) request.continue().catch(() => {});
    else {
      blockedRequests.push(request.url());
      request.abort('blockedbyclient').catch(() => {});
    }
  });
}

async function click(page, selector) {
  await page.waitForSelector(selector, { visible: true, timeout: 20000 });
  await page.$eval(selector, (node) => node.click());
}

async function uploadText(page, inputSelector, filename, contents) {
  await page.evaluate(({ selector, name, text }) => {
    const input = document.querySelector(selector);
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], name, { type: 'application/json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector: inputSelector, name: filename, text: contents });
}

async function localStorageSnapshot(page) {
  return page.evaluate(() => JSON.stringify(
    Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]),
  ));
}

async function runJourney({ output, basePath, puppeteer, edge }) {
  await checkArtifact(output, basePath);
  const harness = await startHeaderHarness(output, basePath);
  const profile = await mkdtemp(join(tmpdir(), 'recap-hosted-edge-'));
  let browser;
  const evidence = { basePath, checks: [], blockedNetworkRequests: [], offline: null, popup: null };
  try {
    browser = await puppeteer.launch({
      executablePath: edge,
      userDataDir: profile,
      headless: true,
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-sync',
        '--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE localhost,EXCLUDE 127.0.0.1',
      ],
    });
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await installBrowserStubs(page);
    await blockExternalRequests(page, harness.origin, evidence.blockedNetworkRequests);
    const sameOriginRequests = [];
    page.on('request', (request) => {
      if (request.url().startsWith(harness.origin)) sameOriginRequests.push(request.url());
    });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(`${harness.origin}${basePath}#/catalog`, { waitUntil: 'load' });
    await page.waitForSelector('#view-catalog:not([hidden])');
    await page.waitForSelector('#catalog-results .catalog-card', { timeout: 20000 });
    await page.$eval('#catalog-q', (input) => {
      input.value = 'House of M';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForSelector('#catalog-results [data-story="list:house-of-m"]', { timeout: 20000 });
    await click(page, '#catalog-results [data-story="list:house-of-m"] [data-act="preview"]');
    await page.waitForFunction(() => document.querySelectorAll('#preview[open] #preview-body .preview-issue-link').length === 20);
    await click(page, '#preview-add [data-act="main"]');
    await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('mrt.state.v2')).lists)
      .some((list) => list.catalogId === 'house-of-m'));
    await click(page, '#preview-add [data-act="main"]');
    await page.waitForSelector('#view-read:not([hidden])');
    const fixtureState = await page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')));
    const list = Object.values(fixtureState.lists).find((candidate) => candidate.catalogId === 'house-of-m');
    assert.equal(list.itemIds.length, 20, 'the bundled House of M fixture is browsable and saved');
    evidence.checks.push('browse bundled House of M and save the 20-item list');

    const firstIssue = String(list.itemIds[0]);
    await click(page, '#btn-hero-done');
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('mrt.state.v2')).read[id] != null, {}, firstIssue);
    await click(page, '#hero-more-actions > summary');
    await click(page, '#btn-hero-defer');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('mrt.state.v2'))
      .lists[JSON.parse(localStorage.getItem('mrt.state.v2')).active].deferredIssueIds.length > 0);
    await click(page, '#btn-hero-inspect');
    await page.waitForSelector('#view-issue:not([hidden])');
    await click(page, '#issue-rating-trigger');
    await page.waitForSelector('#issue-rating-dialog[open]');
    await click(page, '#issue-rating-stars button[data-rating="4"]');
    await click(page, '#issue-rating-save');
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('mrt.state.v2')).ratings[id] === 4,
      {}, String(list.itemIds[2]));
    const changed = JSON.parse(await page.evaluate(() => localStorage.getItem('mrt.state.v2')));
    assert.ok(changed.read[firstIssue]);
    assert.ok(changed.lists[changed.active].deferredIssueIds.length > 0);
    assert.equal(changed.ratings[list.itemIds[2]], 4);
    evidence.checks.push('mark read, defer a different issue, and save a four-star rating');

    const popupTarget = browser.waitForTarget((target) => target.url().includes(`${basePath}open.html?`), {
      timeout: 15000,
    });
    await page.evaluate(() => { location.hash = `#/read/${JSON.parse(localStorage.getItem('mrt.state.v2')).active}`; });
    await page.waitForSelector('#view-read:not([hidden])');
    await click(page, '#btn-hero-read');
    const target = await popupTarget;
    const popupUrl = target.url();
    assert.ok(popupUrl.startsWith(`${harness.origin}${basePath}open.html?`),
      `reader handoff must remain within the base path: ${popupUrl}`);
    evidence.popup = { url: popupUrl, basePathMatch: true };
    evidence.checks.push('reader handoff opens the same-origin launcher under the selected base path');
    await target.page().then((popup) => popup.close()).catch(() => {});

    const failPage = await context.newPage();
    await failPage.setViewport({ width: 1280, height: 900 });
    await installBrowserStubs(failPage);
    await blockExternalRequests(failPage, harness.origin, evidence.blockedNetworkRequests);
    await failPage.goto(`${harness.origin}${basePath}open.html?i=900001&t=Synthetic`, { waitUntil: 'load' });
    await failPage.waitForFunction(() => document.querySelector('#p')?.textContent.includes('could not be loaded'));
    assert.equal(await failPage.$eval('#fallback', (node) => new URL(node.href).hostname), 'www.marvel.com');
    evidence.checks.push('failed noncredentialed metadata lookup remains an explicit failure with a manual link');
    await failPage.close();

    await page.evaluate(() => { location.hash = '#/data'; });
    await page.waitForSelector('#view-data:not([hidden])');
    await click(page, '#btn-export-json');
    await page.waitForFunction(() => window.__hostedEvidence.downloads.length === 1);
    const readingBackup = await page.evaluate(() => window.__hostedEvidence.downloads[0].text);
    assert.equal(JSON.parse(readingBackup).schemaVersion, 4);

    await page.evaluate(() => { location.hash = '#/completed'; });
    await page.waitForSelector('#btn-export-history', { visible: true });
    await click(page, '#btn-export-history');
    await page.waitForFunction(() => window.__hostedEvidence.downloads.length === 2);
    const historyBackup = await page.evaluate(() => window.__hostedEvidence.downloads[1].text);

    await page.evaluate(() => { location.hash = '#/add-import'; });
    await page.waitForSelector('#view-add-import:not([hidden])');
    await page.evaluate(() => {
      const field = document.querySelector('#import-text');
      field.value = '- [ ] Synthetic hosted draft position';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#import-new-list').checked = true;
      document.querySelector('#form-import').requestSubmit();
    });
    await page.waitForFunction(() => localStorage.getItem('mrt.import.draft.v1') !== null, { timeout: 20000 });
    await page.evaluate(() => { location.hash = '#/data'; });
    await page.waitForSelector('#view-data:not([hidden])');
    await click(page, '#btn-export-draft');
    await page.waitForFunction(() => window.__hostedEvidence.downloads.length === 3);
    const draftBackup = await page.evaluate(() => window.__hostedEvidence.downloads[2].text);
    assert.ok(JSON.parse(draftBackup));
    evidence.checks.push('download separate reading-data, completion-history, and import-draft backups');

    const beforeRefusals = await localStorageSnapshot(page);
    await uploadText(page, '#restore-file', 'invalid-reading-data.json', '{"invalid":true}');
    await page.waitForFunction(() => document.querySelector('#restore-report').textContent.length > 0);
    assert.equal(await localStorageSnapshot(page), beforeRefusals, 'invalid reading restore must not replace storage');
    await uploadText(page, '#restore-file', 'reading-data.json', readingBackup);
    await page.waitForSelector('#ask[open]');
    await click(page, '#ask-cancel');
    await page.waitForSelector('#ask:not([open])');
    assert.equal(await localStorageSnapshot(page), beforeRefusals, 'cancelled reading restore must not replace storage');

    await page.evaluate(() => { location.hash = '#/completed'; });
    await page.waitForSelector('#restore-history-file', { visible: true });
    await uploadText(page, '#restore-history-file', 'completion-history.json', historyBackup);
    await page.waitForSelector('#ask[open]');
    await click(page, '#ask-cancel');
    await page.waitForSelector('#ask:not([open])');
    assert.equal(await localStorageSnapshot(page), beforeRefusals, 'cancelled history restore must not replace storage');

    await page.evaluate(() => { location.hash = '#/data'; });
    await page.waitForSelector('#view-data:not([hidden])');
    await uploadText(page, '#restore-draft', 'import-draft.json', draftBackup);
    await page.waitForSelector('#ask[open]');
    await click(page, '#ask-cancel');
    await page.waitForSelector('#ask:not([open])');
    assert.equal(await localStorageSnapshot(page), beforeRefusals, 'cancelled draft restore must not replace storage');
    evidence.checks.push('invalid restore errors and three explicit restore cancellations preserve every saved byte');

    await page.evaluate(() => { location.hash = `#/read/${JSON.parse(localStorage.getItem('mrt.state.v2')).active}`; });
    await page.waitForSelector('#view-read:not([hidden])');
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 15000 });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#view-read:not([hidden])');
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'load', timeout: 15000 });
    await page.waitForSelector('#view-read:not([hidden])', { timeout: 15000 });
    const offlineState = await page.evaluate((key) => ({
      origin: location.origin,
      path: location.pathname,
      read: JSON.parse(localStorage.getItem(key)).read,
    }), READING_KEY);
    assert.ok(offlineState.path.startsWith(basePath));
    evidence.offline = { reload: 'passed', route: offlineState.path };
    evidence.checks.push('prepared local shell reopens after browser networking is disabled');
    await page.setOfflineMode(false);

    const caches = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(request.url);
      }
      return urls;
    });
    assert.ok(caches.every((url) => url.startsWith(`${harness.origin}${basePath}`)),
      `app-managed Cache API entries must remain same-origin and base-scoped: ${JSON.stringify(caches)}`);
    assert.ok(!caches.some((url) => /i\.annih\.us|marvel\.com/.test(url)));
    const networkEvidence = await page.evaluate(() => window.__hostedEvidence);
    assert.deepEqual(networkEvidence.unexpectedRequests, []);
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    assert.ok(sameOriginRequests.every((url) => url.startsWith(`${harness.origin}${basePath}`)),
      'all local resources must resolve under the selected base path');
    evidence.externalRequests = [...new Set(networkEvidence.externalRequests.map((url) => new URL(url).origin))];
    evidence.localStorageKeys = await page.evaluate(() => Object.keys(localStorage).sort());
    evidence.cacheApiEntries = caches.length;
    evidence.pageErrors = pageErrors;
    evidence.checks.push('all app-managed cached responses are same-origin; no cover image bytes or page errors');
    assert.equal(evidence.blockedNetworkRequests.length, 0, 'all external fetches must be handled by the synthetic stub');
    await context.close();
    return evidence;
  } finally {
    if (browser) await browser.close();
    await harness.close();
    await rm(profile, { recursive: true, force: true });
  }
}

async function main() {
  const output = option('--out=');
  const basePath = option('--base-path=') ?? '/';
  const driver = process.env.MRT_PUPPETEER || DEFAULT_DRIVER;
  const edge = process.env.MRT_EDGE || DEFAULT_EDGE;
  if (!output) throw new Error('Usage: node packaging/prototypes/hosted/browser.mjs --out=<artifact-dir> [--base-path=/nested/]');
  if (!existsSync(driver) || !existsSync(edge)) {
    throw new Error(`Browser run blocked: requires installed Edge and puppeteer-core at ${driver}`);
  }
  const puppeteer = (await import(pathToFileURL(resolve(driver)).href)).default;
  const checked = await checkArtifact(output, basePath);
  const evidence = await runJourney({ output, basePath: checked.basePath, puppeteer, edge });
  console.log(JSON.stringify({
    sourceCommit: checked.manifest.sourceCommit,
    contentDigest: checked.manifest.contentDigest,
    ...evidence,
    https: 'blocked: no owner-approved exact host, destination, and upload scope',
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
