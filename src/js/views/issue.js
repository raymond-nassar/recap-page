import { labelledName } from '../lib/accname.js';
import { readerAction, readerContext } from '../lib/readerDestination.js';
import { issuePresentation, resolveIssueFocus } from '../lib/issueFocus.js';
import { isDeferred, isRead } from '../lib/model.js';
import { savedReaderIssue } from '../lib/temporaryReaderLink.js';

// The fields that name a saved comic, the same ones the rating editor compares.
const comicIdentity = (issue) => issue
  ? JSON.stringify([issue.issueId, issue.title, issue.seriesName, issue.number])
  : null;

export function createIssueView({
  coverUrl,
  decorateResult,
  elements,
  fact,
  getApi,
  getState,
  getSynopsis,
  isSynopsisActive,
  loadCatalog,
  loadOrder,
  onCancelSynopsis,
  onRead,
  onToggleRead,
  onEditNote,
  onReaderContext = () => {},
  onStaleContext,
  onStartSynopsis,
  paintBackground,
  paintCover,
  renderBreadcrumbs,
  readerPresentation = (issue) => ({ launchable: !!issuePresentation(issue)?.launchable, temporary: false }),
  seriesOnly,
  synopsisFallback,
  synopsisStatusLine,
}) {
  let activeLoad = null;
  let activeRoute = null;
  let currentResult = null;
  let savedReference = null;
  let synopsisEpoch = 0;

  // #1061: a loaded summary is shown in full. Readers asked for the context before committing to a
  // run of comics, so the Show and Hide step and its setting are gone; loading stays a choice.
  function paintDescription(issue) {
    const nodes = elements();
    nodes.description.hidden = false;
    nodes.description.textContent = synopsisFallback(issue, getSynopsis(issue.issueId));
  }

  function issueContextText(context, issueId) {
    if (!context) return '';
    const position = context.total ? `${context.position} of ${context.total}` : '';
    const deferred = context.kind === 'list' && isDeferred(getState(), context.id, issueId);
    const intent = deferred
      ? isRead(getState(), issueId) ? 'Read; deferral kept if marked unread' : 'Deferred in this Reading List'
      : '';
    return [context.name, context.collectedIn, position, intent].filter(Boolean).join(' · ');
  }

  function paint(result) {
    const nodes = elements();
    const issue = result?.issue;
    if (currentResult !== result) {
      savedReference = result?.source === 'saved' ? savedReaderIssue(getState(), issue?.issueId) : null;
    }
    currentResult = result;
    onReaderContext(result?.issue ? result : null);
    const retryable = !issue && activeRoute?.issueId > 0 && result?.failure === 'transient';
    const restoreFocus = !retryable && nodes.retry.ownerDocument?.activeElement === nodes.retry;
    nodes.retry.hidden = !retryable;
    nodes.retry.textContent = 'Retry';
    nodes.retry.removeAttribute('aria-disabled');
    nodes.retry.removeAttribute('aria-busy');
    function restoreRetryFocus() {
      if (restoreFocus) {
        nodes.heading.setAttribute('tabindex', '-1');
        nodes.heading.focus({ preventScroll: true });
      }
    }
    if (!issue) {
      nodes.savedActions.hidden = true;
      nodes.card.hidden = true;
      nodes.heading.textContent = 'Issue unavailable';
      nodes.context.textContent = '';
      nodes.status.textContent = activeRoute?.issueId < 0
        ? 'This local issue is no longer in saved data or the bundled order named by the link.'
        : result?.failure === 'not-found'
          ? 'The metadata service has no details for this issue. Your saved lists and progress are unchanged.'
          : retryable
            ? 'Issue details could not be loaded. Check your connection or try again shortly. Your saved lists and progress are unchanged.'
            : 'Issue details could not be loaded. Your saved lists and progress are unchanged.';
      renderBreadcrumbs();
      restoreRetryFocus();
      return;
    }

    const context = result.context;
    const override = context?.override ?? getState().overrides[issue.issueId] ?? null;
    const presentation = issuePresentation(issue, {
      override,
      position: context?.position ?? null,
      total: context?.total ?? null,
      description: synopsisFallback(issue, getSynopsis(issue.issueId)),
    });
    nodes.heading.textContent = presentation.title;
    nodes.context.textContent = issueContextText(context, issue.issueId);
    nodes.status.textContent = result.contextStatus === 'stale'
      ? 'The list or bundled order in this link no longer contains this issue. Showing issue details without that context.'
      : '';
    nodes.card.hidden = false;
    const variant = issueCoverVariant(nodes.image);
    paintCover(nodes.image, nodes.fallback, issue, variant);
    nodes.image.alt = coverUrl(issue, variant) ? `Cover of ${issue.title}` : '';
    nodes.series.textContent = seriesOnly(issue.seriesName);
    nodes.number.textContent = presentation.number;
    paintBackground(nodes.background, issue);
    nodes.byline.textContent = presentation.byline;
    paintDescription(issue);
    nodes.facts.replaceChildren(...presentation.facts.map((item) => (
      fact(item.key, item.value, item.className, item.hint)
    )));
    nodes.note.textContent = context?.note ?? '';
    nodes.note.hidden = !nodes.note.textContent;
    refreshReader();
    nodes.info.hidden = !presentation.detailUrl;
    if (presentation.detailUrl) {
      nodes.info.href = presentation.detailUrl;
      nodes.info.setAttribute('aria-label', labelledName(
        nodes.info.textContent,
        `${issue.title} on marvel.com`,
      ));
    } else {
      nodes.info.removeAttribute('href');
      nodes.info.removeAttribute('aria-label');
    }
    const active = nodes.synopsis.ownerDocument?.activeElement;
    nodes.synopsis.hidden = issue.issueId < 0 || isSynopsisActive() || getSynopsis(issue.issueId) != null;
    nodes.cancelSynopsis.hidden = !isSynopsisActive();
    if ([nodes.synopsis, nodes.cancelSynopsis].includes(active) && active.hidden) {
      const target = [nodes.cancelSynopsis, nodes.synopsis]
        .find((control) => !control.hidden) ?? nodes.description;
      if (target === nodes.description) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
    renderBreadcrumbs();
    restoreRetryFocus();
  }

  async function render(route, { retry = false } = {}) {
    if (!route) return;
    synopsisEpoch += 1;
    activeLoad?.abort();
    const controller = new AbortController();
    activeLoad = controller;
    activeRoute = route;
    currentResult = null;
    savedReference = null;
    onReaderContext(null);
    const nodes = elements();
    nodes.savedActions.hidden = true;
    nodes.card.hidden = true;
    nodes.heading.textContent = 'Loading issue details';
    nodes.context.textContent = '';
    nodes.status.textContent = 'Loading issue details…';
    nodes.retry.hidden = !retry;
    nodes.retry.textContent = retry ? 'Retrying…' : 'Retry';
    nodes.retry.setAttribute('aria-disabled', 'true');
    nodes.retry.setAttribute('aria-busy', 'true');
    let catalog = null;
    if (route.context?.kind === 'order') {
      try {
        catalog = await loadCatalog();
      } catch {
        catalog = null;
      }
      if (activeLoad !== controller || controller.signal.aborted) return;
    }
    try {
      const result = await resolveIssueFocus({
        issueId: route.issueId,
        context: route.context,
        state: getState(),
        catalog,
        loadOrder,
        api: getApi(),
        signal: controller.signal,
      });
      if (activeLoad !== controller || controller.signal.aborted) return;
      paint(decorateResult(result, { catalog, route }));
      if (result.contextStatus === 'stale' && route.context) {
        activeRoute = { ...route, context: null };
        onStaleContext(route);
      }
    } catch (error) {
      if (error?.name === 'AbortError' || activeLoad !== controller) return;
      paint({
        issue: null,
        source: 'unavailable',
        context: null,
        contextStatus: 'none',
        error,
      });
    } finally {
      if (activeLoad === controller) activeLoad = null;
    }
  }

  function cancel() {
    activeLoad?.abort();
    activeLoad = null;
    activeRoute = null;
    currentResult = null;
    savedReference = null;
    onReaderContext(null);
    elements().retry.hidden = true;
    resetSynopsis();
  }

  function resetSynopsis() {
    synopsisEpoch += 1;
    const nodes = elements();
    nodes.description.textContent = '';
    nodes.description.hidden = true;
  }

  function repaintSynopsis(status) {
    if (!currentResult?.issue) return;
    const nodes = elements();
    nodes.synopsisStatus.textContent = synopsisStatusLine(status);
    nodes.synopsisStatus.hidden = !nodes.synopsisStatus.textContent;
    paint(currentResult);
  }

  function refreshReader() {
    if (!currentResult?.issue) return;
    const nodes = elements();
    const saved = currentSavedReference();
    const actionFocused = [nodes.markRead, nodes.editNote].includes(nodes.markRead.ownerDocument?.activeElement)
      && !nodes.savedActions.hidden;
    nodes.savedActions.hidden = !saved;
    nodes.markRead.textContent = saved && isRead(getState(), saved.issueId) ? 'Mark as unread' : 'Mark as read';
    nodes.editNote.textContent = saved && getState().notes[saved.issueId] ? 'Edit note' : 'Add note';
    for (const button of [nodes.markRead, nodes.editNote]) {
      button.setAttribute('aria-label', labelledName(button.textContent, currentResult.issue.title));
    }
    nodes.note.textContent = getState().notes[currentResult.issue.issueId] ?? '';
    nodes.note.hidden = !nodes.note.textContent;
    if (actionFocused && !saved) {
      nodes.heading.setAttribute('tabindex', '-1');
      nodes.heading.focus({ preventScroll: true });
    }
    nodes.context.textContent = issueContextText(currentResult.context, currentResult.issue.issueId);
    const focused = nodes.read.ownerDocument?.activeElement === nodes.read && nodes.read.getClientRects().length > 0;
    const { launchable } = readerPresentation(currentResult.issue, currentResult.source);
    nodes.read.hidden = !launchable;
    nodes.read.textContent = readerAction();
    nodes.read.setAttribute('aria-label', labelledName(readerAction(),
      readerContext(currentResult.issue.title)));
    if (focused && !launchable) {
      nodes.heading.setAttribute('tabindex', '-1');
      nodes.heading.focus({ preventScroll: true });
    }
  }

  function currentSavedReference() {
    if (currentResult?.source !== 'saved' || !savedReference) return null;
    const now = savedReaderIssue(getState(), currentResult.issue?.issueId);
    // Saved data is re-read into new objects after this view first paints: on every boot, when the
    // issue summary cleanup adopts the stored copy, and on a write from another tab. On a reload of a
    // saved comic's details that left Mark as read and Add note dead about 65ms after they appeared.
    // The same comic is followed to its new object; a different comic still withdraws them.
    if (now && now !== savedReference && comicIdentity(now) === comicIdentity(savedReference)) savedReference = now;
    return now === savedReference ? savedReference : null;
  }

  function wire() {
    const nodes = elements();
    for (const [button, action] of [[nodes.markRead, onToggleRead], [nodes.editNote, onEditNote]]) {
      button.addEventListener('click', async () => {
        const saved = currentSavedReference();
        const result = currentResult;
        if (!saved) return;
        await action(saved, () => currentResult === result && currentSavedReference() === saved);
        refreshReader();
      });
    }
    nodes.read.addEventListener('click', (event) => {
      if (currentResult?.issue) onRead(currentResult.issue, event, currentResult.source);
    });
    nodes.synopsis.addEventListener('click', async () => {
      if (!currentResult?.issue) return;
      const issue = currentResult.issue;
      // Invalidated even while consent is open, so leaving and returning cannot revive that request.
      const epoch = ++synopsisEpoch;
      const isCurrent = () => epoch === synopsisEpoch && currentResult?.issue?.issueId === issue.issueId;
      const fetched = await onStartSynopsis(isCurrent);
      if (!fetched || !isCurrent()) return;
      paintDescription(issue);
    });
    nodes.cancelSynopsis.addEventListener('click', () => {
      synopsisEpoch += 1;
      onCancelSynopsis();
    });
    nodes.retry.addEventListener('click', () => {
      if (activeLoad || !activeRoute || currentResult?.failure !== 'transient') return;
      return render(activeRoute, { retry: true });
    });
  }

  return {
    cancel,
    render,
    repaintSynopsis,
    refreshReader,
    resetSynopsis,
    result: () => currentResult,
    wire,
  };
}

// #980: the phone layer shows this cover up to 320px wide, where the 300px portrait_uncanny image was
// stretched 1.6 to 2.6 times on the measured phones. That layer names Marvel's 500px detail image in a
// custom property, so the stylesheet that sizes the cover also picks its image. Desktop never loads
// that layer, so it keeps portrait_uncanny, as does any value other than detail.
export function issueCoverVariant(image) {
  const view = image?.ownerDocument?.defaultView;
  const named = view?.getComputedStyle?.(image)?.getPropertyValue('--issue-cover-variant').trim();
  return named === 'detail' ? 'detail' : 'portrait_uncanny';
}
