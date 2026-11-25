import { labelledName } from '../../lib/accname.js';
import { editionRelations } from '../../lib/collectedEditions.js';
import { viewerFromKey } from '../../lib/marvelComicsAppUrl.js';
import { MARVEL_UNLIMITED_CHOICE, readerDestination, readerName } from '../../lib/readerDestination.js';

export function readingChoices(issue, catalogId, { launchable, app, now = new Date() }) {
  if (!issue) return [];
  const choices = [];
  if (launchable && app) {
    choices.push({
      key: 'app', text: 'Marvel Comics app', name: readerName(issue.title, now, { app: true }),
      read: { app: true },
    });
  }
  // A viewer-only comic (#1601) was never in Marvel Unlimited's numbering, so it has no such choice.
  if (launchable && readerDestination(now) === 'unlimited' && viewerFromKey(issue.issueId) === null) {
    choices.push({
      key: 'unlimited', text: MARVEL_UNLIMITED_CHOICE, name: `Read ${issue.title} in ${MARVEL_UNLIMITED_CHOICE}`,
      read: { app: false },
    });
  }
  for (const edition of editionRelations(catalogId, issue)) {
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

export function createReadingOptions({ el, root, toggle, list, onRead, focusFallback, trackRow = false }) {
  let key = null;
  let issueId = null;
  let currentIssue = null;
  let generation = 0;

  function setOpen(open) {
    list.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  function paint(issue, choices) {
    const active = (root.ownerDocument ?? globalThis.document)?.activeElement;
    const inList = Boolean(active && list.contains(active));
    const onToggle = active === toggle;
    currentIssue = issue;
    root.hidden = choices.length < 2;
    if (issue) toggle.setAttribute('aria-label', `Reading options for ${issue.title}`);
    else toggle.removeAttribute('aria-label');
    const nextKey = JSON.stringify([issue?.issueId ?? null, issue?.title ?? '', choices.map((choice) => [choice.key, choice.name])]);
    if (key === nextKey) return;
    key = nextKey;
    const paintedGeneration = ++generation;
    if (issueId !== issue?.issueId || root.hidden) setOpen(false);
    issueId = issue?.issueId ?? null;
    list.replaceChildren(...choices.map((choice) => {
      const dataset = trackRow
        ? { readingOption: choice.key, key: issue.issueId, act: `reading-option-${choice.key}` }
        : { readingOption: choice.key };
      return el('li', {}, [choice.href
        ? el('a', {
          class: 'mini', href: choice.href, target: '_blank', rel: 'noopener noreferrer',
          referrerPolicy: 'no-referrer', 'aria-label': choice.name, text: choice.text, dataset,
        })
        : el('button', {
          type: 'button', class: 'mini', 'aria-label': choice.name, text: choice.text, dataset,
          onclick: (event) => {
            if (paintedGeneration === generation) onRead(currentIssue, event, choice.read);
          },
        })]);
    }));
    if (inList || (onToggle && root.hidden)) {
      if (root.hidden) focusFallback();
      else toggle.focus({ preventScroll: true });
    }
  }

  function wire() {
    toggle.addEventListener('click', () => setOpen(list.hidden));
    root.addEventListener('focusout', (event) => {
      if (!root.contains(event.relatedTarget)) setOpen(false);
    });
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || list.hidden) return;
      event.preventDefault();
      if (trackRow) event.stopPropagation();
      setOpen(false);
      toggle.focus({ preventScroll: true });
    });
  }

  return { paint, setOpen, wire };
}
