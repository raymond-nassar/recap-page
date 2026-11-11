import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  corpusSha256, explicitSourceMarker, historyRegistryBytes, parseHistoryRegistryBytes, snapshotAnchors,
} from './check-anchors.mjs';
import { mapLine, parseHunks } from './relocate-anchors.mjs';

const HISTORY = 'docs/anchors.history.json';
const LOCK = 'docs/anchors.lock.json';
const SCRIPT = fileURLToPath(import.meta.url);
const MAP = [
  ['PRODUCT_BACKLOG.md', 'docs/archive/PRODUCT_BACKLOG.md'],
  ['design/mockups/', 'docs/archive/mockups/'],
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const git = (args) => execFileSync('git', args, {
  env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' },
  maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
const show = (base, path) => git(['show', `${base}:${path}`]);
const mapped = (path) => {
  for (const [from, to] of MAP) {
    if (path === from || (from.endsWith('/') && path.startsWith(from))) {
      return to + path.slice(from.length);
    }
  }
  return path;
};

function external(path) {
  if (!isAbsolute(path)) throw new Error('candidate must be an absolute path outside the worktree');
  const root = realpathSync(git(['rev-parse', '--show-toplevel']).toString('utf8').trim());
  const parent = realpathSync(dirname(path));
  const rel = relative(root.toLowerCase(), parent.toLowerCase());
  if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
    throw new Error('candidate must be outside the worktree');
  }
  if (existsSync(path) && realpathSync(path) !== resolve(path)) {
    throw new Error('candidate must not be a symbolic link');
  }
  return resolve(path);
}

function baselineSnapshot(base) {
  return JSON.parse(execFileSync(process.execPath, [SCRIPT, '--snapshot', base], {
    maxBuffer: 64 * 1024 * 1024, encoding: 'utf8',
  }));
}

function movedRange(before, base, file, diffs) {
  if (before.file !== file) return { start: before.start, end: before.end };
  if (!diffs.has(file)) {
    diffs.set(file, parseHunks(git([
      'diff', '--no-ext-diff', '--no-textconv', '--unified=0', base, '--', file,
    ]).toString('utf8')));
  }
  const hunks = diffs.get(file);
  const start = mapLine(hunks, before.start);
  const end = mapLine(hunks, before.end);
  if (start === before.start && end === before.end) return { start, end };
  if (start === null || end === null) throw new Error(`changed range boundary: ${before.key}`);
  const oldLines = show(base, file).toString('utf8').replaceAll('\r\n', '\n').split('\n');
  const newLines = readFileSync(file, 'utf8').replaceAll('\r\n', '\n').split('\n');
  const wanted = oldLines.slice(before.start - 1, before.end);
  const hits = [];
  for (let i = 0; i + wanted.length <= newLines.length; i += 1) {
    if (wanted.every((line, j) => newLines[i + j] === line)) hits.push(i + 1);
  }
  if (hits.length !== 1 || hits[0] !== start || end - start + 1 !== wanted.length) {
    throw new Error(`content search and diff arithmetic disagree: ${before.key}`);
  }
  return { start, end };
}

export function prepareArchive(baseRef) {
  const base = git(['rev-parse', '--verify', `${baseRef}^{commit}`]).toString('utf8').trim();
  git(['merge-base', '--is-ancestor', base, 'HEAD']);
  if (git(['rev-parse', '--is-shallow-repository']).toString('utf8').trim() !== 'false') {
    throw new Error('archive migration requires full history');
  }
  const originalHistory = show(base, HISTORY);
  const originalLock = show(base, LOCK);
  const oldRegistry = parseHistoryRegistryBytes(originalHistory);
  const lock = JSON.parse(originalLock);
  const inventory = git(['ls-tree', '-r', '--name-only', base]).toString('utf8').trim().split('\n');
  const current = new Set(git(['ls-files']).toString('utf8').trim().split('\n'));
  const moved = inventory.filter((path) => mapped(path) !== path);
  if (!moved.includes('PRODUCT_BACKLOG.md')) throw new Error('baseline must precede the archive move');
  const moves = [...(oldRegistry.documentMoves ?? [])];
  const blobs = moved.map((from) => {
    const to = mapped(from);
    const original = show(base, from);
    if (current.has(from) || existsSync(from) || !current.has(to)) {
      throw new Error(`stage the complete archive rename first: ${from} -> ${to}`);
    }
    if (!lstatSync(to).isFile() || lstatSync(to).isSymbolicLink()) throw new Error(`archive is not a regular file: ${to}`);
    if (!original.equals(readFileSync(to))) throw new Error(`archive bytes changed: ${to}`);
    const blobSha256 = sha256(original);
    if (explicitSourceMarker(original.toString('utf8')) !== null) {
      moves.push({ from, to, baseline: base, blobSha256 });
    }
    return { from, to, blobSha256 };
  });
  moves.sort((a, b) => compare(a.to, b.to));
  const registry = {
    ...oldRegistry,
    version: 2,
    entries: oldRegistry.entries.map((entry) => {
      const [document, ...rest] = entry.site.split('|');
      return { ...entry, site: [mapped(document), ...rest].join('|') };
    }).sort((a, b) => compare(a.site, b.site)),
    documentMoves: moves,
  };
  // The approval snapshot is refreshed for this corpus, not imposed on later ordinary checks.
  registry.migrationBaseline = base;
  registry.corpusSha256 = corpusSha256();
  const registryBytes = historyRegistryBytes(registry);
  const before = baselineSnapshot(base);
  const after = snapshotAnchors({ registry });
  if (before.found.length !== Object.keys(lock).length) throw new Error('baseline lock coverage differs');
  const byKey = new Map(after.found.map((entry) => [entry.key, entry]));
  if (byKey.size !== after.found.length) throw new Error('duplicate final occurrence');
  const matched = new Set();
  const diffs = new Map();
  const ledger = before.found.map((old) => {
    if (lock[old.key]?.fp !== old.fp) throw new Error(`baseline lock is not blessed: ${old.key}`);
    const live = old.legacySource === base;
    const file = live ? mapped(old.file) : old.file;
    const { start, end } = live ? movedRange(old, base, file, diffs) : old;
    const anchor = `${file}:${start}${end === start ? '' : `-${end}`}`;
    const key = `${mapped(old.document)}|${old.scope}|${anchor}|${old.ordinal}`;
    const next = byKey.get(key);
    if (!next || matched.has(key)) throw new Error(`lost or collapsed occurrence: ${old.key}`);
    if (next.fp !== old.fp || next.contentSha256 !== old.contentSha256) {
      throw new Error(`changed cited content: ${old.key}`);
    }
    let claim = old.fullClaim;
    for (const [from, to] of MAP) claim = claim.replaceAll(from, to);
    if (next.fullClaim !== old.fullClaim && next.fullClaim !== claim) {
      throw new Error(`changed claim: ${old.key}`);
    }
    matched.add(key);
    return {
      from: old.key, to: key, claim: next.fullClaim,
      source: next.historical ?? next.legacySource ?? 'working tree',
      contentSha256: next.contentSha256, head: next.head, tail: next.tail,
    };
  });
  if (matched.size !== byKey.size || after.exempted !== before.exempted) {
    throw new Error('new occurrences or changed exemptions in archive migration');
  }
  const nextLock = {};
  for (const entry of [...after.found].sort((a, b) => a.key.localeCompare(b.key))) {
    nextLock[entry.key] = { anchor: entry.anchor, fp: entry.fp, head: entry.head };
  }
  const candidate = {
    archiveCandidateVersion: 1, base, corpusSha256: registry.corpusSha256,
    priorRegistrySha256: sha256(originalHistory), priorLockSha256: sha256(originalLock),
    blobs, ledger, registry: JSON.parse(registryBytes), lock: nextLock,
  };
  for (const [path, original, proposed] of [
    [HISTORY, originalHistory, registryBytes], [LOCK, originalLock, bytes(nextLock)],
  ]) {
    const raw = readFileSync(path);
    const actual = path === LOCK ? Buffer.from(raw.toString('utf8').replaceAll('\r\n', '\n')) : raw;
    if (!actual.equals(original) && !actual.equals(proposed)) {
      throw new Error(`${path} differs from both the baseline and derived migration`);
    }
  }
  if (corpusSha256() !== candidate.corpusSha256) throw new Error('corpus changed during preview');
  return candidate;
}

export function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length === 2 && argv[0] === '--snapshot') {
      const base = argv[1];
      const registry = parseHistoryRegistryBytes(show(base, HISTORY));
      process.stdout.write(JSON.stringify(snapshotAnchors({ reference: base, registry })));
      return 0;
    }
    if (argv.length === 4 && argv[0] === '--base' && argv[2] === '--output') {
      const output = external(argv[3]);
      if (existsSync(output)) throw new Error('candidate output already exists');
      const candidate = prepareArchive(argv[1]);
      const raw = bytes(candidate);
      writeFileSync(output, raw, { flag: 'wx' });
      console.log(`${candidate.ledger.length} occurrences preserved; 0 new, 0 collapsed, 0 lost`);
      console.log(`${candidate.blobs.length} unchanged archive blobs; ${candidate.registry.entries.length} historical entries`);
      console.log(`Candidate: ${output}\nSHA-256: ${sha256(raw)}`);
      return 0;
    }
    if (argv.length === 4 && argv[0] === '--apply' && argv[2] === '--approved-sha256') {
      const raw = readFileSync(external(argv[1]));
      if (sha256(raw) !== argv[3]) throw new Error('approved candidate SHA-256 does not match');
      const loaded = JSON.parse(raw);
      const candidate = prepareArchive(loaded.base);
      if (!raw.equals(bytes(candidate))) throw new Error('candidate is stale; regenerate and review');
      const next = historyRegistryBytes(candidate.registry);
      if (readFileSync(HISTORY).equals(next)) {
        console.log('Approved registry already applied; run ordinary anchors check/bless/check.');
        return 0;
      }
      const temporary = `${HISTORY}.${process.pid}.tmp`;
      try {
        writeFileSync(temporary, next, { flag: 'wx' });
        if (process.env.MRT_ARCHIVE_FAIL_BEFORE_RENAME === '1') throw new Error('injected before registry rename');
        renameSync(temporary, HISTORY);
      } finally {
        rmSync(temporary, { force: true });
      }
      console.log('Applied approved historical registry only; run ordinary anchors check/bless/check.');
      return 0;
    }
    throw new Error('usage: --base <commit> --output <external-candidate> OR --apply <candidate> --approved-sha256 <digest>');
  } catch (error) {
    console.error(`FATAL: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
