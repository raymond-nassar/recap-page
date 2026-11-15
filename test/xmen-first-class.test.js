import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  beforeXmenFirstClassIssueIds, beforeXmenFirstClassPayloadText,
} from './helpers/xmen-first-class-history.mjs';

const base = '52a3fdec519973c761e8b1ec2816b8daa85bbf4c';
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const prior = (file) => JSON.parse(execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' }));
const coreFile = 'src/data/xmen_claremont.json';
const expandedFile = 'src/data/xmen_claremont_complete.json';
const manifestFile = 'src/data/curated-lists.json';
const catalogFile = 'src/data/catalog.json';

test('the core starts with the three requested First Class series and preserves the later reading', () => {
  const core = read(coreFile);
  const old = prior(coreFile);
  const expanded = prior(expandedFile);
  const firstClass = [1132, 2432, 6799]
    .flatMap((seriesId) => expanded.items.filter((item) => item.seriesId === seriesId));
  assert.deepEqual(firstClass.map(({ number }) => number), [
    ...Array.from({ length: 8 }, (_, i) => String(i + 1)),
    ...Array.from({ length: 16 }, (_, i) => String(i + 1)),
    ...Array.from({ length: 4 }, (_, i) => String(i + 1)),
  ]);
  assert.equal(old.items[72].issueId, 8797);
  assert.deepEqual(core.items, [...firstClass, ...old.items.slice(72)]);
  assert.equal(core.count, 274);
  assert.deepEqual(core.unresolved, old.unresolved.map((entry) => ({ ...entry, index: entry.index - 44 })));
  const checklist = readFileSync('src/data/orders/xmen-claremont.md', 'utf8');
  const linkedIds = [...checklist.matchAll(/^- \[ \] \[.*?\]\(https:\/\/www\.marvel\.com\/comics\/issue\/(\d+)\//gm)]
    .map((match) => Number(match[1]));
  assert.deepEqual(linkedIds, core.items.filter((item) => !item.placeholder).map(({ issueId }) => issueId));
});

test('expanded comics remain unchanged and both cards match their payloads', () => {
  const expanded = read(expandedFile);
  const old = prior(expandedFile);
  assert.deepEqual({ ...expanded, description: old.description }, old);
  const manifest = read(manifestFile);
  const catalog = read(catalogFile);
  for (const id of ['xmen-claremont', 'xmen-claremont-complete']) {
    const entry = manifest.lists.find((item) => item.id === id);
    const card = catalog.lists.find((item) => item.id === id);
    const payload = id === expanded.id ? expanded : read(coreFile);
    assert.equal(entry.description, payload.description);
    assert.equal(card.description, payload.description);
    assert.equal(card.count, payload.items.length);
  }
  assert.doesNotMatch(expanded.description, /to the core reading order/i);
});

test('historical replay rejects unrelated issue and metadata changes', () => {
  const core = read(coreFile);
  const ids = core.items.filter((item) => item.issueId != null).map((item) => String(item.issueId));
  assert.throws(() => beforeXmenFirstClassIssueIds(ids.slice(1)), /approved replacement/);
  core.items[40].title = 'Unrelated change';
  assert.throws(() => beforeXmenFirstClassPayloadText(coreFile, JSON.stringify(core)), /exact original/);
  const expanded = read(expandedFile);
  expanded.items[0].title = 'Unrelated change';
  assert.throws(() => beforeXmenFirstClassPayloadText(expandedFile, JSON.stringify(expanded)), /only its approved description/);
});
