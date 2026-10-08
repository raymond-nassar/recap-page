export const issueRatings = {
  id: 'issue-ratings',
  title: 'Private half-star ratings preserve reading, drafts, recovery and responsive controls',
  async run(page, t) {
    const click = (selector) => page.$eval(selector, (node) => node.click());
    const visible = async (selector) => page.$eval(selector, (node) => node.getClientRects().length > 0);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${page.__origin}/`, { waitUntil: 'load' });
    await page.evaluate(async () => {
      const model = await import('/js/lib/model.js');
      let state = model.createList(model.createEmptyState(), { id: 'ratings', name: 'Rating fixture' });
      state = model.addIssuesToList(state, 'ratings', [
        { issueId: 1001, title: 'Rating fixture #1', seriesName: 'Rating fixture', number: '1', source: 'manual', hydrated: true },
        { issueId: -42, title: 'Print fixture', source: 'manual', hydrated: true },
      ]).state;
      state = model.setIssueNote(state, 1001, 'Private fixture note');
      localStorage.setItem('mrt.state.v2', JSON.stringify(model.exportBackup(state)));
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false, theme: 'dark' }));
    });
    await page.goto(`${page.__origin}/?ratings=1#/issue/1001?list=ratings`, { waitUntil: 'load' });
    await page.waitForSelector('#issue-rating-root:not([hidden])');
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')));
    t.check('unrated is one quiet trigger, not an open editor', await visible('#issue-rating-trigger')
      && await page.$eval('#issue-rating-dialog', (node) => !node.open));
    await click('#issue-rating-trigger');
    await click('#issue-rating-stars [data-rating="4"]');
    await click('#issue-rating-decrease');
    t.check('whole-star shortcut plus one decrement selects 3.5', await page.$eval('#issue-rating-input', (node) => node.value === '3.5'));
    await click('#issue-rating-save');
    await page.waitForFunction(() => !document.querySelector('#issue-rating-dialog').open);
    await page.waitForFunction(() => document.activeElement.id === 'issue-rating-trigger');
    const rated = await page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')));
    t.check('half-star save is durable and changes only personal rating data',
      rated.ratings?.[1001] === 3.5 && ['read', 'overrides', 'notes', 'lists', 'listOrder', 'active', 'issues']
        .every((key) => JSON.stringify(rated[key]) === JSON.stringify(before[key])));
    t.check('success returns focus and shows the compact saved score', await page.$eval('#issue-rating-trigger',
      (node) => document.activeElement === node && node.textContent.includes('3.5/5')));
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#issue-rating-root:not([hidden])');
    t.check('reload retains the score', await page.$eval('#issue-rating-label', (node) => node.textContent.includes('3.5/5')));
    await click('#issue-rating-trigger');
    await click('#issue-rating-stars [data-rating="1"]');
    await click('#issue-rating-cancel');
    t.check('Cancel preserves the previous rating', await page.$eval('#issue-rating-label', (node) => node.textContent.includes('3.5/5')));
    await click('#issue-rating-trigger');
    await page.focus('#issue-rating-input');
    await page.keyboard.press('ArrowUp');
    t.check('native keyboard half-step is available', await page.$eval('#issue-rating-input', (node) => node.value === '4'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#issue-rating-dialog').open
      && document.activeElement.id === 'issue-rating-trigger');
    t.check('Escape closes without saving and restores focus', await page.$eval('#issue-rating-trigger',
      (node) => document.activeElement === node && !document.querySelector('#issue-rating-dialog').open));

    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      window.__ratingRestoreStorage = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === 'mrt.state.v2') throw new DOMException('Rating quota fixture', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await click('#issue-rating-trigger');
    await click('#issue-rating-stars [data-rating="5"]');
    await click('#issue-rating-save');
    t.check('failed persistence leaves the draft open and saved score unchanged', await page.evaluate(() =>
      document.querySelector('#issue-rating-dialog').open
      && document.querySelector('#issue-rating-input').value === '5'
      && document.querySelector('#issue-rating-error').textContent.length > 0
      && JSON.parse(localStorage.getItem('mrt.state.v2')).ratings?.[1001] === 3.5));
    await page.evaluate(() => window.__ratingRestoreStorage());
    await click('#issue-rating-cancel');

    const peer = await page.browserContext().newPage();
    try {
      peer.on('pageerror', (error) => errors.push(error.message));
      await peer.setRequestInterception(true);
      peer.on('request', (request) => {
        if (request.url().startsWith(page.__origin)) void request.continue();
        else void request.abort();
      });
      await peer.goto(`${page.__origin}/#/issue/1001?list=ratings`, { waitUntil: 'load' });
      await peer.waitForSelector('#issue-rating-root:not([hidden])');
      await click('#issue-rating-trigger');
      await peer.$eval('#issue-rating-trigger', (node) => node.click());
      await peer.$eval('#issue-rating-stars [data-rating="2"]', (node) => node.click());
      await peer.$eval('#issue-rating-save', (node) => node.click());
      await page.waitForFunction(() => document.querySelector('#issue-rating-save').disabled, { polling: 50 });
      t.check('a changed rating withdraws stale Save and Remove, preserving the draft', await page.evaluate(() =>
        document.querySelector('#issue-rating-input').value === '3.5'
        && document.querySelector('#issue-rating-remove').disabled
        && document.querySelector('#issue-rating-error').textContent.includes('changed')));
    } finally {
      await peer.close();
    }
    await click('#issue-rating-cancel');
    await click('#issue-rating-trigger');
    await click('#issue-rating-remove');
    t.check('Remove returns to unrated without recording zero', await page.evaluate(() =>
      !Object.hasOwn(JSON.parse(localStorage.getItem('mrt.state.v2')).ratings, 1001)
      && document.querySelector('#issue-rating-label').textContent === 'Rate this issue'));

    await page.goto(`${page.__origin}/#/issue/-42?list=ratings`, { waitUntil: 'load' });
    await page.waitForSelector('#issue-rating-root:not([hidden])');
    await click('#issue-rating-trigger');
    await click('#issue-rating-increase');
    await click('#issue-rating-save');
    t.check('manual negative identities can save the minimum half-star', await page.evaluate(() =>
      JSON.parse(localStorage.getItem('mrt.state.v2')).ratings?.[-42] === 0.5));

    await click('#issue-rating-trigger');
    for (const [width, theme] of [[1280, 'dark'], [390, 'light'], [320, 'dark']]) {
      await page.setViewport({ width, height: 900 });
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const layout = await page.evaluate(() => {
        const dialog = document.querySelector('#issue-rating-dialog');
        const rect = dialog.getBoundingClientRect();
        const controls = [...dialog.querySelectorAll('button, input')].filter((node) => node.getClientRects().length);
        return { visible: dialog.open && rect.width > 0, fits: rect.left >= 0 && rect.right <= innerWidth,
          targets: controls.every((node) => node.getBoundingClientRect().height >= 44),
          overflow: dialog.scrollWidth > dialog.clientWidth + 1 };
      });
      t.check(`${width}px ${theme} editor fits with 44px targets`, layout.visible && layout.fits && layout.targets && !layout.overflow, JSON.stringify(layout));
    }
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await page.focus('#issue-rating-input');
    t.check('forced colors retains keyboard focus and visible star boundaries', await page.evaluate(() =>
      parseFloat(getComputedStyle(document.activeElement).outlineWidth) > 0
      && getComputedStyle(document.querySelector('#issue-rating-stars svg')).stroke !== 'none'));
    await cdp.detach();
    await click('#issue-rating-cancel');
    t.check('the feature introduces no page exceptions', errors.length === 0, errors.join('; '));
  },
};

export const issueRatingMutations = [
  {
    id: 'issue-ratings-round-halves',
    breaks: 'issue-ratings',
    why: 'saving rounds away the explicitly chosen half-star',
    rewriteMain: (source) => source.replace('setIssueRating(state, issueId, value)', 'setIssueRating(state, issueId, value === null ? null : Math.round(value))'),
  },
  {
    id: 'issue-ratings-omit-durable-map',
    breaks: 'issue-ratings',
    why: 'the explicit backup serializer drops ratings before persistence',
    rewriteModel: (source) => source.replace('ratings: clean.ratings ?? {},', 'ratings: {},'),
  },
];
