import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { deriveSectionalPartMappings } from '../scripts/lib/cbh-sectional-parts.mjs';
import { mappingDigestFor, packetDigestFor, validateMappingDigest } from '../scripts/lib/cbh-inventory.mjs';
import { buildSectionalFamily } from '../scripts/lib/sectional-orders.mjs';
import { validateVendoredCatalog } from '../scripts/vendor-orders.mjs';
import { parseManifest } from '../src/js/lib/curated.js';

test('derived mappings bind the exact parent and range without claiming separate source sections', async () => {
  const template = JSON.parse(await readFile('scripts/data/cbh-packets/thanos-reading-order.json', 'utf8'));
  const rows = Array.from({ length: 36 }, (_, index) => {
    const sourcePosition = index + 1;
    return {
      ...template.rows[0], sourcePosition, issueNumber: String(sourcePosition),
      sourceIssueReference: `A Comic #${sourcePosition}`,
      candidateIssueId: sourcePosition, selectedIssueId: sourcePosition, resolutionStatus: 'exact',
      resolvedIssueTitle: 'A Comic (2026)', marvelIssueUrl: `https://www.marvel.com/comics/issue/${sourcePosition}`,
    };
  });

  const packet = {
    id: 'bridge', sourceProvider: 'comic-book-herald',
    sourceUrl: template.sourceUrl, expectedCount: rows.length, canonicalSourcePositions: true, rows,
  };
  packet.packetDigest = packetDigestFor(packet);
  const mapping = {
    id: packet.id, packetDigest: packet.packetDigest, approvedSourceCount: rows.length, rows,
    sourceUrl: packet.sourceUrl, proposedManifest: { name: 'Bridge' },
  };
  mapping.mappingDigest = mappingDigestFor(mapping);
  const input = {
    packet, mapping, layout: { positionCount: 36 },
    parts: [{ first: 1, last: 18 }, { first: 19, last: 36 }],
  };
  const derived = deriveSectionalPartMappings(input).map((part) => part.mapping);
  assert.deepEqual(derived.map(({ id }) => id), ['bridge-part-1', 'bridge-part-2']);
  assert.deepEqual(derived.flatMap((part) => part.rows), rows);
  assert.ok(derived.every((part) => !Object.hasOwn(part, 'sourceSection') && part.sourceUrl === packet.sourceUrl));
  assert.equal(derived[1].proposedManifest.description, 'Read from A Comic (2026) #19 through A Comic (2026) #36.');
  assert.equal(derived[1].sectionalPart.parentMappingDigest, mapping.mappingDigest);
  assert.throws(() => validateMappingDigest({
    ...derived[1], sectionalPart: { ...derived[1].sectionalPart, first: 18 },
  }), /digest is stale/);
  const edited = structuredClone(input);
  edited.packet.rows[18].sourceIssueReference = 'A different comic';
  assert.throws(() => deriveSectionalPartMappings(edited), /parent packet changed/);
});

test('one hidden source builds only its reviewed children and retains real collection blocks', () => {
  const rawOrder = {
    id: 'bridge', name: 'Bridge', type: 'era', depth: 'complete',
    sourcePage: 'https://example.test/guide', sourceOrigin: 'Source credit',
    out: 'bridge.json', sourceFile: 'bridge.md', expect: 36,
    catalog: false, sectionKind: 'reading-blocks',
  };
  const items = Array.from({ length: 36 }, (_, index) => ({
    issueId: index + 1, title: `Comic #${index + 1}`, collectedIn: 'Source heading',
  }));
  const guide = {
    id: 'bridge', name: 'Bridge', year: 2007, layout: { guideId: 'bridge', positionCount: 36 },
    protectedRanges: [{ first: 1, last: 18, label: 'First run' }],
    collections: [{ first: 18, last: 18, title: 'The book' }],
    parts: [[1, 18], [19, 36]].map(([first, last]) => ({
      first, last, description: `Read from Comic #${first} through Comic #${last}.`,
      issueIds: items.slice(first - 1, last).map(({ issueId }) => issueId),
    })),
  };
  const manifest = { lists: [rawOrder], sectionalGuides: [guide] };
  const { entries: [order], errors } = parseManifest(manifest);
  assert.deepEqual(errors, []);
  assert.match(parseManifest({ ...manifest, lists: [{ ...rawOrder, catalog: true }] }).errors.join(), /catalog: false/);
  const parentPayload = {
    id: 'bridge', source: rawOrder.sourcePage, sourceOrigin: rawOrder.sourceOrigin,
    count: 36, items, generatedAt: '2026-01-01T00:00:00Z',
  };
  const children = buildSectionalFamily({ order, parentPayload, guide });
  assert.deepEqual(children.map(({ order, payload }) => [order.id, order.out, payload.count, payload.collections]), [
    ['bridge-part-1', 'bridge_part_1.json', 18, 1], ['bridge-part-2', 'bridge_part_2.json', 18, 0],
  ]);
  assert.deepEqual(children.flatMap(({ payload }) => payload.items.map(({ issueId }) => issueId)),
    items.map(({ issueId }) => issueId));
  assert.deepEqual(children[0].payload.items.filter(({ collectedIn }) => collectedIn)
    .map(({ issueId, collectedIn }) => [issueId, collectedIn]), [[18, 'The book']]);
  assert.ok(children.every(({ payload }) => payload.source === rawOrder.sourcePage
      && !Object.hasOwn(payload, 'sourceSection')));
  const payloads = new Map(children.map(({ payload }) => [payload.id, payload]));
  const catalog = {
    lists: children.map(({ order, payload }) => ({
      ...order, file: order.out, count: payload.count, placeholderCount: 0, emptyRecordCount: 0,
    })),
    sectionalGuides: [guide],
  };
  assert.doesNotThrow(() => validateVendoredCatalog(catalog, payloads));
  const wrong = { ...parentPayload, items: items.map((item, index) => index === 18 ? { ...item, issueId: 99 } : item) };
  assert.throws(() => buildSectionalFamily({ order, parentPayload: wrong, guide }), /source issue vector changed at 19/);
  assert.throws(() => buildSectionalFamily({
    order, parentPayload, guide: { ...guide, collections: [{ first: 17, last: 19, title: 'Cut book' }] },
  }), /split Cut book/);
  payloads.get('bridge-part-2').items.reverse();
  assert.throws(() => validateVendoredCatalog(catalog, payloads), /bridge-part-2 payload does not match/);
});
