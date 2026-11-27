import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { digestCanonicalJson, validateApprovalDigest, validateMappingDigest } from './cbh-inventory.mjs';
import { mappedTrackingId, serviceIdentityFor } from './cbh-service-identity.mjs';
import { checklistTitleForRow, findOnlyChecklistTitle } from './cbh-checklist-title.mjs';

const ORDER_IDS = new Set([
  'civil-war-to-secret-invasion', 'secret-wars-2015-event-tie-ins', 'world-war-hulk',
  'avengers-standoff', 'civil-war-ii', 'road-to-secret-empire', 'secret-empire-event',
  'empyre', 'blood-hunt',
]);
const HASH = /^[a-f0-9]{64}$/u;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const shape = (value, fields) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every((key) => fields.includes(key));
const text = (value) => typeof value === 'string' && value.trim() !== '';
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T00:00:00\+0000)?$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);
const FACTS = {
  seriesId: (n) => Number.isSafeInteger(n) && n > 0,
  seriesName: text,
  onSaleDate: date,
};

export function parseReviewedVendorFields(args) {
  const flag = (name) => {
    const matches = args.filter((arg) => arg === name || arg.startsWith(`${name}=`));
    if (!matches.length) return null;
    const value = matches[0].slice(name.length + 1).trim();
    if (matches.length !== 1 || !value) throw new Error(`Use ${name}=<value> once`);
    return value;
  };
  const file = flag('--reviewed-fields');
  const digest = flag('--reviewed-fields-sha256');
  const cache = flag('--reviewed-response-cache');
  if (file === null && digest === null && cache === null) return null;
  if (!file || !HASH.test(digest ?? '')) {
    throw new Error('--reviewed-fields needs a file and its approved --reviewed-fields-sha256');
  }
  return { file: resolve(file), digest, cache: cache ? resolve(cache) : null };
}

function publishedCover(ref, issueId, root, sourceFiles) {
  if (!shape(ref, ['commit', 'path', 'sha256', 'fieldDigest'])
    || !/^[a-f0-9]{40}$/u.test(ref.commit ?? '')
    || !/^src\/data\/[a-z0-9_-]+\.json$/u.test(ref.path ?? '')
    || !HASH.test(ref.sha256 ?? '') || !HASH.test(ref.fieldDigest ?? '')) {
    throw new Error(`Issue ${issueId}: invalid published cover provenance`);
  }
  const key = `${ref.commit}:${ref.path}`;
  if (!sourceFiles.has(key)) {
    const bytes = execFileSync('git', ['--no-pager', 'show', key], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    sourceFiles.set(key, { digest: sha256(bytes), items: JSON.parse(bytes.toString('utf8')).items });
  }
  const source = sourceFiles.get(key);
  const matches = source.items?.filter((item) => item.issueId === issueId);
  const cover = matches?.[0]?.cover;
  if (source.digest !== ref.sha256 || matches?.length !== 1
    || !/^https:\/\//u.test(cover?.path ?? '') || !text(cover.ext)
    || digestCanonicalJson(cover) !== ref.fieldDigest) {
    throw new Error(`Issue ${issueId}: published cover does not match its exact source and field digest`);
  }
  return cover;
}

export async function loadReviewedVendorFields(options, {
  order, mapping, parsedOrder, root, loadResponses,
}) {
  const fail = (reason) => { throw new Error(`${order.id}: ${reason}`); };
  if (!ORDER_IDS.has(order.id) || !order.sourceFile || mapping?.id !== order.id
    || mapping.reviewStatus !== 'approved' || !mapping.relationshipReview
    || mapping.relationshipReview.mappingDigest !== mapping.mappingDigest
    || mapping.relationshipReview.packetDigest !== mapping.packetDigest) {
    fail('reviewed fields require an eligible local checklist and its approved mapping and relationships');
  }
  validateMappingDigest(mapping);
  validateApprovalDigest(mapping.relationshipReview, order.id);
  const bytes = await readFile(options.file);
  if (sha256(bytes) !== options.digest) fail('reviewed fields do not match the approved file digest');
  const input = JSON.parse(bytes.toString('utf8'));
  if (!shape(input, ['version', 'id', 'packetDigest', 'mappingDigest', 'rows'])
    || input.version !== 1 || input.id !== order.id || input.packetDigest !== mapping.packetDigest
    || input.mappingDigest !== mapping.mappingDigest || !Array.isArray(input.rows)) {
    fail('reviewed fields do not bind this source packet and mapping');
  }
  if (parsedOrder.unresolved.length || input.rows.length !== mapping.rows.length
    || parsedOrder.entries.length !== mapping.rows.length) fail('reviewed fields must cover every exact checklist row');

  const responseIds = new Map();
  const seriesByResponseId = new Map();
  const meta = new Map();
  const expectedCovers = new Map();
  const sourceFiles = new Map();
  const seen = new Set();
  for (const [index, mapped] of mapping.rows.entries()) {
    const row = input.rows[index];
    const entry = parsedOrder.entries[index];
    const { issueId } = entry;
    const service = serviceIdentityFor(mapped);
    if (!shape(row, ['sourcePosition', 'issueId', 'appViewer', 'facts', 'responseSha256', 'publishedCover'])
      || row.sourcePosition !== mapped.sourcePosition || entry.sourceKey !== String(mapped.sourcePosition)
      || row.issueId !== issueId || mappedTrackingId(mapped) !== issueId || seen.has(issueId)
      || row.appViewer !== entry.appViewer || entry.appViewer !== service?.appViewer
      || entry.url !== (service ? service.url : mapped.marvelIssueUrl)
      || entry.title !== (entry.findOnly ? findOnlyChecklistTitle(mapped) : checklistTitleForRow(mapped))) {
      fail(`reviewed fields do not match checklist identity at source position ${mapped.sourcePosition}`);
    }
    seen.add(issueId);
    if (service) {
      if (row.facts !== undefined || row.responseSha256 !== undefined || row.publishedCover !== undefined) {
        fail(`service-only issue ${issueId} cannot receive provider fields`);
      }
      continue;
    }
    if (!Number.isSafeInteger(issueId) || issueId <= 0) fail(`invalid provider issue ${issueId}`);
    const detail = {};
    if (row.facts !== undefined) {
      if (!shape(row.facts, Object.keys(FACTS)) || row.responseSha256 !== undefined) {
        fail(`issue ${issueId} has invalid or competing reviewed facts`);
      }
      for (const [field, fact] of Object.entries(row.facts)) {
        if (!shape(fact, ['value', 'sourceSha256', 'fieldDigest']) || !FACTS[field](fact.value)
          || !HASH.test(fact.sourceSha256 ?? '')
          || fact.fieldDigest !== digestCanonicalJson([issueId, field, fact.value, fact.sourceSha256])
          || (field === 'seriesId' && mapped.seriesId != null && fact.value !== Number(mapped.seriesId))
          || (fact.sourceSha256 === mapping.mappingDigest && fact.value !== mapped[field])) {
          fail(`issue ${issueId} has invalid provenance or value for ${field}`);
        }
        detail[field] = fact.value;
      }
    }
    if (row.responseSha256 !== undefined) {
      if (!HASH.test(row.responseSha256) || !options.cache) fail(`issue ${issueId} has no bound response cache`);
      responseIds.set(issueId, row.responseSha256);
      if (mapped.seriesId != null) seriesByResponseId.set(issueId, Number(mapped.seriesId));
    }
    if (row.publishedCover !== undefined) {
      expectedCovers.set(issueId, publishedCover(row.publishedCover, issueId, root, sourceFiles));
    }
    meta.set(issueId, detail);
  }

  if (responseIds.size) {
    const { records, refused } = await loadResponses([...responseIds.keys()], options.cache);
    if (refused.size) fail('a reviewed response must be a successful retained HTTP response');
    for (const [id, digest] of responseIds) {
      const record = records.get(id);
      const link = /^https:\/\/www\.marvel\.com\/comics\/issue\/(\d+)(?:\/|$)/u.exec(record?.body?.detailUrl);
      if (record?.bodySha256 !== digest
        || Number(link?.[1]) !== id
        || (seriesByResponseId.has(id) && Number(record.body.seriesId) !== seriesByResponseId.get(id))) {
        fail(`issue ${id} does not match its reviewed HTTP body digest, issue address or series`);
      }
      meta.set(id, record.body);
    }
  }
  for (const [id, cover] of expectedCovers) {
    const detail = meta.get(id);
    const observed = detail.cover?.path && detail.cover?.extension
      ? { path: detail.cover.path.replace(/^http:/u, 'https:'), ext: detail.cover.extension } : cover;
    if (!isDeepStrictEqual(observed, cover)) fail(`issue ${id} has competing cover fields`);
    meta.set(id, { ...detail, cover: { path: cover.path, extension: cover.ext } });
  }
  return { meta, refused: new Set(), expectedCovers };
}
