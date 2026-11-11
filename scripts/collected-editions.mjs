#!/usr/bin/env node
// Builds the provider-neutral collected-edition pilot (Issue #1203) from one curated input,
// pilot.json, and two separately licensed evidence lanes. Comic Book Herald facts come from the
// committed reading lists and source ledgers, never from a fresh read of the guide. Grand Comics
// Database facts come from minimised API fixtures under CC BY-SA 4.0 and stay in their own files,
// so the MIT-licensed code and the Comic Book Herald lane never mix with share-alike data.
//
// Usage:
//   node scripts/collected-editions.mjs            offline check, exits 1 on drift or invalid data
//   node scripts/collected-editions.mjs --write    regenerate the derived files
//   node scripts/collected-editions.mjs --live <gcdIssueId>
//                                                  fetch one issue from the database's public API
//                                                  into a fixture, rate limited; never run by tests
//
// The app loads only the small generated names/policy and verified-relations modules.
// No record says a reader can read an edition anywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(root, 'scripts', 'data', 'collected-editions');
const FIXTURE_DIR = path.join(DATA_DIR, 'gcd-fixtures');

export const GCD_LICENSE = Object.freeze({
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  attribution: 'Data from the Grand Comics Database (https://www.comics.org/), used under CC BY-SA 4.0. '
    + 'Minimised and reorganised for this project; cover images are never recorded.',
});

export const ASSERTION_SOURCES = Object.freeze(['cbh-ledger', 'cbh-heading', 'gcd-notes', 'owner-curated']);
export const CHECK_TIERS = Object.freeze(['gcd-notes', 'gcd-story-titles', 'gcd-count-only', 'gcd-unindexed']);
const MEDIA = new Set(['print', 'digital']);

const STORE_HOSTS = ['amazon.', 'amzn.', 'bookshop.org', 'comixology.', 'tfaw.com', 'ebay.', 'instocktrades.',
  'mycomicshop.'];
const GCD_ISSUE_KEYS = ['api_url', 'series_name', 'descriptor', 'number', 'volume', 'variant_name', 'title',
  'publication_date', 'key_date', 'page_count', 'isbn', 'notes', 'variant_of', 'series'];
const GCD_STORY_KEYS = ['type', 'title', 'feature', 'sequence_number', 'page_count', 'notes'];

const tidy = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);
const rowKey = (seriesId, number) => `${seriesId}:${number}`;

// The database returns the issue's own cover as a story of type "cover". Constraint 1 forbids
// recording image bytes, and the cover record adds nothing to a contents check, so it is dropped
// along with every field this pilot does not read.
export function minimiseGcdIssue(record) {
  const body = typeof record.body === 'string' ? JSON.parse(record.body) : record.body;
  const issue = {};
  for (const key of GCD_ISSUE_KEYS) issue[key] = tidy(body[key] ?? null);
  issue.story_set = (body.story_set || [])
    .filter((story) => story.type !== 'cover')
    .map((story) => Object.fromEntries(GCD_STORY_KEYS.map((key) => [key, tidy(story[key] ?? null)])));
  return { ...GCD_LICENSE, url: record.url, retrievedAt: record.retrievedAt, issue };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Every value read from a database record, including a range taken from its indexer notes, lives
// in gcd-check-inputs.json under CC BY-SA 4.0. These keys, the gcd-notes source and the
// database's own series naming must never appear in an MIT-licensed file. The printing link comes
// from the database's variant record, so it is database-only too; the record id is a reference.
export const DATABASE_ONLY_KEYS = Object.freeze(['storyTitles', 'uncountedSequences', 'weakNumbers', 'gcdSeries',
  'partialSeries', 'printingOf']);
const DATABASE_SOURCE = 'gcd-notes';
const DATABASE_SERIES_NAME = /\([^()]*, \d{4} series\)/;
// Which book is a printing or variant of which is read from the database, so MIT prose and ids
// must not state it in words either.
const PRINTING_WORDING = /\bprintings?\b|second edition|variant of/i;

export function mergeGcdInputs(curated, gcdInputs) {
  return {
    ...curated,
    editions: curated.editions.map((edition) => {
      const { contents = [], printingOf, ...check } = gcdInputs.editions?.[edition.id] || {};
      return {
        ...edition,
        ...(printingOf ? { printingOf } : {}),
        contents: [...(edition.contents || []), ...contents],
        gcdCheck: { ...edition.gcdCheck, ...check },
      };
    }),
  };
}

// Lists every place an MIT-licensed value carries a database-derived fact.
export function databaseLeaks(value, where) {
  const leaks = [];
  const walk = (item, at, key) => {
    if (Array.isArray(item)) item.forEach((entry, i) => walk(entry, `${at}[${i}]`, key));
    else if (item && typeof item === 'object') {
      for (const [name, entry] of Object.entries(item)) {
        if (DATABASE_ONLY_KEYS.includes(name)) leaks.push(`${at}.${name}`);
        walk(entry, `${at}.${name}`, name);
      }
    } else if (typeof item === 'string'
      && ((key === 'assertedBy' && item === DATABASE_SOURCE) || DATABASE_SERIES_NAME.test(item)
        || PRINTING_WORDING.test(item.replace(/-/g, ' ')))) {
      leaks.push(`${at}: ${item}`);
    }
  };
  walk(value, where);
  return leaks;
}

export function loadInputs(dir = DATA_DIR, repoRoot = root) {
  const curated = readJson(path.join(dir, 'pilot.json'));
  const gcdInputs = readJson(path.join(dir, 'gcd-check-inputs.json'));
  const pilot = mergeGcdInputs(curated, gcdInputs);
  const lists = {};
  const ledgers = {};
  for (const list of pilot.lists) {
    lists[list.listId] = readJson(path.join(repoRoot, list.file));
    if (list.ledger) ledgers[list.listId] = readJson(path.join(repoRoot, list.ledger));
  }
  const fixtures = {};
  for (const edition of pilot.editions) {
    const file = path.join(dir, 'gcd-fixtures', `${edition.gcdIssueId}.json`);
    if (fs.existsSync(file)) fixtures[edition.gcdIssueId] = readJson(file);
  }
  const catalog = readJson(path.join(repoRoot, 'src', 'data', 'catalog.json'));
  return { pilot, curated, gcdInputs, lists, ledgers, fixtures, catalog };
}

function editionKeys(edition) {
  const full = new Set();
  const partial = new Set();
  for (const range of edition.contents) {
    for (let n = range.from; n <= range.to; n += 1) {
      (range.portion === 'partial' ? partial : full).add(rowKey(range.seriesId, n));
    }
  }
  return { full, partial };
}

// Recovers what the committed Comic Book Herald lists already say about collections: which rows
// sit under which heading, and, where a source ledger exists, the book the guide named and what it
// said that book collects. These are facts about the guide's grouping, read from this repository.
export function recoverCbhFacts({ pilot, lists, ledgers }) {
  return {
    schemaVersion: 1,
    source: 'Comic Book Herald reading guides, as already recorded in this repository\'s reading lists and '
      + 'source ledgers. Facts only: no prose, no images, and no affiliate or store links.',
    lists: pilot.lists.map((entry) => {
      const list = lists[entry.listId];
      const ledger = ledgers[entry.listId];
      return {
        listId: entry.listId,
        guideUrl: list.source,
        groups: entry.groups.map((group) => {
          const rows = list.items.filter((item) => item.collectedIn === group.label)
            .map((item) => ({ issueId: item.issueId, seriesId: item.seriesId, number: item.number }));
          const ids = new Set(rows.map((row) => row.issueId));
          const blocks = (ledger?.blocks || [])
            .filter((block) => block.originalIssueIds.some((id) => ids.has(id)))
            .map((block) => ({
              collection: block.collection,
              collectedContents: block.collectedContents,
              selectionKind: block.selectionKind,
              selectedIssueReferences: block.selectedIssueReferences,
            }));
          return { label: group.label, rows, ...(blocks.length ? { ledgerBlocks: blocks } : {}) };
        }),
      };
    }),
  };
}

function seriesStartYear(text) {
  const match = /\((?:[^()]*,\s*)?(\d{4})(?:\s*series|\s*-|\))/.exec(text || '');
  return match ? Number(match[1]) : null;
}

// Splits the record's sequences into the comic stories a check counts and the ones it leaves out,
// each exclusion with its reason, so a count that differs from the record is always explained.
// Cover sequences never reach a fixture (constraint 1), so they are not listed here.
function comicStories(fixture, edition) {
  const uncounted = edition.gcdCheck.uncountedSequences || {};
  const stories = [];
  const excluded = [];
  const missing = [];
  for (const story of fixture.issue.story_set) {
    const sequence = String(story.sequence_number);
    if (story.type !== 'comic story') {
      excluded.push({ sequence: story.sequence_number, title: story.title || null, reason: `Not a comic story: ${story.type}.` });
    } else if (sequence in uncounted) {
      excluded.push({ sequence: story.sequence_number, title: story.title || null, reason: uncounted[sequence] });
    } else {
      stories.push(story);
    }
  }
  for (const sequence of Object.keys(uncounted)) {
    if (!fixture.issue.story_set.some((story) => String(story.sequence_number) === sequence && story.type === 'comic story')) {
      missing.push(sequence);
    }
  }
  return { stories, excluded, missing };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A word boundary alone would match a series at the end of a longer title. Require the start of
// the notes, a collection lead-in, or a separator after a previous issue range instead.
export function notesStateRange(notes, series, span, partial) {
  const boundary = '(?:^\\s*|\\b[Cc]ollects\\s+|#[\\w./-]+(?:\\s*[,;]\\s*(?:and\\s+)?|\\s+and\\s+))';
  const material = partial ? 'material from ' : '(?!material from )';
  return new RegExp(`${boundary}${material}${escapeRegExp(series)} ${escapeRegExp(span)}(?![\\w/-]|\\.\\w)`).test(notes);
}

// Compares one edition with its database record. Disagreement is reported as a conflict with the
// evidence beside it and never resolved here; deciding which source is right is a person's call.
export function checkEdition(edition, fixture, seriesNames) {
  const check = edition.gcdCheck;
  const conflicts = [];
  const verified = new Set();
  const weak = new Set(Object.keys(check.weakNumbers || {}));
  const { full } = editionKeys(edition);
  const evidence = { gcdIssueId: edition.gcdIssueId, url: fixture.url };
  const { stories, excluded, missing } = comicStories(fixture, edition);
  const expected = full.size;

  if (fixture.issue.variant_of) {
    conflicts.push({ kind: 'variant-printing', detail: `The database records this book as a variant of ${fixture.issue.variant_of}.`, evidence });
  }
  for (const sequence of missing) {
    conflicts.push({
      kind: 'exclusion-missing',
      detail: `Sequence ${sequence} is listed as extra material, but the record has no comic story with that sequence.`,
      evidence,
    });
  }
  if (check.tier === 'gcd-unindexed') {
    const indexed = stories.length > 0 || Boolean(fixture.issue.notes);
    conflicts.push({
      kind: indexed ? 'evidence-drift' : 'unindexed',
      detail: indexed ? 'Marked unindexed, but the fixture now holds contents; re-curate this edition.'
        : 'The database has no contents indexed for this book, so its range is unverified.',
      evidence,
    });
  } else if (check.tier === 'gcd-notes') {
    const notes = fixture.issue.notes || '';
    for (const range of edition.contents) {
      const series = range.portion === 'partial' ? check.partialSeries : check.gcdSeries;
      const span = range.from === range.to ? `#${range.from}` : `#${range.from}-${range.to}`;
      if (!notesStateRange(notes, series, span, range.portion === 'partial')) {
        conflicts.push({ kind: 'evidence-weak', detail: `The indexer notes do not state ${series} ${span}.`, evidence: { ...evidence, notes } });
        continue;
      }
      const ours = seriesStartYear(seriesNames[range.seriesId]);
      const theirs = seriesStartYear(series);
      if (ours && theirs && ours !== theirs) {
        conflicts.push({ kind: 'series-year', detail: `The list dates this series from ${ours}; the database from ${theirs}.`, evidence });
      }
      if (range.portion === 'partial') {
        conflicts.push({ kind: 'material-from', detail: `Holds only material from ${series} ${span}.`, evidence });
      } else {
        for (let n = range.from; n <= range.to; n += 1) verified.add(rowKey(range.seriesId, n));
      }
    }
  } else if (check.tier === 'gcd-story-titles') {
    const titles = stories.map((story) => story.title);
    const wanted = Object.values(check.storyTitles);
    const missing = wanted.filter((title) => !titles.includes(title));
    if (stories.length !== expected || missing.length) {
      conflicts.push({
        kind: 'evidence-weak',
        detail: `Expected ${expected} comic stories titled as curated; the database lists ${stories.length}`
          + (missing.length ? ` and lacks ${missing.join('; ')}.` : '.'),
        evidence: { ...evidence, titles },
      });
    } else {
      const seriesId = edition.contents[0].seriesId;
      for (const number of Object.keys(check.storyTitles)) {
        const key = number.includes(':') ? number : rowKey(seriesId, number);
        if (!weak.has(number)) verified.add(key);
      }
    }
  } else if (check.tier === 'gcd-count-only') {
    // A count that happens to match is consistent, not proof of which comics a book holds, so this
    // branch never adds a verified comic.
    if (check.expectedComicStories !== expected || stories.length !== expected) {
      conflicts.push({
        kind: 'evidence-weak',
        detail: `The curated contents name ${expected} comics; the database lists ${stories.length} comic stories`
          + ` after ${excluded.length} recorded exclusions. The count alone cannot say which is right.`,
        evidence: { ...evidence, sequences: stories.map((story) => story.sequence_number) },
      });
    }
  }
  for (const [number, reason] of Object.entries(check.weakNumbers || {})) {
    conflicts.push({ kind: 'evidence-weak', detail: `#${number}: ${reason}`, evidence });
  }
  // An edition with any conflict is never labelled verified, even when some of its comics are.
  const allVerified = verified.size > 0 && [...full].every((key) => verified.has(key));
  let status = 'consistent';
  if (verified.size && !conflicts.length) status = allVerified ? 'verified' : 'partly-verified';
  else if (verified.size) status = 'verified-with-conflicts';
  else if (conflicts.length) status = 'conflict';
  return { status, verified, conflicts, excluded };
}

function sortedKeys(set) {
  return [...set].sort((a, b) => {
    const [sa, na] = a.split(':').map(Number);
    const [sb, nb] = b.split(':').map(Number);
    return sa - sb || na - nb;
  });
}

// Coverage is set arithmetic over row keys (series id and issue number from the list's own rows).
// Rows are claimed when any edition's curated contents hold them, and verified only when a
// verifying database check confirms that exact comic.
export function buildCoverage({ pilot, lists, ledgers }, checks) {
  const byId = Object.fromEntries(pilot.editions.map((edition) => [edition.id, edition]));
  return pilot.lists.map((entry) => {
    const list = lists[entry.listId];
    const findings = [];
    const claimed = new Set();
    const verified = new Set();
    const conflicted = new Set();
    const partial = new Set();
    const bySource = Object.fromEntries(ASSERTION_SOURCES.map((source) => [source, new Set()]));
    let groupedRows = 0;
    for (const group of entry.groups) {
      const rows = list.items.filter((item) => item.collectedIn === group.label);
      const keys = new Set(rows.map((row) => rowKey(row.seriesId, row.number)));
      groupedRows += rows.length;
      if (group.headingIsReadingBlock) {
        findings.push({ kind: 'heading-not-edition', group: group.label, detail: 'The guide heading names a reading block, not one book.' });
      }
      const held = [];
      for (const id of group.editions) {
        const edition = byId[id];
        const { full, partial: part } = editionKeys(edition);
        held.push({ id, full });
        for (const range of edition.contents) {
          for (let n = range.from; n <= range.to; n += 1) {
            const key = rowKey(range.seriesId, n);
            if (keys.has(key) && range.portion !== 'partial') bySource[range.assertedBy].add(key);
          }
        }
        for (const key of keys) {
          if (full.has(key)) claimed.add(key);
          if (part.has(key)) partial.add(key);
          if (checks[id].verified.has(key)) (checks[id].conflicts.length ? conflicted : verified).add(key);
        }
        const outside = sortedKeys(new Set([...full].filter((key) => !keys.has(key))));
        if (outside.length) {
          const ledgerCut = (ledgers[entry.listId]?.blocks || []).some((block) => block.selectionKind === 'explicit-cut'
            && block.collection === edition.title);
          findings.push({
            kind: ledgerCut ? 'partial-selection' : 'edition-wider-than-group',
            group: group.label,
            edition: id,
            detail: `The book also holds ${outside.join(', ')}, which this group does not list.`,
          });
        }
      }
      const uncovered = sortedKeys(new Set([...keys].filter((key) => !held.some((h) => h.full.has(key)) && !partial.has(key))));
      if (uncovered.length) {
        findings.push({ kind: 'group-wider-than-edition', group: group.label, detail: `No curated book holds ${uncovered.join(', ')}.` });
      }
      // A book with no contents in this view says nothing about how the group divides, so pairing
      // it would call two overlapping books a split. The MIT view hits this when a book's only
      // range came from the database and was left out.
      const pairable = held.filter((h) => h.full.size > 0);
      for (let i = 0; i < pairable.length; i += 1) {
        for (let j = i + 1; j < pairable.length; j += 1) {
          const a = pairable[i];
          const b = pairable[j];
          const shared = [...a.full].filter((key) => b.full.has(key) && keys.has(key));
          const printing = byId[b.id].printingOf === a.id || byId[a.id].printingOf === b.id;
          if (shared.length) {
            findings.push({
              kind: printing ? 'variant-printing' : 'overlap',
              group: group.label,
              detail: `${a.id} and ${b.id} both hold ${shared.length} of this group's comics.`,
            });
          } else if (!printing) {
            findings.push({ kind: 'group-spans-editions', group: group.label, detail: `${a.id} and ${b.id} split this group.` });
          }
        }
      }
    }
    return {
      listId: entry.listId,
      rows: list.items.length,
      groupedRows,
      claimedRows: claimed.size,
      verifiedRows: verified.size,
      // Confirmed by a book whose record also carries a conflict, so never counted as verified.
      verifiedWithConflictsRows: [...conflicted].filter((key) => !verified.has(key)).length,
      partialRows: partial.size,
      claimedBySource: Object.fromEntries(ASSERTION_SOURCES.map((source) => [source, bySource[source].size])),
      findings,
    };
  });
}

// Every string in every output is checked, so a store link cannot ride in through a ledger or a
// fixture either. The owner ruled on 2026-11-10 that Comic Book Herald's affiliate links are not
// used anywhere in this project.
export function validate(inputs, outputs) {
  const errors = [];
  const { pilot, lists, fixtures } = inputs;
  const ids = new Set();
  for (const edition of pilot.editions) {
    if (ids.has(edition.id)) errors.push(`duplicate edition id ${edition.id}`);
    ids.add(edition.id);
    if (!MEDIA.has(edition.medium)) errors.push(`${edition.id}: medium must be print or digital`);
    if (!edition.format || !edition.title) errors.push(`${edition.id}: title and format are required`);
    if (!CHECK_TIERS.includes(edition.gcdCheck?.tier)) errors.push(`${edition.id}: unknown check tier`);
    if (!fixtures[edition.gcdIssueId]) errors.push(`${edition.id}: no fixture for database issue ${edition.gcdIssueId}`);
    if (!edition.contents?.length) errors.push(`${edition.id}: contents are required`);
    for (const range of edition.contents || []) {
      if (!ASSERTION_SOURCES.includes(range.assertedBy)) errors.push(`${edition.id}: unknown assertedBy ${range.assertedBy}`);
      if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from > range.to) {
        errors.push(`${edition.id}: bad range ${range.from}-${range.to}`);
      }
      if (!range.basis) errors.push(`${edition.id}: every range needs a basis`);
    }
  }
  for (const edition of pilot.editions) {
    if (edition.printingOf && !ids.has(edition.printingOf)) errors.push(`${edition.id}: printingOf does not resolve`);
  }
  for (const entry of pilot.lists) {
    const list = lists[entry.listId];
    if (!/^https:\/\/www\.comicbookherald\.com\//.test(list.source || '')) errors.push(`${entry.listId}: not a Comic Book Herald list`);
    for (const group of entry.groups) {
      if (!list.items.some((item) => item.collectedIn === group.label)) errors.push(`${entry.listId}: no rows labelled ${group.label}`);
      for (const id of group.editions) if (!ids.has(id)) errors.push(`${entry.listId}: unknown edition ${id}`);
    }
  }
  const walk = (value, where) => {
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${where}[${i}]`));
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (key === 'cover') errors.push(`${where}: cover data is never recorded`);
        walk(item, `${where}.${key}`);
      }
    } else if (typeof value === 'string' && /https?:\/\//.test(value)) {
      for (const url of value.match(/https?:\/\/[^\s"')]+/g)) {
        const host = new URL(url).hostname;
        if (STORE_HOSTS.some((store) => host.includes(store)) || /[?&](tag|ref)=/.test(url)) {
          errors.push(`${where}: store or affiliate link ${url}`);
        }
      }
    }
  };
  for (const [name, value] of Object.entries(outputs)) walk(value, name);
  for (const [id, fixture] of Object.entries(fixtures)) walk(fixture, `gcd-fixtures/${id}.json`);
  walk(pilot, 'pilot.json');
  if (inputs.gcdInputs) walk(inputs.gcdInputs, 'gcd-check-inputs.json');
  const mit = [['pilot.json', inputs.curated], ['editions.json', outputs['editions.json']],
    ['cbh-edition-facts.json', outputs['cbh-edition-facts.json']]];
  for (const [name, value] of mit) {
    for (const leak of databaseLeaks(value, name)) errors.push(`database-derived fact in an MIT-licensed file: ${leak}`);
  }
  return errors;
}

export function build(inputs) {
  const { pilot, lists, fixtures } = inputs;
  const seriesNames = {};
  for (const list of Object.values(lists)) for (const item of list.items) seriesNames[item.seriesId] = item.seriesName;
  const checks = {};
  for (const edition of pilot.editions) {
    checks[edition.id] = fixtures[edition.gcdIssueId]
      ? checkEdition(edition, fixtures[edition.gcdIssueId], seriesNames)
      : { status: 'conflict', verified: new Set(), excluded: [], conflicts: [{ kind: 'unindexed', detail: 'No fixture.' }] };
  }
  const gcdEditions = {
    ...GCD_LICENSE,
    schemaVersion: 1,
    editions: pilot.editions.map((edition) => {
      const fixture = fixtures[edition.gcdIssueId];
      const issue = fixture?.issue || {};
      return {
        edition: edition.id,
        gcdIssueId: edition.gcdIssueId,
        url: fixture?.url ?? null,
        retrievedAt: fixture?.retrievedAt ?? null,
        seriesName: issue.series_name ?? null,
        number: issue.number ?? null,
        descriptor: issue.descriptor ?? null,
        isbn: issue.isbn || null,
        publicationDate: issue.publication_date ?? null,
        pageCount: issue.page_count ?? null,
        variantOf: issue.variant_of ?? null,
        notes: issue.notes || null,
        comicStories: (issue.story_set || []).filter((story) => story.type === 'comic story')
          .map((story) => ({ sequence: story.sequence_number, title: story.title || null, pages: story.page_count })),
        ...(edition.printingOf ? { printingOf: edition.printingOf } : {}),
        assertedContents: edition.contents.filter((range) => range.assertedBy === DATABASE_SOURCE),
        check: {
          tier: edition.gcdCheck.tier,
          status: checks[edition.id].status,
          verifiedComics: sortedKeys(checks[edition.id].verified),
          excludedSequences: checks[edition.id].excluded || [],
          conflicts: checks[edition.id].conflicts,
        },
      };
    }),
  };
  const coverage = buildCoverage(inputs, checks);
  // The MIT-licensed view is built from curated contents alone, with nothing verified: every
  // database range, printing link, check status and verified count stays in gcd-editions.json.
  const curated = {
    ...pilot,
    editions: pilot.editions.map((edition) => {
      const copy = { ...edition, contents: edition.contents.filter((range) => range.assertedBy !== DATABASE_SOURCE) };
      delete copy.printingOf;
      return copy;
    }),
  };
  const unchecked = Object.fromEntries(pilot.editions.map((edition) => [edition.id, { verified: new Set() }]));
  const curatedCoverage = buildCoverage({ ...inputs, pilot: curated }, unchecked).map((list) => {
    const copy = { ...list };
    delete copy.verifiedRows;
    delete copy.verifiedWithConflictsRows;
    return copy;
  });
  gcdEditions.coverage = coverage;
  const editions = {
    schemaVersion: 1,
    note: 'Provider-neutral collected-edition pilot. A record says what a book holds, never where a reader '
      + 'can read it. Every database fact, range, check and verified count lives in gcd-editions.json under '
      + 'its own license, so the coverage here counts curated contents only.',
    editions: curated.editions.map((edition) => ({
      id: edition.id,
      title: edition.title,
      format: edition.format,
      medium: edition.medium,
      identifiers: { gcdIssueId: edition.gcdIssueId },
      contents: edition.contents.map((range) => ({
        seriesId: range.seriesId,
        from: range.from,
        to: range.to,
        ...(range.portion ? { portion: range.portion } : {}),
        assertedBy: range.assertedBy,
      })),
    })),
    lists: curatedCoverage,
  };
  return { 'cbh-edition-facts.json': recoverCbhFacts(inputs), 'gcd-editions.json': gcdEditions, 'editions.json': editions };
}

export const render = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function buildAppData(inputs, outputs = build(inputs)) {
  const editions = {};
  const relations = [];
  const checks = new Map(outputs['gcd-editions.json'].editions.map((entry) => [entry.edition, entry]));
  for (const list of inputs.pilot.lists) {
    const catalogList = inputs.catalog.lists.find((entry) => `src/data/${entry.file}` === list.file);
    if (!catalogList) throw new Error(`No catalog entry for ${list.file}`);
    for (const group of list.groups) {
      for (const id of group.editions) {
        const evidence = checks.get(id);
        if (evidence.check.status !== 'verified' || evidence.check.conflicts.length) continue;
        const curated = inputs.curated.editions.find((entry) => entry.id === id);
        if (!curated || !evidence.url || !evidence.retrievedAt) throw new Error(`Missing display evidence for ${id}`);
        const keys = new Set(evidence.check.verifiedComics);
        for (const item of inputs.lists[list.listId].items) {
          if (item.collectedIn !== group.label || !keys.has(rowKey(item.seriesId, item.number))) continue;
          editions[id] = { title: curated.title, destinations: [] };
          relations.push({
            catalogId: catalogList.id, editionId: id, issueId: item.issueId,
            seriesId: item.seriesId, number: String(item.number),
            status: 'verified', portion: 'full', conflicts: [],
            source: evidence.url, checkedAt: evidence.retrievedAt,
          });
        }
      }
    }
  }
  const names = { schemaVersion: 1, providers: { hoopla: { name: 'Hoopla', permission: 'pending' } }, editions };
  const evidence = {
    ...GCD_LICENSE, schemaVersion: 1,
    modification: 'Adapted into exact issue-to-edition relations for this pilot. Edition names are curated separately.',
    relations,
  };
  const leaks = databaseLeaks(names, 'editionCatalog');
  if (leaks.length) throw new Error(`Database facts in MIT display data: ${leaks.join(', ')}`);
  return {
    'collectedEditionCatalog.js': `// Generated by scripts/collected-editions.mjs. Curated names and policy, MIT.\nexport const editionCatalog = ${JSON.stringify(names, null, 2)};\n`,
    'collectedEditionEvidence.js': `// SPDX-License-Identifier: CC-BY-SA-4.0\n// Generated by scripts/collected-editions.mjs. GCD attribution and source details below.\nexport const editionEvidence = ${JSON.stringify(evidence, null, 2)};\n`,
  };
}

export function run({ write = false, dir = DATA_DIR, repoRoot = root, appDir = path.join(root, 'src', 'data'), log = console.log } = {}) {
  const inputs = loadInputs(dir, repoRoot);
  const outputs = build(inputs);
  const errors = validate(inputs, outputs);
  for (const [name, value] of Object.entries(outputs)) {
    const file = path.join(dir, name);
    const text = render(value);
    if (write) fs.writeFileSync(file, text);
    else if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) errors.push(`${name} is stale; run with --write`);
  }
  for (const [name, text] of Object.entries(buildAppData(inputs, outputs))) {
    const file = path.join(appDir, name);
    if (write) {
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(file, text);
    } else if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) errors.push(`${name} is stale; run with --write`);
  }
  for (const list of outputs['gcd-editions.json'].coverage) {
    log(`${list.listId}: ${list.groupedRows}/${list.rows} rows grouped, ${list.claimedRows} claimed, `
      + `${list.verifiedRows} verified, ${list.verifiedWithConflictsRows} verified with conflicts, `
      + `${list.partialRows} partial, ${list.findings.length} findings`);
  }
  for (const error of errors) log(`ERROR ${error}`);
  return errors;
}

// One call at a time, at most 25 in any rolling hour, Retry-After honoured. The ledger
// lives outside the repository so a clone cannot reset it.
export async function fetchLive(gcdIssueId, { fetchImpl = fetch, now = Date.now, ledgerFile = path.join(os.tmpdir(), 'recap-gcd-ledger.json') } = {}) {
  if (!/^\d+$/.test(String(gcdIssueId))) throw new Error('issue id must be numeric');
  const hour = 60 * 60 * 1000;
  const ledger = fs.existsSync(ledgerFile) ? readJson(ledgerFile) : { calls: [], notBefore: 0 };
  const recent = ledger.calls.filter((t) => now() - t < hour);
  if (recent.length >= 25) throw new Error('25 calls in the last hour; try later');
  if (now() < ledger.notBefore) throw new Error(`server asked to wait until ${new Date(ledger.notBefore).toISOString()}`);
  const url = `https://www.comics.org/api/issue/${gcdIssueId}/?format=json`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'recap-page collected-edition pilot' } });
  recent.push(now());
  const retry = Number(response.headers.get('retry-after'));
  fs.writeFileSync(ledgerFile, JSON.stringify({ calls: recent, notBefore: retry ? now() + retry * 1000 : 0 }));
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  const fixture = minimiseGcdIssue({ url, retrievedAt: new Date(now()).toISOString(), body: await response.text() });
  fs.writeFileSync(path.join(FIXTURE_DIR, `${gcdIssueId}.json`), render(fixture));
  return fixture;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  if (args[0] === '--live') {
    fetchLive(args[1]).then(() => console.log(`fixture ${args[1]} written`), (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  } else {
    process.exitCode = run({ write: args.includes('--write') }).length ? 1 : 0;
  }
}
