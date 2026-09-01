import {
  addIssuesToList,
  createList,
  heldCount,
  markRead,
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

const NAME_SEARCH_LIMIT = 40;

export function mergeLongAddPage(state, context, issues) {
  let { listId, insertAt } = context;
  const { ownedIds = [] } = context;
  let next = state;
  if (!listId) {
    next = createList(next, { name: DEFAULT_LIST_NAME });
    listId = next.listOrder[next.listOrder.length - 1];
    next = setActive(next, listId);
    insertAt = 0;
  }
  const list = next.lists[listId];
  if (!list) return { state, added: 0, skipped: 0, context, missing: true };

  const before = new Set(list.itemIds);
  const merged = addIssuesToList(next, listId, issues);
  const mergedList = merged.state.lists[listId];
  const fresh = mergedList.itemIds.filter((id) => !before.has(id));
  const present = new Set(mergedList.itemIds);
  const nextOwned = [...new Set([...ownedIds, ...fresh])].filter((id) => present.has(id));
  const owned = new Set(nextOwned);
  const stable = mergedList.itemIds.filter((id) => !owned.has(id));
  const at = Math.max(0, Math.min(Number(insertAt) || 0, stable.length));
  nextOwned.sort((a, b) => compareIssues(merged.state.issues[a], merged.state.issues[b]));

  return {
    state: {
      ...merged.state,
      lists: Object.assign(Object.create(null), merged.state.lists, {
        [listId]: {
          ...mergedList,
          itemIds: stable.slice(0, at).concat(nextOwned, stable.slice(at)),
        },
      }),
    },
    added: merged.added,
    skipped: merged.skipped,
    context: { ...context, listId, insertAt, ownedIds: nextOwned },
    missing: false,
  };
}

export class LongAddRunner {
  constructor({ load, savePage, onStatus = () => {} } = {}) {
    this.load = load;
    this.savePage = savePage;
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
      context: run.context,
      received: run.received,
      persisted: run.persisted,
      total: run.total,
      pages: run.pages,
      added: run.added,
      skipped: run.skipped,
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

  async start(item, context = {}) {
    if (this.current) return this.status(this.current, 'running');
    const run = {
      item,
      context,
      controller: new AbortController(),
      received: 0,
      persisted: 0,
      total: Number(item?.issueCount) || null,
      pages: 0,
      added: 0,
      skipped: 0,
      terminal: null,
    };
    this.current = run;
    this.onStatus(this.status(run, 'running'));
    if (this.current !== run) return run.terminal;

    const { signal } = run.controller;
    try {
      await this.load(item, {
        signal,
        onPage: (items, progress = {}) => {
          if (signal.aborted || this.current !== run) return;
          run.received = Number.isFinite(Number(progress.loaded))
            ? Number(progress.loaded)
            : run.received + items.length;
          run.total = progress.total == null ? run.total : Number(progress.total);
          const saved = this.savePage(items, run.context);
          if (signal.aborted || this.current !== run) return;
          if (!saved?.ok) {
            const error = new Error(saved?.error || 'That page could not be saved.');
            error.name = 'SaveError';
            throw error;
          }
          run.context = saved.context ?? run.context;
          run.persisted += Number(saved.persisted ?? items.length);
          run.pages += 1;
          run.added += Number(saved.added) || 0;
          run.skipped += Number(saved.skipped) || 0;
          this.onStatus(this.status(run, 'running'));
        },
      });
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

export function persistLongAddPage(readerStore, items, context, onSaved = () => null) {
  if (!items.length) return { ok: true, added: 0, skipped: 0, persisted: 0, context };
  let merged;
  readerStore.update((state) => {
    merged = mergeLongAddPage(state, context, items);
    return merged.state;
  });
  if (merged.missing) {
    return {
      ok: false,
      error: 'The destination list no longer exists. No later pages were added.',
      context,
    };
  }
  if (!readerStore.lastUpdateOk) {
    return { ok: false, error: readerStore.lastError, context };
  }
  const transition = context.transition
    ?? onSaved({ ok: true, added: merged.added, listId: merged.context.listId });
  return {
    ok: true,
    added: merged.added,
    skipped: merged.skipped,
    persisted: merged.added + merged.skipped,
    context: { ...merged.context, transition },
  };
}

export function longAddStatusLine(status, { name, kind }, friendly = (error) => error?.message ?? String(error)) {
  const total = status.total ? ` of ${status.total}` : '';
  const savedIssues = `${status.persisted}${total} issue${status.total || status.persisted !== 1 ? 's' : ''}`;
  if (status.phase === 'running') {
    if (!status.received) {
      return kind === 'creator'
        ? `Loading issues credited to ${name}\u2026`
        : `Loading all issues of ${name}\u2026`;
    }
    return `${name}: ${savedIssues} saved so far.`;
  }
  if (status.phase === 'cancelled') {
    if (!status.persisted) return `${name}: stopped before the first page was saved.`;
    return `${name}: stopped after ${savedIssues} ${status.total || status.persisted !== 1 ? 'were' : 'was'} saved. `
      + `${status.added} added${status.skipped ? `, ${status.skipped} skipped as duplicates` : ''}.`;
  }
  if (status.phase === 'failed') {
    const kept = status.persisted
      ? `${savedIssues} ${status.total || status.persisted !== 1 ? 'were' : 'was'} saved.`
      : 'No completed page was saved.';
    const unsaved = status.received > status.persisted
      ? ` ${status.received - status.persisted} received issue${status.received - status.persisted === 1 ? '' : 's'} could not be saved.`
      : '';
    return `${name}: loading failed. ${kept}${unsaved} ${friendly(status.error)}`;
  }
  const duplicate = status.skipped
    ? `, ${status.skipped} ${kind === 'creator' ? 'duplicates' : 'skipped as duplicates'}`
    : '';
  const ending = `${name}: ${status.added} ${kind === 'series' ? `issue${status.added === 1 ? '' : 's'} ` : ''}added${duplicate}.`;
  return kind === 'creator'
    ? `${ending} Creator records omit Unlimited dates, so availability shows as unknown until details are fetched.`
    : ending;
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
  saveLongAddPage,
  search,
  updateState,
  warmNameIndex,
  withSaveEducation,
  ymd,
}) {
  let manualMatch = null;
  let longAddHydration = Promise.resolve();

  const count = (number) => Number(number ?? 0).toLocaleString();
  const snapshot = (generatedAt) => {
    const when = updatedLabel({ updatedAt: generatedAt });
    return when ? `, taken ${when}` : '';
  };

  function longAddContext() {
    const listId = getActiveListId();
    return {
      listId,
      insertAt: listId ? (getState().lists[listId]?.itemIds.length ?? 0) : 0,
      ownedIds: [],
      transition: null,
    };
  }

  function queueLongAddHydration(listId) {
    longAddHydration = longAddHydration.then(() => hydrate(listId));
  }

  function renderLongAddStatus(config, runner, status) {
    const box = $(config.results);
    const focusedCancel = box?.querySelector('.notice-act button') === document.activeElement;
    const running = status.phase === 'running';
    const message = running
      ? longAddStatusLine(status, { ...config, name: status.item.name }, friendly)
      : withSaveEducation(
        longAddStatusLine(status, { ...config, name: status.item.name }, friendly),
        status.context?.transition,
      );
    notify(
      config.results,
      message,
      running ? 'busy' : status.phase === 'failed' ? 'error' : status.phase === 'cancelled' ? 'warn' : 'ok',
      config.results,
      running ? { label: `Cancel ${config.kind} import`, onClick: () => runner.cancel() } : null,
    );
    if (running && focusedCancel) {
      box.querySelector('.notice-act button')?.focus({ preventScroll: true });
    } else if (!running && focusedCancel) {
      $(config.input)?.focus({ preventScroll: true });
    }
    if (!running && status.added > 0 && status.context?.listId) {
      queueLongAddHydration(status.context.listId);
    }
  }

  function createLongAddRunner(config) {
    const runner = new LongAddRunner({
      load: (item, options) => config.load(item.id, options),
      savePage: saveLongAddPage,
      onStatus: (status) => renderLongAddStatus(config, runner, status),
    });
    return runner;
  }

  const seriesAddRunner = createLongAddRunner({
    kind: 'series',
    input: '#series-q',
    results: '#series-results',
    load: search.seriesIssues,
  });
  const creatorAddRunner = createLongAddRunner({
    kind: 'creator',
    input: '#creator-q',
    results: '#creator-results',
    load: search.creatorIssues,
  });

  function wireNameSearch({
    section, form, input, results, kind, many, btnClass, runSearch, onAdd, active,
  }) {
    $(form).addEventListener('submit', async (event) => {
      event.preventDefault();
      if (active?.()) {
        $(results).querySelector('.notice-act button')?.focus({ preventScroll: true });
        announce(`Cancel the current ${kind === 'series' ? 'series' : 'creator'} import before searching again.`);
        return;
      }
      const query = $(input).value.trim();
      if (!query) return;
      notify(results, 'Searching…', 'busy');
      try {
        const {
          items, matched, total, generatedAt,
        } = await runSearch(query, { limit: NAME_SEARCH_LIMIT });
        const box = $(results);
        box.replaceChildren();
        if (!items.length) {
          notify(results, `No ${many} match “${query}”. Searched all ${count(total)} in the index.`, 'warn');
          return;
        }
        const summary = matched > items.length
          ? `Showing the ${items.length} closest matches of ${count(matched)}. Narrow your search to see the rest.`
          : `${count(matched)} ${matched === 1 ? 'match' : 'matches'}.`;
        box.append(el('p', { class: 'rail-hint', text: summary }));
        box.append(el('details', { class: 'setting-more search-index-note' }, [
          el('summary', { text: 'About these results' }),
          el('p', {
            class: 'rail-hint',
            text: `Filtered on this device from an index of ${count(total)} ${many}${snapshot(generatedAt)}.`,
          }),
        ]));
        announce(summary);
        for (const item of items) {
          box.append(el('div', { class: 'result' }, [
            el('div', { class: 'result-main' }, [
              el('div', { class: 'result-title', text: item.name }),
              el('div', { class: 'result-meta', text: `${item.issueCount ?? 'an unknown number of'} issues` }),
            ]),
            el('button', {
              type: 'button',
              class: btnClass,
              'aria-label': `Add all issues of ${item.name}`,
              onclick: () => onAdd(item),
            }, 'Add all issues'),
          ]));
        }
      } catch (error) {
        await reportBundledLoadFailure({
          report: results,
          failure: friendly(error),
          key: `${kind}-index-load`,
          subject: `${kind === 'series' ? 'series' : 'creator'} search`,
          retry: () => $(form).requestSubmit(),
          isCurrent: () => $(section).closest('.view')?.hidden === false,
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

  function addToActive(issues, message, { sort = false } = {}) {
    const setup = ensureList(DEFAULT_LIST_NAME);
    const id = setup.listId;
    if (!setup.ok) return { added: 0, skipped: 0, ok: false, listName: null };
    let added = 0;
    let skipped = 0;
    const result = updateState((state) => {
      const merged = addIssuesToList(state, id, issues, { sort });
      added = merged.added;
      skipped = merged.skipped;
      return merged.state;
    });
    if (!result.ok) return { added: 0, skipped: 0, ok: false, listName: null };
    const listName = getState().lists[id]?.name ?? 'your list';
    const transition = onNonEmptyListSave({ ok: true, added, listId: id });
    announce(withSaveEducation(
      `${message} ${added} added${skipped ? `, ${skipped} already in the list` : ''}.`,
      transition,
    ));
    if (added > 0) hydrate(id);
    return {
      added, skipped, ok: true, listName,
    };
  }

  function renderResults(selector, items, metaFn) {
    const box = $(selector);
    box.replaceChildren();
    if (!items.length) {
      notify(selector, 'Nothing matched that search.', 'warn');
      return;
    }
    const held = heldCount(getState(), items);
    const summary = `${count(items.length)} ${items.length === 1 ? 'result' : 'results'}, ${count(held)} already in your library.`;
    box.append(el('div', { class: 'res-head', text: summary }));
    announce(summary);
    for (const item of items) {
      const btn = el('button', { type: 'button', class: 'btn btn-g' }, 'Add');
      btn.addEventListener('click', () => {
        const result = addToActive([item], `Added ${item.title}.`);
        if (!result.ok) {
          btn.textContent = 'Could not add';
          return;
        }
        btn.disabled = true;
        btn.classList.add('btn-added');
        btn.textContent = result.added ? `Added to ${result.listName}` : 'Already in that list';
      });
      box.append(el('div', { class: 'result' }, [
        el('div', { class: 'result-main' }, [
          issueFocusAnchor(item, {
            surface: 'search',
            className: 'result-title result-title-link',
            children: item.title,
          }),
          el('div', { class: 'result-meta', text: metaFn(item) }),
        ]),
        ...(heldCount(getState(), [item])
          ? [el('span', { class: 'pill-held', text: 'Already in your library' })]
          : []),
        btn,
      ]));
    }
  }

  async function addSeries(series) {
    return seriesAddRunner.start(series, longAddContext());
  }

  async function addCreator(creator) {
    return creatorAddRunner.start(creator, longAddContext());
  }

  function unresolvedRow(entry, listId) {
    const row = el('div', { class: 'result' });
    const main = el('div', { class: 'result-main' }, [
      el('div', { class: 'result-title', text: entry.title }),
      el('div', { class: 'result-meta', text: 'No issue link, search to resolve' }),
    ]);
    const button = el('button', { type: 'button', class: 'btn btn-g' }, 'Find match');
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
        ? `Filled from “${candidate.title}” on the wiki: ${summary}. Press Add issue to keep it.`
        : `“${candidate.title}” carried no release date, page count or credits, so only the title was filled.`,
      summary ? 'ok' : 'warn',
      '#manual-candidates',
      { label: 'Discard', onClick: () => { clearManualMatch(); announce('Details from the wiki discarded.'); } },
    );
  }

  async function doManualLookup() {
    const phrase = $('#manual-title').value.trim();
    if (!phrase) {
      notify('#manual-report', 'Type a title first, then look it up.', 'warn');
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
      notify('#manual-report', 'A title is required.', 'warn');
      return;
    }
    if (url && !isSafeMarvelUrl(url)) {
      notify('#manual-report', 'That URL is not a marvel.com address. Leave it blank if you do not have one.', 'error');
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
    $('#form-search').addEventListener('submit', async (event) => {
      event.preventDefault();
      const query = $('#search-q').value.trim();
      if (!query) return;
      notify('#search-results', 'Searching…', 'busy');
      try {
        const items = await search.issues(query, { limit: 50 });
        renderResults(
          '#search-results',
          items,
          (item) => `${item.seriesName ?? ''}${item.onSale ? ` · ${ymd(item.onSale)}` : ''}`,
        );
      } catch (error) {
        notify('#search-results', friendly(error), 'error');
      }
    });
    wireNameSearch({
      section: '#sec-series',
      form: '#form-series',
      input: '#series-q',
      results: '#series-results',
      kind: 'series',
      many: 'series',
      btnClass: 'btn btn-g',
      runSearch: search.series,
      onAdd: addSeries,
      active: () => seriesAddRunner.active,
    });
    wireNameSearch({
      section: '#sec-creator',
      form: '#form-creator',
      input: '#creator-q',
      results: '#creator-results',
      kind: 'creators',
      many: 'creators',
      btnClass: 'btn btn-g',
      runSearch: search.creators,
      onAdd: addCreator,
      active: () => creatorAddRunner.active,
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
  }

  return { enter, renderDestination, wire };
}
