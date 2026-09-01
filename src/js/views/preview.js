import {
  catalogGapLabels,
  collectionsLabel,
  depthLabel,
  readingTimeLabel,
  variantLabel,
} from '../lib/catalog.js';
import { labelledName } from '../lib/accname.js';

const ADD_TEXT = '+ Add to library';

export function createPreviewView({
  captureFocus,
  el,
  elements,
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
  let previewStory = null;

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
        onclick: () => onOpen(list, inLibrary),
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
    presentation.markOwnedPaths(nodes.paths, previewStory);
  }

  function returnFocus(held) {
    if (document.activeElement !== document.body) return;
    restoreFocus(held, { primary: 'main' });
  }

  async function add(list, button) {
    const nodes = elements();
    const held = captureFocus(nodes.add);
    justAdded.add(list.id);
    const listId = await onAdd(list, button);
    if (!listId) {
      justAdded.delete(list.id);
      syncAdd();
      returnFocus(held);
      return;
    }
    syncAdd();
    returnFocus(held);
    setTimeout(() => {
      const settleFocus = captureFocus(elements().add);
      justAdded.delete(list.id);
      syncAdd();
      returnFocus(settleFocus);
    }, 1500);
  }

  function paint(list) {
    const nodes = elements();
    previewList = list;
    nodes.heading.textContent = previewStory ? previewStory.name : list.name;
    nodes.meta.textContent = [
      previewStory ? variantLabel(list) : null,
      `${list.count} issue${list.count === 1 ? '' : 's'}`,
      ...catalogGapLabels(list),
      collectionsLabel(list),
      readingTimeLabel(list.count),
      depthLabel(list.depth),
    ].filter(Boolean).join(' · ');
    nodes.description.textContent = list.description || '';
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
        const edition = typeof item.collectedIn === 'string' ? item.collectedIn : null;
        if (edition && edition !== shown) {
          shown = edition;
          rows.push(el('li', { class: 'preview-group' }, [el('h4', { text: edition })]));
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
        retry: () => loadIssues(list),
      });
    }
  }

  async function open(list, story = null) {
    const nodes = elements();
    previewStory = story && story.lists.length > 1 ? story : null;
    nodes.paths.replaceChildren(...(previewStory
      ? [presentation.pathChooser(previewStory, 'preview', (next) => {
        paint(next);
        void loadIssues(next);
      })]
      : []));
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
      const chose = previewStory;
      previewList = null;
      previewStory = null;
      await onClose(chose);
    });
  }

  return {
    open,
    syncAdd,
    wire,
  };
}
