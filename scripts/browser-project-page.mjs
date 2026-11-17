import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPages } from './build-pages.mjs';

const root = fileURLToPath(new URL('../dist/pages/', import.meta.url));
const driver = process.env.MRT_PUPPETEER ?? join(homedir(), '.mrt-scratch', 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js');
const edge = process.env.MRT_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if (!existsSync(driver) || !existsSync(edge)) throw new Error('Install Edge and a scratch puppeteer-core driver, or set MRT_EDGE and MRT_PUPPETEER to their entry files.');
const { default: puppeteer } = await import(pathToFileURL(driver).href);
await buildPages();
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const relative = url.pathname.replace(/^\/recap-page\//, '') || 'index.html';
  const file = resolve(root, relative);
  if (!file.startsWith(`${resolve(root)}${sep}`)) return response.writeHead(404).end();
  try {
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(bytes);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(error);
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions += 1; };
try {
  browser = await puppeteer.launch({ executablePath: edge, headless: true });
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.evaluateOnNewDocument(() => {
    const getter = Object.getOwnPropertyDescriptor(window, 'localStorage').get;
    window.__nativeStorageDenied = () => {
      try { getter.call(window); return false; } catch (error) { return error.name === 'SecurityError'; }
    };
  });
  async function ready() {
    await page.waitForFunction(() => document.querySelector('[data-tour-status]').textContent.startsWith('Sample ready.'));
    const frame = page.frames().find((frame) => frame.url().startsWith(`${origin}/recap-page/demo.html`));
    assert.ok(frame);
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true');
    return frame;
  }
  async function reset() {
    await page.$eval('[data-tour-reset]', (button) => button.click());
    await page.waitForFunction(() => document.querySelector('[data-tour-status]').textContent.startsWith('Sample ready.'));
    return ready();
  }
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    await page.setViewport({ width, height });
    await page.goto(`${origin}/recap-page/`, { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('mrt.state.v2', 'reader-data-must-not-change');
      sessionStorage.setItem('tour-sentinel', 'keep');
    });
    check(await page.$eval('[data-guided-demo]', (el) => !el.checkVisibility()), `${width}: unloaded frame is hidden`);
    await page.focus('[data-tour-start]');
    await page.keyboard.press('Enter');
    let frame = await ready();
    check(await frame.evaluate(() => window.__nativeStorageDenied()), `${width}: native storage denied by sandbox`);
    check(await frame.evaluate(() => {
      try { return !!parent.document && false; } catch (error) { return error.name === 'SecurityError'; }
    }), `${width}: frame cannot access parent document or storage`);
    check((await frame.$$('#library-yours-list a')).length === 3, `${width}: actual library has three sample lists`);
    await frame.focus('#library-yours-list a');
    await page.keyboard.press('Enter');
    await frame.waitForSelector('#btn-hero-done', { visible: true });
    await frame.waitForFunction(() => document.querySelector('#demo-step').textContent.startsWith('2 of 3'));
    check((await frame.$eval('#hero-title', (el) => el.textContent)) === 'Ultimate Spider-Man (2000) #1', `${width}: actual reading hero`);
    await frame.waitForSelector('#order-source a');
    check(await frame.$eval('#order-source', (el) => el.textContent.includes('Comic Book Herald')), `${width}: real source credit`);
    const tabsBeforeRead = (await browser.pages()).length;
    await frame.$eval('#btn-hero-read', (button) => button.click());
    check(await frame.$eval('#demo-step', (el) => el.textContent.includes('separate comic service')), `${width}: Read explains without launching`);
    check((await browser.pages()).length === tabsBeforeRead, `${width}: no reader popup`);
    await frame.focus('#btn-hero-done');
    await page.keyboard.press('Enter');
    await frame.waitForFunction(() => document.querySelector('#hero-title').textContent === 'Ultimate Spider-Man (2000) #2');
    check(await frame.$eval('#demo-step', (el) => el.textContent.startsWith('3 of 3')), `${width}: Done advances the guide`);
    check(await frame.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mrt.state.v2')).read).length === 1), `${width}: actual model marks progress`);
    check(await page.evaluate(() => localStorage.getItem('mrt.state.v2') === 'reader-data-must-not-change' && sessionStorage.getItem('tour-sentinel') === 'keep'), `${width}: parent saved data unchanged`);
    await frame.$eval('#demo-install', (button) => button.click());
    await page.waitForFunction(() => document.activeElement === document.querySelector('#platform-picker'));
    check(await page.$eval('#platform-picker', (el) => el === document.activeElement), `${width}: tour hands off to install choice`);
    await page.select('#platform-picker', 'ipad');
    check(await page.$$eval('[data-platform]', (cards) => cards.filter((card) => !card.hidden).map((card) => card.dataset.platform).join() === 'ipad'), `${width}: device filter works`);
    await page.$eval('[data-tour-expand]', (button) => button.click());
    check(await page.$eval('[data-tour-expand]', (button) => button.getAttribute('aria-expanded') === 'true'), `${width}: expanded view`);
    for (const context of [page, frame]) {
      check(await context.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);
    }
    if (width === 1280) {
      await frame.$eval('#btn-hero-done', (button) => button.click());
      await frame.waitForFunction(() => document.querySelector('#hero-title').textContent.endsWith('#3'));
      await frame.$eval('#btn-hero-done', (button) => button.click());
      await frame.waitForFunction(() => document.querySelector('#demo-step').textContent.startsWith('Sample complete'));
      check(await frame.$eval('#demo-install', (button) => button === document.activeElement), 'completed sample has usable focus');
    }
    frame = await reset();
    check(await frame.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mrt.state.v2')).read).length === 0), `${width}: reset discards temporary progress`);
    for (const index of width === 1280 ? [1, 2] : [1]) {
      await frame.$$eval('#library-yours-list a', (links, i) => links[i].click(), index);
      await frame.waitForSelector('#btn-hero-done', { visible: true });
      check((await frame.$eval('#hero-title', (el) => el.textContent)).includes(index === 1 ? 'Amazing Fantasy' : 'Avengers'), `${width}: sample selection ${index}`);
      if (width === 390 && index === 1) {
        await frame.focus('#hero-title');
        await page.keyboard.press('d');
        await frame.waitForFunction(() => document.querySelector('#demo-step').textContent.startsWith('3 of 3'));
        check(await frame.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mrt.state.v2')).read).length === 1), 'D shortcut updates actual sample progress and guide');
      }
      if (process.env.MRT_PAGE_SCREENSHOTS) {
        await frame.evaluate(async () => {
          const image = document.querySelector('#hero-img');
          try { await image.decode(); } catch { /* The app's text tile is the offline alternative. */ }
        });
        await page.$eval('#demo', (el) => window.scrollTo({ top: el.getBoundingClientRect().top + scrollY, behavior: 'instant' }));
        await page.screenshot({ path: join(process.env.MRT_PAGE_SCREENSHOTS, `project-page-${width}.png`) });
      }
      frame = await reset();
    }
    for (const media of [
      [{ name: 'prefers-color-scheme', value: 'light' }],
      [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }],
      [{ name: 'forced-colors', value: 'active' }],
    ]) {
      await page.emulateMediaFeatures(media);
      await frame.focus('#library-yours-list a');
      check(await frame.$eval('#library-yours-list a', (el) => getComputedStyle(el).outlineStyle !== 'none'), `${width}: visible keyboard focus with ${media[0].name}=${media[0].value}`);
      check(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: themed frame reflows`);
    }
    await page.emulateMediaFeatures([]);
  }
  check(errors.length === 0, `no page errors: ${errors.join('; ')}`);
  check(requests.every((url) => url.startsWith(origin) || url.startsWith('data:') || url.startsWith('https://i.annihil.us/')), 'no live API, reader or cloud requests');
  await page.setRequestInterception(true);
  const failDemo = (request) => request.url().includes('/demo.html') ? request.abort() : request.continue();
  page.on('request', failDemo);
  await page.goto(`${origin}/recap-page/`);
  await page.$eval('[data-tour-start]', (button) => button.click());
  await page.waitForFunction(() => document.querySelector('[data-tour-status]').textContent.includes('could not load'), { timeout: 25000 });
  check(await page.$eval('[data-tour-reset]', (el) => el.checkVisibility() && !el.disabled), 'failed load has a visible retry');
  page.off('request', failDemo);
  await page.setRequestInterception(false);
  const retried = await reset();
  check(await retried.evaluate(() => document.body.dataset.demoReady === 'true'), 'failed load can retry successfully');
  const direct = await browser.newPage();
  await direct.goto(`${origin}/recap-page/demo.html`);
  await direct.waitForFunction(() => document.querySelector('#demo-step').textContent.includes('Open the guided demo from the project homepage'));
  check(await direct.evaluate(() => !document.body.dataset.demoReady && localStorage.getItem('mrt.state.v2') === 'reader-data-must-not-change'), 'direct demo URL refuses to boot and leaves native storage untouched');
  await direct.close();
  console.log(`Project page: ${assertions} checks passed, 0 failed (desktop and phone Edge; sandbox and failure recovery).`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
