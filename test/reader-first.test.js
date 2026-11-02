import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('../src/index.html');
const add = read('../src/js/views/add.js');
const catalog = read('../src/js/views/shared/catalog-presentation.js');

// The page reduced to what the hand-off reads: class selectors for closest, sibling order for after
// and nextElementSibling, and lookup by id. Each surface keeps the shape it has in the app.
function handoffPage() {
  function node(tag, { id = null, className = '', dataset = {} } = {}, children = []) {
    const made = {
      tag, id, className, dataset: { ...dataset }, parent: null, children: [], textContent: '',
      get nextElementSibling() {
        const siblings = this.parent?.children ?? [];
        return siblings[siblings.indexOf(this) + 1] ?? null;
      },
      append(...next) {
        for (const child of next) {
          child.remove();
          child.parent = this;
          this.children.push(child);
        }
        return this;
      },
      after(child) {
        child.remove();
        child.parent = this.parent;
        this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, child);
      },
      remove() {
        if (!this.parent) return;
        this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
      },
      closest(selector) {
        const wanted = selector.slice(1);
        for (let at = this; at; at = at.parent) if (at.className.split(' ').includes(wanted)) return at;
        return null;
      },
    };
    made.append(...children);
    return made;
  }
  const root = node('main');
  const all = (from = root) => [from, ...from.children.flatMap((child) => all(child))];
  const controls = {
    hero: node('button', { id: 'btn-hero-read', className: 'btn btn-lg has-tooltip' }),
    tile: node('button', { className: 'tile-read', dataset: { act: 'open' } }),
    row: node('button', { className: 'mini', dataset: { act: 'open' } }),
    plainRow: node('button', { className: 'mini', dataset: { act: 'open' } }),
    continue: node('button', { id: 'btn-chero-read', className: 'btn' }),
    issue: node('button', { id: 'btn-issue-read', className: 'btn btn-lg' }),
  };
  const groups = {
    appReport: node('div', { id: 'app-report', className: 'report' }),
    hero: node('div', { id: 'hero-primary-actions', className: 'cta' }, [controls.hero, node('button', { id: 'btn-hero-done' })]),
    shelf: node('ol', { id: 'shelf', className: 'shelf' }, [node('li', { className: 'tile' }, [controls.tile])]),
    rowNote: node('span', { className: 'rail-hint', dataset: { readerTemporary: 'true' } }),
    continue: node('div', { className: 'cta' }, [controls.continue, node('a', { id: 'btn-chero-open' })]),
    issue: node('div', { className: 'cta' }, [controls.issue]),
  };
  root.append(
    groups.appReport,
    node('div', { className: 'hero-body' }, [groups.hero, node('p', { id: 'hero-reader-temporary' })]),
    node('section', { id: 'shelf-sec', className: 'sec' }, [groups.shelf]),
    node('div', { className: 'ract' }, [controls.row, groups.rowNote, node('a', { dataset: { act: 'info' } })]),
    node('div', { className: 'ract' }, [controls.plainRow, node('a', { dataset: { act: 'info' } })]),
    groups.continue,
    node('div', { className: 'issue-reading-controls' }, [groups.issue, node('p', { id: 'reader-link-temporary' })]),
  );
  const document = { getElementById: (id) => all().find((entry) => entry.id === id) ?? null };
  const el = (tag, props) => Object.assign(node(tag, { id: props.id, className: props.class }), {
    textContent: props.text, props,
  });
  return {
    controls, groups, document, el,
    $: (selector) => all().find((entry) => `#${entry.id}` === selector) ?? null,
    hints: () => all().filter((entry) => entry.id === 'reader-handoff-help'),
  };
}

test('shared reader handoff visibly distinguishes conditional intent and exact refusals without writes or focus', () => {
  const source = read('../src/js/main.js');
  const start = source.indexOf('function retireReaderHelp(');
  const end = source.indexOf('\n// ------------------------------------------------------------------ synopsis', start);
  assert.ok(start >= 0 && end > start && source.indexOf('function openInReader(', start) < end,
    'Actual shared functions must be extractable');
  const dom = handoffPage();
  const issue = { title: 'Browser Check (2026) #2' };
  const events = [];
  let outcome = { ok: true, issue };
  let opened = { ok: true, target: 'reader', window: null };
  const state = { read: { 900002: false }, listOrder: ['fixture'] };
  const before = JSON.stringify(state);
  const context = {
    $: dom.$, el: dom.el, document: dom.document,
    store: { state }, temporaryReaderLinks: { resolve: () => outcome },
    openIssueTab: () => { events.push('open'); return opened; },
    announce: (message) => events.push(message),
  };
  runInNewContext(`${source.slice(start, end)}\nthis.open = openInReader;\nthis.retire = retireReaderHelp;`, context);
  const rows = [];
  const measure = (name, expected, actual) => {
    const ok = JSON.stringify(expected) === JSON.stringify(actual);
    console.log(`UX11-UNIT ${JSON.stringify({ owner: 'reader-first', name, expected, actual, ok })}`);
    rows.push(ok);
  };
  const helper = () => dom.document.getElementById('reader-handoff-help');
  const shown = () => [dom.hints().length, helper()?.textContent ?? null];
  const click = (control) => ({ currentTarget: control, preventDefault() {} });
  measure('initial helper hidden', true, helper() === null);
  const copy = "If no new tab appears, check your browser's popup controls for this site, then choose Read again. Opening a comic does not mark it read.";
  for (const handle of [null, {}]) {
    opened = { ok: true, target: 'reader', window: handle };
    context.open(issue, click(dom.controls.hero), 'synthetic');
    measure('valid visible conditional copy', [1, copy], shown());
  }
  measure('plain paragraph, not a second live announcement', ['class', 'id', 'text'],
    Object.keys(helper().props).sort());
  outcome = { ok: false, error: 'Synthetic comic source no longer exists.' };
  context.open(issue, click(dom.controls.issue), 'synthetic');
  measure('resolver refusal visible', [1, outcome.error], shown());
  outcome = { ok: true, issue };
  opened = { ok: false };
  context.open(issue, click(dom.controls.issue), 'synthetic');
  measure('reference refusal visible', [1, `${issue.title} has no Marvel reference recorded, so it cannot be opened.`], shown());
  context.open(issue, click(dom.controls.issue), null);
  measure('source refusal visible', [1, 'The comic source is missing. Open its current details and try again.'], shown());
  measure('refusal beside the control that was refused', true, dom.groups.issue.nextElementSibling === helper());
  opened = { ok: true, target: 'reader', window: null };
  context.open(issue, click(dom.controls.issue), 'synthetic');
  measure('valid resets refusal', [1, copy], shown());

  // Each Read retires the last hint and places one after its own control's group, so nothing above
  // the control moves and no earlier hint survives somewhere else on the page.
  for (const [name, control, anchor] of [
    ['hero Read', dom.controls.hero, dom.groups.hero],
    ['row Read after its temporary-link note', dom.controls.row, dom.groups.rowNote],
    ['row Read', dom.controls.plainRow, dom.controls.plainRow],
    ['Coming up tile below the shelf', dom.controls.tile, dom.groups.shelf],
    ['Continue reading', dom.controls.continue, dom.groups.continue],
    ['issue details Read', dom.controls.issue, dom.groups.issue],
  ]) {
    context.open(issue, click(control), 'saved');
    measure(`${name} hint placement`, [1, true, copy],
      [dom.hints().length, anchor.nextElementSibling === helper(), helper()?.textContent]);
  }
  context.open(issue, { currentTarget: dom.document, preventDefault() {} }, 'saved', dom.controls.hero);
  measure('a named control wins over the event target', [1, true],
    [dom.hints().length, dom.groups.hero.nextElementSibling === helper()]);
  context.open(issue, null, 'synthetic');
  measure('no control falls back to the page report area', [1, true],
    [dom.hints().length, dom.groups.appReport.nextElementSibling === helper()]);
  context.retire();
  measure('retiring removes the hint', [0, null], shown());
  context.retire();
  measure('retiring twice is harmless', 0, dom.hints().length);

  events.length = 0;
  for (const [target, said] of [
    ['reader', `Opening ${issue.title} in Marvel Unlimited in a new tab. Reading ends December 7, 2026.`],
    ['page', `Opening the Marvel issue page for ${issue.title} in a new tab.`],
    ['lookup', `Opening ${issue.title} in a new tab and looking up its Unlimited link.`],
  ]) {
    opened = { ok: true, target, window: null };
    context.open(issue, click(dom.controls.hero), 'saved');
    measure(`${target} announcement unchanged`, ['open', said], events.splice(0));
  }
  measure('saved bytes unchanged', before, JSON.stringify(state));
  assert.ok(rows.every(Boolean), 'Every conditional/refusal branch must visibly retain its exact outcome');
});

test('every navigation retires the reader hint and no page-top slot remains for it', () => {
  const source = read('../src/js/main.js');
  assert.match(source, /function showView\(next, \{ focus = true, push = false, at = null \} = \{\}\) \{\n {2}retireReaderHelp\(\);[^\n]*\n/);
  assert.doesNotMatch(html, /id="reader-handoff-help"/);
});

test('the hero background is never a scroll anchor, so the hint cannot scroll the page under the reader', () => {
  // The Android mobile-ui owner measures the scroll at 800x360. Browser owners do not run in CI, so the
  // rule is held here too: without it the scaled layer's top moves with every growth of the hero.
  assert.match(read('../src/styles.css'), /\.hero-bg \{[^}]*transform: scale\(1\.3\);[^}]*overflow-anchor: none;/);
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
  const primary = reading.match(/<div class="cta" id="hero-primary-actions"[^>]*>[\s\S]*?<\/div>/)?.[0];
  assert.ok(primary, 'The primary reading group is missing');
  for (const id of ['btn-chero-read', 'btn-hero-read', 'btn-issue-read']) {
    assert.match(html, new RegExp(`<button\\b[^>]*id="${id}"[^>]*>\\s*Read\\s*<\\/button>`), id);
  }
  assert.match(primary, /id="btn-hero-done"[^>]*>\s*Done\s*<\/button>/);
  assert.match(primary, /data-tooltip="Mark as read and continue\. Keyboard shortcut: D"/);
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
  assert.doesNotMatch(reading, /Read this next|btn-hero-description/, '#1061 retired the label and the reveal');
});

test('comic details put Read before artwork and destination help without retired link controls', () => {
  const issue = view('issue');
  const readAt = issue.indexOf('id="btn-issue-read"');
  const artworkAt = issue.indexOf('id="issue-focus-img"');
  const temporaryAt = issue.indexOf('id="reader-link-temporary"');
  const helpAt = issue.indexOf('id="reader-link-help"');
  assert.ok(readAt >= 0 && readAt < artworkAt, 'Read must precede artwork and metadata');
  assert.equal(temporaryAt, -1, 'Retired temporary-link context is absent');
  assert.ok(artworkAt < helpAt);
  const help = disclosure(issue, 'reader-link-help');
  assert.match(help, /<summary id="reader-link-heading">Where Read opens<\/summary>/);
  assert.ok(help.includes('id="reader-link-summary"'));
  for (const id of ['edit', 'revert', 'form', 'reportToggle', 'reportPanel', 'reportDisclosure']) {
    assert.ok(!help.includes(`id="reader-link-${id}"`), `${id} must not accept a retired reader link`);
  }
  assert.doesNotMatch(help, /id="reader-link-temporary"/);
  assert.doesNotMatch(help, /id="issue-focus-facts"/);
  assert.ok(issue.indexOf('id="issue-focus-facts"') < helpAt, 'Normal availability belongs with the other metadata');
  assert.match(issue, /id="btn-issue-synopsis"[^>]*>\s*Load story summary\s*</);
});

test('a completed list has a Browse action without replacing deferred continuation', () => {
  const reading = view('read');
  const completed = reading.slice(reading.indexOf('<div id="all-read"'), reading.indexOf('<section id="all-deferred"'));
  assert.match(completed, /<a href="#\/browse" class="btn" data-view="home" data-at="categories">Browse Reading Lists<\/a>/);
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
  assert.match(exporting, /The order-only export leaves out notes, summaries, progress and availability overrides\./);
  for (const id of ['restore-report', 'btn-undo-restore', 'salvage-list', 'salvage-report', 'api-report', 'cache-report', 'btn-wipe']) {
    assert.ok(settings.includes(`id="${id}"`));
    assert.ok(!exporting.includes(`id="${id}"`) && !advanced.includes(`id="${id}"`), `${id} must not be hidden by optional configuration`);
  }
  assert.match(advanced, /id="form-settings"[\s\S]*?id="api-base"/);
  assert.ok(settings.indexOf('<h2>Advanced</h2>') < settings.indexOf('id="metadata-settings"'));
});

test('#1061 story summaries have no reveal controls, setting or spoiler label', () => {
  const html = read('../src/index.html');
  assert.doesNotMatch(html, /btn-(hero|issue)-description|opt-description-hiding|description-hiding/);
  assert.doesNotMatch(html, /may contain spoilers/i);
  assert.match(html, /id="btn-issue-synopsis"[^>]*>\s*Load story summary\s*</);
  assert.equal(existsSync(new URL('../src/js/lib/synopsisDisclosure.js', import.meta.url)), false);
});

test('Coming up Read buttons carry their name once, with no title repeating it', () => {
  // UX-29: the title repeated the accessible name as a description, so it was announced twice.
  const source = read('../src/js/views/reading.js');
  const start = source.indexOf("class: 'tile-read',");
  const end = source.indexOf('}, readerAction()),', start);
  assert.ok(end > start, 'the Coming up Read button must have an explicit boundary');
  const button = source.slice(start, end);
  assert.notEqual(start, -1, 'the Coming up Read button moved');
  assert.match(button, /'aria-label': readName/);
  assert.doesNotMatch(button, /\btitle:/);
});
