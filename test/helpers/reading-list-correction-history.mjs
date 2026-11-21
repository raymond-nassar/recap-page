import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { READING_ORDER_REVISIONS } from '../../src/js/lib/readingOrderRevisions.js';
import {
  beforeUltimateIntroCatalogEntry, beforeUltimateIntroEntry, beforeUltimateIntroIssueIds,
  beforeUltimateIntroPayloadText,
} from './ultimate-marvel-intro-history.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
export const thorCorrection = read('scripts/data/thor-celestial-correction.json');
const captain = read('scripts/data/captain-marvel-description-correction.json');
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const show = (file, commit = thorCorrection.priorCommit) => execFileSync('git', [
  'show', `${commit}:${file}`,
], { cwd: root, encoding: 'utf8', maxBuffer: 32 << 20 }).replace(/\r\n/g, '\n');
let original;
function baseline() {
  if (!original) {
    const text = show('src/data/thor_best_of.json');
    const payload = JSON.parse(text);
    assert.equal(digest(payload), thorCorrection.priorPayloadSha256);
    assert.equal(digest(payload.items), thorCorrection.priorItemsSha256);
    original = { text, payload, catalog: JSON.parse(show('src/data/catalog.json')).lists
      .find(({ id }) => id === thorCorrection.id) };
  }
  return original;
}
export const thorCorrectionItemDelta = thorCorrection.replacements.length - thorCorrection.removed.length;

// The complete Hickman saga kept its 219 issues and changed only their order and its source
// fields, so relationship reviews approved before the interleave replay against the list as it
// was published at main e807e713.
const hickman = {
  id: 'hickman-full',
  file: 'hickman_full.json',
  priorCommit: 'e807e713b36b1e9b6d26d6fa2a0d2291943d9e18',
  priorPayloadSha256: '225ced1710bfafd46e584fcfd46b2cee1f6b37c39e66da6a9d025ae62d046e1a',
  correctedPayloadSha256: 'b0fa9aea7c713a4a412dd8c0575249f06c456b611e006c80c423008a8f8bb029',
  corrected: {
    sourceFile: 'hickman-full.md',
    sourcePage: 'https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/secret-wars-reading-order/#secretwars6',
    sourceOrigin: "Issue set vendored from emreparker/marvel-comics; Avengers and New Avengers order from Comic Book Herald's Secret Wars guide",
  },
};
const hickmanRevision = READING_ORDER_REVISIONS.find(({ catalogId }) => catalogId === hickman.id);
const hickmanSourceFields = ['sourceUrl', 'sourceFile', 'sourcePage', 'sourceOrigin'];
let hickmanOriginal;
function hickmanBaseline() {
  if (!hickmanOriginal) {
    const text = show(`src/data/${hickman.file}`, hickman.priorCommit);
    const payload = JSON.parse(text);
    assert.equal(digest(payload), hickman.priorPayloadSha256);
    const ids = payload.items.map(({ issueId }) => String(issueId));
    assert.deepEqual(ids, hickmanRevision.previousOrders[0].map(String));
    const lists = (file) => JSON.parse(show(file, hickman.priorCommit)).lists;
    hickmanOriginal = { text, ids,
      entry: lists('src/data/curated-lists.json').find(({ id }) => id === hickman.id),
      catalog: lists('src/data/catalog.json').find(({ id }) => id === hickman.id) };
  }
  return hickmanOriginal;
}

export function beforeHickmanInterleaveIssueIds(ids) {
  const { ids: before } = hickmanBaseline();
  const after = hickmanRevision.revisedOrder.map(String);
  assert.ok([before, after].some((vector) => JSON.stringify(vector) === JSON.stringify(ids.map(String))),
    'Hickman history accepts only the captured prior order or the exact interleave.');
  return [...before];
}

function beforeHickmanInterleaveEntry(entry) {
  if (entry.id !== hickman.id) return entry;
  const { entry: prior } = hickmanBaseline();
  const pick = (value) => JSON.stringify(Object.fromEntries(hickmanSourceFields
    .filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]])));
  assert.ok([pick(prior), pick(hickman.corrected)].includes(pick(entry)),
    'Unrecorded Hickman source fields.');
  const restored = Object.fromEntries(Object.keys(prior)
    .filter((key) => hickmanSourceFields.includes(key) || Object.hasOwn(entry, key))
    .map((key) => [key, hickmanSourceFields.includes(key) ? prior[key] : entry[key]]));
  for (const [key, value] of Object.entries(entry)) {
    if (!hickmanSourceFields.includes(key) && !Object.hasOwn(restored, key)) restored[key] = value;
  }
  return restored;
}

export function beforeThorCorrectionIssueIds(ids) {
  const before = baseline().payload.items.map(({ issueId }) => String(issueId));
  const after = [...before];
  after.splice(thorCorrection.removed[0].sourcePosition - 1, thorCorrection.removed.length,
    ...thorCorrection.replacements.map(({ issueId }) => String(issueId)));
  assert.ok([before, after].some((vector) => JSON.stringify(vector) === JSON.stringify(ids.map(String))),
    'Thor history accepts only the captured prior vector or the exact source correction.');
  return before;
}

export function beforeReadingListCorrectionEntry(entry) {
  entry = beforeUltimateIntroEntry(entry);
  entry = beforeHickmanInterleaveEntry(entry);
  if (entry.id !== thorCorrection.id) return entry;
  assert.ok([131, 144].includes(entry.expect), 'Unrecorded Thor expected count.');
  return { ...entry, expect: 131 };
}

export function beforeReadingListCorrectionOrders(orders) {
  return orders.map((order) => {
    const id = order.id ?? order.orderId;
    if (id === 'ultimate-marvel-intro') return { ...order, issueIds: beforeUltimateIntroIssueIds(order.issueIds) };
    if (id === thorCorrection.id) return { ...order, issueIds: beforeThorCorrectionIssueIds(order.issueIds) };
    if (id === hickman.id) return { ...order, issueIds: beforeHickmanInterleaveIssueIds(order.issueIds) };
    return order;
  });
}

export function beforeReadingListCorrectionCatalogEntry(entry) {
  entry = beforeUltimateIntroCatalogEntry(entry);
  if (entry.id === hickman.id) {
    const { catalog } = hickmanBaseline();
    assert.equal(entry.count, catalog.count, 'The Hickman interleave keeps every issue.');
    assert.ok([catalog.source, hickman.corrected.sourcePage].includes(entry.source), 'Unrecorded Hickman source.');
    return { ...entry, source: catalog.source, sourceOrigin: catalog.sourceOrigin, updatedAt: catalog.updatedAt };
  }
  if (entry.id !== thorCorrection.id) return entry;
  assert.ok([131, 144].includes(entry.count), 'Unrecorded Thor catalog count.');
  return { ...entry, count: 131, updatedAt: baseline().catalog.updatedAt };
}

export function beforeReadingListCorrectionPayloadText(file, text) {
  text = beforeUltimateIntroPayloadText(path.basename(file), text);
  if (path.basename(file) === 'thor_best_of.json') {
    const payload = JSON.parse(text);
    assert.ok([thorCorrection.priorPayloadSha256, thorCorrection.correctedPayloadSha256].includes(digest(payload)),
      'Thor payload differs from both exact captured publications.');
    return baseline().text;
  }
  if (path.basename(file) === hickman.file) {
    assert.ok([hickman.priorPayloadSha256, hickman.correctedPayloadSha256].includes(digest(JSON.parse(text))),
      'Hickman payload differs from both exact captured publications.');
    return hickmanBaseline().text;
  }
  if (path.basename(file) === captain.file) {
    const payload = JSON.parse(text);
    assert.ok([captain.priorPayloadSha256, captain.correctedPayloadSha256].includes(digest(payload)),
      'Captain Marvel correction must change only the captured description.');
    return show(`src/data/${captain.file}`, captain.priorCommit);
  }
  return text;
}
