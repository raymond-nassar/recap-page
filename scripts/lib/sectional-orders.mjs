import assert from 'node:assert/strict';
import { sectionalGuideParts, sectionalPartName } from '../../src/js/lib/sectionalGuide.js';
import { readingOrderSubjects } from './chapter-orders.mjs';

export function sectionalPartFile(parentFile, number) {
  return parentFile.replace(/\.json$/u, `_part_${number}.json`);
}

export function buildSectionalFamily({ order, parentPayload, guide }) {
  const { id, name, layout, parts, protectedRanges, collections } = guide;
  assert(id === order.id && name === order.name && layout?.guideId === id && order.catalog === false
    && order.sectionKind === 'reading-blocks', `${id}: inconsistent sectional parent manifest`);
  assert(parentPayload.id === id && parentPayload.source === order.sourcePage
    && Array.isArray(parentPayload.items) && parentPayload.items.length === layout.positionCount
    && parentPayload.count === layout.positionCount && order.expect === layout.positionCount,
  `${id}: parent payload does not match the reviewed source span`);
  assert(Array.isArray(protectedRanges) && Array.isArray(collections), `${id}: missing reviewed source ranges`);
  const derived = sectionalGuideParts(layout, parts, {
    protectedRanges: [...protectedRanges, ...collections.map(({ first, last, title }) => ({ first, last, label: title }))],
  });
  const namesByPosition = new Map();
  for (const { first, last, title } of collections) {
    assert(Number.isInteger(first) && Number.isInteger(last) && first >= 1 && last >= first
      && last <= layout.positionCount && typeof title === 'string' && title.trim(),
    `${id}: invalid reviewed collection block`);
    for (let at = first; at <= last; at += 1) {
      assert(!namesByPosition.has(at), `${id}: overlapping reviewed collection blocks`);
      namesByPosition.set(at, title);
    }
  }
  const keys = new Set();
  return derived.map(({ number, first, last }) => {
    const id = `${order.id}-part-${number}`;
    const { issueIds, description } = parts[number - 1];
    const size = last - first + 1;
    assert(Array.isArray(issueIds) && issueIds.length === size
      && typeof description === 'string' && description.trim(), `${id}: incomplete reviewed part`);
    const items = parentPayload.items.slice(first - 1, last).map(({ collectedIn: _sourceHeading, ...item }, index) => {
      const { issueId } = item;
      assert(Number.isSafeInteger(issueId) && issueId !== 0 && !keys.has(issueId)
        && !item.placeholder && issueId === issueIds[index], `${id}: source issue vector changed at ${first + index}`);
      keys.add(issueId);
      const collection = namesByPosition.get(first + index);
      return collection ? { ...item, collectedIn: collection } : item;
    });
    const childName = sectionalPartName(name, number);
    const out = sectionalPartFile(order.out, number);
    return {
      order: {
        ...order, id, name: childName, description, out, catalog: true, timeline: null,
        sectionKind: null, coverIssueId: null, expect: size, characters: readingOrderSubjects(items),
      },
      payload: {
        id,
        name: childName,
        description,
        source: parentPayload.source,
        sourceOrigin: parentPayload.sourceOrigin,
        sourceLicense: parentPayload.sourceLicense,
        generatedAt: parentPayload.generatedAt,
        apiBase: parentPayload.apiBase,
        count: size,
        collections: new Set(items.map((item) => item.collectedIn).filter(Boolean)).size,
        placeholders: 0,
        unresolved: [],
        provenance: { parentId: order.id, first, last },
        items,
      },
    };
  });
}
