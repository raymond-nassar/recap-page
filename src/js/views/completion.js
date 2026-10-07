import { listReadingProgress } from '../lib/model.js';
import { listHistoryIdentity, parseListHistory } from '../lib/listHistory.js';
import { uiIcon } from '../lib/uiIcon.js';
import { labelledName } from '../lib/accname.js';
import { wireFieldValidation } from './shared/field-validation.js';
import { formatRoute, isPlainNavigation } from '../lib/route.js';

export const LIST_FEEDBACK_URL = 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAMAAEys2uVUMkJLVFlNTUhaUFk0NERQQzYxT0xSSDAwVy4u';
export const PRIVATE_FEEDBACK_URL = 'https://github.com/raymond-nassar/recap-page/security/policy';

export function completionDate(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function createCompletionView({
  el,
  elements,
  getState,
  getView,
  getListId,
  history,
  renderSavedLists,
  openList,
  showView,
  loadCatalog,
  resolveRecommendations,
  previewRecommendation,
  askConfirm,
  backupFileRefusal,
  download,
  notify,
  announce,
  focusCurrentView,
  createIcon = uiIcon,
}) {
  let enjoyed = false;
  let pendingAction = false;
  let restoring = false;
  let importGeneration = 0;
  let request = null;
  let feedbackOpener = null;
  let feedbackIdentity = null;
  let restoreFeedbackFocus = true;
  let historyValidation;
  const gateways = new Map();

  function currentList() {
    const state = getState();
    const id = getListId();
    return Object.hasOwn(state.lists, id ?? '') ? state.lists[id] : null;
  }

  function capture() {
    const list = currentList();
    return { listId: list?.id, identity: listHistoryIdentity(list), view: getView() };
  }

  function currentAction(frame, result = {}) {
    const id = result.ok === true ? result.listId : frame.listId;
    const identity = result.ok === true ? result.identity : frame.identity;
    return frame.view === 'read' && getView() === 'read' && getListId() === id
      && typeof identity === 'string' && listHistoryIdentity(currentList()) === identity;
  }

  function closeFeedback({ restoreFocus = true } = {}) {
    restoreFeedbackFocus = restoreFocus;
    const dialog = elements().feedbackDialog;
    if (dialog.open) dialog.close();
  }

  function showFeedback(opener) {
    if (getView() !== 'read' || !currentList()) return;
    feedbackOpener = opener;
    feedbackIdentity = listHistoryIdentity(currentList());
    restoreFeedbackFocus = true;
    const dialog = elements().feedbackDialog;
    if (!dialog.open) dialog.showModal();
  }

  async function change(kind, rating = null, opener = null) {
    if (pendingAction || getView() !== 'read' || !currentList()) return;
    const frame = capture();
    pendingAction = true;
    render();
    let result;
    try {
      result = kind === 'rate'
        ? await history.rate(frame.listId, rating)
        : await history[kind](frame.listId);
    } catch (error) {
      notify('#save-report', `The completion change could not finish (${error.message}). Retry reading completion history before making changes.`, 'error');
      return;
    } finally {
      pendingAction = false;
      render();
    }
    if (!result.ok || !currentAction(frame, result)) {
      if (!result.ok && currentAction(frame) && opener?.hidden) focusCurrentView();
    } else if (kind === 'complete') {
      announce('Reading List marked as completed. Comic progress and notes are unchanged.');
      elements().reopen.focus();
    } else if (kind === 'reopen') {
      announce('Reading List reopened. Comic progress and your enjoyment choice are unchanged.');
      elements().complete.focus();
    } else {
      announce(rating === 'up' ? 'Enjoyment saved: enjoyed.'
        : rating === 'down' ? 'Enjoyment saved: did not enjoy.' : 'Enjoyment choice cleared.');
    }
  }

  function cancelRecommendations() {
    request?.abort.abort();
    request = null;
  }

  function recommendationCurrent(held) {
    return request === held && !held.abort.signal.aborted
      && getView() === 'read' && getState() === held.state
      && listHistoryIdentity(currentList()) === held.identity
      && history.completionRevision === held.revision
      && history.isCompleted(getState(), getListId());
  }

  async function refreshRecommendations({ force = false } = {}) {
    const nodes = elements();
    const list = currentList();
    if (getView() !== 'read' || !list || !history.isCompleted(getState(), list.id)) {
      cancelRecommendations();
      nodes.recommendations.hidden = true;
      return;
    }
    if (!force && request && recommendationCurrent(request)) return request.promise;
    cancelRecommendations();
    const held = {
      state: getState(), identity: listHistoryIdentity(list),
      revision: history.completionRevision, abort: new AbortController(),
    };
    request = held;
    nodes.recommendations.hidden = false;
    nodes.suggestions.replaceChildren();
    nodes.recommendationStatus.textContent = 'Finding next reading...';
    nodes.recommendationStatus.hidden = false;
    nodes.recommendationRetry.hidden = true;
    held.promise = (async () => {
      try {
        const catalog = await loadCatalog();
        if (!recommendationCurrent(held)) return;
        const result = await resolveRecommendations({
          catalog, state: held.state, sourceListId: list.id,
          isCompleted: (state, id) => history.isCompleted(state, id),
          signal: held.abort.signal,
        });
        if (!recommendationCurrent(held) || result.cancelled) return;
        nodes.suggestions.replaceChildren(...result.suggestions.map((suggestion) => {
          const entry = catalog.lists.find((candidate) => candidate.id === suggestion.catalogId);
          if (!entry) throw new Error('A suggested Reading List is missing from the catalog.');
          return el('li', { class: 'recommendation-card' }, [
            el('h3', { text: suggestion.name }),
            el('ul', { class: 'recommendation-reasons' }, suggestion.reasons.map((reason) => el('li', {
              text: reason.text,
            }))),
            el('button', {
              type: 'button', class: 'btn btn-g',
              dataset: { recommendation: suggestion.catalogId },
              text: suggestion.savedListId ? 'Open saved Reading List' : 'Preview Reading List',
              'aria-label': labelledName(suggestion.savedListId ? 'Open saved Reading List' : 'Preview Reading List', suggestion.name),
              onclick: () => {
                if (!recommendationCurrent(held)) return;
                if (suggestion.savedListId) openList(suggestion.savedListId);
                else previewRecommendation(entry, suggestion, catalog);
              },
            }),
          ]);
        }));
        const failures = result.failures.map((failure) => failure.message);
        nodes.recommendationStatus.textContent = failures.length
          ? `Some suggestions could not be checked. ${failures.join(' ')}` : '';
        nodes.recommendationStatus.hidden = failures.length === 0;
        nodes.recommendationRetry.hidden = failures.length === 0;
      } catch (error) {
        if (!recommendationCurrent(held)) return;
        nodes.recommendationStatus.textContent = `Next reading could not be checked (${error.message}). Browse Reading Lists or try again.`;
        nodes.recommendationStatus.hidden = false;
        nodes.recommendationRetry.hidden = false;
      }
    })();
    return held.promise;
  }

  function renderReading() {
    const nodes = elements();
    const list = currentList();
    const visible = getView() === 'read' && !!list;
    nodes.wrapup.hidden = !visible;
    if (!visible) {
      closeFeedback({ restoreFocus: false });
      return;
    }
    const record = history.getRecord(getState(), list.id);
    const completed = record?.completedAt != null;
    const { read, total } = listReadingProgress(getState(), list.id);
    nodes.wrapup.hidden = !completed && !(total > 0 && read === total)
      && history.known && !history.writeUnavailable && !history.lastError;
    nodes.wrapup.classList.toggle('is-completed', completed);
    nodes.wrapupHeading.textContent = completed ? 'Reading List completed' : 'Wrap up this Reading List';
    nodes.status.textContent = !history.known ? history.lastError || 'Completion history is unavailable.'
      : history.writeUnavailable || history.lastError || '';
    nodes.status.hidden = !nodes.status.textContent;
    nodes.complete.hidden = completed;
    nodes.reopen.hidden = !completed;
    nodes.ratings.hidden = !completed;
    nodes.complete.disabled = nodes.reopen.disabled = pendingAction || !history.canSave;
    nodes.feedbackGuide.hidden = !completed;
    for (const [button, rating] of [[nodes.up, 'up'], [nodes.down, 'down']]) {
      button.setAttribute('aria-pressed', String(record?.rating === rating));
      button.disabled = pendingAction || !history.canSave;
    }
    if (nodes.feedbackDialog.open && (!completed || feedbackIdentity !== listHistoryIdentity(list))) {
      closeFeedback();
    }
  }

  function renderCollection() {
    const nodes = elements();
    if (getView() !== 'completed') return;
    const counts = history.counts(getState());
    const ids = history.completedIds(getState(), { enjoyed });
    nodes.collectionCount.textContent = counts
      ? `${counts.completed} completed${counts.enjoyed ? `. ${counts.enjoyed} enjoyed` : ''}.`
      : 'Completion history is unavailable, not an empty collection.';
    nodes.collectionStatus.textContent = !counts
      ? `${history.lastError || 'Completion history could not be read.'} Open Backup & settings to retry or copy its saved value.`
      : !ids.length ? enjoyed ? 'No completed lists are marked enjoyed yet.' : 'No Reading Lists have been marked as completed yet.'
        : 'Most recently completed first. Read and deferred counts remain actual comic progress.';
    renderSavedLists(nodes.collectionSection, nodes.collectionResults, {
      ids,
      status: () => ({ text: 'Completed', className: 'badge-done' }),
      detail: (state, id) => {
        const record = history.getRecord(state, id);
        return `${record.rating === 'up' ? 'Enjoyed. ' : record.rating === 'down' ? 'Did not enjoy. ' : ''}Completed ${completionDate(record.completedAt)}`;
      },
      summary: () => `${ids.length} ${ids.length === 1 ? 'list' : 'lists'}${enjoyed ? ' enjoyed' : ' completed'}`,
    });
  }

  function renderGateways() {
    const nodes = elements();
    const state = getState();
    const counts = history.counts(state);
    for (const [name, parent, before] of [
      ['home', nodes.home, nodes.homeYours],
      ['library', nodes.library, nodes.libraryYours],
    ]) {
      let gateway = gateways.get(name);
      if (!gateway) {
        const copy = el('p', { class: 'rail-hint' });
        const browse = el('a', {
          id: `${name}-completed-browse`,
          class: 'btn',
          href: formatRoute({ view: 'catalog' }),
          text: 'Browse Reading Lists',
          onclick: (event) => {
            if (!isPlainNavigation(event)) return;
            event?.preventDefault();
            showView('catalog', { push: true });
          },
        });
        const section = el('section', {
          id: `${name}-completed`, class: 'sec completion-gateway',
          'aria-labelledby': `${name}-completed-h`,
        }, [
          el('div', { class: 'sec-h' }, el('h2', { id: `${name}-completed-h`, text: 'Completed lists' })),
          copy,
          browse,
          el('button', { type: 'button', class: 'btn btn-g', text: 'View completed lists', onclick: () => showView('completed', { push: true }) }),
        ]);
        parent.insertBefore(section, name === 'library' ? before.nextSibling : before);
        gateway = { section, copy, browse };
        gateways.set(name, gateway);
      }
      gateway.section.hidden = state.listOrder.length === 0 || counts?.completed === 0;
      gateway.browse.hidden = !counts || !state.listOrder.length
        || counts.completed !== state.listOrder.length;
      gateway.copy.textContent = counts
        ? `${counts.completed} completed Reading ${counts.completed === 1 ? 'List' : 'Lists'}. ${counts.enjoyed} enjoyed.${counts.completed === state.listOrder.length && counts.completed ? ' All your saved lists are completed; choose another when you are ready.' : ''}`
        : 'Completion history is unavailable. Open the collection or Backup & settings to check it.';
    }
  }

  function renderHistory() {
    const nodes = elements();
    const counts = history.counts(getState());
    nodes.historyStatus.textContent = !history.known ? history.lastError || 'Completion history could not be read.'
      : history.writeUnavailable || history.lastError || `${counts.completed} saved lists completed. ${counts.enjoyed} enjoyed. This history is private to this browser.`;
    nodes.historyExport.disabled = !history.known || history.busy;
    nodes.historyRestore.disabled = restoring || history.busy || !!history.writeUnavailable || history.seenRaw === undefined;
    nodes.historyRetry.disabled = history.busy;
    if ((!history.known || history.writeUnavailable || history.lastError) && nodes.historyTroubleshooting) {
      nodes.historyTroubleshooting.open = true;
    }
  }

  function render() {
    renderReading();
    renderCollection();
    renderGateways();
    renderHistory();
    if (getView() !== 'data' && restoring) importGeneration += 1;
    return refreshRecommendations();
  }

  async function exportHistory(copy = false) {
    try {
      const text = copy ? history.exportStoredCopy() : history.exportBackup();
      const saved = await download(copy ? 'recap-page-completion-saved-copy.json' : 'recap-page-completion-history.json', text, 'application/json');
      if (saved) announce(saved === true
        ? copy ? 'Completion-history saved-value copy downloaded.' : 'Completion-history backup downloaded.'
        : 'Completion-history download requested. Check your browser\'s downloads to confirm it was saved.');
    } catch (error) {
      notify('#history-report', `Completion history could not be exported (${error.message}). Its saved value is unchanged.`, 'error');
    }
  }

  async function restoreHistory(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file || restoring) return;
    const generation = ++importGeneration;
    const refusal = backupFileRefusal(file);
    if (refusal) {
      historyValidation.fail(`Completion history is unchanged. Choose a completion-history JSON backup from this app and try again. ${refusal}`);
      input.value = '';
      return;
    }
    restoring = true;
    let cancelled = false;
    let replacementReached = false;
    renderHistory();
    try {
      const text = await file.text();
      parseListHistory(text);
      historyValidation.clear();
      if (generation !== importGeneration || getView() !== 'data') return;
      const yes = await askConfirm({
        title: 'Replace completion and enjoyment history?',
        body: 'This replaces completion dates and enjoyment choices only. Reading lists, notes and comic progress are unchanged. There is no automatic Undo; download a completion-history backup first to keep the current history.',
        confirmLabel: 'Restore completion history',
      });
      if (!yes) cancelled = true;
      if (!yes || generation !== importGeneration || getView() !== 'data') return;
      replacementReached = true;
      const result = await history.restore(text);
      if (result.ok) notify('#history-report', 'Completion history restored. Reading data is unchanged.', 'ok');
    } catch (error) {
      if (replacementReached) notify('#history-report', `Completion-history restore did not finish (${error.message}). Check its saved value before retrying.`, 'error');
      else historyValidation.fail(`Completion history is unchanged. Choose a completion-history JSON backup from this app and try again. ${error.message}`);
    } finally {
      restoring = false;
      input.value = '';
      renderHistory();
      if ((cancelled || input.getAttribute('aria-invalid') === 'true') && generation === importGeneration && getView() === 'data'
        && input.isConnected && !input.disabled && !input.closest('[hidden]')) input.focus();
    }
  }

  function wire() {
    const nodes = elements();
    historyValidation = wireFieldValidation({
      field: nodes.historyRestore, reportId: 'history-report',
      reportError: (message) => notify('#history-report', message, 'error'),
      invalidMessage: 'Choose a completion-history JSON backup from this app.',
    });
    nodes.icons.replaceChildren(createIcon('thumb-up', 'gi'));
    nodes.downIcons.replaceChildren(createIcon('thumb-down', 'gi'));
    nodes.listTools.prepend(nodes.complete);
    nodes.readBody.prepend(nodes.wrapup);
    (nodes.backupHistory || nodes.dataSafety).append(nodes.historyControls);
    nodes.complete.addEventListener('click', () => { void change('complete', null, nodes.complete); });
    nodes.reopen.addEventListener('click', () => { void change('reopen', null, nodes.reopen); });
    for (const [button, rating] of [[nodes.up, 'up'], [nodes.down, 'down']]) {
      button.addEventListener('click', () => {
        const record = history.getRecord(getState(), getListId());
        void change('rate', record?.rating === rating ? null : rating, button);
      });
    }
    nodes.collectionOpen.addEventListener('click', () => showView('completed', { push: true }));
    nodes.feedbackGuide.addEventListener('click', () => showFeedback(nodes.feedbackGuide));
    nodes.feedbackClose.addEventListener('click', () => closeFeedback());
    nodes.feedbackDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeFeedback();
    });
    nodes.feedbackDialog.addEventListener('close', () => {
      if (!restoreFeedbackFocus) return;
      if (feedbackOpener?.isConnected && !feedbackOpener.hidden && !feedbackOpener.closest('[hidden]')) feedbackOpener.focus();
      else focusCurrentView();
    });
    nodes.feedbackLink.href = LIST_FEEDBACK_URL;
    nodes.privateFeedbackLink.href = PRIVATE_FEEDBACK_URL;
    for (const radio of nodes.collectionFilters) {
      radio.addEventListener('change', () => { enjoyed = radio.value === 'enjoyed'; renderCollection(); });
    }
    nodes.recommendationRetry.addEventListener('click', () => { void refreshRecommendations({ force: true }); });
    nodes.recommendationBrowse.addEventListener('click', () => showView('browse', { push: true }));
    nodes.historyExport.addEventListener('click', () => { void exportHistory(); });
    nodes.historyCopy.addEventListener('click', () => { void exportHistory(true); });
    nodes.historyRetry.addEventListener('click', () => history.load());
    nodes.historyRestore.addEventListener('change', (event) => { void restoreHistory(event); });
  }

  return { wire, render, refreshRecommendations, cancel: cancelRecommendations, showFeedback };
}
