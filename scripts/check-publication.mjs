#!/usr/bin/env node
// The publication gate. This repository was published on 2026-08-16, and several of the things that
// made it safe to publish were decisions rather than code: which working artifacts are public
// evidence and which stay on one machine, and whether anything personal is committed. A decision
// that lives in someone's head is not one, so this is where both are written down and checked.
//
// Two halves, with two different populations, because conflating them is the mistake this script
// was written after making.
//
//   Boundary   The ignore rules that keep local-only content local are actually in force. Reads the
//              working tree, so it holds on any clone including a shallow one.
//   History    Nothing personal or credential-shaped is committed anywhere a reader could reach.
//              Needs history, so on a shallow clone it refuses to answer rather than passing.
//
// Run it with no arguments for both halves against whatever history is present. `--surface`
// scans what a clone of the remote would receive rather than the local object store, which is the
// distinction the header comment on PATTERNS explains and the reason this script exists at all.
//
// Three exit codes, and the third is the one that matters. 0 is clean over a population it could
// actually read. 1 is findings. 2 is "could not answer", which is what a shallow clone, a missing
// remote, a stale view of one, or git itself failing all produce. The first version of this script
// returned 0 for most of those, and a gate that reports success when it has been given nothing to
// look at is worse than no gate, because it reads identically in a summary.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SURFACE = process.argv.includes('--surface');

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 512e6, ...opts });
}

// Roots whose contents are working evidence for one session rather than product documentation.
// Naming the roots is not the enumeration this repository warns about: the rule is "nothing new
// under here", and git ignores have no effect on a file that is already tracked, so the six
// artifacts committed under the first of these keep working untouched while everything added
// later is held out by construction. Nobody has to keep a list of filenames complete.
export const PROTECTED = [
  ['.copilot-tracking/', 'working artifacts for one session, kept out of the product record'],
  ['.github/prompts/', 'spent instructions to an agent, which BL-060 parked rather than commit'],
];

const PROTECTED_TRACKED_BASELINE = {
  count: 227,
  sha256: 'e1a3e5d8a2bc2232e5055e09484d488f2d10359e90ab424f3e9983f5cb1d40a2',
};

export function protectedTrackedFingerprint(paths) {
  const protectedPaths = paths
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => PROTECTED.some(([root]) => path.startsWith(root)))
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const hash = createHash('sha256');
  for (const path of protectedPaths) {
    hash.update(path, 'utf8');
    hash.update(Buffer.from([0]));
  }
  return { count: protectedPaths.length, sha256: hash.digest('hex') };
}

// Shapes that must not reach a published tree. Each is a signature rather than a guess at a value:
// a match is a thing that looks like a credential or like one machine's private detail, and the
// gate's answer to a match is to stop rather than to judge.
//
// The first pattern accepts both separators and a doubled one because the raw form is the form
// this repository is least likely to leak. Everything here is developed under a Windows profile
// directory, and a path that reaches a JSON file, a lockfile, a `file://` URL or any JavaScript
// string literal arrives escaped or forward-slashed. The narrow version of this pattern matched
// the one form a person would notice by eye and missed the four a machine writes.
export const PATTERNS = [
  ['a path inside one machine\'s user profile', /[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}[A-Za-z0-9._-]+/g],
  ['a path inside one machine\'s home directory', /(?:^|[\s"'(])\/(?:home|Users)\/[A-Za-z0-9._-]+\//gm],
  ['a session or workspace identifier', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi],
  ['an AWS access key id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['a bearer token written out', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/g],
  ['a secret assigned in code', /\b(?:api[_-]?key|secret|password|passwd|token|credential)s?\s*[:=]\s*["'][^"'\s]{12,}["']/gi],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
];

// Written into the tree deliberately, as the example of the thing being looked for. A gate that
// cannot be told about its own documentation fails on the sentence that explains it, which is a
// failure nobody can act on and everybody learns to ignore.
//
// The allowance is one exact hit in one exact file, not a file. It used to be a file, and that was
// a hole rather than a shortcut: a whole-file exemption skips every pattern at every revision, so a
// real credential committed to an exempt path was invisible to this gate and to the test that
// double-checks it. Two files were exempt and one of them, this one, matched nothing at all, so the
// exemption bought a permanent blind spot in the single file the whole mechanism rests on and
// nothing else. Keyed this way, a fourth unplanned credential-shaped string in the fixture file
// still fails.
//
// Each key is assembled rather than written out for the same reason the fixtures it describes are:
// a literal here would be a real string of that shape in a real file, and this file is now scanned
// like every other.
const FIXTURES_FILE = 'test/publication-gate.test.js';
const STORE_PUBLISHER = 'F6D9045B-46F0-4EAC-' + '9524-4BFC8A75A472';
const STORE_PUBLISHER_FILES = [
  'docs/MICROSOFT_STORE.md',
  'docs/MICROSOFT_STORE_SUBMISSION.md',
  'packaging/windows/Package.appxmanifest',
  'scripts/pack-msix.mjs',
  'scripts/run-wack.ps1',
  'test/msix-packaging.test.js',
];
export const ALLOWED = new Map([
  [`${FIXTURES_FILE}|a path inside one machine's home directory|/ho` + 'me/somebody/',
    'the positive fixture for the home-directory pattern'],
  [`${FIXTURES_FILE}|a session or workspace identifier|577facd0-f9e4` + '-4c0a-a5ff-77182d49c2c5',
    'the positive fixture for the identifier pattern, which is this session\'s own id'],
  [`${FIXTURES_FILE}|a private key block|-----BEGIN RSA ` + 'PRIVATE KEY-----',
    'the positive fixture for the private key pattern, a header with no key under it'],
  ...STORE_PUBLISHER_FILES.map((file) => [
    `${file}|a session or workspace identifier|${STORE_PUBLISHER}`,
    'the exact public Microsoft Store package Publisher supplied by Partner Center',
  ]),
]);

export function findings(label, text, sink) {
  for (const [name, re] of PATTERNS) {
    const hits = text.match(re);
    if (!hits) continue;
    for (const hit of new Set(hits)) {
      const trimmed = hit.trim();
      if (ALLOWED.has(`${label}|${name}|${trimmed}`)) continue;
      if (!sink.has(name)) sink.set(name, []);
      sink.get(name).push({ label, hit: trimmed.slice(0, 80) });
    }
  }
}

// ------------------------------------------------------------------ the boundary half

// Two probes per root, one nested and one directly beneath it, because a rule can be narrowed to
// cover the first and not the second. `.copilot-tracking/*/*` passed the nested probe while leaving
// a file at the root of it committable by an ordinary `git add -A`, which is the whole fault this
// half exists to catch.
//
// `core.excludesFile` is emptied so the answer is about this repository's rules rather than about
// whatever the machine running it happens to ignore globally. A rule in `.git/info/exclude` still
// counts and cannot be turned off this way, so a local pass is not the last word; CI runs this on a
// clean checkout, which has no `info/exclude`, and that is the leg that settles it.
export function boundaryFaults() {
  const faults = [];
  const errors = [];
  for (const [root, why] of PROTECTED) {
    // Paths that do not exist, so the answer is about the rule rather than about a file.
    const probes = [`${root}2099-01-01/would-a-new-artifact-be-held-out.md`, `${root}would-a-new-artifact-be-held-out.md`];
    for (const probe of probes) {
      // `git check-ignore` exits 0 when ignored and 1 when not. Anything else is git failing to
      // answer, which used to be folded into "not ignored" and reported as a policy violation with
      // a message that sent the reader after the wrong thing entirely.
      const run = spawnSync('git', ['-c', 'core.excludesFile=', 'check-ignore', '--quiet', '--no-index', '--', probe], { cwd: ROOT });
      if (run.status === 0) continue;
      if (run.status === 1) {
        faults.push(`${probe} is not ignored, so a new file there would be committed by an ordinary \`git add -A\`. It holds ${why}.`);
        continue;
      }
      errors.push(`git could not answer whether ${probe} is ignored (status ${run.status}): ${String(run.stderr).trim()}`);
    }
  }
  const tracked = git(['-c', 'core.quotePath=false', 'ls-files', '-z']).split('\u0000').filter(Boolean);
  const corpus = protectedTrackedFingerprint(tracked);
  if (corpus.count !== PROTECTED_TRACKED_BASELINE.count || corpus.sha256 !== PROTECTED_TRACKED_BASELINE.sha256) {
    faults.push(
      `the protected tracked-path corpus changed from ${PROTECTED_TRACKED_BASELINE.count} path(s) at `
      + `${PROTECTED_TRACKED_BASELINE.sha256} to ${corpus.count} path(s) at ${corpus.sha256}. `
      + 'New session evidence and spent prompts must stay local; remove any force-added path.',
    );
  }
  return { faults, errors };
}

// ------------------------------------------------------------------ the content half

// A file git could not read is not a file that read clean. Read from the index enumerated by
// `ls-files`, not HEAD: a force-added path exists only in that index, and an alternate index is how
// the production integration test proves the boundary without changing a developer's real one.
// Turning quoting off and splitting on NUL preserves names outside plain ASCII; any surviving read
// failure remains a fault because "could not look" and "looked and found nothing" are not the same.
function trackedBlobs() {
  const files = git(['-c', 'core.quotePath=false', 'ls-files', '-z']).split('\u0000').filter(Boolean);
  return files.map((file) => {
    try {
      return { file, body: execFileSync('git', ['show', `:${file}`], { cwd: ROOT, maxBuffer: 512e6 }), error: null };
    } catch (e) {
      return { file, body: null, error: String(e.message).split('\n')[0] };
    }
  });
}

// The population a clone would receive, rather than every object this machine happens to hold.
// The difference is not academic: the local store carries a tooling namespace of checkpoint refs
// whose commit messages are all session identifiers, and scanning it reported 316 of them. None is
// advertised by the remote, so none would ever be published, and a gate built on `--all` would
// have been permanently red over content no one could remove.
//
// Remote-tracking refs are a cache of the last fetch, not the remote. Asking the remote directly and
// refusing to answer on any disagreement is the difference between reporting what would be published
// and reporting what this machine last happened to hear about it.
function surfaceObjects() {
  const tracking = git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'])
    .split('\n').map((s) => s.trim()).filter(Boolean).filter((r) => !r.endsWith('/HEAD'));
  if (tracking.length === 0) return { refs: null, why: 'No remote-tracking refs. --surface scans what a clone of the remote would receive, so there is nothing to scan.' };

  let advertised;
  try {
    advertised = git(['ls-remote', '--heads', 'origin']).split('\n')
      .map((s) => s.trim()).filter(Boolean)
      .map((line) => line.split('\t')[1]).filter(Boolean)
      .map((ref) => ref.replace(/^refs\/heads\//, ''));
  } catch (e) {
    return { refs: null, why: `Could not ask the remote what it advertises, so the local tracking refs cannot be trusted to be that population: ${String(e.message).split('\n')[0]}` };
  }

  const local = tracking.map((r) => r.replace(/^refs\/remotes\/origin\//, ''));
  const missing = advertised.filter((b) => !local.includes(b));
  const stale = local.filter((b) => !advertised.includes(b));
  if (missing.length || stale.length) {
    const parts = [];
    if (missing.length) parts.push(`${missing.length} advertised branch(es) this clone has never fetched (${missing.slice(0, 5).join(', ')})`);
    if (stale.length) parts.push(`${stale.length} tracking ref(s) the remote no longer advertises (${stale.slice(0, 5).join(', ')})`);
    return { refs: null, why: `The local view of the remote is out of date, so --surface would report on the wrong population: ${parts.join(' and ')}. Run \`git fetch --prune\` and try again.` };
  }
  return { refs: tracking, why: null };
}

function scanCommits(refs, sink) {
  const log = git(['log', ...refs, '--format=%H%n%B%n=====END=====']);
  let count = 0;
  for (const entry of log.split('=====END=====')) {
    const trimmed = entry.replace(/^\s+/, '');
    const nl = trimmed.indexOf('\n');
    if (nl < 0) continue;
    count += 1;
    findings(`commit ${trimmed.slice(0, nl).trim().slice(0, 8)}`, trimmed.slice(nl + 1), sink);
  }
  return count;
}

// A byte-order mark means text this repository is especially likely to produce and least likely to
// look at. PowerShell 5.1 is the shell here and its `>` and `Set-Content` write UTF-16LE by default,
// so a captured log or transcript is full of NUL bytes and was being discarded as binary. That is
// the artifact class most likely to carry a path or a token, so it is decoded rather than skipped.
export function decode(body) {
  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) return body.subarray(2).toString('utf16le');
  if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) {
    const swapped = Buffer.from(body.subarray(2));
    if (swapped.length % 2 === 0) { swapped.swap16(); return swapped.toString('utf16le'); }
  }
  if (body.includes(0)) return null;
  return body.toString('utf8');
}

function scanBlobs(refs, sink) {
  const objects = git(['rev-list', '--objects', ...refs]).split('\n').map((s) => s.trim()).filter(Boolean);
  const names = new Map();
  for (const line of objects) {
    const sp = line.indexOf(' ');
    names.set(sp > 0 ? line.slice(0, sp) : line, sp > 0 ? line.slice(sp + 1) : '');
  }
  const check = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    input: [...names.keys()].join('\n'),
  });
  const wanted = [];
  const report = { scanned: 0, large: 0, binary: 0, unreadable: 0 };
  for (const line of check.split('\n')) {
    const [sha, type, size] = line.trim().split(' ');
    if (type !== 'blob') continue;
    // Four megabytes is where a blob stops plausibly being text somebody wrote. The count is
    // printed rather than dropped, because a population line that silently omits its exclusions
    // is a claim wider than the thing it was measured over.
    if (Number(size) >= 4e6) { report.large += 1; continue; }
    wanted.push({ sha, name: names.get(sha) || sha.slice(0, 8), size: Number(size) });
  }
  // Batch by bytes rather than by blob count. A full history can hold hundreds of megabytes of
  // individually small JSON files; asking git for all of them at once exhausts the child-process
  // buffer before the gate has read any of them.
  const maxBatchBytes = 32e6;
  const protocolOverheadBytes = 512;
  const batches = [];
  let batch = [];
  let batchBytes = 0;
  for (const entry of wanted) {
    const estimatedBytes = entry.size + protocolOverheadBytes;
    if (batch.length && batchBytes + estimatedBytes > maxBatchBytes) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(entry);
    batchBytes += estimatedBytes;
  }
  if (batch.length) batches.push(batch);

  for (const entries of batches) {
    const raw = execFileSync('git', ['cat-file', '--batch'], {
      cwd: ROOT,
      input: entries.map(({ sha }) => sha).join('\n'),
      maxBuffer: 48e6,
    });
    let at = 0;
    for (const { name } of entries) {
      const nl = raw.indexOf(0x0a, at);
      if (nl < 0) break;
      const header = raw.toString('utf8', at, nl).trim().split(' ');
      // A header without a size means git answered `missing` or `ambiguous`. Advancing by a NaN
      // would desync every blob after it and report the rest of the population clean, so this stops
      // being a parse and becomes a fault.
      if (header.length < 3) { report.unreadable += 1; at = nl + 1; continue; }
      const size = Number(header[2]);
      const body = raw.subarray(nl + 1, nl + 1 + size);
      at = nl + 1 + size + 1;
      const text = decode(body);
      if (text === null) { report.binary += 1; continue; }
      report.scanned += 1;
      findings(name, text, sink);
    }
  }
  return report;
}

// What was left out is part of what was read. Anything excluded is named here so the population
// line describes the scan that happened rather than the one it resembles.
export function excluded(report) {
  const parts = [];
  if (report.large) parts.push(`${report.large} skipped as 4 MB or larger`);
  if (report.binary) parts.push(`${report.binary} skipped as binary`);
  if (report.unreadable) parts.push(`${report.unreadable} git could not read`);
  return parts.length ? `, ${parts.join(', ')}` : '';
}

function isShallow() {
  return git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
}

// ------------------------------------------------------------------ report

function main() {
  const { faults, errors } = boundaryFaults();
  const sink = new Map();
  let population;
  let unanswered = null;

  // Hoisted above the mode dispatch. It used to sit in an `else if` after the surface branch, so
  // `--surface` could never reach it, and that is the one invocation where a truncated scan reading
  // as a complete one does the most damage: it is the mode the workflow comment and the changelog
  // both name as the population that matters on the day someone publishes.
  if (isShallow()) {
    let unreadable = 0;
    for (const { file, body, error } of trackedBlobs()) {
      if (body === null) { unreadable += 1; errors.push(`could not read ${file} at HEAD: ${error}`); continue; }
      const text = decode(body);
      if (text === null) continue;
      findings(file, text, sink);
    }
    population = `the tracked working tree only, because this clone is shallow and has no history to read${unreadable ? `, ${unreadable} of which git could not read` : ''}`;
    unanswered = 'This clone is shallow, so the history half of this gate was not answered. Nothing above is evidence that the history is clean. Re-run on a full clone, or in CI, where the checkout for this step sets `fetch-depth: 0`.';
  } else if (SURFACE) {
    const { refs, why } = surfaceObjects();
    if (refs === null) {
      console.error(why);
      return 2;
    }
    const report = scanBlobs(refs, sink);
    const commits = scanCommits(refs, sink);
    population = `${refs.length} branch(es) the remote advertises, ${report.scanned} blob(s)${excluded(report)} and ${commits} commit message(s), which is what a clone receives and not everything publication exposes: pull request refs are served by the forge, are not writable here, and are outside this population`;
  } else {
    const report = scanBlobs(['HEAD'], sink);
    const commits = scanCommits(['HEAD'], sink);
    population = `every commit reachable from HEAD, ${report.scanned} blob(s)${excluded(report)} and ${commits} commit message(s)`;
  }

  const revision = git(['rev-parse', 'HEAD']).trim();
  const total = [...sink.values()].reduce((n, list) => n + list.length, 0);
  console.log(`Publication gate at ${revision}`);
  console.log(`Scanned ${population}.`);
  console.log(`${PROTECTED.length} protected root(s), ${faults.length} not in force. ${total} content finding(s).`);

  for (const fault of faults) console.log(`\nBOUNDARY  ${fault}`);
  for (const [name, list] of sink) {
    console.log(`\nCONTENT   ${name}: ${list.length} occurrence(s)`);
    let shown = 0;
    for (const { label, hit } of list) {
      if (shown++ >= 10) { console.log(`            ... and ${list.length - 10} more`); break; }
      console.log(`            ${JSON.stringify(hit)}  in ${label}`);
    }
  }
  for (const error of errors) console.log(`\nUNANSWERED  ${error}`);

  if (faults.length > 0 || total > 0) {
    console.log('\nA finding here is not automatically a leak. Read each one: the answer is either to remove it,');
    console.log('or to record why it is deliberate, and a hit that is deliberate belongs in ALLOWED, named exactly.');
    return 1;
  }
  if (errors.length > 0 || unanswered) {
    if (unanswered) console.log(`\n${unanswered}`);
    console.log('\nThis run did not establish that the population is clean. Treat it as unanswered rather than as a pass.');
    return 2;
  }
  // This used to sign off as "the history is clean", which was true of what it looks for and false
  // of what a reader would take it to mean. Removing Marvel's description text from the tree on
  // 2026-08-15 left that prose recoverable from 243 of the 246 commits then on main, and this gate
  // never looked for it, so a green run said nothing about the one history problem that expires at
  // publication. Whoever runs this before flipping the repository public is precisely the reader who
  // would have read the pass as covering both. So the sentence now names its own population.
  console.log('\nNothing to remediate: nothing credential-shaped, no path private to one machine, and');
  console.log('nothing new under a protected root. That is the whole of what this gate looked for, and');
  console.log('third-party text in history is not part of it. Record this revision and this population');
  console.log('beside any claim that rests on them.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let code;
  try {
    code = main();
  } catch (e) {
    // Anything thrown here is git or the filesystem refusing to co-operate. It used to surface as
    // an uncaught exception and exit 1, which is the code that means "findings were found", so an
    // infrastructure failure and a real leak were indistinguishable by exit code.
    console.error(`The publication gate could not run: ${String(e && e.message).split('\n')[0]}`);
    code = 2;
  }
  process.exit(code);
}
