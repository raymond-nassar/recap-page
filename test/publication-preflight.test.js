import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  ALLOWED, preflightPublication, requireCleanPreflight,
} from '../scripts/check-publication.mjs';
import { authorPacket } from '../scripts/author-cbh-packet.mjs';
import { approveCbroMappings, authorCbroPacket, CBRO_AUTHOR_IDS } from '../scripts/author-cbro-packet.mjs';

const digest = (body) => createHash('sha256').update(body).digest('hex');
const declaration = (file, dependencies = []) => ({ path: file, dependencies });

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'publication-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'public'));
  return root;
}

test('preflight rejects a safe untracked source with an unsafe public draft dependency', async (t) => {
  const root = await fixture(t);
  const privateValue = 'C:' + '\\Users\\synthetic-reader\\cache';
  const draft = JSON.stringify({ cachePath: privateValue });
  await writeFile(path.join(root, 'public', 'draft.json'), draft);
  await writeFile(path.join(root, 'public', 'source.json'), JSON.stringify({
    preservedResearch: { artifacts: [{ path: 'public/draft.json', sha256: digest(draft), bytes: draft.length }] },
  }));
  const incomplete = await preflightPublication({ root, files: [declaration('public/source.json')] });
  assert.equal(incomplete.code, 2, 'a dependency omitted from the manifest is unanswered, not clean');
  const result = await preflightPublication({
    root, files: [declaration('public/source.json', ['public/draft.json']), declaration('public/draft.json')],
  });
  assert.equal(result.code, 1);
  assert.equal(result.status, 'findings');
  assert.ok(result.findings.some((entry) => entry.kind.includes('user profile')));
  assert.throws(() => requireCleanPreflight(result), /no approval or output/);
  assert.ok(!JSON.stringify(result).includes('synthetic-reader'));
  assert.ok(!JSON.stringify(result).includes(privateValue));
  assert.ok(!JSON.stringify(result).includes(root));
});

test('self-contained facts retain a private original receipt without opening or renaming its hash', async (t) => {
  const root = await fixture(t);
  const original = Buffer.from('Private original bytes that are not a public dependency.\r\n');
  const source = JSON.stringify({
    rows: [{ sourcePosition: 1, originalIssueId: 101 }],
    preservedResearch: {
      publicArtifactReadRequired: false, publicSourceSelfContained: true,
      artifacts: [{ name: 'private-original.json', sha256: digest(original), bytes: original.length }],
    },
  });
  const files = [declaration('public/source.json')];
  await writeFile(path.join(root, 'public', 'source.json'), source);
  const result = requireCleanPreflight(await preflightPublication({ root, files }));
  assert.equal(result.inputs[0].sha256, digest(source));
  assert.notEqual(result.inputs[0].sha256, digest(original));
  assert.equal(result.inputs[0].bytes, Buffer.byteLength(source));
  assert.equal((await preflightPublication({ root, files, expected: result })).code, 0);
  await writeFile(path.join(root, 'public', 'source.json'), source + '\n');
  assert.equal((await preflightPublication({ root, files, expected: result })).code, 2);
});

test('preflight binds names, dependency edges and exact CRLF bytes, not normalized text', async (t) => {
  const root = await fixture(t);
  const files = [declaration('public/a.txt', ['public/b.txt']), declaration('public/b.txt')];
  const proposed = new Map([['public/a.txt', 'one\r\n'], ['public/b.txt', 'two\n']]);
  const first = requireCleanPreflight(await preflightPublication({ root, files, proposed }));
  assert.equal(first.inputs[0].bytes, 5);
  const variants = [
    { files, proposed: new Map([['public/a.txt', 'one\n'], ['public/b.txt', 'two\n']]) },
    { files: [declaration('public/a.txt'), declaration('public/b.txt')], proposed },
    { files: [declaration('public/c.txt'), declaration('public/b.txt')],
      proposed: new Map([['public/c.txt', 'one\r\n'], ['public/b.txt', 'two\n']]) },
  ];
  for (const variant of variants) {
    assert.equal((await preflightPublication({ root, ...variant, expected: first })).code, 2);
  }
  assert.equal((await preflightPublication({
    root, files: [...files].reverse(), proposed, expected: first,
  })).code, 0, 'ordering declarations does not change their meaning');
});

test('incomplete, unreadable, aliased, outside and unsupported input never reports clean', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'public', 'binary.txt'), Buffer.from([1, 0, 2]));
  await writeFile(path.join(root, 'public', 'invalid.txt'), Buffer.from([0xff]));
  const cases = [
    [],
    [{ path: 'public/missing.txt' }],
    [declaration('public/missing.txt')],
    [declaration('../outside.txt')],
    [declaration(path.join(root, 'public', 'binary.txt'))],
    [declaration('public/../outside.txt')],
    [declaration('public/a.txt'), declaration('public/A.txt')],
    [declaration('public/a.txt', ['public/undeclared.txt'])],
    [declaration('public/binary.txt')],
    [declaration('public/invalid.txt')],
    [declaration('.git/config')],
  ];
  for (const files of cases) {
    const result = await preflightPublication({ root, files });
    assert.equal(result.code, 2);
    assert.equal(Object.hasOwn(result, 'digest'), false);
    assert.ok(!JSON.stringify(result).includes(root));
  }
});

test('protected roots, symlinks and malformed provenance cannot enter the proposed population', async (t) => {
  const root = await fixture(t);
  const protectedResult = await preflightPublication({
    root, files: [declaration('.copilot-tracking/new.txt')],
    proposed: new Map([['.copilot-tracking/new.txt', 'safe words']]),
  });
  assert.equal(protectedResult.code, 1);
  const outside = await mkdtemp(path.join(tmpdir(), 'publication-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'receipt.json'), '{"safe":true}');
  await symlink(outside, path.join(root, 'public', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await preflightPublication({
    root, files: [declaration('public/linked/receipt.json')],
  })).code, 2);
  for (const body of ['{', '{"publicDependencies":"public/source.json"}',
    '{"artifacts":[{"path":"../private.json","bytes":1}]}']) {
    assert.equal((await preflightPublication({
      root, files: [declaration('public/source.json')],
      proposed: new Map([['public/source.json', body]]),
    })).code, 2);
  }
});

test('preflight uses exact existing allowances and does not exempt an allowed file', async (t) => {
  const root = await fixture(t);
  const [[key]] = ALLOWED;
  const [file, , hit] = key.split('|');
  const files = [declaration(file)];
  const allowed = await preflightPublication({ root, files, proposed: new Map([[file, hit]]) });
  assert.equal(allowed.code, 0);
  const extra = 'gh' + 'p_' + 'q'.repeat(40);
  const refused = await preflightPublication({
    root, files, proposed: new Map([[file, `${hit}\n${extra}`]]),
  });
  assert.equal(refused.code, 1);
  assert.ok(!JSON.stringify(refused).includes(extra));
  const moved = 'public/example.txt';
  assert.equal((await preflightPublication({
    root, files: [declaration(moved)], proposed: new Map([[moved, hit]]),
  })).code, 1, 'an allowance cannot move to a different path');
});

test('supported CBH and CBRO approval/emission paths stop on untracked private dependencies before any write', async (t) => {
  const root = await fixture(t);
  const options = {
    publicationRoot: root, inventoryFile: path.join(root, 'inventory.json'),
    manifestFile: path.join(root, 'manifest.json'), payloadDir: root,
    mappingsDir: path.join(root, 'mappings'), packetsDir: path.join(root, 'packets'),
    overlapsDir: path.join(root, 'overlaps'), ordersDir: path.join(root, 'orders'),
    journalFile: path.join(root, 'transaction.json'),
  };
  for (const directory of [options.mappingsDir, options.packetsDir, options.overlapsDir]) {
    await mkdir(directory);
  }
  await writeFile(options.manifestFile, '{"lists":[]}');
  await writeFile(options.inventoryFile, '[]');
  const unsafe = JSON.stringify({ cache: 'C:' + '\\Users\\synthetic-reader\\cache' });
  await writeFile(path.join(root, 'public', 'draft.json'), unsafe);
  for (const id of ['synthetic-owner', ...CBRO_AUTHOR_IDS]) {
    await writeFile(path.join(options.mappingsDir, `${id}.json`), JSON.stringify({
      id, publicDependencies: ['public/draft.json'],
    }));
    await writeFile(path.join(options.packetsDir, `${id}.json`), '{}');
    await writeFile(path.join(options.overlapsDir, `${id}.json`), '{}');
  }
  for (const act of [
    () => authorPacket(['synthetic-owner'], options),
    () => approveCbroMappings(CBRO_AUTHOR_IDS, options),
    () => authorCbroPacket(CBRO_AUTHOR_IDS, options),
  ]) {
    await assert.rejects(act, (error) => error.exitCode === 1 && /Publication preflight findings/.test(error.message));
  }
  await assert.rejects(() => stat(options.ordersDir), { code: 'ENOENT' });
  assert.equal(await readFile(options.manifestFile, 'utf8'), '{"lists":[]}');
  await writeFile(options.journalFile, '{}');
  await assert.rejects(() => approveCbroMappings(CBRO_AUTHOR_IDS, options), /pending CBRO transaction/);
  await assert.rejects(() => authorCbroPacket(CBRO_AUTHOR_IDS, options), /pending CBRO transaction/);
  assert.equal(await readFile(options.manifestFile, 'utf8'), '{"lists":[]}');
});
