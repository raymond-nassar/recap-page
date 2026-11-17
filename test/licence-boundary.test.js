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
  for (const file of tracked) {
    const found = gcdMarkers(JSON.parse(await readFile(path.join(repoRoot, file), 'utf8')));
    if (found.size === 0) continue;
    holders.push(file);
    if (!carved(file)) uncarved.push(`${file}: ${[...found].sort().join(', ')}`);
  }
  assert.deepEqual(uncarved, [], 'Grand Comics Database data sits in a file LICENSE leaves under the MIT grant');

  // The owner route's own list is held exactly in the other direction too: a listed file that holds
  // nothing means LICENSE carves out a file the data has left, so the list has gone stale.
  for (const file of GCD_LICENSED_FILES) {
    assert.ok(holders.includes(file), `${file} no longer holds Grand Comics Database data`);
    assert.ok(named.has(file), `LICENSE does not name ${file} outside the MIT grant`);
  }
  assert.ok(licence.includes('https://creativecommons.org/licenses/by-sa/4.0/'), 'LICENSE lost the CC BY-SA 4.0 link');
});
