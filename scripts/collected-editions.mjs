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
import { DESTINATION_PROVIDERS, acceptedLink, destinationUrl, isCheckedDate, providerAccepted }
  from '../src/js/lib/editionDestinations.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(root, 'scripts', 'data', 'collected-editions');
const FIXTURE_DIR = path.join(DATA_DIR, 'gcd-fixtures');

export const GCD_LICENSE = Object.freeze({
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  attribution: 'Data from the Grand Comics Database (https://www.comics.org/), used under CC BY-SA 4.0. '
    + 'Minimised and reorganised for this project; cover images are never recorded.',
});

export const ASSERTION_SOURCES = Object.freeze(['cbh-ledger', 'cbh-heading', 'gcd-notes', 'gcd-stories', 'owner-curated']);
export const CHECK_TIERS = Object.freeze([
  'gcd-notes', 'gcd-story-titles', 'gcd-numbered-covers', 'gcd-original-stories', 'gcd-numbered-comparison',
  'gcd-count-only', 'gcd-unindexed',
]);
const MEDIA = new Set(['print', 'digital']);

const STORE_HOSTS = ['amazon.', 'amzn.', 'bookshop.org', 'comixology.', 'tfaw.com', 'ebay.', 'instocktrades.',
  'mycomicshop.'];
const GCD_ISSUE_KEYS = ['api_url', 'series_name', 'descriptor', 'number', 'volume', 'variant_name', 'title',
  'publication_date', 'key_date', 'page_count', 'isbn', 'notes', 'variant_of', 'series'];
const GCD_STORY_KEYS = ['type', 'title', 'feature', 'sequence_number', 'page_count', 'notes', 'script', 'pencils'];

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
  'partialSeries', 'printingOf', 'seriesCrosswalk', 'expectedCrosswalkEntries', 'gcdAliases', 'gcdSeriesUrl',
  'gcdSeriesPage', 'sourceIssues', 'gcdIssuePage', 'listSelections', 'seriesEvidence', 'sourceSeriesId',
  'coverPrefix', 'originalIssues', 'collectionSequence', 'heldReason', 'comparisonIssueId', 'comparisonCoverPrefix',
  'expectedScript', 'expectedPencils']);
const DATABASE_SOURCES = new Set(['gcd-notes', 'gcd-stories']);
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
      && ((key === 'assertedBy' && DATABASE_SOURCES.has(item)) || DATABASE_SERIES_NAME.test(item)
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
  const catalog = readJson(path.join(repoRoot, 'src', 'data', 'catalog.json'));
  const lists = {};
  const ledgers = {};
  for (const list of pilot.lists) {
    lists[list.listId] = readJson(path.join(repoRoot, list.file));
    if (list.ledger) ledgers[list.listId] = readJson(path.join(repoRoot, list.ledger));
  }
  for (const selection of gcdInputs.listSelections || []) {
    const entry = catalog.lists.find((candidate) => candidate.id === selection?.listId
      && `src/data/${candidate.file}` === selection.file);
    if (entry) lists[selection.listId] = readJson(path.join(repoRoot, 'src', 'data', entry.file));
  }
  const fixtures = {};
  const fixtureIds = new Set(pilot.editions.map((edition) => edition.gcdIssueId));
  for (const entry of Array.isArray(gcdInputs.seriesCrosswalk) ? gcdInputs.seriesCrosswalk : []) {
    for (const issue of Array.isArray(entry?.sourceIssues) ? entry.sourceIssues : []) fixtureIds.add(issue?.gcdIssueId);
  }
  for (const edition of pilot.editions) {
    for (const original of edition.gcdCheck.originalIssues || []) fixtureIds.add(original.gcdIssueId);
    if (edition.gcdCheck.comparisonIssueId) fixtureIds.add(edition.gcdCheck.comparisonIssueId);
  }
  for (const id of fixtureIds) {
    const file = path.join(dir, 'gcd-fixtures', `${id}.json`);
    if (fs.existsSync(file)) fixtures[id] = readJson(file);
  }
  const destinations = readJson(path.join(dir, 'destinations.json'));
  return { pilot, curated, gcdInputs, lists, ledgers, fixtures, catalog, destinations };
}

const PROVIDER_PERMISSIONS = new Set(['granted', 'not-received', 'not-requested']);

// The owner's confirmed addresses go through the app's own gate, so the build refuses exactly what
// the app would silently drop and a bad address is a build error rather than a missing link.
export function validateDestinations(destinations, editionIds) {
  const errors = [];
  if (!destinations || destinations.schemaVersion !== 1) return ['destinations.json: schemaVersion must be 1'];
  const providers = destinations.providers || {};
  for (const [key, provider] of Object.entries(providers)) {
    if (!DESTINATION_PROVIDERS.includes(key)) errors.push(`destinations.json: unknown provider ${key}`);
    if (!providerAccepted(provider)) errors.push(`destinations.json: ${key} needs a name, a basis and the comment recording it`);
    if (!PROVIDER_PERMISSIONS.has(provider?.providerPermission)) {
      errors.push(`destinations.json: ${key} must record whether the provider itself gave permission`);
    }
  }
  for (const [id, list] of Object.entries(destinations.destinations || {})) {
    if (!editionIds.has(id)) errors.push(`destinations.json: unknown edition ${id}`);
    if (!Array.isArray(list) || !list.length) {
      errors.push(`destinations.json: ${id} needs a list of destinations`);
      continue;
    }
    const seen = new Set();
    for (const destination of list) {
      const where = `destinations.json: ${id} ${destination?.provider}`;
      const before = errors.length;
      const extra = Object.keys(destination || {}).filter((key) => !['provider', 'url', 'checkedAt', 'confirmedBy', 'source'].includes(key));
      if (extra.length) errors.push(`${where}: only an address is recorded, not ${extra.join(', ')}`);
      if (!destinationUrl(destination?.provider, destination?.url)) errors.push(`${where}: address ${destination?.url} is not an accepted form`);
      if (destination?.confirmedBy !== 'owner') errors.push(`${where}: the owner has not confirmed it`);
      if (!isCheckedDate(destination?.checkedAt)) errors.push(`${where}: checkedAt must be a real date`);
      if (typeof destination?.source !== 'string' || !destination.source) errors.push(`${where}: source is required`);
      if (seen.has(destination?.provider)) errors.push(`${where}: one destination per provider`);
      seen.add(destination?.provider);
      if (errors.length === before && !acceptedLink(providers, destination)) errors.push(`${where}: refused by the display gate`);
    }
  }
  return errors;
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

function crosswalkEntryErrors(entry, fixtures) {
  const errors = [];
  const validRange = Number.isInteger(entry.appSeriesId) && entry.appSeriesId > 0
    && Number.isInteger(entry.from) && Number.isInteger(entry.to) && entry.from <= entry.to;
  if (!validRange) errors.push('app series and ordered integer range are required');
  const seriesUrl = /^https:\/\/www\.comics\.org\/api\/series\/([1-9]\d*)\/\?format=json$/.exec(entry.gcdSeriesUrl || '');
  if (!seriesUrl || entry.gcdSeriesPage !== `https://www.comics.org/series/${seriesUrl[1]}/`) {
    errors.push('the API series URL and series page must identify the same GCD series');
  }
  const year = seriesStartYear(entry.gcdSeries);
  const withoutArticle = (name) => typeof name === 'string' ? name.replace(/^The /, '') : null;
  if (!year || (entry.gcdAliases !== undefined && (!Array.isArray(entry.gcdAliases)
    || entry.gcdAliases.some((alias) => seriesStartYear(alias) !== year
      || withoutArticle(alias) !== withoutArticle(entry.gcdSeries))))) {
    errors.push('the GCD series and its aliases must identify the same series and start year');
  }
  if (!Array.isArray(entry.sourceIssues) || !entry.sourceIssues.length) {
    errors.push('at least one source-comic issue is required');
    return errors;
  }
  for (const source of entry.sourceIssues) {
    if (!source || !Number.isInteger(source.gcdIssueId) || source.gcdIssueId <= 0
      || !Number.isInteger(source.appNumber) || source.appNumber < entry.from || source.appNumber > entry.to
      || typeof source.gcdNumber !== 'string' || !source.gcdNumber
      || source.gcdIssuePage !== `https://www.comics.org/issue/${source.gcdIssueId}/`) {
      errors.push('each source-comic issue needs an id, an in-range app number and its GCD number');
      continue;
    }
    const url = `https://www.comics.org/api/issue/${source.gcdIssueId}/?format=json`;
    const fixture = fixtures[source.gcdIssueId];
    const name = typeof entry.gcdSeries === 'string' ? entry.gcdSeries.replace(/\(Marvel, (\d{4} series)\)$/, '($1)') : null;
    const unnumberedAnnual = source.appNumber === 1 && entry.from === 1 && entry.to === 1
      && source.gcdNumber === '[nn]' && /\bannual\b/i.test(fixture?.issue?.notes || '');
    if (source.gcdNumber !== String(source.appNumber) && !unnumberedAnnual) {
      errors.push(`source-comic issue ${source.gcdIssueId} does not match the app issue number`);
    }
    if (!fixture || fixture.url !== url || fixture.issue?.api_url !== url
      || fixture.issue.series !== entry.gcdSeriesUrl || fixture.issue.number !== source.gcdNumber
      || fixture.issue.series_name !== name) {
      errors.push(`source-comic issue ${source.gcdIssueId} does not match the mapped GCD series and issue`);
    }
  }
  return errors;
}

function entriesOverlap(a, b) {
  return a.from <= b.to && b.from <= a.to;
}

export function validateSeriesCrosswalk(crosswalk, fixtures) {
  if (!Array.isArray(crosswalk)) return ['series crosswalk must be an array'];
  const errors = [];
  for (let i = 0; i < crosswalk.length; i += 1) {
    const entry = crosswalk[i];
    if (!entry || typeof entry !== 'object') {
      errors.push(`series crosswalk entry ${i + 1} must be an object`);
      continue;
    }
    for (const error of crosswalkEntryErrors(entry, fixtures)) errors.push(`series crosswalk entry ${i + 1}: ${error}`);
    for (const previous of crosswalk.slice(0, i)) {
      if (previous?.appSeriesId === entry.appSeriesId && entriesOverlap(previous, entry)) {
        errors.push(`series crosswalk entries overlap for app series ${entry.appSeriesId}`);
      }
    }
  }
  return errors;
}

function crosswalkMatch(range, series, crosswalk, fixtures) {
  if (!Array.isArray(crosswalk)) return { kind: 'series-crosswalk-evidence', detail: 'The series crosswalk is not an array.' };
  const entries = crosswalk.filter((entry) => entry?.appSeriesId === range.seriesId);
  if (entries.some((entry) => !Number.isInteger(entry.from) || !Number.isInteger(entry.to) || entry.from > entry.to)) {
    return { kind: 'series-crosswalk-evidence', detail: 'A crosswalk range is invalid.' };
  }
  if (entries.some((entry, index) => entries.slice(index + 1).some((other) => entriesOverlap(entry, other)))) {
    return { kind: 'series-crosswalk-overlap', detail: 'Crosswalk entries for this app series overlap.' };
  }
  const entry = entries.find((candidate) => entriesOverlap(candidate, range));
  if (!entry) {
    return entries.length ? { kind: 'series-crosswalk-range', detail: 'No crosswalk entry covers this app-series range.' } : null;
  }
  if (entry.from > range.from || entry.to < range.to) {
    return { kind: 'series-crosswalk-range', detail: 'No single crosswalk entry covers the entire claimed range.' };
  }
  if (![entry.gcdSeries, ...(Array.isArray(entry.gcdAliases) ? entry.gcdAliases : [])].includes(series)) {
    return { kind: 'series-crosswalk-identity', detail: 'The named source series is not the mapped GCD series.' };
  }
  const errors = crosswalkEntryErrors(entry, fixtures);
  if (errors.length) return { kind: 'series-crosswalk-evidence', detail: errors.join('; ') };
  return { entry };
}

// Splits the record's sequences into the comic stories a check counts and the ones it leaves out,
// each exclusion with its reason, so a count that differs from the record is always explained.
// Cover sequences never reach a fixture (constraint 1), so they are not listed here.
function comicStories(fixture, edition) {
  if (edition.gcdCheck.uncountedSequences !== undefined
    && (!edition.gcdCheck.uncountedSequences || typeof edition.gcdCheck.uncountedSequences !== 'object'
      || Array.isArray(edition.gcdCheck.uncountedSequences))) {
    throw new TypeError('Uncounted sequences must be an object with a reason for each sequence.');
  }
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

function sourceSeriesAgrees(check, listName, mapping) {
  const source = /^(.*?) \(Marvel, (\d{4}) series\)$/.exec(check.gcdSeries || '');
  const app = /^(.*?) \((\d{4})(?:\s*[-)]|$)/.exec(listName || '');
  if (!source || !/^https:\/\/www\.comics\.org\/api\/series\/[1-9]\d*\/\?format=json$/.test(check.gcdSeriesUrl || '')) return false;
  if (mapping?.entry) return mapping.entry.gcdSeriesUrl === check.gcdSeriesUrl;
  return Boolean(app && source[1].toLowerCase() === app[1].toLowerCase() && source[2] === app[2]);
}

function normalStoryText(value) {
  return typeof value === 'string' ? tidy(value.replace(/\s*\(credited\)/gi, '')).toLowerCase() : '';
}

function sameStory(a, b, comparePages = true) {
  const fields = ['title', 'script', 'pencils'];
  return Boolean(a && b && fields.every((field) => normalStoryText(a[field])
    && normalStoryText(a[field]) === normalStoryText(b[field]))
    && (!comparePages || (Number.isFinite(Number(a.page_count)) && Number(a.page_count) > 0
      && Number(a.page_count) === Number(b.page_count))));
}

function originalMatches(original, number, story, check, fixtures) {
  const url = `https://www.comics.org/api/issue/${original?.gcdIssueId}/?format=json`;
  const record = fixtures[original?.gcdIssueId];
  const issue = record?.issue;
  const sourceStories = issue?.story_set?.filter((part) => part.type === 'comic story') || [];
  const name = check.gcdSeries.replace(/\(Marvel, (\d{4} series)\)$/, '($1)');
  return Number.isInteger(original?.gcdIssueId) && original.collectionSequence === story?.sequence_number
    && record?.url === url && issue?.api_url === url && issue.series === check.gcdSeriesUrl
    && issue.series_name === name && issue.number === String(number) && !issue.variant_of
    && sourceStories.length === 1 && sameStory(sourceStories[0], story);
}

function sourceStoryEvidence(edition, fixture, seriesNames, mappings, fixtures, seriesEvidence) {
  const check = edition.gcdCheck;
  const range = edition.contents.length === 1 ? edition.contents[0] : null;
  if (!range || range.portion === 'partial' || mappings.get(range)?.kind
    || !sourceSeriesAgrees(check, seriesNames[range.seriesId], mappings.get(range))) {
    return { error: 'The source series or its complete issue range does not match the list.' };
  }
  const url = `https://www.comics.org/api/issue/${edition.gcdIssueId}/?format=json`;
  if (fixture.url !== url || fixture.issue.api_url !== url) return { error: 'The book fixture does not identify this edition.' };
  const excluded = edition.gcdCheck.uncountedSequences;
  if (excluded !== undefined && (check.tier !== 'gcd-numbered-covers'
    || !excluded || typeof excluded !== 'object' || Array.isArray(excluded)
    || Object.entries(excluded).some(([sequence, reason]) =>
      typeof reason !== 'string' || !reason.trim()
      || fixture.issue.story_set.filter((story) =>
        story.type === 'comic story' && String(story.sequence_number) === sequence).length !== 1))) {
    return { error: 'The book must have exactly one indexed comic story for each issue.' };
  }
  const { stories, missing } = comicStories(fixture, edition);
  const expected = range.to - range.from + 1;
  if (stories.length !== expected || missing.length) {
    return { error: 'The book must have exactly one indexed comic story for each issue.' };
  }
  const matched = new Set();
  if (check.tier === 'gcd-numbered-covers') {
    const record = seriesEvidence[check.sourceSeriesId];
    const series = record?.series;
    const name = check.gcdSeries.replace(/\(Marvel, (\d{4} series)\)$/, '($1)');
    if (!record?.url || !record.retrievedAt || !series || series.api_url !== check.gcdSeriesUrl
      || series.api_url !== `https://www.comics.org/api/series/${check.sourceSeriesId}/?format=json`
      || `${series.name} (${series.year_began} series)` !== name
      || series.publisher !== 'https://www.comics.org/api/publisher/78/?format=json'
      || series.country !== 'us' || series.language !== 'en' || !Array.isArray(series.issue_descriptors)
      || typeof check.coverPrefix !== 'string') {
      return { error: 'The original series record does not identify the stated Marvel series.' };
    }
    for (let number = range.from; number <= range.to; number += 1) {
      if (!series.issue_descriptors.some((descriptor) => new RegExp(`^${number}(?:\\s|$)`).test(descriptor))) {
        return { error: `The original series record does not list #${number}.` };
      }
      const entries = fixture.issue.story_set;
      const indices = entries.flatMap((story, index) => story.type === 'cover reprint (on interior page)'
        && story.title === `${check.coverPrefix}${number}` ? [index] : []);
      if (indices.length !== 1) return { error: `The book does not identify exactly one interior cover for #${number}.` };
      const cover = entries[indices[0]];
      const story = entries[indices[0] + 1];
      if (story?.type !== 'comic story' || !stories.includes(story) || story.sequence_number !== cover.sequence_number + 1
        || matched.has(story.sequence_number) || !normalStoryText(story.title)
        || !normalStoryText(check.expectedScript) || normalStoryText(story.script) !== normalStoryText(check.expectedScript)
        || !normalStoryText(check.expectedPencils) || normalStoryText(story.pencils) !== normalStoryText(check.expectedPencils)
        || !Number.isFinite(Number(story.page_count)) || Number(story.page_count) <= 0) {
        return { error: `The numbered cover for #${number} is not immediately followed by one unique comic story.` };
      }
      matched.add(story.sequence_number);
    }
  } else if (check.tier === 'gcd-original-stories') {
    const originals = check.originalIssues;
    if (!Array.isArray(originals) || originals.length !== expected
      || new Set(originals.map((item) => item?.gcdIssueId)).size !== expected
      || new Set(originals.map((item) => item?.appNumber)).size !== expected) {
      return { error: 'One distinct original-comic record is required for every issue.' };
    }
    for (let number = range.from; number <= range.to; number += 1) {
      const original = originals.find((item) => item.appNumber === number);
      const story = stories.find((item) => item.sequence_number === original?.collectionSequence);
      if (!story || matched.has(story.sequence_number) || !originalMatches(original, number, story, check, fixtures)) {
        return { error: `Original #${number} does not match the book's series, story, pages and credits.` };
      }
      matched.add(story.sequence_number);
    }
  } else {
    const url = `https://www.comics.org/api/issue/${check.comparisonIssueId}/?format=json`;
    const comparison = fixtures[check.comparisonIssueId];
    const originals = check.originalIssues;
    if (!Number.isInteger(check.comparisonIssueId) || comparison?.url !== url || comparison.issue?.api_url !== url
      || comparison.issue.variant_of || typeof check.comparisonCoverPrefix !== 'string'
      || !Array.isArray(originals) || new Set(originals.map((item) => item?.appNumber)).size !== originals.length) {
      return { error: 'The numbered comparison or its original-issue resolutions are invalid.' };
    }
    const ordered = [...stories].sort((a, b) => a.sequence_number - b.sequence_number);
    const resolved = new Set();
    for (let number = range.from; number <= range.to; number += 1) {
      const entries = comparison.issue.story_set;
      const indices = entries.flatMap((story, index) => story.type === 'cover reprint (on interior page)'
        && story.title === `${check.comparisonCoverPrefix}${number}` ? [index] : []);
      if (indices.length !== 1) return { error: `The comparison does not have one numbered cover for #${number}.` };
      const cover = entries[indices[0]];
      const other = entries[indices[0] + 1];
      const story = ordered[number - range.from];
      if (other?.type !== 'comic story' || other.sequence_number !== cover.sequence_number + 1
        || !sameStory(story, other, false) || matched.has(story.sequence_number)) {
        return { error: `The numbered comparison does not match the story and credits for #${number}.` };
      }
      const resolution = originals.find((item) => item.appNumber === number);
      if (!sameStory(story, other)) {
        if (!originalMatches(resolution, number, story, check, fixtures)) {
          return { error: `The original #${number} does not resolve the page-count discrepancy.` };
        }
        resolved.add(number);
      } else if (resolution) return { error: `The original #${number} no longer resolves a discrepancy.` };
      matched.add(story.sequence_number);
    }
    if (resolved.size !== originals.length) return { error: 'A recorded original issue did not resolve a discrepancy.' };
  }
  if (matched.size !== expected) return { error: 'The book has an unmatched or repeated comic story.' };
  return { keys: Array.from({ length: expected }, (_, index) => rowKey(range.seriesId, range.from + index)) };
}

// Compares one edition with its database record. Disagreement is reported as a conflict with the
// evidence beside it and never resolved here; deciding which source is right is a person's call.
export function checkEdition(edition, fixture, seriesNames, { crosswalk = [], fixtures = {}, seriesEvidence = {} } = {}) {
  const check = edition.gcdCheck;
  const conflicts = [];
  const verified = new Set();
  const weak = new Set(Object.keys(check.weakNumbers || {}));
  const { full } = editionKeys(edition);
  const evidence = { gcdIssueId: edition.gcdIssueId, url: fixture.url };
  const { stories, excluded, missing } = comicStories(fixture, edition);
  const expected = full.size;
  const mappings = new Map();
  const blocked = new Set();
  if (['gcd-notes', 'gcd-story-titles', 'gcd-numbered-covers', 'gcd-original-stories',
    'gcd-numbered-comparison'].includes(check.tier)) {
    for (const range of edition.contents) {
      const series = range.portion === 'partial' ? check.partialSeries : check.gcdSeries;
      const mapping = crosswalkMatch(range, series, crosswalk, fixtures);
      mappings.set(range, mapping);
      if (mapping?.kind) {
        conflicts.push({ kind: mapping.kind, detail: mapping.detail, evidence });
        for (let n = range.from; n <= range.to; n += 1) blocked.add(rowKey(range.seriesId, n));
      }
    }
  }

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
      if (mappings.get(range)?.kind) continue;
      if (!notesStateRange(notes, series, span, range.portion === 'partial')) {
        conflicts.push({ kind: 'evidence-weak', detail: `The indexer notes do not state ${series} ${span}.`, evidence: { ...evidence, notes } });
        continue;
      }
      const ours = seriesStartYear(mappings.get(range)?.entry?.gcdSeries || seriesNames[range.seriesId]);
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
        if (!weak.has(number) && !blocked.has(key)) verified.add(key);
      }
    }
  } else if (['gcd-numbered-covers', 'gcd-original-stories', 'gcd-numbered-comparison'].includes(check.tier)) {
    const result = sourceStoryEvidence(edition, fixture, seriesNames, mappings, fixtures, seriesEvidence);
    if (result.error) conflicts.push({ kind: 'evidence-weak', detail: result.error, evidence });
    else for (const key of result.keys) if (!blocked.has(key)) verified.add(key);
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
  if (check.heldReason) conflicts.push({ kind: 'evidence-disputed', detail: check.heldReason, evidence });
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
    for (const original of edition.gcdCheck?.originalIssues || []) {
      if (!fixtures[original.gcdIssueId]) errors.push(`${edition.id}: no fixture for original issue ${original.gcdIssueId}`);
    }
    if (edition.gcdCheck?.comparisonIssueId && !fixtures[edition.gcdCheck.comparisonIssueId]) {
      errors.push(`${edition.id}: no fixture for comparison issue ${edition.gcdCheck.comparisonIssueId}`);
    }
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
  if (inputs.gcdInputs) {
    walk(inputs.gcdInputs, 'gcd-check-inputs.json');
    const expected = inputs.gcdInputs.expectedCrosswalkEntries;
    if (!Number.isInteger(expected) || expected < 1 || !Array.isArray(inputs.gcdInputs.seriesCrosswalk)
      || inputs.gcdInputs.seriesCrosswalk.length !== expected) {
      errors.push('required crosswalk entries are missing or unexpected');
    }
    errors.push(...validateSeriesCrosswalk(inputs.gcdInputs.seriesCrosswalk ?? [], fixtures));
    errors.push(...selectionErrors(inputs));
  }
  if (inputs.destinations) {
    walk(inputs.destinations, 'destinations.json');
    errors.push(...validateDestinations(inputs.destinations, ids));
  }
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
      ? checkEdition(edition, fixtures[edition.gcdIssueId], seriesNames,
        { crosswalk: inputs.gcdInputs?.seriesCrosswalk ?? [], fixtures, seriesEvidence: inputs.gcdInputs?.seriesEvidence ?? {} })
      : { status: 'conflict', verified: new Set(), excluded: [], conflicts: [{ kind: 'unindexed', detail: 'No fixture.' }] };
  }
  const gcdEditions = {
    ...GCD_LICENSE,
    schemaVersion: 1,
    editions: pilot.editions.map((edition) => {
      const fixture = fixtures[edition.gcdIssueId];
      const issue = fixture?.issue || {};
      const supporting = [
        ...(edition.gcdCheck.originalIssues || []).map((original) => fixtures[original.gcdIssueId]),
        ...(edition.gcdCheck.comparisonIssueId ? [fixtures[edition.gcdCheck.comparisonIssueId]] : []),
        ...(edition.gcdCheck.sourceSeriesId ? [inputs.gcdInputs?.seriesEvidence?.[edition.gcdCheck.sourceSeriesId]] : []),
      ].filter(Boolean).map(({ url, retrievedAt }) => ({ url, retrievedAt }));
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
        ...(supporting.length ? { supportingSources: supporting } : {}),
        comicStories: (issue.story_set || []).filter((story) => story.type === 'comic story')
          .map((story) => ({ sequence: story.sequence_number, title: story.title || null, pages: story.page_count })),
        ...(edition.printingOf ? { printingOf: edition.printingOf } : {}),
        assertedContents: edition.contents.filter((range) => DATABASE_SOURCES.has(range.assertedBy)),
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
      const copy = { ...edition, contents: edition.contents.filter((range) => !DATABASE_SOURCES.has(range.assertedBy)) };
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

function projectProviders(destinations) {
  return Object.fromEntries(Object.entries(destinations?.providers || {}).map(([key, provider]) => [key, {
    name: provider.name, basis: provider.basis, basisEvidence: provider.basisEvidence,
    providerPermission: provider.providerPermission,
  }]));
}

// Only addresses the display gate accepts are bundled, so an invalid input cannot ship even when the
// check is bypassed; the source note stays in the curated input.
function destinationsFor(destinations, id) {
  const providers = destinations?.providers || {};
  return (destinations?.destinations?.[id] || []).filter((entry) => acceptedLink(providers, entry))
    .map(({ provider, url, checkedAt, confirmedBy }) => ({ provider, url, checkedAt, confirmedBy }));
}

function selectionErrors(inputs) {
  const errors = [];
  const selections = inputs.gcdInputs?.listSelections ?? [];
  if (!Array.isArray(selections)) return ['list selections must be an array'];
  const seen = new Set();
  const ids = new Set(inputs.curated.editions.map((edition) => edition.id));
  for (const selection of selections) {
    const listId = selection?.listId;
    const catalog = inputs.catalog.lists.find((entry) => entry.id === listId);
    if (!catalog || selection.file !== `src/data/${catalog.file}` || inputs.lists[listId]?.id !== listId
      || !Array.isArray(inputs.lists[listId]?.items)) errors.push(`selection ${listId}: invalid list or catalog reference`);
    if (seen.has(listId)) errors.push(`selection ${listId}: duplicate list`);
    seen.add(listId);
    if (!Array.isArray(selection?.editions) || !selection.editions.length
      || new Set(selection.editions).size !== selection.editions.length
      || selection.editions.some((id) => !ids.has(id))) errors.push(`selection ${listId}: invalid or duplicate edition`);
  }
  return errors;
}

export function buildAppData(inputs, outputs = build(inputs)) {
  const errors = selectionErrors(inputs);
  if (errors.length) throw new Error(errors.join('; '));
  const editions = {};
  const relations = [];
  const checks = new Map(outputs['gcd-editions.json'].editions.map((entry) => [entry.edition, entry]));
  const project = (catalogId, list, ids, matches) => {
    for (const id of ids) {
      const evidence = checks.get(id);
      if (!evidence || evidence.check.status !== 'verified' || evidence.check.conflicts.length) continue;
      const curated = inputs.curated.editions.find((entry) => entry.id === id);
      if (!curated || !evidence.url || !evidence.retrievedAt) throw new Error(`Missing display evidence for ${id}`);
      const keys = new Set(evidence.check.verifiedComics);
      for (const item of list.items) {
        if (!matches(item) || !keys.has(rowKey(item.seriesId, item.number))) continue;
        editions[id] = { title: curated.title, destinations: destinationsFor(inputs.destinations, id) };
        relations.push({
          catalogId, editionId: id, issueId: item.issueId,
          seriesId: item.seriesId, number: String(item.number),
          status: 'verified', portion: 'full', conflicts: [],
          source: evidence.url, checkedAt: evidence.retrievedAt,
        });
      }
    }
  };
  for (const list of inputs.pilot.lists) {
    const catalogList = inputs.catalog.lists.find((entry) => `src/data/${entry.file}` === list.file);
    if (!catalogList) throw new Error(`No catalog entry for ${list.file}`);
    for (const group of list.groups) {
      project(catalogList.id, inputs.lists[list.listId], group.editions, (item) => item.collectedIn === group.label);
    }
  }
  for (const selection of inputs.gcdInputs?.listSelections || []) {
    project(selection.listId, inputs.lists[selection.listId], selection.editions, () => true);
  }
  const names = { schemaVersion: 1, providers: projectProviders(inputs.destinations), editions };
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
