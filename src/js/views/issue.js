import { labelledName } from '../lib/accname.js';
import { issuePresentation, resolveIssueFocus } from '../lib/issueFocus.js';
import { renderSynopsisDescription } from '../lib/synopsisDisclosure.js';

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
  onStaleContext,
  onStartSynopsis,
  paintBackground,
  paintCover,
  renderBreadcrumbs,
  seriesOnly,
  synopsisFallback,
  synopsisDisclosure,
  synopsisStatusLine,
}) {
  let activeLoad = null;
  let activeRoute = null;
  let currentResult = null;
  let synopsisEpoch = 0;

  function paintDescription(issue) {
    const nodes = elements();
    renderSynopsisDescription({
      button: nodes.disclosure, description: nodes.description, issue,
      entry: getSynopsis(issue.issueId),
      fallback: synopsisFallback(issue, getSynopsis(issue.issueId)),
      disclosure: synopsisDisclosure,
    });
  }

  function issueContextText(context) {
    if (!context) return '';
    const position = context.total ? `${context.position} of ${context.total}` : '';
    return [context.name, context.collectedIn, position].filter(Boolean).join(' · ');
  }

  function paint(result) {
    const nodes = elements();
    const issue = result?.issue;
    currentResult = result;
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
    nodes.context.textContent = issueContextText(context);
    nodes.status.textContent = result.contextStatus === 'stale'
      ? 'The list or bundled order in this link no longer contains this issue. Showing issue details without that context.'
      : '';
    nodes.card.hidden = false;
    paintCover(nodes.image, nodes.fallback, issue, 'portrait_uncanny');
    nodes.image.alt = coverUrl(issue, 'portrait_uncanny') ? `Cover of ${issue.title}` : '';
    nodes.series.textContent = seriesOnly(issue.seriesName);
    nodes.number.textContent = presentation.number;
    paintBackground(nodes.background, issue);
    nodes.byline.textContent = presentation.byline;
    paintDescription(issue);
    nodes.facts.replaceChildren(...presentation.facts.map((item) => (
      fact(item.key, item.value, item.className)
    )));
    nodes.note.textContent = context?.note ?? '';
    nodes.note.hidden = !nodes.note.textContent;
    nodes.read.hidden = !presentation.launchable;
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
      const target = [nodes.cancelSynopsis, nodes.disclosure, nodes.synopsis]
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
    const nodes = elements();
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
    elements().retry.hidden = true;
    resetSynopsis();
  }

  function resetSynopsis() {
    synopsisEpoch += 1;
    const nodes = elements();
    nodes.description.textContent = '';
    nodes.description.hidden = true;
    nodes.disclosure.hidden = true;
    nodes.disclosure.setAttribute('aria-expanded', 'false');
  }

  function repaintSynopsis(status) {
    if (!currentResult?.issue) return;
    const nodes = elements();
    nodes.synopsisStatus.textContent = synopsisStatusLine(status);
    nodes.synopsisStatus.hidden = !nodes.synopsisStatus.textContent;
    paint(currentResult);
  }

  function wire() {
    const nodes = elements();
    nodes.read.addEventListener('click', (event) => {
      if (currentResult?.issue) onRead(currentResult.issue, event);
    });
    nodes.disclosure.addEventListener('click', () => {
      if (!currentResult?.issue) return;
      synopsisDisclosure.toggle(currentResult.issue.issueId);
      paintDescription(currentResult.issue);
    });
    nodes.synopsis.addEventListener('click', async () => {
      if (!currentResult?.issue) return;
      const issue = currentResult.issue;
      // Invalidated even while consent is open, so leaving and returning cannot revive that request.
      const epoch = ++synopsisEpoch;
      const isCurrent = () => epoch === synopsisEpoch && currentResult?.issue?.issueId === issue.issueId;
      const fetched = await onStartSynopsis(isCurrent);
      if (!fetched || !isCurrent()) return;
      synopsisDisclosure.reveal(issue.issueId);
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
    resetSynopsis,
    result: () => currentResult,
    wire,
  };
}
