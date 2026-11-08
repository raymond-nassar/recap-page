#!/usr/bin/env node
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { drawIcon, encodePng } from './build-icons.mjs';
import { ORIGIN, FIXTURE_API, demonstrationState, previewResponse, shellPath, completedHealthProbe, sha256 } from './play-assets.mjs';
import { framedText, installCloudFixture, prepareCloudView, dismissListingNotice, CLOUD_FIXTURE } from './listing-fixtures.mjs';
import { CSP } from '../server.mjs';
import { KEY } from '../src/js/storage.js';
import { sourceIdentity, assertSourceUnchanged } from './lib/release-identity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// About shows the application version, so the check follows the release record rather than a
// number that went stale the moment a release bumped it.
const VERSION = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
const OUTPUT = join(ROOT, 'docs', 'store-assets');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DRIVER_SUFFIXES = [
  join('lib', 'puppeteer', 'puppeteer-core.js'),
  join('lib', 'esm', 'puppeteer', 'puppeteer-core.js'),
];
export const SCREENSHOTS = [
  {
    file: '01-home-discovery.png',
    route: '#/home',
    view: 'view-home',
    wait: '#home-primary-paths .home-path',
    text: ['RECAP PAGE!', 'Browse. Choose. Read.', 'Start with Modern Timeline', 'Young readers'],
    state: 'empty',
    dismissNotice: true,
  },
  {
    // The second image shows the current category rather than repeating Home (#1060).
    file: '02-browse-reading-lists.png',
    route: '#/genres',
    view: 'view-genres',
    wait: '#genres-results .catalog-card',
    text: ['Browse Genres', 'Genre', 'Tone', 'Popular places to start'],
    state: 'empty',
  },
  {
    // #897 moved following a path onto Modern Timeline, so the path is shown there.
    file: '03-reading-paths.png',
    route: '#/catalog?path=modern-avengers',
    view: 'view-catalog',
    wait: '#catalog-results .path-stops .catalog-card',
    text: ['Modern Timeline', 'Follow a path', 'Stop 1 of 10', 'Essential Avengers'],
    state: 'demo',
  },
  {
    file: '04-reading-progress.png',
    route: '#/read/play-lantern',
    view: 'view-read',
    wait: '#view-read:not([hidden]) #reading-body:not([hidden])',
    text: ['Fictional: Lantern Harbor', '3 of 8 read'],
    state: 'demo',
  },
  {
    file: '05-about-onedrive.png', route: '#/about', view: 'view-about',
    wait: '#about-version', text: ['Your data', 'only to your own OneDrive', VERSION], state: 'empty',
    scroll: '#view-about h3:nth-of-type(5)', heading: 'h3:nth-of-type(5)',
  },
  {
    file: '06-backup-settings.png', route: '#/data', view: 'view-data',
    wait: '#cloud-backup:not([hidden])', text: ['Cloud backup', 'Sign in with Microsoft', 'OneDrive'], state: 'demo',
    scroll: '#cloud-backup', heading: '#cloud-backup h3',
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

async function installDeterministicBrowserState(page, state) {
  await installCloudFixture(page);
  await page.evaluateOnNewDocument((demo, key, apiBase) => {
    localStorage.clear();
    // Worker script fetches bypass page interception. Exercise the app's unsupported-worker path
    // rather than allowing a worker to reach another process listening on the fixed origin.
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined });
    window.__playPreviewViolations = [];
    window.open = () => { throw new Error('Reader popups are forbidden during screenshots'); };
    localStorage.setItem('mrt.settings', JSON.stringify({
      covers: false, filter: 'all', theme: 'light', apiBase,
    }));
    if (demo) localStorage.setItem(key, JSON.stringify(demo));
  }, state, KEY, FIXTURE_API);
}

async function auditAndCapture(page, origin, screenshot, output) {
  const state = screenshot.state === 'demo' ? demonstrationState() : null;
  await installDeterministicBrowserState(page, state);
  await page.goto(`${origin}/${screenshot.route}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(`#${screenshot.view}:not([hidden])`, { timeout: 15000 });
  await page.waitForSelector(screenshot.wait, { timeout: 15000 });
  await prepareCloudView(page, screenshot.view);
  await dismissListingNotice(page, screenshot.dismissNotice);
  await page.evaluate(async (scroll) => {
    await document.fonts.ready;
    if (scroll) document.querySelector(scroll).scrollIntoView({ block: 'start' });
    else scrollTo(0, 0);
    document.activeElement?.blur();
  }, screenshot.scroll);

  const audit = await page.evaluate((expectedView, requiredText, frame, headingSelector) => {
    const visible = document.querySelector('.view:not([hidden])');
    const text = document.body.innerText.replace(/\s+/g, ' ').trim();
    const box = visible?.getBoundingClientRect();
    return {
      view: visible?.id ?? null,
      required: requiredText.map((value) => ({ value, present: frame.includes(value) })),
      privateText: /\braymo\b|[A-Za-z]:\\Users\\|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text),
      falsePrivacy: /Your progress and your notes are never sent anywhere|and is never sent anywhere/.test(text),
      coversOff: JSON.parse(localStorage.getItem('mrt.settings')).covers === false,
      safeImages: [...document.images].every((image) => !image.getAttribute('src') || (
        new URL(image.src).origin === location.origin
          && ['/icons/icon.svg', '/icons/wordmark.png', '/brands/ms-symbollockup_mssymbol_19.svg', '/brands/g-logo.png'].includes(new URL(image.src).pathname)
      )),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      headingVisible: Boolean(visible?.querySelector(headingSelector ?? 'h1')?.getBoundingClientRect().top >= 0
        && visible?.querySelector(headingSelector ?? 'h1')?.getBoundingClientRect().bottom <= innerHeight),
      viewIntersectsViewport: Boolean(box && box.top < innerHeight && box.right <= innerWidth),
      expectedView,
    };
  }, screenshot.view, screenshot.text, await page.evaluate(framedText), screenshot.heading);

  if (audit.view !== audit.expectedView
      || audit.required.some((entry) => !entry.present)
      || audit.privateText
      || audit.falsePrivacy
      || !audit.coversOff
      || !audit.safeImages
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
  return audit;
}

async function captureShell(directory, prefix = '') {
  const shell = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [key, bytes] of await captureShell(join(directory, entry.name), path)) shell.set(key, bytes);
    } else if (entry.isFile() && shellPath(path)) shell.set(path, await readFile(join(directory, entry.name)));
  }
  return shell;
}

async function main() {
  const driver = resolveDriver();
  if (!driver) {
    throw new Error('puppeteer-core is missing; set MRT_PUPPETEER to an existing scratch install');
  }
  if (!existsSync(EDGE)) throw new Error(`Microsoft Edge is missing at ${EDGE}`);
  if (resolve(driver).startsWith(`${resolve(ROOT)}\\`)) throw new Error('Use an external puppeteer-core install');

  const profile = await mkdtemp(join(tmpdir(), 'recap-page-store-assets-'));
  const assetStaging = await mkdtemp(join(tmpdir(), 'recap-page-store-images-'));
  await writeFile(join(assetStaging, 'store-tile-300.png'), encodePng(300, drawIcon(300)));
  let browser;
  try {
    const shell = await captureShell(join(ROOT, 'src'));
    const source = sourceIdentity();
    const audits = [];
    const puppeteer = await import(pathToFileURL(driver).href);
    browser = await puppeteer.launch({
      executablePath: EDGE,
      headless: true,
      userDataDir: profile,
      args: ['--no-first-run', '--disable-sync', '--disable-background-networking'],
    });
    for (const screenshot of SCREENSHOTS) {
      const context = await browser.createBrowserContext();
      try {
        const page = await context.newPage();
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
        await page.setCacheEnabled(false);
        await page.setBypassServiceWorker(true);
        await page.setOfflineMode(true);
        await page.setRequestInterception(true);
        const failures = [];
        page.on('pageerror', (error) => failures.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') failures.push(`Browser error: ${message.text()}`);
        });
        page.on('requestfailed', (request) => {
          const response = request.response();
          if (!completedHealthProbe(request.url(), request.failure()?.errorText, response?.status(), response?.headers())) {
            failures.push(`Request failed: ${request.url()}`);
          }
        });
        page.on('request', async (request) => {
          try {
            const response = previewResponse(request.url(), request.method(), shell);
            delete response.fixture;
            await request.respond({ ...response, headers: {
              ...response.headers, 'content-security-policy': CSP, 'cache-control': 'no-store',
            } });
          } catch (error) {
            failures.push(error.message);
            await request.abort('blockedbyclient');
          }
        });
        const audit = await auditAndCapture(page, ORIGIN, screenshot, assetStaging);
        if (failures.length) throw new Error(`${screenshot.file}: ${failures.join('; ')}`);
        audits.push({ file: screenshot.file, audit });
      } finally {
        await context.close();
      }
    }
    await writeFile(join(assetStaging, 'capture-audit.json'), `${JSON.stringify({
      status: 'preview-unapproved', origin: ORIGIN, renderer: await browser.version(),
      source,
      inputs: [...shell].map(([path, bytes]) => ({ path: `src/${path}`, sha256: sha256(bytes) })),
      cloud: { configuration: CLOUD_FIXTURE, account: null, state: 'not-connected', simulated: true },
      network: 'All page requests fulfilled locally or refused; no listening server.',
      serviceWorker: 'Unavailable in this capture; the app reports its normal unsupported-worker outcome.',
      audits,
    }, null, 2)}\n`);
    assertSourceUnchanged(source);
    for (const [path, bytes] of shell) {
      if (sha256(await readFile(join(ROOT, 'src', path))) !== sha256(bytes)) throw new Error(`Capture source changed: ${path}`);
    }
    await mkdir(OUTPUT, { recursive: true });
    for (const file of [...SCREENSHOTS.map((screenshot) => screenshot.file), 'store-tile-300.png', 'capture-audit.json']) {
      await copyFile(join(assetStaging, file), join(OUTPUT, file));
    }
  } finally {
    if (browser) await browser.close();
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
