import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const lists = catalog.lists.filter((list) => list.group === 'civil-war');
const orders = Object.fromEntries(lists.map((list) => [
  list.file, JSON.parse(readFileSync(new URL(`../src/data/${list.file}`, import.meta.url), 'utf8')),
]));
const selectedId = 'civil-war-avengers';
const selected = lists.find((list) => list.id === selectedId);
const radio = `#preview-paths input[data-key="${selectedId}"]`;
const opener = '#catalog-results [data-story="civil-war"] [data-act="preview"]';

async function stationaryRadio(page) {
  return page.evaluate(async () => {
    const target = document.activeElement;
    if (!target.matches('#preview-paths input')) throw new Error('Expected a focused Preview radio');
    const box = (element) => {
      const r = element.getBoundingClientRect();
      return [r.left, r.top, r.right, r.bottom];
    };
    const sample = () => {
      const dialog = document.querySelector('#preview');
      const visual = target.nextElementSibling;
      const style = getComputedStyle(visual);
      const ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      const r = box(dialog);
      const clip = [
        Math.max(0, r[0] + dialog.clientLeft), Math.max(0, r[1] + dialog.clientTop),
        Math.min(innerWidth, r[0] + dialog.clientLeft + dialog.clientWidth),
        Math.min(innerHeight, r[1] + dialog.clientTop + dialog.clientHeight),
      ];
      const v = box(visual);
      return {
        same: document.activeElement === target, key: target.dataset.key, checked: target.checked,
        focusVisible: target.matches(':focus-visible'), native: box(target),
        label: box(target.closest('label')), visual: v, clip, ring,
        outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset,
        scroll: [dialog.scrollTop, document.querySelector('#preview-body').scrollTop],
        visible: v[0] - ring >= clip[0] && v[1] - ring >= clip[1]
          && v[2] + ring <= clip[2] && v[3] + ring <= clip[3],
      };
    };
    const samples = [];
    const deadline = performance.now() + 2000;
    let consecutive = 0;
    let previous = '';
    while (performance.now() < deadline && consecutive < 8) {
      await new Promise(requestAnimationFrame);
      const value = sample();
      samples.push(value);
      const signature = JSON.stringify(value);
      consecutive = signature === previous ? consecutive + 1 : 0;
      previous = signature;
    }
    return { settled: consecutive >= 8, samples, last: samples.at(-1) };
  });
}

async function checkFocusedControl(page, t, name) {
  const state = await page.evaluate(() => {
    const e = document.activeElement;
    const r = e.getBoundingClientRect();
    const d = document.querySelector('#preview').getBoundingClientRect();
    const b = e.closest('#preview-body')?.getBoundingClientRect();
    return {
      key: e.dataset.key, act: e.dataset.act, id: e.id, tag: e.tagName,
      focus: e.matches(':focus-visible'), outline: getComputedStyle(e).outlineStyle,
      visible: r.width > 0 && r.height > 0
        && r.left >= Math.max(0, d.left, b?.left ?? 0) - 1
        && r.top >= Math.max(0, d.top, b?.top ?? 0) - 1
        && r.right <= Math.min(innerWidth, d.right, b?.right ?? innerWidth) + 1
        && r.bottom <= Math.min(innerHeight, d.bottom, b?.bottom ?? innerHeight) + 1,
    };
  });
  t.check(name, state.focus && state.outline !== 'none' && state.visible, JSON.stringify(state));
}

async function openPreview(page) {
  await page.waitForSelector(opener, { visible: true });
  await page.focus(opener);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#preview[open]');
}

async function closePreview(page, t, name, escape) {
  if (!escape) await page.focus('#preview-close');
  await page.keyboard.press(escape ? 'Escape' : 'Enter');
  await page.waitForFunction(() => {
    const current = document.querySelector('#catalog-results [data-story="civil-war"] [data-act="preview"]');
    return !document.querySelector('#preview').open && current?.isConnected
      && current.checkVisibility() && document.activeElement === current;
  });
  const returned = await page.evaluate(async () => {
    for (let n = 0; n < 8; n += 1) await new Promise(requestAnimationFrame);
    const current = document.querySelector('#catalog-results [data-story="civil-war"] [data-act="preview"]');
    return !document.querySelector('#preview').open && current?.isConnected
      && current.checkVisibility() && document.activeElement === current;
  });
  t.check(`${name}: ${escape ? 'Escape' : 'Close'} returns to the connected semantic opener`, returned);
}

export const previewScroll452 = {
  id: 'preview-scroll-452',
  title: 'Preview native radio focus reveals the entire option and its outline',
  async run(page, t) {
    await page.evaluateOnNewDocument((fixtureLists, fixtureOrders) => {
      const params = new URL(location.href).searchParams;
      const mode = params.get('preview452');
      if (!mode) return;
      localStorage.removeItem('mrt.state.v2');
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, theme: params.get('theme') }));
      const real = window.fetch.bind(window);
      const control = window.__preview452 = { mode, pending: [] };
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname.endsWith('/catalog.json')) {
          return Promise.resolve(new Response(JSON.stringify({ lists: fixtureLists, paths: [] })));
        }
        const file = url.pathname.split('/').at(-1);
        if (Object.hasOwn(fixtureOrders, file)) {
          if (control.mode === 'failure') return Promise.reject(new TypeError('Failed to fetch'));
          if (control.mode === 'pending') return new Promise((resolve) => {
            control.pending.push(() => resolve(new Response(JSON.stringify(fixtureOrders[file]))));
          });
          return Promise.resolve(new Response(JSON.stringify(fixtureOrders[file])));
        }
        if (url.origin !== location.origin) return Promise.reject(new TypeError('Preview fixture blocks external metadata'));
        return real(input, init);
      };
    }, lists, orders);
    const cdp = await page.createCDPSession();
    for (const cfg of [
      { name: 'enlarged-loaded', width: 640, height: 450, scale: 2, mode: 'loaded', forced: true },
      { name: 'enlarged-pending', width: 640, height: 450, scale: 2, mode: 'pending', forced: true },
      { name: 'enlarged-failure', width: 640, height: 450, scale: 2, mode: 'failure', forced: true },
      { name: 'wrapped-option', width: 360, height: 600, scale: 1, mode: 'loaded' },
      { name: 'standard', width: 1280, height: 900, scale: 1, mode: 'loaded' },
      { name: 'narrow-dark', width: 800, height: 600, scale: 1, mode: 'loaded' },
    ]) {
      await page.setViewport({ width: cfg.width, height: cfg.height, deviceScaleFactor: cfg.scale });
      await cdp.send('Emulation.setEmulatedMedia', { features: [
        { name: 'forced-colors', value: cfg.forced ? 'active' : 'none' },
        { name: 'prefers-reduced-motion', value: cfg.forced ? 'reduce' : 'no-preference' },
      ] });
      const theme = cfg.name === 'narrow-dark' ? 'dark' : 'light';
      await page.goto(`${page.__origin}/?preview452=${cfg.mode}&theme=${theme}#/catalog`, { waitUntil: 'load' });
      await openPreview(page);
      await page.focus('#preview-paths input:checked');
      for (let n = 0; n < lists.length; n += 1) {
        if (await page.$eval(radio, (e) => e.checked)) break;
        await page.keyboard.press('ArrowRight');
      }
      if (cfg.mode === 'loaded') {
        await page.waitForFunction((count) => document.querySelectorAll('#preview-body .preview-issue-link').length === count,
          {}, selected.count);
      } else {
        await page.waitForFunction((text) => document.querySelector('#preview-body').textContent.includes(text),
          {}, cfg.mode === 'pending' ? 'Loading' : 'could not be loaded');
      }
      await page.focus('#preview-close');
      await page.keyboard.press('Tab');
      t.check(`${cfg.name}: Source precedes the selected option`,
        await page.evaluate(() => document.activeElement.matches('#preview-source summary')));
      await page.keyboard.press('Tab');
      const stationary = await stationaryRadio(page);
      t.check(`${cfg.name}: stationary selected Preview radio shows its full label and focus outline`,
        stationary.settled && stationary.last.same && stationary.last.focusVisible
        && stationary.last.key === selectedId && stationary.last.checked && stationary.last.visible,
        JSON.stringify(stationary));
      const geometry = await page.$eval(radio, (input) => {
        const label = input.closest('label');
        const r = input.getBoundingClientRect();
        const l = label.getBoundingClientRect();
        const hit = document.elementFromPoint(l.left + l.width / 2, l.top + l.height / 2);
        const style = getComputedStyle(input.nextElementSibling);
        return {
          contained: r.left >= l.left && r.top >= l.top && r.right <= l.right && r.bottom <= l.bottom,
          sameSize: Math.abs(r.width - l.width) < 1 && Math.abs(r.height - l.height) < 1,
          ownsHit: label.contains(hit),
          wrapped: input.nextElementSibling.clientHeight - parseFloat(style.paddingTop)
            - parseFloat(style.paddingBottom) > parseFloat(style.lineHeight) + 1,
        };
      });
      t.check(`${cfg.name}: native target fits its own label without stealing a neighbor`,
        geometry.contained && geometry.sameSize && geometry.ownsHit, JSON.stringify(geometry));
      if (cfg.name === 'wrapped-option') t.check('the actual Avengers option wraps', geometry.wrapped, JSON.stringify(geometry));
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Space');
      t.check(`${cfg.name}: native ArrowLeft and Space select the adjacent option`,
        await page.$eval('#preview-paths input:checked', (e) => e.dataset.key === 'civil-war'));
      await page.$eval(radio, (e) => e.closest('label').scrollIntoView({ block: 'center' }));
      const pointer = await page.$eval(radio, (e) => {
        const r = e.closest('label').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      await page.mouse.click(pointer.x, pointer.y);
      t.check(`${cfg.name}: real pointer click selects the full label`,
        await page.$eval(radio, (e) => e.checked));
      if (cfg.mode === 'failure') {
        await closePreview(page, t, cfg.name, false);
        continue;
      }
      await page.evaluate(() => {
        const c = window.__preview452;
        c.mode = 'loaded';
        c.pending.splice(0).forEach((finish) => finish());
      });
      await page.waitForFunction((count) => document.querySelectorAll('#preview-body .preview-issue-link').length === count,
        {}, selected.count);
      await page.focus('#preview-close');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await checkFocusedControl(page, t, `${cfg.name}: first issue boundary focus`);
      const links = await page.$$('#preview-body .preview-issue-link');
      await links.at(-1).focus();
      await checkFocusedControl(page, t, `${cfg.name}: last issue boundary focus`);
      await page.keyboard.press('Tab');
      await checkFocusedControl(page, t, `${cfg.name}: Add boundary focus`);
      await page.focus('#preview-add button');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#preview-add button')?.textContent.includes('Open'));
      const saved = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('mrt.state.v2')).lists)
        .map((l) => ({ id: l.catalogId, count: l.itemIds.length })));
      t.check(`${cfg.name}: Add saves only the selected actual variant`,
        saved.length === 1 && saved[0].id === selectedId && saved[0].count === selected.count, JSON.stringify(saved));
      await page.focus('#preview-add button');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('#preview').open && !document.querySelector('#view-read').hidden);
      t.check(`${cfg.name}: Open dismisses Preview into Reading`, true);
      await page.evaluate(() => { location.hash = '#/catalog'; });
      await openPreview(page);
      await closePreview(page, t, cfg.name, true);
    }
    await cdp.detach();
  },
};
