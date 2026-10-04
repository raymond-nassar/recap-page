import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareAndroid } from './prepare-android.mjs';
import { CSP } from '../server.mjs';
import { LOCAL_SERVER_HEALTH_PATH, LOCAL_SERVER_HEADER_NAME, LOCAL_SERVER_HEADER_VALUE } from '../src/js/lib/localServer.js';
import { createEmptyState, createList, addIssuesToList, exportBackup } from '../src/js/lib/model.js';
import { LIST_HISTORY_KEY } from '../src/js/lib/listHistory.js';

const driver = process.env.MRT_PUPPETEER || join(homedir(), '.mrt-scratch', 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js');
const edge = process.env.MRT_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const puppeteer = (await import(pathToFileURL(driver).href)).default;
const scratch = await mkdtemp(join(tmpdir(), 'recap-android-privacy-browser-'));
const root = join(scratch, 'assets');
const policyUrl = 'https://github.com/raymond-nassar/recap-page/blob/main/PRIVACY.md';
const feedbackUrl = 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAMAAEys2uVUMkJLVFlNTUhaUFk0NERQQzYxT0xSSDAwVy4u';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const errors = [];
const remote = [];
let browser;
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname === LOCAL_SERVER_HEALTH_PATH) {
    res.writeHead(204, { [LOCAL_SERVER_HEADER_NAME]: LOCAL_SERVER_HEADER_VALUE }).end();
    return;
  }
  try {
    const file = resolve(root, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
    if (!file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const bytes = await readFile(file);
    res.writeHead(200, {
      'content-type': `${mime[extname(file)] || 'application/octet-stream'}; charset=utf-8`,
      'content-security-policy': `${CSP}; frame-src 'none'; worker-src 'none'`,
      'cache-control': 'no-store',
    }).end(bytes);
  } catch (error) {
    if (error.code !== 'ENOENT') errors.push(error.message);
    res.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
});

try {
  await prepareAndroid(root);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({
    executablePath: edge,
    headless: true,
    userDataDir: join(scratch, 'profile'),
    args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === origin) return request.continue();
    remote.push(request.url());
    return request.respond({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ status: 'ok', items: [] }),
    });
  });
  await page.evaluateOnNewDocument(() => {
    globalThis.localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
  });
  await page.goto(`${origin}/#/about`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#view-about:not([hidden])');
  const link = `#view-about a[href="${policyUrl}"]`;
  await page.waitForSelector(link, { visible: true });
  const text = await page.$eval('#view-about', (node) => node.innerText);
  assert.match(text, /private Android app storage/);
  assert.match(text, /automatic service requests do not upload your saved lists, progress or notes/);
  assert.match(text, /selected document provider[\s\S]*progress and notes/);
  assert.match(text, /not a guarantee[\s\S]*sync[\s\S]*retention/);
  assert.match(text, /Clearing app data or uninstalling/);
  assert.doesNotMatch(text, /Your progress and your notes are never sent anywhere/);
  const before = await page.evaluate(() => globalThis.localStorage.getItem('mrt.state.v2'));
  assert.ok(before === null || JSON.parse(before).listOrder.length === 0, 'Only empty synthetic progress is used');
  assert.equal(remote.filter((url) => url === policyUrl).length, 0, 'Policy access is not automatic');
  const attributes = await page.$eval(link, (node) => ({
    text: node.textContent.trim(), target: node.target, rel: node.rel,
    referrer: node.referrerPolicy, tabIndex: node.tabIndex,
  }));
  assert.deepEqual(attributes, {
    text: 'Privacy policy (opens in your browser)', target: '_blank',
    rel: 'noopener noreferrer', referrer: 'no-referrer', tabIndex: 0,
  });
  // Cancel the external navigation after observing a real keyboard activation, so no policy host is contacted.
  await page.$eval(link, (node) => node.addEventListener('click', (event) => {
    event.preventDefault();
    globalThis.__privacyActivation = { trusted: event.isTrusted, href: node.href };
  }, { once: true }));
  await page.focus(link);
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => globalThis.__privacyActivation), { trusted: true, href: policyUrl });
  assert.equal(page.url(), `${origin}/#/about`, 'External policy activation does not replace the in-app route');
  await page.$eval('.ri[data-view="data"]', (node) => node.click());
  await page.waitForSelector('#view-data:not([hidden])');
  assert.equal(page.url(), `${origin}/#/data`);
  await page.$eval('.ri[data-view="about"]', (node) => node.click());
  await page.waitForSelector('#view-about:not([hidden])');
  assert.equal(page.url(), `${origin}/#/about`);
  assert.equal(await page.evaluate(() => globalThis.localStorage.getItem('mrt.state.v2')), before);
  assert.equal(await page.evaluate(async () => (
    await globalThis.navigator.serviceWorker.getRegistrations()
  ).length), 0);
  assert.deepEqual(remote, ['https://marvel.emreparker.com/v1/health']);
  const listId = 'android-feedback-fixture';
  let state = createList(createEmptyState(), {
    id: listId, name: 'Private Android feedback fixture', note: 'Private fixture note',
  });
  state = addIssuesToList(state, listId, [{
    issueId: 610001, title: 'Feedback fixture #1', number: '1', seriesId: 880,
    seriesName: 'Fixture series (2005)', onSale: '2005-01-01',
    creators: [], digitalId: 710001, hydrated: true, source: 'manual',
  }]).state;
  let feedbackAssertions = 0;
  const checkFeedback = (value, message) => { feedbackAssertions += 1; assert.ok(value, message); };
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    await page.setViewport({ width, height });
    await page.evaluate((value, historyKey, id) => {
      localStorage.setItem('mrt.state.v2', JSON.stringify(value));
      localStorage.removeItem(historyKey);
      globalThis.history.replaceState(null, '', `#/read/${id}`);
    }, { writeToken: 'android-feedback-fixture', ...exportBackup(state) }, LIST_HISTORY_KEY, listId);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !globalThis.document.querySelector('#btn-complete-list').disabled
      && globalThis.document.querySelector('#order-name').textContent === 'Private Android feedback fixture');
    const readerBefore = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
    await page.$eval('#btn-complete-list', (node) => node.click());
    await page.waitForFunction(() => !globalThis.document.querySelector('#btn-reopen-list').hidden
      && !globalThis.document.querySelector('#btn-reopen-list').disabled);
    const historyBefore = await page.evaluate((key) => localStorage.getItem(key), LIST_HISTORY_KEY);
    checkFeedback(JSON.parse(historyBefore).records[0].rating === null, `${width}px no rating is required to report`);
    await page.$eval('#btn-list-feedback-guide', (node) => node.click());
    await page.waitForSelector('#list-feedback[open]');
    const feedback = await page.$eval('#list-feedback', (node) => {
      const link = node.querySelector('#list-feedback-link');
      return {
        text: node.textContent, href: link.href, target: link.target, rel: link.rel,
        referrer: link.referrerPolicy, visible: link.checkVisibility(),
      };
    });
    checkFeedback(feedback.href === feedbackUrl && feedback.target === '_blank'
      && feedback.rel === 'noopener noreferrer' && feedback.referrer === 'no-referrer',
    `${width}px Android uses the same protected responder URL with no reader payload`);
    checkFeedback(feedback.text.includes('No account, name or email required')
      && feedback.text.includes('saved reading data and thumb choice are not attached')
      && feedback.text.includes('Microsoft processes your form visit and submitted report'),
    `${width}px Android discloses the manual outside-app Microsoft boundary`);
    checkFeedback(feedback.visible && await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth),
      `${width}px reporting action is visible with no horizontal overflow`);
    const routeBefore = page.url();
    await page.$eval('#list-feedback-link', (link) => link.addEventListener('click', (event) => {
      event.preventDefault();
      globalThis.__listFeedbackActivation = { trusted: event.isTrusted, href: link.href };
    }, { once: true }));
    await page.focus('#list-feedback-link');
    await page.keyboard.press('Enter');
    const activated = await page.evaluate(() => globalThis.__listFeedbackActivation);
    checkFeedback(activated?.trusted === true && activated.href === feedbackUrl && page.url() === routeBefore,
      `${width}px explicit keyboard activation is observed without contacting the recipient`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !globalThis.document.querySelector('#list-feedback').open
      && globalThis.document.activeElement.id === 'btn-list-feedback-guide');
    checkFeedback(await page.$eval('#btn-list-feedback-guide', (node) => node.checkVisibility()),
      `${width}px close restores the visible report opener`);
    checkFeedback(await page.evaluate((readerValue, historyValue, key) => (
      localStorage.getItem('mrt.state.v2') === readerValue && localStorage.getItem(key) === historyValue
    ), readerBefore, historyBefore, LIST_HISTORY_KEY), `${width}px reader/history bytes stay unchanged`);
    checkFeedback(!remote.some((url) => new URL(url).hostname === 'forms.cloud.microsoft'),
      `${width}px opening/cancelling reporting makes no Microsoft form request`);
  }
  assert.deepEqual(errors, []);
  console.log(`PASS Android privacy: existing disclosure/navigation/storage checks; feedback ${feedbackAssertions} assertions at 1280x900/390x844. External requests stubbed; policy/form navigation cancelled, not physical Android acceptance.`);
} finally {
  if (browser) await browser.close();
  await new Promise((done, reject) => server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : done()));
  await rm(scratch, { recursive: true, force: true });
}
