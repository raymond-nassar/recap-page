import { createHash } from 'node:crypto';

import { hasMetadata } from '../../src/js/lib/model.js';

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_JSON_FILE = /^[A-Za-z0-9._-]+\.json$/;
const PROHIBITED_DASH = /[\u2011\u2013\u2014]/;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  assert(unexpected.length === 0, `${label} has unsupported fields: ${unexpected.join(', ')}`);
}

function assertString(value, label) {
  assert(typeof value === 'string' && value.trim() === value && value.length > 0, `${label} must be a non-empty trimmed string`);
}

function assertHash(value, label) {
  assert(SHA256.test(String(value ?? '')), `${label} must be a lowercase SHA-256 digest`);
}

function assertHttps(value, label) {
  try {
    assert(new URL(value).protocol === 'https:', `${label} must be an https URL`);
  } catch {
    throw new Error(`${label} must be an https URL`);
  }
}

export function digestJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function chapterId(parentId, ordinal) {
  return `${parentId}-${String(ordinal).padStart(2, '0')}`;
}

export function chapterFile(parentOutput, ordinal) {
  return `${parentOutput.slice(0, -'.json'.length)}_${String(ordinal).padStart(2, '0')}.json`;
}

export function chapterOrdinal(parentId, count, id) {
  const match = new RegExp(`^${parentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{2})$`).exec(String(id));
  if (!match) return null;
  const ordinal = Number(match[1]);
  return ordinal >= 1 && ordinal <= count ? ordinal : null;
}

function chapterContract(chapters) {
  return chapters.map((chapter) => ({
    id: chapter.id,
    name: chapter.name,
    sourceStart: chapter.sourceStart,
    sourceCount: chapter.sourceCount,
    ownerBulletCount: chapter.ownerBulletCount,
    issueCount: chapter.issueCount,
    timelineYear: chapter.timelineYear,
    issueIdDigest: chapter.issueIdsSha256,
  }));
}

export function validateChapterLedger(value) {
  assert(isObject(value), 'Chapter ledger must be an object');
  assertKeys(value, [
    'schemaVersion',
    'parentId',
    'ownerIssue',
    'ownerAttachmentSha256',
    'sourcePositions',
    'sourceVectorSha256',
    'sourceGroups',
    'chapterCount',
    'issueCount',
    'issueIdsSha256',
    'ownerBulletCount',
    'chapterContractSha256',
    'chapterNamesSha256',
    'overlapFile',
    'path',
    'corrections',
    'chapters',
  ], 'Chapter ledger');
  assert(value.schemaVersion === 1, 'Chapter ledger schemaVersion must be 1');
  assertString(value.parentId, 'Chapter ledger parentId');
  assertHttps(value.ownerIssue, 'Chapter ledger ownerIssue');
  assertHash(value.ownerAttachmentSha256, 'Chapter ledger ownerAttachmentSha256');
  assert(Number.isInteger(value.sourcePositions) && value.sourcePositions > 0, 'Chapter ledger sourcePositions must be a positive integer');
  assertHash(value.sourceVectorSha256, 'Chapter ledger sourceVectorSha256');
  assert(Number.isInteger(value.chapterCount) && value.chapterCount > 0, 'Chapter ledger chapterCount must be a positive integer');
  assert(Number.isInteger(value.issueCount) && value.issueCount > 0, 'Chapter ledger issueCount must be a positive integer');
  assertHash(value.issueIdsSha256, 'Chapter ledger issueIdsSha256');
  assert(Number.isInteger(value.ownerBulletCount) && value.ownerBulletCount > 0, 'Chapter ledger ownerBulletCount must be a positive integer');
  assertHash(value.chapterContractSha256, 'Chapter ledger chapterContractSha256');
  assertHash(value.chapterNamesSha256, 'Chapter ledger chapterNamesSha256');
  assertString(value.overlapFile, 'Chapter ledger overlapFile');
  assert(SAFE_JSON_FILE.test(value.overlapFile), 'Chapter ledger overlapFile must be a plain JSON file name');

  assert(Array.isArray(value.sourceGroups) && value.sourceGroups.length > 0, 'Chapter ledger sourceGroups must be a non-empty array');
  let nextGroupPosition = 1;
  let groupIssues = 0;
  const groupNames = new Set();
  for (const [index, group] of value.sourceGroups.entries()) {
    const label = `Source group ${index + 1}`;
    assert(isObject(group), `${label} must be an object`);
    assertKeys(group, ['name', 'sourceStart', 'sourceCount', 'issueCount'], label);
    assertString(group.name, `${label} name`);
    assert(!groupNames.has(group.name), `${label} duplicates source group "${group.name}"`);
    groupNames.add(group.name);
    assert(group.sourceStart === nextGroupPosition, `${label} does not continue the source-position vector`);
    assert(Number.isInteger(group.sourceCount) && group.sourceCount > 0, `${label} sourceCount must be positive`);
    assert(Number.isInteger(group.issueCount) && group.issueCount > 0, `${label} issueCount must be positive`);
    nextGroupPosition += group.sourceCount;
    groupIssues += group.issueCount;
  }
  assert(nextGroupPosition - 1 === value.sourcePositions, 'Source groups do not cover every source position');
  assert(groupIssues === value.issueCount, 'Source group issue counts do not equal the ledger issue count');

  assert(Array.isArray(value.chapters) && value.chapters.length === value.chapterCount, `Chapter ledger must contain ${value.chapterCount} chapters`);
  const ids = new Set();
  const names = new Set();
  let nextPosition = 1;
  let ownerBullets = 0;
  let issues = 0;
  for (const [index, chapter] of value.chapters.entries()) {
    const label = `Chapter ${index + 1}`;
    assert(isObject(chapter), `${label} must be an object`);
    assertKeys(chapter, [
      'id',
      'name',
      'sourceStart',
      'sourceCount',
      'ownerBulletCount',
      'issueCount',
      'timelineYear',
      'issueIdsSha256',
    ], label);
    assert(chapter.id === chapterId(value.parentId, index + 1), `${label} id must be ${chapterId(value.parentId, index + 1)}`);
    assert(!ids.has(chapter.id), `${label} duplicates id "${chapter.id}"`);
    ids.add(chapter.id);
    assertString(chapter.name, `${label} name`);
    assert(!PROHIBITED_DASH.test(chapter.name), `${label} name contains a prohibited Unicode dash`);
    assert(!names.has(chapter.name), `${label} duplicates name "${chapter.name}"`);
    names.add(chapter.name);
    assert(chapter.sourceStart === nextPosition, `${label} does not continue the source-position vector`);
    assert(Number.isInteger(chapter.sourceCount) && chapter.sourceCount > 0, `${label} sourceCount must be positive`);
    assert(Number.isInteger(chapter.ownerBulletCount) && chapter.ownerBulletCount > 0, `${label} ownerBulletCount must be positive`);
    assert(Number.isInteger(chapter.issueCount) && chapter.issueCount > 0, `${label} issueCount must be positive`);
    assert(Number.isInteger(chapter.timelineYear) && chapter.timelineYear >= 1939, `${label} timelineYear must be a valid Marvel year`);
    assertHash(chapter.issueIdsSha256, `${label} issueIdsSha256`);
    nextPosition += chapter.sourceCount;
    ownerBullets += chapter.ownerBulletCount;
    issues += chapter.issueCount;
  }
  assert(nextPosition - 1 === value.sourcePositions, 'Chapters do not cover every source position in order');
  assert(ownerBullets === value.ownerBulletCount, 'Chapter owner bullet counts do not equal the ledger total');
  assert(issues === value.issueCount, 'Chapter issue counts do not equal the ledger total');
  assert(digestJson(chapterContract(value.chapters)) === value.chapterContractSha256, 'Chapter contract digest is stale');
  assert(digestJson(value.chapters.map((chapter) => chapter.name)) === value.chapterNamesSha256, 'Chapter name digest is stale');

  assert(isObject(value.path), 'Chapter ledger path must be an object');
  assertKeys(value.path, ['id', 'name', 'description', 'sourceOrigin', 'stepsSha256'], 'Chapter path');
  for (const key of ['id', 'name', 'description', 'sourceOrigin']) assertString(value.path[key], `Chapter path ${key}`);
  assertHash(value.path.stepsSha256, 'Chapter path stepsSha256');
  assert(digestJson(value.chapters.map((chapter) => chapter.id)) === value.path.stepsSha256, 'Chapter path steps digest is stale');

  assert(Array.isArray(value.corrections), 'Chapter ledger corrections must be an array');
  for (const [index, correction] of value.corrections.entries()) {
    const label = `Correction ${index + 1}`;
    assert(isObject(correction), `${label} must be an object`);
    assertKeys(correction, ['sourcePosition', 'issueId', 'chapterId', 'placement', 'authority'], label);
    assert(Number.isInteger(correction.sourcePosition) && correction.sourcePosition > 0, `${label} sourcePosition must be positive`);
    assert(Number.isInteger(correction.issueId) && correction.issueId > 0, `${label} issueId must be positive`);
    assert(ids.has(correction.chapterId), `${label} names an unknown chapter`);
    assert(correction.placement === 'first' || correction.placement === 'last', `${label} placement must be first or last`);
    assertHttps(correction.authority, `${label} authority`);
  }
  return value;
}

function onSaleYear(item, label) {
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(String(item?.onSale ?? ''));
  assert(match, `${label} has no usable onSale date`);
  return Number(match[1]);
}

function sourceGroupFor(ledger, position) {
  return ledger.sourceGroups.find((group) => (
    position >= group.sourceStart && position < group.sourceStart + group.sourceCount
  ));
}

function validateSourceAndParent(order, parsed, parentPayload, ledger) {
  assert(order.id === ledger.parentId, `Partition parent id must be ${ledger.parentId}`);
  assert(order.catalog === false, `${order.id} must declare catalog: false`);
  assert(Array.isArray(parsed?.sourcePositions), `${order.id} has no parsed source positions`);
  assert(parsed.sourcePositions.length === ledger.sourcePositions, `${order.id} must contain ${ledger.sourcePositions} source positions`);
  assert(Array.isArray(parsed.entries) && parsed.entries.length === ledger.issueCount, `${order.id} source must contain ${ledger.issueCount} issues`);
  assert(Array.isArray(parsed.unresolved) && parsed.unresolved.length === 0, `${order.id} source contains unresolved issues`);

  let nextItem = 0;
  for (const [index, position] of parsed.sourcePositions.entries()) {
    const label = `Source position ${index + 1}`;
    assert(position.ordinal === index + 1, `${label} has the wrong ordinal`);
    assertString(position.label, `${label} label`);
    assert(position.start === nextItem, `${label} does not continue the issue vector`);
    assert(Number.isInteger(position.count) && position.count > 0, `${label} has no issues`);
    const group = sourceGroupFor(ledger, index + 1);
    assert(group && position.section === group.name, `${label} is outside its declared provenance group`);
    nextItem += position.count;
  }
  assert(nextItem === ledger.issueCount, 'Source positions do not account for every issue');
  assert(
    digestJson(parsed.sourcePositions.map((position) => position.label)) === ledger.sourceVectorSha256,
    'Source-position vector digest is stale',
  );

  assert(isObject(parentPayload), `${order.id} parent payload must be an object`);
  assert(parentPayload.id === ledger.parentId, `${order.id} parent payload has the wrong id`);
  assert(parentPayload.count === ledger.issueCount, `${order.id} parent payload count is stale`);
  assert(parentPayload.placeholders === 0, `${order.id} parent payload contains placeholders`);
  assert(Array.isArray(parentPayload.unresolved) && parentPayload.unresolved.length === 0, `${order.id} parent payload contains unresolved rows`);
  assert(Array.isArray(parentPayload.items) && parentPayload.items.length === ledger.issueCount, `${order.id} parent payload has the wrong item count`);
  const ids = parentPayload.items.map((item) => item.issueId);
  assert(new Set(ids).size === ids.length, `${order.id} parent payload contains duplicate issue ids`);
  assert(digestJson(ids) === ledger.issueIdsSha256, `${order.id} parent issue vector digest is stale`);
  assert(
    JSON.stringify(parsed.entries.map((entry) => entry.issueId)) === JSON.stringify(ids),
    `${order.id} source and parent payload issue vectors differ`,
  );
  assert(parentPayload.items.every((item) => hasMetadata(item)), `${order.id} parent payload has incomplete issue metadata`);
}

function chapterDescription(chapter, first, last, total) {
  const range = first.issueId === last.issueId
    ? `covering ${first.title}`
    : `from ${first.title} through ${last.title}`;
  return `Owner-curated chapter ${chapter.id.slice(-2)} of ${total} in the Marvel Knights to Planet X reading path, ${range}.`;
}

function chapterSubjects(items) {
  return [...new Set(items.map((item) => (
    String(item.seriesName ?? item.title ?? '')
      .replace(/\s+\(\d{4}(?:\s*-\s*\d{4})?\).*$/, '')
      .trim()
  )).filter(Boolean))];
}

export function buildChapterFamily({
  order,
  parsed,
  parentPayload,
  ledger: inputLedger,
  existingPathIds = [],
}) {
  const ledger = validateChapterLedger(inputLedger);
  validateSourceAndParent(order, parsed, parentPayload, ledger);
  assert(!existingPathIds.includes(ledger.path.id), `Generated path id "${ledger.path.id}" duplicates an existing path`);

  const children = ledger.chapters.map((chapter, index) => {
    const positions = parsed.sourcePositions.slice(
      chapter.sourceStart - 1,
      chapter.sourceStart - 1 + chapter.sourceCount,
    );
    assert(positions.length === chapter.sourceCount, `${chapter.id} source span is incomplete`);
    const groups = new Set(positions.map((position) => position.section));
    assert(groups.size === 1, `${chapter.id} crosses a source provenance group`);
    const firstPosition = positions[0];
    const issueCount = positions.reduce((total, position) => total + position.count, 0);
    assert(issueCount === chapter.issueCount, `${chapter.id} issue count differs from the ledger`);
    const sourceItems = parentPayload.items.slice(firstPosition.start, firstPosition.start + issueCount);
    const ids = sourceItems.map((item) => item.issueId);
    assert(digestJson(ids) === chapter.issueIdsSha256, `${chapter.id} issue vector digest is stale`);
    assert(onSaleYear(sourceItems[0], chapter.id) === chapter.timelineYear, `${chapter.id} timeline year differs from its first issue`);
    const items = sourceItems.map(({ collectedIn: _collectedIn, ...item }) => ({ ...item }));
    const description = chapterDescription(chapter, items[0], items.at(-1), ledger.chapterCount);
    const sourceOrigin = 'Compiled for this project from owner-curated source positions and chapter boundaries recorded in GitHub issues #276 and #303';
    const output = chapterFile(order.out, index + 1);

    return {
      chapter,
      order: {
        ...order,
        id: chapter.id,
        name: chapter.name,
        description,
        out: output,
        sourcePage: ledger.ownerIssue,
        sourceSection: null,
        sourceOrigin,
        sourceLicense: null,
        characters: chapterSubjects(items),
        keywords: ['Marvel Knights', 'Planet X'],
        group: null,
        groupName: null,
        variant: null,
        timeline: chapter.timelineYear,
        coverIssueId: items[0].issueId,
        expect: chapter.issueCount,
        catalog: true,
        partitionFile: null,
      },
      payload: {
        id: chapter.id,
        name: chapter.name,
        description,
        source: ledger.ownerIssue,
        sourceOrigin,
        sourceLicense: null,
        generatedAt: parentPayload.generatedAt,
        apiBase: parentPayload.apiBase,
        count: items.length,
        collections: 0,
        placeholders: 0,
        unresolved: [],
        provenance: {
          parentId: ledger.parentId,
          sourceStart: chapter.sourceStart,
          sourceCount: chapter.sourceCount,
          sourceGroup: positions[0].section,
          ownerIssue: ledger.ownerIssue,
        },
        items,
      },
    };
  });

  const aggregateIds = children.flatMap(({ payload }) => payload.items.map((item) => item.issueId));
  assert(digestJson(aggregateIds) === ledger.issueIdsSha256, 'Generated child issue vector differs from the partition parent');
  assert(new Set(aggregateIds).size === ledger.issueCount, 'Generated children contain duplicate issue ids');

  for (const correction of ledger.corrections) {
    const child = children.find(({ chapter }) => chapter.id === correction.chapterId);
    const positionIndex = correction.sourcePosition - child.chapter.sourceStart;
    const sourcePosition = parsed.sourcePositions[correction.sourcePosition - 1];
    assert(positionIndex >= 0 && positionIndex < child.chapter.sourceCount, `Correction ${correction.sourcePosition} is outside ${correction.chapterId}`);
    assert(sourcePosition.count > 0, `Correction ${correction.sourcePosition} has no issues`);
    const correctedId = parentPayload.items[sourcePosition.start]?.issueId;
    assert(correctedId === correction.issueId, `Correction ${correction.sourcePosition} names the wrong issue`);
    const endpoint = correction.placement === 'first' ? 0 : child.payload.items.length - 1;
    assert(child.payload.items[endpoint].issueId === correction.issueId, `Correction ${correction.sourcePosition} is not ${correction.placement} in ${correction.chapterId}`);
  }

  return {
    ledger,
    children,
    path: {
      id: ledger.path.id,
      name: ledger.path.name,
      description: ledger.path.description,
      sourceOrigin: ledger.path.sourceOrigin,
      steps: ledger.chapters.map((chapter) => chapter.id),
    },
  };
}

export function buildChildOverlapEvidence({
  family,
  peers,
  generatedAt,
}) {
  const childIds = new Set(family.children.map(({ chapter }) => chapter.id));
  const pairs = [];
  for (const peer of peers) {
    if (!peer || peer.id === family.ledger.parentId || childIds.has(peer.id)) continue;
    assert(Array.isArray(peer.payload?.items), `Peer ${peer.id} has no issue payload`);
    const peerIds = new Set(peer.payload.items.map((item) => item.issueId));
    for (const { chapter, payload } of family.children) {
      const sharedIssueIds = payload.items
        .map((item) => item.issueId)
        .filter((issueId) => peerIds.has(issueId));
      if (sharedIssueIds.length) {
        pairs.push({
          chapterId: chapter.id,
          existingListId: peer.id,
          sharedCount: sharedIssueIds.length,
          sharedIssueIds,
        });
      }
    }
  }
  pairs.sort((left, right) => (
    chapterOrdinal(family.ledger.parentId, family.ledger.chapterCount, left.chapterId)
      - chapterOrdinal(family.ledger.parentId, family.ledger.chapterCount, right.chapterId)
      || left.existingListId.localeCompare(right.existingListId)
  ));

  const existingLists = [...new Set(pairs.map((pair) => pair.existingListId))]
    .sort()
    .map((id) => ({
      id,
      sharedCount: pairs
        .filter((pair) => pair.existingListId === id)
        .reduce((total, pair) => total + pair.sharedCount, 0),
    }));
  const digestValue = pairs.map((pair) => [
    pair.chapterId,
    pair.existingListId,
    pair.sharedCount,
    pair.sharedIssueIds,
  ]);
  return {
    parentId: family.ledger.parentId,
    generatedAt,
    pairCount: pairs.length,
    chapterCountWithOverlap: new Set(pairs.map((pair) => pair.chapterId)).size,
    existingListCount: existingLists.length,
    sharedOccurrenceCount: pairs.reduce((total, pair) => total + pair.sharedCount, 0),
    internalChildOverlapCount: 0,
    matrixSha256: digestJson(digestValue),
    existingLists,
    pairs,
  };
}
