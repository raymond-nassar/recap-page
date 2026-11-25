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

// The owner allowed differences too faint to see, no more than 8 shades out of 255 in any channel of
// any pixel, after hosted runs 44440853105 and 44444275631 failed six variants with byte-identical
// samples 1 to 4 levels apart while run 44436509980 passed them all. Decoded in the page with no image
// library, both captures the same way and raw, so the browser neither converts color nor premultiplies
// alpha before the comparison. It also counts the pixels that differ and the box around them.
const PAINT_TOLERANCE = 8;
async function comparePaint(page, first, second) {
  return page.evaluate(async (a, b, tolerance) => {
    const decode = async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }),
        { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
    };
    const [left, right] = await Promise.all([decode(a), decode(b)]);
    const sizes = [[left.width, left.height], [right.width, right.height]];
    // Captures of different sizes are compared over the larger of the two, and a pixel present in only
    // one of them counts as differing, so a size change still yields a count and a box. A coordinate
    // inside neither capture, which crossed sizes such as 2x1 and 1x2 leave, is not a pixel at all.
    const width = Math.max(left.width, right.width);
    const height = Math.max(left.height, right.height);
    const pixel = (image, x, y) => (x < image.width && y < image.height ? (y * image.width + x) * 4 : -1);
    let differing = 0;
    let maxDifference = 0;
    let box = null;
    const samples = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const l = pixel(left, x, y);
        const r = pixel(right, x, y);
        if (l < 0 && r < 0) continue;
        if (l >= 0 && r >= 0) {
          let largest = 0;
          for (let channel = 0; channel < 4; channel += 1) {
            largest = Math.max(largest, Math.abs(left.data[l + channel] - right.data[r + channel]));
          }
          if (largest === 0) continue;
          maxDifference = Math.max(maxDifference, largest);
        } else {
          maxDifference = 255;
        }
        differing += 1;
        if (samples.length < 12) {
          samples.push([x, y, l < 0 ? null : [...left.data.slice(l, l + 4)], r < 0 ? null : [...right.data.slice(r, r + 4)]]);
        }
        box = box
          ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]
          : [x, y, x, y];
      }
    }
    const sameSize = left.width === right.width && left.height === right.height;
    return {
      sizes, sameSize, differing, maxDifference, tolerance, withinTolerance: sameSize && maxDifference <= tolerance,
      samples, box: box && { x: box[0], y: box[1], width: box[2] - box[0] + 1, height: box[3] - box[1] + 1 },
    };
  }, Buffer.from(first).toString('base64'), Buffer.from(second).toString('base64'), PAINT_TOLERANCE);
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

// Puppeteer's default capture beyond the viewport drops Edge 157's emulated forced colors palette while
// the media query keeps matching (#1209): measured locally, a pseudo-element read as CanvasText before
// the first capture and as its authored color after it. So every later forced colors reading and
// capture here was of unforced style, and the first variant failed only its color, hosted run
// 43689605558 included. Capturing within the viewport keeps the palette, and every element captured
// here lies inside the 1,280 by 900 viewport.
const capture = (element) => element.screenshot({ captureBeyondViewport: false });

// Hosted run 44426231195 failed narrow system .notice-warn with six pixels around the dismiss button
// differing by 1 to 4 levels. Settling each side alone did not cure it: hosted run 44431014589 had
// both sides agree with themselves on the second capture and still differ from each other, with a
// later capture matching the fallback rather than the original, and narrow .pill-held failed the
// same way along its edge. So the difference is between the first paint and the repaint that any
// rule change causes, not between the two contents. The original is therefore captured again after
// its rule is restored, so both sides come from that repaint, compared within the owner's tolerance.
// Each side is still captured until two consecutive captures agree, bounded at ten.
async function settledCapture(element) {
  let previous = await capture(element);
  for (let attempt = 1; attempt < 10; attempt += 1) {
    const next = await capture(element);
    if (Buffer.from(next).equals(Buffer.from(previous))) return { paint: next, attempts: attempt + 1 };
    previous = next;
  }
  return { paint: previous, attempts: 10, settled: false };
}

async function checkPaint(page, t, selector, ruleSelector, glyph, label) {
  const element = await page.$(selector);
  const before = await measure(page, selector);
  const layouts = { original: await layout(page) };
  const original = await settledCapture(element);
  layouts.originalAfter = await layout(page);
  const setContent = (value) => page.evaluate((selector, value) => {
    const rule = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
      .find((rule) => rule.selectorText === selector);
    if (!rule) throw new Error(`Missing decorative rule: ${selector}`);
    const previous = rule.style.content;
    rule.style.content = value ?? previous.split(' / ')[0];
    return previous;
  }, ruleSelector, value);
  // Change only the alternative text, leaving the glyph and every other declaration alone.
  const content = await setContent(null);
  try {
    const fallback = await measure(page, selector);
    layouts.fallback = await layout(page);
    const fallbackCapture = await settledCapture(element);
    const fallbackPaint = fallbackCapture.paint;
    layouts.fallbackAfter = await layout(page);
    await setContent(content);
    const restored = await measure(page, selector);
    const restoredCapture = await settledCapture(element);
    const painted = restoredCapture.paint;
    layouts.restoredAfter = await layout(page);
    const identical = Buffer.from(painted).equals(Buffer.from(fallbackPaint));
    const detail = { before, fallback, restored };
    let samePixels = identical;
    if (!identical) {
      detail.layouts = layouts;
      detail.captures = {
        original: original.attempts, fallback: fallbackCapture.attempts, restored: restoredCapture.attempts,
      };
      detail.firstPaintSame = Buffer.from(original.paint).equals(Buffer.from(painted));
      // Kept first, so a decoding failure below still leaves both captures to inspect.
      detail.kept = await keepPaint(label, painted, fallbackPaint).catch((error) => ({ error: String(error?.message ?? error) }));
      detail.pixels = await comparePaint(page, painted, fallbackPaint).catch((error) => ({ error: String(error?.message ?? error) }));
      detail.hasFocus = await page.evaluate(() => document.hasFocus());
      samePixels = detail.pixels.withinTolerance === true;
    }
    t.check(`${label}: glyph, spacing, color, boxes and pixels match the original content`,
      before.glyph === JSON.stringify(glyph) && isDeepStrictEqual(before, fallback)
        && isDeepStrictEqual(before, restored) && samePixels,
      JSON.stringify(detail));
  } finally {
    await setContent(content);
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
