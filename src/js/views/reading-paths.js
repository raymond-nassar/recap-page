import { resolveReadingPaths } from '../lib/catalog.js';
import {
  completionState,
  listForCatalogId,
  listProgress,
  orderWord,
} from '../lib/model.js';

export function readingPathProgress(state, stop) {
  const exact = listForCatalogId(state, stop?.stepId);
  const imported = exact ?? (stop?.lists ?? [])
    .map((list) => listForCatalogId(state, list.id))
    .find(Boolean);
  if (!imported) return null;
  const { read, total } = listProgress(state, imported.id);
  return {
    listId: imported.id,
    catalogId: imported.catalogId,
    name: imported.name,
    read,
    total,
    state: completionState(read, total),
    match: exact ? 'exact' : 'sibling',
  };
}

function progressText(progress) {
  if (!progress) return 'Not added';
  return `${progress.read} of ${progress.total} issues read in ${progress.name}. ${orderWord(progress.state)}.`;
}

export function createReadingPathsView({
  clearLoadNotice,
  el,
  elements,
  getRequestedPathId,
  getState,
  isCurrent,
  loadCatalog,
  onCanonicalPath,
  onLoadFailure,
  onSelectedPath,
}) {
  let generation = 0;
  let resolvedPaths = [];
  let selectedPath = null;

  function refreshProgress(state = getState()) {
    if (!isCurrent() || !selectedPath) return;
    for (const output of elements().progressOutputs()) {
      const stop = selectedPath.stops[Number(output.dataset.readingPathProgress)];
      const progress = readingPathProgress(state, stop);
      output.textContent = progressText(progress);
      output.closest('.reading-path-stop').dataset.progress = progress?.state ?? 'not-added';
    }
  }

  function renderStructure(path) {
    const nodes = elements();
    selectedPath = path;
    nodes.name.textContent = path.name;
    nodes.description.textContent = path.description;
    nodes.source.textContent = `Source: ${path.sourceOrigin}`;
    nodes.count.textContent = `${path.stops.length} stops`;
    nodes.spine.replaceChildren(...path.stops.map((stop, index) => el('li', {
      class: 'reading-path-stop',
      dataset: { readingPathStop: stop.stepId },
    }, [
      el('span', { class: 'reading-path-marker', 'aria-hidden': 'true', text: String(stop.position) }),
      el('div', { class: 'reading-path-stop-copy' }, [
        el('h3', { text: stop.name }),
        el('p', {
          class: 'reading-path-stop-meta',
          text: `Stop ${stop.position} of ${stop.total}${stop.year == null ? '' : ` · Starts ${stop.year}`}`,
        }),
        el('p', {
          class: 'reading-path-stop-progress',
          dataset: { readingPathProgress: index },
        }),
      ]),
    ])));
    refreshProgress();
  }

  function setOptions(paths, selectedId) {
    const select = elements().select;
    const signature = paths.map((path) => path.id).join('\n');
    if (select.dataset.paths !== signature) {
      select.replaceChildren(...paths.map((path) => el('option', {
        value: path.id,
        text: path.name,
      })));
      select.dataset.paths = signature;
    }
    select.value = selectedId;
  }

  async function render() {
    const currentGeneration = ++generation;
    const nodes = elements();
    clearLoadNotice();
    nodes.status.textContent = 'Loading reading paths…';
    nodes.details.hidden = true;
    try {
      const catalog = await loadCatalog();
      if (!isCurrent() || currentGeneration !== generation) return;
      resolvedPaths = resolveReadingPaths(catalog.paths, catalog.lists);
      if (!resolvedPaths.length) {
        selectedPath = null;
        nodes.status.textContent = 'No reading paths are bundled with this build.';
        return;
      }
      const requestedId = getRequestedPathId();
      const selected = resolvedPaths.find((path) => path.id === requestedId) ?? resolvedPaths[0];
      setOptions(resolvedPaths, selected.id);
      renderStructure(selected);
      nodes.details.hidden = false;
      nodes.status.textContent = `${resolvedPaths.length} Reading paths available.`;
      if (requestedId !== selected.id) onCanonicalPath(selected.id);
    } catch (error) {
      if (!isCurrent() || currentGeneration !== generation) return;
      selectedPath = null;
      nodes.status.textContent = 'Reading paths could not be loaded.';
      await onLoadFailure({
        error,
        retry: render,
        isCurrent: () => isCurrent() && currentGeneration === generation,
      });
    }
  }

  function wire() {
    elements().select.addEventListener('change', (event) => {
      const selected = resolvedPaths.find((path) => path.id === event.target.value);
      if (!selected || !isCurrent()) return;
      onSelectedPath(selected.id);
      renderStructure(selected);
    });
  }

  return {
    refreshProgress,
    render,
    selected: () => selectedPath,
    wire,
  };
}
