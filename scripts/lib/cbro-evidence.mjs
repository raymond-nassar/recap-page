import {
  approvalDigestFor,
  canonicalJson,
  digestCanonicalJson,
  mappingDigestFor,
  packetDigestFor,
  reportDigestFor,
  validateSourceIdentities,
  validateApprovalDigest,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from './cbh-inventory.mjs';

export const CBRO_SOURCE_ORIGIN = 'Compiled for this project from Comic Book Reading Orders';

export const CBRO_SOURCE_PROVIDER = Object.freeze({
  id: 'comic-book-reading-orders',
  hosts: Object.freeze([
    'comicbookreadingorders.com',
    'www.comicbookreadingorders.com',
  ]),
  sourceOrigin: CBRO_SOURCE_ORIGIN,
  requireSourceProvider: true,
  requireSourceContentSha256: true,
});

export const CBRO_HISTORICAL_COUNT = 58;
export const CBRO_SELECTED_IDS = Object.freeze([
  'muir-island-saga',
  'bloodties',
  'midnight-massacre',
  'childs-play',
  'eighth-day',
]);

const INVENTORY_DISPOSITIONS = new Set([
  'selected',
  'deferred',
  'deferred-subset',
  'blocked',
  'absorbed',
  'provenance-blocked',
]);
const INVENTORY_RELATIONSHIPS = new Set([
  'none',
  'candidate-subset',
  'unresolved',
  'not-applicable',
]);
const INVENTORY_DELIVERY = new Set(['ready', 'shipped', 'deferred', 'blocked', 'not-applicable']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/.test(String(value ?? ''));
}

export function validateCbroPacket(packet, options = {}) {
  return validateFrozenPacket(packet, {
    ...options,
    provider: CBRO_SOURCE_PROVIDER,
  });
}

export function validateCbroHistoricalInventory(records) {
  assert(Array.isArray(records), 'CBRO historical inventory must be an array');
  assert(records.length === CBRO_HISTORICAL_COUNT,
    `CBRO historical inventory must contain ${CBRO_HISTORICAL_COUNT} records`);
  const ids = new Set();
  const selected = [];
  for (const [index, record] of records.entries()) {
    const label = `CBRO historical record ${index + 1}`;
    assert(record && typeof record === 'object', `${label} must be an object`);
    assert(record.position === index + 1, `${label} position must be ${index + 1}`);
    assert(typeof record.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id),
      `${label} id must be lower-kebab-case`);
    assert(!ids.has(record.id), `Duplicate CBRO historical id: ${record.id}`);
    ids.add(record.id);
    assert(record.title !== 'Maximum Security' && record.id !== 'maximum-security',
      'Maximum Security is outside the exclusive historical cutoff');
    assert(typeof record.title === 'string' && record.title.trim(), `${label} title is required`);
    assert(Number.isInteger(record.year) && record.year >= 1965 && record.year <= 2000,
      `${label} year is outside the historical boundary`);
    assert(record.sourceProvider === CBRO_SOURCE_PROVIDER.id, `${label} has the wrong provider`);
    assert(typeof record.sourceUrl === 'string' && record.sourceUrl.startsWith('https://'),
      `${label} sourceUrl is required`);
    assert(['event-page', 'timeline-text'].includes(record.sourceForm),
      `${label} has an invalid sourceForm`);
    assert(record.sourceForm === 'timeline-text'
      ? typeof record.sourceSection === 'string' && record.sourceSection.trim()
      : record.sourceSection == null, `${label} source section does not fit sourceForm`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(record.sourceRetrievedAt),
      `${label} sourceRetrievedAt must be a date`);
    assert(isSha256(record.sourceContentSha256), `${label} sourceContentSha256 is invalid`);
    assert(Number.isInteger(record.sourceRowCount) && record.sourceRowCount >= 0,
      `${label} sourceRowCount is invalid`);
    assert(INVENTORY_DISPOSITIONS.has(record.centralDisposition),
      `${label} centralDisposition is invalid`);
    assert(INVENTORY_RELATIONSHIPS.has(record.relationshipStatus),
      `${label} relationshipStatus is invalid`);
    assert(typeof record.reason === 'string' && record.reason.trim(), `${label} reason is required`);
    assert(Array.isArray(record.overlapIds) && new Set(record.overlapIds).size === record.overlapIds.length,
      `${label} overlapIds must be unique`);
    assert(Array.isArray(record.catalogIds) && new Set(record.catalogIds).size === record.catalogIds.length,
      `${label} catalogIds must be unique`);
    assert(INVENTORY_DELIVERY.has(record.deliveryStatus), `${label} deliveryStatus is invalid`);
    if (record.centralDisposition === 'selected') {
      assert(['ready', 'shipped'].includes(record.deliveryStatus) && record.relationshipStatus === 'none',
        `${label} selected state is inconsistent`);
      assert(record.deliveryStatus === 'ready'
        ? record.catalogIds.length === 0
        : JSON.stringify(record.catalogIds) === JSON.stringify([record.id]),
      `${label} selected catalog state is inconsistent`);
      selected.push(record.id);
    }
  }
  assert(JSON.stringify(selected) === JSON.stringify(CBRO_SELECTED_IDS),
    'CBRO selected inventory ids or source order changed');
  validateSourceIdentities(records.map((record) => ({
    url: record.sourceUrl,
    sourceSection: record.sourceSection,
  })));
  return true;
}

export {
  approvalDigestFor,
  canonicalJson,
  digestCanonicalJson,
  mappingDigestFor,
  packetDigestFor,
  reportDigestFor,
  validateApprovalDigest,
  validateMappingDigest,
  validateReportDigest,
  validateSourceIdentities,
};
