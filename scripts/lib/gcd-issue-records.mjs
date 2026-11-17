// Reads the separately licensed Grand Comics Database issue records and derives, from one record,
// the only details an owner-confirmed comic may take from it: a release date and credits.
//
// The records are CC BY-SA 4.0, so they live in one file the LICENSE names, and a supplement in an
// owner mapping must equal what this module derives rather than carrying its own reading of the
// database. That makes the record, with its address and retrieval date, the single place a fact
// can come from, and a hand edit to a mapping fails instead of quietly drifting from its source.
// Cover images, page counts and prose are never derived: the owner approved dates and credits only.
import assert from 'node:assert/strict';
import fs from 'node:fs';

export const GCD_RECORDS_PATH = 'scripts/data/owner-gcd/issues.json';
// Every tracked file allowed to hold these records or anything derived from them. LICENSE names each
// one outside its MIT grant, and test/licence-boundary.test.js holds every tracked file carrying them
// to LICENSE, so share-alike data cannot settle somewhere the MIT grant would appear to cover it.
export const GCD_LICENSED_FILES = Object.freeze([
  GCD_RECORDS_PATH,
  'scripts/data/owner-mappings/avengers-armageddon.json',
  'src/data/avengers_armageddon.json',
]);
export const GCD_ISSUE_URL = /^https:\/\/www\.comics\.org\/issue\/([1-9]\d*)\/$/;
export const GCD_LICENSE = Object.freeze({
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
});
const FILE_KEYS = ['source', 'sourceUrl', 'license', 'licenseUrl', 'attribution', 'records'];
const RECORD_KEYS = ['gcdIssueId', 'url', 'apiUrl', 'retrievedAt', 'seriesName', 'number', 'onSaleDate', 'sequences'];
const SEQUENCE_KEYS = ['sequenceNumber', 'type', 'script', 'pencils'];
const SEQUENCE_TYPES = new Set(['cover', 'comic story']);
// The database's own spellings of "no credit": an empty field, "None", or "?" for unknown.
const NO_CREDIT = new Set(['', 'none', '?']);

function sameKeys(value, keys, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} has unsupported or missing fields.`);
}

function isoDate(value, label) {
  assert.match(value ?? '', /^\d{4}-\d{2}-\d{2}$/, `${label} must be a YYYY-MM-DD date.`);
  assert.equal(new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10), value, `${label} must be a calendar date.`);
}

// Splits a credit field on the semicolons between people, ignoring any inside an annotation.
function splitPeople(text) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    assert.ok(depth >= 0, `Unbalanced annotation in credit "${text}".`);
    if (ch === ';' && depth === 0) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  assert.equal(depth, 0, `Unbalanced annotation in credit "${text}".`);
  out.push(current);
  return out;
}

// One credit field to the plain names it credits. Annotations such as "(credited)" and
// "(signed as ...)" describe how the name was printed, not who did the work, so they are dropped.
// Anything still shaped like markup after that is an unfamiliar form, and it fails rather than
// putting a half-cleaned name in front of a reader.
export function gcdCreditNames(text) {
  if (NO_CREDIT.has(String(text ?? '').trim().toLowerCase())) return [];
  return splitPeople(text).map((part) => {
    let name = part;
    let previous;
    do {
      previous = name;
      name = name.replace(/\s*\((?:[^()]|\([^()]*\))*\)\s*$/, '');
    } while (name !== previous);
    name = name.trim();
    assert.ok(name && !/[()[\];?]/.test(name), `Unrecognized credit form "${part.trim()}".`);
    return name;
  });
}

export function validateGcdRecords(file) {
  sameKeys(file, FILE_KEYS, 'Grand Comics Database record file');
  assert.equal(file.source, 'Grand Comics Database');
  assert.equal(file.sourceUrl, 'https://www.comics.org/');
  assert.equal(file.license, GCD_LICENSE.license);
  assert.equal(file.licenseUrl, GCD_LICENSE.licenseUrl);
  assert.ok(typeof file.attribution === 'string' && file.attribution.includes('Grand Comics Database')
    && file.attribution.includes(GCD_LICENSE.licenseUrl), 'The record file must carry its attribution.');
  assert.ok(Array.isArray(file.records) && file.records.length > 0, 'The record file must hold records.');
  const seen = new Set();
  for (const record of file.records) {
    const label = `Grand Comics Database record ${record?.gcdIssueId}`;
    sameKeys(record, RECORD_KEYS, label);
    assert.ok(Number.isSafeInteger(record.gcdIssueId) && record.gcdIssueId > 0, `${label}: needs a positive id.`);
    assert.ok(!seen.has(record.gcdIssueId), `${label}: appears twice.`);
    seen.add(record.gcdIssueId);
    assert.equal(record.url, `https://www.comics.org/issue/${record.gcdIssueId}/`, `${label}: url must be its issue page.`);
    assert.equal(record.apiUrl, `https://www.comics.org/api/issue/${record.gcdIssueId}/?format=json`, `${label}: apiUrl must be its API record.`);
    isoDate(record.retrievedAt, `${label} retrievedAt`);
    isoDate(record.onSaleDate, `${label} onSaleDate`);
    assert.ok(typeof record.seriesName === 'string' && record.seriesName.trim(), `${label}: needs its series name.`);
    assert.ok(typeof record.number === 'string' && record.number.trim(), `${label}: needs its number.`);
    assert.ok(Array.isArray(record.sequences) && record.sequences.length > 0, `${label}: needs sequences.`);
    for (const sequence of record.sequences) {
      sameKeys(sequence, SEQUENCE_KEYS, `${label} sequence`);
      assert.ok(SEQUENCE_TYPES.has(sequence.type), `${label}: keeps only cover and comic story sequences.`);
      assert.ok(Number.isSafeInteger(sequence.sequenceNumber) && sequence.sequenceNumber >= 0, `${label}: bad sequence number.`);
      assert.equal(typeof sequence.script, 'string');
      assert.equal(typeof sequence.pencils, 'string');
    }
    assert.ok(record.sequences.some((sequence) => sequence.type === 'comic story'), `${label}: needs a comic story.`);
  }
  return file;
}

let cached = null;
export function loadGcdRecords(path = GCD_RECORDS_PATH) {
  if (path !== GCD_RECORDS_PATH) return validateGcdRecords(JSON.parse(fs.readFileSync(path, 'utf8')));
  cached ??= validateGcdRecords(JSON.parse(fs.readFileSync(GCD_RECORDS_PATH, 'utf8')));
  return cached;
}

// Payload-shaped fields for one record: cover artists, then pencilers, then writers, the order
// the existing supplements use, each name once per role.
export function deriveGcdFields(record) {
  const credits = [];
  const add = (names, role) => {
    for (const name of names) {
      if (!credits.some((credit) => credit.name === name && credit.role === role)) credits.push({ name, role });
    }
  };
  const covers = record.sequences.filter((sequence) => sequence.type === 'cover');
  const stories = record.sequences.filter((sequence) => sequence.type === 'comic story');
  for (const sequence of covers) add(gcdCreditNames(sequence.pencils), 'cover artist');
  for (const sequence of stories) add(gcdCreditNames(sequence.pencils), 'penciler');
  for (const sequence of stories) add(gcdCreditNames(sequence.script), 'writer');
  assert.ok(credits.some((credit) => credit.role === 'writer'), `Grand Comics Database record ${record.gcdIssueId}: no writer credit.`);
  return { onSale: `${record.onSaleDate}T00:00:00+0000`, creators: credits };
}

// The fields a `gcd-issue` supplement source must carry, checked against the record it names.
export function gcdSupplementFields(url, retrievedAt, file = loadGcdRecords()) {
  const match = GCD_ISSUE_URL.exec(url ?? '');
  assert.ok(match, `Not a Grand Comics Database issue page: ${url}`);
  const record = file.records.find((candidate) => candidate.gcdIssueId === Number(match[1]));
  assert.ok(record, `No pinned Grand Comics Database record for ${url}.`);
  // One retrieval date covers every source in a supplement, so it cannot predate this record's.
  assert.ok(typeof retrievedAt === 'string' && retrievedAt >= record.retrievedAt,
    `The supplement's retrieval date cannot predate the record's, ${record.retrievedAt}.`);
  return deriveGcdFields(record);
}
