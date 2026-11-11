import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyRegistryBytes } from '../scripts/check-anchors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (raw) => createHash('sha256').update(raw).digest('hex');
const cite = (text) => String.fromCharCode(96) + text + String.fromCharCode(96);

function fixture({ existingArchive = false } = {}) {
  const root = mkdtempSync(join(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp', 'archive-anchors-'));
  const outside = mkdtempSync(join(dirname(root), 'archive-candidate-'));
  const git = (...args) => execFileSync('git', [
    '-c', 'user.name=anchors', '-c', 'user.email=anchors@example.invalid', ...args,
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const run = (script, args = [], env = {}) => spawnSync(process.execPath, [`scripts/${script}.mjs`, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...env },
  });
  const good = (result) => {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result;
  };
  const commit = () => { git('add', '-A'); git('commit', '--quiet', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  git('init', '--quiet');
  write('.gitignore', 'scripts/\n');
  write('.gitattributes', '* -text\n');
  write('target.js', 'first\nsecond\nthird\n');
  write('PRODUCT_BACKLOG.md', '# Frozen\nOld record\n');
  if (existingArchive) write('docs/archive/PRODUCT_BACKLOG.md', '# Frozen\nOld record\n');
  write('CURRENT.md', `Backlog ${cite('PRODUCT_BACKLOG.md:1')}\n\nSame claim ${cite('target.js:2')}\n\nSame claim ${cite('target.js:2')}\n`);
  const source = commit();
  write('PRODUCT_BACKLOG.md', `# Frozen\n<!-- anchors:source=${source} -->\nFrozen claim ${cite('target.js:1')}\n\nSelf ${cite('PRODUCT_BACKLOG.md:1')}\n`);
  if (existingArchive) {
    write('docs/archive/PRODUCT_BACKLOG.md', readFileSync(join(root, 'PRODUCT_BACKLOG.md')));
  }
  write('docs/anchors.history.json', historyRegistryBytes({
    version: 1, migrationBaseline: source, corpusSha256: '0'.repeat(64),
    sealedTargets: ['sealed.js'], expectedCount: 0, entries: [],
  }));
  for (const script of ['check-anchors', 'relocate-anchors', 'archive-anchors']) {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(join(ROOT, 'scripts', `${script}.mjs`), join(root, 'scripts', `${script}.mjs`));
  }
  git('add', '-A');
  good(run('check-anchors', ['--bless']));
  const base = commit();
  const oldBlob = readFileSync(join(root, 'PRODUCT_BACKLOG.md'));
  mkdirSync(join(root, 'docs', 'archive'), { recursive: true });
  git('mv', '-f', 'PRODUCT_BACKLOG.md', 'docs/archive/PRODUCT_BACKLOG.md');
  write('target.js', 'inserted\nfirst\nsecond\nthird\n');
  write('CURRENT.md', `Backlog ${cite('docs/archive/PRODUCT_BACKLOG.md:1')}\n\nSame claim ${cite('target.js:3')}\n\nSame claim ${cite('target.js:3')}\n`);
  git('add', '-A');
  const candidate = join(outside, 'candidate.json');
  const prepare = (path = candidate) => run('archive-anchors', ['--base', base, '--output', path]);
  const apply = (env = {}, digest = hash(readFileSync(candidate))) =>
    run('archive-anchors', ['--apply', candidate, '--approved-sha256', digest], env);
  return {
    root, outside, git, write, run, good, commit, base, oldBlob, candidate, prepare, apply,
    clean: () => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); },
  };
}

test('archive preview is deterministic, read-only and bijective before approved authority is installed', () => {
  const f = fixture();
  try {
    const history = readFileSync(join(f.root, 'docs/anchors.history.json'));
    const lock = readFileSync(join(f.root, 'docs/anchors.lock.json'));
    f.good(f.prepare());
    const second = join(f.outside, 'second.json');
    f.good(f.prepare(second));
    assert.deepEqual(readFileSync(f.candidate), readFileSync(second));
    assert.deepEqual(readFileSync(join(f.root, 'docs/anchors.history.json')), history);
    assert.deepEqual(readFileSync(join(f.root, 'docs/anchors.lock.json')), lock);
    const candidate = JSON.parse(readFileSync(f.candidate));
    assert.equal(candidate.ledger.length, 5);
    assert.equal(new Set(candidate.ledger.map((entry) => entry.to)).size, 5);
    assert.match(candidate.ledger.find((entry) => entry.from.endsWith('target.js:2|1')).to, /target\.js:3\|1$/);
    for (const args of [[], ['--bless']]) {
      const refused = f.run('check-anchors', args);
      assert.equal(refused.status, 2);
      assert.match(refused.stderr, /missing from document source/);
    }
    f.good(f.apply());
    assert.deepEqual(readFileSync(join(f.root, 'docs/anchors.lock.json')), lock);
    f.good(f.apply());
    f.good(f.run('check-anchors', ['--bless']));
    f.good(f.run('check-anchors'));
    f.good(f.run('relocate-anchors', ['--base', f.base]));
    assert.deepEqual(readFileSync(join(f.root, 'docs/archive/PRODUCT_BACKLOG.md')), f.oldBlob);
    const after = f.commit();
    f.good(f.run('check-anchors', ['--ref', after]));
    const old = f.run('check-anchors', ['--ref', f.base]);
    assert.equal(old.status, 1, `${old.stdout}\n${old.stderr}`);
    assert.doesNotMatch(old.stderr, /FATAL/);
  } finally { f.clean(); }
});

test('archive authority rejects modified blobs, absent declarations and invalid baseline binding', () => {
  const f = fixture();
  try {
    f.good(f.prepare());
    f.good(f.apply());
    f.write('docs/archive/PRODUCT_BACKLOG.md', `${f.oldBlob}changed\n`);
    assert.match(f.run('check-anchors').stderr, /destination blob does not match/);
    f.write('docs/archive/PRODUCT_BACKLOG.md', f.oldBlob);
    const registry = JSON.parse(readFileSync(join(f.root, 'docs/anchors.history.json')));
    const missing = { ...registry, version: 1 };
    delete missing.documentMoves;
    f.write('docs/anchors.history.json', historyRegistryBytes(missing));
    assert.match(f.run('check-anchors').stderr, /missing from document source/);
    registry.documentMoves[0].blobSha256 = 'f'.repeat(64);
    f.write('docs/anchors.history.json', historyRegistryBytes(registry));
    assert.match(f.run('check-anchors').stderr, /baseline blob does not match/);
    registry.documentMoves.push({ ...registry.documentMoves[0] });
    assert.throws(() => historyRegistryBytes(registry), /disjoint/);
  } finally { f.clean(); }
});

test('archive approval refuses stale input and preserves outputs when the atomic write fails', () => {
  const f = fixture();
  try {
    f.good(f.prepare());
    const history = readFileSync(join(f.root, 'docs/anchors.history.json'));
    const lock = readFileSync(join(f.root, 'docs/anchors.lock.json'));
    f.write('UNRELATED.md', 'new tracked corpus\n');
    f.git('add', 'UNRELATED.md');
    assert.match(f.apply().stderr, /stale/);
    f.git('rm', '-f', 'UNRELATED.md');
    assert.match(f.apply({}, '0'.repeat(64)).stderr, /SHA-256 does not match/);
    assert.match(f.apply({ MRT_ARCHIVE_FAIL_BEFORE_RENAME: '1' }).stderr, /injected/);
    assert.deepEqual(readFileSync(join(f.root, 'docs/anchors.history.json')), history);
    assert.deepEqual(readFileSync(join(f.root, 'docs/anchors.lock.json')), lock);
    f.good(f.apply());
    f.write('docs/anchors.history.json', `${readFileSync(join(f.root, 'docs/anchors.history.json'))}\n`);
    assert.match(f.apply().stderr, /differs from both/);
  } finally { f.clean(); }
});

test('archive occurrence ledger refuses losses and changes despite repeated identical claims', () => {
  const f = fixture();
  try {
    f.write('CURRENT.md', `Backlog ${cite('docs/archive/PRODUCT_BACKLOG.md:1')}\n\nSame claim ${cite('target.js:3')}\n`);
    assert.match(f.prepare().stderr, /lost or collapsed/);
    f.write('CURRENT.md', `Backlog ${cite('docs/archive/PRODUCT_BACKLOG.md:1')}\n\nChanged claim ${cite('target.js:3')}\n\nSame claim ${cite('target.js:3')}\n`);
    assert.match(f.prepare().stderr, /changed claim/);
  } finally { f.clean(); }
});

test('existing history sealing preserves move authority and literal frozen targets', () => {
  const f = fixture();
  try {
    f.good(f.prepare());
    f.good(f.apply());
    f.good(f.run('check-anchors', ['--bless']));
    f.commit();
    const original = JSON.parse(readFileSync(join(f.root, 'docs/anchors.history.json')));
    const sealed = join(f.outside, 'seal.json');
    f.good(f.run('check-anchors', ['--prepare-history', 'target.js', '--output', sealed]));
    f.good(f.run('check-anchors', ['--apply-history', sealed, '--approved-sha256', hash(readFileSync(sealed))]));
    const registry = JSON.parse(readFileSync(join(f.root, 'docs/anchors.history.json')));
    assert.deepEqual(registry.documentMoves, original.documentMoves);
    assert.equal(registry.version, 2);
    assert.equal(registry.entries.length, 1);
    assert.match(registry.entries[0].historical, /:target\.js#L1$/);
    f.good(f.run('check-anchors'));
  } finally { f.clean(); }
});

test('archive range proof refuses edited evidence and ambiguous content search', () => {
  const f = fixture();
  try {
    f.write('target.js', 'inserted\nfirst\nchanged second\nthird\n');
    assert.equal(f.prepare().stderr, 'FATAL: changed range boundary: CURRENT.md|preamble|target.js:2|0\n');
    f.write('target.js', 'inserted\nfirst\nsecond\nthird\nsecond\n');
    assert.equal(f.prepare().stderr, 'FATAL: content search and diff arithmetic disagree: CURRENT.md|preamble|target.js:2|0\n');
  } finally { f.clean(); }
});

test('archive candidates can be applied through a linked parent directory', () => {
  const f = fixture();
  try {
    const directory = join(f.outside, 'physical');
    const link = join(f.outside, 'linked');
    mkdirSync(directory);
    symlinkSync(directory, link, process.platform === 'win32' ? 'junction' : 'dir');
    const candidate = join(link, 'candidate.json');
    f.good(f.prepare(candidate));
    f.good(f.run('archive-anchors', [
      '--apply', candidate, '--approved-sha256', hash(readFileSync(candidate)),
    ]));
  } finally { f.clean(); }
});

test('archive occurrence ledger refuses a new occurrence', () => {
  const f = fixture();
  try {
    f.write('NEW.md', `New claim ${cite('target.js:3')}\n`);
    f.git('add', 'NEW.md');
    const result = f.prepare();
    assert.equal(result.status, 2);
    assert.equal(result.stderr, 'FATAL: new occurrences or changed exemptions in archive migration\n');
  } finally { f.clean(); }
});

test('archive occurrence ledger refuses two documents collapsing onto one occurrence', () => {
  const f = fixture({ existingArchive: true });
  try {
    const result = f.prepare();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^FATAL: lost or collapsed occurrence: docs\/archive\/PRODUCT_BACKLOG\.md\|/);
  } finally { f.clean(); }
});

test('archive authority refuses a non-ancestor move baseline', () => {
  const f = fixture();
  try {
    f.good(f.prepare());
    f.good(f.apply());
    const registry = JSON.parse(readFileSync(join(f.root, 'docs/anchors.history.json')));
    const unrelated = f.git('commit-tree', `${f.base}^{tree}`, '-m', 'unrelated root');
    registry.documentMoves[0].baseline = unrelated;
    f.write('docs/anchors.history.json', historyRegistryBytes(registry));
    const result = f.run('check-anchors');
    assert.equal(result.status, 2);
    assert.equal(result.stderr, `FATAL: document move baseline ${unrelated} is not an ancestor of HEAD\n`);
  } finally { f.clean(); }
});

test('archive authority refuses the old path reappearing', () => {
  const f = fixture();
  try {
    f.good(f.prepare());
    f.good(f.apply());
    f.write('PRODUCT_BACKLOG.md', f.oldBlob);
    f.git('add', 'PRODUCT_BACKLOG.md');
    const result = f.run('check-anchors');
    assert.equal(result.status, 2);
    assert.equal(result.stderr, 'FATAL: document move source still exists\n');
  } finally { f.clean(); }
});

test('version-1 history cannot carry document move authority', () => {
  const f = fixture();
  try {
    f.good(f.prepare());
    f.good(f.apply());
    const registry = JSON.parse(readFileSync(join(f.root, 'docs/anchors.history.json')));
    registry.version = 1;
    f.write('docs/anchors.history.json', `${JSON.stringify(registry)}\n`);
    const result = f.run('check-anchors');
    assert.equal(result.status, 2);
    assert.equal(result.stderr, 'FATAL: historical registry must contain exactly version, migrationBaseline, corpusSha256, sealedTargets, expectedCount, entries\n');
  } finally { f.clean(); }
});
