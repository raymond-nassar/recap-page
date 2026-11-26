import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { deriveSectionalPartMappings } from '../scripts/lib/cbh-sectional-parts.mjs';
import { mappingDigestFor, packetDigestFor, validateMappingDigest } from '../scripts/lib/cbh-inventory.mjs';

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
