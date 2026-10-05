import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateHomeUpdates, readerFeatures, releaseId } from '../scripts/generate-home-updates.mjs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const row = (id) => ({ id, name: `Guide ${id}`, file: `${id}.json` });
const notes = (version, bullets = '- Reader benefit') => `## ${version}\n\n### Reader choices\n\n${bullets}\n\n### Technical detail\n\nNot reader copy.\n\n`;
const write = (root, path, value) => {
  const target = join(root, ...path.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
};
const git = (root, ...args) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const commit = (root) => { git(root, 'add', '.'); git(root, 'commit', '-m', 'fixture'); };
const output = (root) => readFileSync(join(root, 'src', 'js', 'lib', 'homeUpdatesContent.js'), 'utf8');

function setVersion(root, version) {
  write(root, 'package.json', { version, private: true, type: 'module', scripts: { version: manifest.scripts.version } });
  write(root, 'src/js/lib/version.js', `export const APP_VERSION = '${version}';\n`);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'mrt-home-updates-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, '.gitattributes', readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8'));
  for (const file of ['generate-home-updates.mjs', 'sync-version.mjs']) {
    write(root, `scripts/${file}`, readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8'));
  }
  setVersion(root, '0.9.0');
  write(root, 'CHANGELOG.md', notes('0.9.0') + notes('0.8.0'));
  write(root, 'src/data/catalog.json', { lists: [row('a')] });
  commit(root);
  git(root, 'tag', 'v0.9.0');
  setVersion(root, '1.0.0');
  write(root, 'CHANGELOG.md', notes('1.0.0') + notes('0.9.0') + notes('0.8.0'));
  write(root, 'src/data/catalog.json', { lists: [row('a'), row('b')] });
  commit(root);
  git(root, 'tag', 'v1.0.0');
  generateHomeUpdates({ root, mode: 'bootstrap', version: 'v1.0.0' });
  return root;
}

function prepare(root, { features = '- New capability', lists = [row('a'), row('b'), row('c')] } = {}) {
  write(root, 'src/data/catalog.json', { lists });
  commit(root);
  write(root, 'CHANGELOG.md', notes('1.1.0', features) + readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
}

test('normal npm version automatically populates and stages release highlights', async (t) => {
  const root = fixture(t);
  prepare(root);
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec, ['/d', '/s', '/c', 'npm version minor --no-git-tag-version'], { cwd: root, encoding: 'utf8' })
    : spawnSync('npm', ['version', 'minor', '--no-git-tag-version'], { cwd: root, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const populated = (await import(pathToFileURL(join(root, 'src', 'js', 'lib', 'homeUpdatesContent.js')).href)).homeUpdatesContent;
  assert.equal(populated.version, '1.1.0', 'the lifecycle must replace the prior generated asset');
  assert.deepEqual(populated.batch.listIds, ['c']);
  assert.deepEqual(populated.batch.features, ['New capability']);
  assert.deepEqual(generateHomeUpdates({ root, mode: 'recorded', check: true }).data, populated);
  assert.ok(git(root, 'diff', '--cached', '--name-only').includes('src/js/lib/homeUpdatesContent.js'));
});

test('the first reader bullet block folds continuations and preserves every exact new ID', (t) => {
  assert.deepEqual(readerFeatures('\n### A variable title\n\n- Literal <b>text</b>\n  continued\n\n- Second\n\nCompatibility prose\n### Diagnostics\n- Not news'), [
    'Literal <b>text</b> continued', 'Second',
  ]);
  const root = fixture(t);
  const result = generateHomeUpdates({ root, mode: 'bootstrap', version: 'v1.0.0' }).data;
  assert.deepEqual(result.batch.listIds, ['b']);
  assert.equal(result.batch.features.length, 1);
});

test('generation is idempotent and copy correction requires explicit recorded regeneration', (t) => {
  const root = fixture(t);
  const original = output(root);
  assert.equal(generateHomeUpdates({ root, mode: 'recorded' }).changed, false);
  write(root, 'CHANGELOG.md', readFileSync(join(root, 'CHANGELOG.md'), 'utf8').replace('Reader benefit', "Reader's corrected benefit"));
  assert.throws(() => generateHomeUpdates({ root, mode: 'recorded', check: true }), /stale/);
  assert.equal(output(root), original);
  const value = generateHomeUpdates({ root, mode: 'recorded' }).data;
  assert.equal(value.batch.id, releaseId('1.0.0'));
  assert.deepEqual(value.batch.features, ["Reader's corrected benefit"]);
  assert.equal(generateHomeUpdates({ root, mode: 'recorded', check: true }).changed, false);
});

test('exact tagless endpoints and recorded operations survive squash without the preparation object', (t) => {
  const root = fixture(t);
  git(root, 'tag', '-d', 'v1.0.0');
  prepare(root);
  git(root, 'switch', '-c', 'preparation');
  commit(root);
  const transient = git(root, 'rev-parse', 'HEAD');
  setVersion(root, '1.1.0');
  const candidate = generateHomeUpdates({ root, mode: 'candidate' }).data;
  commit(root);
  git(root, 'switch', 'main');
  git(root, 'merge', '--squash', 'preparation');
  commit(root);
  const cloneDirectory = mkdtempSync(join(tmpdir(), 'mrt-news-clone-'));
  const clone = join(cloneDirectory, 'checkout');
  t.after(() => rmSync(cloneDirectory, { recursive: true, force: true }));
  git(root, 'clone', '--single-branch', '--branch', 'main', '--no-local', root, clone);
  assert.notEqual(spawnSync('git', ['cat-file', '-e', `${transient}^{commit}`], { cwd: clone }).status, 0);
  const checked = generateHomeUpdates({ root: clone, mode: 'recorded', check: true }).data;
  assert.deepEqual(checked, candidate);
  write(clone, 'CHANGELOG.md', readFileSync(join(clone, 'CHANGELOG.md'), 'utf8').replace('New capability', 'Corrected capability'));
  const corrected = generateHomeUpdates({ root: clone, mode: 'recorded' }).data;
  assert.deepEqual(corrected.catalogs, candidate.catalogs);
  assert.equal(corrected.batch.id, candidate.batch.id);
  write(clone, 'src/data/catalog.json', { lists: [row('a'), row('b'), row('c'), row('later')] });
  assert.equal(generateHomeUpdates({ root: clone, mode: 'recorded', check: true }).changed, false);
  assert.throws(() => generateHomeUpdates({ root: clone, mode: 'candidate' }), /Unreleased/);
  write(clone, 'src/js/lib/homeUpdatesContent.js', output(clone).replace(corrected.catalogs.target, '0'.repeat(64)));
  const bad = output(clone);
  assert.throws(() => generateHomeUpdates({ root: clone, mode: 'recorded' }), /snapshot/);
  assert.equal(output(clone), bad);
});

test('invalid record, catalog and exact tag fail before replacing generated bytes', (t) => {
  const root = fixture(t);
  const original = output(root);
  const finalized = notes('1.0.0') + notes('0.9.0') + notes('0.8.0');
  for (const invalid of [
    notes('0.9.0') + notes('0.8.0'),
    finalized.replace('## 1.0.0', '## 1.0.0 draft'),
    notes('1.0.0') + finalized,
  ]) {
    write(root, 'CHANGELOG.md', invalid);
    assert.throws(() => generateHomeUpdates({ root, mode: 'recorded' }), /Expected one finalized release record for 1\.0\.0/);
    assert.equal(output(root), original);
  }
  write(root, 'CHANGELOG.md', finalized);
  write(root, 'src/data/catalog.json', { lists: [row('a'), row('a')] });
  commit(root);
  git(root, 'tag', '-f', 'v1.0.0');
  assert.throws(() => generateHomeUpdates({ root, mode: 'bootstrap', version: 'v1.0.0' }), /duplicate/);
  assert.equal(output(root), original);
  git(root, 'tag', '-f', 'v1.0.0', 'v0.9.0');
  assert.throws(() => generateHomeUpdates({ root, mode: 'bootstrap', version: 'v1.0.0' }), /Wrong product/);
  assert.equal(output(root), original);
  setVersion(root, '0.9.0');
  write(root, 'CHANGELOG.md', notes('0.9.0') + notes('0.8.0'));
  write(root, 'src/data/catalog.json', { lists: [row('a')] });
  commit(root);
  setVersion(root, '1.0.0');
  write(root, 'CHANGELOG.md', finalized);
  write(root, 'src/data/catalog.json', { lists: [row('a'), row('b')] });
  commit(root);
  git(root, 'tag', '-f', 'v1.0.0');
  assert.throws(() => generateHomeUpdates({ root, mode: 'bootstrap', version: 'v1.0.0' }),
    /Ambiguous or reverted product version: 1\.0\.0/);
  assert.equal(output(root), original);

  const appOnly = fixture(t);
  prepare(appOnly, { lists: [row('a'), row('b')] });
  setVersion(appOnly, '1.1.0');
  const appOnlyData = generateHomeUpdates({ root: appOnly, mode: 'candidate' }).data;
  assert.deepEqual(appOnlyData.batch.listIds, []);
  assert.equal(appOnlyData.catalogs.target, appOnlyData.catalogs.previous);
  commit(appOnly);
  git(appOnly, 'tag', 'v1.1.0');
  assert.equal(generateHomeUpdates({ root: appOnly, mode: 'recorded', check: true }).changed, false);
  const appOnlyOriginal = output(appOnly);
  git(appOnly, 'tag', '-f', 'v1.1.0', 'v1.0.0');
  for (const check of [true, false]) {
    assert.throws(() => generateHomeUpdates({ root: appOnly, mode: 'recorded', check }),
      /Wrong product endpoint for 1\.1\.0/);
    assert.equal(output(appOnly), appOnlyOriginal);
  }
});

test('missing, prose-only and malformed reader summaries are rejected rather than guessed', () => {
  for (const value of ['', '### Reader\nParagraph only', '### Reader\n  - Nested bullet', '### Reader\n- Parent\n  - Nested',
    '### Reader\n- Parent\n\n  - Nested', '### Reader\n- Parent\n\n-', '### Reader\n-   ', '### Reader\n- ']) {
    assert.throws(() => readerFeatures(value), /summary|reader/i);
  }
  assert.deepEqual(readerFeatures('### No reader changes\n\n### Technical\nProse'), []);
});

test('explicit empty summaries support null, list-only and feature-only batches', (t) => {
  for (const [features, lists, expected] of [
    ['', [row('a'), row('b')], null],
    ['', [row('a'), row('b'), row('c')], { features: [], listIds: ['c'] }],
    ['- Capability', [row('a'), row('b')], { features: ['Capability'], listIds: [] }],
  ]) {
    const root = fixture(t);
    prepare(root, { features, lists });
    setVersion(root, '1.1.0');
    const { batch } = generateHomeUpdates({ root, mode: 'candidate' }).data;
    if (expected === null) assert.equal(batch, null);
    else {
      assert.deepEqual(batch.features, expected.features);
      assert.deepEqual(batch.listIds, expected.listIds);
    }
  }
});

test('batch ordering ignores timestamps and optional provider gaps and rejects unsupported versions', (t) => {
  assert.equal(releaseId('99999.99999.99999'), 1000000000000000);
  assert.ok(releaseId('2.0.0') > releaseId('1.99999.99999'));
  for (const bad of ['1.2', '01.2.3', '1.2.3-beta', '100000.0.0']) assert.throws(() => releaseId(bad));
  const root = fixture(t);
  prepare(root, { lists: [row('a'), row('b'), { ...row('c'), placeholderCount: 4 }] });
  setVersion(root, '1.1.0');
  const data = generateHomeUpdates({ root, mode: 'candidate' }).data;
  write(root, 'src/data/catalog.json', { generatedAt: 'different', lists: [row('a'), row('b'), row('c')] });
  assert.deepEqual(generateHomeUpdates({ root, mode: 'candidate' }).data, data);
  assert.deepEqual(data.batch.listIds, ['c']);
});
