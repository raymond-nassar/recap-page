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
  '0f5f60b419db40b842cbfebc258315b1a4a1a99c2fd37f7be8e6d8a191a76b4e';
export const CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256 =
  '0fb172f493fff2d6001a9c8c3bf2efaf756c40566056df00373a3f18e58c7316';
export const CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256 =
  '7e631e916a3c79372ac099ebd5c5741fc23787a962e387f357224282eb3187d6';
export const CBRO_PACKET_REVIEW = 'MRT-003 central CBRO source review';
export const CBRO_SELECTED_IDS = Object.freeze([
  'muir-island-saga',
  'bloodties',
  'midnight-massacre',
  'childs-play',
  'eighth-day',
]);
export const CBRO_AUTHOR_IDS = Object.freeze([
  'muir-island-saga',
  'midnight-massacre',
  'bloodties',
  'childs-play',
  'eighth-day',
]);
export const CBRO_CONTINUATION_SELECTED_IDS = Object.freeze([
  'reed-richards-and-sue-storms-wedding',
  'kree-skrull-war',
  'the-night-gwen-stacy-died',
  'avengers-defenders-war',
  'thanos-war',
]);
export const CBRO_CONTINUATION_AUTHOR_IDS = Object.freeze([
  'reed-richards-and-sue-storms-wedding',
  'kree-skrull-war',
  'thanos-war',
  'the-night-gwen-stacy-died',
  'avengers-defenders-war',
]);
export const CBRO_BATCH_TWO_SELECTED_IDS = Object.freeze([
  'original-clone-saga',
  'phoenix-saga',
  'dark-phoenix-saga',
  'days-of-future-past',
  'contest-of-champions',
]);
export const CBRO_BATCH_TWO_AUTHOR_IDS = CBRO_BATCH_TWO_SELECTED_IDS;
export const CBRO_BATCH_THREE_SELECTED_IDS = Object.freeze([
  'marvel-super-heroes-secret-wars',
  'kravens-last-hunt',
  'fall-of-the-mutants',
]);
export const CBRO_BATCH_THREE_AUTHOR_IDS = Object.freeze([
  'marvel-super-heroes-secret-wars',
  'fall-of-the-mutants',
  'kravens-last-hunt',
]);
export const CBRO_BATCH_THREE_BLOCKED_IDS = Object.freeze([
  'wraith-war',
  'secret-wars-ii',
  'mutant-massacre',
]);
export const CBRO_BATCH_THREE_TOUCHED_IDS = Object.freeze([
  'marvel-super-heroes-secret-wars',
  ...CBRO_BATCH_THREE_BLOCKED_IDS,
  'kravens-last-hunt',
  'fall-of-the-mutants',
]);
export const CBRO_CONTINUATION_PACKET_REVIEW =
  'MRT-003-C02 batch 1 central CBRO source review';
export const CBRO_BATCH_TWO_PACKET_REVIEW =
  'MRT-003-C02 batch 2 central CBRO source review';
export const CBRO_BATCH_THREE_PACKET_REVIEW =
  'MRT-003-C02 batch 3 central CBRO source review';
export const CBRO_RELEASE_IDS = Object.freeze({
  original: 'mrt-003',
  continuationBatchOne: 'mrt-003-c02-b01',
  continuationBatchTwo: 'mrt-003-c02-b02',
  continuationBatchThree: 'mrt-003-c02-b03',
});
export const CBRO_RELATIONSHIP_DECISIONS = Object.freeze({
  [CBRO_RELEASE_IDS.continuationBatchOne]: Object.freeze([
    Object.freeze({
      candidateId: 'kree-skrull-war',
      orderId: 'essential-avengers',
      relationship: 'candidate-subset',
      sharedIds: Object.freeze(['7342', '7344', '7345', '7346', '7347', '7348', '7349', '7350', '7351']),
      rationale: 'The compact nine-issue event route has a distinct purpose from the 120-issue Essential Avengers guide.',
    }),
  ]),
  [CBRO_RELEASE_IDS.continuationBatchTwo]: Object.freeze([
    Object.freeze({
      candidateId: 'phoenix-saga',
      orderId: 'xmen-claremont',
      relationship: 'candidate-subset',
      sharedIds: Object.freeze(['12416', '12417', '12418', '12419', '12420', '12421', '12422', '12423']),
      rationale: 'The exact eight-issue Phoenix event route has a distinct purpose from the broader X-Men chronology.',
    }),
    Object.freeze({
      candidateId: 'phoenix-saga',
      orderId: 'xmen-claremont-complete',
      relationship: 'candidate-subset',
      sharedIds: Object.freeze(['12416', '12417', '12418', '12419', '12420', '12421', '12422', '12423']),
      rationale: 'The exact eight-issue Phoenix event route has a distinct purpose from the broader optional X-Men chronology.',
    }),
    Object.freeze({
      candidateId: 'dark-phoenix-saga',
      orderId: 'xmen-claremont',
      relationship: 'candidate-subset',
      sharedIds: Object.freeze(['12446', '12448', '12449', '12450', '12451', '12452', '12453', '12454', '12455']),
      rationale: 'The exact nine-issue Dark Phoenix event route has a distinct purpose from the broader X-Men chronology.',
    }),
    Object.freeze({
      candidateId: 'dark-phoenix-saga',
      orderId: 'xmen-claremont-complete',
      relationship: 'candidate-subset',
      sharedIds: Object.freeze(['12446', '12448', '12449', '12450', '12451', '12452', '12453', '12454', '12455']),
      rationale: 'The exact nine-issue Dark Phoenix event route has a distinct purpose from the broader optional X-Men chronology.',
    }),
    Object.freeze({
      candidateId: 'days-of-future-past',
      orderId: 'xmen-claremont',
      relationship: 'candidate-subset',
      sharedIds: Object.freeze(['12460', '13683']),
      rationale: 'The exact two-issue Days of Future Past event route has a distinct purpose from the broader X-Men chronology.',
    }),
    Object.freeze({
      candidateId: 'days-of-future-past',
      orderId: 'xmen-claremont-complete',
      relationship: 'candidate-subset',
      sharedIds: Object.freeze(['12460', '13683']),
      rationale: 'The exact two-issue Days of Future Past event route has a distinct purpose from the broader optional X-Men chronology.',
    }),
    Object.freeze({
      candidateId: 'days-of-future-past',
      orderId: 'marvel-multiverse',
      relationship: 'partial',
      sharedIds: Object.freeze(['13683']),
      rationale: 'The exact two-issue Days of Future Past event route preserves its source-backed sequence while Marvel Multiverse has one shared reference in a different companion context.',
    }),
  ]),
  [CBRO_RELEASE_IDS.continuationBatchThree]: Object.freeze([
    Object.freeze({
      candidateId: 'marvel-super-heroes-secret-wars',
      orderId: 'doctor-doom-primer',
      relationship: 'candidate-subset',
      sharedIds: Object.freeze([
        '10580', '10584', '10585', '10586', '10587', '10588',
        '10589', '10590', '10591', '10581', '10582', '10583',
      ]),
      rationale: 'The exact twelve-issue event route has a distinct purpose from the broader Doctor Doom primer.',
    }),
    Object.freeze({
      candidateId: 'kravens-last-hunt',
      orderId: 'spider-man-best-of',
      relationship: 'partial',
      sharedIds: Object.freeze(['12027', '6697', '14578', '12028', '6698', '14579']),
      rationale: 'The exact seven-issue source route retains the 1992 epilogue while the broader Spider-Man guide shares the six-issue core.',
    }),
    Object.freeze({
      candidateId: 'fall-of-the-mutants',
      orderId: 'captain-america-best-of',
      relationship: 'partial',
      sharedIds: Object.freeze(['7720']),
      rationale: 'The exact event route and the broader Captain America guide share one issue for different reader purposes.',
    }),
    Object.freeze({
      candidateId: 'fall-of-the-mutants',
      orderId: 'xmen-claremont',
      relationship: 'partial',
      sharedIds: Object.freeze([
        '12233', '12234', '12236', '12237', '12238', '12239',
        '13761', '13762', '13763', '13764', '13765',
      ]),
      rationale: 'The exact event route interleaves twenty-nine issues while the broader X-Men chronology shares eleven chapters.',
    }),
    Object.freeze({
      candidateId: 'fall-of-the-mutants',
      orderId: 'xmen-claremont-complete',
      relationship: 'partial',
      sharedIds: Object.freeze([
        '12233', '12234', '12236', '12237', '12238', '12239',
        '13761', '13762', '13763', '13764', '13765',
      ]),
      rationale: 'The exact event route interleaves twenty-nine issues while the broader optional X-Men chronology shares eleven chapters.',
    }),
  ]),
});
export const CBRO_RELEASES = Object.freeze({
  [CBRO_RELEASE_IDS.original]: Object.freeze({
    id: CBRO_RELEASE_IDS.original,
    sourceIds: CBRO_SELECTED_IDS,
    authorIds: CBRO_AUTHOR_IDS,
    packetReview: CBRO_PACKET_REVIEW,
    authorityIdentity: 'MRT-003 coordinator',
    relationshipReviewRationale: 'Every current library and selected peer comparison was reviewed; all relationships are none.',
  }),
  [CBRO_RELEASE_IDS.continuationBatchOne]: Object.freeze({
    id: CBRO_RELEASE_IDS.continuationBatchOne,
    sourceIds: CBRO_CONTINUATION_SELECTED_IDS,
    authorIds: CBRO_CONTINUATION_AUTHOR_IDS,
    packetReview: CBRO_CONTINUATION_PACKET_REVIEW,
    authorityIdentity: 'MRT-003-C02 coordinator',
    relationshipReviewRationale: 'Every current library and selected peer comparison was reviewed; the Kree-Skrull War subset is the only approved non-none relationship.',
  }),
  [CBRO_RELEASE_IDS.continuationBatchTwo]: Object.freeze({
    id: CBRO_RELEASE_IDS.continuationBatchTwo,
    sourceIds: CBRO_BATCH_TWO_SELECTED_IDS,
    authorIds: CBRO_BATCH_TWO_AUTHOR_IDS,
    packetReview: CBRO_BATCH_TWO_PACKET_REVIEW,
    authorityIdentity: 'MRT-003-C02-B02 coordinator',
    relationshipReviewRationale: 'Every current library and selected peer comparison was reviewed; only the seven named X-Men and Marvel Multiverse relationships are approved non-none relationships.',
  }),
  [CBRO_RELEASE_IDS.continuationBatchThree]: Object.freeze({
    id: CBRO_RELEASE_IDS.continuationBatchThree,
    sourceIds: CBRO_BATCH_THREE_SELECTED_IDS,
    authorIds: CBRO_BATCH_THREE_AUTHOR_IDS,
    packetReview: CBRO_BATCH_THREE_PACKET_REVIEW,
    authorityIdentity: 'MRT-003-C02-B03 coordinator',
    relationshipReviewRationale: 'Every current library and selected peer comparison was reviewed; only the five named Secret Wars, Spider-Man, Captain America, and X-Men relationships are approved non-none relationships.',
  }),
});
export const CBRO_ALL_SELECTED_IDS = Object.freeze([
  ...CBRO_CONTINUATION_SELECTED_IDS,
  ...CBRO_BATCH_TWO_SELECTED_IDS,
  ...CBRO_BATCH_THREE_SELECTED_IDS,
  ...CBRO_SELECTED_IDS,
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
  'approved-mixed',
  'unresolved',
  'not-applicable',
]);

const SELECTED_INVENTORY_RELATIONSHIPS = Object.freeze({
  'kree-skrull-war': Object.freeze({
    relationshipStatus: 'candidate-subset',
    overlapIds: Object.freeze(['essential-avengers']),
  }),
  'phoenix-saga': Object.freeze({
    relationshipStatus: 'candidate-subset',
    overlapIds: Object.freeze(['xmen-claremont', 'xmen-claremont-complete']),
  }),
  'dark-phoenix-saga': Object.freeze({
    relationshipStatus: 'candidate-subset',
    overlapIds: Object.freeze(['xmen-claremont', 'xmen-claremont-complete']),
  }),
  'days-of-future-past': Object.freeze({
    relationshipStatus: 'approved-mixed',
    overlapIds: Object.freeze(['marvel-multiverse', 'xmen-claremont', 'xmen-claremont-complete']),
  }),
  'marvel-super-heroes-secret-wars': Object.freeze({
    relationshipStatus: 'candidate-subset',
    overlapIds: Object.freeze(['doctor-doom-primer']),
  }),
  'kravens-last-hunt': Object.freeze({
    relationshipStatus: 'approved-mixed',
    overlapIds: Object.freeze(['spider-man-best-of']),
  }),
  'fall-of-the-mutants': Object.freeze({
    relationshipStatus: 'approved-mixed',
    overlapIds: Object.freeze([
      'captain-america-best-of',
      'xmen-claremont',
      'xmen-claremont-complete',
    ]),
  }),
});
const BATCH_THREE_BLOCKED_REASONS = Object.freeze({
  'wraith-war': 'Metadata blocked: the configured snapshot has no historical ROM or ROM Annual series, leaving 30 of 35 source rows unresolved.',
  'secret-wars-ii': 'Metadata blocked: ROM #72 and Micronauts Vol. 2 #16 have no exact configured metadata series.',
  'mutant-massacre': 'Metadata blocked: Power Pack #27 is absent from the configured Power Pack series.',
});
const INVENTORY_DELIVERY = new Set(['ready', 'shipped', 'deferred', 'blocked', 'not-applicable']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/.test(String(value ?? ''));
}

export function cbroReleaseForIds(ids, { order = 'source' } = {}) {
  assert(Array.isArray(ids) && ids.length > 0, 'CBRO release ids are required');
  assert(new Set(ids).size === ids.length, 'CBRO release ids contain a duplicate');
  const key = order === 'source' ? 'sourceIds' : order === 'author' ? 'authorIds' : null;
  assert(key, `Unknown CBRO release order: ${order}`);
  const release = Object.values(CBRO_RELEASES).find((candidate) => (
    canonicalJson(ids) === canonicalJson(candidate[key])
  ));
  const orderLabel = order === 'author' ? 'chronology' : order;
  assert(release,
    `CBRO ${order} operation requires one complete 5-guide release in known ${orderLabel} order`);
  return release;
}

export function cbroReleaseForId(id) {
  const releases = Object.values(CBRO_RELEASES).filter((release) => (
    release.sourceIds.includes(id)
  ));
  assert(releases.length === 1, `Unknown or repeated CBRO release id: ${id}`);
  return releases[0];
}

export function cbroRelationshipDecisionFor(id, comparison) {
  const release = cbroReleaseForId(id);
  const decisions = CBRO_RELATIONSHIP_DECISIONS[release.id] ?? [];
  return decisions.find((decision) => (
    decision.candidateId === id
    && decision.orderId === comparison?.orderId
    && decision.relationship === comparison?.relationship
    && canonicalJson(decision.sharedIds) === canonicalJson(comparison?.sharedIds)
  )) ?? null;
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
      const expected = SELECTED_INVENTORY_RELATIONSHIPS[record.id] ?? {
        relationshipStatus: 'none',
        overlapIds: [],
      };
      assert(
        ['ready', 'shipped'].includes(record.deliveryStatus)
          && record.relationshipStatus === expected.relationshipStatus
          && canonicalJson(record.overlapIds) === canonicalJson(expected.overlapIds),
        `${label} selected state is inconsistent`,
      );
      assert(record.deliveryStatus === 'ready'
        ? record.catalogIds.length === 0
        : JSON.stringify(record.catalogIds) === JSON.stringify([record.id]),
      `${label} selected catalog state is inconsistent`);
      selected.push(record.id);
    }
    if (CBRO_BATCH_THREE_BLOCKED_IDS.includes(record.id)) {
      assert(
        record.centralDisposition === 'blocked'
          && record.relationshipStatus === 'unresolved'
          && record.reason === BATCH_THREE_BLOCKED_REASONS[record.id]
          && record.overlapIds.length === 0
          && record.catalogIds.length === 0
          && record.deliveryStatus === 'blocked',
        `${label} batch-three blocked state is inconsistent`,
      );
    }
  }
  assert(JSON.stringify(selected) === JSON.stringify(CBRO_ALL_SELECTED_IDS),
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
  const batchTwoNonselected = records
    .filter((record) => !CBRO_BATCH_TWO_SELECTED_IDS.includes(record.id))
    .map((record) => CBRO_BATCH_THREE_TOUCHED_IDS.includes(record.id)
      ? {
        ...record,
        centralDisposition: 'deferred',
        relationshipStatus: 'unresolved',
        reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
        overlapIds: [],
        catalogIds: [],
        deliveryStatus: 'deferred',
        sourceRetrievedAt: '2026-08-23',
      }
      : record);
  assert(digestCanonicalJson(batchTwoNonselected) === CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256,
    'CBRO batch-two nonselected inventory changed');
  const batchThreeNonselected = records
    .filter((record) => !CBRO_BATCH_THREE_TOUCHED_IDS.includes(record.id))
    .map((record) => CBRO_ALL_SELECTED_IDS.includes(record.id)
      ? {
        ...record,
        catalogIds: [record.id],
        deliveryStatus: 'shipped',
      }
      : record);
  assert(
    digestCanonicalJson(batchThreeNonselected)
      === CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256,
    'CBRO batch-three nonselected inventory changed',
  );
  return true;
}

export function validateCbroReviewIdentity(mapping) {
  const release = cbroReleaseForId(mapping?.id);
  assert(mapping?.sourceProvider === CBRO_SOURCE_PROVIDER.id,
    `${mapping?.id ?? 'CBRO mapping'} has the wrong review provider`);
  assert(mapping?.packetReview === release.packetReview,
    `${mapping?.id ?? 'CBRO mapping'} has the wrong packet review identity`);
  const review = mapping?.relationshipReview;
  assert(review?.sourceProvider === CBRO_SOURCE_PROVIDER.id,
    `${mapping?.id ?? 'CBRO mapping'} approval has the wrong provider`);
  assert(review?.packetReview === release.packetReview,
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
