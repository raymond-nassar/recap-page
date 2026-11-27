import assert from 'node:assert/strict';
import { selectedIssueIds } from '../author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, mappingDigestFor, packetDigestFor, validateMappingDigest,
} from './cbh-inventory.mjs';
import { checklistTitleForRow } from './cbh-checklist-title.mjs';
import {
  sectionalGuideParts, sectionalPartDescription, sectionalPartName,
} from '../../src/js/lib/sectionalGuide.js';

// These are relationship-review inputs for ranges of the parent's only source, not separately
// sourced packets. The ordinary author still requires a frozen packet and approvals before writing.
export function deriveSectionalPartMappings({ packet, mapping, layout, parts, protectedRanges }) {
  assert.equal(mapping.id, packet.id, 'The parent mapping names a different packet');
  assert.equal(mapping.packetDigest, packetDigestFor(packet), 'The parent packet changed');
  assert.equal(packet.packetDigest, mapping.packetDigest, 'The recorded parent packet digest changed');
  assert.equal(mapping.sourceUrl, packet.sourceUrl, 'The parent mapping names a different source page');
  validateMappingDigest(mapping);
  assertMappingMatchesPacketOccurrences(packet, mapping);
  assert.equal(layout.positionCount, mapping.rows.length, 'A sectional part requires one exact row per position');
  assert(mapping.rows.every((row, index) => row.sourcePosition === index + 1),
    'Sectional parts require consecutive parent positions');
  const keys = selectedIssueIds(mapping);
  assert.equal(new Set(keys).size, keys.length, 'The parent contains duplicate comic identities');

  return sectionalGuideParts(layout, parts, { protectedRanges }).map((part) => {
    const rows = mapping.rows.slice(part.first - 1, part.last);
    const id = `${mapping.id}-part-${part.number}`;
    const findOnly = mapping.findOnlySourcePositions?.filter((at) => at >= part.first && at <= part.last);
    const derived = {
      id,
      sourceProvider: packet.sourceProvider,
      sourceUrl: mapping.sourceUrl,
      packetDigest: mapping.packetDigest,
      approvedSourceCount: rows.length,
      sectionalPart: {
        parentId: mapping.id, parentMappingDigest: mapping.mappingDigest,
        number: part.number, first: part.first, last: part.last,
      },
      proposedManifest: {
        id,
        name: sectionalPartName(mapping.proposedManifest.name, part.number),
        description: sectionalPartDescription(checklistTitleForRow(rows[0]), checklistTitleForRow(rows.at(-1))),
        expect: rows.length,
      },
      rows,
      ...(findOnly?.length ? { findOnlySourcePositions: findOnly } : {}),
      reviewStatus: 'pending-independent-review',
    };
    derived.mappingDigest = mappingDigestFor(derived);
    return { mapping: derived, steps: part.steps };
  });
}
