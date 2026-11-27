import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MARVEL_COMICS_URL } from '../src/js/lib/readerDestination.js';
import { issuePageUrl } from '../src/js/lib/issuePageUrl.js';
import { launchUrl, openIssue } from '../src/js/reader.js';
import { addIssuesToList, createEmptyState, createList, exportBackup, markRead } from '../src/js/lib/model.js';
import { originalReaderDescription, readerLinkReport } from '../src/js/lib/temporaryReaderLink.js';

const origin = 'http://127.0.0.1:8787';
const beforeCutoff = new Date(2026, 11, 6, 12);
const order = JSON.parse(readFileSync(new URL('../src/data/new_ultimate_universe_trades.json', import.meta.url)));
const sibling = JSON.parse(readFileSync(new URL('../src/data/new_ultimate_universe.json', import.meta.url)));
const missing = order.items.filter((item) => item.digitalId == null && item.detailsRefused === true);
const page = 'https://www.marvel.com/comics/issue/129224/ultimate_endgame_2025_1';
const afterCutoff = new Date(2026, 11, 8, 12);
const websiteCaption = 'Find this comic on the Marvel Comics website. This is not a single-comic link. Reading progress has not changed.';
// #1601: no launch may reach Marvel Unlimited or a marvel.com issue page any more.
const retired = /read\.marvel\.com|marvel\.com\/comics\/issue|marvelcomicsapp\.com\/mu\//;

test('1601 all 29 owner-confirmed originals keep their exact issue pages in data but launch the website', () => {
  assert.equal(order.items.length, 132);
  assert.equal(new Set(order.items.map((item) => item.collectedIn)).size, 23);
  assert.equal(sibling.items.length, 138);
  assert.equal(missing.length, 29);
  const siblings = new Map(sibling.items.map((item) => [item.issueId, item]));
  for (const item of missing) {
    assert.equal(issuePageUrl(item.url, item.issueId), item.url, item.title);
    assert.equal(siblings.get(item.issueId)?.url, item.url, item.title);
    for (const now of [beforeCutoff, afterCutoff]) {
      const launch = new URL(launchUrl(item, origin, { now }));
      assert.equal(launch.origin, origin);
      assert.equal(launch.pathname, '/open.html');
      assert.deepEqual([...launch.searchParams.keys()].sort(), ['r', 't'], item.title);
      assert.equal(launch.searchParams.get('r'), 'comics');
      assert.doesNotMatch(launch.href, retired, item.title);
    }
    assert.match(originalReaderDescription(item), /opens the Marvel comic page/);
    assert.match(readerLinkReport(item), new RegExp(`Comic page: ${item.url.replaceAll('.', '\\.')}`));
  }
});

test('issue-page validator rejects other originals, open redirects and URL parser tricks', () => {
  for (const value of [
    'http://www.marvel.com/comics/issue/129224/x',
    'https://marvel.com.evil.example/comics/issue/129224/x',
    'https://read.marvel.com/comics/issue/129224/x',
    'https://www.marvel.com:443/comics/issue/129224/x',
    'https://name@www.marvel.com/comics/issue/129224/x',
    'https://www.marvel.com/comics/issue/129225/x',
    'https://www.marvel.com/comics/series/129224/x',
    'https://www.marvel.com/comics/issue/129224/x?continue=evil',
    'https://www.marvel.com/comics/issue/129224/x#chapter',
    'https://www.marvel.com/comics/issue/129224/../129225',
    'https://www.marvel.com/comics/issue/129224/%2e%2e',
    'https://www.marvel.com/comics/issue/129224/x%2f..',
    'https://www.marvel.com/comics/issue/129224/x\\evil',
    'https://www.marvel.com/comics/issue/129224/x\n',
    'https://www.marvel.com/comics/issue/0129224/x',
    ' https://www.marvel.com/comics/issue/129224/x',
  ]) {
    assert.equal(issuePageUrl(value, 129224), null, value);
    const launch = new URL(launchUrl({ issueId: 129224, url: value, detailsRefused: true }, origin));
    assert.equal(launch.searchParams.has('u'), false, value);
    assert.equal(launch.searchParams.has('p'), false, value);
  }
  for (const id of ['129225', '0129224', null, {}, -1]) assert.equal(issuePageUrl(page, id), null);
  assert.equal(issuePageUrl(page, 129224), page);
});

test('1601 saved book IDs, issue pages and the old lookup no longer steer Read; popup stays synchronous', () => {
  const prior = globalThis.window;
  const calls = [];
  globalThis.window = { open(...args) { calls.push(args); return null; } };
  try {
    const source = { ...missing[0] };
    const cases = [source, { ...source, digitalId: 38811 }, { ...source, digitalId: 77777 },
      { ...source, detailsRefused: false }];
    for (const issue of cases) {
      for (const options of [{ now: beforeCutoff }, { now: beforeCutoff, app: false }, { now: afterCutoff }]) {
        const before = JSON.stringify(issue);
        assert.deepEqual(openIssue(issue, { origin, ...options }).target, 'comics');
        assert.equal(JSON.stringify(issue), before, 'a launch leaves saved fields untouched');
        const launch = new URL(calls.at(-1)[0]);
        assert.deepEqual([...launch.searchParams.keys()].sort(), ['r', 't']);
        assert.doesNotMatch(launch.href, retired);
      }
    }
    assert.equal(calls.length, cases.length * 3);
    assert.ok(calls.every((call) => call[1] === '_blank' && call[2] === 'noopener'));
  } finally {
    globalThis.window = prior;
  }
});

test('synthetic saved progress and shared issue identities do not change on launch', () => {
  let state = createList(createEmptyState(), { name: 'Fixture collected editions' });
  const listId = state.listOrder[0];
  state = addIssuesToList(state, listId, missing, {}).state;
  state = markRead(state, missing[0].issueId, true, 1720000000123);
  state = { ...state, notes: { [missing[0].issueId]: 'fixture note' },
    overrides: { [missing[0].issueId]: 'available' } };
  const before = JSON.stringify(state);
  const exportBefore = exportBackup(state);
  for (const issue of missing) launchUrl(state.issues[issue.issueId], origin);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.read[missing[0].issueId], 1720000000123);
  const exportAfter = exportBackup(state);
  delete exportBefore.exportedAt;
  delete exportAfter.exportedAt;
  assert.deepEqual(exportAfter, exportBefore);
});

let desktopCase = 0;
async function desktopLauncher(search, fetchImpl, { settings = null, readError = false, exercise = null } = {}) {
  // #1601: the query is passed as written, so an old bookmark without a destination is tested as one.
  const query = new URLSearchParams(search);
  const previous = Object.fromEntries(['window', 'location', 'document', 'localStorage', 'fetch',
    'setTimeout', 'clearTimeout'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const navigations = [];
  const requests = [];
  const timers = [];
  const settingsReads = [];
  const writes = [];
  const markup = readFileSync(new URL('../src/open.html', import.meta.url), 'utf8');
  const node = () => ({
    textContent: '', href: '', hidden: false, attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    removeAttribute(key) { delete this.attrs[key]; },
    getAttribute(key) { return this.attrs[key] ?? null; },
  });
  const nodes = Object.fromEntries(['h', 'p', 'fallback', 'return', 'settings-status']
    .filter((key) => markup.includes(`id="${key}"`)).map((key) => {
    const tags = [...markup.matchAll(new RegExp(`<[^>]+\\bid="${key}"[^>]*>`, 'g'))];
    assert.equal(tags.length, 1, `The actual ${key} opening tag must be unique`);
    const element = node();
    element.href = tags[0][0].match(/\bhref="([^"]*)"/)?.[1] ?? '';
    return [key, element];
  }));
  const root = node();
  const meta = node();
  // The launch page's theme-color tags as written in its markup (#834), so the real module rewrites
  // the same tags a browser would read.
  const themeColorTags = [...markup.matchAll(/<meta\b[^>]*\bname="theme-color"[^>]*>/g)].map(([tag]) => {
    const element = node();
    for (const [, key, value] of tag.matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(key, value);
    return element;
  });
  const doc = { title: 'Opening a comic', documentElement: root, body: node(),
    getElementById: (key) => nodes[key] ?? null,
    querySelector: (selector) => selector === 'meta[name="color-scheme"]' ? meta : null,
    querySelectorAll: (selector) => (selector === 'meta[name="theme-color"]' ? themeColorTags : []) };
  const host = { opener: { private: true } };
  const mockLocation = { search: `?${query}`, replace(url) {
    assert.equal(host.opener, null, 'sever the opener before navigation');
    navigations.push(url);
  } };
  Object.assign(globalThis, {
    window: host,
    location: mockLocation,
    document: doc,
    localStorage: { getItem(key) { settingsReads.push({ key, denied: readError }); if (readError) throw new Error('Synthetic denied settings'); return settings; },
      setItem(key) { writes.push(key); assert.fail('Launcher must not write settings'); },
      removeItem(key) { writes.push(key); assert.fail('Launcher must not remove settings'); } },
    fetch: (...args) => { requests.push(args); return fetchImpl(...args); },
    setTimeout: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { timer.cleared = true; },
  });
  try {
    await import(`../src/open.js?fixture=${++desktopCase}`);
    await new Promise(setImmediate);
    if (exercise) await exercise({ nodes, root, meta, themeColorTags, doc, navigations, requests, timers, host, settingsReads, writes });
    return { nodes, navigations, requests, timers, fireFallback() {
      const saved = Object.getOwnPropertyDescriptor(globalThis, 'location');
      globalThis.location = mockLocation;
      try { timers.find((timer) => timer.delay === 1400).fn(); } finally {
        if (saved) Object.defineProperty(globalThis, 'location', saved);
        else delete globalThis.location;
      }
    } };
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('1601 desktop launcher opens the website for a refused issue page or a book ID, without lookup or delay', async () => {
  const search = new URL(launchUrl(missing.find((item) => item.issueId === 129224), origin,
    { now: beforeCutoff, app: false })).search;
  for (const query of [search, `?d=38811&i=129224&u=${encodeURIComponent(page)}&p=1`,
    `?r=unlimited&d=38811&i=129224&u=${encodeURIComponent(page)}&p=1`]) {
    const f = await desktopLauncher(query, () => assert.fail('A launch must not fetch'));
    assert.deepEqual(f.navigations, [MARVEL_COMICS_URL], query);
    assert.equal(f.nodes.fallback.href, MARVEL_COMICS_URL);
    assert.equal(f.requests.length, 0);
    assert.equal(f.timers.length, 0);
    assert.equal(f.nodes.p.textContent, websiteCaption);
  }
});

const ux11Page = 'https://www.marvel.com/comics/issue/900002/browser_check_2';
function launcherMeasure(rows, name, expected, actual) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  const row = { owner: 'new-ultimate-launch', name, expected, actual, ok };
  console.log(`UX11-UNIT ${JSON.stringify(row)}`);
  rows.push(row);
}
function launcherResult(rows) {
  assert.ok(rows.every((row) => row.ok), JSON.stringify(rows.filter((row) => !row.ok)));
}
test('1601 launcher opens the website for an issue number at once, with no pending lookup', async () => {
  const rows = [];
  await desktopLauncher('?i=900002', () => assert.fail('An issue number must not fetch'), {
    exercise: async ({ doc, nodes, timers, navigations, requests }) => {
      launcherMeasure(rows, 'title', 'Opening Marvel Comics website - Recap Page', doc.title);
      launcherMeasure(rows, 'state', 'comics', doc.documentElement.attrs['data-state'] ?? null);
      launcherMeasure(rows, 'no timers', [], timers);
      launcherMeasure(rows, 'no requests', [], requests);
      launcherMeasure(rows, 'website', [MARVEL_COMICS_URL], navigations);
      launcherMeasure(rows, 'fallback', MARVEL_COMICS_URL, nodes.fallback.href);
    },
  });
  launcherResult(rows);
});
test('1601 launcher lookup settings no longer cause a request, while display limitations stay visible', async () => {
  const rows = [];
  for (const [kind, settings, limitation] of [
    ['default', null, false],
    ['configured', '{"apiBase":"https://ux11-api.invalid/v1"}', false],
    ['unsafe', '{"apiBase":"ftp://127.0.0.1/v1"}', false],
    ['malformed', '{', true],
    ['null', 'null', true],
    ['scalar', '3', true],
  ]) {
    await desktopLauncher(`?i=900002&u=${encodeURIComponent(ux11Page)}`, () => assert.fail('No lookup'), { settings,
      exercise: async ({ doc, timers, navigations, requests, nodes }) => {
        launcherMeasure(rows, `${kind} state`, 'comics', doc.documentElement.attrs['data-state'] ?? null);
        launcherMeasure(rows, `${kind} fetch count`, 0, requests.length);
        launcherMeasure(rows, `${kind} timers`, 0, timers.length);
        launcherMeasure(rows, `${kind} website, never the page`, [MARVEL_COMICS_URL], navigations);
        launcherMeasure(rows, `${kind} visible limitation`, limitation,
          Boolean(nodes['settings-status'] && !nodes['settings-status'].hidden && nodes['settings-status'].textContent));
      } });
  }
  for (const denied of [true, false]) {
    const kind = denied ? 'read-denied-valid-issue' : 'unknown-theme-valid-issue';
    await desktopLauncher(`?i=900002&u=${encodeURIComponent(ux11Page)}`, () => assert.fail('No lookup'), {
      readError: denied, settings: '{"theme":"unexpected","apiBase":"https://ux11-api.invalid/v1"}',
      exercise: async ({ doc, root, meta, nodes, requests, timers, navigations, settingsReads, writes }) => {
        const measure = (name, expected, actual) => launcherMeasure(rows, `${kind} ${name}`, expected, actual);
        measure('settings read', [{ key: 'mrt.settings', denied }], settingsReads);
        measure('system attribute', null, root.attrs['data-theme'] ?? null);
        measure('system meta', 'dark light', meta.attrs.content);
        measure('exact limitation', denied
          ? 'Saved display settings could not be read. Using the system theme.'
          : 'Saved theme is not recognized. Using the system theme.', nodes['settings-status'].textContent);
        measure('limitation visible', false, nodes['settings-status'].hidden);
        measure('state', 'comics', root.attrs['data-state']);
        measure('title', 'Opening Marvel Comics website - Recap Page', doc.title);
        measure('requests', [], requests);
        measure('timers', [], timers);
        measure('immediate destination', [MARVEL_COMICS_URL], navigations);
        measure('fallback', MARVEL_COMICS_URL, nodes.fallback.href);
        measure('no writes', [], writes);
      },
    });
  }
  launcherResult(rows);
});
test('launcher missing references and display settings surface limitations without navigation or writes', async () => {
  const rows = [];
  for (const [settings, readError, theme, limitation] of [
    ['{"theme":"light"}', false, 'light', false],
    ['{"theme":"dark"}', false, 'dark', false],
    ['{"theme":"system"}', false, null, false],
    ['{"theme":"unexpected"}', false, null, true],
    [null, true, null, true],
    ['null', false, null, true],
  ]) {
    await desktopLauncher('', () => assert.fail('Missing reference cannot fetch'), { settings, readError,
      exercise: async ({ doc, root, nodes, navigations, timers }) => {
        launcherMeasure(rows, 'missing title', 'Nothing to open - Recap Page', doc.title);
        launcherMeasure(rows, 'chosen theme', theme, root.attrs['data-theme'] ?? null);
        launcherMeasure(rows, 'missing no navigation', [], navigations);
        launcherMeasure(rows, 'missing no timer', 0, timers.length);
        launcherMeasure(rows, 'missing hides external fallback', true, nodes.fallback.hidden === true);
        launcherMeasure(rows, 'native return', './#/home', nodes.return?.href ?? null);
        launcherMeasure(rows, 'settings limitation', limitation,
          Boolean(nodes['settings-status'] && !nodes['settings-status'].hidden && nodes['settings-status'].textContent));
      } });
  }
  launcherResult(rows);
});

test('the launch page gives an installed window\'s title bar the chosen theme, and the system its own (#834)', async () => {
  // Each tag carries its own scheme's colour on system, and both carry an explicit theme's, so whichever
  // tag the browser picks matches the page this module paints. Unreadable settings follow the system.
  const rows = [];
  const own = ['#111117', '#fafaff'];
  for (const [settings, readError, colors] of [
    ['{"theme":"light"}', false, ['#fafaff', '#fafaff']],
    ['{"theme":"dark"}', false, ['#111117', '#111117']],
    ['{"theme":"system"}', false, own],
    ['{"theme":"unexpected"}', false, own],
    [null, true, own],
    ['null', false, own],
  ]) {
    await desktopLauncher('', () => assert.fail('Missing reference cannot fetch'), { settings, readError,
      exercise: async ({ themeColorTags, meta, root }) => {
        const kind = readError ? 'unreadable' : settings;
        launcherMeasure(rows, `${kind} tag media`, ['(prefers-color-scheme: dark)', '(prefers-color-scheme: light)'],
          themeColorTags.map((tag) => tag.getAttribute('media')));
        launcherMeasure(rows, `${kind} tag colours`, colors, themeColorTags.map((tag) => tag.getAttribute('content')));
        launcherMeasure(rows, `${kind} colour scheme`, root.attrs['data-theme'] ?? 'dark light', meta.attrs.content);
      } });
  }
  launcherResult(rows);
});

test('1601 desktop forged, unknown and valid issue pages all open the website, never the page or a lookup', async () => {
  for (const search of [
    `?i=129225&u=${encodeURIComponent(page)}&p=1`,
    `?i=129224&u=${encodeURIComponent('https://evil.example/comics/issue/129224/x')}&p=1`,
    `?i=129224&u=${encodeURIComponent(page)}&u=${encodeURIComponent(page)}&p=1`,
    `?i=129224&u=${encodeURIComponent(page)}`,
    `?i=129224&u=${encodeURIComponent(page)}&p=1`,
  ]) {
    const f = await desktopLauncher(search, () => assert.fail('No lookup'));
    assert.equal(f.requests.length, 0, search);
    assert.equal(f.timers.length, 0, search);
    assert.deepEqual(f.navigations, [MARVEL_COMICS_URL], search);
    assert.equal(f.nodes.fallback.href, MARVEL_COMICS_URL);
    assert.notEqual(f.nodes.fallback.href, page);
  }
});

// #950: issue 12459 has a bundled Marvel Comics app link (viewer 18255) and issue 42 has none.
const linked = { issueId: 12459, digitalId: 38811, title: 'Linked comic', url: 'https://www.marvel.com/comics/issue/12459/x' };
const appLink = 'https://www.marvelcomicsapp.com/viewer/18255';

test('1601 Read carries the app link on both sides of December 7 and offers no Marvel Unlimited bypass', () => {
  for (const now of [beforeCutoff, afterCutoff]) {
    for (const app of [true, false]) {
      const launch = new URL(launchUrl(linked, origin, { now, app }));
      assert.deepEqual([...launch.searchParams.keys()].sort(), ['a', 'r', 't']);
      assert.equal(launch.searchParams.get('a'), '18255');
    }
  }
  assert.equal(new URL(launchUrl({ ...linked, issueId: 42 }, origin, { now: beforeCutoff })).searchParams.has('a'), false);
  const prior = globalThis.window;
  const calls = [];
  globalThis.window = { open(...args) { calls.push(args); return null; } };
  try {
    assert.equal(openIssue(linked, { origin, now: beforeCutoff }).target, 'app');
    assert.equal(openIssue(linked, { origin, now: beforeCutoff, app: false }).target, 'app');
    assert.equal(openIssue({ ...linked, issueId: 42 }, { origin, now: beforeCutoff }).target, 'comics');
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call[1] === '_blank' && call[2] === 'noopener'));
    assert.ok(calls.every((call) => !retired.test(call[0])));
    assert.equal(linked.digitalId, 38811, 'the saved book ID stays in the record');
  } finally {
    globalThis.window = prior;
  }
});

test('950 desktop launcher opens the app link without a lookup and rebuilds it from the number', async () => {
  for (const r of ['unlimited', 'comics']) {
    const f = await desktopLauncher(`?r=${r}&a=18255&i=12459`, () => assert.fail('An app link must not fetch'));
    assert.deepEqual(f.navigations, [appLink]);
    assert.equal(f.nodes.fallback.href, appLink);
    assert.equal(f.nodes.p.textContent, 'Taking you to this comic in the Marvel Comics app.');
    assert.equal(f.requests.length, 0);
  }
  // #1601: a rejected viewer falls back to the website, not to the book ID beside it.
  for (const a of ['0', '012', '12/3', 'https://evil.example/', '1234567890']) {
    const f = await desktopLauncher(`?a=${encodeURIComponent(a)}&d=38811&i=12459`, () => assert.fail('no fetch'));
    assert.deepEqual(f.navigations, [MARVEL_COMICS_URL], a);
  }
  const twice = await desktopLauncher('?a=18255&a=1&d=38811&i=12459', () => assert.fail('no fetch'));
  assert.deepEqual(twice.navigations, [MARVEL_COMICS_URL]);
  // #1601: a viewer number alone opens, since a viewer-only comic has nothing else to send.
  const bare = await desktopLauncher('?a=18255', () => assert.fail('no fetch'));
  assert.deepEqual(bare.navigations, [appLink]);
});

test('1601 desktop launcher never opens a Marvel Unlimited address, whatever the query carries', async () => {
  for (const r of ['unlimited', 'comics']) {
    const f = await desktopLauncher(`?r=${r}&m=10441&i=10441`, () => assert.fail('no fetch'));
    assert.deepEqual(f.navigations, [MARVEL_COMICS_URL]);
    assert.equal(f.nodes.fallback.href, MARVEL_COMICS_URL);
    assert.equal(f.nodes.p.textContent, websiteCaption);
    assert.equal(f.requests.length, 0);
  }
  for (const query of ['m=10442&i=10441', 'm=012&i=012', 'm=0&i=0', 'm=1234567890&i=1234567890',
    'm=12%2F3&i=12%2F3', 'm=10441&m=10441&i=10441', 'm=10441&i=10441&i=42']) {
    const f = await desktopLauncher(`?${query}&d=38811&r=unlimited`, () => assert.fail('no fetch'));
    assert.deepEqual(f.navigations, [MARVEL_COMICS_URL], query);
  }
  const both = await desktopLauncher('?a=18255&m=10441&i=10441', () => assert.fail('no fetch'));
  assert.deepEqual(both.navigations, [appLink], 'published viewer link wins');
  const bare = await desktopLauncher('?m=10441', () => assert.fail('no fetch'));
  assert.deepEqual(bare.navigations, [], 'an MU number alone is not a reference');
});

test('1601 a comic on the old Marvel Unlimited app list launches the website and keeps its saved fields', () => {
  const issueId = marvelComicsAppMuIssueIds[0];
  const comic = { issueId, digitalId: 38811, title: 'Approved MU comic' };
  const saved = JSON.stringify(comic);
  const prior = globalThis.window;
  const calls = [];
  globalThis.window = { open(...args) { calls.push(args); return null; } };
  try {
    for (const now of [beforeCutoff, afterCutoff]) {
      for (const app of [true, false]) {
        const url = new URL(launchUrl(comic, origin, { now, app }));
        assert.deepEqual([...url.searchParams.keys()].sort(), ['r', 't']);
        assert.equal(openIssue(comic, { origin, now, app }).target, 'comics');
      }
      assert.equal(new URL(launchUrl(linked, origin, { now })).searchParams.has('m'), false);
    }
    assert.equal(calls.length, 4);
    assert.ok(calls.every((call) => call[1] === '_blank' && call[2] === 'noopener' && !retired.test(call[0])));
    assert.equal(JSON.stringify(comic), saved);
  } finally {
    globalThis.window = prior;
  }
});
import { marvelComicsAppMuIssueIds } from '../src/data/marvelComicsAppMuIssues.js';
