// A sectional guide keeps a source's own order and adds pause notes, a link to an event guide and
// return points that lead back into the same guide. It takes one guide's own positions, so a long
// source page can be laid out as several smaller guides; no layout or catalog entry is wired here
// until its boundaries are approved.

// Owner-approved reader copy, 2026-11-24. Do not paraphrase.
export const SECTIONAL_GUIDE_COPY = Object.freeze({
  pauseReturn: 'Pause here. Come back after World War Hulk.',
  pauseHeroesForHire: 'Pause here. Issues 11 to 15 are in World War Hulk.',
  openEvent: 'Open World War Hulk',
  continueHeading: 'Continue after World War Hulk',
  openNext: 'Open Secret Invasion',
  linkFailed: "This list couldn't be opened. You can keep reading this guide.",
});

function position(value, count, label) {
  if (!Number.isInteger(value) || value < 1 || value > count) {
    throw new Error(`${label} must be a source position from 1 to ${count}`);
  }
  return value;
}

function copyKey(key, label) {
  if (!Object.hasOwn(SECTIONAL_GUIDE_COPY, key)) throw new Error(`${label} has no approved copy`);
  return key;
}

// Returns the guide in source order: every position exactly once, with each note, link and return
// point at its pinned place. Return points lead back to positions already passed, so following one
// stays in this guide.
export function sectionalGuideSteps(layout) {
  const count = layout?.positionCount;
  if (!Number.isInteger(count) || count < 1) throw new Error('A sectional guide needs its position count');
  const { event = null, next = null } = layout;
  let eventAfter = null;
  if (event !== null) {
    eventAfter = position(event.afterPosition, count, 'The event link');
    copyKey(event.copy, 'The event link');
  }
  if (next !== null) {
    if (position(next.afterPosition, count, 'The next link') !== count) {
      throw new Error('The next link must follow the last position');
    }
    copyKey(next.copy, 'The next link');
  }
  // A pause promises a return after the event, so a guide that pauses must hold that event's link.
  if ((layout.pauses ?? []).length && eventAfter === null) {
    throw new Error('A guide with pauses needs its event link');
  }

  const before = new Map();
  const after = new Map();
  const add = (map, at, step) => map.set(at, [...(map.get(at) ?? []), step]);
  for (const marker of layout.markers ?? []) {
    if (marker.copy !== null) copyKey(marker.copy, 'A source marker');
    add(before, position(marker.beforePosition, count, 'A source marker'), { kind: 'marker', ...marker });
  }

  const returns = [];
  const resumed = new Set();
  let previous = 0;
  for (const pause of layout.pauses ?? []) {
    const at = position(pause.afterPosition, count, 'A pause');
    if (at <= previous) throw new Error('Pauses must follow source order');
    if (at >= eventAfter) throw new Error('A pause must come before the event link');
    previous = at;
    copyKey(pause.copy, 'A pause');
    if (pause.resumeAt === null) {
      if (pause.copy !== 'pauseHeroesForHire') throw new Error('A pause without a return point needs its own copy');
    } else {
      const resumeAt = position(pause.resumeAt, count, 'A return point');
      if (pause.copy !== 'pauseReturn') throw new Error('A pause with a return point needs the return copy');
      if (resumeAt <= at || resumeAt > eventAfter) throw new Error('A return point must lie between its pause and the event');
      if (resumed.has(resumeAt)) throw new Error('Two pauses return to the same position');
      resumed.add(resumeAt);
      returns.push({ kind: 'return-point', title: pause.title, position: resumeAt });
    }
    add(after, at, { kind: 'pause', title: pause.title, copy: pause.copy, resumeAt: pause.resumeAt });
  }

  if (event !== null) {
    add(after, eventAfter, { kind: 'guide-link', catalogId: event.catalogId, copy: event.copy });
    if (returns.length) {
      add(after, eventAfter, { kind: 'heading', copy: 'continueHeading' });
      for (const point of returns) add(after, eventAfter, point);
    }
  }
  if (next !== null) add(after, count, { kind: 'guide-link', catalogId: next.catalogId, copy: next.copy });

  const steps = [];
  for (let at = 1; at <= count; at += 1) {
    steps.push(...(before.get(at) ?? []), { kind: 'position', position: at }, ...(after.get(at) ?? []));
  }
  return steps;
}

// Opening a linked guide never marks anything read and never leaves this guide on failure.
export async function openLinkedGuide({ link, currentGuideId, open }) {
  let opened;
  try {
    opened = (await open(link.catalogId)) === true;
  } catch {
    opened = false;
  }
  return opened
    ? { opened: true, guideId: link.catalogId, message: null }
    : { opened: false, guideId: currentGuideId, message: SECTIONAL_GUIDE_COPY.linkFailed };
}
