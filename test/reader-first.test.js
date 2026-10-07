import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createSynopsisDisclosure, renderSynopsisDescription } from '../src/js/lib/synopsisDisclosure.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('../src/index.html');
const add = read('../src/js/views/add.js');
const catalog = read('../src/js/views/shared/catalog-presentation.js');

test('shared reader handoff visibly distinguishes conditional intent and exact refusals without writes or focus', () => {
  const source = read('../src/js/main.js');
  const start = source.indexOf('function openInReader(');
  const end = source.indexOf('\n// ------------------------------------------------------------------ synopsis', start);
  assert.ok(start >= 0 && end > start, 'Actual shared function must be extractable');
  const helper = { hidden: true, textContent: '' };
  const issue = { title: 'Browser Check (2026) #2' };
  const events = [];
  let outcome = { ok: true, issue };
  let opened = { ok: true, target: 'reader', window: null };
  const state = { read: { 900002: false }, listOrder: ['fixture'] };
  const before = JSON.stringify(state);
  const context = {
    $: (selector) => { assert.equal(selector, '#reader-handoff-help'); return helper; },
    store: { state }, temporaryReaderLinks: { resolve: () => outcome },
    openIssueTab: () => { events.push('open'); return opened; },
    announce: (message) => events.push(message),
  };
  runInNewContext(`${source.slice(start, end)}\nthis.open = openInReader;`, context);
  const rows = [];
  const measure = (name, expected, actual) => {
    const ok = JSON.stringify(expected) === JSON.stringify(actual);
    console.log(`UX11-UNIT ${JSON.stringify({ owner: 'reader-first', name, expected, actual, ok })}`);
    rows.push(ok);
  };
  measure('initial helper hidden', true, helper.hidden);
  const copy = "If no new tab appears, check your browser's popup controls for this site, then choose Read again. Opening a comic does not mark it read.";
  for (const handle of [null, {}]) {
    opened = { ok: true, target: 'reader', window: handle };
    context.open(issue, { preventDefault() {} }, 'synthetic');
    measure('valid visible conditional copy', [false, copy], [helper.hidden, helper.textContent]);
  }
  outcome = { ok: false, error: 'Synthetic comic source no longer exists.' };
  context.open(issue, null, 'synthetic');
  measure('resolver refusal visible', [false, outcome.error], [helper.hidden, helper.textContent]);
  outcome = { ok: true, issue };
  opened = { ok: false };
  context.open(issue, null, 'synthetic');
  measure('reference refusal visible', `${issue.title} has no Marvel reference recorded, so it cannot be opened.`, helper.textContent);
  context.open(issue, null, null);
  measure('source refusal visible', 'The comic source is missing. Open its current details and try again.', helper.textContent);
  opened = { ok: true, target: 'reader', window: null };
  context.open(issue, null, 'synthetic');
  measure('valid resets refusal', copy, helper.textContent);
  measure('saved bytes unchanged', before, JSON.stringify(state));
  assert.ok(rows.every(Boolean), 'Every conditional/refusal branch must visibly retain its exact outcome');
});

function view(name) {
  const start = html.indexOf(`<section id="view-${name}"`);
  assert.ok(start >= 0, `Missing ${name} view`);
  const end = html.indexOf('<section id="view-', start + 1);
  return html.slice(start, end < 0 ? html.length : end);
}

function disclosure(markup, id) {
  const match = markup.match(new RegExp(`<details\\b[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/details>`));
  assert.ok(match, `Missing ${id} disclosure`);
  assert.doesNotMatch(match[0].slice(0, match[0].indexOf('>')), /\bopen\b/, `${id} must start closed`);
  return match[0];
}

test('reading groups Read and Done together, with comic details and infrequent actions secondary', () => {
  const reading = view('read');
  const primary = reading.match(/<div class="cta" id="hero-primary-actions">[\s\S]*?<\/div>/)?.[0];
  assert.ok(primary, 'The primary reading group is missing');
  for (const id of ['btn-chero-read', 'btn-hero-read', 'btn-issue-read']) {
    assert.match(html, new RegExp(`<button\\b[^>]*id="${id}"[^>]*>\\s*Read\\s*<\\/button>`), id);
  }
  assert.match(primary, /id="btn-hero-done"[^>]*>\s*Done\s*<\/button>/);
  assert.match(primary, /data-tooltip="Mark read and continue\. Keyboard shortcut: D"/);
  assert.match(primary, /aria-keyshortcuts="d"/);
  assert.match(reading, /id="hero-reader-temporary"[^>]*hidden/);
  assert.doesNotMatch(primary, /id="btn-hero-(inspect|defer|info)"/);
  assert.equal((primary.match(/\bbtn-lg\b/g) ?? []).length, 1);
  assert.match(reading, /id="btn-hero-inspect"[^>]*>\s*About this comic\s*</);
  assert.match(read('../src/js/views/reading.js'), /ariaLabel: `About this comic: \$\{item\.title\}`/);
  const more = disclosure(reading, 'hero-more-actions');
  assert.match(more, /<summary>More comic actions<\/summary>/);
  assert.match(more, /id="btn-hero-defer"/);
  assert.match(more, /<a[^>]*id="btn-hero-info"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.ok(reading.indexOf('id="hero-primary-actions"') < reading.indexOf('id="btn-hero-description"'));
});

test('comic details put Read before artwork and technical help, with a separate temporary-link warning', () => {
  const issue = view('issue');
  const readAt = issue.indexOf('id="btn-issue-read"');
  const artworkAt = issue.indexOf('id="issue-focus-img"');
  const temporaryAt = issue.indexOf('id="reader-link-temporary"');
  const helpAt = issue.indexOf('id="reader-link-help"');
  assert.ok(readAt >= 0 && readAt < artworkAt, 'Read must precede artwork and metadata');
  assert.ok(temporaryAt > readAt && temporaryAt < artworkAt, 'Active temporary-link context belongs near Read');
  assert.ok(artworkAt < helpAt);
  const help = disclosure(issue, 'reader-link-help');
  assert.match(help, /<summary id="reader-link-heading">Trouble opening this comic\?<\/summary>/);
  for (const id of ['summary', 'edit', 'revert', 'form', 'reportToggle', 'reportPanel', 'reportDisclosure']) {
    assert.ok(help.includes(`id="reader-link-${id}"`), `${id} must remain in troubleshooting`);
  }
  assert.doesNotMatch(help, /id="reader-link-temporary"/);
  assert.doesNotMatch(help, /id="issue-focus-facts"/);
  assert.ok(issue.indexOf('id="issue-focus-facts"') < helpAt, 'Normal availability belongs with the other metadata');
  assert.match(issue, /id="btn-issue-synopsis"[^>]*>\s*Show story summary \(may contain spoilers\)/);
});

test('a completed list has a Browse action without replacing deferred continuation', () => {
  const reading = view('read');
  const completed = reading.slice(reading.indexOf('<div id="all-read"'), reading.indexOf('<section id="all-deferred"'));
  assert.match(completed, /<a href="#\/browse" class="btn" data-view="browse">Browse Reading Lists<\/a>/);
  assert.doesNotMatch(completed, /id="btn-review-deferred"/);
  assert.match(reading, /id="all-deferred"[\s\S]*?id="btn-review-deferred">Review deferred/);
});

test('Add leads with search and series while retaining the other three routes in a disclosure', () => {
  const adding = view('add');
  const primary = adding.match(/<div class="search-hub-grid add-hub-grid" id="add-primary-methods">[\s\S]*?<\/div>/)?.[0];
  assert.ok(primary, 'Primary Add choices are missing');
  assert.deepEqual([...primary.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]), ['add-search', 'add-series']);
  const other = disclosure(adding, 'add-other-methods');
  assert.match(other, /<summary>More ways to add<\/summary>/);
  for (const route of ['add-creator', 'add-import', 'add-manual']) {
    assert.ok(other.includes(`data-view="${route}"`), `${route} must remain reachable`);
  }
});

test('search results precede a closed alternatives group with every existing destination', () => {
  const searching = view('add-search');
  const other = disclosure(searching, 'search-alternatives');
  assert.ok(searching.indexOf('id="search-results"') < searching.indexOf('id="search-alternatives"'));
  for (const route of ['add-series', 'add-creator', 'spotlights', 'catalog', 'add-import', 'add-manual']) {
    assert.ok(other.includes(`data-view="${route}"`), `${route} must remain reachable`);
  }
});

test('an empty search offers deliberate manual entry through navigation without adding or fetching', () => {
  const start = add.indexOf('  function renderResults(');
  const end = add.indexOf('\n  for (const config of searches)', start);
  assert.ok(start >= 0 && end > start);
  const notices = [];
  const navigation = [];
  const context = {
    $: () => ({ replaceChildren() {}, append() {} }),
    el: () => ({}),
    announce() {},
    refreshBuilders() {},
    selected: new Map(),
    nameEdited: false,
    destinationId: '',
    MAX_NAME: 100,
    notify: (...args) => notices.push(args),
    showView: (...args) => navigation.push(args),
  };
  runInNewContext(`${add.slice(start, end)}\nthis.render = renderResults;`, context);
  context.render({ kind: 'issue', results: '#search-results' }, {
    items: [], phase: 'complete', item: { name: 'No match' },
  });
  assert.equal(navigation.length, 0, 'An empty result must not navigate automatically');
  assert.equal(notices.length, 1, 'An empty completed search must offer the manual-entry notice');
  const [target, message, kind, , action] = notices.at(-1);
  assert.equal(target, '#search-results');
  assert.equal(kind, 'warn');
  assert.match(message, /Nothing matched.*by hand/);
  assert.equal(action?.label, 'Add an issue by hand');
  action.onClick();
  assert.equal(navigation.length, 1);
  assert.equal(navigation[0][0], 'add-manual');
  assert.equal(navigation[0][1].push, true);
});

test('Setup keeps a concise optional lead and discloses its full historical context', () => {
  const implementation = catalog.match(/ {2}function ensureSetupGuideFeature[\s\S]*?\n {2}}\n/)?.[0];
  assert.ok(implementation);
  const rendered = [];
  const context = {
    el: (tag, attrs, children = []) => ({ tag, attrs, children }),
    catalogCard: () => ({ tag: 'card' }),
    elements: { query: (selector) => selector.endsWith('-results') ? { before: (feature) => rendered.push(feature) } : null },
  };
  runInNewContext(`${implementation}\nthis.render = ensureSetupGuideFeature;`, context);
  for (const surface of ['catalog', 'modern']) {
    context.render([], surface, () => ({ id: 'setup', name: 'Setup to Modern Timeline' }));
    const [copy] = rendered.at(-1).children;
    const intro = copy.children.find((node) => node.tag === 'p' && node.attrs.class !== 'eyebrow');
    assert.ok(intro);
    assert.match(intro.attrs.text, /optional/i);
    assert.match(intro.attrs.text, /directly/i);
    assert.ok(intro.attrs.text.split(/\s+/).length <= 25, 'Default Setup guidance must remain concise');
    const detail = copy.children.find((node) => node.tag === 'details');
    assert.ok(detail, 'Full Setup context must remain available');
    assert.equal(Object.hasOwn(detail.attrs, 'open'), false);
    assert.match(detail.children[0].attrs.text, /About this starting point/);
    const full = detail.children.find((node) => node.tag === 'p').attrs.text;
    assert.match(full, /historical context.*characters and events/);
    if (surface === 'catalog') assert.match(full, /1998.*not an official Marvel editorial-era boundary/);
  }
});

test('backup and restore precede optional exports while reports and recovery stay outside disclosures', () => {
  const settings = view('data');
  const exporting = disclosure(settings, 'backup-export-options');
  const advanced = disclosure(settings, 'metadata-settings');
  assert.ok(settings.indexOf('id="btn-export-json"') < settings.indexOf('id="restore-file"'));
  assert.ok(settings.indexOf('id="restore-file"') < settings.indexOf('id="backup-export-options"'));
  assert.match(exporting, /id="btn-export-md-2"/);
  assert.match(exporting, /id="btn-export-order-2"[^>]*aria-describedby="export-order-hint"/);
  assert.match(exporting, /JSON is the lossless reader-data backup/);
  for (const id of ['restore-report', 'btn-undo-restore', 'salvage-list', 'salvage-report', 'api-report', 'cache-report', 'btn-wipe']) {
    assert.ok(settings.includes(`id="${id}"`));
    assert.ok(!exporting.includes(`id="${id}"`) && !advanced.includes(`id="${id}"`), `${id} must not be hidden by optional configuration`);
  }
  assert.match(advanced, /id="form-settings"[\s\S]*?id="api-base"/);
  assert.ok(settings.indexOf('<h2>Advanced</h2>') < settings.indexOf('id="metadata-settings"'));
});

test('story-summary terminology preserves default hiding, explicit reveal and accessible spoiler labels', () => {
  const disclosure = createSynopsisDisclosure();
  const button = { setAttribute(name, value) { this[name] = value; } };
  const description = { id: 'summary' };
  const render = () => renderSynopsisDescription({
    button, description, issue: { issueId: 7, title: 'Fixture comic' },
    entry: 'Held story text', fallback: 'Not loaded', disclosure,
  });
  render();
  assert.equal(description.hidden, true);
  assert.equal(description.textContent, '');
  assert.equal(button.textContent, 'Show story summary (may contain spoilers)');
  assert.equal(button['aria-label'], 'Show story summary may contain spoilers: Fixture comic');
  assert.equal(button['aria-expanded'], 'false');
  disclosure.reveal(7);
  render();
  assert.equal(description.textContent, 'Held story text');
  assert.equal(button['aria-label'], 'Hide story summary: Fixture comic');
  assert.equal(button['aria-expanded'], 'true');
  disclosure.toggle(7);
  render();
  assert.equal(description.hidden, true);
});
