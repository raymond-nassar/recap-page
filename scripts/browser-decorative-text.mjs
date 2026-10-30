import { isDeepStrictEqual } from 'node:util';

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

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

async function checkPaint(page, t, selector, ruleSelector, glyph, label) {
  const element = await page.$(selector);
  const before = await measure(page, selector);
  const painted = await element.screenshot();
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
    const fallbackPaint = await element.screenshot();
    t.check(`${label}: glyph, spacing, color, boxes and pixels match the original content`,
      before.glyph === JSON.stringify(glyph) && isDeepStrictEqual(before, fallback)
        && Buffer.from(painted).equals(Buffer.from(fallbackPaint)),
      JSON.stringify({ before, fallback }));
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
        const label = `${mode.name} ${rule}`;
        await checkText(page, t, notice, original.words, glyph, label);
        if (rule === '.notice-warn::before') {
          const { nodes } = await client.send('Accessibility.getFullAXTree');
          t.check(`${mode.name}: Home exposes no triangle node`,
            !nodes.some((node) => !node.ignored && node.name?.value === glyph));
        }
        await checkPaint(page, t, notice, rule, glyph, label);
      }
      await page.$eval(notice, (element, value) => { element.className = value; }, original.className);
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
