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
  root.classList.add('android-mobile-ui');
}
