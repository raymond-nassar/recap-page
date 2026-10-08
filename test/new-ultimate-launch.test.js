import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { issuePageUrl } from '../src/js/lib/issuePageUrl.js';
import { launchUrl, openIssue } from '../src/js/reader.js';
import { addIssuesToList, createEmptyState, createList, exportBackup, markRead } from '../src/js/lib/model.js';
import { originalReaderDescription, readerLinkReport } from '../src/js/lib/temporaryReaderLink.js';

const origin = 'http://127.0.0.1:8787';
const order = JSON.parse(readFileSync(new URL('../src/data/new_ultimate_universe_trades.json', import.meta.url)));
const sibling = JSON.parse(readFileSync(new URL('../src/data/new_ultimate_universe.json', import.meta.url)));
const missing = order.items.filter((item) => item.digitalId == null && item.detailsRefused === true);
const page = 'https://www.marvel.com/comics/issue/129224/ultimate_endgame_2025_1';

test('all 29 owner-confirmed originals launch their unchanged exact issue-page URLs', () => {
  assert.equal(order.items.length, 132);
  assert.equal(new Set(order.items.map((item) => item.collectedIn)).size, 23);
  assert.equal(sibling.items.length, 138);
  assert.equal(missing.length, 29);
  const siblings = new Map(sibling.items.map((item) => [item.issueId, item]));
  for (const item of missing) {
    assert.equal(issuePageUrl(item.url, item.issueId), item.url, item.title);
    assert.equal(siblings.get(item.issueId)?.url, item.url, item.title);
    const launch = new URL(launchUrl(item, origin));
    assert.equal(launch.origin, origin);
    assert.equal(launch.pathname, '/open.html');
    assert.equal(launch.searchParams.get('i'), String(item.issueId));
    assert.equal(launch.searchParams.get('u'), item.url, item.title);
    assert.equal(launch.searchParams.get('p'), '1');
    assert.equal(launch.searchParams.has('d'), false);
    assert.match(originalReaderDescription(item), /opens the Marvel issue page/);
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

test('known book IDs and tab-only corrections retain priority; popup stays synchronous', () => {
  const prior = globalThis.window;
  const calls = [];
  globalThis.window = { open(...args) { calls.push(args); return null; } };
  try {
    const source = { ...missing[0] };
    assert.equal(openIssue(source, { origin }).target, 'page');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], '_blank');
    assert.equal(calls[0][2], 'noopener');
    assert.equal(new URL(calls[0][0]).searchParams.get('u'), source.url);
    for (const digitalId of [38811, 77777]) {
      const result = openIssue({ ...source, digitalId }, { origin });
      assert.equal(result.target, 'reader');
      const launch = new URL(calls.at(-1)[0]);
      assert.equal(launch.searchParams.get('d'), String(digitalId));
      assert.equal(launch.searchParams.has('u'), false);
      assert.equal(launch.searchParams.has('p'), false);
    }
    const unknown = openIssue({ ...source, detailsRefused: false }, { origin });
    assert.equal(unknown.target, 'lookup');
    assert.equal(new URL(calls.at(-1)[0]).searchParams.get('u'), source.url);
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
  const doc = { title: 'Opening a comic', documentElement: root, body: node(),
    getElementById: (key) => nodes[key] ?? null,
    querySelector: (selector) => selector === 'meta[name="color-scheme"]' ? meta : null };
  const host = { opener: { private: true } };
  const mockLocation = { search, replace(url) {
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
    if (exercise) await exercise({ nodes, root, meta, doc, navigations, requests, timers, host, settingsReads, writes });
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

test('desktop launcher revalidates and opens exact known-refused URL without lookup or delay', async () => {
  const search = new URL(launchUrl(missing.find((item) => item.issueId === 129224), origin)).search;
  const f = await desktopLauncher(search, () => assert.fail('Known-refused page must not fetch'));
  assert.deepEqual(f.navigations, [page]);
  assert.equal(f.nodes.fallback.href, page);
  assert.equal(f.requests.length, 0);
  assert.equal(f.timers.length, 0);
  assert.match(f.nodes.p.textContent, /issue page/);

  const direct = await desktopLauncher(`?d=38811&i=129224&u=${encodeURIComponent(page)}&p=1`,
    () => assert.fail('Known book ID must not fetch'));
  assert.deepEqual(direct.navigations, ['https://read.marvel.com/#/book/38811']);
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
test('launcher held pending resolves with truthful title and cleared exact abort timer', async () => {
  let release;
  const rows = [];
  await desktopLauncher('?i=900002', () => new Promise((resolve) => { release = resolve; }), {
    exercise: async ({ doc, nodes, timers, navigations }) => {
      launcherMeasure(rows, 'pending title', 'Looking up reader link - Recap Page', doc.title);
      launcherMeasure(rows, 'pending state', 'pending', doc.documentElement.attrs['data-state'] ?? null);
      launcherMeasure(rows, 'abort deadline', 8000, timers[0]?.delay);
      launcherMeasure(rows, 'pending no navigation', [], navigations);
      release({ ok: true, json: async () => ({ digitalId: 700002 }) });
      await new Promise(setImmediate);
      launcherMeasure(rows, 'resolved title', 'Opening Marvel Unlimited - Recap Page', doc.title);
      launcherMeasure(rows, 'exact reader', ['https://read.marvel.com/#/book/700002'], navigations);
      launcherMeasure(rows, 'cleared abort', true, timers[0].cleared === true);
      launcherMeasure(rows, 'no duplicate timer', 1, timers.length);
      launcherMeasure(rows, 'exact fallback', 'https://read.marvel.com/#/book/700002', nodes.fallback.href);
    },
  });
  launcherResult(rows);
});
test('launcher settled no-link and failure reasons retain exact safe fallback and routing policy', async () => {
  const rows = [];
  for (const [kind, fetchImpl, settings, expectedState, requests] of [
    ['missing', async () => ({ ok: true, json: async () => ({ digitalId: null }) }), null, 'no-reader-link', 1],
    ['http', async () => ({ ok: false, status: 503 }), null, 'lookup-error', 1],
    ['network', async () => { throw new TypeError('Synthetic offline'); }, null, 'lookup-error', 1],
    ['json', async () => ({ ok: true, json: async () => { throw new SyntaxError('Synthetic JSON'); } }), null, 'lookup-error', 1],
    ['unsafe', async () => assert.fail('No unsafe lookup'), '{"apiBase":"ftp://127.0.0.1/v1"}', 'lookup-unavailable', 0],
    ['malformed', async () => assert.fail('No malformed lookup'), '{', 'lookup-unavailable', 0],
    ['null', async () => assert.fail('No null lookup'), 'null', 'lookup-unavailable', 0],
    ['scalar', async () => ({ ok: true, json: async () => ({ digitalId: null }) }), '3', 'no-reader-link', 1],
  ]) {
    await desktopLauncher(`?i=900002&u=${encodeURIComponent(ux11Page)}`, fetchImpl, { settings,
      exercise: async ({ doc, timers, navigations, requests: actualRequests, nodes }) => {
        launcherMeasure(rows, `${kind} state`, expectedState, doc.documentElement.attrs['data-state'] ?? null);
        launcherMeasure(rows, `${kind} fetch count`, requests, actualRequests.length);
        if (requests) {
          launcherMeasure(rows, `${kind} cache`, 'no-store', actualRequests[0][1].cache);
          launcherMeasure(rows, `${kind} delay`, 1400, timers[1]?.delay);
          launcherMeasure(rows, `${kind} no early navigation`, [], navigations);
          if (timers[1]) timers[1].fn();
        }
        launcherMeasure(rows, `${kind} safe destination`, [ux11Page], navigations);
        if (['malformed', 'null', 'scalar'].includes(kind)) {
          launcherMeasure(rows, `${kind} visible limitation`, true,
            Boolean(nodes['settings-status'] && !nodes['settings-status'].hidden && nodes['settings-status'].textContent));
        }
      } });
  }
  for (const denied of [true, false]) {
    const kind = denied ? 'read-denied-valid-issue' : 'unknown-theme-valid-issue';
    let release;
    await desktopLauncher(`?i=900002&u=${encodeURIComponent(ux11Page)}`,
      () => new Promise((resolve) => { release = resolve; }), {
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
          if (denied) {
            measure('state', 'lookup-unavailable', root.attrs['data-state']);
            measure('title', 'Reader lookup unavailable - Recap Page', doc.title);
            measure('requests', [], requests);
            measure('timers', [], timers);
            measure('immediate destination', [ux11Page], navigations);
            measure('fallback', ux11Page, nodes.fallback.href);
          } else {
            measure('pending state', 'pending', root.attrs['data-state']);
            measure('pending title', 'Looking up reader link - Recap Page', doc.title);
            measure('configured request', 'https://ux11-api.invalid/v1/issues/900002', requests[0]?.[0]);
            measure('request count', 1, requests.length);
            measure('cache', 'no-store', requests[0]?.[1].cache);
            measure('accept', 'application/json', requests[0]?.[1].headers.accept);
            measure('abort signal', true, requests[0]?.[1].signal instanceof AbortSignal);
            measure('abort deadline', [8000], timers.map((timer) => timer.delay));
            measure('no early navigation', [], navigations);
            if (release) release({ ok: true, json: async () => ({ digitalId: 700002 }) });
            await new Promise(setImmediate);
            measure('resolved state', 'resolved', root.attrs['data-state']);
            measure('reader destination', ['https://read.marvel.com/#/book/700002'], navigations);
            measure('only cleared abort', [{ delay: 8000, cleared: true }],
              timers.map(({ delay, cleared }) => ({ delay, cleared: cleared === true })));
          }
          measure('no writes', [], writes);
        },
      });
  }
  launcherResult(rows);
});
test('launcher actual abort settles timeout then schedules only the exact fallback delay', async () => {
  const rows = [];
  await desktopLauncher('?i=900002', (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Synthetic deadline', 'AbortError')), { once: true });
  }), { exercise: async ({ timers, navigations, doc }) => {
    launcherMeasure(rows, 'before 8000 no intent', [], navigations);
    launcherMeasure(rows, 'abort scheduled 8000', 8000, timers[0].delay);
    timers[0].fn();
    await new Promise(setImmediate);
    launcherMeasure(rows, 'actual timeout state', 'timeout', doc.documentElement.attrs['data-state'] ?? null);
    launcherMeasure(rows, 'timeout title', 'Reader lookup timed out - Recap Page', doc.title);
    launcherMeasure(rows, 'fallback scheduled 1400', 1400, timers[1]?.delay);
    launcherMeasure(rows, 'before fallback no intent', [], navigations);
    if (timers[1]) timers[1].fn();
    launcherMeasure(rows, 'canonical fallback', ['https://www.marvel.com/comics/issue/900002/'], navigations);
    launcherMeasure(rows, 'abort cleared', true, timers[0].cleared === true);
  } });
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

test('desktop forged pages fall back safely while unknown pages retain the metadata lookup', async () => {
  const hostile = [
    `?i=129225&u=${encodeURIComponent(page)}&p=1`,
    `?i=129224&u=${encodeURIComponent('https://evil.example/comics/issue/129224/x')}&p=1`,
    `?i=129224&u=${encodeURIComponent(page)}&u=${encodeURIComponent(page)}&p=1`,
  ];
  for (const search of hostile) {
    const f = await desktopLauncher(search, async () => ({ ok: false, status: 404 }));
    assert.equal(f.requests.length, 1);
    const issueId = new URLSearchParams(search).get('i');
    assert.equal(f.requests[0][0], `https://marvel.emreparker.com/v1/issues/${issueId}`);
    assert.equal(f.requests[0][1].cache, 'no-store');
    assert.deepEqual(f.navigations, []);
    assert.equal(f.timers.length, 2);
    assert.equal(f.timers[1].delay, 1400);
    f.fireFallback();
    assert.deepEqual(f.navigations, [`https://www.marvel.com/comics/issue/${issueId}/`]);
  }
  const unknown = await desktopLauncher(`?i=129224&u=${encodeURIComponent(page)}`,
    async () => ({ ok: true, json: async () => ({ digitalId: 38811 }) }));
  assert.equal(unknown.requests.length, 1);
  assert.deepEqual(unknown.navigations, ['https://read.marvel.com/#/book/38811']);
  assert.equal(unknown.nodes.fallback.href, 'https://read.marvel.com/#/book/38811');
});

test('desktop valid page without refusal flag keeps exact slug after unresolved lookup', async () => {
  const search = `?i=129224&u=${encodeURIComponent(page)}`;
  for (const result of [
    { ok: false, status: 404 },
    { ok: true, json: async () => ({ digitalId: null }) },
  ]) {
    const f = await desktopLauncher(search, async () => result);
    assert.deepEqual(f.requests.map(([url]) => url), ['https://marvel.emreparker.com/v1/issues/129224']);
    assert.equal(f.requests[0][1].cache, 'no-store');
    assert.equal(f.nodes.fallback.href, page);
    assert.deepEqual(f.navigations, [], 'valid page without refusal flag still waits for lookup');
    assert.equal(f.timers.length, 2);
    assert.equal(f.timers[0].delay, 8000);
    assert.equal(f.timers[1].delay, 1400);
    f.fireFallback();
    assert.deepEqual(f.navigations, [page], 'fallback retains the original slug');
  }
});
