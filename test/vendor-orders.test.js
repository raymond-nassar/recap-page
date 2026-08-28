import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { digestJson } from '../scripts/lib/chapter-orders.mjs';
import { writeOutputsAtomically } from '../scripts/vendor-orders.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function writeFixture(rootPath) {
  cpSync(path.join(root, 'scripts'), path.join(rootPath, 'scripts'), { recursive: true });
  cpSync(path.join(root, 'src', 'js'), path.join(rootPath, 'src', 'js'), { recursive: true });
  writeFileSync(path.join(rootPath, 'package.json'), '{"type":"module"}\n');
  const data = path.join(rootPath, 'src', 'data');
  const orders = path.join(data, 'orders');
  mkdirSync(orders, { recursive: true });
  writeFileSync(path.join(data, 'curated-lists.json'), JSON.stringify({
    lists: [{
      id: 'atomic-order',
      name: 'Atomic Order',
      description: 'A fixture reading order.',
      type: 'event',
      depth: 'complete',
      beginner: false,
      group: null,
      groupName: null,
      variant: null,
      sourceFile: 'atomic-order.md',
      sourcePage: 'https://example.test/atomic-order',
      sourceOrigin: 'Fixture source',
      sourceLicense: null,
      out: 'atomic_order.json',
      characters: [],
      keywords: [],
      expect: 1,
      timeline: 2026,
      coverIssueId: 2,
    }],
  }, null, 2));
  writeFileSync(path.join(orders, 'atomic-order.md'), '- [ ] [Atomic Order #1](https://www.marvel.com/comics/issue/1/atomic_order_1)\n');
  writeFileSync(path.join(data, 'atomic_order.json'), '{"sentinel":"existing payload"}\n');
  writeFileSync(path.join(data, 'catalog.json'), '{"sentinel":"existing catalog"}\n');
  const hook = path.join(rootPath, 'fetch-hook.mjs');
  writeFileSync(hook, `globalThis.fetch = async () => new Response(JSON.stringify({
    id: 1, title: 'Atomic Order #1', detailUrl: 'https://www.marvel.com/comics/issue/1/atomic_order_1',
    seriesId: 1, seriesName: 'Atomic Order', cover: { path: 'https://example.test/cover', extension: 'jpg' },
  }), { status: 200, headers: { 'content-type': 'application/json' } });\n`);
  return hook;
}

function writeMetadataCache(rootPath, records) {
  const cache = path.join(rootPath, 'metadata-cache');
  mkdirSync(cache, { recursive: true });
  for (const [id, body] of Object.entries(records)) {
    const url = `https://marvel.emreparker.com/v1/issues/${id}`;
    const urlSha256 = createHash('sha256').update(url, 'utf8').digest('hex');
    writeFileSync(path.join(cache, `${urlSha256}.json`), JSON.stringify({
      url,
      urlSha256,
      status: 200,
      fetchedAt: '2026-08-27T00:00:00.000Z',
      bodySha256: createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex'),
      body,
    }));
  }
  return cache;
}

function writeCatalogGapFixture(rootPath) {
  writeFixture(rootPath);
  setFixtureCoverIssue(rootPath, 1);
  const data = path.join(rootPath, 'src', 'data');
  writeFileSync(path.join(data, 'atomic_order.json'), `${JSON.stringify({
    id: 'atomic-order',
    name: 'Atomic Order',
    description: 'A fixture reading order.',
    source: 'https://example.test/atomic-order',
    sourceOrigin: 'Fixture source',
    sourceLicense: null,
    generatedAt: '2026-08-27T00:00:00.000Z',
    apiBase: 'https://example.test/v1',
    count: 3,
    collections: 0,
    placeholders: 1,
    unresolved: [],
    items: [
      {
        issueId: 1,
        title: 'Atomic Order #1',
        number: '1',
        url: 'https://www.marvel.com/comics/issue/1/atomic_order_1',
        seriesId: 1,
        seriesName: 'Atomic Order',
        onSale: '2026-01-01T00:00:00+0000',
        mu: null,
        digitalId: 101,
        cover: { path: 'https://example.test/cover', ext: 'jpg' },
        description: null,
        pageCount: 20,
        creators: [],
      },
      {
        issueId: 2,
        title: 'Atomic Order #2',
        number: '2',
        url: 'https://www.marvel.com/comics/issue/2/atomic_order_2',
        seriesId: null,
        seriesName: null,
        onSale: null,
        mu: null,
        digitalId: null,
        cover: null,
        description: null,
        pageCount: null,
        creators: [],
      },
      {
        issueId: -3,
        title: 'Atomic Order #3',
        number: '3',
        url: null,
        seriesId: null,
        seriesName: null,
        onSale: null,
        mu: null,
        digitalId: null,
        cover: null,
        description: null,
        pageCount: null,
        creators: [],
        placeholder: true,
      },
    ],
  }, null, 2)}\n`);
}

function cachedAtomicIssue(id = 1) {
  return {
    id,
    title: 'Atomic Order #1',
    issueNumber: '1',
    detailUrl: 'https://www.marvel.com/comics/issue/1/atomic_order_1',
    seriesId: 1,
    seriesName: 'Atomic Order',
    onSaleDate: '2026-01-01T00:00:00+0000',
    unlimitedDate: null,
    digitalId: 101,
    pageCount: 20,
    creators: [],
    cover: { path: 'http://example.test/cover', extension: 'jpg' },
  };
}

function setFixtureCoverIssue(rootPath, coverIssueId) {
  const manifest = path.join(rootPath, 'src', 'data', 'curated-lists.json');
  const data = JSON.parse(readFileSync(manifest, 'utf8'));
  data.lists[0].coverIssueId = coverIssueId;
  writeFileSync(manifest, `${JSON.stringify(data, null, 2)}\n`);
}

function writePartitionFixture(rootPath) {
  const hook = writeFixture(rootPath);
  const data = path.join(rootPath, 'src', 'data');
  const orders = path.join(data, 'orders');
  const scriptData = path.join(rootPath, 'scripts', 'data');
  const items = [1, 2, 3].map((issueId) => ({
    issueId,
    title: `Atomic Parent #${issueId}`,
    number: String(issueId),
    url: `https://www.marvel.com/comics/issue/${issueId}/atomic_parent_${issueId}`,
    seriesId: 10,
    seriesName: 'Atomic Parent (2000 - 2001)',
    onSale: issueId === 3 ? '2001-01-01T00:00:00+0000' : '2000-01-01T00:00:00+0000',
    mu: null,
    digitalId: 100 + issueId,
    cover: { path: `https://example.test/cover-${issueId}`, ext: 'jpg' },
    description: null,
    pageCount: 0,
    creators: [],
    collectedIn: 'Group',
  }));
  const chapters = [
    {
      id: 'atomic-parent-01',
      name: 'First part',
      sourceStart: 1,
      sourceCount: 1,
      ownerBulletCount: 1,
      issueCount: 2,
      timelineYear: 2000,
      issueIdsSha256: digestJson([1, 2]),
    },
    {
      id: 'atomic-parent-02',
      name: 'Second part',
      sourceStart: 2,
      sourceCount: 1,
      ownerBulletCount: 1,
      issueCount: 1,
      timelineYear: 2001,
      issueIdsSha256: digestJson([3]),
    },
  ];
  const descriptionEntries = chapters.map((chapter, index) => ({
    id: chapter.id,
    sourceHeading: index === 0 ? 'First part' : 'Second part',
    description: index === 0 ? 'The first fixture chapter.' : 'The second fixture chapter.',
  }));
  const ledger = {
    schemaVersion: 1,
    parentId: 'atomic-parent',
    ownerIssue: 'https://example.test/issues/1',
    ownerAttachmentSha256: '1'.repeat(64),
    sourcePositions: 2,
    sourceVectorSha256: digestJson(['First row', 'Second row']),
    sourceGroups: [{
      name: 'Group', sourceStart: 1, sourceCount: 2, issueCount: 3,
    }],
    chapterCount: 2,
    issueCount: 3,
    issueIdsSha256: digestJson([1, 2, 3]),
    ownerBulletCount: 2,
    chapterContractSha256: digestJson(chapters.map((chapter) => ({
      id: chapter.id,
      name: chapter.name,
      sourceStart: chapter.sourceStart,
      sourceCount: chapter.sourceCount,
      ownerBulletCount: chapter.ownerBulletCount,
      issueCount: chapter.issueCount,
      timelineYear: chapter.timelineYear,
      issueIdDigest: chapter.issueIdsSha256,
    }))),
    chapterNamesSha256: digestJson(chapters.map((chapter) => chapter.name)),
    overlapFile: 'atomic-parent-overlaps.json',
    path: {
      id: 'atomic-parent',
      name: 'Atomic Parent',
      description: 'The two parts in source order.',
      sourceOrigin: 'Fixture',
      stepsSha256: digestJson(chapters.map((chapter) => chapter.id)),
    },
    corrections: [],
    chapters,
    descriptionCopy: {
      ownerAttachmentSha256: '2'.repeat(64),
      entriesSha256: digestJson(descriptionEntries),
      entries: descriptionEntries,
    },
  };
  const parent = {
    id: 'atomic-parent',
    name: 'Atomic Parent',
    description: 'A partition parent fixture.',
    source: null,
    sourceOrigin: 'Fixture source',
    sourceLicense: null,
    generatedAt: '2026-01-01T00:00:00.000Z',
    apiBase: 'https://example.test/v1',
    count: 3,
    collections: 1,
    placeholders: 0,
    unresolved: [],
    items,
  };
  const peer = {
    ...parent,
    id: 'peer',
    name: 'Peer',
    description: 'A peer fixture.',
    count: 1,
    collections: 0,
    items: [{ ...items[0], collectedIn: undefined }],
  };
  const manifest = {
    lists: [
      {
        id: 'atomic-parent',
        name: 'Atomic Parent',
        description: 'A partition parent fixture.',
        type: 'event',
        depth: 'complete',
        beginner: false,
        group: null,
        groupName: null,
        variant: null,
        sourceFile: 'atomic-parent.md',
        partitionFile: 'atomic-parent-parts.json',
        catalog: false,
        sourceOrigin: 'Fixture source',
        sourceLicense: null,
        out: 'atomic_parent.json',
        characters: ['Atomic Parent'],
        keywords: [],
        expect: 3,
        timeline: 2000,
        coverIssueId: 1,
      },
      {
        id: 'peer',
        name: 'Peer',
        description: 'A peer fixture.',
        type: 'event',
        depth: 'complete',
        beginner: false,
        group: null,
        groupName: null,
        variant: null,
        sourceFile: 'peer.md',
        sourceOrigin: 'Fixture source',
        sourceLicense: null,
        out: 'peer.json',
        characters: ['Peer'],
        keywords: [],
        expect: 1,
        timeline: 2000,
        coverIssueId: 1,
      },
    ],
  };
  writeFileSync(path.join(data, 'curated-lists.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(orders, 'atomic-parent.md'), [
    '## Group',
    '> First row',
    '- [ ] [Atomic Parent #1](https://www.marvel.com/comics/issue/1/atomic_parent_1)',
    '- [ ] [Atomic Parent #2](https://www.marvel.com/comics/issue/2/atomic_parent_2)',
    '> Second row',
    '- [ ] [Atomic Parent #3](https://www.marvel.com/comics/issue/3/atomic_parent_3)',
  ].join('\n'));
  writeFileSync(path.join(orders, 'peer.md'), '- [ ] [Atomic Parent #1](https://www.marvel.com/comics/issue/1/atomic_parent_1)\n');
  writeFileSync(path.join(data, 'atomic_parent.json'), `${JSON.stringify(parent, null, 2)}\n`);
  writeFileSync(path.join(data, 'peer.json'), `${JSON.stringify(peer, null, 2)}\n`);
  writeFileSync(path.join(data, 'atomic_parent_01.json'), '{"sentinel":"existing child"}\n');
  writeFileSync(path.join(data, 'atomic_parent_02.json'), '{"sentinel":"existing child"}\n');
  writeFileSync(path.join(scriptData, 'atomic-parent-parts.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  writeFileSync(path.join(scriptData, 'atomic-parent-overlaps.json'), '{"sentinel":"existing overlap"}\n');

  writeFileSync(hook, `globalThis.fetch = async (url) => {
    const id = Number(String(url).match(/issues\\/(\\d+)/)?.[1]);
    return new Response(JSON.stringify({
      id,
      title: 'Atomic Parent #' + id,
      detailUrl: 'https://www.marvel.com/comics/issue/' + id + '/atomic_parent_' + id,
      seriesId: 10,
      seriesName: 'Atomic Parent (2000 - 2001)',
      onSaleDate: id === 3 ? '2001-01-01T00:00:00+0000' : '2000-01-01T00:00:00+0000',
      digitalId: 100 + id,
      cover: { path: 'https://example.test/cover-' + id, extension: 'jpg' },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };\n`);
  return { hook, ledger };
}

test('an invalid configured cover leaves both final vendor outputs unchanged', (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'mrt-vendor-atomic-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const hook = writeFixture(fixture);
  const output = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, 'scripts/vendor-orders.mjs', '--only=atomic-order'], {
    cwd: fixture,
    encoding: 'utf8',
  });

  assert.notEqual(output.status, 0);
  assert.match(output.stderr, /coverIssueId 2 is not an issue in this order/);
  assert.equal(readFileSync(path.join(fixture, 'src', 'data', 'atomic_order.json'), 'utf8'), '{"sentinel":"existing payload"}\n');
  assert.equal(readFileSync(path.join(fixture, 'src', 'data', 'catalog.json'), 'utf8'), '{"sentinel":"existing catalog"}\n');
});

test('cache-only metadata vendoring makes zero fetches and writes hydrated output', (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'mrt-vendor-cache-only-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  writeFixture(fixture);
  setFixtureCoverIssue(fixture, 1);
  const cache = writeMetadataCache(fixture, { 1: cachedAtomicIssue() });
  const fetchCount = path.join(fixture, 'fetch-count.txt');
  writeFileSync(fetchCount, '0');
  const hook = path.join(fixture, 'zero-fetch-hook.mjs');
  writeFileSync(hook, `import { writeFileSync } from 'node:fs';
globalThis.fetch = async () => {
  writeFileSync(process.env.MRT_FETCH_COUNT, '1');
  throw new Error('cache-only mode must not fetch');
};
`);

  const output = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(hook).href, 'scripts/vendor-orders.mjs', '--only=atomic-order', `--metadata-cache=${cache}`],
    {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, MRT_FETCH_COUNT: fetchCount },
    },
  );

  assert.equal(output.status, 0, output.stderr);
  assert.equal(readFileSync(fetchCount, 'utf8'), '0');
  const payload = JSON.parse(readFileSync(path.join(fixture, 'src', 'data', 'atomic_order.json'), 'utf8'));
  assert.equal(payload.items[0].issueId, 1);
  assert.equal(payload.items[0].digitalId, 101);
});

test('invalid cache-only metadata leaves final vendor outputs unchanged', (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'mrt-vendor-cache-atomic-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  writeFixture(fixture);
  const cache = writeMetadataCache(fixture, { 1: cachedAtomicIssue(2) });

  const output = spawnSync(
    process.execPath,
    ['scripts/vendor-orders.mjs', '--only=atomic-order', `--metadata-cache=${cache}`],
    { cwd: fixture, encoding: 'utf8' },
  );

  assert.notEqual(output.status, 0);
  assert.match(output.stderr, /does not identify that exact issue/);
  assert.equal(readFileSync(path.join(fixture, 'src', 'data', 'atomic_order.json'), 'utf8'), '{"sentinel":"existing payload"}\n');
  assert.equal(readFileSync(path.join(fixture, 'src', 'data', 'catalog.json'), 'utf8'), '{"sentinel":"existing catalog"}\n');
});

test('a later vendor commit rename restores every final output', async (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'mrt-vendor-commit-recovery-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const sentinels = new Map([
    ['first.json', Buffer.from([0, 1, 2, 3])],
    ['second.json', Buffer.from([4, 5, 6, 7])],
    ['third.json', Buffer.from([8, 9, 10, 11])],
  ]);
  for (const [name, content] of sentinels) writeFileSync(path.join(fixture, name), content);

  let commitRenames = 0;
  await assert.rejects(
    writeOutputsAtomically(
      [...sentinels.keys()].map((name) => ({
        path: path.join(fixture, name),
        content: `replacement for ${name}`,
      })),
      {
        replaceFile: async (source, destination) => {
          commitRenames += 1;
          if (commitRenames === 3) throw new Error('forced later commit-phase rename failure');
          renameSync(source, destination);
        },
      },
    ),
    /forced later commit-phase rename failure/,
  );

  assert.equal(commitRenames, 3);
  for (const [name, content] of sentinels) {
    assert.deepEqual(readFileSync(path.join(fixture, name)), content);
  }
  assert.deepEqual(
    readdirSync(fixture).filter((name) => /\.(?:tmp|backup)-/.test(name)),
    [],
  );
});

test('catalog-only expands a noncatalog parent into ordinary children, a path, and overlaps', (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'mrt-vendor-partition-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  writePartitionFixture(fixture);
  const output = spawnSync(process.execPath, ['scripts/vendor-orders.mjs', '--catalog-only'], {
    cwd: fixture,
    encoding: 'utf8',
  });

  assert.equal(output.status, 0, output.stderr);

  const data = path.join(fixture, 'src', 'data');
  const catalog = JSON.parse(readFileSync(path.join(data, 'catalog.json'), 'utf8'));
  assert.deepEqual(catalog.lists.map((entry) => entry.id), ['atomic-parent-01', 'atomic-parent-02', 'peer']);
  assert.equal(catalog.lists.some((entry) => entry.id === 'atomic-parent'), false);
  assert.deepEqual(catalog.paths.map((entry) => entry.steps), [['atomic-parent-01', 'atomic-parent-02']]);
  const first = JSON.parse(readFileSync(path.join(data, 'atomic_parent_01.json'), 'utf8'));
  assert.equal(first.collections, 0);
  assert.equal(first.description, 'The first fixture chapter.');
  assert.deepEqual(first.items.map((item) => item.issueId), [1, 2]);
  assert.ok(first.items.every((item) => !Object.hasOwn(item, 'collectedIn')));
  const overlap = JSON.parse(readFileSync(
    path.join(fixture, 'scripts', 'data', 'atomic-parent-overlaps.json'),
    'utf8',
  ));
  assert.deepEqual(
    [overlap.pairCount, overlap.chapterCountWithOverlap, overlap.existingListCount],
    [1, 1, 1],
  );
});

test('catalog-only carries both gap counts and is byte-stable on a second run', (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'mrt-vendor-catalog-gaps-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  writeCatalogGapFixture(fixture);

  const first = spawnSync(process.execPath, ['scripts/vendor-orders.mjs', '--catalog-only'], {
    cwd: fixture,
    encoding: 'utf8',
  });
  assert.equal(first.status, 0, first.stderr);
  const firstBytes = readFileSync(path.join(fixture, 'src', 'data', 'catalog.json'), 'utf8');
  const catalog = JSON.parse(firstBytes);
  assert.equal(catalog.generatedAt, '2026-08-27T00:00:00.000Z');
  assert.deepEqual(
    {
      placeholderCount: catalog.lists[0].placeholderCount,
      emptyRecordCount: catalog.lists[0].emptyRecordCount,
    },
    { placeholderCount: 1, emptyRecordCount: 1 },
  );

  const second = spawnSync(process.execPath, ['scripts/vendor-orders.mjs', '--catalog-only'], {
    cwd: fixture,
    encoding: 'utf8',
  });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(
    readFileSync(path.join(fixture, 'src', 'data', 'catalog.json'), 'utf8'),
    firstBytes,
  );
});

test('a generated child id is a valid --only target for its complete family', (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'mrt-vendor-partition-only-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const { hook } = writePartitionFixture(fixture);
  const output = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(hook).href, 'scripts/vendor-orders.mjs', '--only=atomic-parent-02'],
    { cwd: fixture, encoding: 'utf8' },
  );
  assert.equal(output.status, 0, output.stderr);
  assert.match(output.stdout, /Vendoring 1 of 2 source orders/);
  for (const ordinal of ['01', '02']) {
    const child = JSON.parse(readFileSync(
      path.join(fixture, 'src', 'data', `atomic_parent_${ordinal}.json`),
      'utf8',
    ));
    assert.equal(child.id, `atomic-parent-${ordinal}`);
  }
});

test('an invalid partition leaves every generated output unchanged', (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'mrt-vendor-partition-atomic-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const { ledger } = writePartitionFixture(fixture);
  ledger.chapters[1].sourceStart += 1;
  writeFileSync(
    path.join(fixture, 'scripts', 'data', 'atomic-parent-parts.json'),
    `${JSON.stringify(ledger, null, 2)}\n`,
  );
  const output = spawnSync(process.execPath, ['scripts/vendor-orders.mjs', '--catalog-only'], {
    cwd: fixture,
    encoding: 'utf8',
  });
  assert.notEqual(output.status, 0);
  assert.match(output.stderr, /does not continue the source-position vector/);
  for (const file of ['atomic_parent_01.json', 'atomic_parent_02.json']) {
    assert.equal(
      readFileSync(path.join(fixture, 'src', 'data', file), 'utf8'),
      '{"sentinel":"existing child"}\n',
    );
  }
  assert.equal(
    readFileSync(path.join(fixture, 'scripts', 'data', 'atomic-parent-overlaps.json'), 'utf8'),
    '{"sentinel":"existing overlap"}\n',
  );
  assert.equal(
    readFileSync(path.join(fixture, 'src', 'data', 'catalog.json'), 'utf8'),
    '{"sentinel":"existing catalog"}\n',
  );
});
