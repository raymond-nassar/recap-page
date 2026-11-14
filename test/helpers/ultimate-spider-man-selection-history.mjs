import assert from 'node:assert/strict';
import path from 'node:path';
import { readUltimateSelectionBaseline } from '../../scripts/correct-ultimate-spider-man.mjs';
import {
  ultimateSelection, selectedUltimateEntry, selectedUltimatePayload,
} from '../../scripts/lib/ultimate-spider-man-selection.mjs';

let captured;
export function ultimateSelectionHistory() {
  if (!captured) {
    const baseline = readUltimateSelectionBaseline();
    const payload = selectedUltimatePayload(baseline.payload);
    const entry = selectedUltimateEntry(baseline.entry);
    const catalog = {
      ...baseline.catalog,
      description: entry.description,
      sourceOrigin: entry.sourceOrigin,
      keywords: entry.keywords,
      count: payload.count,
      collections: payload.collections,
      emptyRecordCount: payload.items.filter((item) => item.detailsRefused).length,
    };
    captured = { ...baseline, currentPayload: payload, currentEntry: entry, currentCatalog: catalog };
  }
  return captured;
}

function assertRecorded(value, original, current, label) {
  assert.ok([original, current].some((candidate) =>
    JSON.stringify(candidate) === JSON.stringify(value)),
  `Ultimate Spider-Man ${label} differs from both exact recorded selections.`);
}

export function beforeUltimateSelectionEntry(entry) {
  if (entry.id !== ultimateSelection.id) return entry;
  const baseline = ultimateSelectionHistory();
  // Discovery tags may have been set aside by an older approval before this inverse runs.
  const adapt = (value) => Object.fromEntries(Object.entries(value).filter(([key]) =>
    !['storyTypes', 'tones'].includes(key) || Object.hasOwn(entry, key)));
  assertRecorded(entry, adapt(baseline.entry), adapt(baseline.currentEntry), 'manifest');
  return adapt(baseline.entry);
}

export function beforeUltimateSelectionManifest(manifest) {
  return { ...manifest, lists: manifest.lists.map(beforeUltimateSelectionEntry) };
}

export function beforeUltimateSelectionIssueIds(ids) {
  const baseline = ultimateSelectionHistory();
  const original = baseline.payload.items.map(({ issueId }) => String(issueId));
  const current = baseline.currentPayload.items.map(({ issueId }) => String(issueId));
  assertRecorded(ids.map(String), original, current, 'issue vector');
  return original;
}

export function beforeUltimateSelectionOrders(orders) {
  return orders.map((order) => (order.id ?? order.orderId) === ultimateSelection.id
    ? { ...order, issueIds: beforeUltimateSelectionIssueIds(order.issueIds) } : order);
}

export function beforeUltimateSelectionPayloadText(file, text) {
  if (path.basename(file) !== ultimateSelection.payloadFile) return text;
  const baseline = ultimateSelectionHistory();
  assertRecorded(JSON.parse(text), baseline.payload, baseline.currentPayload, 'payload');
  return baseline.text;
}

export function beforeUltimateSelectionCatalogEntry(entry) {
  if (entry.id !== ultimateSelection.id) return entry;
  const baseline = ultimateSelectionHistory();
  const adapt = (value) => Object.hasOwn(entry, 'out') ? { ...value, out: value.file } : value;
  assertRecorded(entry, adapt(baseline.catalog), adapt(baseline.currentCatalog), 'catalog');
  return adapt(baseline.catalog);
}
