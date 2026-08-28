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
export const CBRO_MARVEL_2099_BLOCKER_REASON =
  'Blocked: 99 source rows lack exact configured issue metadata across 13 source series; the complete 271-row alternate-universe order cannot publish.';
export const CBRO_MARVEL_2099_UNMATCHED_IDENTITY_SHA256 =
  '62344e2d6898b7d8bcd9eab1d7686acc0d3c6adb0fa7a8e60da56b6e2e815aa3';
export const CBRO_HISTORICAL_IDENTITY_SHA256 =
  'ccf035562d73169d664e58965f52c7ccd70fc547b7b68aa8404e83bb7152763c';
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
export const CBRO_BATCH_SIX_UNTOUCHED_INVENTORY_SHA256 =
  'af31379e604969573f33e97429cb2a26470fd566090b8bc42e27b78ad3565199';
export const CBRO_BATCH_SIX_EVALUATED_OUTCOME_SHA256 =
  'b0ebfc3719069036ec3ed42740efac39f3a7c7d0e60b0733fbfa5b3f3705c248';
export const CBRO_BATCH_SEVEN_UNTOUCHED_INVENTORY_SHA256 =
  'a2f877171d195bb40010bd9c18c3e21f989d3fc9aa33dde0aedc48bb2471e1b4';
export const CBRO_BATCH_SEVEN_EVALUATED_OUTCOME_SHA256 =
  '83369725800df2209885c4e613d2bf975a95adfdba59a27d7faa1dc9bc5d3fb7';
export const CBRO_BATCH_EIGHT_UNTOUCHED_INVENTORY_SHA256 =
  '022521feb4be8ec2a0585567a88b377b15e86bfc06edf50dc3eecac2bae8b33e';
export const CBRO_BATCH_EIGHT_EVALUATED_OUTCOME_SHA256 =
  'd77f4c6f15a21b524a01b4f4a834867a5b86226acd32ff9b244ed88201bb4585';
export const CBRO_BATCH_NINE_UNTOUCHED_INVENTORY_SHA256 =
  '961fcc9ca2e340236d6becd38734632a618318660efe85c49eca813e4ceaa5fd';
export const CBRO_BATCH_NINE_EVALUATED_OUTCOME_SHA256 =
  '486e8e72c2cbe226e17780a0bb4c9c3ab93b4a059eff7e234e02015d271cc5ff';
export const CBH_LATER_ORDER_IDS = Object.freeze([
  'captain-marvel-ms-marvel-reading-order',
  'captain-marvel-ms-marvel-reading-order',
  'black-panther-reading-order',
  'doctor-strange-reading-order',
  'daredevil-reading-order',
  'wolverine-reading-order',
  'hickman-x-men',
  'ultimate-marvel-intro',
  'setup-to-modern-timeline',
  'x-men-utopia',
  'x-men-messiah-to-avx',
  'abomination-reading-order',
  'agents-of-atlas-reading-order',
  'amazing-spider-man-reading-order-modern-marvel-era',
  'iron-man-reading-order',
  'ant-man-reading-order',
  'agatha-harkness-reading-order',
  'captain-america-reading-order-modern-marvel-era',
  'wandavision',
  'spider-man-far-from-home',
  'modern-x-men-fast-track',
  'question-of-the-week-do-you-have-a-hulk-reading-order',
  'deadpool-best-of',
  'the-defenders-reading-order',
  'marvel-knights-to-planet-x',
  'punisher-reading-order',
  'venom-reading-order',
  'magneto-reading-order',
  'loki-reading-order',
  'moon-knight-reading-order',
  'x-force-reading-order',
  'fantastic-four-reading-order',
  'nick-fury-reading-order',
  'inhumans-reading-order',
]);
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
export const CBRO_BATCH_SIX_SELECTED_IDS = Object.freeze([
  'x-tinction-agenda',
  'operation-galactic-storm',
  'dead-mans-hand',
  'rise-of-the-midnight-sons',
]);
export const CBRO_BATCH_SIX_AUTHOR_IDS = CBRO_BATCH_SIX_SELECTED_IDS;
export const CBRO_BATCH_SIX_TOUCHED_IDS = Object.freeze([
  'x-tinction-agenda',
  'infinity-gauntlet',
  'operation-galactic-storm',
  'infinity-war',
  'dead-mans-hand',
  'rise-of-the-midnight-sons',
]);
export const CBRO_BATCH_SEVEN_SELECTED_IDS = Object.freeze([
  'x-cutioners-song',
  'mys-tech-wars',
  'fatal-attractions',
]);
export const CBRO_BATCH_SEVEN_AUTHOR_IDS = CBRO_BATCH_SEVEN_SELECTED_IDS;
export const CBRO_BATCH_SEVEN_TOUCHED_IDS = Object.freeze([
  'x-cutioners-song',
  'mys-tech-wars',
  'for-love-nor-money',
  'maximum-carnage',
  'infinity-crusade',
  'blood-and-thunder',
  'fatal-attractions',
]);
export const CBRO_BATCH_EIGHT_SELECTED_IDS = Object.freeze([
  'time-and-time-again',
  'phalanx-covenant',
  'operation-zero-tolerance',
  'spider-man-identity-crisis',
]);
export const CBRO_BATCH_EIGHT_AUTHOR_IDS = CBRO_BATCH_EIGHT_SELECTED_IDS;
export const CBRO_BATCH_EIGHT_TOUCHED_IDS = Object.freeze([
  'marvel-2099',
  'road-to-vengeance-missing-link',
  'siege-of-darkness',
  'time-and-time-again',
  'phalanx-covenant',
  'age-of-apocalypse',
  'second-clone-saga',
  'over-the-edge',
  'onslaught-saga',
  'operation-zero-tolerance',
  'heroes-reborn',
  'spider-man-identity-crisis',
]);
export const CBRO_BATCH_NINE_SELECTED_IDS = Object.freeze([
  'hunt-for-xavier',
  'magneto-war',
]);
export const CBRO_BATCH_NINE_AUTHOR_IDS = CBRO_BATCH_NINE_SELECTED_IDS;
export const CBRO_BATCH_NINE_TOUCHED_IDS = Object.freeze([
  'mc2',
  'eighth-day',
  ...CBRO_BATCH_NINE_SELECTED_IDS,
  'apocalypse-the-twelve',
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
export const CBRO_BATCH_SIX_PACKET_REVIEW =
  'MRT-003-C02-B06 central CBRO source review';
export const CBRO_BATCH_SEVEN_PACKET_REVIEW =
  'MRT-003-C02-B07 central CBRO source review';
export const CBRO_BATCH_EIGHT_PACKET_REVIEW =
  'MRT-003-C02-B08 central CBRO source review';
export const CBRO_BATCH_NINE_PACKET_REVIEW =
  'MRT-003-C02-B09 central CBRO source review';
export const CBRO_RELEASE_IDS = Object.freeze({
  original: 'mrt-003',
  continuationBatchOne: 'mrt-003-c02-b01',
  continuationBatchTwo: 'mrt-003-c02-b02',
  continuationBatchThree: 'mrt-003-c02-b03',
  continuationBatchFour: 'mrt-003-c02-b04',
  continuationBatchFive: 'mrt-003-c02-b05',
  continuationBatchSix: 'mrt-003-c02-b06',
  continuationBatchSeven: 'mrt-003-c02-b07',
  continuationBatchEight: 'mrt-003-c02-b08',
  continuationBatchNine: 'mrt-003-c02-b09',
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
    Object.freeze({
      candidateId: 'kree-skrull-war',
      orderId: 'ant-man-reading-order',
      relationship: 'partial',
      sharedIds: Object.freeze(['7347']),
      rationale: 'The compact nine-issue event route keeps one shared Kree-Skrull chapter while the broader Ant-Man reading order serves a different story purpose.',
    }),
    Object.freeze({
      candidateId: 'thanos-war',
      orderId: 'thanos-reading-order',
      relationship: 'candidate-subset',
      sharedIds: Object.freeze([
        '9610',
        '8014',
        '8015',
        '8016',
        '8017',
        '8018',
        '23322',
        '8019',
        '8020',
        '8021',
        '6981',
        '8022',
      ]),
      rationale: 'This order intentionally overlaps the broader source-defined Thanos chronology and remains a distinct reader product.',
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
  [CBRO_RELEASE_IDS.continuationBatchEight]: Object.freeze([
    Object.freeze({
      candidateId: 'phalanx-covenant',
      orderId: 'phalanx-reading-order',
      relationship: 'candidate-subset',
      sharedIds: Object.freeze([
        '13857', '14324', '13858', '14325', '12182', '18003', '8668', '14209', '7389',
      ]),
      rationale: 'The exact nine-issue Phalanx Covenant route has a distinct event purpose inside the broader Phalanx reading order.',
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
    relationshipReviewRationale: 'Every current library and selected peer comparison was reviewed; the Kree-Skrull War subset, the Thanos War subset, and Ant-Man partial relationship are the approved non-none relationships.',
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
  [CBRO_RELEASE_IDS.continuationBatchSix]: Object.freeze({
    id: CBRO_RELEASE_IDS.continuationBatchSix,
    sourceIds: CBRO_BATCH_SIX_SELECTED_IDS,
    authorIds: CBRO_BATCH_SIX_AUTHOR_IDS,
    packetReview: CBRO_BATCH_SIX_PACKET_REVIEW,
    authorityIdentity: 'MRT-003-C02-B06 coordinator',
    relationshipReviewRationale: 'Every current library and selected peer comparison was reviewed; all relationships are none.',
  }),
  [CBRO_RELEASE_IDS.continuationBatchSeven]: Object.freeze({
    id: CBRO_RELEASE_IDS.continuationBatchSeven,
    sourceIds: CBRO_BATCH_SEVEN_SELECTED_IDS,
    authorIds: CBRO_BATCH_SEVEN_AUTHOR_IDS,
    packetReview: CBRO_BATCH_SEVEN_PACKET_REVIEW,
    authorityIdentity: 'MRT-003-C02-B07 coordinator',
    relationshipReviewRationale: 'Every current library and selected peer comparison was reviewed; all relationships are none.',
  }),
  [CBRO_RELEASE_IDS.continuationBatchEight]: Object.freeze({
    id: CBRO_RELEASE_IDS.continuationBatchEight,
    sourceIds: CBRO_BATCH_EIGHT_SELECTED_IDS,
    authorIds: CBRO_BATCH_EIGHT_AUTHOR_IDS,
    packetReview: CBRO_BATCH_EIGHT_PACKET_REVIEW,
    authorityIdentity: 'MRT-003-C02-B08 coordinator',
    relationshipReviewRationale: 'Every current library and selected peer comparison was reviewed; the Phalanx Covenant subset is the only approved non-none relationship.',
  }),
  [CBRO_RELEASE_IDS.continuationBatchNine]: Object.freeze({
    id: CBRO_RELEASE_IDS.continuationBatchNine,
    sourceIds: CBRO_BATCH_NINE_SELECTED_IDS,
    authorIds: CBRO_BATCH_NINE_AUTHOR_IDS,
    packetReview: CBRO_BATCH_NINE_PACKET_REVIEW,
    authorityIdentity: 'MRT-003-C02-B09 coordinator',
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
const CBRO_PRE_BATCH_SIX_SELECTED_IDS = Object.freeze([
  ...CBRO_CONTINUATION_SELECTED_IDS,
  ...CBRO_BATCH_TWO_SELECTED_IDS,
  CBRO_BATCH_THREE_SELECTED_IDS[0],
  ...CBRO_BATCH_FOUR_SELECTED_IDS,
  ...CBRO_BATCH_THREE_SELECTED_IDS.slice(1),
  ...CBRO_BATCH_FIVE_SELECTED_IDS,
  ...CBRO_SELECTED_IDS,
]);
const CBRO_PRE_BATCH_SEVEN_SELECTED_IDS = Object.freeze([
  ...CBRO_CONTINUATION_SELECTED_IDS,
  ...CBRO_BATCH_TWO_SELECTED_IDS,
  CBRO_BATCH_THREE_SELECTED_IDS[0],
  ...CBRO_BATCH_FOUR_SELECTED_IDS,
  ...CBRO_BATCH_THREE_SELECTED_IDS.slice(1),
  ...CBRO_BATCH_FIVE_SELECTED_IDS,
  CBRO_BATCH_SIX_SELECTED_IDS[0],
  CBRO_SELECTED_IDS[0],
  ...CBRO_BATCH_SIX_SELECTED_IDS.slice(1),
  ...CBRO_SELECTED_IDS.slice(1),
]);
const CBRO_PRE_BATCH_EIGHT_SELECTED_IDS = Object.freeze([
  ...CBRO_CONTINUATION_SELECTED_IDS,
  ...CBRO_BATCH_TWO_SELECTED_IDS,
  CBRO_BATCH_THREE_SELECTED_IDS[0],
  ...CBRO_BATCH_FOUR_SELECTED_IDS,
  ...CBRO_BATCH_THREE_SELECTED_IDS.slice(1),
  ...CBRO_BATCH_FIVE_SELECTED_IDS,
  CBRO_BATCH_SIX_SELECTED_IDS[0],
  CBRO_SELECTED_IDS[0],
  ...CBRO_BATCH_SIX_SELECTED_IDS.slice(1),
  ...CBRO_BATCH_SEVEN_SELECTED_IDS,
  ...CBRO_SELECTED_IDS.slice(1),
]);
const CBRO_PRE_BATCH_NINE_SELECTED_IDS = Object.freeze([
  ...CBRO_CONTINUATION_SELECTED_IDS,
  ...CBRO_BATCH_TWO_SELECTED_IDS,
  CBRO_BATCH_THREE_SELECTED_IDS[0],
  ...CBRO_BATCH_FOUR_SELECTED_IDS,
  ...CBRO_BATCH_THREE_SELECTED_IDS.slice(1),
  ...CBRO_BATCH_FIVE_SELECTED_IDS,
  CBRO_BATCH_SIX_SELECTED_IDS[0],
  CBRO_SELECTED_IDS[0],
  ...CBRO_BATCH_SIX_SELECTED_IDS.slice(1),
  ...CBRO_BATCH_SEVEN_SELECTED_IDS,
  ...CBRO_SELECTED_IDS.slice(1, 4),
  ...CBRO_BATCH_EIGHT_SELECTED_IDS,
  CBRO_SELECTED_IDS[4],
]);
export const CBRO_ALL_SELECTED_IDS = Object.freeze([
  ...CBRO_PRE_BATCH_NINE_SELECTED_IDS,
  ...CBRO_BATCH_NINE_SELECTED_IDS,
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
  'phalanx-covenant': Object.freeze({
    relationshipStatus: 'candidate-subset',
    overlapIds: Object.freeze(['phalanx-reading-order']),
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
const BATCH_SIX_PREDECESSOR_STATE = Object.freeze({
  'x-tinction-agenda': Object.freeze({
    sourceRetrievedAt: '2026-08-25',
    sourceContentSha256: '41a631e82fcdab259794ad4523251dfc8dc62212457838c3085173910de30c9e',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred as the next source-order cursor after MRT-003-C02-B05 selected the smallest coherent four-guide batch.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'infinity-gauntlet': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: 'b184c2cd7a3846183bdb5c18da65f30b7b33623afaaf35ac1470a488e4564572',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'operation-galactic-storm': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: 'b94e02e86c7fbbc8e712f141e3b8b7d23fe84c40310c43609664a9496a8d5d71',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'infinity-war': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: '5ac8ba0aeb8fb42775612be95c213638435c56409f0f7741780f2b7829c33720',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'dead-mans-hand': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: '8b028c3b0968b619f412527584884ef91dc1ac64a3ad31f9a2da6e6b70604ee3',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'rise-of-the-midnight-sons': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: '496f7b3eea3efa65ac10ef0ef03c047266be4ae6aca6f934ef7f00a78589973e',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
});
const BATCH_SEVEN_PREDECESSOR_STATE = Object.freeze({
  'x-cutioners-song': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: '25e318d855691714aeb7d669a323b7f5a641fc9b9adea16d7345d818c43c0513',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'mys-tech-wars': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: '2ce9dab79ef1f71bc2c4bdbb366f56e29b9f18dccb5c073613192dd7f2be54eb',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'for-love-nor-money': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: 'c50fedd70c5e40aad2ceca37bb642ce3db3446f66bd8e4c2418f08abd6a7f524',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'maximum-carnage': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: '0a0d88a58c9fa638e819091a22b4ca49701d8ee058807d592cb19c9d13b1a489',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'infinity-crusade': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: 'f84b67c3bd0144fd4038e35f34151f809448c6cb49092b6edbf5c4044fc93ca4',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'blood-and-thunder': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: '38302d6e5f25d35418fe102f6bef2341ec723ebb77f3adc70ddd8dc1f5c12f74',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'fatal-attractions': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: '560bcc2d8e58ff0ce4e00ae2f5507daf09166bf7d6ef9007fc5783a050868bc1',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
});
const BATCH_EIGHT_DEFERRED_REASON =
  'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.';

function batchEightDeferredPredecessor(sourceContentSha256) {
  return Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256,
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: BATCH_EIGHT_DEFERRED_REASON,
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  });
}

const BATCH_EIGHT_PREDECESSOR_STATE = Object.freeze({
  'marvel-2099': batchEightDeferredPredecessor(
    'bf02266cd5aee640e5aa4c55d03f9a3f8b11880ae631e883189e5e53bc3c9824',
  ),
  'road-to-vengeance-missing-link': batchEightDeferredPredecessor(
    '54ec8d425a44b9930217db3830055de219b810d21cfe3a967104edbad09b9137',
  ),
  'siege-of-darkness': batchEightDeferredPredecessor(
    '8c72639518ae71b7c2c671d1625325b80e12c3aef4aebdcd7b7d10358c93a764',
  ),
  'time-and-time-again': batchEightDeferredPredecessor(
    '1a6139af2287a2a232974c2ca6e393a6e12ad97b3d74823085178e0542ca10e8',
  ),
  'phalanx-covenant': Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: '7ca7a58be1311c59f2624142c44a5679d9780388bcdf0104dac0be25fcae2b35',
    centralDisposition: 'deferred-subset',
    relationshipStatus: 'candidate-subset',
    reason: 'Deferred; all nine source rows are a candidate subset of the existing Phalanx order.',
    overlapIds: Object.freeze(['phalanx-reading-order']),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
  'age-of-apocalypse': batchEightDeferredPredecessor(
    'c7ebbca37c994dee2c4e427282abe4222095f73a66ab338097553f5396051d36',
  ),
  'second-clone-saga': batchEightDeferredPredecessor(
    '2c41ddb83b46c1ce771191e7cd136d4042c66cf74ea2b3921e2e46ca1bb50ad1',
  ),
  'over-the-edge': batchEightDeferredPredecessor(
    '0468d02892ee92c7ccded4ca6c859575d0dce81261ed5d3a950acd0bfcc4cdc0',
  ),
  'onslaught-saga': batchEightDeferredPredecessor(
    '381fb8b6c6de276d7834833fe5924fd3e0904fe5bf8e8c77e4418fdc348f5d05',
  ),
  'operation-zero-tolerance': batchEightDeferredPredecessor(
    '04f619bce7ab1481bb197d3751ec52b425fe82b0cebaef4c9dd0dfc82e483ff1',
  ),
  'heroes-reborn': batchEightDeferredPredecessor(
    'a72985dd2c32f5340e2510f30948694512b44cb802c883ed81800306bf46e48f',
  ),
  'spider-man-identity-crisis': batchEightDeferredPredecessor(
    'e47ed420275476c557022301cc665798c44b5a6b253331d4b741798b7bd7e8bc',
  ),
});
const BATCH_NINE_DEFERRED_REASON =
  'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.';

function batchNineDeferredPredecessor(sourceContentSha256) {
  return Object.freeze({
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256,
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: BATCH_NINE_DEFERRED_REASON,
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  });
}

const BATCH_NINE_PREDECESSOR_STATE = Object.freeze({
  mc2: batchNineDeferredPredecessor(
    '6b45c02acdc0d10c7c25b94333b8178bf62fa90d62e06f582c0b5b65b9785643',
  ),
  'hunt-for-xavier': batchNineDeferredPredecessor(
    'e4fbc4ffd2eb67df59f63dcba0ad7bfa532668476190f9053d0e2b3be61c5754',
  ),
  'magneto-war': batchNineDeferredPredecessor(
    '35d5e552622ed11a6e7e5a1d111556ea0933191c14728c89a8ae0c4833122cbe',
  ),
  'apocalypse-the-twelve': batchNineDeferredPredecessor(
    '0dc4c1a9b7124ac09844decef9ad7a449e2f8e22d3fb2ff2f7df2f4050aeb182',
  ),
});
const BATCH_TEN_PREDECESSOR_STATE = Object.freeze({
  'second-clone-saga': Object.freeze({
    sourceRetrievedAt: '2026-08-25',
    sourceContentSha256: 'f4d3548d73d1b916db0928e0d4939e74074cb7d68a8b06ba16a68685b0fc3399',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred for a separate 161-row review requiring explicit product approval.',
    overlapIds: Object.freeze([]),
    catalogIds: Object.freeze([]),
    deliveryStatus: 'deferred',
  }),
});
const BATCH_ELEVEN_PREDECESSOR_STATE = Object.freeze({
  'marvel-2099': Object.freeze({
    sourceRetrievedAt: '2026-08-25',
    sourceContentSha256: 'f304f150c2aa29fc9d28a07ef6e3f6669f5bc849a19ea38ef13005a45c29f45a',
    centralDisposition: 'deferred',
    relationshipStatus: 'unresolved',
    reason: 'Deferred for a separate alternate-universe review requiring explicit product approval.',
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

export function cbroBatchSixPredecessorRecord(record) {
  const state = BATCH_SIX_PREDECESSOR_STATE[record.id];
  return state ? { ...record, ...state } : record;
}

export function cbroBatchSevenPredecessorRecord(record) {
  const state = BATCH_SEVEN_PREDECESSOR_STATE[record.id];
  return state ? { ...record, ...state } : record;
}

export function cbroBatchEightPredecessorRecord(record) {
  const state = BATCH_EIGHT_PREDECESSOR_STATE[record.id];
  return state ? { ...record, ...state } : record;
}

export function cbroBatchNinePredecessorRecord(record) {
  const state = BATCH_NINE_PREDECESSOR_STATE[record.id];
  const predecessor = state ? { ...record, ...state } : record;
  const laterState = BATCH_TEN_PREDECESSOR_STATE[predecessor.id];
  const batchTenPredecessor = laterState ? { ...predecessor, ...laterState } : predecessor;
  const batchElevenState = BATCH_ELEVEN_PREDECESSOR_STATE[batchTenPredecessor.id];
  return batchElevenState ? { ...batchTenPredecessor, ...batchElevenState } : batchTenPredecessor;
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

export function validateCbroBlockerEvidence(evidence, options = {}) {
  const label = evidence?.id ?? 'CBRO blocker evidence';
  assert(evidence && typeof evidence === 'object', 'CBRO blocker evidence must be an object');
  assert(evidence.schemaVersion === 1, `${label} blocker evidence has an unsupported schema`);
  assert(typeof evidence.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(evidence.id),
    `${label} blocker evidence id is invalid`);
  assert(evidence.inventoryId === evidence.id, `${label} blocker inventory id differs`);
  assert(options.expectedId == null || evidence.id === options.expectedId,
    `${label} blocker evidence has the wrong id`);
  assert(evidence.sourceProvider === CBRO_SOURCE_PROVIDER.id,
    `${label} blocker evidence has the wrong provider`);
  assert(typeof evidence.sourceUrl === 'string' && evidence.sourceUrl.startsWith('https://'),
    `${label} blocker evidence needs a source URL`);
  assert(evidence.sourceSection == null, `${label} blocker evidence source section must be null`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(evidence.sourceRetrievedAt),
    `${label} blocker retrieval date is invalid`);
  assert(isSha256(evidence.sourceContentSha256),
    `${label} blocker source content digest is invalid`);
  assert(Array.isArray(evidence.rows) && evidence.rows.length === evidence.sourceRowCount,
    `${label} blocker rows differ from the source row count`);
  assert(Number.isInteger(evidence.unresolvedRowCount) && evidence.unresolvedRowCount > 0,
    `${label} blocker unresolved row count is invalid`);
  const exactIssueIds = [];
  let unresolved = 0;
  for (const [index, row] of evidence.rows.entries()) {
    const rowLabel = `${label} blocker row ${index + 1}`;
    assert(row?.sourcePosition === index + 1, `${rowLabel} position is invalid`);
    assert(typeof row.sourceIssueReference === 'string' && row.sourceIssueReference.trim(),
      `${rowLabel} source reference is required`);
    assert(typeof row.sourceSeriesTitle === 'string' && row.sourceSeriesTitle.trim(),
      `${rowLabel} source series title is required`);
    assert(typeof row.issueNumber === 'string' && row.issueNumber.trim(),
      `${rowLabel} issue number is required`);
    assert(['exact', 'unmatched'].includes(row.resolutionStatus),
      `${rowLabel} resolution status is invalid`);
    if (row.resolutionStatus === 'exact') {
      assert(Number.isInteger(row.seriesId) && row.seriesId > 0,
        `${rowLabel} configured series id is invalid`);
      assert(typeof row.seriesName === 'string' && row.seriesName.trim(),
        `${rowLabel} configured metadata series name is required`);
      assert(Number.isInteger(row.seriesYear), `${rowLabel} configured series year is invalid`);
      assert(Number.isInteger(row.selectedIssueId) && row.selectedIssueId > 0,
        `${rowLabel} selected issue id is invalid`);
      assert(typeof row.resolvedIssueTitle === 'string' && row.resolvedIssueTitle.trim(),
        `${rowLabel} resolved issue title is required`);
      assert(typeof row.marvelIssueUrl === 'string'
        && row.marvelIssueUrl.startsWith('https://www.marvel.com/comics/issue/'),
      `${rowLabel} Marvel issue URL is invalid`);
      assert(typeof row.onSaleDate === 'string' && row.onSaleDate.trim(),
        `${rowLabel} on-sale date is required`);
      exactIssueIds.push(row.selectedIssueId);
    } else {
      unresolved += 1;
      assert(row.seriesId == null || (Number.isInteger(row.seriesId) && row.seriesId > 0),
        `${rowLabel} configured series id is invalid`);
      assert(row.selectedIssueId == null
        && row.resolvedIssueTitle == null
        && row.marvelIssueUrl == null
        && row.onSaleDate == null,
      `${rowLabel} unresolved outcome contains resolved metadata`);
    }
  }
  assert(unresolved === evidence.unresolvedRowCount,
    `${label} blocker unresolved row count differs from its rows`);
  assert(new Set(exactIssueIds).size === exactIssueIds.length,
    `${label} blocker evidence repeats an exact issue id`);
  if (evidence.id === 'marvel-2099') {
    const unmatchedIdentities = evidence.rows
      .filter((row) => row.resolutionStatus === 'unmatched')
      .map((row) => ({
        sourcePosition: row.sourcePosition,
        sourceIssueReference: row.sourceIssueReference,
        sourceSeriesTitle: row.sourceSeriesTitle,
        issueNumber: row.issueNumber,
        seriesId: row.seriesId,
      }));
    assert(evidence.sourceRowCount === 271 && evidence.unresolvedRowCount === 99,
      `${label} blocker counts changed`);
    assert(digestCanonicalJson(unmatchedIdentities)
      === CBRO_MARVEL_2099_UNMATCHED_IDENTITY_SHA256,
    `${label} unmatched source identities changed`);
  }
  const digestInput = { ...evidence };
  delete digestInput.blockerDigest;
  assert(isSha256(evidence.blockerDigest)
    && digestCanonicalJson(digestInput) === evidence.blockerDigest,
  `${label} blocker evidence digest is stale`);
  const inventoryRecord = options.inventoryRecord;
  if (inventoryRecord) {
    assert(inventoryRecord.id === evidence.inventoryId,
      `${label} blocker inventory record differs`);
    assert(inventoryRecord.sourceProvider === evidence.sourceProvider
      && inventoryRecord.sourceUrl === evidence.sourceUrl
      && inventoryRecord.sourceRetrievedAt === evidence.sourceRetrievedAt
      && inventoryRecord.sourceContentSha256 === evidence.sourceContentSha256
      && inventoryRecord.sourceRowCount === evidence.sourceRowCount,
    `${label} blocker source evidence differs from inventory`);
    assert(inventoryRecord.centralDisposition === 'blocked'
      && inventoryRecord.relationshipStatus === 'unresolved'
      && inventoryRecord.deliveryStatus === 'blocked'
      && inventoryRecord.catalogIds.length === 0,
    `${label} blocker inventory state is inconsistent`);
    if (evidence.id === 'marvel-2099') {
      assert(inventoryRecord.reason === CBRO_MARVEL_2099_BLOCKER_REASON,
        `${label} blocker inventory reason changed`);
      assert(inventoryRecord.universeScope === 'alternate'
        && inventoryRecord.overlapIds.length === 0,
      `${label} blocker alternate-universe scope changed`);
    }
  }
  return true;
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
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord)
    .map(cbroBatchSevenPredecessorRecord)
    .map(cbroBatchSixPredecessorRecord)
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
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord)
    .map(cbroBatchSevenPredecessorRecord)
    .map(cbroBatchSixPredecessorRecord)
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
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord)
    .map(cbroBatchSevenPredecessorRecord)
    .map(cbroBatchSixPredecessorRecord)
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
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord)
    .map(cbroBatchSevenPredecessorRecord)
    .map(cbroBatchSixPredecessorRecord)
    .map((record) => CBRO_PRE_BATCH_SIX_SELECTED_IDS.includes(record.id)
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
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord)
    .map(cbroBatchSevenPredecessorRecord)
    .map(cbroBatchSixPredecessorRecord)
    .map((record) => CBRO_BATCH_FIVE_SELECTED_IDS.includes(record.id)
      ? { ...record, catalogIds: [], deliveryStatus: 'ready' }
      : record);
  assert(
    digestCanonicalJson(batchFiveEvaluatedOutcomes)
      === CBRO_BATCH_FIVE_EVALUATED_OUTCOME_SHA256,
    'CBRO batch-five evaluated outcome changed',
  );
  const batchSixUntouched = records
    .filter((record) => !CBRO_BATCH_SIX_TOUCHED_IDS.includes(record.id))
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord)
    .map(cbroBatchSevenPredecessorRecord)
    .map((record) => CBRO_PRE_BATCH_SEVEN_SELECTED_IDS.includes(record.id)
      ? {
        ...record,
        catalogIds: [record.id],
        deliveryStatus: 'shipped',
      }
      : record);
  assert(
    digestCanonicalJson(batchSixUntouched)
      === CBRO_BATCH_SIX_UNTOUCHED_INVENTORY_SHA256,
    'CBRO batch-six untouched inventory changed',
  );
  const batchSixEvaluatedOutcomes = records
    .filter((record) => CBRO_BATCH_SIX_TOUCHED_IDS.includes(record.id))
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord)
    .map(cbroBatchSevenPredecessorRecord)
    .map((record) => CBRO_BATCH_SIX_SELECTED_IDS.includes(record.id)
      ? { ...record, catalogIds: [], deliveryStatus: 'ready' }
      : record);
  assert(
    digestCanonicalJson(batchSixEvaluatedOutcomes)
      === CBRO_BATCH_SIX_EVALUATED_OUTCOME_SHA256,
    'CBRO batch-six evaluated outcome changed',
  );
  const batchSevenUntouched = records
    .filter((record) => !CBRO_BATCH_SEVEN_TOUCHED_IDS.includes(record.id))
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord)
    .map((record) => CBRO_PRE_BATCH_SEVEN_SELECTED_IDS.includes(record.id)
      ? {
        ...record,
        catalogIds: [record.id],
        deliveryStatus: 'shipped',
      }
      : record);
  assert(
    digestCanonicalJson(batchSevenUntouched)
      === CBRO_BATCH_SEVEN_UNTOUCHED_INVENTORY_SHA256,
    'CBRO batch-seven untouched inventory changed',
  );
  const batchSevenEvaluatedOutcomes = records
    .filter((record) => CBRO_BATCH_SEVEN_TOUCHED_IDS.includes(record.id))
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord)
    .map((record) => CBRO_BATCH_SEVEN_SELECTED_IDS.includes(record.id)
      ? { ...record, catalogIds: [], deliveryStatus: 'ready' }
      : record);
  assert(
    digestCanonicalJson(batchSevenEvaluatedOutcomes)
      === CBRO_BATCH_SEVEN_EVALUATED_OUTCOME_SHA256,
    'CBRO batch-seven evaluated outcome changed',
  );
  const batchEightUntouched = records
    .filter((record) => !CBRO_BATCH_EIGHT_TOUCHED_IDS.includes(record.id))
    .map(cbroBatchNinePredecessorRecord)
    .map((record) => CBRO_PRE_BATCH_EIGHT_SELECTED_IDS.includes(record.id)
      ? {
        ...record,
        catalogIds: [record.id],
        deliveryStatus: 'shipped',
      }
      : record);
  assert(
    digestCanonicalJson(batchEightUntouched)
      === CBRO_BATCH_EIGHT_UNTOUCHED_INVENTORY_SHA256,
    'CBRO batch-eight untouched inventory changed',
  );
  const batchEightEvaluatedOutcomes = records
    .filter((record) => CBRO_BATCH_EIGHT_TOUCHED_IDS.includes(record.id))
    .map(cbroBatchNinePredecessorRecord)
    .map((record) => CBRO_BATCH_EIGHT_SELECTED_IDS.includes(record.id)
      ? { ...record, catalogIds: [], deliveryStatus: 'ready' }
      : record);
  assert(
    digestCanonicalJson(batchEightEvaluatedOutcomes)
      === CBRO_BATCH_EIGHT_EVALUATED_OUTCOME_SHA256,
    'CBRO batch-eight evaluated outcome changed',
  );
  const batchNineUntouched = records
    .filter((record) => !CBRO_BATCH_NINE_TOUCHED_IDS.includes(record.id))
    .map(cbroBatchNinePredecessorRecord)
    .map((record) => CBRO_PRE_BATCH_NINE_SELECTED_IDS.includes(record.id)
      ? {
        ...record,
        catalogIds: [record.id],
        deliveryStatus: 'shipped',
      }
      : record);
  assert(
    digestCanonicalJson(batchNineUntouched)
      === CBRO_BATCH_NINE_UNTOUCHED_INVENTORY_SHA256,
    'CBRO batch-nine untouched inventory changed',
  );
  const batchNineEvaluatedOutcomes = records
    .filter((record) => CBRO_BATCH_NINE_TOUCHED_IDS.includes(record.id))
    .map((record) => CBRO_BATCH_NINE_SELECTED_IDS.includes(record.id)
      ? { ...record, catalogIds: [], deliveryStatus: 'ready' }
      : record);
  assert(
    digestCanonicalJson(batchNineEvaluatedOutcomes)
      === CBRO_BATCH_NINE_EVALUATED_OUTCOME_SHA256,
    'CBRO batch-nine evaluated outcome changed',
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
