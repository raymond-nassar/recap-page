import {
  catalogGapLabels,
  collectionsLabel,
  depthLabel,
  readingTimeLabel,
} from '../lib/catalog.js';
import { labelledName } from '../lib/accname.js';

const ADD_TEXT = '+ Add to library';

export function createPreviewView({
  captureFocus,
  el,
  elements,
  getState,
  isInLibrary,
  issueFocusAnchor,
  loadOrder,
  onAdd,
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
  let lifecycleToken = {};

  const isCurrent = (session) => session?.token === lifecycleToken;

  function invalidate() {
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
      const settled = !justAdded.has(list.id);
      const text = settled ? 'Open →' : '✓ In library';
      return el('button', {
        type: 'button',
        class: settled ? 'btn btn-g' : 'btn btn-added',
        'aria-label': labelledName(text, list.name),
        dataset: { key: list.id, act: 'main' },
        onclick: () => {
          if (isCurrent(previewSession)) return onOpen(list, inLibrary);
        },
      }, text);
    }
    return el('button', {
      type: 'button',
      class: 'btn',
      'aria-label': labelledName(ADD_TEXT, list.name),
      dataset: { key: list.id, act: 'main' },
      onclick: (event) => add(list, event.currentTarget),
    }, ADD_TEXT);
  }

  function syncAdd() {
    const nodes = elements();
    if (!previewList || !nodes.dialog.open) return;
    nodes.add.replaceChildren(addButton(previewList));
  }

  function returnFocus(held) {
    if (document.activeElement !== document.body) return;
    restoreFocus(held, { primary: 'main' });
  }

  async function add(list, button) {
    const session = previewSession;
    if (!isCurrent(session) || session.closed) return;
    const nodes = elements();
    const held = captureFocus(nodes.add);
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
    setTimeout(() => {
      if (!isCurrent(session) || session.closed) return;
      const settleFocus = captureFocus(elements().add);
      justAdded.delete(list.id);
      syncAdd();
      returnFocus(settleFocus);
    }, 1500);
  }

  function paint(list) {
    const nodes = elements();
    previewList = list;
    nodes.heading.textContent = list.name;
    nodes.meta.textContent = [
      `${list.count} issue${list.count === 1 ? '' : 's'}`,
      ...catalogGapLabels(list),
      collectionsLabel(list),
      readingTimeLabel(list.count),
      depthLabel(list.depth),
    ].filter(Boolean).join(' · ');
    nodes.description.textContent = list.description || '';
    nodes.source.replaceChildren(...[presentation.attributionLine(list)].filter(Boolean));
    nodes.add.replaceChildren(addButton(list));
  }

  async function loadIssues(list) {
    const nodes = elements();
    nodes.body.replaceChildren(el('p', { class: 'rail-hint', text: 'Loading the issue list…' }));
    const token = {};
    loadToken = token;
    try {
      const order = await loadOrder(list.file);
      if (loadToken !== token) return;
      let shown = null;
      const rows = [];
      order.items.forEach((item, index) => {
        const edition = typeof item.collectedIn === 'string' ? item.collectedIn || null : null;
        if (edition !== shown) {
          shown = edition;
          rows.push(el('li', { class: 'preview-group' }, [el('h4', { text: edition || 'Individual issues' })]));
        }
        rows.push(el('li', {}, [
          el('span', { class: 'pn', text: String(index + 1) }),
          issueFocusAnchor(item, {
            context: { kind: 'order', id: list.id },
            surface: 'preview',
            className: 'preview-issue-link',
            children: item.title || 'Untitled issue',
          }),
        ]));
      });
      nodes.body.replaceChildren(el('ol', { class: 'preview-list' }, rows));
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
    await loadIssues(list);
  }

  function wire() {
    const nodes = elements();
    nodes.close.addEventListener('click', () => nodes.dialog.close());
    nodes.dialog.addEventListener('click', (event) => {
      if (event.target === nodes.dialog) nodes.dialog.close();
    });
    nodes.dialog.addEventListener('close', async () => {
      if (nodes.dialog.open) return;
      const session = previewSession;
      previewSession = null;
      previewList = null;
      loadToken = null;
      justAdded.clear();
      if (session) session.closed = true;
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
