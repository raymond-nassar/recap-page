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
  '2ca31d5863727481b62dda737785b7e7aa16fef810c8dd4d0f6a8288e2ab7ba7';
export const CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256 =
  '0fb172f493fff2d6001a9c8c3bf2efaf756c40566056df00373a3f18e58c7316';
export const CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256 =
  '7e631e916a3c79372ac099ebd5c5741fc23787a962e387f357224282eb3187d6';
export const CBRO_BATCH_THREE_BLOCKED_OUTCOME_SHA256 =
  'ef9445dd5b17bc105814c61b12db95dc94e4c09d9bbd6c3d199f2d1539e7b80f';
export const CBRO_BATCH_FOUR_UNTOUCHED_INVENTORY_SHA256 =
  '4c608fefbe04fe99279c1e4cbdcfb53bd9ef5665e2f4919f361dc23f5ddf4ebb';
export const CBRO_BATCH_FOUR_EXCLUSION_SHA256 = Object.freeze({
  'wraith-war': '655e90fb94d358bd0d9371d43c3068fac050e57dfe2f067cd411b813a6f03b9a',
  'secret-wars-ii': '6764ebd3f7f4bdf7c103ce2f315068649da79f9bec78ec995ce78493418311fd',
  'mutant-massacre': '7a9096e23f0f407903caed939afa6205c3301768823e58a2b43314988374f24a',
});
export const CBRO_BATCH_FIVE_UNTOUCHED_INVENTORY_SHA256 =
  'efadd62002b97b3592b2cc79cf4ce9eef8145c4f06190d3b05d8f094c8a45695';
export const CBRO_BATCH_FIVE_EVALUATED_OUTCOME_SHA256 =
  'cd874154fdc29686562d28da936456285d682b02c493042e84384cc553876f17';
export const CBRO_BATCH_FIVE_ACTS_SOURCE_ROWS_SHA256 =
  '8403e921027e842daf6968479de03f95d03adaeb0d300fd7c8a32476e460c9f3';
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
export const CBRO_BATCH_FOUR_SELECTED_IDS = CBRO_BATCH_THREE_BLOCKED_IDS;
export const CBRO_BATCH_FOUR_AUTHOR_IDS = CBRO_BATCH_FOUR_SELECTED_IDS;
export const CBRO_BATCH_FIVE_SELECTED_IDS = Object.freeze([
  'evolutionary-war',
  'inferno',
  'atlantis-attacks',
  'days-of-future-present',
]);
export const CBRO_BATCH_FIVE_AUTHOR_IDS = CBRO_BATCH_FIVE_SELECTED_IDS;
export const CBRO_BATCH_FIVE_TOUCHED_IDS = Object.freeze([
  'evolutionary-war',
  'inferno',
  'atlantis-attacks',
  'acts-of-vengeance',
  'days-of-future-present',
  'x-tinction-agenda',
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
export const CBRO_BATCH_FOUR_PACKET_REVIEW =
  'MRT-003-C02-B04 central CBRO exclusion review';
export const CBRO_BATCH_FIVE_PACKET_REVIEW =
  'MRT-003-C02-B05 central CBRO source review';
export const CBRO_RELEASE_IDS = Object.freeze({
  original: 'mrt-003',
  continuationBatchOne: 'mrt-003-c02-b01',
  continuationBatchTwo: 'mrt-003-c02-b02',
  continuationBatchThree: 'mrt-003-c02-b03',
  continuationBatchFour: 'mrt-003-c02-b04',
  continuationBatchFive: 'mrt-003-c02-b05',
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
  [CBRO_RELEASE_IDS.continuationBatchFour]: Object.freeze([
    Object.freeze({
      candidateId: 'wraith-war',
      orderId: 'xmen-claremont',
      relationship: 'partial',
      sharedIds: Object.freeze(['13726', '13727', '13728', '13729']),
      rationale: 'The selected seven-chapter route keeps the Wraith War sequence while the broader X-Men chronology shares its four Uncanny X-Men chapters.',
    }),
    Object.freeze({
      candidateId: 'wraith-war',
      orderId: 'xmen-claremont-complete',
      relationship: 'partial',
      sharedIds: Object.freeze(['13726', '13727', '13728', '13729']),
      rationale: 'The selected seven-chapter route keeps the Wraith War sequence while the broader optional X-Men chronology shares its four Uncanny X-Men chapters.',
    }),
    Object.freeze({
      candidateId: 'secret-wars-ii',
      orderId: 'doctor-doom-primer',
      relationship: 'partial',
      sharedIds: Object.freeze(['13103']),
      rationale: 'The selected event route and the broader Doctor Doom primer share one Fantastic Four chapter for different reader purposes.',
    }),
    Object.freeze({
      candidateId: 'secret-wars-ii',
      orderId: 'essential-avengers',
      relationship: 'partial',
      sharedIds: Object.freeze(['7131', '7132']),
      rationale: 'The selected event route and the broader Essential Avengers guide share two Avengers chapters for different reader purposes.',
    }),
    Object.freeze({
      candidateId: 'secret-wars-ii',
      orderId: 'xmen-claremont',
      relationship: 'partial',
      sharedIds: Object.freeze(['10367', '13737', '10373', '13743', '10374', '13744']),
      rationale: 'The selected event route interleaves forty chapters while the broader X-Men chronology shares six X-Men family chapters.',
    }),
    Object.freeze({
      candidateId: 'secret-wars-ii',
      orderId: 'xmen-claremont-complete',
      relationship: 'partial',
      sharedIds: Object.freeze(['10367', '13737', '10373', '13743', '10374', '13744']),
      rationale: 'The selected event route interleaves forty chapters while the broader optional X-Men chronology shares six X-Men family chapters.',
    }),
    Object.freeze({
      candidateId: 'mutant-massacre',
      orderId: 'xmen-claremont',
      relationship: 'candidate-subset',
      sharedIds: Object.freeze([
        '13751', '12312', '13752', '12175', '10384', '11701',
        '13753', '11702', '12186', '13754', '8227',
      ]),
      rationale: 'The selected eleven-chapter Mutant Massacre route has a distinct event purpose inside the broader X-Men chronology.',
    }),
    Object.freeze({
      candidateId: 'mutant-massacre',
      orderId: 'xmen-claremont-complete',
      relationship: 'candidate-subset',
      sharedIds: Object.freeze([
        '13751', '12312', '13752', '12175', '10384', '11701',
        '13753', '11702', '12186', '13754', '8227',
      ]),
      rationale: 'The selected eleven-chapter Mutant Massacre route has a distinct event purpose inside the broader optional X-Men chronology.',
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
  [CBRO_RELEASE_IDS.continuationBatchFour]: Object.freeze({
    id: CBRO_RELEASE_IDS.continuationBatchFour,
    sourceIds: CBRO_BATCH_FOUR_SELECTED_IDS,
    authorIds: CBRO_BATCH_FOUR_AUTHOR_IDS,
    packetReview: CBRO_BATCH_FOUR_PACKET_REVIEW,
    authorityIdentity: 'MRT-003-C02-B04 coordinator',
    relationshipReviewRationale: 'Every current library and selected peer comparison was reviewed; only the eight named X-Men, Avengers, Doctor Doom, and peer relationships are approved non-none relationships.',
  }),
  [CBRO_RELEASE_IDS.continuationBatchFive]: Object.freeze({
    id: CBRO_RELEASE_IDS.continuationBatchFive,
    sourceIds: CBRO_BATCH_FIVE_SELECTED_IDS,
    authorIds: CBRO_BATCH_FIVE_AUTHOR_IDS,
    packetReview: CBRO_BATCH_FIVE_PACKET_REVIEW,
    authorityIdentity: 'MRT-003-C02-B05 coordinator',
    relationshipReviewRationale: 'Every current library and selected peer comparison was reviewed; all relationships are none.',
  }),
});
const CBRO_PRE_BATCH_FIVE_SELECTED_IDS = Object.freeze([
  ...CBRO_CONTINUATION_SELECTED_IDS,
  ...CBRO_BATCH_TWO_SELECTED_IDS,
  CBRO_BATCH_THREE_SELECTED_IDS[0],
  ...CBRO_BATCH_FOUR_SELECTED_IDS,
  ...CBRO_BATCH_THREE_SELECTED_IDS.slice(1),
  ...CBRO_SELECTED_IDS,
]);
export const CBRO_ALL_SELECTED_IDS = Object.freeze([
  ...CBRO_CONTINUATION_SELECTED_IDS,
  ...CBRO_BATCH_TWO_SELECTED_IDS,
  CBRO_BATCH_THREE_SELECTED_IDS[0],
  ...CBRO_BATCH_FOUR_SELECTED_IDS,
  ...CBRO_BATCH_THREE_SELECTED_IDS.slice(1),
  ...CBRO_BATCH_FIVE_SELECTED_IDS,
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
  'wraith-war': Object.freeze({
    relationshipStatus: 'approved-mixed',
    overlapIds: Object.freeze(['xmen-claremont', 'xmen-claremont-complete']),
  }),
  'secret-wars-ii': Object.freeze({
    relationshipStatus: 'approved-mixed',
    overlapIds: Object.freeze([
      'doctor-doom-primer',
      'essential-avengers',
      'xmen-claremont',
      'xmen-claremont-complete',
    ]),
  }),
  'mutant-massacre': Object.freeze({
    relationshipStatus: 'candidate-subset',
    overlapIds: Object.freeze(['xmen-claremont', 'xmen-claremont-complete']),
  }),
});
const BATCH_THREE_BLOCKED_REASONS = Object.freeze({
  'wraith-war': 'Metadata blocked: the configured snapshot has no historical ROM or ROM Annual series, leaving 30 of 35 source rows unresolved.',
  'secret-wars-ii': 'Metadata blocked: ROM #72 and Micronauts Vol. 2 #16 have no exact configured metadata series.',
  'mutant-massacre': 'Metadata blocked: Power Pack #27 is absent from the configured Power Pack series.',
});
const BATCH_FIVE_PREDECESSOR_STATE = Object.freeze({
  'evolutionary-war': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: '6b35cd2eae7824b7390f3689da4dfc9dfbe1c65e64d0ae0ae81c7ddd8dd490cb',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  inferno: Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: 'c42ec517939a11e2516fbf5dd23b90a597fa4889079ab8d53a57776531911f47',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'atlantis-attacks': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: '584a86ea763ec9c5fe3a6c86546170eccdb7132c397d8761781d645955ad1614',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'acts-of-vengeance': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: 'a04eaef3efb4b5b94c287c8bf8e584e2e2d730a7987883669f30097ffa0bd751',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'days-of-future-present': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: '70fd8a780349c17c370adf0aff4510f6a63155ae54e414124ea4c8707ef6755c',
    centralDisposition: 'blocked',
    relationshipStatus: 'unresolved',
    reason: 'Blocked because Uncanny X-Men Annual #14 is absent from the configured metadata snapshot.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'blocked',
  }),
  'x-tinction-agenda': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: 'f2e2a0ed1b0ad41deb2abfb54f1a6af87ff27b8674b2f32a5b175854bf533e51',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
});
const INVENTORY_DELIVERY = new Set(['ready', 'shipped', 'deferred', 'blocked', 'not-applicable']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/.test(String(value ?? ''));
}

export function cbroBatchFivePredecessorRecord(record) {
  const state = BATCH_FIVE_PREDECESSOR_STATE[record.id];
  return state ? { ...record, ...state } : record;
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
    `CBRO ${order} operation requires one complete known release in ${orderLabel} order`);
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
  const approvedExclusionDigest = CBRO_BATCH_FOUR_EXCLUSION_SHA256[packet.id];
  if (approvedExclusionDigest) {
    assert(
      Array.isArray(packet.excludedSourceRows)
        && digestCanonicalJson(packet.excludedSourceRows) === approvedExclusionDigest,
      `${packet.id} packet differs from its approved exclusion ledger`,
    );
  }
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
    .map(cbroBatchFivePredecessorRecord)
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
    .map(cbroBatchFivePredecessorRecord)
    .map((record) => CBRO_PRE_BATCH_FIVE_SELECTED_IDS.includes(record.id)
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
  const batchThreeBlockedOutcomes = records
    .filter((record) => CBRO_BATCH_THREE_BLOCKED_IDS.includes(record.id))
    .map((record) => ({
      ...record,
      centralDisposition: 'blocked',
      relationshipStatus: 'unresolved',
      reason: BATCH_THREE_BLOCKED_REASONS[record.id],
      overlapIds: [],
      catalogIds: [],
      deliveryStatus: 'blocked',
    }));
  assert(
    digestCanonicalJson(batchThreeBlockedOutcomes)
      === CBRO_BATCH_THREE_BLOCKED_OUTCOME_SHA256,
    'CBRO batch-three blocked outcome compatibility changed',
  );
  const batchFourUntouched = records
    .filter((record) => !CBRO_BATCH_FOUR_SELECTED_IDS.includes(record.id))
    .map(cbroBatchFivePredecessorRecord)
    .map((record) => CBRO_PRE_BATCH_FIVE_SELECTED_IDS.includes(record.id)
      ? {
        ...record,
        catalogIds: [record.id],
        deliveryStatus: 'shipped',
      }
      : record);
  assert(
    digestCanonicalJson(batchFourUntouched)
      === CBRO_BATCH_FOUR_UNTOUCHED_INVENTORY_SHA256,
    'CBRO batch-four untouched inventory changed',
  );
  const batchFiveUntouched = records
    .filter((record) => !CBRO_BATCH_FIVE_TOUCHED_IDS.includes(record.id))
    .map((record) => CBRO_ALL_SELECTED_IDS.includes(record.id)
      ? {
        ...record,
        catalogIds: [record.id],
        deliveryStatus: 'shipped',
      }
      : record);
  assert(
    digestCanonicalJson(batchFiveUntouched)
      === CBRO_BATCH_FIVE_UNTOUCHED_INVENTORY_SHA256,
    'CBRO batch-five untouched inventory changed',
  );
  const batchFiveEvaluatedOutcomes = records
    .filter((record) => CBRO_BATCH_FIVE_TOUCHED_IDS.includes(record.id))
    .map((record) => CBRO_BATCH_FIVE_SELECTED_IDS.includes(record.id)
      ? { ...record, catalogIds: [], deliveryStatus: 'ready' }
      : record);
  assert(
    digestCanonicalJson(batchFiveEvaluatedOutcomes)
      === CBRO_BATCH_FIVE_EVALUATED_OUTCOME_SHA256,
    'CBRO batch-five evaluated outcome changed',
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
