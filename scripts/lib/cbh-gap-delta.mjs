import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mappedIssueCheckbox } from '../author-cbh-packet.mjs';
import {
  applyVendorPayloadRevisions, cleanText, loadCachedMetadata, loadDateCorrections, vendorIssueItem,
} from '../vendor-orders.mjs';
import { parseChecklist } from '../../src/js/lib/markdown.js';
import {
  digestCanonicalJson, validateApprovalDigest, validateMappingDigest,
} from './cbh-inventory.mjs';
import { placeholderId } from './placeholder-id.mjs';
import { legacyIdentityChecked, legacyIdentityKeyFor } from './wolverine-title-repairs.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const parse = (id, checklist) => legacyIdentityChecked(id, parseChecklist(checklist, { legacyIdentityKeys: true }));
const ordered = ({ entries, unresolved }) => [...entries, ...unresolved].sort((a, b) => a.index - b.index);

function assertMaintainedBaseline(published, parsed, rows) {
  const { id, items } = published;
  assert.equal(published.count, items.length, 'Stale published count');
  assert.equal(published.placeholders, parsed.unresolved.length, 'Stale published placeholder count');
  assert.deepEqual(published.unresolved, parsed.unresolved, 'Published unresolved rows differ from the checklist');
  assert.equal(rows.length, items.length, 'Published vector length differs from the checklist');
  for (const [index, row] of rows.entries()) {
    const item = items[index];
    const isGap = row.issueId === undefined;
    const expectedId = isGap
      ? placeholderId(id, legacyIdentityKeyFor(row) ?? row.title, row.sourceKey)
      : row.issueId;
    assert.equal(row.index, index, 'Checklist indices are not contiguous');
    assert.equal(item.issueId, expectedId, `Stale published issue id at index ${index}`);
    assert.equal(item.placeholder === true, isGap, `Stale published placeholder at index ${index}`);
    assert.equal(item.collectedIn ?? null, row.section ? cleanText(row.section) : null,
      `Stale published section at index ${index}`);
  }
}

function replaceChecklistLines(checklist, linesByIndex, expectedLength) {
  // Capture the separators too, so preserved lines stay exactly as published on either platform.
  const parts = checklist.split(/(\r?\n)/);
  let index = 0;
  for (let at = 0; at < parts.length; at += 2) {
    const { entries, unresolved } = parseChecklist(parts[at]);
    if (entries.length + unresolved.length === 0) continue;
    if (linesByIndex.has(index)) parts[at] = linesByIndex.get(index);
    index += 1;
  }
  assert.equal(index, expectedLength, 'Could not address the published checklist line by line');
  return parts.join('');
}

// This only projects a candidate. The caller must obtain the plan digest from the separate
// correction review, not compute a new digest to accept stale input at invocation time.
export async function preparePublishedCbhGapDelta({
  payloadBytes, checklistBytes, mapping, plan, reviewedPlanDigest, metadataCacheDir, generatedAt,
}) {
  assert.equal(digestCanonicalJson(plan), reviewedPlanDigest, 'Gap delta plan differs from review');
  assert.equal(sha256(payloadBytes), plan.payloadSha256, 'Stale published payload bytes');
  assert.equal(sha256(checklistBytes), plan.checklistSha256, 'Stale published checklist bytes');
  validateMappingDigest(mapping);
  assert.equal(mapping.reviewStatus, 'approved', 'Gap delta mapping has no approved relationship review');
  assert.ok(mapping.relationshipReview, 'Gap delta mapping has no approved relationship review');
  validateApprovalDigest(mapping.relationshipReview, `${plan.id} relationship review`);
  assert.equal(mapping.relationshipReview.reportDigest, plan.relationshipReportDigest,
    'Gap delta relationship report differs from review');
  assert.equal(mapping.relationshipReview.approvalDigest, plan.relationshipApprovalDigest,
    'Gap delta relationship approval differs from review');
  assert.equal(mapping.relationshipReview.packetDigest, plan.packetDigest,
    'Gap delta relationship packet differs from review');
  assert.equal(mapping.relationshipReview.mappingDigest, plan.mappingDigest,
    'Gap delta relationship mapping differs from review');
  assert.equal(mapping.mappingDigest, plan.mappingDigest, 'Gap delta mapping differs from review');
  assert.equal(mapping.packetDigest, plan.packetDigest, 'Gap delta packet differs from review');
  assert.equal(digestCanonicalJson(mapping.sourceGapResolutions), plan.transitionLedgerDigest,
    'Gap delta transitions differ from review');
  assert.match(plan.sourceApprovalBodyDigest, /^[a-f0-9]{64}$/u, 'Gap delta lacks the source review binding');
  assert.equal(mapping.sourceProvider, 'comic-book-herald', 'Gap delta requires a CBH mapping');
  assert.equal(mapping.id, plan.id, 'Gap delta mapping names a different guide');
  assert.equal(new Date(generatedAt).toISOString(), generatedAt, 'Gap delta requires an exact generation timestamp');
  assert.ok(metadataCacheDir, 'Gap delta requires genuine detail receipts');

  const published = JSON.parse(payloadBytes);
  assert.equal(published.id, plan.id, 'Published payload names a different guide');
  const beforeIds = published.items.map((item) => item.issueId);
  assert.equal(digestCanonicalJson(beforeIds), plan.vectorDigest, 'Stale published issue vector');
  assert.equal(new Set(beforeIds).size, beforeIds.length, 'Published issue vector has duplicate ids');
  const checklist = checklistBytes.toString('utf8');
  const before = parse(plan.id, checklist);
  const beforeRows = ordered(before);
  assertMaintainedBaseline(published, before, beforeRows);

  const sourceRows = [...mapping.rows, ...mapping.sourceGaps].sort((a, b) => a.sourcePosition - b.sourcePosition);
  assert.equal(sourceRows.length, beforeRows.length, 'Gap delta mapping changes the published roster length');
  assert.equal(new Set(sourceRows.map((row) => row.sourcePosition)).size, sourceRows.length,
    'Gap delta mapping repeats a source position');
  const resolutions = new Map(mapping.sourceGapResolutions.map((row) => [row.sourcePosition, row]));
  assert.equal(resolutions.size, mapping.sourceGapResolutions.length, 'Gap delta mapping repeats a resolution');
  assert.ok(plan.replacements.length > 0, 'Gap delta requires at least one approved replacement');
  const replacements = new Map(plan.replacements.map((row) => [row.index, row]));
  assert.equal(replacements.size, plan.replacements.length, 'Gap delta repeats a slot');
  const lines = new Map();
  const afterIds = beforeIds.slice();
  for (const [index, slot] of replacements) {
    const previous = beforeRows[index];
    const mapped = sourceRows[index];
    assert.ok(Number.isInteger(index) && previous && previous.issueId === undefined
      && beforeIds[index] === slot.previousIssueId && slot.previousIssueId < 0,
    `Gap delta slot ${index} is not the reviewed placeholder`);
    const resolution = resolutions.get(slot.sourcePosition);
    assert.ok(Number.isSafeInteger(slot.issueId) && slot.issueId > 0 && !beforeIds.includes(slot.issueId)
      && mapped.sourcePosition === slot.sourcePosition && mapped.selectedIssueId === slot.issueId
      && mapped.resolutionStatus === 'exact' && !mapped.identityEvidenceKind
      && resolution?.resolutionKind === 'exact-issue' && resolution.selectedIssueId === slot.issueId
      && cleanText(resolution.previousSourceIssueReference) === cleanText(previous.title)
      && cleanText(slot.previousSourceIssueReference) === cleanText(previous.title),
    `Gap delta slot ${index} has no matching exact-issue transition`);
    assert.ok(!(mapping.findOnlySourcePositions ?? []).includes(slot.sourcePosition),
      `Gap delta slot ${index} is Find-only and has no recorded issue address`);
    lines.set(index, mappedIssueCheckbox(mapped));
    afterIds[index] = slot.issueId;
  }
  assert.equal(new Set(afterIds).size, afterIds.length, 'Gap delta would duplicate an issue id');

  const nextChecklist = replaceChecklistLines(checklist, lines, beforeRows.length);
  const after = parse(plan.id, nextChecklist);
  const afterRows = ordered(after);
  assert.equal(afterRows.length, beforeRows.length, 'Gap delta changed checklist length');
  for (const [index, row] of afterRows.entries()) {
    const mapped = sourceRows[index];
    if (row.issueId !== undefined) {
      assert.equal(row.issueId, mapped.selectedIssueId, `Mapping changes the issue at index ${index}`);
      assert.equal(row.sourceKey, String(mapped.sourcePosition), `Mapping moves the issue at index ${index}`);
    } else {
      assert.equal(mapped.selectedIssueId, undefined, `Unapproved gap transition at index ${index}`);
    }
    if (!replacements.has(index)) {
      assert.deepEqual(row, beforeRows[index], `Gap delta changed the checklist outside its reviewed slots at ${index}`);
    } else {
      assert.equal(row.issueId, afterIds[index], `Gap delta did not resolve the placeholder at index ${index}`);
      assert.equal(row.section, beforeRows[index].section, `Gap delta moved the section at index ${index}`);
    }
  }

  const ids = plan.replacements.map((slot) => slot.issueId);
  const { meta, records } = await loadCachedMetadata(ids, metadataCacheDir);
  const dateCorrections = await loadDateCorrections({ id: plan.id }, after.entries);
  const items = published.items.slice();
  for (const [index, { issueId, metadataBodySha256 }] of replacements) {
    assert.ok(meta.has(issueId) && records.get(issueId).bodySha256 === metadataBodySha256,
      `Gap delta needs the reviewed successful detail receipt for issue ${issueId}`);
    items[index] = vendorIssueItem(afterRows[index], meta.get(issueId), {
      orderId: plan.id, correction: dateCorrections.get(issueId),
    });
  }
  const payload = applyVendorPayloadRevisions({
    ...published,
    generatedAt,
    placeholders: after.unresolved.length,
    unresolved: after.unresolved,
    items,
  }, mapping.proposedManifest.out);
  assert.equal(payload.placeholders, published.placeholders - replacements.size, 'Gap delta changed other placeholders');
  assert.deepEqual(payload.unresolved, published.unresolved.filter((row) => !replacements.has(row.index)),
    'Gap delta changed unresolved rows outside its reviewed slots');
  assert.deepEqual(payload.items.map((item) => item.issueId), afterIds, 'Gap delta changed the expected issue vector');
  for (const [index, item] of payload.items.entries()) {
    if (!replacements.has(index)) {
      assert.deepEqual(item, published.items[index], `Gap delta changed a published item at index ${index}`);
    }
  }
  return { checklist: nextChecklist, payload };
}
