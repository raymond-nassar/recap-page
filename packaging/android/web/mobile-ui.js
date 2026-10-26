export function wireMobileUi() {
  const root = document.documentElement;
  const narrow = window.matchMedia('(max-width: 880px)');
  document.addEventListener('pointerdown', () => root.classList.remove('android-keyboard'), true);
  document.addEventListener('keydown', (event) => {
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) root.classList.add('android-keyboard');
  }, true);
  document.addEventListener('focusin', (event) => {
    if (narrow.matches && event.target.matches('.filters .fp input')) {
      event.target.closest('.fp').scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });

  const tools = document.querySelector('.list-tools');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = 'android-list-options';
  trigger.className = 'btn btn-g';
  trigger.textContent = 'List options';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'android-list-sheet');
  trigger.setAttribute('aria-expanded', 'false');
  tools.before(trigger);

  const sheet = document.createElement('dialog');
  sheet.id = 'android-list-sheet';
  sheet.setAttribute('aria-labelledby', 'android-list-sheet-title');
  const header = document.createElement('div');
  header.className = 'android-sheet-header';
  const title = document.createElement('h2');
  title.id = 'android-list-sheet-title';
  title.textContent = 'List options';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-g';
  close.textContent = 'Close';
  header.append(title, close);
  sheet.append(header);
  document.body.append(sheet);

  function restore() {
    if (tools.parentElement !== sheet) return;
    trigger.after(tools);
    tools.querySelector('#list-export').open = false;
    trigger.setAttribute('aria-expanded', 'false');
    const target = narrow.matches ? trigger : tools.querySelector('button:not([hidden]):not(:disabled)');
    if (target?.getClientRects().length) target.focus({ preventScroll: true });
  }

  function dismiss() {
    if (!sheet.open) return;
    sheet.close();
    restore();
  }

  trigger.addEventListener('click', () => {
    sheet.append(tools);
    sheet.showModal();
    sheet.scrollTop = 0;
    trigger.setAttribute('aria-expanded', 'true');
    close.focus({ preventScroll: true });
  });
  close.addEventListener('click', dismiss);
  sheet.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  sheet.addEventListener('close', () => {
    if (!sheet.open) restore();
  });
  sheet.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const controls = [...sheet.querySelectorAll('button:not(:disabled), summary')]
      .filter((node) => node.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  sheet.addEventListener('click', (event) => {
    if (event.target !== sheet) return;
    const box = sheet.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right
      || event.clientY < box.top || event.clientY > box.bottom) dismiss();
  });
  // Shared dialogs remember the active element. Restore the visible trigger before their handlers run.
  tools.addEventListener('click', (event) => {
    if (event.target.closest('button:not(:disabled)')) dismiss();
  }, true);
  window.addEventListener('hashchange', dismiss, true);
  narrow.addEventListener('change', () => {
    if (!narrow.matches) dismiss();
  });
  const view = document.querySelector('#view-read');
  const body = document.querySelector('#reading-body');
  const observer = new MutationObserver(() => {
    if (view.hidden || body.hidden) dismiss();
  });
  for (const node of [view, body]) observer.observe(node, { attributes: true, attributeFilter: ['hidden'] });
  wireSpotlightUi(narrow);
  root.classList.add('android-mobile-ui');
}

function wireSpotlightUi(narrow) {
  const root = document.documentElement;
  const view = document.querySelector('#view-spotlights');
  const controls = view.querySelector('.spotlight-controls');
  const categories = view.querySelector('#spotlights-filters');
  const results = view.querySelector('#spotlights-results');
  const controlsHome = document.createComment('Spotlight sort and guide kind');
  const categoriesHome = document.createComment('Spotlight categories');
  controls.before(controlsHome);
  categories.before(categoriesHome);

  const trigger = document.createElement('button');
  trigger.id = 'android-spotlight-options';
  trigger.type = 'button';
  trigger.className = 'btn btn-g';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'android-spotlight-sheet');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-labelledby', 'android-spotlight-label');
  trigger.setAttribute('aria-describedby', 'android-spotlight-summary');
  const label = document.createElement('span');
  label.id = 'android-spotlight-label';
  label.textContent = 'Filters and sort';
  const summary = document.createElement('span');
  summary.id = 'android-spotlight-summary';
  trigger.append(label, summary);
  view.querySelector('#form-spotlights-search').after(trigger);

  const sheet = document.createElement('dialog');
  sheet.id = 'android-spotlight-sheet';
  sheet.setAttribute('aria-labelledby', 'android-spotlight-title');
  sheet.setAttribute('aria-describedby', 'android-spotlight-help');
  const header = document.createElement('div');
  header.className = 'android-sheet-header';
  const title = document.createElement('h2');
  title.id = 'android-spotlight-title';
  title.textContent = 'Filters and sort';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-g';
  close.textContent = 'Close';
  const help = document.createElement('p');
  help.id = 'android-spotlight-help';
  help.className = 'rail-hint';
  help.textContent = 'Changes take effect immediately.';
  header.append(title, close);
  sheet.append(header, help);
  document.body.append(sheet);

  function refreshSummary() {
    const sort = controls.querySelector('input[name="spotlights-sort"]:checked');
    const kind = controls.querySelector('input[name="spotlights-kind"]:checked');
    const facet = categories.hidden ? null : categories.querySelector('input:checked');
    const text = (input) => input?.nextElementSibling?.textContent.trim();
    const filters = [];
    if (kind?.value !== 'all') filters.push(text(kind) || 'Guide kind unavailable');
    if (!facet) filters.push('Categories unavailable');
    else if (facet.value !== 'all') filters.push(text(facet));
    summary.textContent = `${text(sort) || 'Sort unavailable'}; ${filters.join('; ') || 'no filters'}`;
  }

  controls.addEventListener('change', refreshSummary);
  categories.addEventListener('change', refreshSummary);
  // Route restoration changes checked properties, not attributes or input events.
  const summaryObserver = new MutationObserver(() => refreshSummary());
  summaryObserver.observe(results, { childList: true });
  summaryObserver.observe(categories, { childList: true, attributes: true, attributeFilter: ['hidden'] });
  refreshSummary();

  function restore() {
    if (controls.parentElement === sheet) controlsHome.after(controls);
    if (categories.parentElement === sheet) categoriesHome.after(categories);
    trigger.setAttribute('aria-expanded', 'false');
  }

  function dismiss({ returnFocus = true } = {}) {
    if (!sheet.open) return;
    sheet.close();
    restore();
    if (returnFocus && narrow.matches && !view.hidden) trigger.focus({ preventScroll: true });
  }

  trigger.addEventListener('click', () => {
    sheet.append(controls, categories);
    sheet.showModal();
    sheet.scrollTop = 0;
    trigger.setAttribute('aria-expanded', 'true');
    close.focus({ preventScroll: true });
  });
  close.addEventListener('click', () => dismiss());
  sheet.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  sheet.addEventListener('close', () => {
    if (!sheet.open) restore();
  });
  sheet.addEventListener('click', (event) => {
    if (event.target !== sheet) return;
    const box = sheet.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right
      || event.clientY < box.top || event.clientY > box.bottom) dismiss();
  });
  window.addEventListener('hashchange', () => dismiss({ returnFocus: false }), true);
  const routeObserver = new MutationObserver(() => {
    if (!view.hidden || !sheet.open) return;
    dismiss({ returnFocus: false });
    const destination = document.querySelector('.view:not([hidden])');
    // showView may have tried to focus the destination while the modal made it inert.
    if (destination && !destination.contains(document.activeElement)) {
      const heading = destination.querySelector('h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  });
  routeObserver.observe(view, { attributes: true, attributeFilter: ['hidden'] });
  narrow.addEventListener('change', () => {
    // Keep the old visibility until focus ownership is captured; CSS hiding can blur to BODY.
    const focused = document.activeElement;
    const rescue = sheet.contains(focused) || focused === trigger
      || controls.contains(focused) || categories.contains(focused);
    if (!narrow.matches) dismiss({ returnFocus: false });
    root.classList.toggle('android-spotlight-compact', narrow.matches);
    if (rescue && !view.hidden) {
      const target = narrow.matches ? trigger : controls.querySelector('input[name="spotlights-sort"]:checked');
      target?.focus({ preventScroll: true });
    }
  });
  root.classList.add('android-spotlight-ui');
  root.classList.toggle('android-spotlight-compact', narrow.matches);
}
