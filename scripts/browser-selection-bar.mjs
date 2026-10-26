// UX-06 (#833): the Add comics selection bar, in a real browser. Once anything is selected, Save
// selected comics must be visible at any scroll position, above the bottom navigation bar on narrow
// windows, with Clear selection less prominent than it. The bar must never cover the control that
// has keyboard focus (WCAG 2.4.11), and the keyboard order through it must stay the page order.
// Runs on the ephemeral port like every scenario not listed for the app origin.
const VIEW = '#view-add-creator';
const BAR = `${VIEW} .comic-builder`;
const TOGGLE = `${BAR} .comic-save-toggle`;
const CLEAR = `${BAR} .comic-clear`;
const click = (page, selector) => page.$eval(selector, (element) => element.click());
const frames = (page) => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));
// Screenshots for review, written outside the repository and never under a mutation.
const shot = async (page, name) => {
  const dir = process.env.MRT_SELECTION_BAR_EVIDENCE;
  if (dir && !page.__mutation) await page.screenshot({ path: `${dir}/${name}.png` });
};

let visit = 0;
async function search(page, viewport, theme, covers = false) {
  await page.setViewport(viewport);
  // A query of its own each time, because going to the address already showing is a same-document
  // hash change that never fires load.
  visit += 1;
  await page.goto(`${page.__origin}/?selection-bar=${visit}#/add-creator`, { waitUntil: 'load' });
  await page.evaluate((value, art) => {
    localStorage.setItem('mrt.settings', JSON.stringify({ covers: art, theme: value }));
  }, theme, covers);
  // A reload rather than a hash change, so the theme is read at boot and no selection carries over.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector(`${VIEW}:not([hidden])`);
  await page.$eval('#creator-q', (input) => { input.value = 'Brubaker'; });
  await click(page, '#form-creator button[type="submit"]');
  await page.waitForSelector('#creator-results input[data-comic-id]', { timeout: 15000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await frames(page);
}

// Where the bar, its two commands and the bottom bar are, and whether a press at the middle of
// each command would reach it rather than whatever is painted over it.
function geometry(page) {
  return page.evaluate((barSelector) => {
    const box = (node) => {
      const { top, bottom, left, right, width, height } = node.getBoundingClientRect();
      return { top, bottom, left, right, width, height };
    };
    const reached = (node) => {
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit === node || node.contains(hit);
    };
    const bar = document.querySelector(barSelector);
    const nav = document.querySelector('.rail-header');
    const fixed = getComputedStyle(nav).position === 'fixed';
    const navBox = box(nav);
    const toggle = bar.querySelector('.comic-save-toggle');
    const clear = bar.querySelector('.comic-clear');
    return {
      hidden: bar.hidden,
      bar: box(bar),
      toggle: { ...box(toggle), reached: reached(toggle) },
      clear: { ...box(clear), reached: reached(clear) },
      nav: fixed ? { ...navBox, hidden: nav.classList.contains('mobile-nav-hidden'), onScreen: navBox.top < innerHeight - 1 } : null,
      height: innerHeight,
      y: scrollY,
      max: document.documentElement.scrollHeight - innerHeight,
    };
  }, BAR);
}

const inside = (rect, height) => rect.top >= -0.5 && rect.bottom <= height + 0.5;

// The focused control, its focus ring included, and whether the bar or the bottom bar covers any
// of it. Points across the control must reach the control itself, which is what a press would do.
function focused(page) {
  return page.evaluate((barSelector) => {
    const node = document.activeElement;
    const bar = document.querySelector(barSelector);
    const style = getComputedStyle(node);
    const ring = node.matches(':focus-visible')
      ? parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset)) : 0;
    const r = node.getBoundingClientRect();
    const edge = { top: r.top - ring, bottom: r.bottom + ring, left: r.left - ring, right: r.right + ring };
    const b = bar.getBoundingClientRect();
    const nav = document.querySelector('.rail-header');
    const n = nav.getBoundingClientRect();
    const navCovers = getComputedStyle(nav).position === 'fixed' && n.top < innerHeight - 1
      && edge.bottom > n.top + 0.5;
    const inBar = bar.contains(node);
    const underBar = !inBar && edge.bottom > b.top + 0.5 && edge.top < b.bottom - 0.5
      && edge.right > b.left + 0.5 && edge.left < b.right - 0.5;
    const points = [[0.5, 0.5], [0.1, 0.5], [0.9, 0.5], [0.5, 0.1], [0.5, 0.9]];
    const reached = r.width > 0 && r.height > 0 && points.every(([x, y]) => {
      const hit = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y);
      return hit === node || node.contains(hit) || (node.matches('input') && hit === node.closest('label'));
    });
    // Inside the bar the clip that matters is the bar's own, because past its height cap it scrolls.
    // The window's edges are judged by the control's own box: Shift+Tab scrolls a control in at the
    // top with its ring just past the edge, as on every screen. The ring is what the bar must clear.
    const clip = inBar ? { top: Math.max(0, b.top), bottom: Math.min(innerHeight, b.bottom) } : { top: 0, bottom: innerHeight };
    return {
      name: node.id || node.getAttribute('aria-label') || node.textContent.trim().slice(0, 40),
      tag: node.tagName,
      inBar,
      inResults: Boolean(node.closest('#creator-results')),
      underBar,
      navCovers,
      reached,
      visible: r.top >= clip.top - 0.5 && r.bottom <= clip.bottom + 0.5,
      at: { top: Math.round(r.top), bottom: Math.round(r.bottom), bar: Math.round(b.top), y: Math.round(scrollY),
        padding: getComputedStyle(document.documentElement).scrollPaddingBottom, height: innerHeight },
    };
  }, BAR);
}

async function walk(page, limit, stop, back = false) {
  const stops = [];
  for (let step = 0; step < limit; step += 1) {
    if (back) {
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
    } else {
      await page.keyboard.press('Tab');
    }
    await frames(page);
    const now = await focused(page);
    stops.push(now);
    if (stop(now)) break;
  }
  return stops;
}

export const selectionBar = {
  id: 'comic-selection-bar',
  title: 'the selection bar keeps Save selected comics in view and never covers the focused control',
  async run(page, t) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.evaluateOnNewDocument(() => { window.__mrtComicSearch = true; });
    const client = await page.createCDPSession();
    const media = (features) => client.send('Emulation.setEmulatedMedia', { features });
    await media([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

    for (const [viewport, theme, covers, label, slug] of [
      [{ width: 1280, height: 900 }, 'dark', false, '1280x900 dark', '1280x900-dark'],
      [{ width: 390, height: 844 }, 'light', true, '390x844 light with cover art, bottom bar', '390x844-light-covers'],
      [{ width: 640, height: 450 }, 'dark', false, '640x450 dark, a 1280x900 window at 200%', '640x450-dark'],
    ]) {
      await search(page, viewport, theme, covers);
      t.check(`${label}: nothing selected shows no bar, and these screens carry no cover art either way`,
        await page.$eval(BAR, (bar) => bar.hidden && !bar.getClientRects().length
          && document.body.classList.contains('nocovers') === !JSON.parse(localStorage.getItem('mrt.settings')).covers
          && !document.querySelector('#view-add-creator img')));

      // A comic far down the 50 rendered rows, ticked from the keyboard where it sits.
      await page.$eval('#creator-results input[data-comic-id="978045"]', (input) => {
        input.scrollIntoView({ block: 'center' });
        input.focus();
      });
      await page.keyboard.press('Space');
      await frames(page);
      t.check(`${label}: ticking keeps focus on the comic and opens a bar with the count`,
        await page.evaluate((bar) => document.activeElement?.dataset.comicId === '978045'
          && document.querySelector(`${bar} .comic-selection-count`).textContent === '1 comic selected'
          && !document.querySelector(bar).hidden, BAR));
      t.check(`${label}: the bar opens with the destination form closed`,
        await page.$eval(TOGGLE, (toggle) => toggle.getAttribute('aria-expanded') === 'false'
          && !document.querySelector('#creator-save-panel').checkVisibility()
          && !document.querySelector('#creator-destination').checkVisibility()));

      const max = (await geometry(page)).max;
      // Off the checkbox first: the bottom bar steps aside whenever any input has focus, a checkbox
      // included, and this pass needs to see it in both of its places.
      await page.evaluate(() => document.activeElement.blur());
      const positions = [];
      for (const [index, fraction] of [0, 0.25, 0.5, 0.75, 1, 0.5, 0].entries()) {
        await page.evaluate((y) => window.scrollTo(0, y), Math.round(max * fraction));
        await frames(page);
        await frames(page);
        positions.push({ fraction, ...await geometry(page) });
        if (index === 2) await shot(page, `${slug}-mid-list`);
        if (index === 5) await shot(page, `${slug}-mid-list-scrolled-up`);
      }
      t.check(`${label}: Save selected comics and Clear selection are in view and pressable at every scroll position`,
        positions.every((at) => inside(at.toggle, at.height) && at.toggle.reached
          && inside(at.clear, at.height) && at.clear.reached),
        JSON.stringify(positions.map(({ fraction, y, toggle, clear }) => ({ fraction, y, toggle, clear }))));
      if (viewport.width <= 880) {
        const shown = positions.filter((at) => at.nav.onScreen);
        const away = positions.filter((at) => !at.nav.onScreen);
        t.check(`${label}: the bar sits above the bottom bar, and drops to the bottom while that bar is away`,
          shown.length > 0 && away.length > 0
            && shown.every((at) => at.bar.bottom <= at.nav.top + 0.5)
            && away.every((at) => at.bar.bottom <= at.height + 0.5 && at.height - at.bar.bottom <= 16),
          JSON.stringify(positions.map(({ fraction, bar, nav, height }) => ({ fraction, bar: bar.bottom, nav, height }))));
      }

      const weight = await page.evaluate((toggle, clear) => {
        const paint = (selector) => {
          const style = getComputedStyle(document.querySelector(selector));
          return { background: style.backgroundColor, border: style.borderTopColor, color: style.color };
        };
        const probe = document.createElement('span');
        probe.style.setProperty('color', 'var(--accent)');
        document.body.append(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        return { toggle: paint(toggle), clear: paint(clear), accent };
      }, TOGGLE, CLEAR);
      t.check(`${label}: Save is the filled primary command and Clear has no fill or edge at rest`,
        weight.toggle.background === weight.accent
          && weight.clear.background === 'rgba(0, 0, 0, 0)' && weight.clear.border === 'rgba(0, 0, 0, 0)',
        JSON.stringify(weight));

      // Every Tab stop through the results to the bar, then back up from it.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.focus('#creator-comic-filter');
      const forward = await walk(page, 140, (now) => now.inBar && now.tag === 'BUTTON' && /Save selected/.test(now.name));
      const results = forward.filter((now) => now.inResults);
      t.check(`${label}: Tab through all ${results.length} result stops leaves each one in full view, clear of the bar`,
        results.length >= 100 && results.every((now) => now.visible && now.reached && !now.underBar && !now.navCovers),
        JSON.stringify(results.filter((now) => !now.visible || !now.reached || now.underBar || now.navCovers).slice(0, 5)));
      t.check(`${label}: the last result is followed by Clear selection, then Save selected comics`,
        JSON.stringify(forward.slice(-3).map((now) => now.name)) === JSON.stringify(['Show 50 more', 'Clear selection', 'Save selected comics'])
          && forward.slice(-2).every((now) => now.visible && now.reached),
        JSON.stringify(forward.slice(-3)));
      const backward = await walk(page, 24, () => false, true);
      t.check(`${label}: Shift+Tab back into the results keeps each stop clear of the bar`,
        backward[0].name === 'Clear selection'
          && backward.slice(1).every((now) => now.inResults && now.visible && now.reached && !now.underBar && !now.navCovers),
        JSON.stringify(backward.filter((now) => !now.visible || now.underBar || now.navCovers).slice(0, 5)));

      // Opening the form from the keyboard keeps focus on its opener and the form inside the bar,
      // and moving into it leaves the page where it was, part way up the list.
      const before = await page.evaluate(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight }));
      await page.focus(TOGGLE);
      await page.keyboard.press('Enter');
      await frames(page);
      const opened = await page.evaluate((bar, toggle) => ({
        expanded: document.querySelector(toggle).getAttribute('aria-expanded'),
        focus: document.activeElement === document.querySelector(toggle),
        panel: document.querySelector('#creator-save-panel').checkVisibility(),
        inBar: document.querySelector(bar).contains(document.querySelector('#creator-save-panel')),
        cap: document.querySelector(bar).getBoundingClientRect().height <= innerHeight * 0.6 + 1,
      }), BAR, TOGGLE);
      t.check(`${label}: Enter opens the destination form inside the bar and keeps focus on Save selected comics`,
        opened.expanded === 'true' && opened.focus && opened.panel && opened.inBar && opened.cap, JSON.stringify(opened));
      await shot(page, `${slug}-form-open`);
      const form = await walk(page, 3, () => false);
      const after = await page.evaluate(() => scrollY);
      t.check(`${label}: Tab continues through Save to, List name and Create Reading List in full view`,
        JSON.stringify(form.map((now) => now.name)) === JSON.stringify(['creator-destination', 'creator-list-name', 'Create Reading List'])
          && form.every((now) => now.inBar && now.visible && now.reached),
        JSON.stringify(form));
      t.check(`${label}: moving into the bar does not scroll the page`,
        before.y < before.max - 100 && Math.abs(after - before.y) <= 1, JSON.stringify({ before, after }));
      const backOut = await walk(page, 6, (now) => now.inResults, true);
      t.check(`${label}: with the form open, Shift+Tab out of the bar still lands clear of it`,
        backOut.at(-1).inResults && backOut.at(-1).visible && backOut.at(-1).reached && !backOut.at(-1).underBar,
        JSON.stringify(backOut));
      await click(page, TOGGLE);
      const shut = await page.$eval(TOGGLE, (toggle) => ({
        expanded: toggle.getAttribute('aria-expanded'),
        panel: document.querySelector('#creator-save-panel').checkVisibility(),
      }));
      t.check(`${label}: Save selected comics closes the form again`,
        shut.expanded === 'false' && !shut.panel, JSON.stringify(shut));
      // Past the bar, the page's last stop: it must come to rest clear of the bar, which is what
      // the room the page gains at its end is for.
      await page.focus(TOGGLE);
      const [past] = await walk(page, 1, () => false);
      t.check(`${label}: Tab past the bar reaches the footer link in full view, clear of the bar`,
        past.tag === 'A' && past.name.startsWith('Unofficial fan project')
          && past.visible && past.reached && !past.underBar && !past.navCovers, JSON.stringify(past));
      // An unsaved selection would hold the next page load at the browser's leave warning.
      await click(page, CLEAR);
      t.check(`${label}: Clear selection takes the bar away`, await page.$eval(BAR, (bar) => bar.hidden));
    }

    // Back from an issue's details. The page is shown again with its bar and the title link gets
    // focus back in the same frame, before anything has measured the bar on its return, so the
    // clearance has to be in place already. Found in review: with a title opened from where the bar
    // is drawn, focus came back to it under the bar at 1280x900, 1280x800 and 390x844.
    for (const [viewport, label] of [[{ width: 1280, height: 900 }, '1280x900'], [{ width: 390, height: 844 }, '390x844']]) {
      await search(page, viewport, 'dark');
      await click(page, '#creator-results input[data-comic-id="978001"]');
      await frames(page);
      await page.evaluate((barSelector) => {
        const link = document.querySelector('#creator-results a[data-issue-id="978006"]');
        const bar = document.querySelector(barSelector).getBoundingClientRect();
        const r = link.getBoundingClientRect();
        window.scrollBy(0, r.top + r.height / 2 - (bar.top + bar.height / 2));
      }, BAR);
      await frames(page);
      await click(page, '#creator-results a[data-issue-id="978006"]');
      await page.waitForSelector('#view-issue:not([hidden])');
      await page.goBack();
      await page.waitForFunction(() => document.activeElement?.dataset.issueId === '978006');
      await frames(page);
      const back = await focused(page);
      t.check(`${label}: Back from an issue's details returns focus to its title, clear of the bar`,
        back.visible && back.reached && !back.underBar && !back.navCovers
          && await page.$eval(BAR, (bar) => !bar.hidden), JSON.stringify(back));
      await click(page, CLEAR);
    }

    // Saving from the middle of the list, then Clear from the bottom of it.
    await search(page, { width: 1280, height: 900 }, 'light');
    await click(page, '#creator-results input[data-comic-id="978030"]');
    await page.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2));
    await frames(page);
    await click(page, TOGGLE);
    await page.$eval('#creator-list-name', (input) => {
      input.value = 'Bar fixture';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(page, `${BAR} button[type="submit"]`);
    await page.waitForFunction(() => document.querySelector('#creator-selection-report').textContent.includes('Created'));
    await frames(page);
    const saved = await page.evaluate((bar) => {
      const report = document.querySelector('#creator-selection-report');
      const r = report.getBoundingClientRect();
      return {
        focus: document.activeElement === report,
        inView: r.top >= 0 && r.bottom <= innerHeight,
        inBar: document.querySelector(bar).contains(report),
        count: document.querySelector(`${bar} .comic-selection-count`).textContent,
        link: report.querySelector('a')?.textContent,
      };
    }, BAR);
    t.check('a save from mid-list reports, and focuses its result, in view inside the bar',
      saved.focus && saved.inView && saved.inBar && saved.count === '0 comics selected' && saved.link === 'View Reading List',
      JSON.stringify(saved));
    await shot(page, '1280x900-light-saved');
    await click(page, '#creator-results input[data-comic-id="978031"]');
    t.check('ticking another comic retires that result and keeps the bar',
      await page.$eval('#creator-selection-report', (report) => report.textContent === '')
        && await page.$eval(BAR, (bar) => !bar.hidden));
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await frames(page);
    await click(page, CLEAR);
    await frames(page);
    const cleared = await page.evaluate((bar) => {
      const r = document.querySelector('#creator-q').getBoundingClientRect();
      return {
        focus: document.activeElement?.id,
        inView: r.top >= 0 && r.bottom <= innerHeight,
        hidden: document.querySelector(bar).hidden,
      };
    }, BAR);
    t.check('Clear from the bottom of the list returns to a search field that is in view',
      cleared.focus === 'creator-q' && cleared.inView && cleared.hidden, JSON.stringify(cleared));

    // Forced colors: the bar keeps an edge, and the open state keeps its non-color cue.
    await media([{ name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    await click(page, '#creator-results input[data-comic-id="978030"]');
    const marker = () => page.evaluate((bar, toggle) => {
      const edge = getComputedStyle(document.querySelector(bar));
      const chevron = getComputedStyle(document.querySelector(toggle), '::after');
      return {
        active: matchMedia('(forced-colors: active)').matches,
        edge: edge.borderTopStyle !== 'none' && parseFloat(edge.borderTopWidth) >= 1
          && edge.borderTopColor !== edge.backgroundColor,
        chevron: parseFloat(chevron.borderRightWidth) >= 1 && chevron.borderRightColor !== 'rgba(0, 0, 0, 0)',
        turned: chevron.transform,
      };
    }, BAR, TOGGLE);
    const closed = await marker();
    await click(page, TOGGLE);
    const open = await marker();
    t.check('forced colors keep the bar edge and a marker that turns when the form opens',
      closed.active && closed.edge && closed.chevron && open.chevron && open.turned !== closed.turned,
      JSON.stringify({ closed, open }));
    await shot(page, '1280x900-forced-colors-form-open');
    await click(page, CLEAR);
    await media([]);

    // With motion allowed the bar follows the bottom bar rather than jumping past it.
    await search(page, { width: 390, height: 844 }, 'dark');
    await click(page, '#creator-results input[data-comic-id="978010"]');
    await page.evaluate(() => window.scrollTo(0, 1200));
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    const settled = await geometry(page);
    t.check('with motion allowed the bar settles at the bottom while the bottom bar is away',
      settled.nav.hidden && !settled.nav.onScreen && settled.height - settled.bar.bottom <= 16 && settled.toggle.reached,
      JSON.stringify({ bar: settled.bar, nav: settled.nav, height: settled.height }));
    await shot(page, '390x844-dark-bottom-bar-away');
    t.check('the selection bar raised no page errors', errors.length === 0, errors.join('; '));
  },
};

// Each one removes the mechanism behind one claim above and nothing else.
export const selectionBarMutations = [
  {
    id: 'comic-selection-bar-static',
    breaks: 'comic-selection-bar',
    why: 'the bar stays where it is placed in the page instead of holding to the bottom of the window',
    script: () => {
      addEventListener('load', () => {
        const sheet = [...document.styleSheets].find((candidate) => candidate.href?.endsWith('styles.css'));
        sheet.insertRule('.comic-builder { position: static !important; }', sheet.cssRules.length);
      });
    },
  },
  {
    id: 'comic-selection-bar-uncleared',
    breaks: 'comic-selection-bar',
    why: 'the bar height is never published, so a control that takes focus can scroll in under the bar',
    rewriteAdd: (source) => source.replace(
      "root.style.setProperty('--comic-selection-height', `${current.builder.host.getBoundingClientRect().height}px`);",
      'void 0;',
    ),
  },
];
