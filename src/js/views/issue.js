import { labelledName } from '../lib/accname.js';
import { issuePresentation, resolveIssueFocus } from '../lib/issueFocus.js';

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
  synopsisStatusLine,
}) {
  let activeLoad = null;
  let activeRoute = null;
  let currentResult = null;

  function issueContextText(context) {
    if (!context) return '';
    const position = context.total ? `${context.position} of ${context.total}` : '';
    return [context.name, context.collectedIn, position].filter(Boolean).join(' · ');
  }

  function paint(result) {
    const nodes = elements();
    const issue = result?.issue;
    currentResult = result;
    if (!issue) {
      nodes.card.hidden = true;
      nodes.heading.textContent = 'Issue unavailable';
      nodes.context.textContent = '';
      nodes.status.textContent = activeRoute?.issueId < 0
        ? 'This local issue is no longer in saved data or the bundled order named by the link.'
        : 'Issue details could not be loaded. Your saved lists and progress are unchanged.';
      renderBreadcrumbs();
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
    nodes.description.textContent = presentation.description;
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
    nodes.synopsis.hidden = issue.issueId < 0 || isSynopsisActive();
    nodes.cancelSynopsis.hidden = true;
    renderBreadcrumbs();
  }

  async function render(route) {
    if (!route) return;
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
    let catalog = null;
    if (route.context?.kind === 'order') {
      try {
        catalog = await loadCatalog();
      } catch {
        catalog = null;
      }
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
      if (result.contextStatus === 'stale' && route.context) onStaleContext(route);
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
  }

  function repaintSynopsis(status) {
    if (!currentResult?.issue) return;
    const nodes = elements();
    nodes.synopsisStatus.textContent = synopsisStatusLine(status);
    nodes.synopsisStatus.hidden = !nodes.synopsisStatus.textContent;
    paint(currentResult);
    nodes.synopsis.hidden = currentResult.issue.issueId < 0 || isSynopsisActive();
    nodes.cancelSynopsis.hidden = !isSynopsisActive();
  }

  function wire() {
    const nodes = elements();
    nodes.read.addEventListener('click', (event) => {
      if (currentResult?.issue) onRead(currentResult.issue, event);
    });
    nodes.synopsis.addEventListener('click', onStartSynopsis);
    nodes.cancelSynopsis.addEventListener('click', onCancelSynopsis);
  }

  return {
    cancel,
    render,
    repaintSynopsis,
    result: () => currentResult,
    wire,
  };
}
