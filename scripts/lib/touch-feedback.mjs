export async function touchFeedbackCheck(page, check, label) {
  await page.waitForSelector('a.home-path');
  await page.evaluate(() => {
    document.querySelector('#home-updates-close')?.click();
    const fixture = document.createElement('section');
    fixture.id = 'touch-feedback-fixture';
    fixture.innerHTML = `
      <button type="button" class="btn" id="touch-command">Check press</button>
      <fieldset class="completion-enjoyment">
        <legend>Selected command fixture</legend>
        <button type="button" class="btn btn-g" aria-pressed="true" id="touch-selected">Enjoyed</button>
      </fieldset>
      <button type="button" class="btn" disabled id="touch-disabled">Disabled</button>
      <a class="btn" aria-disabled="true" id="touch-unavailable">Unavailable</a>
      <label for="touch-field">Editable text</label>
      <textarea id="touch-field">Selectable editable text</textarea>
      <p id="touch-copy">Selectable reading text</p>`;
    document.querySelector('main').append(fixture);
    window.__touchFeedbackClicks = 0;
    document.querySelector('#touch-command').addEventListener('click', () => { window.__touchFeedbackClicks++; });
  });
  const saved = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
  const client = await page.createCDPSession();
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const measure = (selector) => page.$eval(selector, (node) => {
    const css = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      active: node.matches(':active, [data-pressing]'), focus: node.matches(':focus-visible'),
      shadow: css.boxShadow, outline: css.outlineStyle, outlineWidth: css.outlineWidth,
      offset: css.outlineOffset, border: css.borderColor, color: css.color,
      selection: css.userSelect, tap: css.webkitTapHighlightColor,
      transition: css.transitionDuration, animation: css.animationName,
      box: [rect.x, rect.y, rect.width, rect.height],
    };
  });
  const point = async (selector) => {
    await page.$eval(selector, (node) => {
      document.activeElement?.blur();
      if (node.closest('.rail-header')) window.scrollTo(0, 0);
      else node.scrollIntoView({ block: 'center' });
    });
    await page.mouse.move(1, 1);
    await new Promise((resolve) => setTimeout(resolve, 180));
    await frames();
    const box = await page.$eval(selector, (node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    return box;
  };
  const edge = (held, before, forced) => forced
    ? held.outline === 'solid' && held.outlineWidth === '3px' && held.offset === '-3px'
      && (held.offset !== before.offset || held.outline !== before.outline)
    : held.shadow.includes('inset') && held.shadow !== before.shadow;
  try {
    const modes = [
      { name: 'light', theme: 'light' }, { name: 'dark', theme: 'dark' },
      { name: 'system-light', scheme: 'light' }, { name: 'system-dark', scheme: 'dark' },
      { name: 'reduced-motion', theme: 'dark', reduced: true },
      { name: 'forced-colors', theme: 'light', forced: true },
    ];
    for (const mode of modes) {
      await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: mode.scheme || 'light' },
        { name: 'prefers-reduced-motion', value: mode.reduced ? 'reduce' : 'no-preference' },
        { name: 'forced-colors', value: mode.forced ? 'active' : 'none' },
      ]);
      await page.evaluate((theme) => {
        if (theme) document.documentElement.dataset.theme = theme;
        else document.documentElement.removeAttribute('data-theme');
      }, mode.theme);
      const selectors = ['#touch-command', '#touch-selected', '.brand', '#btn-rail-toggle', 'a.home-path', '#home-updates-toggle'];
      for (const selector of selectors) {
        const p = await point(selector);
        await page.mouse.move(p.x, p.y);
        // Existing hover motion is not a pressed-state geometry change.
        await new Promise((resolve) => setTimeout(resolve, 180));
        const before = await measure(selector);
        await page.mouse.down();
        const held = await measure(selector);
        check(held.active && edge(held, before, mode.forced)
          && held.box.every((value, i) => Math.abs(value - before.box[i]) < .5),
        `${label} ${mode.name} ${selector}: held mouse has an inset edge without moving ${JSON.stringify({ before, held })}`);
        if (selector === '#touch-selected') {
          check(held.border === before.border && (mode.forced || held.shadow.includes(before.shadow)),
            `${label} ${mode.name}: selected command retains its persistent border and inset shadow`);
        }
        await page.mouse.move(page.viewport().width - 1, 1);
        await page.mouse.up();
        const released = await measure(selector);
        check(!released.active && released.shadow === before.shadow && released.offset === before.offset,
          `${label} ${mode.name} ${selector}: release outside clears held paint`);
      }
      for (const selector of ['#touch-disabled', '#touch-unavailable']) {
        const p = await point(selector);
        await page.mouse.move(p.x, p.y);
        const before = await measure(selector);
        await page.mouse.down();
        const held = await measure(selector);
        await page.mouse.move(1, 1);
        await page.mouse.up();
        check(held.shadow === before.shadow && held.outline === before.outline && held.offset === before.offset,
          `${label} ${mode.name} ${selector}: disabled control gains no enabled edge`);
      }
      const p = await point('#touch-command');
      await page.mouse.move(1, 1);
      const before = await measure('#touch-command');
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const held = await measure('#touch-command');
      check(held.active && edge(held, before, mode.forced) && held.tap === before.tap,
        `${label} ${mode.name}: trusted held touch has feedback and retains native tap highlight ${JSON.stringify({ before, held })}`);
      await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await frames();
      const cancelled = await measure('#touch-command');
      check(!cancelled.active && cancelled.shadow === before.shadow
        && await page.evaluate(() => window.__touchFeedbackClicks === 0),
      `${label} ${mode.name}: touch cancellation clears feedback without activating`);
      await page.$eval('#touch-command', (node) => node.focus());
      await page.keyboard.press('Tab');
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
      const focused = await measure('#touch-command');
      await page.keyboard.down('Space');
      const keyHeld = await measure('#touch-command');
      check(focused.focus && keyHeld.focus && keyHeld.outline !== 'none'
        && keyHeld.outlineWidth === focused.outlineWidth && keyHeld.offset === focused.offset
        && (mode.forced || edge(keyHeld, focused, false))
        && await page.evaluate(() => window.__touchFeedbackClicks === 0),
      `${label} ${mode.name}: held Space preserves visible keyboard focus and waits for release`);
      await page.keyboard.up('Space');
      check(await page.evaluate(() => window.__touchFeedbackClicks === 1),
        `${label} ${mode.name}: Space release activates once`);
      await page.evaluate(() => { window.__touchFeedbackClicks = 0; });
      const compatibility = await page.evaluate(() => {
        const field = document.querySelector('#touch-field');
        field.focus();
        field.setSelectionRange(0, 10);
        const from = field.selectionStart;
        const to = field.selectionEnd;
        field.blur();
        const range = document.createRange();
        range.selectNodeContents(document.querySelector('#touch-copy'));
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const css = getComputedStyle(field);
        return { copy: selection.toString(), from, to,
          fieldSelect: css.userSelect, copySelect: getComputedStyle(document.querySelector('#touch-copy')).userSelect,
          animation: getComputedStyle(document.querySelector('#touch-command')).animationName,
          transition: getComputedStyle(document.querySelector('#touch-command')).transitionDuration };
      });
      check(compatibility.copy === 'Selectable reading text' && compatibility.from === 0 && compatibility.to === 10
        && compatibility.fieldSelect !== 'none' && compatibility.copySelect !== 'none'
        && compatibility.animation === 'none' && compatibility.transition === '0s',
      `${label} ${mode.name}: reading and editable selection remain usable with no pressed animation ${JSON.stringify(compatibility)}`);
    }
    for (const selector of ['#touch-disabled', '#touch-unavailable', '#touch-field']) {
      const p = await point(selector);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
      check(await page.$eval(selector, (node) => !node.hasAttribute('data-pressing')),
        `${label} ${selector}: touch observer leaves disabled controls and editable fields alone`);
      await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    }
    for (const reason of ['move-outside', 'scroll', 'blur', 'release']) {
      const p = await point('#touch-command');
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
      check(await page.$eval('#touch-command', (node) => node.hasAttribute('data-pressing')),
        `${label} ${reason}: observer starts from an actual touch hold`);
      if (reason === 'move-outside') {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 1, y: 1 }] });
      } else if (reason === 'scroll') {
        await page.evaluate(() => window.scrollBy(0, -30));
      } else if (reason === 'blur') {
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      } else {
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await frames();
      check(await page.$eval('#touch-command', (node) => !node.hasAttribute('data-pressing')),
        `${label} ${reason}: held attribute is withdrawn`);
      if (reason !== 'release') {
        await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      }
    }
    check(await page.evaluate(() => window.__touchFeedbackClicks === 1),
      `${label}: touch release activates once; cancellation, scroll and blur add no activation`);
    check(await page.evaluate((value) => localStorage.getItem('mrt.state.v2') === value, saved),
      `${label}: held and cancelled checks leave saved progress unchanged`);
  } finally {
    await page.keyboard.up('Space');
    await page.emulateMediaFeatures([]);
    await client.detach();
    await page.evaluate(() => {
      document.querySelector('#touch-feedback-fixture')?.remove();
      delete window.__touchFeedbackClicks;
      getSelection().removeAllRanges();
    });
  }
}
