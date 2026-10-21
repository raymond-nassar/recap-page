// Two announcements produced by one action used to leave only the second. Both writes are
// scheduled at the same delay, so they land back to back in one timer phase with no rendering
// opportunity between them, and the accessibility tree observes only the last value written.
// Giving hydration a start announcement made that reachable on every add and every import,
// where it destroyed the confirmation that the issues had been added at all, and that message
// has no visible live surface to fall back on. They are joined instead of replaced, because two
// messages raised by a single action are one thing to say, and saying only the later half of it
// is the failure this channel exists to prevent.
//
// Split from the element it writes to so a whole tick can be replayed against it in a test. The
// node is resolved by open() once per utterance rather than per message, which is what keeps
// both halves of a joined message on the same element.
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

// A passive surface changes without moving focus, so nothing tells a screen reader it changed at
// all. Sending those changes to the announcer needs a guard, because every write that produces one
// repeats: checkHealth runs at boot and again on every API URL save, and renderHydration is called
// once per issue fetched, so a 20-issue run calls it 22 times.
//
// The guard is keyed on the state that matters rather than on the rendered text, so a repeated
// verdict is silent and only a genuine change speaks. Returning whether it spoke is what lets a
// test count what a reader hears across a whole run rather than only observing the first call.
export function stateAnnouncer(speak, seed = []) {
  const seen = new Map(seed);
  return (key, state, msg) => {
    if (seen.get(key) === state) return false;
    seen.set(key, state);
    if (msg) speak(msg);
    return true;
  };
}

// Seeding a key declares the condition assumed to hold already. The metadata service being
// reachable is the ordinary case, so a healthy boot says nothing and only a boot that cannot reach
// it speaks, which also makes "reachable again" the only way the healthy message can be heard.
export function passiveAnnouncer(speak) {
  return stateAnnouncer(speak, [['api', 'ok']]);
}

export function retireRoutineNotices(notes) {
  for (const [key, note] of notes) {
    if (note.kind === 'ok' && !note.action && !note.dismiss) notes.delete(key);
  }
}

// A button that is never spoken is a button a screen reader user cannot know to look for, and the
// undo is the whole point of the message it sits in. The same argument reaches the dismiss, for the
// opposite reason: a message that stays until it is closed is one a reader has to be told they can
// close, and a notice held for a whole session is exactly the one where not knowing costs the most.
export function spoken(msg, action, dismiss) {
  const labels = [action, dismiss].filter(Boolean).map((control) => control.label);
  if (!labels.length) return msg;
  return `${msg} ${labels.join(' and ')} ${labels.length > 1 ? 'are' : 'is'} available.`;
}

// One instance owns the notice record and the announcer for one document. Everything it needs from
// outside is passed in, so a test can build one against a stub document, and nothing here reaches
// back into the module that wires it.
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
      // Resolved once and reused, so both writes land on the same element even if the document
      // changes under us between them.
      const node = query('#announcer');
      node.textContent = '';
      return (msg) => { node.textContent = msg; };
    },
    schedule,
  );
  const announceState = passiveAnnouncer(announce);

  // alert() reached the reader wherever they were; a pane fixed in one view does not. With
  // a curated import in flight, three ways the named pane went unseen were measured: the
  // reader switched view, so the pane was inside a hidden one and nothing appeared at all;
  // the preview dialog was still open, so the pane sat behind its backdrop and outside the
  // top layer; and the grid was scrolled, so the pane was 87px above the viewport.
  //
  // Each notice is remembered rather than only written into the page, because where it belongs can
  // change after it is written. The reader can leave the view while a curated import is still in
  // flight, and 219-issue orders make that window real, or a dialog can open over the pane. Placing
  // every outstanding notice from this record is what keeps one message in exactly one place;
  // moving the nodes about instead left a copy behind in the pane the message started in, and with
  // two outstanding it kept whichever came first in the markup rather than the newer one.
  const notices = new Map();
  const fixedNotices = new Map();

  function placeFixedNotice(sel) {
    const note = [...fixedNotices.values()].filter((entry) => entry.sel === sel).at(-1);
    query(sel)?.replaceChildren(...(note ? [noticeEl(note)] : []));
  }

  // #app-report is above every view, so it is the only pane always available to a message whose own
  // pane the reader cannot see. Seven of the nine views carry no pane of their own.
  function overflowPane() {
    const box = query('#app-report');
    return box?.offsetParent ? box : null;
  }

  // A notice with an action is a paragraph with a button in it rather than a message and a separate
  // control, so that the offer is announced with the words that explain it and so that re-rendering
  // the notice cannot leave the button behind in a pane the message has left.
  //
  // `dismiss` is a second control and not a variant of the first. An action is what the message
  // offers; dismissing is the reader saying they are finished with the message, which is a different
  // sentence and has to be a different button. It carries visible text rather than a bare glyph
  // because the notice already holds a text button, and a word beside a word reads as a choice
  // between two things where a symbol beside a word reads as decoration.
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

  // Dismissing removes the button that was pressed, and the browser drops focus to <body> when a
  // focused node leaves the document. That is the same silent landing at the top of the page BL-054
  // was filed for, so the reader is put where showView puts them: on the heading of the view they are
  // looking at. Inside an open dialog the page behind is inert, focus() on it does nothing, and the
  // dialog keeps focus itself, so that case is left alone rather than aimed somewhere it cannot go.
  function focusAfterDismiss(inDialog) {
    if (inDialog) return;
    focusViewHeading(getCurrentView());
  }

  function placeNotices() {
    const document = getDocument();
    const overflow = overflowPane();
    // Every dialog here is opened with showModal(), so an open one is the top layer and anything
    // behind it is inert and dimmed regardless of where it sits on the page.
    const modalPane = query('dialog[open]')?.querySelector('.report') ?? null;
    const placed = new Map();
    const claims = new Map();

    for (const [, note] of notices) {
      const own = query(note.sel);
      if (!own) continue;
      let box = own;
      // A notice carrying a control stays in its own pane. Moving a message into the modal makes it
      // readable where the reader is looking; moving a button there makes it pressable in a context
      // that has nothing to do with it, and acting on it can navigate the inert page behind the
      // dialog to a view the reader never asked for. A dismiss button is not that kind of control:
      // it closes the message it sits in and touches nothing else, so a notice whose only control is
      // a dismiss still travels, and the reader can be rid of it from wherever they read it.
      if (modalPane && !note.action) box = modalPane;
      // offsetParent is null only under a display:none ancestor, which is how a view that is not
      // the current one is hidden.
      else if (!own.offsetParent) box = overflow ?? own;
      placed.set(note.sel, box);
      // Later wins a shared pane, and notices is kept in order of arrival, so what the reader sees
      // is the newest of two outstanding messages rather than whichever pane comes first.
      claims.set(box, note);
    }

    // A message already readable in a view's own pane must not be repeated in the shared one. The
    // same sentence twice on one screen is the visual form of the double-speak BL-027 removed.
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

  // A message goes down exactly one channel. Writing into a container that is itself a live
  // region and also copying the text into the announcer made a screen reader say everything
  // twice, so the announcer is used only where the message has no live surface of its own.
  //
  // This is decided by reading the container rather than from a list of ids kept here, so
  // marking a container as a live region later cannot quietly reintroduce the double-speak.
  function isLive(node) {
    for (let current = node; current && current.getAttribute; current = current.parentElement) {
      const live = current.getAttribute('aria-live');
      if (live && live !== 'off') return true;
      if (['alert', 'status', 'log'].includes(current.getAttribute('role'))) return true;
    }
    return false;
  }

  // The key is what a notice is cleared by, and it defaults to the pane so that most callers need
  // not think about it. It is separate so that a condition reported into more than one pane, such as
  // a catalog load, can be cleared wherever it ended up.
  //
  // `action` puts a button in the notice, for a message that offers a way back such as the undo
  // after a delete. `dismiss` puts a second one there for a message the reader can be finished with
  // before anything replaces it, which is the only way a notice under a long-lived key ever leaves
  // the screen: these panes hold what they are given until something clears them.
  function notify(sel, msg, kind = 'ok', key = sel, action = null, dismiss = null) {
    const own = query(sel);
    if (!own) return;
    // Only the general notice panes move. #save-report sits above every view and is assertive
    // because a persistence failure must not be missed, and the result panes are read alongside the
    // form that filled them, so relocating either would lose the context that makes it actionable
    // and would quietly change which channel it goes out on.
    if (!own.classList.contains('report')) {
      if (sel === '#save-report') fixedNotices.delete(key);
      if (sel === '#save-report') fixedNotices.set(key, { sel, msg, kind, action, dismiss });
      own.replaceChildren(noticeEl({ msg, kind, action, dismiss }));
      if (!isLive(own)) announce(spoken(msg, action, dismiss));
      return;
    }
    // Re-inserted rather than overwritten in place, because a Map keeps a key at its original
    // position and arrival order is what decides the newest message.
    notices.delete(key);
    notices.set(key, { sel, msg, kind, action, dismiss });
    const box = placeNotices().get(sel) ?? own;
    // Nothing else scrolls a pane into view, and "nearest" is a no-op once it is fully visible, so
    // this moves the page only when the message would otherwise be missed.
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
