import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareAndroid } from './prepare-android.mjs';
import { sourceIdentity, assertSourceUnchanged } from './lib/release-identity.mjs';
import { KEY } from '../src/js/storage.js';
import {
  ORIGIN, FIXTURE_API, VIEWPORT, SCREENS, sha256, shellPath, previewResponse, completedHealthProbe,
  demonstrationState, playIcon, featureGraphic, inspectAsset, previewManifest,
} from './play-assets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLING = ['scripts/build-icons.mjs', 'scripts/play-assets.mjs', 'scripts/capture-play-assets.mjs',
  'scripts/prepare-android.mjs', 'scripts/lib/release-identity.mjs', 'package.json', 'server.mjs'];

function assertCleanAudit(failures) {
  if (failures.length) throw new Error(`Play preview failed: ${failures.join('; ')}`);
}

async function installPreview(page, shell, headers, failures, fixtureResponses, usedPaths) {
  await page.setViewport(VIEWPORT);
  await page.setCacheEnabled(false);
  await page.setBypassServiceWorker(true);
  await page.setOfflineMode(true);
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    try {
      const { fixture, ...response } = previewResponse(request.url(), request.method(), shell);
      if (fixture) fixtureResponses[fixture] = (fixtureResponses[fixture] ?? 0) + 1;
      else usedPaths.add(new URL(request.url()).pathname.slice(1) || 'index.html');
      await request.respond({ ...response, headers: { ...headers, ...response.headers, 'cache-control': 'no-store' } });
    } catch (error) {
      failures.push(error.message);
      if (!request.isInterceptResolutionHandled()) {
        await request.abort('blockedbyclient').catch((abortError) => failures.push(abortError.message));
      }
    }
  });
  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));
  page.on('requestfailed', (request) => {
    const response = request.response();
    const error = request.failure()?.errorText;
    // Edge reports ERR_ABORTED after a fulfilled bodyless 204, with offline mode both on and off.
    // Only the named health response with its verified identity is a completed probe, not a failure.
    if (completedHealthProbe(request.url(), error, response?.status(), response?.headers())) return;
    failures.push(`request failed: ${request.url()} (${error})`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`browser error: ${message.text()}`);
  });
  await page.evaluateOnNewDocument((key, state, apiBase) => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem('mrt.settings', JSON.stringify({
      covers: false, theme: 'light', filter: 'all', apiBase,
    }));
    window.__playPreviewViolations = [];
    window.open = () => {
      window.__playPreviewViolations.push('reader or popup requested');
      throw new Error('Readers and popups are disabled during Play previews');
    };
    window.addEventListener('securitypolicyviolation', () => window.__playPreviewViolations.push('blocked CSP request'));
  }, KEY, demonstrationState(), FIXTURE_API);
}

async function captureScreen(page, screen, output) {
  await page.goto(`${ORIGIN}/${screen.route}`, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector(`#${screen.view}:not([hidden])`, { timeout: 10000 });
  await page.waitForFunction((texts) => texts.every((text) => document.body.innerText.includes(text)), { timeout: 10000 }, screen.text);
  await page.evaluate(async (scroll) => {
    await document.fonts.ready;
    if (scroll) document.querySelector(scroll).scrollIntoView({ block: 'start' });
    else scrollTo(0, 0);
  }, screen.scroll);
  const audit = await page.evaluate((view, requiredText, key, expectedState, headingSelector) => {
    const visible = document.querySelector('.view:not([hidden])');
    const heading = visible?.querySelector(headingSelector ?? 'h1');
    const text = document.body.innerText;
    const settings = JSON.parse(localStorage.getItem('mrt.settings'));
    const state = JSON.parse(localStorage.getItem(key));
    const sameData = ['issues', 'read', 'overrides', 'notes', 'lists', 'listOrder', 'active', 'schemaVersion']
      .every((field) => JSON.stringify(state[field]) === JSON.stringify(expectedState[field]));
    return {
      view: visible?.id === view,
      heading: Boolean(heading && heading.getBoundingClientRect().top >= 0 && heading.getBoundingClientRect().bottom <= innerHeight),
      text: requiredText.every((part) => text.includes(part)),
      noOverflow: document.documentElement.scrollWidth <= innerWidth,
      android: Boolean(document.querySelector('script[src="./android/app.js"]')
        && document.querySelector('link[href="./android/mobile.css"]')),
      coversOff: settings.covers === false,
      sameData,
      safeImages: [...document.images].every((image) => !image.getAttribute('src') || (
        new URL(image.src).origin === location.origin && new URL(image.src).pathname === '/icons/icon.svg'
      )),
      privateTextAbsent: !/[A-Za-z]:[\\/]+Users[\\/]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i.test(text),
      noBlockedRequests: window.__playPreviewViolations.length === 0,
    };
  }, screen.view, screen.text, KEY, demonstrationState(), screen.heading);
  if (Object.values(audit).some((value) => value !== true)) {
    throw new Error(`${screen.file} pre-capture audit failed: ${JSON.stringify(audit)}`);
  }
  const bytes = Buffer.from(await page.screenshot({ type: 'png', fullPage: false, omitBackground: false }));
  const record = inspectAsset(screen.file, bytes);
  await writeFile(join(output, screen.file), bytes);
  return record;
}

export async function capturePlayAssets() {
  const driver = resolve(process.env.MRT_PUPPETEER || join(homedir(), '.mrt-scratch', 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js'));
  const edge = process.env.MRT_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const driverRelative = relative(ROOT, driver);
  if (!isAbsolute(driverRelative) && driverRelative !== '..' && !driverRelative.startsWith(`..${sep}`)) {
    throw new Error('Use an external puppeteer-core entry file, not a repository dependency');
  }
  for (const [name, file] of [['external puppeteer-core (MRT_PUPPETEER)', driver], ['installed Edge (MRT_EDGE)', edge]]) {
    try {
      await access(file, constants.R_OK);
    } catch (error) {
      throw new Error(`Missing ${name}; no Play preview was generated`, { cause: error });
    }
  }
  const puppeteer = (await import(pathToFileURL(driver).href)).default;
  const work = await mkdtemp(join(tmpdir(), 'recap-play-preview-'));
  let output;
  let browser;
  let completed = false;
  try {
    const prepared = await prepareAndroid(join(work, 'android'));
    const source = sourceIdentity();
    const shell = new Map();
    const inputs = new Map();
    for (const entry of prepared.manifest.files.filter(({ path }) => shellPath(path))) {
      const bytes = await readFile(join(prepared.directory, entry.path));
      if (sha256(bytes) !== entry.sha256) throw new Error('Generated Android shell changed before capture');
      shell.set(entry.path, bytes);
      inputs.set(entry.source, entry.sourceSha256);
    }
    for (const file of TOOLING) inputs.set(file, sha256(await readFile(join(ROOT, file))));
    const androidManifestSha256 = sha256(await readFile(join(prepared.directory, 'android-assets.json')));
    browser = await puppeteer.launch({
      executablePath: edge, headless: true, userDataDir: join(work, 'profile'),
      args: ['--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-background-networking'],
    });
    await mkdir(join(ROOT, 'dist'), { recursive: true });
    output = await mkdtemp(join(ROOT, 'dist', 'play-assets-preview-'));
    const files = [];
    for (const [file, bytes] of [['icon-preview.png', playIcon()], ['feature-preview.png', featureGraphic()]]) {
      files.push(inspectAsset(file, bytes));
      await writeFile(join(output, file), bytes);
    }
    const fixtureResponses = {};
    const usedPaths = new Set();
    for (const screen of SCREENS) {
      const context = await browser.createBrowserContext();
      try {
        const page = await context.newPage();
        const failures = [];
        await installPreview(page, shell, prepared.config.securityHeaders, failures, fixtureResponses, usedPaths);
        try {
          files.push(await captureScreen(page, screen, output));
        } catch (error) {
          assertCleanAudit(failures);
          throw new Error(`${screen.file}: ${error.message}`, { cause: error });
        }
        assertCleanAudit(failures);
      } finally {
        await context.close();
      }
    }
    if (!usedPaths.has('android/app.js') || !usedPaths.has('android/mobile.css')) {
      throw new Error('The generated Android entry and stylesheet were not used');
    }
    assertSourceUnchanged(source);
    for (const [path, expected] of inputs) {
      if (sha256(await readFile(join(ROOT, path))) !== expected) throw new Error(`Capture source changed: ${path}`);
    }
    const manifest = previewManifest({
      source: {
        ...source,
        files: [...inputs].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([path, hash]) => ({ path, sha256: hash })),
      },
      androidManifestSha256, rendererVersion: await browser.version(), files, fixtureResponses,
    });
    for (const file of files) {
      const inspected = inspectAsset(file.file, await readFile(join(output, file.file)));
      if (JSON.stringify(inspected) !== JSON.stringify(file)) throw new Error('Written asset differs from audited bytes');
    }
    await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    completed = true;
    return { output, manifest };
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      if (!completed && output) await rm(output, { recursive: true, force: true });
      await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('play:assets takes no arguments; use MRT_EDGE and MRT_PUPPETEER for existing tools');
  const { output } = await capturePlayAssets();
  console.log(`Unapproved Play previews written to ${output}. Desktop Edge, not native Android or release acceptance.`);
}
