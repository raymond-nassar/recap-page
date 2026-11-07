// The one recorded way an owner-confirmed comic may carry details the metadata provider never held.
//
// An owner-confirmed identity exists because the provider answered 404, so for those rows the
// provider will never supply a cover, a date or credits. The owner approved on 2026-11-06 filling
// that gap from two named outside sources, per comic and with provenance, rather than leaving the
// rows blank forever: the cover image address from the comic's own marvel.com issue page, and the
// release date, page count and credits from a pinned revision of its Marvel Fandom wiki page.
//
// Everything here is a closed shape on purpose. The fields that decide availability or launch,
// `mu` and `digitalId`, can never arrive this way (constraints 6 and 7), and neither can
// `seriesId`, so the app still reads the comic as one with no provider metadata. A cover is an
// address on the pinned CDN only, never image bytes (constraint 1).
import assert from 'node:assert/strict';
import { normalizeCover, OWNER_EXTERNAL_SUPPLEMENT } from '../../src/js/lib/model.js';
import { allowedCoverUrl } from '../../src/js/lib/coverHost.js';

export const OWNER_EXTERNAL_SUPPLEMENT_KIND = OWNER_EXTERNAL_SUPPLEMENT;
export const SUPPLEMENT_FIELDS = Object.freeze(['cover', 'onSale', 'pageCount', 'creators']);
const SOURCE_FIELDS = Object.freeze({
  'marvel-issue-page': Object.freeze(['cover']),
  'marvel-fandom-wiki': Object.freeze(['onSale', 'pageCount', 'creators']),
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
  return supplement;
}

// The item fields a vendored payload carries for a supplemented row, in the payload's own shape.
export function supplementItemFields(row) {
  const { fields } = validateOwnerExternalSupplement(row);
  return {
    onSale: fields.onSale ?? null,
    cover: fields.cover ?? null,
    pageCount: fields.pageCount ?? null,
    creators: fields.creators ?? [],
  };
}
