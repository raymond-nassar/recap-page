import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRelationshipReportExtension } from '../scripts/lib/owner-guide.mjs';
import { approvalDigestFor, mappingDigestFor } from '../scripts/lib/cbh-inventory.mjs';
import { issueIdsFromValue } from '../scripts/lib/cbh-overlap.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const jsonAt = async (file) => JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
const PARENT = 'civil-war-to-secret-invasion';

// The parts of a sectional guide carry no review of their own, so an earlier owner guide that shares
// comics with one may accept it only through the signed parent it was cut from. Each case below
// changes one link in that chain and must be refused.
async function fixture(candidateId) {
  const manifest = await jsonAt('src/data/curated-lists.json');
  const catalog = await jsonAt('src/data/catalog.json');
  const parent = await jsonAt(`scripts/data/cbh-mappings/${PARENT}.json`);
  const report = await jsonAt(`scripts/data/cbh-overlaps/${PARENT}.json`);
  const packet = await jsonAt(`scripts/data/cbh-packets/${PARENT}.json`);
  const guide = manifest.sectionalGuides.find(({ id }) => id === PARENT);
  const visiblePartIds = catalog.lists.map(({ id }) => id).filter((id) => id.startsWith(`${PARENT}-part-`));
  const candidate = catalog.lists.find(({ id }) => id === candidateId);
  const candidateCount = issueIdsFromValue(await jsonAt(`src/data/${candidate.file}`)).length;
  const parentShared = new Set(report.comparisons.find(({ orderId }) => orderId === candidateId).sharedIds.map(String));
  const later = [];
  const comparisons = [];
  for (const partId of visiblePartIds) {
    const mapping = await jsonAt(`scripts/data/cbh-mappings/${partId}.json`);
    const file = catalog.lists.find(({ id }) => id === partId).file;
    const payloadIds = issueIdsFromValue(await jsonAt(`src/data/${file}`));
    const sharedIds = payloadIds.map(String).filter((id) => parentShared.has(id));
    if (!sharedIds.length) continue;
    const relationship = sharedIds.length === payloadIds.length ? 'existing-subset'
      : sharedIds.length === candidateCount ? 'candidate-subset' : 'partial';
    comparisons.push({ orderId: partId, sharedCount: sharedIds.length, sharedIds, relationship });
    later.push({
      registeredId: partId, mapping,
      sectional: { parent, report, packet, guide, visiblePartIds, payloadIds },
    });
  }
  const previous = { candidateId, candidateCount, comparisons: [] };
  return { previous, current: { ...previous, comparisons }, later };
}

const check = ({ previous, current, later }) => assertRelationshipReportExtension(previous, current, [], later);

for (const [candidateId, partId] of [
  ['iron-fist-reading-order', `${PARENT}-part-10`],
  ['namor-sub-mariner-reading-order', `${PARENT}-part-12`],
  ['shang-chi-master-of-kung-fu-reading-order', `${PARENT}-part-7`],
]) {
  test(`${candidateId} accepts a derived bridge part only through its signed parent`, async () => {
    const base = await fixture(candidateId);
    assert.ok(base.current.comparisons.some(({ orderId }) => orderId === partId),
      `${candidateId} is expected to share comics with ${partId}.`);
    assert.doesNotThrow(() => check(base));
    assert.throws(() => assertRelationshipReportExtension(base.previous, base.current),
      /registered reciprocal review/);

    const target = (value) => value.later.find(({ registeredId }) => registeredId === partId);
    const variant = (edit) => {
      const value = structuredClone(base);
      edit(value, target(value));
      return value;
    };

    // Re-sealing the part's own digest is not enough: it must still derive from the parent.
    assert.throws(() => check(variant((_, part) => {
      part.mapping.sectionalPart.parentMappingDigest = '0'.repeat(64);
      part.mapping.mappingDigest = mappingDigestFor(part.mapping);
    })), /exact derived range/);
    assert.throws(() => check(variant((_, part) => {
      part.mapping.rows = part.mapping.rows.slice(1);
      part.mapping.mappingDigest = mappingDigestFor(part.mapping);
    })), /exact derived range/);
    assert.throws(() => check(variant((_, part) => {
      part.sectional.payloadIds = [...part.sectional.payloadIds].reverse();
    })), /publishes comics other than its derived rows/);
    assert.throws(() => check(variant((_, part) => {
      part.sectional.payloadIds = [...part.sectional.payloadIds.slice(0, -1), '999999999'];
    })), /publishes comics other than its derived rows/);
    assert.throws(() => check(variant((_, part) => {
      part.sectional.visiblePartIds = part.sectional.visiblePartIds.filter((id) => id !== `${PARENT}-part-14`);
    })), /exactly its derived parts/);
    assert.throws(() => check(variant((_, part) => {
      part.sectional.guide = { ...part.sectional.guide, parts: part.sectional.guide.parts.slice(0, -1) };
    })), /differs from its signed parent packet/);
    assert.throws(() => check(variant((_, part) => {
      part.sectional.parent = { ...part.sectional.parent, reviewStatus: 'pending-independent-review' };
    })));
    assert.throws(() => check(variant((_, part) => {
      const review = part.sectional.parent.relationshipReview;
      review.dispositions.find(({ orderId }) => orderId === partId).decision = 'rejected';
      review.approvalDigest = approvalDigestFor(review);
    })));
    assert.throws(() => check(variant((value) => {
      const entry = value.current.comparisons.find(({ orderId }) => orderId === partId);
      entry.sharedIds = [...entry.sharedIds.slice(1), '999999999'];
    })));
    assert.throws(() => check(variant((value) => {
      const entry = value.current.comparisons.find(({ orderId }) => orderId === partId);
      entry.relationship = entry.relationship === 'partial' ? 'existing-subset' : 'partial';
    })));
    // The part's own pending status is never read as approval; a part claiming one is not its derived form.
    assert.throws(() => check(variant((_, part) => {
      part.mapping.reviewStatus = 'approved';
      part.mapping.mappingDigest = mappingDigestFor(part.mapping);
    })), /exact derived range/);
  });
}
