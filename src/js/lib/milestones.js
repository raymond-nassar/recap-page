import { isRead, listCollections, listProgress } from './model.js';

// Reading Journey milestones (#874, the audit's UX-37): the moment a read mark leaves a section of the
// full Reading List, or the whole list, with nothing unread. Both are derived from saved progress and
// the list's own section runs, so nothing new is stored and a backup carries nothing new.

// The heading a section run shows in the full list. A list with no named section shows none, and its
// leading unnamed run shows none either, which is the rule renderRows follows, so a milestone is
// only ever reported for a heading the reader can see.
export function sectionHeading(run, index) {
  if (!run) return null;
  return run.name || (index > 0 ? 'Individual issues' : null);
}

// A section's name in a sentence. Most names are short, but a few bundled lists carry a whole
// collection's contents as one, the longest 881 characters, which would turn Done's one-line result
// into a paragraph. Cut at a word where one is near.
export const SECTION_NAME_MAX = 60;

export function sectionName(name) {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= SECTION_NAME_MAX) return text;
  const head = text.slice(0, SECTION_NAME_MAX + 1);
  const space = head.lastIndexOf(' ');
  const cut = space >= SECTION_NAME_MAX / 2 ? head.slice(0, space) : text.slice(0, SECTION_NAME_MAX);
  return `${cut.replace(/[\s,;:|/-]+$/, '')}…`;
}

export function sectionSentence(name) {
  const label = sectionName(name);
  return `Section complete: ${label}${/[.!?…]$/.test(label) ? '' : '.'}`;
}

const NONE = Object.freeze({ section: null, list: false });

// Which milestones one comic's mark reached in one list, judged against the state the mark replaced.
// Only a comic that was unread and is now read can reach one, so an unmark, a repeated mark or a
// section that was already complete reaches neither, and Undo needs nothing of its own to take a
// milestone back: the heading and the wrap-up read the same progress it restores.
export function readMilestones(before, after, listId, issueId) {
  const id = Number(issueId);
  const list = after?.lists?.[listId];
  if (!list?.itemIds.includes(id) || !before || isRead(before, id) || !isRead(after, id)) return NONE;
  const runs = listCollections(after, listId);
  const index = runs.findIndex((run) => run.items.some((item) => item.issueId === id));
  const run = runs[index];
  const heading = sectionHeading(run, index);
  const { read, total } = listProgress(after, listId);
  return {
    section: heading && run.read === run.total ? { index, name: heading } : null,
    list: total > 0 && read === total,
  };
}

// The moment itself: a short pop on the element that shows the milestone. Played through the Web
// Animations API rather than a CSS class, because a class left on a cached heading would play again
// whenever the full list reopened or a filter brought the heading back. Nothing plays when reduced
// motion is requested, and the state it celebrates is drawn the same either way. One rise in opacity
// and a scale that settles, under half a second, so nothing flashes (WCAG 2.3.1) and nothing waits on
// it: the element is never a control.
export const MILESTONE_MS = 400;
export const MILESTONE_KEYFRAMES = Object.freeze([
  { opacity: 0, scale: 0.6 },
  { opacity: 1, scale: 1.12, offset: 0.6 },
  { opacity: 1, scale: 1 },
]);

export function playMilestone(node, win = globalThis) {
  if (!node?.isConnected || typeof node.animate !== 'function' || !node.getClientRects().length) return null;
  if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
  return node.animate(MILESTONE_KEYFRAMES, { duration: MILESTONE_MS, easing: 'ease-out' });
}
