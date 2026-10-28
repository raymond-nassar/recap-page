// Headed Edge and a disposable profile: this installs a real app, not display-mode emulation.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createStaticServer, HOST } from '../server.mjs';
import { createEmptyState, createList, addIssuesToList } from '../src/js/lib/model.js';
import { formatRoute } from '../src/js/lib/route.js';
import { APP_ORIGIN } from '../src/js/lib/install.js';

const driver = process.env.MRT_PUPPETEER
  || join(homedir(), '.mrt-scratch', 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js');
const { default: puppeteer } = await import(pathToFileURL(driver).href);
const profile = await mkdtemp(join(tmpdir(), 'recap-pwa-943-'));
const evidence = process.env.MRT_PWA_EVIDENCE;
const server = createStaticServer();
const [serve] = server.listeners('request');
server.removeAllListeners('request');
let generation = 1;
server.on('request', (req, res) => {
  if (req.url === '/pwa-generation.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' });
    res.end(`export default ${generation};`);
  } else if (req.url === '/pwa-private') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'private, no-store' });
    res.end('{"private":true}');
  } else if (req.url === '/sw.js') {
    readFile(new URL('../src/sw.js', import.meta.url), 'utf8').then((source) => {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' });
      res.end(`${source}\nself.addEventListener('message', event => event.ports[0].postMessage(${generation}));\n`);
    }).catch((error) => { res.destroy(error); });
  } else if (req.url === '/js/lib/install.js') {
    // The offer is gated to the fixed origin; this scratch server is on an ephemeral port.
    readFile(new URL('../src/js/lib/install.js', import.meta.url), 'utf8').then((source) => {
      const gated = `export const APP_ORIGIN = '${APP_ORIGIN}';`;
      if (!source.includes(gated)) throw new Error('install.js no longer declares APP_ORIGIN as expected');
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' });
      res.end(source.replace(gated, `export const APP_ORIGIN = '${origin}';`));
    }).catch((error) => { res.destroy(error); });
  } else {
    serve(req, res);
  }
});
await new Promise((resolve) => server.listen(0, HOST, resolve));
const origin = `http://${HOST}:${server.address().port}`;
const manifestId = `${origin}/`;
let appId;
let nativeIdentity;
let nativeFamily;
let browser;
let cdp;
let installed = false;
let checks = 0;
const check = (name, value) => {
  assert.ok(value, name);
  checks += 1;
  console.log(`PASS ${name}`);
};

function shortcuts() {
  if (process.platform !== 'win32') return [];
  const command = `
    $ErrorActionPreference = 'Stop';
    $shell = New-Object -ComObject WScript.Shell;
    $roots = @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'));
    foreach ($root in $roots) {
      Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse |
        ForEach-Object {
          $link = $shell.CreateShortcut($_.FullName);
          if ($link.Arguments -like '*--app-id=${appId}*') {
            [PSCustomObject]@{name=$_.BaseName; icon=$link.IconLocation; arguments=$link.Arguments} | ConvertTo-Json -Compress
          }
        }
    }`;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' })
    .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function startEntry(aumid) {
  const command = `$ErrorActionPreference = 'Stop'; ConvertTo-Json -InputObject @(Get-StartApps | Where-Object { $_.AppID -eq '${aumid}' }) -Compress`;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).trim();
  return output ? JSON.parse(output) : [];
}

function packageRegistered(family) {
  const name = family.slice(0, family.lastIndexOf('_'));
  const command = `$ErrorActionPreference = 'Stop'; [bool](@(Get-AppxPackage -Name '${name}' | Where-Object { $_.PackageFamilyName -eq '${family}' }).Count) | ConvertTo-Json -Compress`;
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }));
}

async function isUninstalled() {
  try {
    await cdp.send('PWA.getOsAppState', { manifestId });
    return false;
  } catch (error) {
    if (error.message.includes('Unknown web-app manifest id')) return true;
    throw error;
  }
}

async function prepare(page) {
  await page.setViewport({ width: 1280, height: 900 });
}

try {
  browser = await puppeteer.launch({
    executablePath: process.env.MRT_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: false, userDataDir: profile, pipe: true,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
    defaultViewport: { width: 1280, height: 900 },
  });
  cdp = await browser.target().createCDPSession();
  check('scratch origin has no previously installed app', await isUninstalled());
  const interceptionErrors = [];
  const externalRequests = [];
  cdp.on('Target.attachedToTarget', ({ sessionId }) => {
    const session = cdp.connection().session(sessionId);
    session.on('Fetch.requestPaused', ({ requestId, request }) => {
      externalRequests.push({ url: request.url, cookie: request.headers.Cookie || request.headers.cookie || '' });
      session.send('Fetch.fulfillRequest', {
        requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
        body: Buffer.from('<title>External reader fixture</title>').toString('base64'),
      }).catch((error) => interceptionErrors.push(error.message));
    });
    session.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] })
      .then(() => session.send('Runtime.runIfWaitingForDebugger'))
      .catch((error) => interceptionErrors.push(error.message));
  });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
    filter: [{ type: 'page', exclude: false }] });
  const page = await browser.newPage();
  await prepare(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/#/data`, { waitUntil: 'networkidle0' });
  check('ordinary tab is not standalone', await page.evaluate(() => !matchMedia('(display-mode: standalone)').matches));
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const registration = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { scope: reg.scope, updateViaCache: reg.updateViaCache };
  });
  check('worker controls root and bypasses cached update scripts',
    registration.scope === manifestId && registration.updateViaCache === 'none');
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  check('existing name, root identity, scope and standalone mode are retained',
    manifest.name === 'Recap Page' && manifest.short_name === 'Recap' && manifest.id === '/'
      && manifest.start_url === '/' && manifest.scope === '/' && manifest.display === 'standalone'
      && Boolean(manifest.theme_color && manifest.background_color));
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((entry) => entry.sizes === `${size}x${size}`);
    const bytes = Buffer.from(await (await fetch(`${origin}${icon.src}`)).arrayBuffer());
    check(`${size}px icon is an actual correctly sized PNG`,
      bytes.readUInt32BE(16) === size && bytes.readUInt32BE(20) === size);
  }
  const pageCdp = await page.createCDPSession();
  check('Edge reports no installability errors', (await pageCdp.send('Page.getInstallabilityErrors')).installabilityErrors.length === 0);

  // Deterministic UI transitions complement, rather than stand in for, actual installation below.
  // The synthetic prompt settles only after rendered frames, as Edge's own dialog does.
  const offerInstall = () => page.evaluate(() => {
    const frames = () => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150)));
    });
    const dispatchOffer = () => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      let choose;
      event.userChoice = new Promise((resolve) => { choose = resolve; });
      event.prompt = () => frames().then(frames).then(() => choose({ outcome: 'dismissed' }));
      // Chromium supplies another offer just after a dismissed choice resolves.
      event.userChoice.then(() => setTimeout(dispatchOffer, 0));
      window.dispatchEvent(event);
    };
    dispatchOffer();
  });
  await offerInstall();
  await page.waitForSelector('#pwa-install', { visible: true });
  for (const width of [1280, 360]) {
    await page.setViewport({ width, height: 900 });
    await page.$eval('#btn-install', (button) => button.scrollIntoView({ block: 'center' }));
    const geometry = await page.$eval('#btn-install', (button) => {
      const box = button.getBoundingClientRect();
      return { width: box.width, height: box.height, left: box.left, right: box.right, viewport: innerWidth,
        labelFits: button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight,
        pageFits: document.documentElement.scrollWidth <= innerWidth };
    });
    check(`${width}px install button retains its label, target and page bounds`,
      geometry.width >= 24 && geometry.height >= 24 && geometry.left >= 0 && geometry.right <= geometry.viewport
        && geometry.labelFits && geometry.pageFits);
  }
  await page.setViewport({ width: 1280, height: 900 });
  for (const [theme, scheme] of [['light', 'dark'], ['dark', 'light'], ['system', 'light'], ['system', 'dark']]) {
    await pageCdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await page.select('#opt-theme', theme);
    await page.focus('#btn-install');
    await page.keyboard.press('Tab');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    check(`${theme} theme with ${scheme} system preference retains install label and keyboard focus`,
      await page.evaluate((chosen) => {
        const button = document.getElementById('btn-install');
        const style = getComputedStyle(button);
        return (document.documentElement.getAttribute('data-theme') || 'system') === chosen
          && document.activeElement === button && button.matches(':focus-visible')
          && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
          && button.scrollWidth <= button.clientWidth && !document.getElementById('pwa-install').hidden;
      }, theme));
  }
  await pageCdp.send('Emulation.setEmulatedMedia', { features: [
    { name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' },
  ] });
  check('forced colors and reduced motion preserve install text and focus without animation', await page.evaluate(() => {
    const style = getComputedStyle(document.getElementById('btn-install'));
    return matchMedia('(forced-colors: active)').matches && matchMedia('(prefers-reduced-motion: reduce)').matches
      && style.color !== style.backgroundColor && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
      && style.transitionDuration === '0s' && style.animationDuration === '0s';
  }));
  await pageCdp.send('Emulation.setEmulatedMedia', { features: [] });
  await pageCdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await page.$eval('#btn-install', (button) => button.scrollIntoView({ block: 'center', inline: 'center' }));
  check('200 percent page-scale emulation keeps the focused install control in view', await page.evaluate(() => {
    const button = document.getElementById('btn-install');
    const box = button.getBoundingClientRect();
    return visualViewport.scale === 2 && document.activeElement === button
      && box.left >= visualViewport.offsetLeft && box.right <= visualViewport.offsetLeft + visualViewport.width
      && button.scrollWidth <= button.clientWidth;
  }));
  await pageCdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  for (const width of [1280, 360]) {
    await page.setViewport({ width, height: 900 });
    await page.$eval('#btn-install', (button) => button.scrollIntoView({ block: 'center' }));
    await page.focus('#btn-install');
    await page.keyboard.press('Enter');
    check(`${width}px starting an installation attempt clears its previous outcome`,
      await page.$eval('#pwa-install-report', (report) => report.textContent === ''));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check(`${width}px pending prompt keeps focus on the unavailable install control across rendered frames`,
      await page.evaluate(() => {
        const button = document.getElementById('btn-install');
        return document.activeElement === button && button.getAttribute('aria-disabled') === 'true'
          && !button.disabled && button.textContent.startsWith('Waiting');
      }));
    await page.waitForFunction(() => {
      const button = document.getElementById('btn-install');
      return !document.getElementById('pwa-install').hidden && !button.hasAttribute('aria-disabled')
        && document.getElementById('pwa-install-report').textContent.includes('canceled');
    });
    check(`${width}px keyboard cancellation after rendered frames shows its message beside a focused Check connection`,
      await page.evaluate(() => {
        const inView = (node) => {
          const box = node.getBoundingClientRect();
          return box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
        };
        const report = document.getElementById('pwa-install-report');
        return document.activeElement.id === 'btn-check-local-connection'
          && report.textContent.includes('canceled') && !document.getElementById('app-report').textContent.includes('canceled')
          && inView(report) && inView(document.activeElement);
      }));
    check(`${width}px installation feedback has the shared gap before the next card`,
      await page.$eval('#pwa-install-report', (report) => {
        const gap = report.nextElementSibling.getBoundingClientRect().top - report.getBoundingClientRect().bottom;
        const expected = parseFloat(getComputedStyle(report).marginBottom);
        const root = getComputedStyle(document.documentElement);
        const token = parseFloat(root.getPropertyValue('--space-7')) * parseFloat(root.fontSize);
        return expected > 0 && Math.abs(expected - token) < 1 && gap >= expected - 1;
      }));
    check(`${width}px immediate re-offer keeps the outcome beside the returned card`,
      await page.$eval('#pwa-install-report', (report) => {
        const card = document.getElementById('pwa-install');
        return !card.hidden && report.previousElementSibling === card
          && report.textContent.includes('canceled');
      }));
  }
  await page.setViewport({ width: 1280, height: 900 });
  const listId = 'pwa-continuity';
  let state = createList(createEmptyState(), { id: listId, name: 'PWA continuity fixture' });
  state = addIssuesToList(state, listId, [{
    issueId: 900001, title: 'PWA fixture (2026) #1', number: '1',
    seriesName: 'PWA fixture (2026)', digitalId: 700001,
    url: 'https://www.marvel.com/comics/issue/900001/pwa_fixture',
  }]).state;
  state.active = listId;
  await page.evaluate((value) => localStorage.setItem('mrt.state.v2', JSON.stringify(value)), state);
  await browser.defaultBrowserContext().setCookie({
    name: 'pwa_test_session', value: 'synthetic-session-only', domain: 'read.marvel.com',
    path: '/', secure: true, httpOnly: true, sameSite: 'Lax',
  });
  check('worker fetches deployment generation one', await page.evaluate(async () => (await import('/pwa-generation.js')).default === 1));
  await cdp.send('PWA.install', { manifestId, installUrlOrBundleUrl: manifestId });
  installed = true;
  await cdp.send('PWA.changeAppUserSettings', { manifestId, displayMode: 'standalone' });
  const os = await cdp.send('PWA.getOsAppState', { manifestId });
  check('Edge recognizes the installed app', typeof os.badgeCount === 'number');
  const internals = await browser.newPage();
  await internals.goto('edge://web-app-internals');
  await internals.waitForFunction(() => document.querySelector('web-app-internals-app')?.shadowRoot);
  const internalState = await internals.evaluate(() => {
    const root = document.querySelector('web-app-internals-app').shadowRoot;
    return JSON.parse(root.querySelector('pre').textContent);
  });
  const details = internalState.InstalledWebApps.Details.find((entry) => entry.manifest_id === manifestId);
  appId = details['!app_id'];
  nativeIdentity = details.edge_web_app_user_model_id;
  nativeFamily = details.packaged_app_family_name;
  check('Edge registered native app identity, name, icon and standalone preference',
    details['!name'] === 'Recap Page' && details.current_os_integration_states.uninstall_registration.registered_with_os
      && details.current_os_integration_states.shortcut.title === 'Recap Page'
      && details.downloaded_icon_sizes.ANY.includes(512)
      && details.registrar_evaluated_fields.display_mode === 'standalone');
  await internals.close();
  const links = shortcuts();
  check('Windows Start lists the test app under its own app identity',
    startEntry(nativeIdentity).some((entry) => entry.Name.startsWith('Recap Page')));
  check('Windows registered the test app package identity', packageRegistered(nativeFamily));
  const launched = await cdp.send('PWA.launch', { manifestId });
  // Edge 156 returns a tab target; Puppeteer exposes its child page, not that tab id.
  const target = await browser.waitForTarget((candidate) => candidate.type() === 'page' && candidate.url() === manifestId);
  const app = await target.page();
  await prepare(app);
  await app.waitForFunction(() => document.querySelector('#home-h') || document.querySelector('.brand'));
  check('actual installed launch uses standalone display', await app.evaluate(() => matchMedia('(display-mode: standalone)').matches));
  check('standalone app hides installation option', await app.$eval('#pwa-install', (card) => card.hidden));
  check('installed app retains same-profile reading data', await app.evaluate((id) => {
    const saved = JSON.parse(localStorage.getItem('mrt.state.v2'));
    return saved.lists[id]?.name === 'PWA continuity fixture';
  }, listId));
  const before = await app.target().createCDPSession();
  const appWindow = await before.send('Browser.getWindowForTarget');
  const launchedWindow = await cdp.send('Browser.getWindowForTarget', { targetId: launched.targetId });
  const tabWindow = await pageCdp.send('Browser.getWindowForTarget');
  check('installed app has a separate OS window', appWindow.windowId !== tabWindow.windowId
    && appWindow.windowId === launchedWindow.windowId);
  if (process.env.MRT_PWA_OBSERVE === '1') {
    console.log(`NATIVE_OBSERVATION: scratch installed window is ready at ${origin}; cleanup resumes in 60 seconds.`);
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
  await app.evaluate(() => document.querySelector('a[href="#/data"]').click());
  await app.waitForFunction(() => location.hash.startsWith('#/data'));
  check('internal navigation stays in installed target and scope', app.url().startsWith(origin)
    && (await before.send('Browser.getWindowForTarget')).windowId === appWindow.windowId);
  generation = 2;
  await app.reload({ waitUntil: 'networkidle0' });
  check('installed reload receives a new module generation, not offline cache',
    await app.evaluate(async () => (await import('/pwa-generation.js')).default === 2));
  await app.evaluate(async () => {
    await fetch('/pwa-private');
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  check('dynamic no-store response is absent from offline caches', await app.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (await (await caches.open(name)).match('/pwa-private')) return false;
    }
    return true;
  }));
  await app.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  const updatedWorker = await app.waitForFunction(async () => {
    const channel = new MessageChannel();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 1000);
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(data === 2);
      };
      navigator.serviceWorker.controller.postMessage('generation', [channel.port2]);
    });
  });
  check('new deployed worker activates and controls the already installed app', await updatedWorker.jsonValue());
  await app.evaluate((hash) => { location.hash = hash; }, formatRoute({ view: 'read', listId }));
  await app.waitForSelector('#btn-hero-read:not([disabled])', { visible: true });
  const popupPromise = new Promise((resolve) => app.once('popup', resolve));
  await app.$eval('#btn-hero-read', (button) => button.click());
  const popup = await popupPromise;
  await prepare(popup);
  await popup.waitForFunction(() => location.hostname === 'read.marvel.com', { timeout: 15000 });
  check('standalone Read still opens a separate external reader target', popup !== app && popup.url().includes('/#/book/700001'));
  check('external target uses the same profile session cookies', (await browser.defaultBrowserContext().cookies('https://read.marvel.com/'))
    .some((cookie) => cookie.name === 'pwa_test_session' && cookie.value === 'synthetic-session-only'));
  check('external reader navigation carries the synthetic signed-in cookie',
    externalRequests.some((request) => request.url.startsWith('https://read.marvel.com/')
      && request.cookie.includes('pwa_test_session=synthetic-session-only')));
  check('ordinary browser remains usable after installation', await page.evaluate(() => !matchMedia('(display-mode: standalone)').matches));
  check('browser app has no uncaught script errors', errors.length === 0);
  check('all external requests were intercepted without errors', interceptionErrors.length === 0);
  if (evidence) {
    await app.screenshot({ path: join(evidence, 'standalone-content.png') });
    console.log(JSON.stringify({ origin, manifestId, appId, registration, os, links, appWindow, checks }, null, 2));
  }
} finally {
  try {
    if (installed) {
      await cdp.send('PWA.uninstall', { manifestId });
      check('uninstall removes test app OS registration', await isUninstalled());
      check('uninstall removes all test app shortcuts', shortcuts().length === 0);
      if (nativeIdentity) check('uninstall removes the test app from Windows Start', startEntry(nativeIdentity).length === 0);
      if (nativeFamily) check('uninstall removes the test app package registration', !packageRegistered(nativeFamily));
      installed = false;
    }
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (installed) console.error(`Scratch app cleanup failed; preserve profile for cleanup: ${profile}`);
    else await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
console.log(`PWA: ${checks} checks passed; scratch installation and profile removed.`);
