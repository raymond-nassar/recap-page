import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

// A pill is a short label. The notice's own sentence is 1,382 pixels of unwrapped text under
// .pill-held, past both the 964 pixel element and the 1,280 pixel viewport, which is not a state the
// app produces. Hosted runs 41163793598 and 41166118772 failed only this variant's byte comparison, in
// desktop light and dark, while every measurement matched.
const PILL_WORDS = 'Already in your library';

function staticText(node) {
  if (!node) return [];
  if (node.role === 'StaticText') return [node.name];
  return (node.children ?? []).flatMap(staticText);
}

async function checkText(page, t, selector, expected, symbol, label) {
  const root = await page.$(selector);
  const tree = await page.accessibility.snapshot({ root, interestingOnly: false });
  const words = staticText(tree);
  t.check(`${label}: accessibility exposes exactly the words, not ${symbol}`,
    tree !== null && !words.includes(symbol) && normalize(words.join(' ')) === normalize(expected),
    JSON.stringify(words));
}

async function measure(page, selector) {
  return page.$eval(selector, (element) => {
    const pseudo = getComputedStyle(element, '::before');
    const range = document.createRange();
    range.selectNodeContents(element);
    const box = (rect) => [rect.x, rect.y, rect.width, rect.height];
    return {
      glyph: pseudo.content.split(' / ')[0],
      pseudo: ['marginRight', 'color', 'fontFamily', 'fontSize', 'lineHeight', 'display', 'width', 'height']
        .map((key) => pseudo[key]),
      element: box(element.getBoundingClientRect()),
      text: [...range.getClientRects()].map(box),
    };
  });
}

async function layout(page) {
  return page.evaluate(() => ({
    gutterX: innerWidth - document.documentElement.clientWidth,
    gutterY: innerHeight - document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollX,
    scrollY,
  }));
}

// Byte equality stays the test. This only explains a failure: it decodes both captures in the page,
// with no image library, and counts the pixels that differ and the box around them.
async function comparePaint(page, first, second) {
  return page.evaluate(async (a, b) => {
    const decode = async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
    };
    const [left, right] = await Promise.all([decode(a), decode(b)]);
    const sizes = [[left.width, left.height], [right.width, right.height]];
    if (left.width !== right.width || left.height !== right.height) return { sizes, differing: null, box: null };
    let differing = 0;
    let box = null;
    for (let y = 0; y < left.height; y += 1) {
      for (let x = 0; x < left.width; x += 1) {
        const at = (y * left.width + x) * 4;
        if (left.data[at] === right.data[at] && left.data[at + 1] === right.data[at + 1]
          && left.data[at + 2] === right.data[at + 2] && left.data[at + 3] === right.data[at + 3]) continue;
        differing += 1;
        box = box
          ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]
          : [x, y, x, y];
      }
    }
    return { sizes, differing, box: box && { x: box[0], y: box[1], width: box[2] - box[0] + 1, height: box[3] - box[1] + 1 } };
  }, Buffer.from(first).toString('base64'), Buffer.from(second).toString('base64'));
}

let keptPaint = null;
async function keepPaint(label, first, second) {
  keptPaint ??= mkdtemp(join(tmpdir(), 'recap-decorative-paint-'));
  const directory = await keptPaint;
  const stem = label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const files = [join(directory, `${stem}.original.png`), join(directory, `${stem}.fallback.png`)];
  await writeFile(files[0], first);
  await writeFile(files[1], second);
  return files;
}

async function checkPaint(page, t, selector, ruleSelector, glyph, label) {
  const element = await page.$(selector);
  const before = await measure(page, selector);
  const layouts = { original: await layout(page) };
  const painted = await element.screenshot();
  layouts.originalAfter = await layout(page);
  // Change only the alternative text, leaving the glyph and every other declaration alone.
  const content = await page.evaluate((selector) => {
    const rule = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
      .find((rule) => rule.selectorText === selector);
    if (!rule) throw new Error(`Missing decorative rule: ${selector}`);
    const original = rule.style.content;
    rule.style.content = original.split(' / ')[0];
    return original;
  }, ruleSelector);
  try {
    const fallback = await measure(page, selector);
    layouts.fallback = await layout(page);
    const fallbackPaint = await element.screenshot();
    layouts.fallbackAfter = await layout(page);
    const samePixels = Buffer.from(painted).equals(Buffer.from(fallbackPaint));
    const detail = { before, fallback };
    if (!samePixels) {
      detail.pixels = await comparePaint(page, painted, fallbackPaint);
      detail.layouts = layouts;
      detail.kept = await keepPaint(label, painted, fallbackPaint);
    }
    t.check(`${label}: glyph, spacing, color, boxes and pixels match the original content`,
      before.glyph === JSON.stringify(glyph) && isDeepStrictEqual(before, fallback) && samePixels,
      JSON.stringify(detail));
  } finally {
    await page.evaluate((selector, value) => {
      const rule = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
        .find((rule) => rule.selectorText === selector);
      rule.style.content = value;
    }, ruleSelector, content);
  }
}

export const decorativeGeneratedText = {
  id: 'decorative-generated-text',
  title: 'decorative CSS symbols stay painted but do not enter accessible text',
  async run(page, t) {
    await page.goto(`${page.__origin}/#/home`, { waitUntil: 'load' });
    await page.waitForSelector('#reader-closure-notice', { visible: true });
    const notice = '#reader-closure-notice';
    const original = await page.$eval(notice, (element) => ({
      className: element.className, words: element.querySelector('#reader-closure-text').textContent,
    }));
    const variants = [
      ['notice notice-warn', '.notice-warn::before', '\u25b2'],
      ['notice notice-ok', '.notice-ok::before', '\u2713'],
      ['notice notice-error', '.notice-error::before', '\u00d7'],
      ['notice notice-busy', '.notice-busy::before', '\u2022'],
      ['pill-held', '.pill-held::before', '\u2713 '],
    ];
    const client = await page.createCDPSession();
    const modes = [
      { name: 'desktop dark', width: 1280, theme: 'dark', forced: 'none' },
      { name: 'desktop light', width: 1280, theme: 'light', forced: 'none' },
      { name: 'narrow system', width: 390, theme: null, forced: 'none' },
      { name: 'forced colors and reduced motion', width: 1280, theme: null, forced: 'active' },
    ];
    for (const mode of modes) {
      await page.setViewport({ width: mode.width, height: 900 });
      await page.evaluate((theme) => {
        if (theme) document.documentElement.dataset.theme = theme;
        else document.documentElement.removeAttribute('data-theme');
      }, mode.theme);
      await client.send('Emulation.setEmulatedMedia', { features: [
        { name: 'forced-colors', value: mode.forced },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ] });
      await page.evaluate(() => { location.hash = '#/home'; });
      await page.waitForSelector('#view-home:not([hidden])');
      for (const [className, rule, glyph] of variants) {
        await page.$eval(notice, (element, value) => { element.className = value; }, className);
        const words = className === 'pill-held' ? PILL_WORDS : original.words;
        await page.$eval('#reader-closure-text', (element, value) => { element.textContent = value; }, words);
        const label = `${mode.name} ${rule}`;
        await checkText(page, t, notice, words, glyph, label);
        if (rule === '.notice-warn::before') {
          const { nodes } = await client.send('Accessibility.getFullAXTree');
          t.check(`${mode.name}: Home exposes no triangle node`,
            !nodes.some((node) => !node.ignored && node.name?.value === glyph));
        }
        await checkPaint(page, t, notice, rule, glyph, label);
      }
      await page.$eval(notice, (element, value) => { element.className = value; }, original.className);
      await page.$eval('#reader-closure-text', (element, value) => { element.textContent = value; }, original.words);
      await page.evaluate(() => { location.hash = '#/add-search'; });
      const breadcrumb = '#view-add-search > .breadcrumb';
      await page.waitForSelector(breadcrumb, { visible: true });
      const words = await page.$$eval(`${breadcrumb} li`, (items) => items.map((item) => item.textContent).join(' '));
      await checkText(page, t, breadcrumb, words, '/', `${mode.name} breadcrumb`);
      await checkPaint(page, t, `${breadcrumb} li + li`, '.breadcrumb li + li::before', '/', `${mode.name} breadcrumb`);
    }
    await client.detach();
  },
};
