import {
  addIssuesToList,
  createList,
  heldCount,
  MAX_NAME,
  markRead,
  mergeIssueMetadata,
  normalizeIssue,
  setActive,
} from '../lib/model.js';
import {
  digitalIdFromUrl,
  isSafeMarvelUrl,
  issueIdFromUrl,
  parseChecklist,
  readerIssueId,
  resolveUniqueExact,
} from '../lib/markdown.js';
import { DEFAULT_LIST_NAME } from '../lib/library.js';
import { compareIssues } from '../lib/sort.js';
import { updatedLabel } from '../lib/catalog.js';
import { formatRoute } from '../lib/route.js';
import { uiIcon } from '../lib/uiIcon.js';
import { labelledName } from '../lib/accname.js';
import { wireFieldValidation } from './shared/field-validation.js';

const NAME_SEARCH_LIMIT = 40;
const ISSUE_SEARCH_LIMIT = 50;
const RESULT_BATCH_SIZE = 50;

export function mergeSearchSelection(state, items, { listId = null, name = '' } = {}) {
  const unchanged = {
    state, listId, listName: null, added: 0, skipped: 0,
  };
  if (!Array.isArray(items) || !items.length) {
    return { ...unchanged, error: 'Select at least one comic first.' };
  }
  const normalized = items.map(normalizeIssue);
  if (normalized.some((item) => !item || item.issueId <= 0)) {
    return { ...unchanged, error: 'A selected comic has no valid issue ID. Search again before saving.' };
  }
  if (listId && !Object.hasOwn(state.lists, listId)) {
    return { ...unchanged, error: 'That Reading List no longer exists. Choose another list.' };
  }
  const listName = String(name).trim();
  if (!listId && (!listName || listName.length > MAX_NAME)) {
    return { ...unchanged, error: `Name the new Reading List using 1 to ${MAX_NAME} characters.` };
  }

  let next = state;
  if (!listId) {
    next = createList(next, { name: listName });
    listId = next.listOrder[next.listOrder.length - 1];
  }
  const unique = new Map();
  for (const issue of normalized) {
    unique.set(issue.issueId, mergeIssueMetadata(unique.get(issue.issueId), issue));
  }
  const issues = [...unique.values()].sort(compareIssues);
  const merged = addIssuesToList(next, listId, issues);
  return {
    ...merged,
    state: setActive(merged.state, listId),
    listId,
    listName: merged.state.lists[listId].name,
    error: null,
  };
}

export function persistSearchSelection(readerStore, items, destination = {}, onSaved = () => null) {
  let merged;
  readerStore.update((state) => {
    merged = mergeSearchSelection(state, items, destination);
    return merged.state;
  });
  if (merged.error || !readerStore.lastUpdateOk) {
    return {
      ok: false,
      state: readerStore.state,
      listId: destination.listId ?? null,
      added: 0,
      skipped: 0,
      error: merged.error || readerStore.lastError,
    };
  }
  return {
    ...merged,
    ok: true,
    transition: merged.added > 0
      ? onSaved({ ok: true, added: merged.added, listId: merged.listId })
      : null,
  };
}

export class ComicSearchRunner {
  constructor({ load, onStatus = () => {} } = {}) {
    this.load = load;
    this.onStatus = onStatus;
    this.current = null;
  }

  get active() {
    return this.current !== null;
  }

  status(run, phase, error = null) {
    return {
      phase,
      item: run.item,
      items: [...run.issues.values()].sort(compareIssues),
      received: run.received,
      total: run.total,
      error,
      running: phase === 'running',
    };
  }

  cancel() {
    const run = this.current;
    if (!run) return null;
    const status = this.status(run, 'cancelled');
    run.terminal = status;
    this.current = null;
    run.controller.abort();
    this.onStatus(status);
    return status;
  }

  async start(item) {
    this.cancel();
    const run = {
      item,
      controller: new AbortController(),
      issues: new Map(),
      received: 0,
      total: null,
      pages: 0,
      terminal: null,
    };
    this.current = run;
    this.onStatus(this.status(run, 'running'));
    if (this.current !== run) return run.terminal;

    const { signal } = run.controller;
    const receive = (items, progress = {}) => {
      if (signal.aborted || this.current !== run) return;
      if (!Array.isArray(items)) throw new TypeError('The comics database returned an invalid result. Search again.');
      for (const input of items) {
        const issue = normalizeIssue(input);
        if (!issue || issue.issueId <= 0) {
          throw new TypeError('The comics database returned a comic without a valid issue ID. Search again.');
        }
        run.issues.set(issue.issueId, mergeIssueMetadata(run.issues.get(issue.issueId), issue));
      }
      run.received = progress.loaded != null && Number.isFinite(Number(progress.loaded))
        ? Number(progress.loaded)
        : run.received + items.length;
      if (progress.total != null && Number.isFinite(Number(progress.total))) run.total = Number(progress.total);
      run.pages += 1;
      this.onStatus(this.status(run, 'running'));
    };
    try {
      const items = await this.load(item, { signal, onPage: receive });
      if (this.current !== run) return run.terminal;
      if (!run.pages) receive(items, { total: items?.length });
      if (this.current !== run) return run.terminal;
      if (run.total != null && run.received < run.total) {
        throw new Error('The comics database stopped before every comic loaded. Search again to load the rest.');
      }
    } catch (error) {
      if (this.current !== run) return run.terminal;
      this.current = null;
      const phase = signal.aborted || error?.name === 'AbortError' ? 'cancelled' : 'failed';
      const status = this.status(run, phase, error);
      run.terminal = status;
      this.onStatus(status);
      return status;
    }

    if (this.current !== run) return run.terminal;
    this.current = null;
    const status = this.status(run, signal.aborted ? 'cancelled' : 'complete');
    run.terminal = status;
    this.onStatus(status);
    return status;
  }
}

export function stageChecklistEntry(entry) {
  const readerOnly = readerIssueId(entry?.digitalId) === Number(entry?.issueId);
  return {
    issueId: entry.issueId,
    title: entry.title,
    url: readerOnly ? null : entry.url,
    digitalId: entry.digitalId ?? null,
    source: readerOnly ? 'manual' : 'import',
    hydrated: readerOnly,
    collectedIn: entry.section ?? null,
  };
}

export function manualDetailUrl(url, digitalId) {
  return digitalId ? null : (url || null);
}

export function createAddView({
  $,
  announce,
  el,
  ensureList,
  friendly,
  getActiveListId,
  getState,
  hydrate,
  issueFocusAnchor,
  lookupManual,
  notify,
  onNonEmptyListSave,
  reportBundledLoadFailure,
  saveSelection,
  search,
  showView,
  updateState,
  warmNameIndex,
  withSaveEducation,
  ymd,
}) {
  let manualMatch = null;
  const selected = new Map();
  let destinationId = '';
  let draftName = DEFAULT_LIST_NAME;
  let nameEdited = false;
  let saving = false;
  let manualTitleValidation;
  let manualUrlValidation;
  const searches = [
    {
      prefix: 'search', kind: 'issue', input: '#search-q', form: '#form-search', results: '#search-results',
      load: (item, options) => search.issues(item.name, { ...options, limit: ISSUE_SEARCH_LIMIT }),
    },
    {
      prefix: 'series', kind: 'series', input: '#series-q', form: '#form-series', results: '#series-results',
      runSearch: search.series,
      load: (item, options) => search.seriesIssues(item.id, options),
    },
    {
      prefix: 'creator', kind: 'creator', input: '#creator-q', form: '#form-creator', results: '#creator-results',
      runSearch: search.creators,
      load: (item, options) => search.creatorIssues(item.id, options),
    },
  ];

  const count = (number) => Number(number ?? 0).toLocaleString();
  const comics = (number) => `${count(number)} comic${number === 1 ? '' : 's'}`;
  const snapshot = (generatedAt) => {
    const when = updatedLabel({ updatedAt: generatedAt });
    return when ? `, taken ${when}` : '';
  };

  function clearSelectionReports() {
    for (const config of searches) {
      config.builder?.report.replaceChildren();
      config.builder?.validation.clear();
    }
  }

  function selectComics(items) {
    for (const item of items) {
      selected.set(item.issueId, mergeIssueMetadata(selected.get(item.issueId), item));
    }
  }

  function refreshBuilders() {
    const state = getState();
    const destinations = state.listOrder
      .filter((id) => Object.hasOwn(state.lists, id))
      .map((id) => [id, state.lists[id].name]);
    const missing = Boolean(destinationId && !Object.hasOwn(state.lists, destinationId));
    const optionsKey = JSON.stringify([destinations, destinationId, missing]);
    for (const config of searches) {
      const builder = config.builder;
      if (!builder) continue;
      for (const link of builder.report.querySelectorAll('a[data-saved-list]')) {
        if (!Object.hasOwn(state.lists, link.dataset.savedList)) {
          const focused = link === document.activeElement;
          link.remove();
          if (focused) builder.report.focus({ preventScroll: true });
        }
      }
      builder.host.hidden = !config.hasResults && selected.size === 0 && builder.report.childElementCount === 0;
      builder.count.textContent = `${comics(selected.size)} selected`;
      builder.clear.disabled = selected.size === 0 || saving;
      builder.save.disabled = selected.size === 0 || saving || missing;
      builder.save.textContent = destinationId ? 'Add to Reading List' : 'Create Reading List';
      builder.nameRow.hidden = Boolean(destinationId);
      if (builder.name.value !== draftName) builder.name.value = draftName;
      builder.missing.hidden = !missing;
      if (builder.optionsKey !== optionsKey) {
        builder.destination.replaceChildren(
          el('option', { value: '', text: 'Create a new Reading List' }),
          ...destinations.map(([id, name]) => el('option', { value: id, text: name })),
          ...(missing ? [el('option', { value: destinationId, disabled: true, text: 'List no longer exists' })] : []),
        );
        builder.optionsKey = optionsKey;
      }
      builder.destination.value = destinationId;
    }
    for (const input of document.querySelectorAll('input[data-comic-id]')) {
      input.checked = selected.has(Number(input.dataset.comicId));
    }
    for (const badge of document.querySelectorAll('[data-held-issue]')) {
      badge.hidden = heldCount(state, [{ issueId: Number(badge.dataset.heldIssue) }]) === 0;
    }
  }

  function saveSelected(config) {
    if (saving) return;
    const { builder } = config;
    const report = `#${config.prefix}-selection-report`;
    if (!selected.size) {
      notify(report, 'Select at least one comic first.', 'warn');
      return;
    }
    if (!destinationId && (!draftName.trim() || draftName.trim().length > MAX_NAME)) {
      builder.validation.fail(`Name the new Reading List using 1 to ${MAX_NAME} characters.`);
      return;
    }
    const creating = !destinationId;
    saving = true;
    refreshBuilders();
    let result;
    try {
      result = saveSelection([...selected.values()], { listId: destinationId || null, name: draftName });
    } finally {
      saving = false;
      refreshBuilders();
    }
    if (!result.ok) {
      notify(report, `Nothing was saved. Your selected comics are still here. ${result.error}`, 'error');
      return;
    }
    selected.clear();
    destinationId = result.listId;
    nameEdited = false;
    const message = creating
      ? `Created “${result.listName}” with ${comics(result.added)}.`
      : `Added ${comics(result.added)} to “${result.listName}”${result.skipped ? `; ${comics(result.skipped)} already in that list` : ''}.`;
    notify(report, withSaveEducation(message, result.transition), result.added ? 'ok' : 'warn');
    builder.report.append(el('a', {
      class: 'btn btn-g',
      href: formatRoute({ view: 'read', listId: result.listId }),
      text: 'View Reading List',
      dataset: { savedList: result.listId },
    }));
    refreshBuilders();
    builder.report.focus({ preventScroll: true });
    if (result.added > 0) hydrate(result.listId);
  }

  function createBuilder(config) {
    const prefix = config.prefix;
    const destination = el('select', { id: `${prefix}-destination`, name: 'destination' });
    const name = el('input', {
      type: 'text', id: `${prefix}-list-name`, name: 'list-name',
      maxlength: MAX_NAME, autocomplete: 'off', value: draftName,
    });
    const nameRow = el('div', { class: 'stack comic-list-name' }, [
      el('label', { for: `${prefix}-list-name`, text: 'List name' }),
      name,
    ]);
    const selectionCount = el('p', { class: 'comic-selection-count' });
    const save = el('button', { type: 'submit', class: 'btn', disabled: true }, 'Create Reading List');
    const clearHelp = 'Clear this draft without changing saved Reading Lists.';
    const clear = el('button', {
      type: 'button', class: 'btn btn-g has-tooltip', disabled: true,
      'data-tooltip': clearHelp, 'aria-describedby': `${prefix}-clear-help`,
    }, 'Clear selection');
    const missing = el('p', {
      class: 'notice notice-warn', hidden: true,
      text: 'That Reading List no longer exists. Choose another list.',
    });
    const report = el('div', { id: `${prefix}-selection-report`, class: 'results', tabindex: -1 });
    const validation = wireFieldValidation({
      field: name,
      reportId: report.id,
      reportError: (message) => notify(`#${prefix}-selection-report`, message, 'warn'),
      invalidMessage: `Name the new Reading List using 1 to ${MAX_NAME} characters.`,
    });
    const form = el('form', { class: 'stack', id: `${prefix}-selection-form` }, [
      selectionCount,
      el('label', { for: `${prefix}-destination`, text: 'Save to' }),
      destination,
      missing,
      nameRow,
      el('div', { class: 'field-row' }, [save, clear]),
      el('span', { class: 'visually-hidden', id: `${prefix}-clear-help`, text: clearHelp }),
    ]);
    const host = el('section', {
      class: 'comic-builder', hidden: true, 'aria-labelledby': `${prefix}-selection-h`,
    }, [
      el('h2', { id: `${prefix}-selection-h`, text: 'Build a Reading List' }),
      form,
      report,
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      saveSelected(config);
    });
    destination.addEventListener('change', () => {
      destinationId = destination.value;
      clearSelectionReports();
      refreshBuilders();
    });
    name.addEventListener('input', () => {
      draftName = name.value;
      nameEdited = true;
      clearSelectionReports();
      refreshBuilders();
    });
    clear.addEventListener('click', () => {
      selected.clear();
      clearSelectionReports();
      refreshBuilders();
      $(config.input).focus({ preventScroll: true });
      announce('Selection cleared. Saved Reading Lists are unchanged.');
    });
    $(config.results).before(host);
    config.builder = {
      host, destination, name, nameRow, count: selectionCount, save, clear, missing, report, validation,
    };
  }

  function renderResults(config, status) {
    const box = $(config.results);
    const items = status.items;
    config.hasResults = items.length > 0;
    if (!selected.size && !nameEdited && !destinationId) draftName = status.item.name.slice(0, MAX_NAME);
    box.replaceChildren();
    const heading = config.kind === 'creator'
      ? `Comics credited to ${status.item.name}`
      : config.kind === 'series' ? `Comics in ${status.item.name}` : `Comics matching “${status.item.name}”`;
    const resultHeading = el('h2', { class: 'comic-results-heading', text: heading, tabindex: -1 });
    box.append(resultHeading);
    if (status.phase !== 'complete') {
      const partial = status.total != null
        ? `${comics(items.length)} of ${count(status.total)}`
        : comics(items.length);
      const message = status.phase === 'cancelled'
        ? `Stopped loading. ${partial} loaded. Nothing was added to your lists.`
        : `Could not load all the comics. ${partial} loaded. ${friendly(status.error)}`;
      box.append(el('p', {
        class: `notice notice-${status.phase === 'failed' ? 'error' : 'warn'}`,
        text: `${message} Search again to load the rest, or choose from the comics below.`,
      }));
      announce(message);
    }
    if (!items.length) {
      if (status.phase === 'complete') {
        notify(config.results, 'Nothing matched that search. You can add the comic by hand.', 'warn', config.results, {
          label: 'Add an issue by hand',
          onClick: () => showView('add-manual', { push: true }),
        });
      } else {
        box.append(el('p', { class: 'rail-hint', text: 'No comics to show. Try a different search.' }));
      }
      refreshBuilders();
      if (config.focusResults) resultHeading.focus();
      config.focusResults = false;
      return;
    }

    const summary = `${comics(items.length)}, ${count(heldCount(getState(), items))} already in your library.`;
    box.append(el('p', { class: 'res-head', text: summary }));
    if (status.phase === 'complete') announce(summary);
    if (config.kind === 'issue' && items.length === ISSUE_SEARCH_LIMIT) {
      box.append(el('p', {
        class: 'rail-hint',
        text: `Issue search shows up to ${ISSUE_SEARCH_LIMIT} matches. Narrow your search if you need a different comic.`,
      }));
    }
    const filter = el('input', {
      type: 'search', id: `${config.prefix}-comic-filter`, name: 'comic-filter',
      placeholder: 'Series or issue title…', autocomplete: 'off',
    });
    box.append(el('div', { class: 'stack' }, [
      el('label', { for: `${config.prefix}-comic-filter`, text: 'Filter these comics' }),
      filter,
    ]));
    const selectAllHelp = 'Select every loaded comic matching this filter, including those not shown.';
    const selectAll = el('button', {
      type: 'button', class: 'btn btn-g has-tooltip',
      dataset: { act: 'select-all', tooltip: selectAllHelp },
      'aria-describedby': `${config.prefix}-select-all-help`,
    });
    box.append(
      el('div', { class: 'field-row comic-result-tools' }, [selectAll]),
      el('span', { class: 'visually-hidden', id: `${config.prefix}-select-all-help`, text: selectAllHelp }),
    );
    const rows = el('div', { class: 'comic-results' });
    const more = el('button', { type: 'button', class: 'btn btn-g', dataset: { act: 'more-comics' } });
    box.append(rows, more);
    let shown = RESULT_BATCH_SIZE;
    let matches = items;

    function renderRows() {
      const query = filter.value.trim().toLocaleLowerCase();
      matches = items.filter((item) => `${item.title} ${item.seriesName ?? ''}`.toLocaleLowerCase().includes(query));
      rows.replaceChildren();
      const visible = matches.slice(0, shown);
      for (const item of visible) {
        const checkbox = el('input', {
          type: 'checkbox', name: 'comics', 'aria-label': `Select ${item.title}`,
          dataset: { comicId: String(item.issueId) },
        });
        checkbox.checked = selected.has(item.issueId);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectComics([item]);
          else selected.delete(item.issueId);
          clearSelectionReports();
          refreshBuilders();
          announce(`${comics(selected.size)} selected.`);
        });
        const metadata = [
          item.seriesName && !item.title.includes(item.seriesName) ? item.seriesName : null,
          item.onSale ? `Released ${ymd(item.onSale)}` : null,
        ].filter(Boolean).join(' · ');
        const metadataId = `${config.prefix}-comic-meta-${item.issueId}`;
        const title = issueFocusAnchor(item, {
          surface: 'search',
          control: config.prefix,
          className: 'result-title result-title-link',
          children: item.title,
        });
        if (metadata) {
          title.classList.add('has-tooltip');
          title.dataset.tooltip = metadata;
          title.setAttribute('aria-describedby', metadataId);
        }
        rows.append(el('div', { class: 'result comic-choice' }, [
          el('label', { class: 'comic-select' }, [checkbox]),
          el('div', { class: 'result-main' }, [
            title,
            ...(metadata ? [el('span', { id: metadataId, class: 'visually-hidden', text: metadata })] : []),
          ]),
          el('span', {
            class: 'pill-held', text: 'Already in your library',
            dataset: { heldIssue: String(item.issueId) },
          }),
        ]));
      }
      if (!matches.length) rows.append(el('p', { class: 'rail-hint', text: 'No comics match this filter.' }));
      selectAll.disabled = matches.length === 0;
      selectAll.textContent = `Select all ${comics(matches.length)}`;
      more.hidden = visible.length >= matches.length;
      more.textContent = `Show ${count(Math.min(RESULT_BATCH_SIZE, matches.length - visible.length))} more`;
      refreshBuilders();
    }
    filter.addEventListener('input', () => {
      shown = RESULT_BATCH_SIZE;
      renderRows();
      announce(`${comics(matches.length)} match this filter.`);
    });
    selectAll.addEventListener('click', () => {
      selectComics(matches);
      clearSelectionReports();
      refreshBuilders();
      announce(`${comics(selected.size)} selected.`);
    });
    more.addEventListener('click', () => {
      shown += RESULT_BATCH_SIZE;
      renderRows();
      if (more.hidden) filter.focus({ preventScroll: true });
    });
    renderRows();
    if (config.focusResults) resultHeading.focus();
    config.focusResults = false;
  }

  for (const config of searches) {
    config.epoch = 0;
    config.runner = new ComicSearchRunner({
      load: config.load,
      onStatus: (status) => {
        const box = $(config.results);
        const focusedCancel = box.querySelector('.notice-act button') === document.activeElement;
        if (status.running) {
          const loaded = status.total == null
            ? comics(status.received)
            : `${comics(status.received)} of ${count(status.total)}`;
          notify(
            config.results,
            status.received ? `Loading ${status.item.name}: ${loaded} loaded…` : `Loading comics for ${status.item.name}…`,
            'busy',
            config.results,
            { label: `Cancel ${config.kind} search`, onClick: () => config.runner.cancel() },
          );
          if (focusedCancel) box.querySelector('.notice-act button')?.focus({ preventScroll: true });
        } else {
          renderResults(config, status);
          if (focusedCancel) $(config.input).focus({ preventScroll: true });
        }
      },
    });
  }

  function beginSearch(config) {
    config.focusResults = false;
    config.epoch += 1;
    config.runner.cancel();
    config.hasResults = false;
    refreshBuilders();
    return config.epoch;
  }

  function wireNameSearch(config) {
    const {
      form, input, results, kind, runSearch,
    } = config;
    const many = kind === 'series' ? 'series' : 'creators';
    $(form).addEventListener('submit', async (event) => {
      event.preventDefault();
      const query = $(input).value.trim();
      if (!query) return;
      const epoch = beginSearch(config);
      notify(results, 'Searching…', 'busy');
      try {
        const {
          items, matched, total, generatedAt,
        } = await runSearch(query, { limit: NAME_SEARCH_LIMIT });
        if (config.epoch !== epoch) return;
        if (matched === 1 && items.length === 1) {
          void config.runner.start(items[0]);
          return;
        }
        const box = $(results);
        box.replaceChildren();
        if (!items.length) {
          notify(results, `No ${many} match “${query}”. Searched all ${count(total)} in the index.`, 'warn');
          return;
        }
        const summary = matched > items.length
          ? `Showing the ${items.length} closest matches of ${count(matched)}. Narrow your search to see the rest.`
          : `${count(matched)} ${matched === 1 ? 'match' : 'matches'}.`;
        const indexHelp = `Filtered on this device from an index of ${count(total)} ${many}${snapshot(generatedAt)}.`;
        box.append(
          el('div', { class: 'field-row' }, [
            el('p', { class: 'rail-hint', text: summary }),
            el('button', {
              type: 'button', class: 'btn btn-g btn-icon has-tooltip',
              'aria-label': 'About these results',
              'data-tooltip': indexHelp, 'aria-describedby': `${config.prefix}-index-help`,
            }, [uiIcon('info')]),
          ]),
          el('span', { id: `${config.prefix}-index-help`, class: 'visually-hidden', text: indexHelp }),
        );
        announce(summary);
        for (const item of items) {
          box.append(el('div', { class: 'result' }, [
            el('div', { class: 'result-main' }, [
              el('div', { class: 'result-title', text: item.name }),
              el('div', { class: 'result-meta', text: `${item.issueCount ?? 'an unknown number of'} issues` }),
            ]),
            el('button', {
              type: 'button',
              class: 'btn btn-g',
              'aria-label': `Browse comics ${kind === 'creator' ? 'by' : 'in'} ${item.name}`,
              onclick: () => {
                config.focusResults = true;
                void config.runner.start(item);
              },
            }, 'Browse comics'),
          ]));
        }
      } catch (error) {
        if (config.epoch !== epoch) return;
        await reportBundledLoadFailure({
          report: results,
          failure: friendly(error),
          key: `${kind}-index-load`,
          subject: `${kind === 'series' ? 'series' : 'creator'} search`,
          retry: () => $(form).requestSubmit(),
          isCurrent: () => config.epoch === epoch && $(form).closest('.view')?.hidden === false,
        });
      }
    });
  }

  function addDestination() {
    const target = getState().lists[getActiveListId()];
    return target
      ? `Adding to: ${target.name}`
      : `Adding to: new ${DEFAULT_LIST_NAME}`;
  }

  function unresolvedRow(entry, listId) {
    const row = el('div', { class: 'result' });
    const main = el('div', { class: 'result-main' }, [
      el('div', { class: 'result-title', text: entry.title }),
      el('div', { class: 'result-meta', text: 'No issue link, search to resolve' }),
    ]);
    const button = el('button', {
      type: 'button', class: 'btn btn-g', 'aria-label': labelledName('Find match', entry.title),
    }, 'Find match');
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const candidates = await search.issues(entry.title, { limit: 25 });
        const resolved = resolveUniqueExact(entry.title, candidates);
        if (resolved.status === 'resolved') {
          let added = 0;
          const saved = updateState((state) => {
            const result = addIssuesToList(state, listId, [resolved.match], {});
            added = result.added;
            return result.state;
          });
          if (!saved.ok) {
            button.disabled = false;
            row.append(el('p', { class: 'notice notice-error', text: 'That match could not be saved.' }));
            return;
          }
          if (entry.read && !updateState((state) => markRead(state, resolved.match.issueId, true)).ok) {
            button.disabled = false;
            return;
          }
          const transition = onNonEmptyListSave({ ok: true, added, listId });
          row.replaceChildren(el('p', { class: 'notice notice-ok', text: `Matched: ${resolved.match.title}` }));
          announce(withSaveEducation(`Matched ${entry.title}.`, transition));
          return;
        }
        const choices = el('div', { class: 'results' });
        const matches = resolved.matches.slice(0, 8);
        if (!matches.length) {
          row.replaceChildren(el('p', {
            class: 'notice notice-warn',
            text: `No candidates found for “${entry.title}”. Add it by hand if you still want to track it.`,
          }));
          announce(`No candidates found for ${entry.title}.`);
          return;
        }
        choices.append(el('p', { class: 'rail-hint', text: `Pick the right issue for “${entry.title}”:` }));
        for (const candidate of matches) {
          choices.append(el('div', { class: 'result' }, [
            el('div', { class: 'result-main' }, [
              el('div', { class: 'result-title', text: candidate.title }),
              el('div', {
                class: 'result-meta',
                text: `${candidate.seriesName ?? ''}${candidate.onSale ? ` · ${ymd(candidate.onSale)}` : ''}`,
              }),
            ]),
            el('button', {
              type: 'button',
              class: 'btn btn-g',
              'aria-label': labelledName('This one', `${candidate.title} for ${entry.title}`),
              onclick: () => {
                let added = 0;
                const saved = updateState((state) => {
                  const result = addIssuesToList(state, listId, [candidate], {});
                  added = result.added;
                  return result.state;
                });
                if (!saved.ok) {
                  row.replaceChildren(el('p', {
                    class: 'notice notice-error',
                    text: `${candidate.title} could not be saved.`,
                  }));
                  return;
                }
                if (entry.read && !updateState((state) => markRead(state, candidate.issueId, true)).ok) return;
                const transition = onNonEmptyListSave({ ok: true, added, listId });
                row.replaceChildren(el('p', { class: 'notice notice-ok', text: `Added ${candidate.title}.` }));
                announce(withSaveEducation(`Added ${candidate.title}.`, transition));
              },
            }, 'This one'),
          ]));
        }
        row.replaceChildren(choices);
      } catch (error) {
        button.disabled = false;
        const why = friendly(error);
        row.append(el('p', { class: 'notice notice-error', text: why }));
        announce(why);
      }
    });
    row.append(main, button);
    return row;
  }

  function doImport() {
    const text = $('#import-text').value;
    if (!text.trim()) {
      notify('#import-report', 'Paste a Reading List first.', 'warn');
      return;
    }
    const { entries, unresolved, headings } = parseChecklist(text);
    const box = $('#import-report');
    box.replaceChildren();
    if (!entries.length && !unresolved.length) {
      notify('#import-report', 'Could not find any issues in that text.', 'warn');
      return;
    }
    const intoNew = $('#import-new-list').checked;
    let listId;
    let setupOk;
    if (intoNew) {
      const name = headings[0] || `Imported ${new Date().toLocaleDateString()}`;
      const created = updateState((state) => createList(state, {
        name,
        description: 'Imported from a pasted Reading List.',
      }));
      if (!created.ok) {
        notify('#import-report', 'Could not create the list, so nothing was imported.', 'error');
        return;
      }
      listId = created.state.listOrder[created.state.listOrder.length - 1];
      setupOk = updateState((state) => setActive(state, listId)).ok;
      if (!setupOk) return;
    } else {
      const setup = ensureList(DEFAULT_LIST_NAME);
      listId = setup.listId;
      setupOk = setup.ok;
      if (!setupOk) {
        notify('#import-report', 'Could not create a list, so nothing was imported.', 'error');
        return;
      }
    }
    const staged = entries.map(stageChecklistEntry);
    let added = 0;
    let skipped = 0;
    const operation = updateState((state) => {
      const result = addIssuesToList(state, listId, staged, {});
      added = result.added;
      skipped = result.skipped;
      let next = result.state;
      for (const entry of entries) if (entry.read) next = markRead(next, entry.issueId, true);
      return next;
    });
    if (!setupOk || !operation.ok) {
      notify('#import-report', 'Nothing was imported: that change could not be saved.', 'error');
      return;
    }
    box.append(el('p', {
      class: 'notice notice-ok',
      text: `Imported ${added} issue${added === 1 ? '' : 's'}${skipped ? `, ${skipped} already present` : ''}. Details will be fetched in the background.`,
    }));
    if (unresolved.length) {
      box.append(el('p', {
        class: 'notice notice-warn',
        text: `${unresolved.length} line${unresolved.length === 1 ? '' : 's'} had no Marvel issue link. They are listed below rather than dropped, so you can resolve each one deliberately.`,
      }));
      const wrap = el('div', { class: 'results' });
      for (const entry of unresolved) wrap.append(unresolvedRow(entry, listId));
      box.append(wrap);
    }
    const transition = onNonEmptyListSave({ ok: true, added, listId });
    announce(withSaveEducation(`Imported ${added} issues.`, transition));
    hydrate(listId);
  }

  function clearManualMatch() {
    manualMatch = null;
    $('#manual-candidates').replaceChildren();
  }

  function factsSummary(facts) {
    const credits = facts.creators?.length ?? 0;
    return [
      facts.onSale ? `released ${ymd(facts.onSale)}` : null,
      facts.pageCount ? `${facts.pageCount} pages` : null,
      credits ? `${credits} credit${credits === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(', ');
  }

  function acceptManualMatch(candidate) {
    const facts = {
      onSale: candidate.onSale,
      pageCount: candidate.pageCount,
      seriesName: candidate.seriesName,
      number: candidate.number,
      creators: candidate.creators.length ? candidate.creators : null,
    };
    manualMatch = { title: candidate.title, marvelIssueId: candidate.marvelIssueId, facts };
    $('#manual-title').value = candidate.title;
    const summary = factsSummary(facts);
    notify(
      '#manual-candidates',
      summary
        ? `Selected “${candidate.title}” from the wiki: ${summary}. It is not saved. Press Add issue to keep it.`
        : `Selected “${candidate.title}” from the wiki. Only the title was filled. It is not saved. Press Add issue to keep it.`,
      summary ? 'ok' : 'warn',
      '#manual-candidates',
      { label: 'Discard', onClick: () => { clearManualMatch(); announce('Details from the wiki discarded.'); } },
    );
    manualTitleValidation.clear();
    $('#manual-title').focus();
  }

  async function doManualLookup() {
    const phrase = $('#manual-title').value.trim();
    if (!phrase) {
      manualTitleValidation.fail('Type a title first, then look it up.');
      return;
    }
    const button = $('#btn-manual-lookup');
    button.disabled = true;
    clearManualMatch();
    try {
      const found = await lookupManual(phrase);
      if (!found.length) {
        notify(
          '#manual-candidates',
          `Nothing on the wiki matched “${phrase}”. Its pages are named like “X-Men Vol 7 26”, so the series and the issue number usually find it. You can still add the issue without any details.`,
          'warn',
        );
        return;
      }
      const choices = el('div', { class: 'results' }, [
        el('p', { class: 'rail-hint', text: 'Pick the issue you meant. Nothing is added until you press Add issue.' }),
      ]);
      for (const candidate of found) {
        choices.append(el('div', { class: 'result' }, [
          el('div', { class: 'result-main' }, [
            el('div', { class: 'result-title', text: candidate.title }),
            el('div', {
              class: 'result-meta',
              text: factsSummary(candidate) || 'No release date, page count or credits on that page',
            }),
          ]),
          el('button', {
            type: 'button',
            class: 'btn btn-g',
            'aria-label': labelledName('Use this', candidate.title),
            onclick: () => acceptManualMatch(candidate),
          }, 'Use this'),
        ]));
      }
      $('#manual-candidates').replaceChildren(choices);
      announce(`${found.length} match${found.length === 1 ? '' : 'es'} from the wiki. Pick the issue you meant.`);
    } catch (error) {
      notify(
        '#manual-candidates',
        `Could not reach the wiki, so nothing was filled in. ${friendly(error)} Nothing about your lists was sent, and your entry is unchanged.`,
        'error',
      );
    } finally {
      button.disabled = false;
    }
  }

  function doManual() {
    const title = $('#manual-title').value.trim();
    const url = $('#manual-url').value.trim();
    if (!title) {
      manualTitleValidation.fail('A title is required.');
      return;
    }
    if (url && !isSafeMarvelUrl(url)) {
      manualUrlValidation.fail('That URL is not a marvel.com address. Leave it blank if you do not have one.');
      return;
    }
    const wikiId = manualMatch?.marvelIssueId ?? null;
    const issueId = issueIdFromUrl(url) ?? wikiId ?? -Date.now();
    if (manualMatch && getState().issues?.[issueId]) {
      const holders = Object.values(getState().lists ?? {})
        .filter((list) => list.itemIds?.includes(issueId))
        .map((list) => list.name)
        .filter(Boolean);
      notify(
        '#manual-report',
        holders.length
          ? `That is the issue you already have in ${holders.join(', ')}, so nothing was added and nothing was changed.`
          : 'The tracker already holds that issue, so nothing was added and nothing was changed.',
        'warn',
      );
      return;
    }
    const digitalId = digitalIdFromUrl(url);
    const detail = manualDetailUrl(url, digitalId);
    const setup = ensureList(DEFAULT_LIST_NAME);
    const listId = setup.listId;
    if (!setup.ok) {
      notify('#manual-report', 'Could not create a list, so nothing was added.', 'error');
      return;
    }
    let added = 0;
    let skipped = 0;
    const filled = manualMatch ? factsSummary(manualMatch.facts) : '';
    const operation = updateState((state) => {
      const result = addIssuesToList(state, listId, [{
        issueId,
        title,
        url: detail,
        digitalId,
        source: 'manual',
        hydrated: true,
        ...(manualMatch?.facts ?? {}),
      }], {});
      added = result.added;
      skipped = result.skipped;
      return result.state;
    });
    if (!operation.ok || added === 0) {
      notify(
        '#manual-report',
        skipped > 0
          ? `“${title}” is already in that list, so nothing was added.`
          : `“${title}” could not be added. Your other lists are unchanged.`,
        skipped > 0 ? 'warn' : 'error',
      );
      return;
    }
    $('#manual-title').value = '';
    $('#manual-url').value = '';
    clearManualMatch();
    const transition = onNonEmptyListSave({ ok: true, added, listId });
    notify(
      '#manual-report',
      withSaveEducation([
        `Added “${title}”.`,
        digitalId
          ? 'Read opens it in Marvel Unlimited.'
          : wikiId
            ? 'Read has no Marvel Unlimited link to use, so it opens the issue page on marvel.com instead. Paste the reader address above to change that.'
            : null,
        filled ? `Filled from the wiki: ${filled}.` : null,
        digitalId
          ? 'Availability still shows as unknown, because that is a separate field the metadata snapshot would have supplied.'
          : 'Availability shows as unknown because it is not in the metadata snapshot.',
      ].filter(Boolean).join(' '), transition),
      'ok',
    );
  }

  function wire() {
    manualTitleValidation = wireFieldValidation({
      field: $('#manual-title'),
      reportId: 'manual-report',
      reportError: (message) => notify('#manual-report', message, 'warn'),
      invalidMessage: 'A title is required.',
    });
    manualUrlValidation = wireFieldValidation({
      field: $('#manual-url'),
      reportId: 'manual-report',
      reportError: (message) => notify('#manual-report', message, 'error'),
      invalidMessage: 'Enter a complete marvel.com or Marvel Unlimited address, or leave it blank.',
    });
    for (const config of searches) {
      createBuilder(config);
      if (config.kind === 'issue') {
        $(config.form).addEventListener('submit', (event) => {
          event.preventDefault();
          const query = $(config.input).value.trim();
          if (!query) return;
          beginSearch(config);
          void config.runner.start({ name: query });
        });
      } else {
        wireNameSearch(config);
      }
    }
    refreshBuilders();
    globalThis.addEventListener('beforeunload', (event) => {
      if (!selected.size) return;
      event.preventDefault();
      event.returnValue = '';
    });
    $('#form-import').addEventListener('submit', (event) => { event.preventDefault(); doImport(); });
    $('#form-manual').addEventListener('submit', (event) => { event.preventDefault(); doManual(); });
    $('#btn-manual-lookup').addEventListener('click', doManualLookup);
    $('#manual-title').addEventListener('input', () => {
      if (manualMatch && $('#manual-title').value.trim() !== manualMatch.title) {
        clearManualMatch();
        notify(
          '#manual-candidates',
          'The title changed, so the details from the wiki were dropped. Look it up again to fill them in.',
          'warn',
        );
      }
    });
  }

  function enter(name) {
    const kind = name === 'add-series' ? 'series' : name === 'add-creator' ? 'creators' : null;
    if (kind) void warmNameIndex(kind);
  }

  function renderDestination() {
    const text = addDestination();
    for (const target of document.querySelectorAll('.add-target')) target.textContent = text;
    refreshBuilders();
  }

  return { enter, renderDestination, wire };
}
