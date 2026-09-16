const expected = [
  '# Spider-Man reading list', '',
  '- [x] Amazing Spider-Man (2018) #1',
  '- [ ] Amazing Spider-Man (2018) #2',
  '- [ ] Amazing Spider-Man (2018) #3', '',
].join('\n');

export const readableMarkdownExport = {
  id: 'readable-markdown-export',
  title: 'readable Markdown export is private by default and preserves the whole list',
  async run(page, t) {
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
      localStorage.setItem('mrt.state.v2', JSON.stringify({
        schemaVersion: 2,
        issues: Object.fromEntries([1, 2, 3].map((id) => [id, {
          issueId: id,
          title: `Amazing Spider-Man (2018) #${id}`,
          url: `https://www.marvel.com/comics/issue/${id}/`,
          source: 'manual',
          hydrated: true,
        }])),
        lists: {
          'markdown-fixture': {
            id: 'markdown-fixture', name: 'Spider-Man reading list',
            description: 'An optional description.', note: 'Private list note.',
            itemIds: [1, 2, 3], collectedIn: { 1: 'First collection', 2: 'First collection' },
          },
        },
        listOrder: ['markdown-fixture'],
        active: 'markdown-fixture',
        read: { 1: 123456789 },
        notes: { 1: 'Private issue note.' },
        overrides: { 1: 'available' },
      }));
      const fetch = window.fetch.bind(window);
      window.__exportRequests = 0;
      window.fetch = (...args) => {
        window.__exportRequests += 1;
        return fetch(...args);
      };
    });
    await page.goto(`${page.__origin}/?catalog=browser-check#/read/markdown-fixture`, { waitUntil: 'load' });
    await page.waitForSelector('#list-export > summary', { visible: true });
    await page.focus('#list-export > summary');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#btn-export-md', { visible: true });
    await page.$eval('#full', (node) => { node.open = true; });
    await page.$eval('#reading-filters input[value="unread"]', (node) => node.click());
    await page.waitForFunction(() => document.querySelectorAll('#rows .row').length === 2);
    await page.waitForNetworkIdle({ idleTime: 200 });
    const before = await page.evaluate(() => ({
      state: localStorage.getItem('mrt.state.v2'),
      requests: window.__exportRequests,
    }));
    const open = async (selector) => {
      await page.focus(selector);
      await page.$eval(selector, (node) => node.click());
      await page.waitForSelector('#markdown-export[open]');
    };
    const preview = () => page.$eval('#markdown-export-preview', (node) => node.value);
    const download = async (count) => {
      await page.$eval('#markdown-export button[type="submit"]', (node) => node.click());
      await page.waitForFunction((n) => window.__mrtDownloads.length === n, {}, count);
      return page.evaluate(() => window.__mrtDownloads.at(-1));
    };

    await open('#btn-export-md');
    t.check('reading export previews the exact plain checklist, including the filtered read comic',
      await preview() === expected);
    t.check('native export dialog contains the keyboard focus',
      await page.evaluate(() => document.querySelector('#markdown-export').contains(document.activeElement)));
    t.check('personal notes and other optional details start unchecked',
      await page.$$eval('#markdown-export input', (inputs) => inputs.every(
        (input) => input.checked === (input.name === 'includeProgress'),
      )) && await page.$eval('#markdown-export-description', (node) => (
        node.textContent.includes('read checkboxes by default') && node.textContent.includes('Export order only')
      )));
    const first = await download(1);
    t.check('downloaded text matches the preview and uses Markdown MIME type',
      first.text === expected && first.type === 'text/markdown', JSON.stringify(first));
    t.check('download closes and removes the dialog and returns focus to its opener',
      await page.evaluate(() => !document.querySelector('#markdown-export')
        && document.activeElement.id === 'btn-export-md' && document.querySelector('#list-export').open));

    await open('#btn-export-md');
    await page.$$eval('#markdown-export input', (inputs) => {
      for (const input of inputs) input.checked = input.name !== 'includeProgress';
      inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    });
    const selected = await preview();
    t.check('selected extras appear and progress-off produces ordinary linked bullets',
      selected.includes('> Private list note.') && selected.includes('> Private issue note.')
        && selected.includes('> An optional description.') && selected.includes('## First collection')
        && selected.includes('- [Amazing Spider-Man (2018) #1](https://www.marvel.com/comics/issue/1/)')
        && !selected.includes('- [x]') && !selected.includes('- [ ]'), selected);
    t.check('selected extras still contain no internal fields or availability override',
      !/schemaVersion|markdown-fixture|overrides|available|issueId/.test(selected));
    const second = await download(2);
    t.check('the selected-options download equals its preview', second.text === selected);

    await page.$eval('[data-view="data"]', (node) => node.click());
    await page.waitForSelector('#view-data:not([hidden])');
    await open('#btn-export-md-2');
    t.check('Backup and settings uses the same default output and does not remember private-note inclusion',
      await preview() === expected
        && await page.$eval('#markdown-export input[name="includeNotes"]', (input) => !input.checked));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#markdown-export'));
    t.check('Escape downloads nothing and restores keyboard focus',
      await page.evaluate(() => window.__mrtDownloads.length === 2
        && document.activeElement.id === 'btn-export-md-2'));

    await open('#btn-export-md-2');
    await page.setViewport({ width: 360, height: 900 });
    const layout = await page.$eval('#markdown-export', (dialog) => {
      const box = dialog.getBoundingClientRect();
      return {
        fits: box.left >= 0 && box.right <= innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
        labelled: [...dialog.querySelectorAll('input')].every((input) => input.labels.length === 1),
        targets: [...dialog.querySelectorAll('label.checkbox, button')].map((node) => ({
          text: node.textContent.trim(),
          height: node.getBoundingClientRect().height,
          minimum: getComputedStyle(node).minHeight,
        })),
      };
    });
    t.check('narrow export dialog fits, labels every choice and retains touch targets',
      layout.fits && !layout.overflow && layout.labelled
        && layout.targets.every((target) => target.height >= 44), JSON.stringify(layout));
    await page.$eval('#markdown-export [data-action="cancel"]', (node) => node.click());
    await page.waitForFunction(() => !document.querySelector('#markdown-export'));
    t.check('Cancel downloads nothing and removes the dialog',
      await page.evaluate(() => window.__mrtDownloads.length === 2 && !document.querySelector('#markdown-export')));

    await page.setViewport({ width: 1280, height: 900 });
    await open('#btn-export-md-2');
    const third = await download(3);
    t.check('Backup and settings downloads the same readable file', third.text === expected);
    const after = await page.evaluate(() => ({
      state: localStorage.getItem('mrt.state.v2'),
      requests: window.__exportRequests,
    }));
    t.check('export, option changes and cancellation leave saved data byte-for-byte unchanged',
      after.state === before.state);
    t.check('the export flow makes no fetch requests', after.requests === before.requests,
      JSON.stringify({ before: before.requests, after: after.requests }));
    await page.$eval('#btn-export-json', (node) => node.click());
    await page.waitForFunction(() => window.__mrtDownloads.length === 4);
    const backup = await page.evaluate(() => JSON.parse(window.__mrtDownloads.at(-1).text));
    t.check('the separate JSON backup still preserves notes, progress and availability overrides',
      backup.notes[1] === 'Private issue note.' && backup.read[1] === 123456789
        && backup.overrides[1] === 'available'
        && backup.lists['markdown-fixture'].note === 'Private list note.');

    await page.evaluate(() => { location.hash = '#/read/markdown-fixture'; });
    await page.waitForSelector('#view-read:not([hidden])');
    await page.evaluate(() => {
      window.__exportShowModal = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () {
        if (this.id === 'markdown-export') throw new Error('Synthetic dialog failure');
        return window.__exportShowModal.call(this);
      };
    });
    await page.$eval('#btn-export-md', (node) => node.click());
    await page.waitForFunction(() => [...document.querySelectorAll('#app-report, #restore-report')]
      .some((node) => node.textContent.includes('Synthetic dialog failure')));
    t.check('a dialog failure is visible on Reading and produces no download or abandoned dialog',
      await page.evaluate(() => document.querySelector('#app-report').checkVisibility()
        && document.querySelector('#app-report').textContent.includes('Synthetic dialog failure')
        && !document.querySelector('#markdown-export') && window.__mrtDownloads.length === 4));
    await page.evaluate(() => {
      HTMLDialogElement.prototype.showModal = window.__exportShowModal;
      window.__exportCreateUrl = URL.createObjectURL;
      URL.createObjectURL = (blob) => {
        if (blob.type === 'text/markdown') throw new Error('Synthetic download failure');
        return window.__exportCreateUrl(blob);
      };
    });
    await open('#btn-export-md');
    await page.$eval('#markdown-export button[type="submit"]', (node) => node.click());
    await page.waitForFunction(() => [...document.querySelectorAll('#app-report, #restore-report')]
      .some((node) => node.textContent.includes('Synthetic download failure')));
    t.check('a download failure is visible on Reading without changing saved data',
      await page.evaluate((state) => document.querySelector('#app-report').checkVisibility()
        && document.querySelector('#app-report').textContent.includes('Synthetic download failure')
        && !document.querySelector('#markdown-export') && window.__mrtDownloads.length === 4
        && localStorage.getItem('mrt.state.v2') === state, before.state));
    await page.evaluate(() => { URL.createObjectURL = window.__exportCreateUrl; });
  },
};
