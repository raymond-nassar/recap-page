import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareAndroid } from './prepare-android.mjs';
import { CSP } from '../server.mjs';
import { createEmptyState, createList, addIssuesToList, exportBackup } from '../src/js/lib/model.js';

// Cloud backup on Android (#810, P03-T03), through the prepared app assets and the page's half of the
// port. Edge stands in for the WebView and this process for MainActivity: each cloud message is answered
// as the app answers it, 404 with no body while the app is built without a client configuration, and by a
// fixture account once it is. What the app does with Microsoft is the Java suite's to show, and a phone's.
const driver = process.env.MRT_PUPPETEER || join(homedir(), '.mrt-scratch', 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js');
const edge = process.env.MRT_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const puppeteer = (await import(pathToFileURL(driver).href)).default;
const scratch = await mkdtemp(join(tmpdir(), 'recap-android-cloud-browser-'));
const root = join(scratch, 'assets');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const WIRE = /^\{"v":1,"kind":"cloud","id":"cloud-\d+","op":"(status|connect|disconnect|list|read|create|delete)","body":(null|"(?:[^"\\]|\\.)*")\}$/;
let browser;
let checks = 0;
const check = (value, message, detail = '') => { checks += 1; assert.ok(value, `${message} ${detail}`); };

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  try {
    const file = resolve(root, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
    if (!file.startsWith(root + sep)) return void res.writeHead(403).end();
    const bytes = await readFile(file);
    res.writeHead(200, {
      'content-type': `${mime[extname(file)] || 'application/octet-stream'}; charset=utf-8`,
      'content-security-policy': `${CSP}; frame-src 'none'; worker-src 'none'`,
      'cache-control': 'no-store',
    }).end(bytes);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
});

// The account MainActivity reaches, in the answers its route gives: the shared host protocol's bodies.
function fixtureAccount() {
  const host = { state: 'not-connected', connection: null, account: null, items: new Map(), next: 1, calls: [] };
  const linked = () => host.state === 'connected';
  const status = () => ({
    provider: 'onedrive', state: host.state, connection: linked() ? host.connection : null, account: linked() ? host.account : null,
    message: null, reason: null, signInExpiresAt: host.state === 'signing-in' ? Date.now() + 300_000 : null,
  });
  const refuse = (code, message) => ({ ok: false, error: { code, message } });
  const shape = ({ id, name, size, created }) => ({ id, name, size, created });
  function handle(operation, input) {
    host.calls.push(operation);
    if (operation === 'status') return { ok: true, status: status() };
    if (operation === 'connect') {
      if (host.state === 'not-connected') host.state = 'signing-in';
      return { ok: true, status: status() };
    }
    if (operation === 'disconnect') {
      Object.assign(host, { state: 'not-connected', connection: null, account: null });
      return { ok: true, status: status() };
    }
    if (!linked()) return refuse('not-connected', 'Cloud backup is not connected on this device.');
    if (input.connection !== host.connection) return refuse('needs-consent', 'Cloud backup was connected again.');
    if (operation === 'list') return { ok: true, items: [...host.items.values()].map(shape) };
    if (operation === 'read') {
      const item = host.items.get(input.id);
      return item ? { ok: true, bytes: item.bytes } : refuse('not-found', 'That item is no longer in OneDrive.');
    }
    if (operation === 'create') {
      const item = { id: `item-${host.next++}`, name: input.name, bytes: input.bytes, size: Buffer.from(input.bytes, 'base64').length, created: Date.now() };
      host.items.set(item.id, item);
      return { ok: true, item: shape(item) };
    }
    if (operation === 'delete') {
      host.items.delete(input.id);
      return { ok: true };
    }
    return refuse('invalid', 'There is no such cloud operation.');
  }
  return {
    host, handle,
    signedIn() { Object.assign(host, { state: 'connected', connection: 'c'.repeat(32), account: 'reader@example.test' }); },
  };
}

async function openPage(origin, account) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  const wire = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.exposeFunction('__androidCloud', async (raw) => {
    wire.push(raw);
    const message = JSON.parse(raw);
    if (!account) return { status: 404, body: null };
    return { status: 200, body: account.handle(message.op, message.body ? JSON.parse(message.body) : {}) };
  });
  await page.setRequestInterception(true);
  page.on('request', (request) => (new URL(request.url()).origin === origin ? request.continue() : request.respond({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ status: 'ok', items: [], data: [] }),
  })));
  const listId = 'android-cloud-fixture';
  let state = createList(createEmptyState(), { id: listId, name: 'Android cloud fixture' });
  state = addIssuesToList(state, listId, [{
    issueId: 610101, title: 'Cloud fixture #1', number: '1', seriesId: 880,
    seriesName: 'Fixture series (2005)', onSale: '2005-01-01',
    creators: [], digitalId: 710101, hydrated: true, source: 'manual',
  }]).state;
  await page.evaluateOnNewDocument((saved) => {
    if (!localStorage.getItem('mrt.state.v2')) localStorage.setItem('mrt.state.v2', JSON.stringify(saved));
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
    window.addEventListener('load', () => {
      const channel = new MessageChannel();
      channel.port1.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        if (message.kind === 'save') {
          channel.port1.postMessage(JSON.stringify({ v: 1, kind: 'save-result', id: message.id, status: 'saved' }));
        } else if (message.kind === 'cloud') {
          const answer = await window.__androidCloud(event.data);
          channel.port1.postMessage(JSON.stringify({ v: 1, kind: 'cloud-result', id: message.id, ...answer }));
        }
      };
      window.dispatchEvent(new MessageEvent('message', { data: 'recap:connect:v1', origin: '', source: null, ports: [channel.port2] }));
    });
  }, { writeToken: 'android-cloud-fixture', ...exportBackup(state) });
  return { page, context, errors, wire };
}

const card = (page) => page.evaluate(() => {
  const shown = (selector) => { const node = document.querySelector(selector); return Boolean(node && !node.closest('[hidden]') && node.getClientRects().length); };
  return {
    hidden: document.querySelector('#cloud-backup').hidden,
    status: document.querySelector('#cloud-backup-status').textContent,
    report: document.querySelector('#cloud-backup-report').textContent,
    signIn: shown('#btn-cloud-sign-in'), auto: shown('#opt-cloud-auto'), checked: document.querySelector('#opt-cloud-auto').checked,
  };
});
const databases = (page) => page.evaluate(async () => (await indexedDB.databases()).map(({ name }) => name).filter((name) => name === 'mrt-cloud-backup-v1'));
const press = (page, selector) => page.$eval(selector, (node) => node.click());
const privacy = (page) => page.evaluate(() => {
  const view = document.querySelector('#view-about');
  const heading = [...view.querySelectorAll('h3')].find((node) => node.textContent === 'Your data');
  return {
    data: heading.nextElementSibling.innerText.replace(/\s+/g, ' ').trim(),
    on: [...view.querySelectorAll('[data-cloud-copy="on"]')].map((node) => !node.hidden),
    off: [...view.querySelectorAll('[data-cloud-copy="off"]')].map((node) => !node.hidden),
  };
});
async function question(page, opener) {
  await page.waitForFunction((s) => !document.querySelector(s).disabled, {}, opener);
  await press(page, opener);
  await page.waitForSelector('#ask[open]');
  return page.$eval('#ask-body', (node) => node.textContent);
}
// Waits for the dialog's close event rather than for it to stop being open: the question settles and
// lets the next one be asked in that event, which runs a task after `open` turns false. Pressing the
// next opener in that gap was refused as a second question, failing about one run in three here.
async function cancel(page) {
  await page.evaluate(() => new Promise((done) => {
    document.querySelector('#ask').addEventListener('close', () => setTimeout(done), { once: true });
    document.querySelector('#ask-cancel').click();
  }));
}

try {
  await prepareAndroid(root);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: edge, headless: true, args: ['--no-first-run', '--no-default-browser-check'] });

  // Dormant: the app as every build is until the release turns cloud backup on.
  {
    const { page, context, errors, wire } = await openPage(origin, null);
    await page.goto(`${origin}/#/data`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#view-data:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#cloud-backup').hidden);
    await new Promise((done) => { setTimeout(done, 500); });
    check(wire.length >= 1 && wire.every((raw) => WIRE.test(raw)) && wire.every((raw) => JSON.parse(raw).op === 'status'),
      'opening Backup & settings asks the app for its status on the port, in the shape it reads, and nothing else', JSON.stringify(wire));
    check((await card(page)).hidden && (await databases(page)).length === 0,
      'the app answers 404, so the card stays hidden and no cloud backup database exists');
    await page.goto(`${origin}/#/about`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#view-about:not([hidden])');
    await new Promise((done) => { setTimeout(done, 500); });
    const about = await privacy(page);
    check(about.on.length >= 2 && about.on.every((shown) => !shown) && about.off.every(Boolean)
      && !about.data.includes('OneDrive') && !about.data.includes('Windows'),
    'About keeps the words the Android app has always said about your data', JSON.stringify(about));
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Enabled: a fixture account behind the same port.
  {
    const account = fixtureAccount();
    const { page, context, errors, wire } = await openPage(origin, account);
    await page.goto(`${origin}/#/data`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#cloud-backup:not([hidden])');
    check((await card(page)).signIn, 'an app built with cloud backup shows the card and its sign-in');
    await press(page, '#btn-cloud-sign-in');
    await page.waitForFunction(() => document.querySelector('#cloud-backup-status').textContent.includes('Finish signing in'));
    account.signedIn();
    await page.waitForFunction(() => document.querySelector('#cloud-backup-status').textContent.startsWith('Connected to OneDrive'));
    check((await card(page)).status === 'Connected to OneDrive as reader@example.test.' && account.host.calls.includes('connect'),
      'signing in through the app connects, read back by the card\'s polling of the port', JSON.stringify(account.host.calls));
    await press(page, '#opt-cloud-auto');
    await page.waitForFunction(() => document.querySelector('#cloud-backup-status').textContent.includes('Backed up'), { timeout: 20000 });
    check(account.host.items.size === 1 && [...account.host.items.values()][0].name.startsWith('recap-page-backup-v1-'),
      'turning automatic backup on makes the first backup at once, through the port', JSON.stringify(account.host.calls));

    const erase = await question(page, '#btn-wipe');
    await cancel(page);
    check(erase.includes('Cloud backup is disconnected too, on this device.') && !erase.includes('Windows'),
      'while connected, the erase question says cloud backup is disconnected on this device', erase.slice(-200));
    const leave = await question(page, '#btn-cloud-disconnect');
    await cancel(page);
    check(leave.includes('Recap Page forgets the OneDrive sign-in on this device, and automatic backup stops.') && !leave.includes('profile'),
      'the disconnect question says the sign-in is forgotten on this device', leave);

    // Restoring for real, with the page started again after a change, as a later session would leave it.
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
      state.lists['android-cloud-fixture'].name = 'Changed after the backup';
      localStorage.setItem('mrt.state.v2', JSON.stringify(state));
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#cloud-backup:not([hidden]) #opt-cloud-auto:checked');
    await page.$eval('#cloud-discovery', (node) => { node.open = true; });
    await page.waitForSelector('#cloud-discovery-list button[data-cloud-copy="current"]', { visible: true });
    await press(page, '#cloud-discovery-list button[data-cloud-copy="current"]');
    await page.waitForSelector('#ask[open]');
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), press(page, '#ask-ok')]);
    await page.waitForFunction(() => document.querySelector('#complete-backup-report').textContent.includes('Backup restored from OneDrive.'));
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')).lists['android-cloud-fixture']?.name);
    check(restored === 'Android cloud fixture', 'restoring through the port replaces the later change with the backup', restored);

    await page.waitForSelector('#cloud-backup:not([hidden]) #opt-cloud-auto');
    await page.waitForFunction(() => document.querySelector('#cloud-backup-status').textContent.startsWith('Connected to OneDrive'));
    await question(page, '#btn-cloud-delete');
    await press(page, '#ask-ok');
    await page.waitForFunction(() => document.querySelector('#cloud-backup-report').textContent.includes('Deleted '));
    check(account.host.items.size === 0 && !(await card(page)).checked, 'deleting this device\'s backups empties the account and turns backup off');
    await question(page, '#btn-cloud-disconnect');
    await press(page, '#ask-ok');
    await page.waitForFunction(() => document.querySelector('#cloud-backup-report').textContent.includes('Disconnected from OneDrive.'));
    check(account.host.state === 'not-connected' && (await card(page)).signIn, 'disconnecting through the app offers the sign-in again');
    const words = await page.$eval('#view-data', (node) => node.textContent);
    check(!words.includes('Windows account'), 'Backup & settings never speaks of a Windows account in the Android app');

    await page.goto(`${origin}/#/about`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => [...document.querySelectorAll('#view-about [data-cloud-copy="on"]')].every((node) => !node.hidden));
    const about = await privacy(page);
    check(about.on.every(Boolean) && about.off.every((shown) => !shown)
      && about.data.includes('uploaded only if you turn on cloud backup in Backup & settings, and then only to your own OneDrive')
      && !about.data.includes('Windows'),
    'About takes its cloud backup words in the Android app too', JSON.stringify(about));
    check(wire.every((raw) => WIRE.test(raw)), 'every cloud message on the port is in the exact shape the app reads',
      JSON.stringify(wire.filter((raw) => !WIRE.test(raw))));
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`PASS Android cloud backup: ${checks} checks, dormant and with a fixture account behind the app's port, at 390x844. MainActivity and Microsoft are stood in for, not exercised.`);
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(() => done()));
  await rm(scratch, { recursive: true, force: true });
}
