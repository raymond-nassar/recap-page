/* global Buffer */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildArtifact, normalizeBasePath } from '../build.mjs';
import { checkArtifact } from '../check.mjs';

async function temporaryOutput(t) {
  const parent = await mkdtemp(join(tmpdir(), 'recap-hosted-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  return parent;
}

async function listFiles(root, path = root) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(root, target));
    else result.push(target.slice(root.length + 1));
  }
  return result.sort();
}

test('base paths normalize safely and reject traversal or URL syntax', () => {
  assert.equal(normalizeBasePath('/'), '/');
  assert.equal(normalizeBasePath('/hosted'), '/hosted/');
  assert.equal(normalizeBasePath('/preview/edge/'), '/preview/edge/');
  for (const value of ['', 'hosted/', '//other/', '/a/../b/', '/a%2fb/', '/a?b', '/a#b', '/a b', '/a\\b']) {
    assert.throws(() => normalizeBasePath(value), undefined, `must reject ${value}`);
  }
});

test('build emits an allowlisted inventory and explicit hosted adaptations', async (t) => {
  const parent = await temporaryOutput(t);
  const output = join(parent, 'site');
  const { manifest } = await buildArtifact({ outputDirectory: output, basePath: '/prototype/' });
  const checked = await checkArtifact(output, '/prototype/');
  const paths = manifest.outputInventory.map(({ path }) => path);
  const transformations = new Set(manifest.transformations.map(({ name }) => name));
  assert.ok(paths.includes('index.html'));
  assert.ok(paths.includes('data/catalog.json'));
  assert.ok(paths.includes('js/main.js'));
  assert.ok(paths.includes('js/reader.js'));
  assert.ok(paths.includes('host-contract.json'));
  assert.ok(!paths.some((path) => path.startsWith('dev-faults.')));
  assert.ok(!paths.includes('icons/README.md'));
  assert.ok(transformations.has('replace-local-health-with-not-applicable-capability'));
  assert.ok(transformations.has('nested-reader-launch'));
  assert.equal(checked.contract.basePath, '/prototype/');
});

test('build bytes and content digest are independent of output directory', async (t) => {
  const parent = await temporaryOutput(t);
  const first = join(parent, 'one');
  const second = join(parent, 'two');
  const one = await buildArtifact({ outputDirectory: first, basePath: '/same/' });
  const two = await buildArtifact({ outputDirectory: second, basePath: '/same/' });
  assert.equal(one.manifest.contentDigest, two.manifest.contentDigest);
  const firstFiles = await listFiles(first);
  const secondFiles = await listFiles(second);
  assert.deepEqual(firstFiles, secondFiles);
  for (const path of firstFiles) {
    assert.deepEqual(await readFile(join(first, path)), await readFile(join(second, path)), path);
  }
});

test('artifact check rejects an absolute-root reader handoff', async (t) => {
  const parent = await temporaryOutput(t);
  const output = join(parent, 'site');
  await buildArtifact({ outputDirectory: output, basePath: '/prototype/' });
  const readerPath = join(output, 'js', 'reader.js');
  const original = await readFile(readerPath, 'utf8');
  const manifestPath = join(output, 'artifact-manifest.json');
  const originalManifest = await readFile(manifestPath);
  try {
    const mutated = original.replace('/prototype/open.html?', '/open.html?');
    assert.notEqual(mutated, original);
    await writeFile(readerPath, mutated);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const bytes = Buffer.from(mutated);
    const entry = manifest.outputInventory.find(({ path }) => path === 'js/reader.js');
    entry.bytes = bytes.length;
    entry.sha256 = createHash('sha256').update(bytes).digest('hex');
    const digestRows = manifest.outputInventory.map(({ path, sha256, bytes: length }) => `${path}\0${sha256}\0${length}`);
    manifest.contentDigest = createHash('sha256').update(digestRows.join('\n')).digest('hex');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(checkArtifact(output, '/prototype/'), /reader launch must remain within the selected base path/);
  } finally {
    await writeFile(readerPath, original);
    await writeFile(manifestPath, originalManifest);
  }
  await checkArtifact(output, '/prototype/');
});
