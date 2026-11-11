import {
  catalogGapLabels,
  collectionsLabel,
  depthLabel,
  readingTimeLabel,
} from '../lib/catalog.js';
import { labelledName } from '../lib/accname.js';
import { formatRoute, isPlainNavigation } from '../lib/route.js';
import { isIosApp } from '../lib/platform.js';
import { editionRelations } from '../lib/collectedEditions.js';
import { collectedEditionCredit, collectedEditionLabels } from './shared/collected-editions.js';

const ADD_TEXT = '+ Add to library';
const OPEN_TEXT = 'Open list';

export function createPreviewView({
  isIos = isIosApp(),
  captureFocus,
  el,
  elements,
  getState,
  isInLibrary,
  issueFocusAnchor,
  loadOrder,
  offlineContent,
  onAbandonCopy,
  onAdd,
  onAddCopy,
  onClose,
  onIssueLoadFailure,
  onOpen,
  presentation,
  restoreFocus,
}) {
  const justAdded = new Set();
  let loadToken = null;
  let previewList = null;
  let previewSession = null;
  let offlineState = null;
  let offlineController = null;
  let offlineControls = null;
  let lifecycleToken = {};

  const isCurrent = (session) => session?.token === lifecycleToken;

  function invalidate() {
    if (previewSession) onAbandonCopy?.(previewSession.list);
    offlineController?.abort();
    offlineController = null;
    offlineState = null;
    offlineControls = null;
    lifecycleToken = {};
    loadToken = null;
    previewList = null;
    previewSession = null;
    justAdded.clear();
  }

  async function notifyClose(session) {
    if (!isCurrent(session)) return;
    const { lists, listOrder } = getState();
    const changed = session.lists !== lists || session.listOrder !== listOrder;
    if (session.notified && !changed) return;
    session.lists = lists;
    session.listOrder = listOrder;
    session.notified = true;
    const notificationToken = {};
    session.notificationToken = notificationToken;
    await onClose(session.list, {
      changed,
      isCurrent: () => {
        if (!isCurrent(session) || session.notificationToken !== notificationToken) return false;
        const current = getState();
        return current.lists === lists && current.listOrder === listOrder;
      },
    });
  }

  function addButton(list) {
    const inLibrary = isInLibrary(list.id);
    if (inLibrary) {
      // UX-12 (#830): once the list is saved, opening it is the next step, so it is the one primary
      // action and names where it goes, rather than a secondary "Open" beside the offline action.
      return el('a', {
        href: formatRoute({ view: 'read', listId: inLibrary.id }),
        class: 'btn',
        'aria-label': labelledName(OPEN_TEXT, list.name),
        dataset: { key: list.id, act: 'main' },
        onclick: (event) => {
          if (!isPlainNavigation(event)) return;
          event?.preventDefault();
          if (isCurrent(previewSession)) return onOpen(list, inLibrary);
        },
      }, OPEN_TEXT);
    }
    return el('button', {
      type: 'button',
      class: 'btn',
      'aria-label': labelledName(ADD_TEXT, list.name),
      dataset: { key: list.id, act: 'main' },
      onclick: (event) => add(list, event.currentTarget),
    }, ADD_TEXT);
  }

  function addControls(list) {
    const saved = isInLibrary(list.id);
    if (!saved) return [addButton(list)];
    const session = previewSession;
    const copy = session?.copyId ? getState().lists[session.copyId] : null;
    const copyAction = session?.missing && onAddCopy
      ? copy
        ? el('a', {
          href: formatRoute({ view: 'read', listId: copy.id }),
          class: 'btn btn-g',
          'aria-label': labelledName('Open updated copy', list.name),
          dataset: { key: list.id, act: 'open-copy' },
          onclick: (event) => {
            if (!isPlainNavigation(event)) return;
            event?.preventDefault();
            if (isCurrent(session)) return onOpen(list, copy);
          },
        }, 'Open updated copy')
        : el('button', {
          type: 'button',
          class: 'btn btn-g',
          disabled: Boolean(session.copyPending),
          'aria-label': labelledName('Add updated copy', list.name),
          dataset: { key: list.id, act: 'add-copy' },
          onclick: (event) => addCopy(list, event.currentTarget),
        }, 'Add updated copy')
      : null;
    // UX-12 (#830): a reader who has just added the list sees that it was added, and how many comics it
    // holds, until Preview closes rather than for a second and a half. It is a status inside the dialog
    // because the page's announcer is behind the modal: measured in Edge 156, the announcer is absent
    // from the accessibility tree while Preview is open, so the import's own announcement is not heard.
    const count = saved.itemIds?.length ?? 0;
    const copyCount = copy?.itemIds?.length ?? 0;
    return [addButton(list), copyAction, copy
      ? el('span', { class: 'rail-hint preview-added', role: 'status', text: `Added updated copy: ${copyCount} comic${copyCount === 1 ? '' : 's'}.` })
      : justAdded.has(list.id)
        ? el('span', { class: 'rail-hint preview-added', role: 'status', text: `Added to your Library: ${count} comic${count === 1 ? '' : 's'}.` })
        : el('span', { class: 'rail-hint', role: 'status', text: 'In library' })].filter(Boolean);
  }

  function offlineActionLabel(state) {
    if (state === 'checking') return 'Checking offline availability...';
    if (state === 'preparing') return offlineState?.cancelling ? 'Cancelling...' : 'Preparing offline copy...';
    if (state === 'ready') return 'Refresh offline copy';
    if (state === 'stale') return 'Update offline copy';
    if (state === 'failed' || state === 'cancelled') return 'Try again';
    if (state === 'unsupported') return 'Offline preparation unavailable';
    return 'Make available offline';
  }

  function offlineStatusText() {
    if (!offlineState) return '';
    if (offlineState.state === 'checking') return 'Checking whether this Reading List is ready offline.';
    if (offlineState.state === 'preparing') {
      const progress = offlineState.progress;
      if (offlineState.cancelling) return 'Cancelling offline preparation...';
      if (!progress) return 'Preparing and verifying this Reading List for offline use.';
      const verb = progress.phase === 'write' ? 'Verified' : 'Fetched';
      return `${verb} ${progress.completed} of ${progress.total} offline files.`;
    }
    if (offlineState.state === 'ready') return 'Offline copy verified and ready on this device.';
    if (offlineState.state === 'stale') {
      return offlineState.reason || 'The offline copy needs an update.';
    }
    if (offlineState.state === 'unsupported') {
      if (isIos) return 'Offline preparation is not available in this app.';
      return offlineState.error || `Offline preparation is not supported in ${isIos ? 'this app' : 'this browser'}.`;
    }
    if (offlineState.state === 'cancelled') {
      return 'Preparation cancelled. Any earlier completed offline copy is unchanged.';
    }
    if (offlineState.state === 'failed') {
      return `Offline preparation failed: ${offlineState.error || 'The copy could not be verified.'}`;
    }
    return 'This Reading List is not saved for offline use.';
  }

  function syncOffline() {
    if (!offlineControls) return;
    const { action, cancel, status } = offlineControls;
    const state = offlineState?.state || 'idle';
    const label = offlineActionLabel(state);
    action.textContent = label;
    action.setAttribute('aria-label', labelledName(label, previewList.name));
    action.dataset.state = state;
    action.disabled = state === 'checking' || state === 'preparing' || state === 'unsupported';
    cancel.hidden = state !== 'preparing';
    cancel.disabled = Boolean(offlineState?.cancelling);
    cancel.textContent = offlineState?.cancelling ? 'Cancelling...' : 'Cancel';
    status.textContent = offlineStatusText();
  }

  function createOfflineControls(list) {
    if (!elements().offline) return;
    offlineState = { state: 'checking' };
    const action = el('button', {
      type: 'button',
      class: 'btn btn-g',
      dataset: { act: 'offline' },
      onclick: () => { void prepareOffline(list); },
    });
    const cancel = el('button', {
      type: 'button',
      class: 'btn btn-g',
      hidden: true,
      onclick: cancelOffline,
    }, 'Cancel');
    const status = el('span', {
      class: 'rail-hint',
      role: 'status',
      'aria-live': 'polite',
    });
    offlineControls = { action, cancel, status };
    syncOffline();
    return [action, cancel, status];
  }

  function cancelOffline() {
    if (!offlineController || offlineState?.state !== 'preparing' || offlineState.cancelling) return;
    offlineState = { ...offlineState, cancelling: true };
    offlineController.abort();
    syncOffline();
  }

  async function checkOffline(list, session) {
    if (!offlineContent?.readiness || !offlineControls) {
      offlineState = {
        state: 'unsupported',
        error: `Offline preparation is not available in ${isIos ? 'this app' : 'this browser'}.`,
      };
      syncOffline();
      return;
    }
    const controller = new AbortController();
    offlineController = controller;
    let result;
    try {
      result = await offlineContent.readiness(list.id, { signal: controller.signal });
    } catch (error) {
      result = { ok: false, state: 'failed', error: error.message };
    }
    if (!isCurrent(session) || session.closed || offlineController !== controller) return;
    offlineController = null;
    offlineState = result;
    syncOffline();
  }

  async function prepareOffline(list) {
    const session = previewSession;
    if (!offlineContent?.prepare || !isCurrent(session) || session.closed
      || offlineController || offlineState?.state === 'preparing'
      || offlineState?.state === 'checking' || offlineState?.state === 'unsupported') return;
    const controller = new AbortController();
    offlineController = controller;
    offlineState = { state: 'preparing', progress: null };
    syncOffline();
    let result;
    try {
      result = await offlineContent.prepare(list.id, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!isCurrent(session) || session.closed || offlineController !== controller) return;
          offlineState = { state: 'preparing', progress };
          syncOffline();
        },
      });
    } catch (error) {
      result = { ok: false, state: 'failed', error: error.message };
    }
    if (!isCurrent(session) || session.closed || offlineController !== controller) return;
    offlineController = null;
    offlineState = result;
    syncOffline();
  }

  function syncAdd() {
    const nodes = elements();
    if (!previewList || !nodes.dialog.open) return;
    paintAdd(previewList);
  }

  function paintAdd(list) {
    const nodes = elements();
    const [primary, ...secondary] = addControls(list);
    const secondaryIsHeld = nodes.secondary.parentElement === nodes.add;
    nodes.add.replaceChildren(primary, ...(secondaryIsHeld ? [nodes.secondary] : []));
    nodes.secondary.replaceChildren(...secondary);
  }

  function returnFocus(held, fallback) {
    if (document.activeElement !== document.body) return;
    restoreFocus(held, { primary: 'main', fallback });
  }

  async function add(list, button) {
    const session = previewSession;
    if (!isCurrent(session) || session.closed) return;
    const nodes = elements();
    const held = captureFocus(nodes.dialog);
    justAdded.add(list.id);
    const listId = await onAdd(list, button);
    if (!isCurrent(session)) return;
    if (!listId) {
      justAdded.delete(list.id);
      if (!session.closed) {
        syncAdd();
        returnFocus(held);
      }
      return;
    }
    if (session.closed) {
      justAdded.delete(list.id);
      await notifyClose(session);
      return;
    }
    syncAdd();
    returnFocus(held);
  }

  async function addCopy(list, button) {
    const session = previewSession;
    if (!isCurrent(session) || session.closed || session.copyPending || !session.missing
      || !isInLibrary(list.id)) return;
    const held = captureFocus(elements().secondary);
    session.copyPending = true;
    button.disabled = true;
    const listId = await onAddCopy(list, button, { isCurrent: () => isCurrent(session) && !session.closed });
    session.copyPending = false;
    if (!isCurrent(session)) return;
    if (session.closed) {
      if (listId) await notifyClose(session);
      return;
    }
    if (listId) session.copyId = listId;
    syncAdd();
    returnFocus(held, () => elements().secondary.querySelector(`[data-act="${listId ? 'open-copy' : 'add-copy'}"]`));
  }

  function paint(list) {
    const nodes = elements();
    previewList = list;
    nodes.heading.textContent = list.name;
    nodes.meta.textContent = [
      `${list.count} comic${list.count === 1 ? '' : 's'}`,
      ...catalogGapLabels(list),
      collectionsLabel(list),
      readingTimeLabel(list.count),
      depthLabel(list.depth),
    ].filter(Boolean).join(' · ');
    nodes.description.textContent = list.description || '';
    nodes.source.replaceChildren(...[presentation.attributionLine(list)].filter(Boolean));
    paintAdd(list);
    const offline = elements().offline;
    if (offline) {
      const [action, cancel, status] = createOfflineControls(list);
      offline.replaceChildren(action, cancel);
      // #830: the status reads just above the held actions, so it scrolls with the list.
      elements().offlineStatus?.replaceChildren(status);
    }
  }

  async function loadIssues(list) {
    const nodes = elements();
    nodes.body.replaceChildren(el('p', { class: 'rail-hint', text: 'Loading the comic list…' }));
    const token = {};
    loadToken = token;
    try {
      const order = await loadOrder(list.file);
      if (loadToken !== token) return;
      const saved = isInLibrary(list.id);
      const savedIds = Array.isArray(saved?.itemIds) ? new Set(saved.itemIds.map(String)) : null;
      const missing = savedIds ? order.items.filter((item) => !savedIds.has(String(item.issueId))).length : 0;
      previewSession.missing = missing;
      const held = captureFocus(nodes.dialog);
      syncAdd();
      returnFocus(held);
      const notice = missing ? [el('p', {
        class: 'rail-hint preview-saved-difference',
        role: 'status',
        text: `Your saved list is missing ${missing} comic${missing === 1 ? '' : 's'} shown here. `
          + 'Add an updated copy to keep both lists. The copy shares saved comic details, read progress, comic notes, '
          + 'ratings and availability choices, '
          + "but not the saved list's order, list note, deferred comics, customized editions, completion date or enjoyment choice.",
      })] : [];
      let shown = null;
      const rows = [];
      order.items.forEach((item, index) => {
        const edition = typeof item.collectedIn === 'string' ? item.collectedIn || null : null;
        if (edition !== shown) {
          shown = edition;
          rows.push(el('li', { class: 'preview-group' }, [el('h4', { text: edition || 'Individual comics' })]));
        }
        rows.push(el('li', {}, [
          el('span', { class: 'pn', text: String(index + 1) }),
          el('div', { class: 'preview-issue-info' }, [issueFocusAnchor(item, {
            context: { kind: 'order', id: list.id },
            surface: 'preview',
            className: 'preview-issue-link',
            children: item.title || 'Untitled comic',
          }), collectedEditionLabels(el, list.id, item)]),
        ]));
      });
      const credit = order.items.some((item) => editionRelations(list.id, item).length)
        ? [collectedEditionCredit(el)] : [];
      nodes.body.replaceChildren(...notice, ...credit, el('ol', { class: 'preview-list' }, rows));
    } catch (error) {
      if (loadToken !== token) return;
      await onIssueLoadFailure({
        error,
        list,
        isCurrent: () => loadToken === token,
        retry: () => {
          if (loadToken === token) return loadIssues(list);
        },
      });
    }
  }

  async function open(list) {
    invalidate();
    const state = getState();
    previewSession = {
      token: lifecycleToken,
      list,
      lists: state.lists,
      listOrder: state.listOrder,
      closed: false,
      notified: false,
      notificationToken: null,
    };
    const nodes = elements();
    nodes.paths.replaceChildren();
    nodes.paths.hidden = true;
    paint(list);
    nodes.dialog.showModal();
    void checkOffline(list, previewSession);
    await loadIssues(list);
  }

  function wire() {
    const nodes = elements();
    nodes.close.addEventListener('click', () => nodes.dialog.close());
    nodes.dialog.addEventListener('click', (event) => {
      if (event.target !== nodes.dialog) return;
      const bounds = nodes.dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) nodes.dialog.close();
    });
    nodes.dialog.addEventListener('close', async () => {
      if (nodes.dialog.open) return;
      const session = previewSession;
      previewSession = null;
      previewList = null;
      loadToken = null;
      offlineController?.abort();
      offlineController = null;
      offlineState = null;
      offlineControls = null;
      justAdded.clear();
      if (session) {
        session.closed = true;
        onAbandonCopy?.(session.list);
      }
      await notifyClose(session);
    });
  }

  return {
    invalidate,
    open,
    syncAdd,
    wire,
  };
}
