import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { labelWords } from '../src/js/lib/accname.js';
import {
  catalogGapLabels, filterBySpotlightKind, firstSentence, groupCatalog, parseCatalog, searchCatalog,
  shelfLists, sortSpotlightStories, sourceLabel, sourceLink, updatedLabel,
} from '../src/js/lib/catalog.js';
import { KEY } from '../src/js/storage.js';

const AMAZING = 'amazing-spider-man-reading-order-modern-marvel-era';
export const catalogCardProfiles = [
  ...[320, 360, 412].map((width, index) => ({
    id: `M0${index + 1}`, width, height: width === 320 ? 740 : width === 360 ? 800 : 915,
    route: 'age-silver', list: AMAZING, theme: 'light',
  })),
  ...[320, 360, 412].map((width, index) => ({
    id: `M0${index + 4}`, width, height: width === 320 ? 740 : width === 360 ? 800 : 915,
    route: 'spotlights', list: AMAZING, theme: 'dark', image: width === 412,
  })),
  ...[320, 360, 412].map((width, index) => ({
    id: `M0${index + 7}`, width, height: width === 320 ? 740 : width === 360 ? 800 : 915,
    route: 'lines', list: 'ultimate-marvel-intro', theme: 'light',
  })),
  { id: 'M10', width: 360, height: 800, route: 'age-silver', list: AMAZING, theme: 'dark', textScale: 1.5 },
  { id: 'M11', width: 320, height: 740, route: 'catalog', theme: 'dark', textScale: 2 },
  { id: 'M12', width: 412, height: 915, route: 'spotlights', list: 'xmen-claremont', theme: 'light', textScale: 2 },
  { id: 'M13', width: 360, height: 800, route: 'lines', list: 'hickman-minimal', theme: 'dark', textScale: 1.5 },
  { id: 'M14', width: 800, height: 360, route: 'age-silver', list: AMAZING, theme: 'light' },
  { id: 'M15', width: 1280, height: 900, route: 'catalog', theme: 'light' },
  { id: 'M16', width: 1280, height: 900, route: 'catalog', theme: 'light', desktop: true },
];

async function geometry(page, selector) {
  return page.$eval(selector, (card) => {
    const box = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const main = card.querySelector('.catalog-card-main');
    const style = getComputedStyle(main);
    const mainBox = box(main);
    const left = mainBox.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const right = mainBox.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
    const title = card.querySelector('.catalog-card-title');
    const art = card.querySelector('.ocard-art');
    const parts = [...card.querySelector('.catalog-card-text').children].map((node) => {
      const bounds = box(node);
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const broken = [], clipped = [];
      let words = 0;
      while (walker.nextNode()) {
        const text = walker.currentNode;
        if (text.parentElement.closest('details:not([open])') && !text.parentElement.closest('summary')) continue;
        for (const match of text.textContent.matchAll(/[A-Za-z]+/g)) {
          const range = document.createRange();
          range.setStart(text, match.index);
          range.setEnd(text, match.index + match[0].length);
          const rects = [...range.getClientRects()].filter((rect) => rect.width && rect.height);
          if (!rects.length) continue;
          words++;
          if (new Set(rects.map((rect) => Math.round(rect.top))).size > 1) broken.push(match[0]);
          if (rects.some((rect) => rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) {
            clipped.push(match[0]);
          }
        }
      }
      return {
        className: node.className, text: node.textContent, hidden: node.hidden,
        bounds, words, broken, clipped, font: parseFloat(getComputedStyle(node).fontSize),
      };
    });
    const label = art.querySelector('.ofs');
    const range = document.createRange();
    range.selectNodeContents(label);
    const labelWordWidths = [...label.textContent.matchAll(/[A-Za-z]+/g)].map((match) => {
      const word = document.createRange();
      word.setStart(label.firstChild, match.index);
      word.setEnd(label.firstChild, match.index + match[0].length);
      return word.getBoundingClientRect().width;
    });
    const marker = card.querySelector('.timeline-position-current');
    const flow = card.closest('.timeline-flow');
    const nodes = flow ? [...flow.querySelectorAll('.timeline-year-marker')].map((node) => {
      const bounds = box(node);
      const dot = getComputedStyle(node, '::after'), stem = getComputedStyle(node, '::before');
      const rail = getComputedStyle(flow, '::before');
      const outerWidth = (css) => parseFloat(css.width) + (css.boxSizing === 'border-box' ? 0
        : parseFloat(css.paddingLeft) + parseFloat(css.paddingRight)
          + parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth));
      const dotWidth = outerWidth(dot);
      const translate = dot.transform === 'none' ? 0 : new DOMMatrixReadOnly(dot.transform).m41;
      return {
        year: node.textContent.trim(), empty: node.classList.contains('is-empty'),
        gap: !node.closest('.timeline-era'),
        rail: box(flow).left + parseFloat(rail.left) + outerWidth(rail) / 2,
        dot: bounds.left + parseFloat(dot.left) + dotWidth / 2 + translate,
        dotRight: bounds.left + parseFloat(dot.left) + dotWidth + translate,
        dotWidth, dotBoxSizing: dot.boxSizing,
        dotCssWidth: parseFloat(dot.width), dotTranslation: translate,
        dotLeft: bounds.left + parseFloat(dot.left),
        dotBorders: [parseFloat(dot.borderLeftWidth), parseFloat(dot.borderRightWidth)],
        dotPadding: [parseFloat(dot.paddingLeft), parseFloat(dot.paddingRight)],
        stemRight: stem.display === 'none' ? null : bounds.left + parseFloat(stem.left) + parseFloat(stem.width),
        textLeft: bounds.left,
      };
    }) : [];
    return {
      story: card.dataset.story, title: title.textContent, card: box(card), main: mainBox,
      content: { left, right, width: right - left }, art: box(art), titleBox: box(title),
      composition: { display: style.display, wrap: style.flexWrap,
        text: getComputedStyle(card.querySelector('.catalog-card-text')).display },
      marker: marker ? box(marker) : null, parts, nodes,
      label: { text: label.textContent, width: label.clientWidth, scroll: label.scrollWidth,
        lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
        widestWord: Math.max(0, ...labelWordWidths) },
      actions: [...card.querySelectorAll('.catalog-card-actions button')].map((node) => ({
        ...box(node), text: node.textContent, key: node.dataset.key, act: node.dataset.act,
      })),
      source: card.querySelector('.result-source a')?.getAttribute('href') ?? null,
      pathSummary: card.querySelector('.result-path > summary')?.getAttribute('aria-label') ?? null,
      body: parseFloat(getComputedStyle(document.body).fontSize),
      theme: document.documentElement.dataset.theme,
      android: !!document.querySelector('link[href="./android/mobile.css"]'),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
}

async function accessibleCard(page, selector) {
  const client = await page.createCDPSession();
  try {
    const { root } = await client.send('DOM.getDocument');
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { node } = await client.send('DOM.describeNode', { nodeId });
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    const byId = new Map(nodes.map((entry) => [entry.nodeId, entry]));
    const article = nodes.find((entry) => entry.backendDOMNodeId === node.backendNodeId);
    assert.ok(article, `Article must exist in accessibility tree: ${selector}`);
    const walk = (entry) => [
      ...(!entry.ignored && entry.name?.value ? [{ role: entry.role.value, name: entry.name.value }] : []),
      ...(entry.childIds ?? []).flatMap((id) => walk(byId.get(id))),
    ];
    return walk(article);
  } finally {
    await client.detach();
  }
}

async function captureCard(page, selector, profile) {
  if (!process.env.MRT_ANDROID_SCREENSHOTS || process.argv.some((arg) => arg.startsWith('--catalog-mutation='))) return;
  const clip = await page.$eval(selector, (card) => {
    const box = card.getBoundingClientRect();
    const year = card.closest('.timeline-year-row')?.getBoundingClientRect();
    const flow = card.closest('.timeline-flow')?.getBoundingClientRect();
    const x = Math.max(0, flow?.left ?? box.left);
    const y = Math.max(0, (year?.top ?? box.top) + scrollY);
    return { x, y, width: Math.min(innerWidth, box.right) - x, height: box.bottom + scrollY - y };
  });
  await mkdir(process.env.MRT_ANDROID_SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: join(process.env.MRT_ANDROID_SCREENSHOTS, `${profile.id}-catalog.png`), clip });
}

async function withoutCatalogComposition(page, selector) {
  const saved = await page.evaluate(() => {
    const sheet = [...document.styleSheets].find((entry) => entry.href?.endsWith('/android/mobile.css'));
    const index = [...sheet.cssRules].findIndex((rule) => rule instanceof CSSMediaRule
      && rule.conditionText === '(max-width: 700px)'
      && rule.cssText.includes('.catalog-card-text'));
    if (index === -1) return null;
    const css = sheet.cssRules[index].cssText;
    sheet.deleteRule(index);
    return { index, css };
  });
  assert.ok(saved, 'Only the new catalog composition block may be removed for the paired measurement');
  try {
    return await geometry(page, selector);
  } finally {
    await page.evaluate(({ index, css }) => {
      const sheet = [...document.styleSheets].find((entry) => entry.href?.endsWith('/android/mobile.css'));
      sheet.insertRule(css, index);
    }, saved);
  }
}

async function spotlightInteractions(page, catalog, check, click) {
  const mine = shelfLists(catalog.lists, 'spotlights');
  await click(page, 'input[name="spotlights-sort"][value="popularity"]');
  await click(page, 'input[name="spotlights-kind"][value="complete-guide"]');
  await page.type('#spotlights-q', 'Spider');
  const expected = sortSpotlightStories(groupCatalog(searchCatalog(filterBySpotlightKind(mine, 'complete-guide'), 'Spider')), 'popularity').map((story) => story.key);
  assert.ok(expected.length > 0);
  const actual = await page.evaluate(() => ({
    query: document.querySelector('#spotlights-q').value,
    kind: document.querySelector('input[name="spotlights-kind"]:checked').value,
    sort: document.querySelector('input[name="spotlights-sort"]:checked').value,
    keys: [...document.querySelectorAll('#spotlights-results .catalog-card')].map((node) => node.dataset.story),
  }));
  console.log(`CATALOG M05 interaction before wait: ${JSON.stringify({ expected, actual })}`);
  await page.waitForFunction((keys) => JSON.stringify([...document.querySelectorAll('#spotlights-results .catalog-card')]
    .map((node) => node.dataset.story)) === JSON.stringify(keys), {}, expected);
  check(true, 'M05: real kind, popularity and search preserve expected ordered keys');
  console.log(`CATALOG M05 interaction: ${JSON.stringify(expected)}`);
}

async function readingOptionInteractions(page, primary, catalog, check, click, route) {
  const button = `${primary} [data-act="preview"]`;
  const selected = catalog.lists.find((list) => list.id === 'hickman-full');
  const requests = [], failures = [];
  const onRequest = (request) => {
    if (new URL(request.url()).pathname.startsWith('/data/')) requests.push(request.url());
  };
  const onFailure = (request) => failures.push({ url: request.url(), error: request.failure()?.errorText });
  page.on('request', onRequest);
  page.on('requestfailed', onFailure);
  try {
    await page.focus(button);
    await click(page, button);
    await page.waitForSelector('#preview[open]');
    const first = catalog.lists.find((list) => list.id === 'hickman-minimal');
    check(await page.$eval('#preview-desc', (node, text) => node.textContent === text, first.description),
      'M13: full Preview description remains accessible');
    check(await page.$eval('#preview-source', (node, credit) => node.textContent.includes(credit), first.sourceOrigin),
      'M13: full Preview provenance retained');
    await click(page, '#preview-paths input[data-key="hickman-full"]');
    await page.waitForFunction((text) => document.querySelector('#preview-desc').textContent === text, {}, selected.description);
    await click(page, '#preview-close');
    await page.waitForSelector('#preview:not([open])');
    const add = `${primary} [data-act="import"][data-key="${selected.id}"]:not([disabled])`;
    await page.waitForSelector(add);
    check(await page.$eval(button, (node) => document.activeElement === node), 'M13: Preview close restores card action focus');
    console.log(`CATALOG M13 before Add: ${JSON.stringify(await page.$eval(add, (node, key) => ({
      key: node.dataset.key, act: node.dataset.act, disabled: node.disabled, route: location.hash,
      stateAbsent: localStorage.getItem(key) === null,
      dialogs: [...document.querySelectorAll('dialog[open]')].map((dialog) => dialog.id),
    }), KEY))}; file=${selected.file}`);
    const response = page.waitForResponse((result) => (
      new URL(result.url()).pathname === `/data/${selected.file}`
    ), { timeout: 5000 });
    const [result] = await Promise.all([response, click(page, add)]);
    const order = await result.json();
    check(result.ok() && Array.isArray(order.items) && order.items.length > 0,
      'M13: exact selected local catalog file loaded for Add');
    console.log(`CATALOG M13 Add response: ${JSON.stringify({
      path: new URL(result.url()).pathname, status: result.status(), name: order.name, items: order.items.length,
    })}`);
    await page.waitForFunction((id, key) => {
      const raw = localStorage.getItem(key);
      if (raw === null) return false;
      return Object.values(JSON.parse(raw).lists).some((list) => list.catalogId === id);
    }, { timeout: 5000 }, selected.id, KEY);
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    const imported = Object.values(saved.lists).find((list) => list.catalogId === selected.id);
    check(imported.name === order.name && JSON.stringify(imported.itemIds)
      === JSON.stringify([...new Set(order.items.map((item) => item.issueId))])
      && Object.keys(saved.read).length === 0, 'M13: Add preserves exact selected issue order without marking read');
    await route(page, 'lines');
    await page.waitForSelector(`${primary} [data-act="open"][data-key="${selected.id}"]`);
    check(true, 'M13: selected reading option adds exact list and becomes Open');
  } catch (error) {
    console.error('CATALOG M13 diagnostic', JSON.stringify({
      expected: { key: selected.id, file: selected.file }, requests, failures,
      actual: await page.evaluate((key) => ({
        route: location.hash,
        state: localStorage.getItem(key) === null ? null
          : Object.values(JSON.parse(localStorage.getItem(key)).lists).map((list) => ({ name: list.name, catalogId: list.catalogId })),
        dialogs: [...document.querySelectorAll('dialog[open]')].map((node) => ({ id: node.id, text: node.textContent.slice(0, 800) })),
        reports: [...document.querySelectorAll('.report, #android-report')].map((node) => node.textContent).filter(Boolean),
        actions: [...document.querySelectorAll('#view-lines .catalog-card[data-story="hickman-secret-wars"] button')]
          .map((node) => ({ key: node.dataset.key, act: node.dataset.act, disabled: node.disabled, text: node.textContent })),
      }), KEY),
    }));
    throw error;
  } finally {
    page.off('request', onRequest);
    page.off('requestfailed', onFailure);
  }
}

export async function catalogCardReadability({ page, viewport: profile, catalog: rawCatalog, check: reportCheck, route, click }) {
  const catalog = parseCatalog(rawCatalog);
  const check = (passed, message) => {
    if (!passed) console.log(`FAIL ${message}`);
    reportCheck(passed, message);
  };
  const prefix = profile.id;
  const compact = !profile.desktop && profile.width <= 700;
  const scale = profile.textScale ?? 1;
  const stories = groupCatalog(catalog.lists);
  const selectorFor = (id) => {
    const story = stories.find((entry) => entry.lists.some((list) => list.id === id));
    assert.ok(story, `Real catalog fixture missing: ${id}`);
    return `#view-${profile.route} .catalog-card[data-story="${story.key}"]`;
  };
  await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, profile.theme);
  await route(page, profile.route);
  await page.waitForSelector(`#view-${profile.route} .catalog-card`);
  if (process.argv.includes('--catalog-interactions-only')) {
    assert.ok(['M05', 'M13'].includes(profile.id), 'Interaction-only continuation must name its aimed-at case');
    if (profile.id === 'M05') await spotlightInteractions(page, catalog, check, click);
    else await readingOptionInteractions(page, selectorFor(profile.list), catalog, check, click, route);
    return;
  }
  const primary = profile.list ? selectorFor(profile.list)
    : '#catalog-results .catalog-card[aria-current="step"]';
  await page.waitForSelector(primary);
  await page.evaluate(() => document.fonts.ready);
  const mutation = process.argv.find((arg) => arg.startsWith('--catalog-mutation='))?.split('=')[1];
  if (mutation) {
    assert.ok(['side-column', 'double-gutter'].includes(mutation), 'Unknown catalog mutation');
    assert.equal(profile.id, mutation === 'side-column' ? 'M02' : 'M01', 'Mutation must run only its aimed-at case');
    await page.evaluate((kind) => {
      const sheet = [...document.styleSheets].find((entry) => entry.href?.endsWith('/android/mobile.css'));
      if (kind === 'side-column') {
        sheet.insertRule('.catalog-card-main { flex-wrap: nowrap !important; }', sheet.cssRules.length);
        sheet.insertRule('.catalog-card-text { display: block !important; }', sheet.cssRules.length);
      } else {
        sheet.insertRule('.timeline-era .timeline-year-row { padding-left: var(--space-9) !important; }', sheet.cssRules.length);
      }
    }, mutation);
  }
  if (profile.image) {
    await page.$eval(primary, async (card) => {
      document.body.classList.remove('nocovers');
      const image = card.querySelector('.ocard-art img');
      image.src = new URL('/__catalog-cover.svg', location.href).href;
      image.hidden = false;
      card.querySelector('.cover-fallback').classList.remove('show');
      await image.decode();
    });
    check(await page.$eval(primary, (card) => {
      const image = card.querySelector('img');
      return image.complete && image.naturalWidth > 0 && image.getClientRects().length > 0
        && card.querySelector('.cover-fallback').getClientRects().length === 0;
    }), `${prefix}: decoded original test image geometry, fallback hidden`);
  }
  if (profile.id === 'M13') await click(page, `${primary} .result-path > summary`);

  const selectors = [primary];
  if (profile.route === 'age-silver' && compact && await page.$(selectorFor('xmen-claremont'))) {
    selectors.push(selectorFor('xmen-claremont'));
  }
  if (profile.route === 'lines' && profile.list !== 'hickman-minimal') selectors.push(selectorFor('hickman-minimal'));
  if (profile.id === 'M11') selectors.push(
    '#modern-timeline-feature .catalog-card',
    selectorFor('revolutionary-war'), selectorFor('marvel-knights-to-planet-x-62'),
  );
  if (profile.id === 'M12') selectors.push(selectorFor('ultimate-spider-man-reading-order'));
  const evidence = [];
  for (const selector of selectors) {
    await page.waitForSelector(selector);
    const item = await geometry(page, selector);
    const list = catalog.lists.find((entry) => entry.id === item.actions[0]?.key);
    assert.ok(list, `${prefix}: action identifies a real list`);
    const story = stories.find((entry) => entry.key === item.story);
    const title = story?.name ?? list.name;
    const desc = item.parts.find((part) => part.className === 'catalog-card-desc');
    const meta = item.parts.find((part) => part.className === 'catalog-card-meta');
    const source = item.parts.find((part) => part.className === 'result-source');
    const name = `${prefix} ${list.id}`;
    check(item.card.width > 0 && item.art.width > 0 && item.actions.length === 2, `${name}: real complete card exists`);
    check(item.android === !profile.desktop && item.body === (profile.desktop ? 14 : 16 * scale)
      && item.theme === profile.theme, `${name}: actual entry, theme and text-token scale`);
    check(item.title === title && desc.text === firstSentence(list.description)
      && meta.text === [`${list.count} issue${list.count === 1 ? '' : 's'}`, ...catalogGapLabels(list)].join(' \u00b7 '),
    `${name}: exact title, description, count and gap text retained`);
    check(item.source === sourceLink(list) && source.text.includes(updatedLabel(list)),
      `${name}: source destination and snapshot retained`);
    check(!item.overflow, `${name}: no document overflow`);
    for (const part of item.parts.filter((entry) => !entry.hidden && entry.bounds.width)) {
      check(part.words > 0 && part.clipped.length === 0, `${name}: ${part.className} text remains inside its own box ${JSON.stringify(part.clipped)}`);
      if (part.className !== 'result-source') check(part.broken.length === 0,
        `${name}: ${part.className} ordinary words stay whole ${JSON.stringify(part.broken)}`);
      if (compact && part.className !== 'catalog-card-title') {
        check(Math.abs(part.bounds.left - item.content.left) <= 1
          && Math.abs(part.bounds.right - item.content.right) <= 1,
        `${name}: AC01 ${part.className} spans usable inner width (${part.bounds.width}/${item.content.width})`);
      }
    }
    check(item.actions.every((button) => button.width >= 48 && button.height >= (profile.desktop ? 44 : 48)),
      `${name}: action hit areas retained`);
    if (compact) {
      const timeline = item.nodes.length > 0;
      check(item.card.width >= profile.width - 32 - (timeline ? 32 : 0) - 1,
        `${name}: AC02 only one timeline inset (${item.card.width})`);
      check(desc.bounds.top >= Math.max(item.art.bottom, item.titleBox.bottom) - 1,
        `${name}: prose starts below artwork/title`);
      check(Math.abs(item.art.top - item.titleBox.top) <= 1
        || (item.titleBox.top >= item.art.bottom - 1 && Math.abs(item.titleBox.width - item.content.width) <= 1),
      `${name}: title shares header or reflows at full width`);
      if (item.marker) check(item.marker.bottom <= Math.min(item.art.top, item.titleBox.top) + 1,
        `${name}: position marker precedes artwork/title`);
      check(Math.abs(item.art.height / item.art.width - 1.5) < .01, `${name}: original 2:3 artwork geometry`);
      if (!profile.image) check(item.label.scroll <= item.label.width + 1, `${name}: decorative label has no horizontal clipping`);
      if (timeline) {
        check(item.nodes.length > 0 && item.nodes.every((node) => Math.abs(node.dot - node.rail) <= 2
          && node.dotRight <= node.textLeft && (node.stemRight === null || node.stemRight < node.textLeft)),
        `${name}: normal/empty/gap year markers align with rail and clear text`);
        const years = item.nodes.map((node) => Number(node.year.match(/\d{4}/)?.[0]));
        check(years.every((year, index) => Number.isInteger(year) && (!index || year > years[index - 1])),
          `${name}: chronological year headings retained`);
      }
    }
    const ax = await accessibleCard(page, selector);
    const ordered = [
      ...(item.marker ? [ax.findIndex((node) => node.name.toLowerCase() === 'you are here')] : []),
      ax.findIndex((node) => node.role === 'heading' && node.name === title),
      ax.findIndex((node) => node.role === 'StaticText' && node.name === desc.text),
      ax.findIndex((node) => node.role === 'StaticText' && node.name === meta.text),
      ...(item.pathSummary ? [ax.findIndex((node) => node.role === 'DisclosureTriangle'
        && node.name === item.pathSummary)] : []),
      ax.findIndex((node) => item.source
        ? node.role === 'link' && node.name.startsWith(`Source of ${list.name}:`)
        : node.role === 'StaticText' && node.name === sourceLabel(list)),
      ...item.actions.map((action) => ax.findIndex((node) => node.role === 'button' && node.name.startsWith(labelWords(action.text)))),
    ];
    check(ordered.every((index, at) => index >= 0 && (!at || index > ordered[at - 1]))
      && !ax.some((node) => node.role === 'image'), `${name}: meaningful accessibility order and empty-image-alt semantics`);
    if (process.env.MRT_CATALOG_BASELINE && Number(profile.id.slice(1)) <= 13) {
      const previous = JSON.parse(await readFile(join(process.env.MRT_CATALOG_BASELINE, `${prefix}.json`), 'utf8'))
        .find((entry) => entry.story === item.story);
      assert.ok(previous, `${name}: retained baseline is required, not silently skipped`);
      const leading = (nodes) => nodes.slice(0, nodes.findIndex((node) => node.role === 'heading'))
        .filter((node) => node.role !== 'InlineTextBox');
      check(JSON.stringify(leading(ax)) === JSON.stringify(leading(previous.ax)),
        `${name}: pre-existing decorative accessibility branch is unchanged, not claimed hidden`);
    }
    evidence.push({ ...item, ax });
  }
  if (profile.id === 'M02') {
    check(await page.$eval(`${primary} .catalog-card-desc`, (node) => {
      const wasHidden = node.hidden;
      try { node.hidden = true; return node.getClientRects().length === 0; }
      finally { node.hidden = wasHidden; }
    }), `${prefix}: hidden description retains zero layout rectangles`);
  }
  if (profile.id === 'M11') {
    check(evidence[0].nodes.some((node) => node.empty) && evidence[0].nodes.some((node) => node.gap),
      `${prefix}: actual empty and inter-era gap year rows exercised`);
  }
  await captureCard(page, primary, profile);
  if (['M14', 'M15'].includes(profile.id)) {
    const before = await withoutCatalogComposition(page, primary), after = evidence[0];
    check(['card', 'art', 'titleBox', 'content'].every((key) => ['width', 'height']
      .filter((axis) => axis in before[key]).every((axis) => Math.abs(before[key][axis] - after[key][axis]) <= 1)),
    `${prefix}: wide geometry matches paired measurement with only new catalog CSS removed`);
    evidence.push({ pairedWithoutCatalogComposition: before });
  }
  if (profile.desktop) {
    check(!evidence[0].android && evidence[0].art.width === 92
      && evidence[0].composition.display === 'flex' && evidence[0].composition.wrap === 'nowrap'
      && evidence[0].composition.text === 'block'
      && Math.abs(evidence[0].parts.find((part) => part.className === 'catalog-card-desc').bounds.left - evidence[0].art.right - 12) <= 1,
    `${prefix}: actual desktop keeps original artwork and side-column geometry`);
  }
  if (process.env.MRT_CATALOG_EVIDENCE) {
    await mkdir(process.env.MRT_CATALOG_EVIDENCE, { recursive: true });
    await writeFile(join(process.env.MRT_CATALOG_EVIDENCE, `${prefix}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(`CATALOG ${prefix}: ${JSON.stringify(evidence.filter((item) => item.story).map((item) => ({
    story: item.story, card: item.card.width, height: item.card.height,
    prose: item.parts.find((part) => part.className === 'catalog-card-desc').bounds.width,
    art: item.art.width, label: item.label, body: item.body,
  })))}`);

  if (profile.id === 'M03' && !mutation) {
    for (const width of [700, 701]) {
      await page.setViewport({ width, height: 900, isMobile: true, hasTouch: true });
      const item = await geometry(page, primary);
      check(!item.overflow, `${prefix}: ${width}px breakpoint has no overflow`);
      check(width === 700
        ? Math.abs(item.parts.find((part) => part.className === 'catalog-card-desc').bounds.width - item.content.width) <= 1
        : item.art.width === 92, `${prefix}: ${width}px expected compact boundary`);
    }
  }
  if (profile.id === 'M05' && !mutation) {
    await spotlightInteractions(page, catalog, check, click);
  }
  if (profile.id === 'M13' && !mutation) {
    await readingOptionInteractions(page, primary, catalog, check, click, route);
  }
}
