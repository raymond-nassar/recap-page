import { RECORD_HEADING, RECORD_NOTE } from '../src/js/lib/availability.js';

async function localClock(page) {
  await page.evaluateOnNewDocument(() => {
    const Clock = Date;
    window.__marvelClock = new Clock(2026, 11, 6, 23, 59, 59, 999).getTime();
    window.Date = class extends Clock {
      constructor(...args) { super(...(args.length ? args : [window.__marvelClock])); }
      static now() { return window.__marvelClock; }
    };
    window.__marvelOpens = [];
    window.open = (...args) => { window.__marvelOpens.push(args); return null; };
  });
}

async function route(page, hash, selector) {
  await page.evaluate((next) => {
    history.pushState(null, '', next);
    dispatchEvent(new HashChangeEvent('hashchange'));
  }, hash);
  await page.waitForSelector(selector);
}

// The note sits inside the record's term so it is read with its label, and there it took on the
// label's capitals (#978). Edge put those capitals in the accessibility tree as well, so the
// rendered text and the term's accessible name are both read here, not only the computed style.
async function recordNote(page, t, facts) {
  const seen = await page.$eval(facts, (node) => {
    const term = node.querySelector('dt');
    const note = term.querySelector('.rail-hint');
    const label = getComputedStyle(term), sentence = getComputedStyle(note);
    return {
      label: [term.firstChild.textContent, label.textTransform],
      note: [note.innerText, sentence.textTransform, sentence.letterSpacing, sentence.fontWeight],
    };
  });
  t.check(`${facts} keeps the record label in capitals and sets its note as a sentence`,
    JSON.stringify(seen) === JSON.stringify({
      label: [RECORD_HEADING, 'uppercase'], note: [RECORD_NOTE, 'none', 'normal', '400'],
    }), JSON.stringify(seen));
  const ax = await page.createCDPSession();
  const { nodes } = await ax.send('Accessibility.getFullAXTree');
  await ax.detach();
  const terms = nodes.filter((node) => !node.ignored && node.role?.value === 'term'
    && node.name?.value?.toLowerCase().startsWith(RECORD_HEADING.toLowerCase()));
  t.check(`${facts} names the record's term with its label and then the note as a sentence`,
    terms.length === 1 && terms[0].name.value === `${RECORD_HEADING.toUpperCase()} ${RECORD_NOTE}`,
    JSON.stringify(terms.map((node) => node.name.value)));
}

export async function retiredReaderHelp(page, t, { seedFixtureState, click, openFullOrder, order }) {
  await localClock(page);
  await seedFixtureState(page);
  const first = order.items[0];
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')));
  const read = async (selector, mode) => {
    const label = await page.$eval(selector, (node) => ({ text: node.textContent, name: node.getAttribute('aria-label') }));
    t.check(`${selector} has the date-appropriate visible and accessible destination`,
      mode === 'unlimited' ? label.text === 'Read' && label.name.includes('reading ends December 7, 2026')
        : label.text === 'Find on Marvel Comics' && label.name.includes('not a single-comic link'), JSON.stringify(label));
    await click(page, selector);
    const opened = await page.evaluate(() => window.__marvelOpens.at(-1));
    t.check(`${selector} selects ${mode} before a fresh noopener window`,
      new URL(opened[0]).searchParams.get('r') === mode && opened[1] === '_blank' && opened[2] === 'noopener',
      JSON.stringify(opened));
  };
  for (const mode of ['unlimited', 'comics']) {
    if (mode === 'comics') {
      await page.evaluate(() => {
        window.__marvelClock = new Date(2026, 11, 7).getTime();
        dispatchEvent(new Event('focus'));
      });
    }
    await route(page, '#/home', '#view-home:not([hidden])');
    await read('#btn-chero-read', mode);
    t.check('Home explains the closure and preserves the data promise', await page.$eval('#reader-closure-notice',
      (node) => node.textContent.includes('December 7, 2026') && node.textContent.includes('backups stay unchanged')));
    await route(page, '#/read/fixture', '#view-read:not([hidden])');
    await read('#btn-hero-read', mode);
    await openFullOrder(page);
    const more = `#rows [data-key="${first.issueId}"][data-act="more"]`;
    if (await page.$eval(more, (node) => node.getAttribute('aria-expanded') !== 'true')) await click(page, more);
    await read(`#rows [data-key="${first.issueId}"][data-act="open"]`, mode);
    const shelf = '#shelf [data-act="open"]';
    await read(shelf, mode);
    await route(page, `#/issue/${first.issueId}`, '#issue-focus-card:not([hidden])');
    await read('#btn-issue-read', mode);
    await click(page, '#reader-link-heading');
    t.check('reader help exposes no retired editor or report action', await page.evaluate(() => (
      !document.querySelector('[id^="reader-link-"] input, #reader-link-form, #reader-link-edit, #reader-link-reportLink')
      && document.querySelector('#reader-link-summary').textContent.length > 0
    )));
  }
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')));
  t.check('all handoffs leave saved references, overrides and reading progress unchanged',
    JSON.stringify([before.issues, before.read, before.overrides]) === JSON.stringify([after.issues, after.read, after.overrides]));
  await page.setViewport({ width: 390, height: 900 });
  t.check('the post-cutoff action and historical facts stay inside the phone viewport', await page.evaluate(() => {
    const node = document.querySelector('#btn-issue-read');
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
  }));
  await page.setViewport({ width: 1280, height: 900 });
  await recordNote(page, t, '#issue-focus-facts');
  await route(page, '#/read/fixture', '#view-read:not([hidden])');
  await recordNote(page, t, '#hero-facts');
  const historical = [
    'No recorded Unlimited date',
    'Unlimited date: 2027-01-01 (future)',
    'Unlimited date: 2026-01-01 (passed)',
    'You marked it available in Unlimited',
    'You marked it unavailable in Unlimited',
  ];
  await page.evaluate((ids) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    while (ids.length < 5) {
      const id = 900000090 + ids.length;
      state.issues[id] = { ...state.issues[ids[0]], issueId: id, title: `Historical state ${ids.length + 1}` };
      state.lists.fixture.itemIds.push(id);
      ids.push(id);
    }
    ids.forEach((id, index) => {
      state.issues[id].mu = index === 1 ? '2027-01-01' : index === 2 ? '2026-01-01' : null;
      delete state.overrides[id];
      if (index >= 3) state.overrides[id] = index === 3 ? 'available' : 'unavailable';
    });
    localStorage.setItem('mrt.state.v2', JSON.stringify(state));
  }, order.items.slice(0, 5).map((item) => item.issueId));
  await page.reload({ waitUntil: 'load' });
  await route(page, '#/read/fixture', '#view-read:not([hidden])');
  await openFullOrder(page);
  const labels = await page.$$eval('#rows .availability-record', (nodes) => nodes.slice(0, 5).map((node) => node.textContent));
  t.check('all five full historical states use the exact approved distinct labels',
    JSON.stringify(labels) === JSON.stringify(historical), JSON.stringify(labels));
  const ax = await page.createCDPSession();
  const tree = await ax.send('Accessibility.getFullAXTree');
  for (const label of historical) {
    t.check(`browser accessibility tree distinguishes ${label}`,
      tree.nodes.some((node) => !node.ignored && node.name?.value === label));
  }
  await ax.detach();
  for (const width of [640, 390]) {
    await page.setViewport({ width, height: 900 });
    t.check(`historical labels wrap without page overflow at ${width}px`, await page.evaluate(() => (
      document.documentElement.scrollWidth <= innerWidth
      && [...document.querySelectorAll('#rows .availability-record')].slice(0, 5).every((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && node.scrollWidth <= node.clientWidth;
      })
    )));
  }
  await page.setViewport({ width: 1280, height: 900 });
}

export async function retiredManualLink(page, t, { open, click, addByHand, manualReport, readState }) {
  await open(page, '/');
  await click(page, '[data-view="add-manual"]');
  const before = await readState(page);
  await addByHand(page, 'Old reader comic', 'https://read.marvel.com/#/book/129648');
  t.check('reader paste is explicitly refused', /reader links are no longer accepted/.test(await manualReport(page)));
  t.check('the invalid URL and title remain, with an associated focused field error', await page.evaluate(() => {
    const field = document.querySelector('#manual-url');
    return field.value === 'https://read.marvel.com/#/book/129648'
      && field.getAttribute('aria-invalid') === 'true' && document.activeElement === field
      && field.getAttribute('aria-describedby').includes('manual-url-hint')
      && field.closest('details').open && document.querySelector('#manual-title').value === 'Old reader comic';
  }));
  const refused = await readState(page);
  t.check('refused reader paste writes no comic or list', JSON.stringify(refused) === JSON.stringify(before));
  await page.$eval('#manual-url', (node) => node.dispatchEvent(new Event('input', { bubbles: true })));
  await addByHand(page, 'Secret Wars (2015) #1', 'https://www.marvel.com/comics/issue/52447/secret_wars');
  const after = await readState(page);
  t.check('a comic details URL still saves without inventing a reader reference',
    after?.issues?.['52447']?.url.includes('/comics/issue/52447')
      && after.issues['52447'].digitalId == null, JSON.stringify(after?.issues?.['52447']));
}

export async function legacyReaderBackup(page, t, { seedFixtureState, click, openFullOrder, readerId, digitalId }) {
  await localClock(page);
  await seedFixtureState(page);
  await page.evaluate((id, book) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    state.issues[id] = { issueId: id, title: 'Legacy reader comic #1', digitalId: book, url: null, source: 'manual', hydrated: true, mu: '2026-01-01' };
    state.lists.fixture.itemIds = [id];
    state.lists.fixture.collectedIn = { [id]: 'Saved section' };
    state.read[id] = 1234;
    state.overrides[id] = 'unavailable';
    localStorage.setItem('mrt.state.v2', JSON.stringify(state));
  }, readerId, digitalId);
  await page.reload({ waitUntil: 'load' });
  const backup = await page.evaluate(async () => {
    const { exportBackup } = await import('/js/lib/model.js');
    return JSON.stringify(exportBackup(JSON.parse(localStorage.getItem('mrt.state.v2'))));
  });
  await route(page, '#/data', '#view-data:not([hidden])');
  await page.evaluate((raw) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([raw], 'legacy-json-backup.json', { type: 'application/json' }));
    const input = document.querySelector('#restore-file');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, backup);
  await page.waitForSelector('#ask[open]');
  await click(page, '#ask-ok');
  await page.waitForFunction(() => /Reading data restored/.test(document.querySelector('#restore-report').textContent));
  t.check('JSON restore preserves legacy identity, digital ID, date, read mark, override and section', await page.evaluate((id, book) => {
    const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
    return state.issues[id].issueId === id && state.issues[id].digitalId === book
      && state.issues[id].mu === '2026-01-01' && state.read[id] === 1234
      && state.overrides[id] === 'unavailable' && state.lists.fixture.collectedIn[id] === 'Saved section';
  }, readerId, digitalId));
  await route(page, '#/read/fixture', '#view-read:not([hidden])');
  await openFullOrder(page);
  await click(page, '#list-export > summary');
  await click(page, '#btn-export-md');
  await page.waitForSelector('#markdown-export[open]');
  for (const name of ['includeLinks', 'includeSections']) {
    const selector = `#markdown-export input[name="${name}"]`;
    if (!await page.$eval(selector, (node) => node.checked)) await click(page, selector);
  }
  await click(page, '#markdown-export button[type="submit"]');
  await page.waitForFunction(() => (window.__mrtDownloads ?? []).length > 0);
  const markdown = await page.evaluate(() => window.__mrtDownloads.at(-1).text);
  t.check('historical Markdown export keeps the canonical recorded link',
    markdown.includes(`https://read.marvel.com/#/book/${digitalId}`) && markdown.includes('[x]'));
  await route(page, '#/add-import', '#view-add-import:not([hidden])');
  await page.evaluate((text) => {
    document.querySelector('#import-text').value = text;
    document.querySelector('#import-new-list').checked = true;
    document.querySelector('#form-import').requestSubmit();
  }, markdown);
  await page.waitForFunction(() => document.querySelector('#import-report').textContent.includes('reader links are no longer accepted'));
  t.check('previously exported reader rows remain explicit review positions with title and read mark', await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem('mrt.import.draft.v1'));
    const row = draft.occurrences[0];
    return row.title === 'Legacy reader comic #1' && row.read && row.index === 0 && row.issueId == null
      && row.section === 'Saved section' && document.querySelector('#import-report').textContent.includes('Find match');
  }));
}
