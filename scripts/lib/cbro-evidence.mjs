import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  approvalDigestFor,
  canonicalJson,
  digestCanonicalJson,
  mappingDigestFor,
  packetDigestFor,
  reportDigestFor,
  sourceOccurrenceCountFor,
  sourcePositionsForPacket,
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
export const CBRO_HISTORICAL_IDENTITY_SHA256 =
  'd5d75acf607bbddf1d76c3e5682973e86071f5bb969a1b3a17f0ffd69cbb3344';
export const CBRO_PACKET_REVIEW = 'MRT-003 central CBRO source review';
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
  const result = validateFrozenPacket(packet, {
    ...options,
    provider: CBRO_SOURCE_PROVIDER,
  });
  const inventoryRecord = options.inventoryRecord;
  if (inventoryRecord) {
    assert(inventoryRecord.sourceProvider === packet.sourceProvider,
      `${packet.id} provider differs from its inventory record`);
    assert((inventoryRecord.sourceSection ?? null) === (packet.sourceSection ?? null),
      `${packet.id} source section differs from its inventory record`);
    assert(inventoryRecord.sourceRetrievedAt === packet.sourceRetrievedAt,
      `${packet.id} retrieval date differs from its inventory record`);
    assert(inventoryRecord.sourceContentSha256 === packet.sourceContentSha256,
      `${packet.id} source content differs from its inventory record`);
    assert(inventoryRecord.sourceRowCount === sourceOccurrenceCountFor(packet),
      `${packet.id} source row count differs from its inventory record`);
  }
  return result;
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
    assert(['main', 'alternate'].includes(record.universeScope),
      `${label} universeScope is invalid`);
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
  const alternateIds = records
    .filter((record) => record.universeScope === 'alternate')
    .map((record) => record.id);
  assert(JSON.stringify(alternateIds) === JSON.stringify(['marvel-2099', 'mc2']),
    'CBRO alternate-universe identities changed');
  validateSourceIdentities(records.map((record) => ({
    url: record.sourceUrl,
    sourceSection: record.sourceSection,
  })));
  const identity = records.map(({
    catalogIds: _catalogIds,
    deliveryStatus: _deliveryStatus,
    ...record
  }) => record);
  assert(digestCanonicalJson(identity) === CBRO_HISTORICAL_IDENTITY_SHA256,
    'CBRO historical inventory identity digest changed');
  return true;
}

export function validateCbroReviewIdentity(mapping) {
  assert(mapping?.sourceProvider === CBRO_SOURCE_PROVIDER.id,
    `${mapping?.id ?? 'CBRO mapping'} has the wrong review provider`);
  assert(mapping?.packetReview === CBRO_PACKET_REVIEW,
    `${mapping?.id ?? 'CBRO mapping'} has the wrong packet review identity`);
  const review = mapping?.relationshipReview;
  assert(review?.sourceProvider === CBRO_SOURCE_PROVIDER.id,
    `${mapping?.id ?? 'CBRO mapping'} approval has the wrong provider`);
  assert(review?.packetReview === CBRO_PACKET_REVIEW,
    `${mapping?.id ?? 'CBRO mapping'} approval names a different packet review`);
  return true;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function recoverFileTransaction(journalFile) {
  if (!(await pathExists(journalFile))) return false;
  const journal = JSON.parse(await readFile(journalFile, 'utf8'));
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  const errors = [];
  for (const entry of entries.slice().reverse()) {
    try {
      if (entry.hadOriginal && await pathExists(entry.backup)) {
        if (await pathExists(entry.file)) await rm(entry.file, { force: true });
        await rename(entry.backup, entry.file);
      } else if (!entry.hadOriginal && await pathExists(entry.file)) {
        await rm(entry.file, { force: true });
      }
      if (await pathExists(entry.staged)) await rm(entry.staged, { force: true });
    } catch (error) {
      errors.push(`${entry.file}: ${error.message}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`CBRO transaction recovery failed:\n${errors.join('\n')}`);
  }
  await rm(journalFile, { force: true });
  return true;
}

export async function writeFilesAtomically(files, { journalFile }) {
  assert(Array.isArray(files) && files.length > 0, 'CBRO transaction needs output files');
  assert(typeof journalFile === 'string' && journalFile.trim(),
    'CBRO transaction needs a journal path');
  const destinations = files.map((entry) => path.resolve(entry.file));
  assert(new Set(destinations).size === destinations.length,
    'CBRO transaction contains duplicate output paths');
  await recoverFileTransaction(journalFile);

  const token = `${process.pid}-${Date.now()}`;
  const entries = files.map((entry, index) => ({
    file: path.resolve(entry.file),
    content: entry.content,
    staged: `${path.resolve(entry.file)}.cbro-${token}-${index}.tmp`,
    backup: `${path.resolve(entry.file)}.cbro-${token}-${index}.bak`,
    hadOriginal: false,
  }));
  try {
    for (const entry of entries) {
      await mkdir(path.dirname(entry.file), { recursive: true });
      await writeFile(entry.staged, entry.content, 'utf8');
      entry.hadOriginal = await pathExists(entry.file);
    }
  } catch (error) {
    const cleanupErrors = [];
    for (const entry of entries) {
      try {
        await rm(entry.staged, { force: true });
      } catch (cleanupError) {
        cleanupErrors.push(`${entry.staged}: ${cleanupError.message}`);
      }
    }
    const cleanup = cleanupErrors.length > 0
      ? ` Cleanup also failed:\n${cleanupErrors.join('\n')}`
      : '';
    throw new Error(`CBRO transaction staging failed: ${error.message}.${cleanup}`, { cause: error });
  }

  await mkdir(path.dirname(journalFile), { recursive: true });
  await writeFile(journalFile, `${JSON.stringify({
    schemaVersion: 1,
    entries: entries.map(({ content: _content, ...entry }) => entry),
  }, null, 2)}\n`, 'utf8');
  try {
    for (const entry of entries) {
      if (entry.hadOriginal) await rename(entry.file, entry.backup);
    }
    for (const entry of entries) await rename(entry.staged, entry.file);
  } catch (error) {
    let recoveryError = null;
    try {
      await recoverFileTransaction(journalFile);
    } catch (failedRecovery) {
      recoveryError = failedRecovery;
    }
    const recovery = recoveryError == null
      ? ''
      : ` Recovery also failed: ${recoveryError.message}`;
    throw new Error(`CBRO transaction publish failed: ${error.message}.${recovery}`, { cause: error });
  }

  await rm(journalFile, { force: true });
  const cleanupErrors = [];
  for (const entry of entries) {
    try {
      if (entry.hadOriginal) await rm(entry.backup, { force: true });
    } catch (error) {
      cleanupErrors.push(`${entry.backup}: ${error.message}`);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new Error(`CBRO transaction committed but backup cleanup failed:\n${cleanupErrors.join('\n')}`);
  }
}

export {
  approvalDigestFor,
  canonicalJson,
  digestCanonicalJson,
  mappingDigestFor,
  packetDigestFor,
  reportDigestFor,
  sourceOccurrenceCountFor,
  sourcePositionsForPacket,
  validateApprovalDigest,
  validateMappingDigest,
  validateReportDigest,
  validateSourceIdentities,
};
