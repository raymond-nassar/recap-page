import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, digestCanonicalJson, validateFrozenPacket, validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseCatalog, searchCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'doctor-octopus-otto-octavius-reading-order';
const sourceUrl = 'https://www.comicbookherald.com/doctor-octopus-otto-octavius-reading-order/';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => String(first + index));
const rowsFor = (seriesId) => mapping.rows.filter((row) => row.seriesId === seriesId);
const numbersFor = (seriesId) => rowsFor(seriesId).map((row) => row.issueNumber);
const hashText = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

test('Doctor Octopus conserves the factual blocks, full source vector and backward repeats', () => {
  const factualHash = 'a30255af7ebf4ff3229430dc10adbd7584782e421198bb4ac66e695a3b21f26f';
  assert.equal(ledger.blocks.length, 62);
  assert.equal(digestCanonicalJson(ledger.blocks.map(({ kind, reference, runs, section }) => (
    { kind, reference, runs, section }
  ))), factualHash);
  assert.equal(ledger.sourceIssueBearingBlocksSha256, factualHash);
  assert.equal(packet.sourceIssueBearingBlocksSha256, factualHash);
  assert.equal(packet.sourceOccurrenceCount, 499);
  assert.equal(packet.rows.length, 482);
  assert.equal(packet.sourceGaps.length, 10);
  assert.equal(packet.repeatedSourceReferences.length, 7);
  const all = [...packet.rows, ...packet.sourceGaps, ...packet.repeatedSourceReferences];
  assert.deepEqual(all.map((row) => row.sourcePosition).sort((a, b) => a - b),
    Array.from({ length: 499 }, (_, index) => index + 1));
  assert.equal(ledger.blocks.reduce((sum, block) => sum + block.selectedOccurrenceCount, 0), 499);
  assert.deepEqual(ledger.occurrences.map((row) => row.sourcePosition),
    Array.from({ length: 499 }, (_, index) => index + 1));
  assert.equal(digestCanonicalJson(ledger.occurrences.map((row) => (
    [row.sourceBlock, row.seriesId, row.issueNumber]
  ))), 'a634f9dc6a5ea98dce35d77e9aa34bf759e2e5617769ec429c22b15496e29842');
  assert.deepEqual(mapping.rows.map((row) => [row.sourcePosition, row.selectedIssueId]),
    ledger.occurrences.filter((row) => row.disposition === 'exact')
      .map((row) => [row.sourcePosition, row.issueId]));
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), ledger.canonicalIssueIdVector);
  for (const row of mapping.rows) {
    const occurrence = ledger.occurrences[row.sourcePosition - 1];
    assert.deepEqual([row.seriesId, row.issueNumber], [occurrence.seriesId, occurrence.issueNumber]);
  }
  for (const repeat of packet.repeatedSourceReferences) {
    const canonical = packet.rows[repeat.canonicalRow - 1];
    assert.ok(canonical.sourcePosition < repeat.sourcePosition);
    assert.deepEqual([repeat.normalizedSeriesTitle, repeat.seriesYear, repeat.issueNumber],
      [canonical.normalizedSeriesTitle, canonical.seriesYear, canonical.issueNumber]);
  }
  assert.equal(mapping.rows[0].selectedIssueId, 16926);
  assert.equal(mapping.rows.at(-1).selectedIssueId, 89519);
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
});

test('Doctor Octopus selects only the source arcs across Amazing Spider-Man relaunches', async () => {
  assert.deepEqual(numbersFor(1987), [
    ...range(1, 38), ...range(51, 61), ...range(88, 99), ...range(110, 131),
    ...range(143, 168), ...range(193, 202), ...range(295, 310), ...range(334, 339),
    ...range(395, 399), ...range(425, 428),
  ]);
  assert.ok(rowsFor(1987).every((row) => row.seriesYear === 1963));
  assert.deepEqual(numbersFor(454), [
    ...range(30, 45), '600', ...range(642, 647), ...range(658, 662), '676',
    ...range(678, 687), ...range(698, 700),
  ]);
  assert.ok(rowsFor(454).every((row) => row.seriesYear === 1999));
  assert.deepEqual(numbersFor(17285), range(7, 15));
  assert.ok(rowsFor(17285).every((row) => row.seriesYear === 2014));
  assert.deepEqual(numbersFor(20432), [...range(1, 32), ...range(789, 791), '800']);
  assert.ok(rowsFor(20432).every((row) => row.seriesYear === 2017));
  assert.equal(ledger.occurrences.filter((row) => row.seriesId === 20432 && row.issueNumber === '19').length, 2);
  const worldwide = rowsFor(20432).find((row) => row.issueNumber === '1');
  const payload = await readJson(`src/data/${packet.proposedManifest.out}`);
  assert.match(payload.items.find((row) => row.issueId === worldwide.selectedIssueId).onSale, /^2015-10-07/);
  assert.deepEqual(rowsFor(24396).map((row) => [row.seriesYear, row.issueNumber, row.selectedIssueId]),
    [[2018, '64', 89519]]);
});

test('Doctor Octopus keeps Superior volumes, decimal numbering and original special identities distinct', () => {
  assert.deepEqual(numbersFor(17554), range(1, 33));
  assert.ok(rowsFor(17554).every((row) => row.seriesYear === 2013));
  assert.deepEqual(numbersFor(26005), range(1, 12));
  assert.ok(rowsFor(26005).every((row) => row.seriesYear === 2018));
  assert.deepEqual(numbersFor(14246), ['8', '15.1', ...range(16, 22)]);
  const decimal = mapping.rows.findIndex((row) => row.seriesId === 14246 && row.issueNumber === '15.1');
  assert.deepEqual(mapping.rows.slice(decimal, decimal + 5).map((row) => [row.seriesId, row.issueNumber]),
    ['15.1', ...range(16, 19)].map((number) => [14246, number]));
  for (const [seriesId, year, issueId] of [
    [9805, 2010, 30249], [18485, 2013, 49157], [18487, 2013, 49168],
    [17714, 2013, 47041], [18008, 2013, 47715],
  ]) {
    assert.deepEqual(rowsFor(seriesId).map((row) => [row.seriesYear, row.issueNumber, row.selectedIssueId]),
      [[year, '1', issueId]]);
  }
  for (const seriesId of [18485, 18487]) {
    assert.match(rowsFor(seriesId)[0].normalizedSeriesTitle, /CAMPBELL INTERLOCKING VARIANT/);
    assert.match(rowsFor(seriesId)[0].resolvedIssueTitle, /CAMPBELL INTERLOCKING VARIANT \(2013\) #1/);
  }
  assert.deepEqual(numbersFor(20499), range(14, 17));
  assert.ok(rowsFor(20499).every((row) => row.seriesYear === 2015));
  assert.deepEqual(numbersFor(22535), range(1, 5));
  assert.deepEqual(numbersFor(26001), range(0, 4));
});

test('Doctor Octopus keeps all unresolved source positions and excludes unnumbered recommendations', () => {
  assert.deepEqual(packet.sourceGaps.map((row) => row.sourcePosition),
    [163, 190, 191, 192, 210, 211, 225, 228, 229, 230]);
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  assert.equal(ledger.scopeIssue, 'https://github.com/raymond-nassar/recap-page/issues/531');
  assert.equal(ledger.gapIssue, 'https://github.com/raymond-nassar/recap-page/issues/532');
  for (const gap of packet.sourceGaps) {
    assert.equal(gap.kind, 'published-metadata-gap');
    assert.equal(gap.status, 'open');
    assert.ok(gap.evidenceSources.some((source) => source.kind === 'tracking-issue' && source.url === ledger.gapIssue));
  }
  assert.deepEqual(ledger.excludedSourceReferences, packet.excludedSourceReferences);
  const excluded = packet.excludedSourceReferences.join('\n');
  for (const title of [
    'Marvel Super Heroes Secret Wars', 'Infinity War', 'Lethal Foes of Spider-Man',
    'Infinity', 'Inhumanity', 'Secret Empire', 'War of the Realms', 'Sinister War',
  ]) assert.ok(excluded.includes(title));
  assert.match(excluded, /unnumbered/);
  assert.match(excluded, /No inferred miniseries range/);
  assert.ok(!mapping.rows.some((row) => /^(Marvel Super Heroes Secret Wars|Infinity War|Lethal Foes of Spider-Man|Infinity|Inhumanity|Secret Empire|War of the Realms|Sinister War)$/.test(row.normalizedSeriesTitle)));
});

test('Doctor Octopus relationship approval regenerates against every current source-manifest order', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const current = await buildReportForMapping(`scripts/data/cbh-mappings/${id}.json`, [], { excludedOrderIds: [] });
  const expectedOrderIds = manifest.lists.filter((row) => row.id !== id).map((row) => row.id);
  assert.deepEqual(current, report);
  assert.equal(report.comparisonCount, 184);
  assert.deepEqual(report.comparisons.reduce((counts, row) => {
    counts[row.relationship] = (counts[row.relationship] ?? 0) + 1;
    return counts;
  }, {}), { partial: 27, 'existing-subset': 2, none: 155 });
  assert.deepEqual(new Set(report.comparisons.map((row) => row.orderId)), new Set(expectedOrderIds));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: current.libraryDigest, expectedOrderIds,
  }));
});

test('Doctor Octopus publishes the complete canonical vector with placeholders, credit and character aliases', async () => {
  const payload = await readJson(`src/data/${packet.proposedManifest.out}`);
  const markdown = await readFile(`src/data/orders/${id}.md`, 'utf8');
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 482);
  assert.equal(parsed.unresolved.length, 10);
  assert.equal(payload.items.length, 492);
  assert.equal(payload.items.filter((row) => row.placeholder).length, 10);
  const exactItems = payload.items.filter((row) => !row.placeholder);
  assert.equal(exactItems.filter((row) => row.digitalId == null).length, 2);
  assert.equal(exactItems.filter((row) => row.cover == null).length, 2);
  assert.equal(new Set(payload.items.map((row) => row.issueId)).size, 492);
  assert.deepEqual(payload.items.filter((row) => !row.placeholder).map((row) => row.issueId),
    ledger.canonicalIssueIdVector);
  const expected = [...mapping.rows, ...mapping.sourceGaps].sort((a, b) => a.sourcePosition - b.sourcePosition);
  expected.forEach((row, index) => {
    const item = payload.items[index];
    if (row.selectedIssueId) {
      assert.deepEqual([item.issueId, item.seriesId, item.number], [row.selectedIssueId, row.seriesId, row.issueNumber]);
      assert.equal(item.title, row.resolvedIssueTitle);
    } else {
      assert.ok(item.issueId < 0);
      assert.equal(item.placeholder, true);
      assert.equal(item.title, row.sourceIssueReference);
      assert.equal(item.digitalId, null);
    }
  });
  assert.ok(payload.items.every((row) => row.description == null && row.title && !/undefined|null/i.test(row.title)));
  const manifest = await readJson('src/data/curated-lists.json');
  const entry = manifest.lists.find((row) => row.id === id);
  const catalog = parseCatalog(await readJson('src/data/catalog.json'));
  const card = catalog.lists.find((row) => row.id === id);
  assert.equal(entry.sourcePage, sourceUrl);
  assert.equal(card.source, sourceUrl);
  assert.equal(packet.sourceUrl, sourceUrl);
  assert.equal(ledger.sourceUrl, sourceUrl);
  for (const value of [entry, card]) {
    assert.equal(value.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
    assert.equal(value.sourceLicense, null);
    assert.equal(value.depth, 'partial');
    assert.equal(value.spotlightKind, 'other');
  }
  for (const alias of ['Doctor Octopus', 'Otto Octavius', 'Doc Ock', 'Superior Spider-Man', 'Superior Octopus']) {
    assert.ok(searchCatalog(catalog.lists, alias).some((row) => row.id === id));
  }
});

test('Doctor Octopus hydration preserves required identities and optional metadata with portable pinned hashes', async () => {
  const payload = await readJson(`src/data/${packet.proposedManifest.out}`);
  const byId = new Map(payload.items.map((row) => [row.issueId, row]));
  const records = ledger.metadataHydration.records;
  assert.equal(records.length, 482);
  assert.equal(new Set(records.map((row) => row.issueId)).size, 482);
  assert.deepEqual(new Set(records.map((row) => row.issueId)), new Set(ledger.canonicalIssueIdVector));
  const provider = records.filter((row) => row.kind === 'provider-response');
  const reused = records.filter((row) => row.kind === 'reconstructed-from-pinned-payload');
  assert.equal(provider.length, 52);
  assert.equal(reused.length, 430);
  const files = [...new Set(reused.map((row) => row.file))];
  const sources = new Map(await Promise.all(files.map(async (file) => {
    const text = await readFile(file, 'utf8');
    const lf = text.replace(/\r\n/g, '\n');
    assert.equal(hashText(lf), hashText(lf.replace(/\n/g, '\r\n')));
    return [file, { hash: hashText(text), data: JSON.parse(text) }];
  })));
  for (const record of reused) {
    const source = sources.get(record.file);
    assert.equal(source.hash, record.fileSha256);
    assert.match(record.observedFileSha256, /^[a-f0-9]{64}$/);
    assert.match(record.hashNormalization, /CRLF normalized to LF/);
    for (const adaptation of [
      'issueId -> id', 'number -> issueNumber', 'url -> detailUrl',
      'onSale -> onSaleDate', 'mu -> unlimitedDate', 'cover.ext -> cover.extension',
    ]) assert.ok(record.adaptation.includes(adaptation));
    const original = source.data.items.find((row) => row.issueId === record.issueId);
    assert.ok(original);
    const actual = byId.get(record.issueId);
    for (const field of ['issueId', 'title', 'number', 'url', 'seriesId', 'seriesName']) {
      assert.notEqual(original[field], undefined, `${record.issueId}: missing source ${field}`);
      assert.notEqual(original[field], null, `${record.issueId}: null source ${field}`);
      assert.deepEqual(actual[field], original[field], `${record.issueId}: ${field}`);
    }
    for (const field of ['onSale', 'mu', 'digitalId', 'cover', 'pageCount']) {
      assert.deepEqual(actual[field], original[field] ?? null, `${record.issueId}: ${field}`);
    }
    assert.deepEqual(actual.creators, original.creators ?? []);
  }
  for (const record of provider) {
    assert.equal(record.status, 200);
    assert.equal(record.url, `https://marvel.emreparker.com/v1/issues/${record.issueId}`);
    assert.equal(createHash('sha256').update(JSON.stringify(record.body)).digest('hex'), record.bodySha256);
    const body = record.body;
    const actual = byId.get(record.issueId);
    for (const [target, source] of [
      ['issueId', 'id'], ['title', 'title'], ['number', 'issueNumber'], ['url', 'detailUrl'],
      ['seriesId', 'seriesId'], ['seriesName', 'seriesName'],
    ]) {
      assert.notEqual(body[source], undefined, `${record.issueId}: missing response ${source}`);
      assert.notEqual(body[source], null, `${record.issueId}: null response ${source}`);
      assert.equal(actual[target], body[source]);
    }
    for (const [target, source] of [
      ['onSale', 'onSaleDate'], ['mu', 'unlimitedDate'], ['digitalId', 'digitalId'], ['pageCount', 'pageCount'],
    ]) assert.deepEqual(actual[target], body[source] ?? null, `${record.issueId}: ${target}`);
    assert.deepEqual(actual.cover, body.cover ? {
      path: body.cover.path.replace(/^http:/, 'https:'), ext: body.cover.extension,
    } : null);
    assert.deepEqual(actual.creators, (body.creators ?? [])
      .filter((row) => /writer|penciler|artist/i.test(row.role ?? ''))
      .map(({ name, role }) => ({ name, role })));
  }
  assert.match(ledger.fileHashEncoding, /CRLF normalized to LF/);
  const pending = [ledger];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (value.file && value.fileSha256) {
      if (!sources.has(value.file)) {
        const text = await readFile(value.file, 'utf8');
        const hash = hashText(text);
        assert.equal(hash, hashText(text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')));
        sources.set(value.file, { hash });
      }
      assert.equal(sources.get(value.file).hash, value.fileSha256);
      assert.match(value.observedFileSha256, /^[a-f0-9]{64}$/);
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
  }
});

test('Doctor Octopus JSON evidence excludes synopsis prose recursively, including nested candidates', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const payload = await readJson(`src/data/${packet.proposedManifest.out}`);
  assert.equal(payload.description, packet.proposedManifest.description);
  const editorial = new Set([packet.proposedManifest, mapping.proposedManifest, mapping.approvedManifest, payload]);
  const pending = [packet, mapping, ledger, report, payload];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'synopsis' || (key === 'description' && !editorial.has(value))) {
        assert.ok(child == null || child === '');
      }
      if (child && typeof child === 'object') pending.push(child);
    }
  }
});
