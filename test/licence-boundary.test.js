import { currentReadingCensus } from './helpers/current-reading-library.mjs';
import { GCD_LICENSED_FILES } from '../scripts/lib/gcd-issue-records.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const catalogUrl = new URL('../src/data/catalog.json', import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function shippedOrders() {
  const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));
  const out = [];
  for (const list of catalog.lists) {
    out.push({ file: list.file, order: JSON.parse(await readFile(new URL(`../src/data/${list.file}`, import.meta.url), 'utf8')) });
  }
  return out;
}

// The licence boundary is a property of the committed bytes, so it is checked against the committed
// bytes rather than against the script that writes them. A future vendoring run, a hand edit or a
// restored backup can all put the field back, and only this notices.
//
// The field is Marvel's own prose reproduced verbatim, which is what separates it from every other
// copied field: an id, a title, a number, a date, a series and a link are all facts about a
// publication. 798 of 1,745 records carried one, 151,840 characters in all, and the provenance
// record named it as the field to look at hardest. Removing it cost one sentence on one screen.
test('no shipped reading order carries Marvel description prose', async () => {
  const orders = await shippedOrders();
  assert.ok(orders.length > 0, 'no orders were read, so this test proves nothing');

  const offenders = [];
  let items = 0;
  for (const { file, order } of orders) {
    for (const item of order.items) {
      items += 1;
      assert.ok('description' in item, `${file}: ${item.issueId} is missing the description key`);
      if (item.description !== null) offenders.push(`${file}: ${item.issueId} carries ${JSON.stringify(item.description).slice(0, 60)}`);
    }
  }

  assert.equal(orders.length, currentReadingCensus.visible, 'The independently registered catalog population changed.');

  assert.ok(items > 1000, `only ${items} items were checked, so the data tree is not what this test thinks it is`);
  assert.deepEqual(offenders, [], `Marvel description prose is committed again in ${offenders.length} record(s)`);
});

// The test above reads only files named by the catalog, so it misses the noncatalog parent and
// the design mockups. That is the shape of the miss it was written to prevent: the first strip left 41
// descriptions in docs/archive/mockups/mock-data.js, a generated projection of a reading order that no
// catalog lists and no gate walked. A boundary defined by an enumeration is a boundary someone has
// to keep complete, so this one is defined by the tree instead.
//
// The count below is exact rather than a floor, and the reason is the parse that feeds it. Most of
// the files walked are code and cannot parse, so a file that stops parsing has to be skipped
// silently or the test would fail on every script in the repository. That skip is a hole aimed
// straight at the one file this test exists for: reformat the mockup bundle, or move it, and it
// leaves the population with nothing said. A floor of two hundred and thirty-two still passes at
// that point, because the catalog's own files alone clear it. The exact census below does not.
//
// A review suggested pre-filtering on the literal "items" key so that package-lock.json is not
// parsed. Avoiding one small parse is not the point. The cost is a second boundary to keep correct,
// aimed at the same file as the first. The mockup bundle is generated, it quotes its keys today,
// and nothing makes it keep doing so.
async function everyDataBearingFile(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.copilot-tracking'].includes(entry.name)) continue;
      await everyDataBearingFile(full, out);
    } else if (/\.(json|js|mjs)$/.test(entry.name) && entry.name !== 'anchors.lock.json') {
      out.push(full);
    }
  }
  return out;
}

test('no file outside node_modules, .git and .copilot-tracking carries an items[].description string', async () => {
  const files = await everyDataBearingFile(repoRoot);
  assert.ok(files.length > 50, `only ${files.length} files were walked, so this test proves nothing`);

  const offenders = [];
  let scanned = 0;
  const androidBuild = path.join(repoRoot, 'packaging', 'android', 'app', 'build') + path.sep;
  const iosBuild = path.join(repoRoot, 'packaging', 'ios', 'build') + path.sep;
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    // Data files, and generated ones like the mockups' bundle, are objects with an items array.
    // Anything that parses that way is in scope wherever it lives.
    const start = text.indexOf('{');
    if (start < 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(text.slice(start).replace(/;\s*$/, ''));
    } catch {
      continue;
    }
    if (!Array.isArray(parsed?.items)) continue;
    // Generated Android and iOS copies still undergo the prose check, but do not inflate the source census.
    if (!file.startsWith(androidBuild) && !file.startsWith(iosBuild)) scanned += 1;
    for (const item of parsed.items) {
      if (typeof item?.description === 'string' && item.description.length > 0) {
        offenders.push(`${path.relative(repoRoot, file)}: ${item.issueId ?? '?'} carries ${JSON.stringify(item.description).slice(0, 60)}`);
      }
    }
  }

  assert.equal(scanned, currentReadingCensus.itemFiles, 'The independently registered item-file population changed.');

  assert.deepEqual(offenders, [], `Marvel description prose is committed in ${offenders.length} record(s) somewhere in the scanned tree`);
});

// The strip above is one edit away from a silent product regression, because the order carries a
// description of its own with the same field name. That one is editorial copy written here, it is
// what the catalog shows a reader and what catalog search matches on, and it must survive.
test('every shipped order keeps its own editorial description', async () => {
  const orders = await shippedOrders();
  for (const { file, order } of orders) {
    assert.equal(typeof order.description, 'string', `${file} lost its own description`);
    assert.ok(order.description.length > 40, `${file} has a description too short to be the editorial one`);
  }
});

// The Grand Comics Database's data is CC BY-SA 4.0, and share-alike follows it wherever it is
// copied. LICENSE carves out each file or folder that holds it by name, so a copy anywhere else
// would sit under the MIT grant while saying nothing about it. The markers are the ones the owner
// route writes: a mapping supplement's gcd-issue source, a payload item's owner-gcd-supplement kind
// and a pinned issue record with its on-sale date, a shape the collected-editions check inputs share.
// A comics.org page address on its own is a citation, which reading lists carry freely.
function gcdMarkers(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) gcdMarkers(entry, found);
  } else if (value && typeof value === 'object') {
    if (value.kind === 'gcd-issue') found.add('gcd-issue source');
    if (value.metadataSourceKind === 'owner-gcd-supplement') found.add('owner-gcd-supplement item');
    if (Number.isInteger(value.gcdIssueId) && 'onSaleDate' in value) found.add('dated GCD issue record');
    for (const entry of Object.values(value)) gcdMarkers(entry, found);
  }
  return found;
}

// A source ledger can hold a database fact without any of those markers: a reused comic's row
// records the on-sale date it took from a lender list, as a bare date beside the lender's mapping.
// The date alone cannot tell a copied fact from a coincidence, so this follows it to the lender and
// counts the row only when that mapping's supplement for the same issue takes its on-sale date from
// a gcd-issue source and states the same day. A lender whose date came from anywhere else does not
// count, however well the dates agree.
// The lender path is read from the ledger, so it is resolved only against the tracked owner
// mappings, and a lender that cannot be read fails the test. Counting an unreadable lender as
// non-database would let a broken or mistyped reference quietly clear the licence check.
const ownerMappingFiles = new Set(execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z', '--', 'scripts/data/owner-mappings'],
  { cwd: repoRoot, encoding: 'utf8' }).split('\u0000').filter((file) => /^scripts\/data\/owner-mappings\/[^/]+\.json$/.test(file)));

async function gcdDerivedLedgerIssues(value, known = ownerMappingFiles) {
  const mappings = new Map();
  const mapping = async (file) => {
    if (!known.has(file)) throw new Error(`A ledger names lender ${file}, which is not a tracked owner mapping`);
    if (!mappings.has(file)) {
      let parsed;
      try {
        parsed = JSON.parse(await readFile(path.join(repoRoot, file), 'utf8'));
      } catch (error) {
        throw new Error(`Lender ${file} could not be read: ${error.message}`, { cause: error });
      }
      if (!Array.isArray(parsed?.rows)) throw new Error(`Lender ${file} has no rows`);
      mappings.set(file, parsed);
    }
    return mappings.get(file);
  };
  const derived = new Set();
  for (const row of Array.isArray(value?.sourceRows) ? value.sourceRows : []) {
    const lenders = row?.identityEvidence?.publishedIn;
    if (!Number.isInteger(row?.selectedIssueId) || !Array.isArray(lenders)) continue;
    for (const lender of lenders) {
      if (typeof lender?.mapping !== 'string' || typeof lender.supplementOnSale !== 'string') continue;
      const lent = (await mapping(lender.mapping)).rows
        .find((entry) => entry?.selectedIssueId === row.selectedIssueId)?.externalMetadataSupplement;
      const fromGcd = (lent?.sources ?? []).some((source) => source?.kind === 'gcd-issue'
        && Array.isArray(source.fields) && source.fields.includes('onSale'));
      if (fromGcd && lent.fields?.onSale?.slice(0, 10) === lender.supplementOnSale) derived.add(row.selectedIssueId);
    }
  }
  return derived;
}

test('a ledger counts as holding database details only for dates its lenders took from the database', async () => {
  const ledger = JSON.parse(await readFile(path.join(repoRoot, 'scripts/data/curated-source-ledgers/chip-zdarsky-reading-list.json'), 'utf8'));
  const payload = JSON.parse(await readFile(path.join(repoRoot, 'src/data/chip_zdarsky_reading_list.json'), 'utf8'));
  const kindOf = new Map(payload.items.map((item) => [item.issueId, item.metadataSourceKind ?? null]));
  const derived = [...await gcdDerivedLedgerIssues(ledger)].sort((a, b) => a - b);
  const fromGcd = payload.items.filter((item) => item.metadataSourceKind === 'owner-gcd-supplement')
    .map((item) => item.issueId).sort((a, b) => a - b);
  assert.equal(fromGcd.length, 9, 'The list no longer shows the nine comics with database details.');
  assert.deepEqual(derived, fromGcd);

  // The controls: reused rows whose lender dates agree but came from elsewhere, and the one left bare.
  const reused = ledger.sourceRows.filter((row) => row.identityEvidence?.publishedIn?.some((lender) => 'supplementOnSale' in lender));
  const otherSource = reused.filter((row) => kindOf.get(row.selectedIssueId) === 'owner-external-supplement');
  assert.equal(otherSource.length, 12);
  assert.ok(otherSource.every((row) => !derived.includes(row.selectedIssueId)));
  assert.equal(kindOf.get(130523), null);
  assert.ok(!derived.includes(130523));
});

test('a ledger lender that is not a readable tracked owner mapping fails rather than counting as non-database', async () => {
  const missing = 'scripts/data/owner-mappings/no-such-reviewed-mapping.json';
  const ledger = { sourceRows: [{ selectedIssueId: 1, identityEvidence: { publishedIn: [{ mapping: missing, supplementOnSale: '2025-01-01' }] } }] };
  await assert.rejects(gcdDerivedLedgerIssues(ledger), /not a tracked owner mapping/);
  // Even when listed as known, a mapping that is absent from disk is an error, not a clean lender.
  await assert.rejects(gcdDerivedLedgerIssues(ledger, new Set([missing])), /could not be read/);
  const outside = { sourceRows: [{ selectedIssueId: 1, identityEvidence: { publishedIn: [{ mapping: 'package.json', supplementOnSale: '2025-01-01' }] } }] };
  await assert.rejects(gcdDerivedLedgerIssues(outside), /not a tracked owner mapping/);
});

test('every tracked file holding Grand Comics Database issue details is named outside the MIT grant', async () => {
  const tracked = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\u0000').filter((file) => file.endsWith('.json'));
  assert.ok(tracked.length > 200, `only ${tracked.length} tracked JSON files were read, so this test proves nothing`);

  const licence = (await readFile(path.join(repoRoot, 'LICENSE'), 'utf8')).replace(/\s+/g, ' ');
  // Only a path LICENSE names as a token of its own counts, so naming one file in a folder does not
  // carve out its neighbours. A token ending in a slash names a whole folder.
  const named = new Set((licence.match(/[\w.-]+(?:\/[\w.-]+)+\/?/g) ?? []).map((token) => token.replace(/\.$/, '')));
  const carved = (file) => named.has(file) || [...named].some((token) => token.endsWith('/') && file.startsWith(token));
  const holders = [];
  const uncarved = [];
  const derivedHolders = [];
  for (const file of tracked) {
    const value = JSON.parse(await readFile(path.join(repoRoot, file), 'utf8'));
    const found = gcdMarkers(value);
    if ((await gcdDerivedLedgerIssues(value)).size > 0) {
      found.add('on-sale date taken from a database lender');
      derivedHolders.push(file);
    }
    if (found.size === 0) continue;
    holders.push(file);
    if (!carved(file)) uncarved.push(`${file}: ${[...found].sort().join(', ')}`);
  }
  assert.deepEqual(uncarved, [], 'Grand Comics Database data sits in a file LICENSE leaves under the MIT grant');
  // The owner route declares every file its reviewed lenders' database dates reach.
  assert.deepEqual(derivedHolders.filter((file) => !GCD_LICENSED_FILES.includes(file)), [],
    'A ledger holds dates taken from Grand Comics Database lenders but the owner route does not declare it');

  // The owner route's own list is held exactly in the other direction too: a listed file that holds
  // nothing means LICENSE carves out a file the data has left, so the list has gone stale.
  for (const file of GCD_LICENSED_FILES) {
    assert.ok(holders.includes(file), `${file} no longer holds Grand Comics Database data`);
    assert.ok(named.has(file), `LICENSE does not name ${file} outside the MIT grant`);
  }
  assert.ok(licence.includes('https://creativecommons.org/licenses/by-sa/4.0/'), 'LICENSE lost the CC BY-SA 4.0 link');
});
