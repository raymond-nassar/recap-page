import { labelledName } from '../lib/accname.js';
import { editionRelations } from '../lib/collectedEditions.js';
import { appViewerFor } from '../lib/marvelComicsApp.js';
import {
  MARVEL_UNLIMITED_CHOICE, readerAction, readerDestination, readerName,
} from '../lib/readerDestination.js';
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
  el,
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
  issueUniverseLines,
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
    const deferred = context.kind === 'list' && isDeferred(getState(), context.id, issueId);
    const intent = deferred
      ? isRead(getState(), issueId) ? 'Read; deferral kept if marked unread' : 'Deferred in this Reading List'
      : '';
    return [context.name, context.collectedIn, intent].filter(Boolean).join(' · ');
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
      nodes.heading.textContent = 'Comic unavailable';
      nodes.context.textContent = '';
      nodes.universes.replaceChildren();
      nodes.universes.hidden = true;
      nodes.status.textContent = activeRoute?.issueId < 0
        ? 'This local comic is no longer in saved data or the bundled order named by the link.'
        : result?.failure === 'not-found'
          ? 'The metadata service has no details for this comic. Your saved lists and progress are unchanged.'
          : retryable
            ? 'Comic details could not be loaded. Check your connection or try again shortly. Your saved lists and progress are unchanged.'
            : 'Comic details could not be loaded. Your saved lists and progress are unchanged.';
      renderBreadcrumbs();
      restoreRetryFocus();
      return;
    }

    const context = result.context;
    const override = context?.override ?? getState().overrides[issue.issueId] ?? null;
    const presentation = issuePresentation(issue, {
      override,
      description: synopsisFallback(issue, getSynopsis(issue.issueId)),
    });
    nodes.heading.textContent = presentation.title;
    nodes.context.textContent = issueContextText(context, issue.issueId);
    nodes.status.textContent = result.contextStatus === 'stale'
      ? 'The list or bundled order in this link no longer contains this comic. Showing comic details without that context.'
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
    const universeLines = issueUniverseLines(issue);
    nodes.universes.replaceChildren(...universeLines);
    nodes.universes.hidden = universeLines.length === 0;
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
    nodes.heading.textContent = 'Loading comic details';
    nodes.context.textContent = '';
    nodes.status.textContent = 'Loading comic details…';
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
    const app = Boolean(appViewerFor(currentResult.issue.issueId));
    nodes.read.hidden = !launchable;
    nodes.read.textContent = readerAction(new Date(), { app });
    nodes.read.setAttribute('aria-label', readerName(currentResult.issue.title, new Date(), { app }));
    paintReadingOptions(launchable, app);
    if (focused && !launchable) {
      nodes.heading.setAttribute('tabindex', '-1');
      nodes.heading.focus({ preventScroll: true });
    }
  }

  // The bundled order names the reading list whose curated books a comic is collected in; a saved
  // list carries the order it was added from.
  function editionCatalogId(context) {
    if (context?.kind === 'order') return context.id;
    if (context?.kind === 'list') return getState().lists?.[context.id]?.catalogId ?? null;
    return null;
  }

  // #950: the places this comic can be read, in the order the owner approved. It is offered only
  // when there is a real choice, so it never shows a list of one beside Read.
  function readingChoices(launchable, app) {
    const issue = currentResult.issue;
    const choices = [];
    if (launchable && app) {
      choices.push({
        key: 'app', text: 'Marvel Comics app', name: readerName(issue.title, new Date(), { app: true }),
        read: { app: true },
      });
    }
    if (launchable && readerDestination() === 'unlimited') {
      choices.push({
        key: 'unlimited', text: MARVEL_UNLIMITED_CHOICE, name: `Read ${issue.title} in ${MARVEL_UNLIMITED_CHOICE}`,
        read: { app: false },
      });
    }
    for (const edition of editionRelations(editionCatalogId(currentResult.context), issue)) {
      for (const link of edition.links) {
        const text = `Look for ${edition.title} ${link.preposition} ${link.name}`;
        choices.push({
          key: `${edition.id}:${link.provider}:${link.url}`, text, href: link.url,
          name: labelledName(text, 'opens outside Recap Page'),
        });
      }
    }
    return choices;
  }

  let readingOptionsKey = null;
  let readingOptionsIssue = null;

  function setReadingOptionsOpen(open) {
    const nodes = elements();
    nodes.readingOptionsList.hidden = !open;
    nodes.readingOptionsToggle.setAttribute('aria-expanded', String(open));
  }

  function paintReadingOptions(launchable, app) {
    const nodes = elements();
    const issue = currentResult.issue;
    const choices = readingChoices(launchable, app);
    const key = JSON.stringify([issue.issueId, issue.title, choices.map((choice) => [choice.key, choice.name])]);
    nodes.readingOptions.hidden = choices.length < 2;
    nodes.readingOptionsToggle.setAttribute('aria-label', `Reading options for ${issue.title}`);
    if (key === readingOptionsKey) return;
    // Rebuilt only when the choices change, so a repaint after Mark as read keeps focus in the list.
    const active = nodes.readingOptions.ownerDocument?.activeElement;
    const inside = Boolean(active && nodes.readingOptionsList.contains?.(active));
    readingOptionsKey = key;
    if (readingOptionsIssue !== issue.issueId || choices.length < 2) setReadingOptionsOpen(false);
    readingOptionsIssue = issue.issueId;
    nodes.readingOptionsList.replaceChildren(...choices.map((choice) => el('li', {}, [choice.href
      ? el('a', {
        class: 'mini', href: choice.href, target: '_blank', rel: 'noopener noreferrer',
        referrerPolicy: 'no-referrer', 'aria-label': choice.name, text: choice.text,
      })
      : el('button', {
        type: 'button', class: 'mini', 'aria-label': choice.name, text: choice.text,
        dataset: { readingOption: choice.key },
        onclick: (event) => {
          if (currentResult?.issue === issue) {
            onRead(issue, event, currentResult.source, event.currentTarget, choice.read);
          }
        },
      })])));
    if (inside) {
      const target = choices.length >= 2 ? nodes.readingOptionsToggle : nodes.heading;
      if (target === nodes.heading) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
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
    // The same disclosure as a row's More actions: ordinary buttons and links, not an ARIA menu.
    nodes.readingOptionsToggle.addEventListener('click', () => {
      setReadingOptionsOpen(nodes.readingOptionsList.hidden);
    });
    nodes.readingOptions.addEventListener('focusout', (event) => {
      if (!nodes.readingOptions.contains(event.relatedTarget)) setReadingOptionsOpen(false);
    });
    nodes.readingOptions.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || nodes.readingOptionsList.hidden) return;
      event.preventDefault();
      setReadingOptionsOpen(false);
      nodes.readingOptionsToggle.focus({ preventScroll: true });
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
