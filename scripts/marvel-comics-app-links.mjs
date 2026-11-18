// Marvel Comics app links for the reading lists (#950).
//
//   node scripts/marvel-comics-app-links.mjs --import <matches.json>   select links into the input
//   node scripts/marvel-comics-app-links.mjs                           write the app's data module
//   node scripts/marvel-comics-app-links.mjs --check                   fail if the module is stale
//
// The links were collected once, on 2026-11-18, from comicbookreadingorders.com and matched to our
// comics offline. Nothing here makes a network request: --import reads that offline match file and
// the build reads only the committed input. docs/DATA_PROVENANCE.md records the source and the
// owner's decisions this selection encodes.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const INPUT_PATH = join(ROOT, 'scripts', 'data', 'marvel-comics-app-links', 'links.json');
export const MODULE_PATH = join(ROOT, 'src', 'data', 'marvelComicsAppLinks.js');

// The site's own viewer address, used exactly as published. A link of any other shape, including
// the /issues/ route the owner's own copies use, is refused rather than rewritten.
export const VIEWER_LINK = /^https:\/\/www\.marvelcomicsapp\.com\/viewer\/([1-9][0-9]{0,8})$/;
const SITE_PAGE = /^https:\/\/comicbookreadingorders\.com\/marvel\/[a-z0-9/-]+\/$/;

// The permission excludes the Marvel Master Reading Order and every Patreon-only order. The owner
// ruled on 2026-11-17 that the four era orders are part of the Master Reading Order. The collection
// never kept a row from these pages; refusing them again here keeps a later import honest too.
export const EXCLUDED_PAGES = Object.freeze([
  '/marvel/marvel-master-reading-order',
  '/marvel/events/marvel-now-reading-order/',
  '/marvel/marvel-now-reading-order-part-',
  '/marvel/events/all-new-all-different-marvel-reading-order/',
  '/marvel/all-new-all-different-marvel-reading-order-part-',
  '/marvel/events/marvel-legacy-reading-order/',
  '/marvel/events/a-fresh-start-reading-order/',
  '/marvel/events/imperial-reading-order/',
  '/marvel/events/one-world-under-doom-reading-order/',
  '/marvel/events/x-men-age-of-revelation-reading-order/',
  '/marvel/events/ultimate-universe-reading-order/',
  '/marvel/characters/agatha-harkness-reading-order/',
  '/marvel/characters/hobgoblin-reading-order/',
  '/marvel/characters/jeff-the-land-shark-reading-order/',
  '/marvel/characters/the-leader-reading-order/',
  '/marvel/characters/malekith-reading-order/',
  '/marvel/characters/the-mandarin-reading-order/',
  '/marvel/characters/red-skull-reading-order/',
  '/marvel/characters/scorpion-reading-order/',
  '/marvel/characters/winter-soldier-reading-order/',
]);

export function excludedPage(url) {
  const path = String(url).replace(/^https:\/\/comicbookreadingorders\.com/, '');
  return EXCLUDED_PAGES.some((prefix) => path.startsWith(prefix));
}

function viewerNumber(link) {
  const match = VIEWER_LINK.exec(String(link));
  return match ? Number(match[1]) : null;
}

function validId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Owner decisions of 2026-11-17: every exact match, plus each comic the site dates one year from our
// record when that comic has no exact link, one number, and no other kind of row. A comic with two
// numbers is left out under one number per comic, and so is any number two comics would share.
export function selectLinks(matches) {
  const rows = Array.isArray(matches?.rows) ? matches.rows : [];
  const refused = { badLink: 0, excludedPage: 0, badPage: 0 };
  const conflicted = new Set((matches?.conflicts ?? []).map((entry) => entry?.issueId).filter(validId));
  const exact = new Map();
  const shifted = new Map();
  const otherStatus = new Set();
  const usable = (row) => {
    if (!SITE_PAGE.test(String(row.pageUrl))) { refused.badPage += 1; return false; }
    if (excludedPage(row.pageUrl)) { refused.excludedPage += 1; return false; }
    return true;
  };
  const add = (map, row) => {
    const numbers = (row.appLinks ?? []).map(viewerNumber);
    if (numbers.some((n) => n === null)) { refused.badLink += 1; return; }
    const entry = map.get(row.issueId) ?? { numbers: new Set(), pages: new Set() };
    for (const n of numbers) entry.numbers.add(n);
    entry.pages.add(row.pageUrl);
    map.set(row.issueId, entry);
  };
  for (const row of rows) {
    if (!row || !validId(row.issueId)) continue;
    if (row.status === 'exact') {
      if (!(row.appLinks ?? []).length || !usable(row)) continue;
      add(exact, row);
    } else if (row.status === 'ambiguous' && row.ambiguity === 'cover-year-shift') {
      if (!(row.appLinks ?? []).length || !usable(row)) continue;
      add(shifted, row);
    } else {
      otherStatus.add(row.issueId);
    }
  }

  const chosen = new Map();
  const left = { conflict: 0, severalNumbers: 0, shiftedWithExact: 0, shiftedWithOtherRows: 0, sharedNumber: 0 };
  for (const [issueId, entry] of exact) {
    if (conflicted.has(issueId)) { left.conflict += 1; continue; }
    if (entry.numbers.size !== 1) { left.severalNumbers += 1; continue; }
    chosen.set(issueId, { issueId, viewer: [...entry.numbers][0], basis: 'exact', pages: entry.pages });
  }
  for (const [issueId, entry] of shifted) {
    if (exact.has(issueId)) { left.shiftedWithExact += 1; continue; }
    if (conflicted.has(issueId)) { left.conflict += 1; continue; }
    if (otherStatus.has(issueId)) { left.shiftedWithOtherRows += 1; continue; }
    if (entry.numbers.size !== 1) { left.severalNumbers += 1; continue; }
    chosen.set(issueId, { issueId, viewer: [...entry.numbers][0], basis: 'cover-year-shift', pages: entry.pages });
  }

  const owners = new Map();
  for (const link of chosen.values()) {
    owners.set(link.viewer, [...(owners.get(link.viewer) ?? []), link.issueId]);
  }
  for (const ids of owners.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) { chosen.delete(id); left.sharedNumber += 1; }
  }

  const links = [...chosen.values()].sort((a, b) => a.issueId - b.issueId);
  const pages = [...new Set(links.flatMap((link) => [...link.pages]))].sort();
  const index = new Map(pages.map((page, i) => [page, i]));
  return {
    pages,
    links: links.map(({ issueId, viewer, basis, pages: from }) => ({
      issueId, viewer, basis, pages: [...from].map((page) => index.get(page)).sort((a, b) => a - b),
    })),
    left,
    refused,
  };
}

export function inputFrom(matches) {
  const { pages, links, left, refused } = selectLinks(matches);
  return {
    source: 'https://comicbookreadingorders.com/marvel/event-timeline/',
    matchedAt: String(matches?.generatedAt ?? ''),
    counts: {
      exact: links.filter((link) => link.basis === 'exact').length,
      coverYearShift: links.filter((link) => link.basis === 'cover-year-shift').length,
      total: links.length,
      leftOut: left,
      refusedRows: refused,
    },
    pages,
    links,
  };
}

export function validateInput(input) {
  const problems = [];
  if (!Array.isArray(input?.pages) || !Array.isArray(input?.links)) return ['the input has no pages or links'];
  input.pages.forEach((page, i) => {
    if (!SITE_PAGE.test(page)) problems.push(`page ${i} is not a Comic Book Reading Orders page`);
    if (excludedPage(page)) problems.push(`page ${i} is excluded by the permission: ${page}`);
  });
  const ids = new Set();
  const numbers = new Set();
  let previous = 0;
  for (const link of input.links) {
    if (!validId(link?.issueId) || link.issueId <= previous) problems.push(`comic ${link?.issueId} is out of order or invalid`);
    previous = link?.issueId ?? previous;
    if (!validId(link?.viewer) || !VIEWER_LINK.test(`https://www.marvelcomicsapp.com/viewer/${link.viewer}`)) {
      problems.push(`comic ${link?.issueId} has an invalid viewer number`);
    }
    if (!['exact', 'cover-year-shift'].includes(link?.basis)) problems.push(`comic ${link?.issueId} has an unknown basis`);
    if (!Array.isArray(link?.pages) || !link.pages.length
      || link.pages.some((i) => !Number.isInteger(i) || i < 0 || i >= input.pages.length)) {
      problems.push(`comic ${link?.issueId} names no valid source page`);
    }
    if (ids.has(link?.issueId)) problems.push(`comic ${link?.issueId} appears twice`);
    if (numbers.has(link?.viewer)) problems.push(`viewer ${link?.viewer} is used by two comics`);
    ids.add(link?.issueId);
    numbers.add(link?.viewer);
  }
  return problems;
}

// The app looks a comic up synchronously before opening the reader tab (constraint 7), so the
// table ships as a static module rather than a file fetched later. Pairs of comic and viewer
// number, sorted by comic, keep it small and leave nothing to parse beyond the literal.
export function buildModule(input) {
  const problems = validateInput(input);
  if (problems.length) throw new Error(`Refusing to build Marvel Comics app links:\n${problems.join('\n')}`);
  const pairs = input.links.map(({ issueId, viewer }) => `[${issueId},${viewer}]`);
  const lines = [];
  for (let i = 0; i < pairs.length; i += 12) lines.push(`  ${pairs.slice(i, i + 12).join(',')},`);
  return [
    '// Generated by scripts/marvel-comics-app-links.mjs from scripts/data/marvel-comics-app-links/links.json.',
    '// Marvel Comics app links collected from Comic Book Reading Orders with permission.',
    '// docs/DATA_PROVENANCE.md records the source, the date and what was left out. Do not edit by hand.',
    'export const marvelComicsAppLinkPairs = [',
    ...lines,
    '];',
    '',
  ].join('\n');
}

// One link per line keeps a later correction to a single comic a one-line diff.
export function serializeInput(input) {
  const { links, ...head } = input;
  const top = JSON.stringify(head, null, 2).replace(/\n}$/, '');
  return `${top},\n  "links": [\n${links.map((link) => `    ${JSON.stringify(link)}`).join(',\n')}\n  ]\n}\n`;
}

export const MU_INPUT_PATH = join(ROOT, 'scripts', 'data', 'marvel-comics-app-links', 'mu-issues.json');
export const MU_MODULE_PATH = join(ROOT, 'src', 'data', 'marvelComicsAppMuIssues.js');
const MU_GROUPS = ['recorded-unlimited', 'unknown-unlimited'];

export function muIssueGroup(item, asOf) {
  const date = String(item.mu ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '2007-11-13' && date <= asOf
    && /^[1-9]\d{0,11}$/.test(String(item.digitalId ?? ''))
    ? 'recorded-unlimited' : 'unknown-unlimited';
}

export function catalogComics() {
  const catalog = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8'));
  const comics = new Map();
  for (const file of new Set(catalog.lists.map((list) => list.file).filter(Boolean))) {
    const data = JSON.parse(readFileSync(join(ROOT, 'src', 'data', file), 'utf8'));
    for (const item of data.items ?? []) {
      if (!Number.isInteger(item.issueId)) continue;
      const current = comics.get(item.issueId);
      if (!current) comics.set(item.issueId, { ...item });
      else {
        if (!current.mu && item.mu) current.mu = item.mu;
        if (current.digitalId == null && item.digitalId != null) current.digitalId = item.digitalId;
      }
    }
  }
  return [...comics.values()];
}

// The input freezes the owner's approved population. A later catalog addition does not inherit
// approval merely because its number could be inserted into the same address.
export function muInputFrom(items, viewerLinks, approvedGroups, asOf) {
  if (!Array.isArray(approvedGroups) || approvedGroups.some((group) => !MU_GROUPS.includes(group))) {
    throw new Error('Unknown Marvel Unlimited hand-check group');
  }
  const viewers = new Set(viewerLinks.map((link) => link.issueId));
  const ids = new Set(items.filter((item) => Number.isInteger(item.issueId)
    && /^[1-9]\d{0,8}$/.test(String(item.issueId)) && !viewers.has(item.issueId)
    && approvedGroups.includes(muIssueGroup(item, asOf))).map((item) => item.issueId));
  return { status: 'owner-approved', asOf, approvedGroups, issueIds: [...ids].sort((a, b) => a - b) };
}

export function buildMuModule(input, items, viewerLinks) {
  const fail = (message) => { throw new Error(`Refusing Marvel Unlimited app addresses: ${message}`); };
  if (!['awaiting-owner-handcheck', 'owner-approved'].includes(input?.status)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input?.asOf)
    || !Array.isArray(input?.approvedGroups) || !Array.isArray(input?.issueIds)) fail('invalid approval record');
  if (input.approvedGroups.some((group) => !MU_GROUPS.includes(group))
    || new Set(input.approvedGroups).size !== input.approvedGroups.length) fail('unknown or repeated group');
  if (input.status === 'awaiting-owner-handcheck' && (input.approvedGroups.length || input.issueIds.length)) {
    fail('pending approval must contain no groups or numbers');
  }
  const comics = new Map(items.map((item) => [item.issueId, item]));
  const viewers = new Set(viewerLinks.map((link) => link.issueId));
  let previous = 0;
  for (const id of input.issueIds) {
    if (!Number.isInteger(id) || !/^[1-9]\d{0,8}$/.test(String(id)) || id <= previous) {
      fail(`invalid, repeated or unsorted number ${id}`);
    }
    const item = comics.get(id);
    if (!item || viewers.has(id) || !input.approvedGroups.includes(muIssueGroup(item, input.asOf))) {
      fail(`comic ${id} is not in an approved unlinked group`);
    }
    previous = id;
  }
  const lines = [];
  for (let i = 0; i < input.issueIds.length; i += 16) lines.push(`  ${input.issueIds.slice(i, i + 16).join(',')},`);
  return [
    '// Generated by scripts/marvel-comics-app-links.mjs from scripts/data/marvel-comics-app-links/mu-issues.json.',
    input.status === 'awaiting-owner-handcheck'
      ? "// Awaiting the owner's hand-check: no Marvel Unlimited issue numbers are approved yet."
      : '// Owner-approved Marvel Unlimited issue numbers; docs/DATA_PROVENANCE.md records the sample and limits.',
    ...(lines.length ? ['export const marvelComicsAppMuIssueIds = [', ...lines, '];']
      : ['export const marvelComicsAppMuIssueIds = [];']),
    '',
  ].join('\n');
}

function main(args) {
  const at = args.indexOf('--import');
  if (at >= 0) {
    const from = args[at + 1];
    if (!from) throw new Error('--import needs the path of the offline match file');
    const input = inputFrom(JSON.parse(readFileSync(from, 'utf8')));
    const problems = validateInput(input);
    if (problems.length) throw new Error(problems.join('\n'));
    writeFileSync(INPUT_PATH, serializeInput(input));
    console.log(`Wrote ${input.counts.total} links (${input.counts.exact} exact, ${input.counts.coverYearShift} one year apart).`);
    return 0;
  }
  const input = JSON.parse(readFileSync(INPUT_PATH, 'utf8'));
  const text = buildModule(input);
  const muText = buildMuModule(JSON.parse(readFileSync(MU_INPUT_PATH, 'utf8')), catalogComics(), input.links);
  if (args.includes('--check')) {
    let current;
    try { current = readFileSync(MODULE_PATH, 'utf8'); } catch { current = ''; }
    if (current.replace(/\r\n/g, '\n') !== text) {
      console.error('src/data/marvelComicsAppLinks.js is out of date. Run node scripts/marvel-comics-app-links.mjs');
      return 1;
    }
    const currentMu = readFileSync(MU_MODULE_PATH, 'utf8');
    if (currentMu.replace(/\r\n/g, '\n') !== muText) {
      console.error('src/data/marvelComicsAppMuIssues.js is out of date. Run node scripts/marvel-comics-app-links.mjs');
      return 1;
    }
    console.log('Marvel Comics app links are current.');
    return 0;
  }
  writeFileSync(MODULE_PATH, text);
  writeFileSync(MU_MODULE_PATH, muText);
  console.log('Wrote src/data/marvelComicsAppLinks.js.');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
