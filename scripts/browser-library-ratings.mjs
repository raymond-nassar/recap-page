// Browser scenarios for the Library's rated comics: the Top-rated shelf and the full ratings
// browser at #/library-rated. The Character guide data is the real generated file unless a test
// switches the fetch mode, which is read from sessionStorage at request time so a mode chosen
// before a navigation applies to the document that navigation creates.

const INDEX_PATH = '/data/rated-guide-index.json';

async function installIndexFetch(page) {
  await page.evaluateOnNewDocument((indexPath) => {
    const real = window.fetch.bind(window);
    window.__ratedRequests = 0;
    window.fetch = (input, init) => {
      const url = String(input?.url ?? input);
      if (!url.includes(indexPath)) return real(input, init);
      window.__ratedRequests += 1;
      let mode = 'pass';
      try { mode = sessionStorage.getItem('ratedMode') || 'pass'; } catch { /* about:blank */ }
      if (mode === 'fail') return Promise.resolve(new Response('unavailable', { status: 503 }));
      if (mode === 'malformed') {
        return Promise.resolve(new Response(JSON.stringify({ version: 1, guides: 'broken', issueGuides: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (mode === 'defer') {
        return new Promise((resolve) => { window.__ratedRelease = () => resolve(real(input, init)); });
      }
      return real(input, init);
    };
  }, INDEX_PATH);
}

// A goto that differs from the current address only by its hash is a same-document navigation,
// which would keep the app's state from before the seed and the loader's result from an earlier
// mode. Passing through about:blank makes every boot a fresh document; sessionStorage survives it.
async function boot(page, hash) {
  await page.goto('about:blank');
  await page.goto(`${page.__origin}/${hash}`, { waitUntil: 'load' });
}

const setMode = (page, mode) => page.evaluate((value) => sessionStorage.setItem('ratedMode', value), mode);

// Picks a character label and its rated issues from the shipped index, so the scenario proves the
// generated file the app actually loads rather than a hand-built stand-in.
async function seed(page, { bulk = 125, settings = {} } = {}) {
  return page.evaluate(async ({ indexPath, bulk, settings }) => {
    const model = await import('/js/lib/model.js');
    const raw = await (await fetch(indexPath, { cache: 'no-cache' })).json();
    const fold = (s) => String(s).toLowerCase();
    const multi = raw.issueGuides.find(([, ordinals]) => ordinals.length >= 4);
    const character = raw.guides[multi[1][0]][2][0];
    const charGuides = new Set(raw.guides.map((g, i) => (g[2].some((c) => fold(c) === fold(character)) ? i : -1)).filter((i) => i >= 0));
    const charIssues = raw.issueGuides.filter(([id, ords]) => id !== multi[0] && ords.some((o) => charGuides.has(o)))
      .slice(0, 3).map(([id]) => id);
    const associated = [multi[0], ...charIssues];
    const pad = (n) => String(n).padStart(3, '0');
    const items = [
      ...associated.map((issueId, i) => ({ issueId, title: `Quiet fixture ${String.fromCharCode(65 + i)}`, seriesName: 'Quiet fixture series', number: String(i + 1), source: 'manual', hydrated: true })),
      ...Array.from({ length: bulk }, (_, i) => ({ issueId: 900001 + i, title: `Rated fixture ${pad(i + 1)}`, seriesName: 'Rated fixture series', number: String(i + 1), source: 'manual', hydrated: true })),
      { issueId: 990001, title: 'Low fixture', seriesName: 'Low series', number: '1', source: 'manual', hydrated: true },
      { issueId: -77, title: 'Manual low fixture', source: 'manual', hydrated: true },
      { issueId: 990002, title: 'Unrated fixture', source: 'manual', hydrated: true },
    ];
    let state = model.createList(model.createEmptyState(), { id: 'rated', name: 'Rated fixture list' });
    state = model.addIssuesToList(state, 'rated', items).state;
    for (const id of associated) state = model.setIssueRating(state, id, 5);
    for (let i = 0; i < bulk; i += 1) state = model.setIssueRating(state, 900001 + i, 4.5);
    state = model.setIssueRating(state, 990001, 2);
    state = model.setIssueRating(state, -77, 0.5);
    // Ratings whose comics have no saved details, one positive and one manual negative identity.
    state = model.setIssueRating(state, 777001, 3);
    state = model.setIssueRating(state, -888, 4);
    localStorage.setItem('mrt.state.v2', JSON.stringify(model.exportBackup(state)));
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, theme: 'dark', filter: 'unread', ...settings }));
    return { character, multiId: multi[0], associated, total: associated.length + bulk + 4 };
  }, { indexPath: INDEX_PATH, bulk, settings });
}

const readings = (page) => page.evaluate(() => ({
  state: localStorage.getItem('mrt.state.v2'),
  filter: JSON.parse(localStorage.getItem('mrt.settings') || '{}').filter,
}));

async function submit(page, { min = '', q = '', character = '', sort = 'rating' } = {}) {
  await page.evaluate((values) => {
    const set = (id, value) => { document.getElementById(id).value = value; };
    set('rated-min', values.min);
    set('rated-q', values.q);
    set('rated-character', values.character);
    set('rated-sort', values.sort);
    document.querySelector('#library-rated-form').requestSubmit();
  }, { min: String(min), q, character, sort });
}

const resultIds = (page) => page.$$eval('#library-rated-results [data-focus-source="rated-results"]',
  (nodes) => nodes.map((n) => Number(n.dataset.issueId)));

const countText = (page) => page.$eval('#library-rated-count', (n) => n.textContent);

const panelShown = (page) => page.waitForFunction(() => !document.querySelector('#view-library-rated').hidden);

export const libraryRatings = {
  id: 'library-ratings',
  title: 'Library rated comics shelf and browser filter, return and stay within saved data',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 900 });
    await installIndexFetch(page);
    await page.goto(`${page.__origin}/`, { waitUntil: 'load' });
    const fx = await seed(page);

    // A cold boot straight onto a filtered address must not trip over the late-declared view.
    const atLeastFour = fx.total - 3;
    await boot(page, '#/library-rated?min=4');
    await panelShown(page);
    await page.waitForFunction(() => document.querySelector('#rated-character').options.length > 1);
    const before = await readings(page);
    t.check('cold boot onto a filtered address renders with drafts from the URL',
      errors.length === 0 && await page.$eval('#rated-min', (n) => n.value === '4')
        && (await countText(page)).startsWith(`${atLeastFour.toLocaleString()} of ${fx.total.toLocaleString()} rated comics match.`),
      `${await countText(page)} ${errors.join('; ')}`);

    // The rail link, not a typed address: a typed address with no filter is read as All by design.
    await page.evaluate(() => document.querySelector('.ri[data-view="library"]').click());
    await page.waitForFunction(() => document.querySelectorAll('#library-rated-shelf-list [data-focus-source="top-rated"]').length > 0);
    const shelf = await page.evaluate(() => ({
      status: document.querySelector('#library-rated-shelf-status').textContent,
      scores: [...document.querySelectorAll('#library-rated-shelf-list .rated-score .visually-hidden')].map((n) => n.textContent),
    }));
    t.check('Top-rated shelf shows the six highest at 4 stars and up',
      shelf.scores.length === 6 && shelf.scores.slice(0, fx.associated.length).every((s) => s === 'Your rating: 5 out of 5')
        && shelf.status === `Your 6 highest of ${atLeastFour.toLocaleString()} comics rated 4 stars and up.`, JSON.stringify(shelf));

    await page.$eval('#library-rated-shelf a[data-view="library-rated"]', (n) => n.click());
    await panelShown(page);
    await page.waitForFunction(() => location.hash === '#/library-rated');
    const all = await resultIds(page);
    t.check('See all ratings opens every rating capped at 120 with a reveal control',
      all.length === 120 && (await countText(page)) === `${fx.total} rated comics.`
        && await page.$('#library-rated-results [data-act="more"]') !== null, `${all.length} ${await countText(page)}`);
    await page.$eval('#library-rated-results [data-act="more"]', (n) => n.click());
    const revealed = await resultIds(page);
    t.check('ratings without saved details and lower scores are listed, not dropped',
      revealed.length === fx.total && [777001, -888, -77, 990001].every((id) => revealed.includes(id))
        && await page.$eval('#library-rated-results [data-issue-id="777001"]', (n) => n.textContent.includes('Details not saved')),
      `${revealed.length}`);

    await submit(page, { character: fx.character });
    await page.waitForFunction(() => location.hash.includes('character='));
    const byChar = await resultIds(page);
    const guideLine = await page.$eval(`#library-rated-results [data-issue-id="${fx.multiId}"]`,
      (n) => n.closest('.library-issue')?.querySelector('.rated-guides')?.tagName ?? null);
    t.check('Character guide filter matches associated comics whose titles never name the character',
      byChar.length === fx.associated.length && fx.associated.every((id) => byChar.includes(id)) && guideLine === 'DETAILS',
      `${byChar} ${guideLine}`);

    await submit(page, { q: 'low' });
    await page.waitForFunction(() => location.hash === '#/library-rated?q=low');
    t.check('title search matches saved titles and says what it could not search',
      (await resultIds(page)).sort().join() === [-77, 990001].sort().join()
        && (await countText(page)).includes('2 rated comics have no saved title to search.'), await countText(page));

    await submit(page, { min: 4.5, sort: 'title' });
    await page.waitForFunction(() => location.hash === '#/library-rated?min=4.5&sort=title');
    const titled = await page.$$eval('#library-rated-results .result-title', (n) => n.slice(0, 2).map((x) => x.textContent));
    t.check('title sort and half-star minimum both apply', titled[0] === 'Quiet fixture A' && (await countText(page)).startsWith(`${fx.total - 4} of`), titled.join());

    await page.$eval('#rated-clear', (n) => n.click());
    await page.waitForFunction(() => location.hash === '#/library-rated');
    t.check('Clear filters resets drafts and the address',
      await page.evaluate(() => ['rated-min', 'rated-q', 'rated-character'].every((id) => document.getElementById(id).value === '')));

    // A return to a comic past the first 120 rows, once directly and once across a reload of the
    // issue page. The reload discards the in-memory reveal count, so only the saved opener can bring
    // the row back. Measured in Edge, Back after that reload stays in the same document.
    await submit(page, { min: 4 });
    await page.waitForFunction(() => location.hash === '#/library-rated?min=4');
    await page.$eval('#library-rated-results [data-act="more"]', (n) => n.click());
    const target = 900001 + 124;
    await page.$eval(`#library-rated-results [data-issue-id="${target}"]`, (n) => n.click());
    await page.waitForFunction(() => !document.querySelector('#view-issue').hidden);
    await page.evaluate(() => history.back());
    await page.waitForFunction((id) => document.activeElement?.dataset?.issueId === String(id), { timeout: 5000 }, target).catch(() => {});
    t.check('Back from a comic beyond row 120 restores the filters and focuses that comic',
      await page.evaluate((id) => location.hash === '#/library-rated?min=4'
        && document.querySelector('#rated-min').value === '4'
        && document.activeElement?.dataset?.focusSource === 'rated-results'
        && document.activeElement?.dataset?.issueId === String(id), target),
      await page.evaluate(() => `${location.hash} ${document.activeElement?.outerHTML?.slice(0, 120)}`));

    await page.$eval(`#library-rated-results [data-issue-id="${target}"]`, (n) => n.click());
    await page.waitForFunction(() => !document.querySelector('#view-issue').hidden);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !document.querySelector('#view-issue').hidden);
    await page.evaluate(() => { window.__mark = 1; history.back(); });
    await page.waitForFunction((id) => document.activeElement?.dataset?.issueId === String(id), { timeout: 5000 }, target).catch(() => {});
    t.check('Back across a reload restores the filters and focuses that comic past row 120',
      await page.evaluate((id) => location.hash === '#/library-rated?min=4'
        && document.querySelector('#rated-min').value === '4'
        && !!document.querySelector(`#library-rated-results [data-issue-id="${id}"]`)
        && document.activeElement?.dataset?.issueId === String(id), target),
      await page.evaluate(() => `${location.hash} mark=${window.__mark} nav=${performance.getEntriesByType('navigation')[0]?.type} rows=${document.querySelectorAll('#library-rated-results .result').length} ${document.activeElement?.outerHTML?.slice(0, 100)}`));

    await submit(page, { q: 'fixture 125' });
    await page.waitForFunction(() => location.hash === '#/library-rated?q=fixture+125' || location.hash === '#/library-rated?q=fixture%20125');
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => location.hash === '#/library-rated?min=4');
    const backDrafts = await page.evaluate(() => [document.querySelector('#rated-min').value, document.querySelector('#rated-q').value]);
    await page.evaluate(() => history.forward());
    await page.waitForFunction(() => location.hash.includes('q=fixture'));
    const forwardDrafts = await page.evaluate(() => [document.querySelector('#rated-min').value, document.querySelector('#rated-q').value]);
    t.check('Back and Forward move between committed filter sets and their drafts',
      backDrafts.join('|') === '4|' && forwardDrafts.join('|') === '|fixture 125', `${backDrafts} ${forwardDrafts}`);

    const after = await readings(page);
    t.check('browsing ratings leaves saved reading data and the reading filter untouched',
      after.state === before.state && after.filter === 'unread' && before.filter === 'unread', JSON.stringify([after.filter, before.filter]));

    await page.$eval('#rated-clear', (n) => n.click());
    await page.waitForFunction(() => location.hash === '#/library-rated');
    for (const [width, theme] of [[1280, 'dark'], [640, 'light'], [390, 'light'], [320, 'dark']]) {
      await page.setViewport({ width, height: 900 });
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const layout = await page.evaluate(() => {
        const panel = document.querySelector('#view-library-rated');
        // The shared breadcrumb trail is held to its own contract by the breadcrumb scenario.
        const controls = [...panel.querySelectorAll('select, input, button, a')]
          .filter((n) => n.getClientRects().length && !n.closest('.breadcrumb'));
        const small = controls.filter((n) => { const r = n.getBoundingClientRect(); return r.width < 24 || r.height < 24; });
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: small.map((n) => n.id || n.className || `${n.tagName}:${n.textContent.trim().slice(0, 30)}:${n.parentElement.className}`).slice(0, 4) };
      });
      t.check(`${width}px ${theme} ratings browser reflows with 24px targets`, !layout.overflow && !layout.small.length, JSON.stringify(layout));
    }
    await page.setViewport({ width: 1280, height: 900 });
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', { features: [
      { name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.focus('#library-rated-results [data-focus-source="rated-results"]');
    t.check('forced colors and reduced motion keep a visible focus indicator on rows', await page.evaluate(() =>
      parseFloat(getComputedStyle(document.activeElement).outlineWidth) > 0));
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await cdp.detach();

    await page.evaluate(() => localStorage.setItem('mrt.settings', JSON.stringify({ covers: true, theme: 'light', filter: 'unread' })));
    await page.setViewport({ width: 390, height: 900 });
    await boot(page, '#/library-rated');
    await panelShown(page);
    t.check('covers on at 390px keeps rows inside the viewport', await page.evaluate(() =>
      document.querySelectorAll('#library-rated-results .rcov').length > 0 && document.documentElement.scrollWidth <= innerWidth + 1));
    t.check('the feature introduces no page exceptions', errors.length === 0, errors.join('; '));
  },
};

export const libraryRatingsFailures = {
  id: 'library-ratings-failures',
  title: 'Library ratings browser reports guide data failures and never acts on stale work',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 900 });
    await installIndexFetch(page);
    await page.goto(`${page.__origin}/`, { waitUntil: 'load' });
    const fx = await seed(page, { bulk: 4 });
    const charHash = `#/library-rated?character=${encodeURIComponent(fx.character).replace(/%20/g, '+')}`;

    await setMode(page, 'fail');
    await boot(page, charHash);
    await panelShown(page);
    await page.waitForSelector('#library-rated-notice [data-act="retry"]');
    t.check('a failed guide request says the character filter was not applied',
      await page.$eval('#library-rated-notice', (n) => n.textContent.includes('Character guide filter not applied. The Character guide data could not be loaded.'))
        && (await countText(page)).includes('This count reflects rating and title matches only.')
        && (await resultIds(page)).length === fx.total, await countText(page));
    await setMode(page, 'pass');
    await page.$eval('#library-rated-notice [data-act="retry"]', (n) => n.click());
    await page.waitForFunction(() => !document.querySelector('#library-rated-notice [data-act="retry"]'));
    await page.waitForFunction((n) => document.querySelectorAll('#library-rated-results [data-focus-source="rated-results"]').length === n
      && document.activeElement?.id === 'library-rated-h', { timeout: 5000 }, fx.associated.length).catch(() => {});
    t.check('Retry loads the data and applies the filter',
      (await resultIds(page)).length === fx.associated.length
        && await page.evaluate(() => document.activeElement?.id === 'library-rated-h'),
      `${(await resultIds(page)).length}/${fx.associated.length} ${await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 80))}`);

    await setMode(page, 'malformed');
    await boot(page, '#/library');
    await page.evaluate(() => { location.hash = '#/library-rated'; });
    await page.waitForSelector('#library-rated-notice [data-act="retry"]');
    t.check('a malformed index is reported as unavailable, not as no matches',
      await page.$eval('#library-rated-notice', (n) => n.textContent.includes('Character guide choices could not be loaded.'))
        && await page.$eval('#rated-character', (n) => n.options.length === 1));

    await setMode(page, 'pass');
    await boot(page, '#/library-rated?character=Nobody+Fixture');
    await page.waitForSelector('#library-rated-notice [data-act="clear-character"]');
    const staleNotice = await page.$eval('#library-rated-notice', (n) => n.textContent);
    await page.$eval('#library-rated-notice [data-act="clear-character"]', (n) => n.click());
    await page.waitForFunction(() => location.hash === '#/library-rated');
    t.check('a character label no guide uses is named and can be cleared',
      staleNotice.includes('No reading guide uses "Nobody Fixture" now.')
        && await page.evaluate(() => document.activeElement?.id === 'rated-character'), staleNotice);

    // A deferred response settled after the reader left the view.
    await setMode(page, 'defer');
    await boot(page, charHash);
    await page.waitForFunction(() => typeof window.__ratedRelease === 'function');
    t.check('a pending lookup says so and does not claim a filtered count',
      await page.$eval('#library-rated-notice', (n) => n.textContent.includes('Loading Character guide data.')));
    await page.evaluate(() => { location.hash = '#/library'; });
    await page.waitForFunction(() => document.querySelector('#view-library-rated').hidden);
    await page.focus('#library-rated-shelf a[data-view="library-rated"]');
    await page.evaluate(() => window.__ratedRelease());
    // The browser renders only while visible, so there is no settled DOM to wait for here.
    await new Promise((resolve) => setTimeout(resolve, 300));
    t.check('a lookup settling after navigation leaves the reader where they went',
      await page.evaluate(() => location.hash === '#/library'
        && document.activeElement?.matches('#library-rated-shelf a[data-view="library-rated"]')));

    // A deferred response settled after the reader changed the filters.
    await boot(page, charHash);
    await page.waitForFunction(() => typeof window.__ratedRelease === 'function');
    await submit(page, { min: 5, character: fx.character });
    await page.evaluate(() => window.__ratedRelease());
    await page.waitForFunction(() => !document.querySelector('#library-rated-notice').textContent.includes('Loading'));
    t.check('a lookup settling after a filter change renders the current filters',
      await page.evaluate(() => location.hash.startsWith('#/library-rated?min=5&character='))
        && (await resultIds(page)).length === fx.associated.length, await countText(page));

    // PC-001: open a comic and come back while the lookup is pending, then start typing before it
    // settles. The late lookup must not pull focus out of the field, reset the draft or move the URL.
    await boot(page, charHash);
    await page.waitForFunction(() => typeof window.__ratedRelease === 'function');
    const firstRow = (await resultIds(page))[0];
    await page.$eval(`#library-rated-results [data-issue-id="${firstRow}"]`, (n) => n.click());
    await page.waitForFunction(() => !document.querySelector('#view-issue').hidden);
    await page.evaluate(() => history.back());
    await panelShown(page);
    const hashBefore = await page.evaluate(() => location.hash);
    await page.focus('#rated-q');
    await page.keyboard.type('abc');
    await page.evaluate(() => window.__ratedRelease());
    await page.waitForFunction(() => !document.querySelector('#library-rated-notice').textContent.includes('Loading'));
    await new Promise((resolve) => setTimeout(resolve, 150));
    t.check('a late lookup after a return does not steal focus, reset the draft or move the URL',
      await page.evaluate((hash) => document.activeElement?.id === 'rated-q'
        && document.querySelector('#rated-q').value === 'abc' && location.hash === hash, hashBefore),
      await page.evaluate(() => `${document.activeElement?.id} ${document.querySelector('#rated-q').value} ${location.hash}`));

    await page.evaluate(() => localStorage.removeItem('mrt.state.v2'));
    await setMode(page, 'pass');
    await boot(page, '#/library');
    await page.waitForFunction(() => document.querySelector('#library-rated-shelf-status').textContent.length > 0);
    const shelfEmpty = await page.$eval('#library-rated-shelf-status', (n) => n.textContent);
    await page.evaluate(() => { location.hash = '#/library-rated'; });
    await panelShown(page);
    t.check('with no ratings both surfaces explain how to rate and offer a next step',
      shelfEmpty === 'Comics you rate from their Issue details will appear here.'
        && await page.$eval('#library-rated-results', (n) => n.textContent.includes('You have not rated any comics yet')
          && [...n.querySelectorAll('a.btn')].some((a) => a.textContent === 'Browse Reading Lists' && a.getAttribute('href') === '#/catalog')),
      await page.$eval('#library-rated-results', (n) => `${n.textContent} ${n.querySelector('a')?.getAttribute('href')}`));
    t.check('the failure paths introduce no page exceptions', errors.length === 0, errors.join('; '));
  },
};

export const libraryRatingMutations = [
  {
    id: 'library-ratings-forget-opener',
    breaks: 'library-ratings',
    why: 'returning from a comic no longer restores the reader to the row they opened',
    rewriteMain: (source) => source.replace('if (focus) ratedView.restoreOpener(history.state?.issueFocusOpener);', ''),
  },
  {
    id: 'library-ratings-drop-unsaved',
    breaks: 'library-ratings',
    why: 'ratings for comics with no saved details silently disappear from the browser',
    rewriteRatedComics: (source) => source.replace('if (!validIssueId(issueId) || !isIssueRating(score)) continue;',
      'if (!validIssueId(issueId) || !isIssueRating(score) || !state.issues?.[issueId]) continue;'),
  },
  {
    id: 'library-ratings-keep-ticket',
    breaks: 'library-ratings-failures',
    why: 'a pending focus return survives the reader typing, so a late lookup steals focus',
    rewriteRatedView: (source) => source.replace('const withdraw = () => { ticket = null; };', 'const withdraw = () => {};'),
  },
];
