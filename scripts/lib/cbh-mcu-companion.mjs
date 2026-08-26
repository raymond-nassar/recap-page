import {
  CBH_SOURCE_PROVIDER,
  digestCanonicalJson,
  validateFrozenPacket,
  validateSourceIdentities,
} from './cbh-inventory.mjs';

export const MCU_COMPANION_COUNT = 14;
export const MCU_COMPANION_IDENTITY_SHA256 =
  '3f1385d457081d0ccaa7513ae161c42895d3ce2dd05ced0d06d5bf25d47bda11';
export const MCU_PACKET_REVIEW = 'MRT-004 central CBH source review';
export const MCU_SELECTED_IDS = Object.freeze([
  'doctor-strange-multiverse-of-madness',
  'spider-man-no-way-home',
  'marvel-multiverse',
  'marvel-what-if',
  'wandavision',
  'spider-man-far-from-home',
]);
export const MCU_FOLLOW_UP_IDS = Object.freeze([
  'avengers-endgame-character-picks',
  'miles-morales-spider-verse',
  'venom-movie',
  'iron-man-3',
]);
export const MCU_BLOCKED_IDS = Object.freeze([
  'avengers-endgame',
  'ant-man-wasp-mcu',
  'deadpool-2',
  'avengers-infinity-war',
]);

const SHA256 = /^[a-f0-9]{64}$/;
const DISPOSITIONS = new Set(['selected', 'follow-up', 'blocked']);
const RELATIONSHIPS = new Set(['reviewed', 'reviewed-feasibility', 'pending', 'not-applicable']);
const DELIVERY = new Set(['ready', 'shipped', 'deferred', 'blocked']);
const BOUNDARIES = new Set([
  'exact-reviewed-boundary',
  'source-enumerated-collection-boundary',
  'blocked-no-complete-issue-boundary',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function identityRecords(records) {
  return records.map(({
    relationshipStatus: _relationshipStatus,
    deliveryStatus: _deliveryStatus,
    catalogIds: _catalogIds,
    ...record
  }) => record);
}

function validateRecord(record, index) {
  const label = `MCU companion record ${index + 1}`;
  assert(record && typeof record === 'object', `${label} must be an object`);
  assert(record.position === index + 1, `${label} position must be ${index + 1}`);
  assert(typeof record.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id),
    `${label} id must be lower-kebab-case`);
  assert(typeof record.title === 'string' && record.title.trim(), `${label} title is required`);
  const url = new URL(record.url);
  assert(url.protocol === 'https:' && CBH_SOURCE_PROVIDER.hosts.includes(url.hostname),
    `${label} must use the Comic Book Herald provider`);
  assert(record.wordpressType === 'post', `${label} WordPress type must be post`);
  assert(Number.isInteger(record.wordpressId) && record.wordpressId > 0,
    `${label} WordPress id must be positive`);
  assert(typeof record.wordpressSlug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.wordpressSlug),
    `${label} WordPress slug is invalid`);
  assert(!Number.isNaN(Date.parse(record.sourceRetrievedAt)), `${label} retrieval timestamp is invalid`);
  assert(SHA256.test(record.sourceContentSha256), `${label} source content digest is invalid`);
  assert(SHA256.test(record.sourceIssueBearingBlocksSha256),
    `${label} issue-bearing digest is invalid`);
  assert(Number.isInteger(record.sourceIssueBearingBlockCount)
    && record.sourceIssueBearingBlockCount >= 0, `${label} issue-bearing count is invalid`);
  assert(BOUNDARIES.has(record.sourceBoundaryStatus), `${label} source boundary status is invalid`);
  assert(DISPOSITIONS.has(record.centralDisposition), `${label} central disposition is invalid`);
  assert(RELATIONSHIPS.has(record.relationshipStatus), `${label} relationship status is invalid`);
  assert(DELIVERY.has(record.deliveryStatus), `${label} delivery status is invalid`);
  assert(typeof record.reason === 'string' && record.reason.trim(), `${label} reason is required`);
  assert(Array.isArray(record.overlapIds)
    && record.overlapIds.every((value) => typeof value === 'string' && value.trim())
    && new Set(record.overlapIds).size === record.overlapIds.length,
  `${label} overlap ids must be unique strings`);
  assert(Array.isArray(record.catalogIds)
    && record.catalogIds.every((value) => typeof value === 'string' && value.trim())
    && new Set(record.catalogIds).size === record.catalogIds.length,
  `${label} catalog ids must be unique strings`);
}

export function validateMcuCompanionInventory(inventory) {
  assert(inventory?.schemaVersion === 1, 'MCU companion inventory schema version must be 1');
  assert(inventory?.taskId === 'MRT-004', 'MCU companion inventory task id must be MRT-004');
  const records = inventory.records;
  assert(Array.isArray(records), 'MCU companion inventory records must be an array');
  assert(records.length === MCU_COMPANION_COUNT,
    `MCU companion inventory must contain ${MCU_COMPANION_COUNT} records`);
  records.forEach(validateRecord);
  assert(new Set(records.map((record) => record.id)).size === records.length,
    'MCU companion inventory contains a duplicate id');
  assert(new Set(records.map((record) => record.url)).size === records.length,
    'MCU companion inventory contains a duplicate source url');
  assert(new Set(records.map((record) => record.wordpressId)).size === records.length,
    'MCU companion inventory contains a duplicate WordPress id');
  validateSourceIdentities(records);

  const selected = records.filter((record) => record.centralDisposition === 'selected');
  assert(JSON.stringify(selected.map((record) => record.id)) === JSON.stringify(MCU_SELECTED_IDS),
    'MCU companion selected ids or priority order changed');
  for (const record of selected) {
    assert(record.relationshipStatus === 'reviewed',
      `${record.id} selected relationship must be reviewed`);
    assert(['ready', 'shipped'].includes(record.deliveryStatus),
      `${record.id} selected delivery state is invalid`);
    assert(record.followUpRank == null, `${record.id} selected row cannot have a follow-up rank`);
    assert(record.sourceBoundaryStatus === 'exact-reviewed-boundary',
      `${record.id} selected source boundary is not exact`);
    assert(record.deliveryStatus === 'ready'
      ? record.catalogIds.length === 0
      : JSON.stringify(record.catalogIds) === JSON.stringify([record.id]),
    `${record.id} selected catalog state is invalid`);
  }

  const followUps = records.filter((record) => record.centralDisposition === 'follow-up');
  assert(JSON.stringify(followUps.map((record) => record.id)) === JSON.stringify(MCU_FOLLOW_UP_IDS),
    'MCU companion follow-up ids or priority order changed');
  assert(JSON.stringify(followUps.map((record) => record.followUpRank))
    === JSON.stringify([3, 4, 5, 6]),
  'MCU companion follow-up ranks changed');
  for (const record of followUps) {
    assert(['pending', 'reviewed-feasibility'].includes(record.relationshipStatus),
      `${record.id} follow-up relationship state is invalid`);
    assert(record.deliveryStatus === 'deferred', `${record.id} follow-up must remain deferred`);
    assert(record.catalogIds.length === 0, `${record.id} deferred row cannot name a catalog id`);
  }

  const blocked = records.filter((record) => record.centralDisposition === 'blocked');
  assert(JSON.stringify(blocked.map((record) => record.id)) === JSON.stringify(MCU_BLOCKED_IDS),
    'MCU companion blocked ids or priority order changed');
  for (const record of blocked) {
    assert(record.relationshipStatus === 'not-applicable',
      `${record.id} blocked relationship state is invalid`);
    assert(record.deliveryStatus === 'blocked', `${record.id} blocked delivery state is invalid`);
    assert(record.followUpRank == null, `${record.id} blocked row cannot have a follow-up rank`);
    assert(['exact-reviewed-boundary', 'blocked-no-complete-issue-boundary'].includes(record.sourceBoundaryStatus),
      `${record.id} blocked source boundary status is invalid`);
    assert(record.catalogIds.length === 0, `${record.id} blocked row cannot name a catalog id`);
  }

  assert(inventory.inventoryIdentitySha256 === MCU_COMPANION_IDENTITY_SHA256,
    'MCU companion inventory declares an unexpected identity digest');
  assert(digestCanonicalJson(identityRecords(records)) === MCU_COMPANION_IDENTITY_SHA256,
    'MCU companion inventory identity digest changed');
  return true;
}

export function validateMcuCompanionPacket(packet, options = {}) {
  const inventoryRecord = options.inventoryRecord;
  const result = validateFrozenPacket(packet, options);
  assert(inventoryRecord, `${packet.id} MCU companion inventory record is required`);
  assert(inventoryRecord.centralDisposition === 'selected',
    `${packet.id} inventory record is not selected`);
  assert(inventoryRecord.url === packet.sourceUrl,
    `${packet.id} source URL differs from its MCU companion inventory record`);
  assert(inventoryRecord.sourceRetrievedAt.slice(0, 10) === packet.sourceRetrievedAt,
    `${packet.id} retrieval date differs from its MCU companion inventory record`);
  assert(inventoryRecord.sourceContentSha256 === packet.sourceContentSha256,
    `${packet.id} source content differs from its MCU companion inventory record`);
  assert(inventoryRecord.sourceIssueBearingBlocksSha256 === packet.sourceIssueBearingBlocksSha256,
    `${packet.id} issue-bearing boundary differs from its MCU companion inventory record`);
  assert(packet.proposedManifest.type === 'screen-companion',
    `${packet.id} must use screen-companion type`);
  assert(packet.proposedManifest.depth === 'selected',
    `${packet.id} must use selected depth`);
  assert(packet.proposedManifest.timeline === null, `${packet.id} timeline must be null`);
  assert(packet.proposedManifest.beginner === false, `${packet.id} beginner must be false`);
  return result;
}
