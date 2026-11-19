// The one recorded way an owner-confirmed comic may carry details the metadata provider never held.
//
// An owner-confirmed identity exists because the provider answered 404, so for those rows the
// provider will never supply a cover, a date or credits. The owner approved on 2026-11-06 filling
// that gap from two named outside sources, per comic and with provenance, rather than leaving the
// rows blank forever: the cover image address from the comic's own marvel.com issue page, and the
// release date, page count and credits from a pinned revision of its Marvel Fandom wiki page.
//
// The owner approved a third source on 2026-11-16 for comics too new for the wiki: the Grand Comics
// Database, for the release date and credits only, never a cover or prose. Its data is CC BY-SA 4.0,
// so a `gcd-issue` source must name a record in the separately licensed record file, and the fields
// it supplies must equal what that record derives (see gcd-issue-records.mjs). The two outside
// detail sources never mix in one supplement, so each comic's details carry exactly one licence.
//
// Everything here is a closed shape on purpose. The fields that decide availability or launch,
// `mu` and `digitalId`, can never arrive this way (constraints 6 and 7), and neither can
// `seriesId`, so the app still reads the comic as one with no provider metadata. A cover is an
// address on the pinned CDN only, never image bytes (constraint 1).
import assert from 'node:assert/strict';
import { normalizeCover, OWNER_EXTERNAL_SUPPLEMENT, OWNER_GCD_SUPPLEMENT } from '../../src/js/lib/model.js';
import { allowedCoverUrl } from '../../src/js/lib/coverHost.js';
import { GCD_ISSUE_URL, gcdSupplementFields } from './gcd-issue-records.mjs';

export const OWNER_EXTERNAL_SUPPLEMENT_KIND = OWNER_EXTERNAL_SUPPLEMENT;
export const SUPPLEMENT_FIELDS = Object.freeze(['cover', 'onSale', 'pageCount', 'creators']);
const SOURCE_FIELDS = Object.freeze({
  'marvel-issue-page': Object.freeze(['cover']),
  'marvel-fandom-wiki': Object.freeze(['onSale', 'pageCount', 'creators']),
  'gcd-issue': Object.freeze(['onSale', 'creators']),
});
const SUPPLEMENT_KEYS = ['kind', 'approvedBy', 'approvedAt', 'retrievedAt', 'fields', 'sources'];
const FANDOM_REVISION = /^https:\/\/marvel\.fandom\.com\/wiki\/[A-Za-z0-9_%().'-]+\?oldid=[1-9]\d*$/;
const CREDIT_ROLE = /writer|penciler|artist/i;

function isoDate(value, label) {
  assert.match(value ?? '', /^\d{4}-\d{2}-\d{2}$/, `${label} must be a YYYY-MM-DD date.`);
  assert.equal(new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10), value, `${label} must be a calendar date.`);
}

function sameKeys(value, keys, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} has unsupported or missing fields.`);
}

// Throws unless `row` is an owner-confirmed mapping row whose supplement is complete, closed and
// traceable field by field to exactly one named source. Returns the supplement for convenience.
export function validateOwnerExternalSupplement(row, label = `Source position ${row?.sourcePosition}`) {
  const supplement = row?.externalMetadataSupplement;
  assert.equal(row?.identityEvidenceKind, 'owner-confirmed-identity',
    `${label}: an external metadata supplement belongs only to an owner-confirmed identity.`);
  sameKeys(supplement, SUPPLEMENT_KEYS, `${label} supplement`);
  assert.equal(supplement.kind, OWNER_EXTERNAL_SUPPLEMENT_KIND, `${label}: unknown supplement kind.`);
  assert.ok(typeof supplement.approvedBy === 'string' && supplement.approvedBy.trim(),
    `${label}: a supplement needs the approving owner.`);
  isoDate(supplement.approvedAt, `${label} supplement approval`);
  isoDate(supplement.retrievedAt, `${label} supplement retrieval`);

  const { fields } = supplement;
  assert.ok(fields && typeof fields === 'object' && !Array.isArray(fields), `${label}: supplement fields must be an object.`);
  const present = Object.keys(fields);
  assert.ok(present.length > 0 && present.every((field) => SUPPLEMENT_FIELDS.includes(field)),
    `${label}: a supplement may carry only ${SUPPLEMENT_FIELDS.join(', ')}.`);
  // Every reader-facing sentence about a supplemented comic promises a cover and credits.
  assert.ok(Object.hasOwn(fields, 'cover') && Object.hasOwn(fields, 'creators'),
    `${label}: a supplement must carry both a cover and credits.`);
  if (Object.hasOwn(fields, 'cover')) {
    assert.ok(allowedCoverUrl(fields.cover?.path), `${label}: a supplement cover must be an address on the pinned cover host.`);
    assert.deepEqual(normalizeCover(fields.cover), fields.cover, `${label}: a supplement cover must already be normalized.`);
  }
  if (Object.hasOwn(fields, 'onSale')) {
    assert.match(fields.onSale ?? '', /^\d{4}-\d{2}-\d{2}T00:00:00\+0000$/, `${label}: supplement onSale must be a provider-shaped date.`);
    isoDate(fields.onSale.slice(0, 10), `${label} supplement onSale`);
  }
  if (Object.hasOwn(fields, 'pageCount')) {
    assert.ok(Number.isSafeInteger(fields.pageCount) && fields.pageCount > 0, `${label}: supplement pageCount must be positive.`);
  }
  if (Object.hasOwn(fields, 'creators')) {
    assert.ok(Array.isArray(fields.creators) && fields.creators.length > 0, `${label}: supplement creators must be a nonempty list.`);
    for (const credit of fields.creators) {
      sameKeys(credit, ['name', 'role'], `${label} supplement credit`);
      assert.ok(typeof credit.name === 'string' && credit.name.trim() && credit.name === credit.name.trim(),
        `${label}: a supplement credit needs a name.`);
      assert.ok(typeof credit.role === 'string' && CREDIT_ROLE.test(credit.role),
        `${label}: a supplement credit role must be one the payload keeps.`);
    }
  }

  assert.ok(Array.isArray(supplement.sources) && supplement.sources.length > 0, `${label}: a supplement needs its sources.`);
  const covered = [];
  for (const source of supplement.sources) {
    sameKeys(source, ['kind', 'url', 'fields'], `${label} supplement source`);
    const allowed = SOURCE_FIELDS[source.kind];
    assert.ok(allowed, `${label}: unknown supplement source kind ${source.kind}.`);
    if (source.kind === 'marvel-issue-page') {
      assert.equal(source.url, row.marvelIssueUrl, `${label}: the cover source must be the comic's own marvel.com issue page.`);
    } else if (source.kind === 'gcd-issue') {
      assert.match(source.url ?? '', GCD_ISSUE_URL, `${label}: a Grand Comics Database source must name one issue page.`);
    } else {
      assert.match(source.url ?? '', FANDOM_REVISION, `${label}: a wiki source must name one pinned page revision.`);
    }
    assert.ok(Array.isArray(source.fields) && source.fields.length > 0
      && source.fields.every((field) => allowed.includes(field)),
    `${label}: ${source.kind} cannot supply ${JSON.stringify(source.fields)}.`);
    covered.push(...source.fields);
  }
  assert.deepEqual([...covered].sort(), [...present].sort(),
    `${label}: every supplemented field needs exactly one recorded source.`);
  const kinds = new Set(supplement.sources.map((source) => source.kind));
  assert.ok(!(kinds.has('gcd-issue') && kinds.has('marvel-fandom-wiki')),
    `${label}: a supplement takes details from one outside source, not both.`);
  // One pinned record per comic. A second gcd-issue source would otherwise pass unchecked, since
  // its address need only look like an issue page, and could carry invented credits.
  const gcdSources = supplement.sources.filter((source) => source.kind === 'gcd-issue');
  assert.ok(gcdSources.length <= 1, `${label}: a supplement takes one Grand Comics Database issue record.`);
  for (const gcd of gcdSources) {
    const derived = gcdSupplementFields(gcd.url, supplement.retrievedAt);
    for (const field of gcd.fields) {
      assert.deepEqual(fields[field], derived[field],
        `${label}: supplement ${field} must equal the pinned Grand Comics Database record.`);
    }
  }
  return supplement;
}

// Which outside source supplied a supplemented row's details, as the closed item kind the app
// reads, so a payload item can say which licence its details carry.
export function supplementItemKind(row) {
  const { sources } = validateOwnerExternalSupplement(row);
  return sources.some((source) => source.kind === 'gcd-issue') ? OWNER_GCD_SUPPLEMENT : OWNER_EXTERNAL_SUPPLEMENT;
}

// The item fields a vendored payload carries for a supplemented row, in the payload's own shape.
export function supplementItemFields(row) {
  const { fields } = validateOwnerExternalSupplement(row);
  return {
    onSale: fields.onSale ?? null,
    cover: fields.cover ?? null,
    pageCount: fields.pageCount ?? null,
    creators: fields.creators ?? [],
    metadataSourceKind: supplementItemKind(row),
  };
}

// The supplement one list may borrow for an owner-confirmed comic it reuses from another reviewed
// owner list, so the same comic shows the same cover, date and credits in both. A list's own
// mapping always wins: a row it reviewed bare stays bare. Only details under the project's own
// licence are borrowed, never Grand Comics Database ones, because copying those would put a
// share-alike payload where none was granted. Two lists that disagree lend nothing, so no field
// is ever combined or chosen between.
export function borrowedSupplement(issueId, { ownMappedIds, mappings }) {
  const id = String(issueId);
  if (ownMappedIds.has(id)) return { supplement: undefined, reason: 'own-mapping-row' };
  const lenders = [];
  for (const { listId, rows } of mappings) {
    for (const row of rows) {
      if (String(row.selectedIssueId) !== id || !Object.hasOwn(row, 'externalMetadataSupplement')) continue;
      const fields = supplementItemFields(row);
      if (fields.metadataSourceKind === OWNER_GCD_SUPPLEMENT) continue;
      lenders.push({ listId, fields });
    }
  }
  if (!lenders.length) return { supplement: undefined, reason: 'no-lender' };
  const first = JSON.stringify(lenders[0].fields);
  if (lenders.some((lender) => JSON.stringify(lender.fields) !== first)) {
    return { supplement: undefined, reason: 'conflict', lenders: lenders.map((lender) => lender.listId) };
  }
  return { supplement: lenders[0].fields, reason: 'borrowed', lenders: lenders.map((lender) => lender.listId) };
}
