export const dialogAnnouncements = {
  id: 'dialog-announcements',
  title: 'shared feedback remains in the modal accessibility tree without replaying cancelled speech',
  async run(page, t) {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${page.__origin}/#/home`, { waitUntil: 'load' });
    await page.waitForSelector('#home-categories .home-path');
    const dialogs = await page.$$eval('dialog', (nodes) => nodes.map((node) => node.id));
    t.check('the check covers Preview and shared questions', dialogs.includes('preview') && dialogs.includes('ask'));
    for (const id of dialogs) {
      const observed = await page.evaluate(async (dialogId) => {
        const { notify } = await import('/js/main.js');
        const dialog = document.getElementById(dialogId);
        dialog.showModal();
        const focused = document.activeElement;
        const pageBefore = document.getElementById('announcer').textContent;
        notify('#app-report', 'Synthetic gap notes.', 'warn', 'modal-proof');
        notify('#save-report', 'Synthetic save failed.', 'error', 'modal-save-proof');
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          text: dialog.querySelector('[data-dialog-announcer]')?.textContent,
          regions: dialog.querySelectorAll('[data-dialog-announcer]').length,
          pageUnchanged: document.getElementById('announcer').textContent === pageBefore,
          focusUnchanged: document.activeElement === focused,
        };
      }, id);
      const region = await page.$(`#${id} [data-dialog-announcer]`);
      const tree = region ? await page.accessibility.snapshot({ root: region, interestingOnly: false }) : null;
      const pageRegion = await page.$('#announcer');
      const behind = await page.accessibility.snapshot({ root: pageRegion, interestingOnly: false });
      const report = await page.$(`#${id} .report`);
      const reportTree = report ? await page.accessibility.snapshot({ root: report, interestingOnly: false }) : null;
      const localGap = reportTree?.role === 'status' && JSON.stringify(reportTree).includes('Synthetic gap notes.');
      const expected = localGap ? 'Synthetic save failed.' : 'Synthetic gap notes. Synthetic save failed.';
      t.check(`${id}: joined feedback uses one modal status without moving focus`,
        observed.text === expected && observed.regions === 1
        && observed.pageUnchanged && observed.focusUnchanged, JSON.stringify(observed));
      t.check(`${id}: status and both messages are in the AX tree, page status is not`,
        tree?.role === 'status' && JSON.stringify(tree).includes(observed.text) && behind === null,
        JSON.stringify({ tree, behind }));
      const reopened = await page.evaluate(async (dialogId) => {
        const { notify } = await import('/js/main.js');
        const dialog = document.getElementById(dialogId);
        notify('#save-report', 'Stale before cancel.', 'warn', 'modal-save-proof');
        dialog.close();
        dialog.showModal();
        notify('#save-report', 'Current question only.', 'warn', 'modal-save-proof');
        await new Promise((resolve) => setTimeout(resolve, 80));
        const text = dialog.querySelector('[data-dialog-announcer]').textContent;
        dialog.close();
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { text, retired: dialog.querySelector('[data-dialog-announcer]').textContent };
      }, id);
      t.check(`${id}: immediate reuse discards old queued speech and closing clears the status`,
        reopened.text === 'Current question only.' && reopened.retired === '', JSON.stringify(reopened));
    }
    await page.evaluate(async () => {
      const { notify } = await import('/js/main.js');
      notify('#app-report', 'Back on the page.', 'ok', 'modal-proof');
    });
    await page.waitForFunction(() => document.getElementById('announcer').textContent === 'Back on the page.');
    const pageRegion = await page.$('#announcer');
    const tree = await page.accessibility.snapshot({ root: pageRegion, interestingOnly: false });
    t.check('closing restores the page channel in the accessibility tree',
      tree?.role === 'status' && JSON.stringify(tree).includes('Back on the page.'), JSON.stringify(tree));
  },
};
