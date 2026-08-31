#!/usr/bin/env node
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStaticServer, HOST } from '../server.mjs';
import { drawIcon, encodePng } from './build-icons.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'docs', 'store-assets');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DRIVER_SUFFIXES = [
  join('lib', 'puppeteer', 'puppeteer-core.js'),
  join('lib', 'esm', 'puppeteer', 'puppeteer-core.js'),
];
const SCREENSHOTS = [
  {
    file: '01-home-discovery.png',
    route: '#/home',
    view: 'view-home',
    wait: '#home-primary-paths .home-path',
    text: ['RECAP PAGE!', 'Browse. Choose. Read.', 'Recommended start'],
    state: 'empty',
  },
  {
    file: '02-browse-reading-lists.png',
    route: '#/browse',
    view: 'view-browse',
    wait: '#view-browse [data-primary-paths] .home-path',
    text: ['Browse', 'Reading Lists', 'Discover More'],
    state: 'empty',
  },
  {
    file: '03-reading-paths.png',
    route: '#/reading-paths?path=modern-avengers',
    view: 'view-reading-paths',
    wait: '#reading-path-details:not([hidden])',
    text: ['Reading paths', 'The Modern Avengers', 'House of M'],
    state: 'demo',
  },
  {
    file: '04-reading-progress.png',
    route: '#/read/store-demo',
    view: 'view-read',
    wait: '#view-read:not([hidden]) #reading-body:not([hidden])',
    text: ['House of M', '5 of 20 read', 'Cover art off'],
    state: 'demo',
  },
  {
    file: '05-about-privacy.png',
    route: '#/about',
    view: 'view-about',
    wait: '#view-about:not([hidden])',
    text: ['About this app', 'Your data', 'Comic Book Herald'],
    state: 'demo',
  },
];

function driverCandidates() {
  const roots = [];
  if (process.env.MRT_PUPPETEER) roots.push(process.env.MRT_PUPPETEER);
  for (const dir of ['.mrt-scratch', 'mrt-scratch-pptr', 'mrt-scratch']) {
    roots.push(join(homedir(), dir));
  }
  const out = [];
  for (const root of roots) {
    if (root.endsWith('.js')) out.push(root);
    for (const suffix of DRIVER_SUFFIXES) {
      out.push(join(root, suffix));
      out.push(join(root, 'node_modules', 'puppeteer-core', suffix));
    }
  }
  return out;
}

function resolveDriver() {
  return driverCandidates().find((candidate) => existsSync(candidate)) ?? null;
}

async function demoState() {
  const order = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'house_of_m.json'), 'utf8'));
  const issues = Object.fromEntries(order.items.map((item) => [
    item.issueId,
    { ...item, source: 'curated' },
  ]));
  const read = Object.fromEntries(order.items.slice(0, 5).map((item, index) => [
    item.issueId,
    Date.UTC(2026, 0, index + 1),
  ]));
  const collectedIn = Object.fromEntries(
    order.items.filter((item) => item.collectedIn).map((item) => [item.issueId, item.collectedIn]),
  );
  return {
    schemaVersion: 2,
    issues,
    read,
    overrides: {},
    notes: {},
    lists: {
      'store-demo': {
        id: 'store-demo',
        name: `Store demonstration: ${order.name}`,
        description: order.description,
        note: '',
        created: Date.UTC(2026, 0, 1),
        catalogId: order.id,
        itemIds: order.items.map((item) => item.issueId),
        collectedIn,
      },
    },
    listOrder: ['store-demo'],
    active: 'store-demo',
  };
}

async function installDeterministicBrowserState(page, state) {
  await page.evaluateOnNewDocument((demo) => {
    const realFetch = window.fetch.bind(window);
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url ?? '';
      const requestUrl = new URL(url, location.href);
      if (requestUrl.origin === location.origin) return realFetch(input, init);
      // Fixed to the public health response observed on 2026-08-29 so the captures are deterministic
      // without advertising the one-item test stub used by the ordinary browser suite.
      if (url.endsWith('/health')) return Promise.resolve(json({ issue_count: 37526 }));
      if (url.includes('api.github.com/repos/raymond-nassar/recap-page/releases/latest')) {
        return Promise.resolve(json({ tag_name: 'v2.0.1' }));
      }
      return Promise.resolve(json({ items: [], total: 0, has_next: false }));
    };
    localStorage.setItem('mrt.settings', JSON.stringify({
      covers: false,
      filter: 'all',
      updateChecks: false,
    }));
    if (demo) localStorage.setItem('mrt.state.v2', JSON.stringify(demo));
    else localStorage.removeItem('mrt.state.v2');
  }, state);
}

async function auditAndCapture(page, origin, screenshot, output) {
  const state = screenshot.state === 'demo' ? await demoState() : null;
  await installDeterministicBrowserState(page, state);
  await page.goto(`${origin}/${screenshot.route}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(`#${screenshot.view}:not([hidden])`, { timeout: 15000 });
  await page.waitForSelector(screenshot.wait, { timeout: 15000 });
  await page.evaluate(() => scrollTo(0, 0));

  const audit = await page.evaluate((expectedView, requiredText) => {
    const visible = document.querySelector('.view:not([hidden])');
    const text = document.body.innerText.replace(/\s+/g, ' ').trim();
    const box = visible?.getBoundingClientRect();
    return {
      view: visible?.id ?? null,
      required: requiredText.map((value) => ({ value, present: text.includes(value) })),
      privateText: /\braymo\b|[A-Za-z]:\\Users\\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      headingVisible: Boolean(visible?.querySelector('h1')?.getBoundingClientRect().bottom <= innerHeight),
      viewIntersectsViewport: Boolean(box && box.top < innerHeight && box.right <= innerWidth),
      expectedView,
    };
  }, screenshot.view, screenshot.text);

  if (audit.view !== audit.expectedView
      || audit.required.some((entry) => !entry.present)
      || audit.privateText
      || audit.horizontalOverflow
      || !audit.headingVisible
      || !audit.viewIntersectsViewport) {
    throw new Error(`${screenshot.file} failed pre-capture audit: ${JSON.stringify(audit)}`);
  }
  await page.screenshot({
    path: join(output, screenshot.file),
    type: 'png',
    fullPage: false,
  });
  console.log(`captured ${screenshot.file}: ${screenshot.text.join(' | ')}`);
}

async function main() {
  const driver = resolveDriver();
  if (!driver) {
    throw new Error('puppeteer-core is missing; set MRT_PUPPETEER to an existing scratch install');
  }
  if (!existsSync(EDGE)) throw new Error(`Microsoft Edge is missing at ${EDGE}`);

  const profile = await mkdtemp(join(tmpdir(), 'recap-page-store-assets-'));
  const assetStaging = await mkdtemp(join(tmpdir(), 'recap-page-store-images-'));
  await writeFile(join(assetStaging, 'store-tile-300.png'), encodePng(300, drawIcon(300)));
  const server = createStaticServer();
  let browser;
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, HOST, resolveListen);
    });
    const origin = `http://${HOST}:${server.address().port}`;
    const puppeteer = await import(pathToFileURL(driver).href);
    browser = await puppeteer.launch({
      executablePath: EDGE,
      headless: true,
      userDataDir: profile,
      args: ['--no-first-run', '--disable-sync', '--disable-background-networking'],
    });
    for (const screenshot of SCREENSHOTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await page.setCacheEnabled(false);
      await page.setBypassServiceWorker(true);
      try {
        await auditAndCapture(page, origin, screenshot, assetStaging);
      } finally {
        await page.close();
      }
    }
    await mkdir(OUTPUT, { recursive: true });
    for (const file of [...SCREENSHOTS.map((screenshot) => screenshot.file), 'store-tile-300.png']) {
      await copyFile(join(assetStaging, file), join(OUTPUT, file));
    }
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(assetStaging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
