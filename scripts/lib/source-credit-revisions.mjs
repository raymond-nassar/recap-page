import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digestCanonicalJson } from './cbh-inventory.mjs';

// Append reviewed digests only; existing entries are the independent history authority.
export const REVIEWED_CREDIT_DIGESTS = Object.freeze([
  'fab0f614f22e876910386a1baf26ea44c22a3c95568119849a5164d443c462b0',
  'f3fd0ecac4ef51e38fbb27187cf2e70a6c6b582b069696998c4743d080ad8ff6',
  '7b41f67b2db1af02ca15f201cd0fbea3d3a40668d597879debd2cd2ce42e38d7',
  'ab989e672fd357bf4a4ff36cb4080ce20a10376803347b5735775697da42dddc',
]);

const keys = (value, expected, label) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label}: expected an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label}: unexpected fields`);
};
const text = (value, label) => {
  assert.equal(typeof value, 'string', `${label}: expected text`);
  assert.ok(value.length > 0 && value === value.trim() && !/[\r\n]/.test(value), `${label}: invalid text`);
};
const https = (value, label) => {
  text(value, label);
  const parsed = new URL(value);
  assert.equal(parsed.protocol, 'https:', `${label}: expected HTTPS`);
  assert.ok(!parsed.username && !parsed.password, `${label}: credentials are forbidden`);
};
const section = (value, label) => {
  if (value !== null) text(value, label);
};
const credit = (value, label) => {
  keys(value, ['source', 'section'], label);
  https(value.source, `${label} source`);
  section(value.section, `${label} section`);
};
const same = (left, right) => left.source === right.source && left.section === right.section;

export function createSourceCreditRevisions(record, lock, pinned = REVIEWED_CREDIT_DIGESTS) {
  keys(record, ['schemaVersion', 'entries'], 'Credit revisions');
  keys(lock, ['schemaVersion', 'digests'], 'Credit revision lock');
  assert.equal(record.schemaVersion, 1);
  assert.equal(lock.schemaVersion, 1);
  assert.ok(Array.isArray(record.entries) && Array.isArray(lock.digests) && Array.isArray(pinned));
  assert.deepEqual(lock.digests, pinned, 'Credit revision history differs from the independently reviewed pins');
  assert.deepEqual(record.entries.map(digestCanonicalJson), pinned, 'Credit revision record differs from its reviewed history');
  const byId = new Map();
  const byFile = new Map();
  for (const entry of record.entries) {
    keys(entry, ['id', 'file', 'before', 'after', 'sourceOrigin', 'sourceLicense', 'evidence', 'approval'], 'Credit revision');
    assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.match(entry.file, /^[a-z0-9_]+\.json$/);
    credit(entry.before, `${entry.id} before`);
    credit(entry.after, `${entry.id} after`);
    assert.ok(!same(entry.before, entry.after), `${entry.id}: revision changes nothing`);
    text(entry.sourceOrigin, `${entry.id} origin`);
    assert.ok(entry.sourceLicense === null || typeof entry.sourceLicense === 'string', `${entry.id}: invalid licence`);
    if (entry.sourceLicense !== null) text(entry.sourceLicense, `${entry.id} licence`);
    assert.match(entry.approval, /^https:\/\/github\.com\/raymond-nassar\/recap-page\/issues\/\d+#issuecomment-\d+$/);
    assert.ok(Array.isArray(entry.evidence) && entry.evidence.length > 0, `${entry.id}: evidence is required`);
    for (const item of entry.evidence) {
      keys(item, ['url', 'section', 'method', 'retrieved', 'record'], `${entry.id} evidence`);
      https(item.url, `${entry.id} evidence URL`);
      section(item.section, `${entry.id} evidence section`);
      text(item.method, `${entry.id} evidence method`);
      text(item.record, `${entry.id} evidence record`);
      assert.match(item.record, /^scripts\/data\/[a-z0-9_/-]+\.json$/);
      assert.match(item.retrieved, /^\d{4}-\d{2}-\d{2}$/);
      const date = new Date(`${item.retrieved}T00:00:00.000Z`);
      assert.ok(!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === item.retrieved,
        `${entry.id}: invalid retrieval date`);
    }
    assert.ok(entry.evidence.some((item) => item.url === entry.after.source
      && (entry.after.section === null || item.section === entry.after.section)),
    `${entry.id}: published credit needs matching evidence`);
    const chain = byId.get(entry.id) ?? [];
    if (chain.length) {
      const previous = chain.at(-1);
      assert.equal(entry.file, previous.file, `${entry.id}: revision file changed`);
      assert.equal(entry.sourceOrigin, previous.sourceOrigin, `${entry.id}: owner curation changed`);
      assert.equal(entry.sourceLicense, previous.sourceLicense, `${entry.id}: licence changed`);
      assert.ok(same(entry.before, previous.after), `${entry.id}: revision history is discontinuous`);
    }
    assert.ok(!byFile.has(entry.file) || byFile.get(entry.file) === entry.id, `${entry.file}: shared revision file`);
    chain.push(entry);
    byId.set(entry.id, chain);
    byFile.set(entry.file, entry.id);
  }

  function revisionFor(value, file) {
    const chain = byId.get(value.id);
    const matchingFile = file ?? value.file ?? value.out;
    if (matchingFile && byFile.has(matchingFile)) {
      assert.equal(value.id, byFile.get(matchingFile), `${matchingFile}: credit identity changed`);
    }
    if (!chain) return null;
    if (matchingFile != null) assert.equal(matchingFile, chain[0].file, `${value.id}: credit file changed`);
    return chain;
  }

  function readPublished(value, chain) {
    https(value.source, `${value.id} published source`);
    let publishedSection = null;
    if (Object.hasOwn(value, 'sourceSection')) {
      text(value.sourceSection, `${value.id} published section`);
      publishedSection = value.sourceSection;
    }
    assert.equal(value.sourceOrigin, chain[0].sourceOrigin, `${value.id}: credit origin changed`);
    assert.equal(value.sourceLicense, chain[0].sourceLicense, `${value.id}: credit licence changed`);
    return { source: value.source, section: publishedSection };
  }

  function replaceCredit(value, next) {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      if (key === 'source') {
        return [['source', next.source], ...(next.section === null ? [] : [['sourceSection', next.section]])];
      }
      return key === 'sourceSection' ? [] : [[key, item]];
    }));
  }

  function apply(value, file) {
    const chain = revisionFor(value, file);
    if (!chain) return value;
    const current = readPublished(value, chain);
    const states = [chain[0].before, ...chain.map((entry) => entry.after)];
    assert.ok(states.some((state) => same(state, current)), `${value.id}: unrecorded source credit`);
    const latest = chain.at(-1).after;
    return same(current, latest) ? value : replaceCredit(value, latest);
  }

  function assertLatest(value, file) {
    const chain = revisionFor(value, file);
    if (!chain) return value;
    assert.ok(same(readPublished(value, chain), chain.at(-1).after), `${value.id}: published credit is not latest`);
    return value;
  }

  function undo(value, file, { historical = false } = {}) {
    const chain = revisionFor(value, file);
    if (!chain) return value;
    const current = readPublished(value, chain);
    if (historical) {
      assert.ok([chain[0].before, ...chain.map((entry) => entry.after)].some((state) => same(state, current)),
        `${value.id}: unrecorded historical source credit`);
    } else {
      assert.ok(same(current, chain.at(-1).after), `${value.id}: published credit is not latest`);
    }
    return same(current, chain[0].before) ? value : replaceCredit(value, chain[0].before);
  }

  function validateOrders(orders, generated = []) {
    for (const [id, chain] of byId) {
      const matches = orders.filter((order) => order.id === id);
      assert.equal(matches.length, 1, `${id}: revised list is missing or duplicated`);
      const order = matches[0];
      assert.equal(order.out, chain[0].file, `${id}: manifest output changed`);
      assert.equal(order.sourceOrigin, chain[0].sourceOrigin, `${id}: manifest origin changed`);
      assert.equal(order.sourceLicense, chain[0].sourceLicense, `${id}: manifest licence changed`);
      assert.ok(same({ source: order.sourcePage, section: order.sourceSection ?? null }, chain[0].before),
        `${id}: manifest is not the original approved credit`);
      assert.equal(orders.filter((other) => other.out === order.out).length, 1, `${id}: manifest output collision`);
      assert.ok(!generated.includes(order.out), `${id}: generated output collision`);
    }
  }

  return { entries: record.entries, apply, assertLatest, undo, validateOrders };
}

const read = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
export const sourceCreditRevisions = createSourceCreditRevisions(
  read('source-credit-revisions.json'), read('source-credit-revisions.lock.json'),
);
