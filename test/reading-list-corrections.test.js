import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  beforeThorCorrectionIssueIds, beforeReadingListCorrectionPayloadText,
} from './helpers/reading-list-correction-history.mjs';

const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const section = 'Roy Thomas and Mark Gruenwald: The Celestial Saga';
const prior = JSON.parse(execFileSync('git', [
  'show', '52a3fdec519973c761e8b1ec2816b8daa85bbf4c:src/data/thor_best_of.json',
], { encoding: 'utf8' }));

test('Thor Celestial Saga holds the collection originals rather than unrelated introductory mentions', () => {
  const payload = read('src/data/thor_best_of.json');
  const comics = payload.items.filter(({ collectedIn }) => collectedIn === section);
  assert.deepEqual(comics.map(({ title }) => title), [
    'Thor Annual (1966) #7',
    ...Array.from({ length: 19 }, (_, index) => `Thor (1966) #${283 + index}`),
  ]);
  assert.equal(payload.count, 144);
  assert.equal(new Set(payload.items.map(({ issueId }) => issueId)).size, payload.count);
  assert.deepEqual(payload.items.filter(({ collectedIn }) => collectedIn !== section),
    prior.items.filter(({ collectedIn }) => collectedIn !== section),
    'All unrelated source positions and their metadata stay unchanged.');
});

test('reading-library provenance inventory agrees with the active payload census', () => {
  const catalog = read('src/data/catalog.json').lists;
  const manifest = read('src/data/curated-lists.json').lists;
  const files = new Set([...catalog.map(({ file }) => file), ...manifest.map(({ out }) => out)]);
  const payloads = [...files].map((file) => read(`src/data/${file}`));
  const items = payloads.flatMap((payload) => payload.items);
  const visibleItems = catalog.flatMap(({ file }) => read(`src/data/${file}`).items);
  const inventory = readFileSync(new URL('../docs/DATA_PROVENANCE.md', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('### Reading orders, pinned')[1].split('\n`description`')[0];
  const format = (value) => value.toLocaleString('en-US');
  assert.ok(inventory.includes(`The ${files.size} active files hold\n${format(items.length)} issue records covering ${format(new Set(items.map(({ issueId }) => issueId)).size)} distinct tracked identities.`),
    'The active record and identity census must match the published inventory.');
  assert.ok(inventory.includes(`The visible files hold ${format(visibleItems.length)} of those records;`));
  assert.ok(inventory.includes(`Across the ${files.size} active payloads, ${format(items.filter(({ cover }) => cover?.path).length)}\nrecords carry a cover URL and ${format(items.filter(({ creators }) => creators?.length).length)} carry creator credits.`));
});

test('Thor checklist and payload retain exactly the same corrected source order', () => {
  const markdown = readFileSync(new URL('../src/data/orders/thor-best-of.md', import.meta.url), 'utf8');
  const checklist = [...markdown.matchAll(/^- \[ \] \[([^\]]+)\]\(https:\/\/www\.marvel\.com\/comics\/issue\/(\d+)\/[^)]+\)$/gm)];
  const payload = read('src/data/thor_best_of.json');
  assert.deepEqual(checklist.map((match) => [Number(match[2]), match[1]]),
    payload.items.map(({ issueId, title }) => [issueId, title]));
  const manifest = read('src/data/curated-lists.json').lists.find(({ id }) => id === payload.id);
  const catalog = read('src/data/catalog.json').lists.find(({ id }) => id === payload.id);
  assert.equal(manifest.expect, 144);
  assert.equal(catalog.count, 144);
});

test('historical correction replay accepts only exact publications and rejects unreviewed identities', () => {
  const payload = read('src/data/thor_best_of.json');
  const ids = payload.items.map(({ issueId }) => String(issueId));
  const priorIds = prior.items.map(({ issueId }) => String(issueId));
  assert.deepEqual(beforeThorCorrectionIssueIds(ids), priorIds);
  assert.deepEqual(beforeThorCorrectionIssueIds(priorIds), priorIds);
  assert.throws(() => beforeThorCorrectionIssueIds([...ids].reverse()), /exact source correction/);
  assert.throws(() => beforeThorCorrectionIssueIds(ids.slice(1)), /exact source correction/);
  assert.deepEqual(JSON.parse(beforeReadingListCorrectionPayloadText('thor_best_of.json',
    JSON.stringify(payload))), prior);
  assert.throws(() => beforeReadingListCorrectionPayloadText('thor_best_of.json',
    JSON.stringify({ ...payload, items: payload.items.slice(1) })), /exact captured publications/);
  const captain = read('src/data/captain_marvel_ms_marvel_reading_order.json');
  const replay = JSON.parse(beforeReadingListCorrectionPayloadText(
    'captain_marvel_ms_marvel_reading_order.json', JSON.stringify(captain)));
  assert.deepEqual({ ...replay, description: captain.description }, captain);
  assert.throws(() => beforeReadingListCorrectionPayloadText(
    'captain_marvel_ms_marvel_reading_order.json', JSON.stringify({ ...captain, count: 0 })),
  /only the captured description/);
});
