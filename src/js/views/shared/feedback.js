// Messages raised during one action are joined before the delayed DOM write, so a later status
// cannot erase the confirmation that made the action visible.
export function announceChannel(open, schedule) {
  let pending = null;
  return (msg) => {
    if (pending) {
      pending.msg += ` ${msg}`;
      return;
    }
    const write = open();
    const slot = { msg };
    pending = slot;
    schedule(() => {
      pending = null;
      write(slot.msg);
    });
  };
}

// State keys describe the condition, not rendered text, so repeated checks stay silent until a
// condition genuinely changes.
export function stateAnnouncer(speak, seed = []) {
  const seen = new Map(seed);
  return (key, state, msg) => {
    if (seen.get(key) === state) return false;
    seen.set(key, state);
    if (msg) speak(msg);
    return true;
  };
}

// A healthy service is the assumed starting point; only a failure or recovery is news.
export function passiveAnnouncer(speak) {
  return stateAnnouncer(speak, [['api', 'ok']]);
}

export function retireRoutineNotices(notes) {
  for (const [key, note] of notes) {
    if (note.kind === 'ok' && !note.action && !note.dismiss) notes.delete(key);
  }
}

export function spoken(msg, action, dismiss) {
  const labels = [action, dismiss].filter(Boolean).map((control) => control.label);
  if (!labels.length) return msg;
  return `${msg} ${labels.join(' and ')} ${labels.length > 1 ? 'are' : 'is'} available.`;
}

export function createFeedback({
  query,
  getDocument,
  el,
  schedule,
  focusViewHeading,
  getCurrentView,
}) {
  const announce = announceChannel(
    () => {
      const node = query('#announcer');
      node.textContent = '';
      return (msg) => { node.textContent = msg; };
    },
    schedule,
  );
  const announceState = passiveAnnouncer(announce);
  const notices = new Map();
  const fixedNotices = new Map();

  function placeFixedNotice(sel) {
    const note = [...fixedNotices.values()].filter((entry) => entry.sel === sel).at(-1);
    query(sel)?.replaceChildren(...(note ? [noticeEl(note)] : []));
  }

  function overflowPane() {
    const box = query('#app-report');
    return box?.offsetParent ? box : null;
  }

  function noticeControlEl(control, dismiss) {
    const closing = control === dismiss;
    return el('button', {
      class: closing ? 'quiet notice-dismiss' : 'quiet',
      type: 'button',
      onclick: (event) => {
        const inDialog = closing && event.currentTarget.closest('dialog[open]') !== null;
        control.onClick();
        if (closing) focusAfterDismiss(inDialog);
      },
    }, control.label);
  }

  function noticeEl({ msg, kind, action, dismiss }) {
    const controls = [action, dismiss].filter(Boolean);
    return el('p', { class: `notice notice-${kind}${controls.length ? ' notice-act' : ''}` }, [
      el('span', { class: 'grow', text: msg }),
      ...controls.map((control) => noticeControlEl(control, dismiss)),
    ]);
  }

  function focusAfterDismiss(inDialog) {
    if (inDialog) return;
    focusViewHeading(getCurrentView());
  }

  function placeNotices() {
    const document = getDocument();
    const overflow = overflowPane();
    const modalPane = query('dialog[open]')?.querySelector('.report') ?? null;
    const placed = new Map();
    const claims = new Map();

    for (const [, note] of notices) {
      const own = query(note.sel);
      if (!own) continue;
      let box = own;
      // A message may follow the reader into a dialog, but an action must stay in its original pane.
      if (modalPane && !note.action) box = modalPane;
      else if (!own.offsetParent) box = overflow ?? own;
      placed.set(note.sel, box);
      claims.set(box, note);
    }

    if (overflow && claims.has(overflow)) {
      const duplicate = [...claims].some(([box, note]) => (
        box !== overflow && note.msg === claims.get(overflow).msg
      ));
      if (duplicate) claims.delete(overflow);
    }

    for (const pane of document.querySelectorAll('.report')) {
      const note = claims.get(pane);
      pane.replaceChildren(...(note ? [noticeEl(note)] : []));
    }
    return placed;
  }

  function isLive(node) {
    for (let current = node; current && current.getAttribute; current = current.parentElement) {
      const live = current.getAttribute('aria-live');
      if (live && live !== 'off') return true;
      if (['alert', 'status', 'log'].includes(current.getAttribute('role'))) return true;
    }
    return false;
  }

  function notify(sel, msg, kind = 'ok', key = sel, action = null, dismiss = null) {
    const own = query(sel);
    if (!own) return;
    // Fixed result panes keep their context; shared report panes can move with navigation.
    if (!own.classList.contains('report')) {
      if (sel === '#save-report') fixedNotices.delete(key);
      if (sel === '#save-report') fixedNotices.set(key, { sel, msg, kind, action, dismiss });
      own.replaceChildren(noticeEl({ msg, kind, action, dismiss }));
      if (!isLive(own)) announce(spoken(msg, action, dismiss));
      return;
    }
    notices.delete(key);
    notices.set(key, { sel, msg, kind, action, dismiss });
    const box = placeNotices().get(sel) ?? own;
    box.scrollIntoView?.({ block: 'nearest' });
    if (!isLive(box)) announce(spoken(msg, action, dismiss));
  }

  function clearNotice(key) {
    notices.delete(key);
    const fixed = fixedNotices.get(key);
    fixedNotices.delete(key);
    if (fixed) placeFixedNotice(fixed.sel);
    placeNotices();
  }

  return {
    announce,
    announceState,
    clearNotice,
    fixedNotices,
    notices,
    notify,
    placeFixedNotice,
    placeNotices,
    retireRoutineNotices,
    spoken,
    noticeEl,
  };
}
