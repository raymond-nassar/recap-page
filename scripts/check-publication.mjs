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
// Run it with no arguments for both halves against whatever history is present. `--surface` scans
// what a clone receives; `--branches` checks whether its advertised names belong to the default
// or an open pull request. The modes stay separate because only the first two scan content.
//
// Three exit codes, and the third is the one that matters. 0 is clean over a population it could
// actually read. 1 is findings. 2 is "could not answer", which is what a shallow clone, a missing
// remote, a stale view of one, or git itself failing all produce. The first version of this script
// returned 0 for most of those, and a gate that reports success when it has been given nothing to
// look at is worse than no gate, because it reads identically in a summary.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SURFACE = process.argv.includes('--surface');
const BRANCHES = process.argv.includes('--branches');

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
const SHADOW_REVIEW_SESSION = '34c17dd0-fd0e-4422-' + 'a238-6505fd798c8e';
const DOOM_REVIEW_SESSION = 'e824c0af-3fc7-' + '4082-bc3d-32478a41c387';
const SHADOW_REVIEW_FILES = [
  'scripts/data/cbh-mappings/shadow-king-reading-order.json',
  'scripts/data/cbh-packets/shadow-king-reading-order.json',
];
const DOOM_REVIEW_FILES = [
  'scripts/data/owner-packets/one-world-under-doom.json',
  'scripts/data/owner-mappings/one-world-under-doom.json',
];
const STORE_PUBLISHER_FILES = [
  'docs/MICROSOFT_STORE.md',
  'docs/MICROSOFT_STORE_SUBMISSION.md',
  'packaging/windows/Package.appxmanifest',
  'scripts/pack-msix.mjs',
  'scripts/run-wack.ps1',
  'scripts/check-store-submission.mjs',
  'scripts/lib/startup-contract.mjs',
  'test/msix-packaging.test.js',
];
export const ALLOWED = new Map([
  [`${FIXTURES_FILE}|a path inside one machine's home directory|/ho` + 'me/somebody/',
    'the positive fixture for the home-directory pattern'],
  [`${FIXTURES_FILE}|a session or workspace identifier|577facd0-f9e4` + '-4c0a-a5ff-77182d49c2c5',
    'the positive fixture for the identifier pattern, which is this session\'s own id'],
  ['scripts/check-publication.mjs|a session or workspace identifier|34c17dd0-fd0e-4422-a238-6505fd798c8e',
    'the approved Nebula source-review identity recorded in the publication gate itself'],
  ['scripts/data/cbh-packets/nebula-reading-order.json|a session or workspace identifier|34c17dd0-fd0e-4422-a238-6505fd798c8e',
    'the exact Nebula draft identity in reachable history; the current source-review identity is public'],
  [`${FIXTURES_FILE}|a private key block|-----BEGIN RSA ` + 'PRIVATE KEY-----',
    'the positive fixture for the private key pattern, a header with no key under it'],
  ...SHADOW_REVIEW_FILES.map((file) => [
    `${file}|a session or workspace identifier|${SHADOW_REVIEW_SESSION}`,
    'the exact coordinator identity bound into the approved Shadow King review receipt',
  ]),
  ...DOOM_REVIEW_FILES.map((file) => [
    `${file}|a session or workspace identifier|${DOOM_REVIEW_SESSION}`,
    'the exact coordinator identity bound into the approved One World Under Doom source and relationship review',
  ]),
  ...STORE_PUBLISHER_FILES.map((file) => [
    `${file}|a session or workspace identifier|${STORE_PUBLISHER}`,
    'the exact public Microsoft Store package Publisher supplied by Partner Center',
  ]),
  ...[
    'test/android-marvel-launcher.test.js',
    'packaging/android/app/src/test/java/io/github/raymondnassar/recappage/prototype/NavigationPolicyTest.java',
  ].map((file) => [
    `${file}|a session or workspace identifier|03baf094-d1bf-4eb6-8533-` + '0840ebc0d0b9',
    'the public Marvel issue DRN from its share link, used to verify exact identifier handling',
  ]),
  ['packaging/android/app/src/androidTest/java/io/github/raymondnassar/recappage/prototype/NativeIntegrationTest.java'
    + '|a session or workspace identifier|00000000-0000-4000-8000-' + '000000000099',
  'the fabricated native reader fixture DRN, not a session, user or workspace identity'],
  ['test/android-instrumentation.test.js|a path inside one machine\'s home directory|/ho' + 'me/private/',
    'a fabricated privacy-negative log path that the native capsule test asserts is never retained'],
  ['test/android-instrumentation.test.js|a secret assigned in code|pass' + "word = 'PRIVATE_SECRET'",
    'a fixed synthetic forbidden-field payload that the native capsule schema rejects, not a credential'],
  ['test/browser-reporting.test.js|a secret assigned in code|' + 'secret' + " : 'HeadlessChrome/140.0.7339.0'",
    'the fixed browser-version literal after a ternary colon in the reporter fixture, not an assigned credential'],
  ['test/google-play-publisher.test.js|a secret assigned in code|' + 'token' + " = 'fixture-token-never-recorded'",
    'the fixed noncredential bearer sentinel used only by the mocked Play transport tests'],
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
function parseRemoteAdvertisement(text) {
  let defaultBranch = null;
  const branches = [];
  for (const line of text.split('\n').map((value) => value.trim()).filter(Boolean)) {
    const [value, ref] = line.split('\t');
    if (ref === 'HEAD' && value.startsWith('ref: refs/heads/')) {
      defaultBranch = value.replace(/^ref: refs\/heads\//, '');
    } else if (ref?.startsWith('refs/heads/')) {
      branches.push(ref.replace(/^refs\/heads\//, ''));
    }
  }
  return { defaultBranch, branches: [...new Set(branches)].sort() };
}

function remoteAdvertisement(runGit = git) {
  return parseRemoteAdvertisement(runGit(['ls-remote', '--symref', 'origin', 'HEAD', 'refs/heads/*']));
}

function repositoryFromRemote(remote) {
  const https = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(remote);
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(remote);
  const match = https || ssh;
  if (!match) throw new Error('origin is not a github.com repository and GITHUB_REPOSITORY is not set');
  return `${match[1]}/${match[2]}`;
}

function repositoryName(runGit, env) {
  const repository = env.GITHUB_REPOSITORY?.trim()
    || repositoryFromRemote(runGit(['remote', 'get-url', 'origin']).trim());
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`the repository name ${JSON.stringify(repository)} is not in owner/repository form`);
  }
  return repository;
}

async function openPullRequestHeads(repository, fetchImpl, token) {
  const heads = new Set();
  for (let page = 1; ; page += 1) {
    const url = new URL(`https://api.github.com/repos/${repository}/pulls`);
    url.searchParams.set('state', 'open');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'recap-page-publication-gate',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetchImpl(url, { headers });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} while listing open pull requests`);
    const pulls = await response.json();
    if (!Array.isArray(pulls)) throw new Error('GitHub returned a non-array pull request response');
    for (const pull of pulls) {
      if (pull?.head?.repo?.full_name?.toLowerCase() === repository.toLowerCase()
          && typeof pull.head.ref === 'string') {
        heads.add(pull.head.ref);
      }
    }
    if (pulls.length < 100) break;
  }
  return [...heads].sort();
}

export function evaluateAdvertisedBranches(advertisement, openHeads) {
  const allowed = new Set([advertisement.defaultBranch, ...openHeads]);
  return advertisement.branches.filter((branch) => !allowed.has(branch));
}

function unansweredBranchResult(message) {
  return { code: 2, defaultBranch: null, branches: [], openHeads: [], unexpected: [], message };
}

export async function advertisedBranchPolicy({
  runGit = git,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  let advertisement;
  try {
    advertisement = remoteAdvertisement(runGit);
  } catch (error) {
    return unansweredBranchResult(
      `Could not ask the remote what branches it advertises: ${String(error.message).split('\n')[0]}`,
    );
  }
  if (!advertisement.defaultBranch) {
    return unansweredBranchResult('Could not identify the default branch: the remote HEAD has no branch symref');
  }
  if (!advertisement.branches.includes(advertisement.defaultBranch)) {
    return unansweredBranchResult(
      `Could not identify the default branch: the remote points to ${JSON.stringify(advertisement.defaultBranch)} `
      + 'but does not advertise it',
    );
  }

  let repository;
  try {
    repository = repositoryName(runGit, env);
  } catch (error) {
    return unansweredBranchResult(
      `Could not identify the GitHub repository whose pull requests own branches: ${String(error.message).split('\n')[0]}`,
    );
  }

  let openHeads;
  try {
    openHeads = await openPullRequestHeads(repository, fetchImpl, env.GITHUB_TOKEN);
  } catch (error) {
    return unansweredBranchResult(`Could not ask GitHub which pull requests are open: ${String(error.message).split('\n')[0]}`);
  }

  const unexpected = evaluateAdvertisedBranches(advertisement, openHeads);
  return {
    code: unexpected.length ? 1 : 0,
    ...advertisement,
    openHeads,
    unexpected,
    message: null,
  };
}

function surfaceObjects() {
  const tracking = git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'])
    .split('\n').map((s) => s.trim()).filter(Boolean).filter((r) => !r.endsWith('/HEAD'));
  if (tracking.length === 0) return { refs: null, why: 'No remote-tracking refs. --surface scans what a clone of the remote would receive, so there is nothing to scan.' };

  let advertisement;
  try {
    advertisement = remoteAdvertisement();
  } catch (e) {
    return { refs: null, why: `Could not ask the remote what it advertises, so the local tracking refs cannot be trusted to be that population: ${String(e.message).split('\n')[0]}` };
  }

  const advertised = advertisement.branches;
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

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function publicPath(value) {
  if (typeof value !== 'string' || !value || value.includes(':')
    || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || isAbsolute(value) || value.startsWith('\\')) {
    throw new Error('invalid public path');
  }
  const name = value.replaceAll('\\', '/');
  if (name.split('/').some((part) => !part || part === '.' || part === '..')
    || name.split('/').some((part) => /[. ]$/.test(part))
    || name.split('/')[0].toLowerCase() === '.git') {
    throw new Error('invalid public path');
  }
  return name;
}

async function publicFile(root, name, proposed) {
  const parts = name.split('/');
  let file = root;
  for (const [index, part] of parts.entries()) {
    file = join(file, part);
    let info;
    try {
      info = await lstat(file);
    } catch (error) {
      if (error.code === 'ENOENT' && proposed) continue;
      throw new Error('required public input is unreadable', { cause: error });
    }
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())) {
      throw new Error('public input crosses a link or non-file boundary');
    }
  }
  return file;
}

export async function resolvePublicFile(root, name) {
  return publicFile(await realpath(root), publicPath(name), false);
}

// A private-original name/hash/byte receipt is not a file reference. A path-bearing receipt is.
// Keep this structural distinction separate from the existing privacy detector.
function publicReferences(value, references = new Set()) {
  if (!value || typeof value !== 'object') return references;
  if (Object.hasOwn(value, 'publicDependencies')) {
    if (!Array.isArray(value.publicDependencies)) throw new Error('invalid public dependency declaration');
    value.publicDependencies.forEach((entry) => references.add(publicPath(entry)));
  }
  if (Object.hasOwn(value, 'path')
    && (Object.hasOwn(value, 'sha256') || Object.hasOwn(value, 'bytes'))) {
    references.add(publicPath(value.path));
  }
  for (const child of Object.values(value)) publicReferences(child, references);
  return references;
}

function preflightPolicyDigest() {
  return sha256(JSON.stringify({
    patterns: PATTERNS.map(([name, pattern]) => [name, pattern.source, pattern.flags]),
    allowances: [...ALLOWED],
    protectedRoots: PROTECTED,
  }));
}

/**
 * Read only the declared public population, including untracked files. Proposed bytes let authors
 * inspect their exact output before writing it. No private match, absolute path or raw content
 * enters the result. The receipt is evidence about bytes, never source-review authority.
 */
export async function preflightPublication({
  root = ROOT, files, proposed = new Map(), expected = null,
} = {}) {
  const problems = [];
  const contentFindings = [];
  const inputs = [];
  const fail = (input, reason) => problems.push({ input, reason });
  let declarations;
  let directory;
  try {
    directory = await realpath(root);
    if (!Array.isArray(files) || files.length === 0) throw new Error('public input set is empty');
    declarations = files.map((entry) => {
      if (!entry || typeof entry !== 'object'
        || Object.keys(entry).some((key) => !['path', 'dependencies'].includes(key))
        || !Array.isArray(entry.dependencies)) {
        throw new Error('public input declarations require paths and complete dependency arrays');
      }
      const dependencies = entry.dependencies.map(publicPath).sort();
      if (new Set(dependencies.map((name) => name.toLowerCase())).size !== dependencies.length) {
        throw new Error('public dependency declaration contains duplicates');
      }
      return { path: publicPath(entry.path), dependencies };
    });
    if (new Set(declarations.map((entry) => entry.path.toLowerCase())).size !== declarations.length) {
      throw new Error('public input declaration contains duplicate paths');
    }
    const names = new Set(declarations.map((entry) => entry.path));
    if (!(proposed instanceof Map) || [...proposed.keys()].some((name) => !names.has(name))) {
      throw new Error('proposed bytes are outside the declared public set');
    }
    for (const entry of declarations) {
      if (entry.dependencies.some((name) => !names.has(name) || name === entry.path)) {
        throw new Error('public dependency set is incomplete or self-referencing');
      }
    }
  } catch {
    return {
      schemaVersion: 1, status: 'unanswered', code: 2,
      problems: [{ input: null, reason: 'Invalid, empty, incomplete or inaccessible public input declaration.' }],
      findings: [],
    };
  }

  for (const [index, entry] of declarations.entries()) {
    const input = index + 1;
    const sink = new Map();
    findings(entry.path, entry.path, sink);
    const label = sink.size ? {} : { path: entry.path };
    if (PROTECTED.some(([prefix]) => entry.path.toLowerCase().startsWith(prefix))) {
      contentFindings.push({ input, ...label, kind: 'a protected working-evidence path', count: 1 });
      continue;
    }
    try {
      const file = await publicFile(directory, entry.path, proposed.has(entry.path));
      const supplied = proposed.get(entry.path);
      if (proposed.has(entry.path) && typeof supplied !== 'string' && !Buffer.isBuffer(supplied)) {
        throw new Error('proposed bytes must be text or a buffer');
      }
      const body = proposed.has(entry.path) ? Buffer.from(supplied) : await readFile(file);
      await publicFile(directory, entry.path, proposed.has(entry.path));
      if (body.length === 0) throw new Error('required public input is empty');
      const text = decode(body);
      if (text === null) throw new Error('required public input is not supported text');
      const encoding = body[0] === 0xff && body[1] === 0xfe ? 'utf-16le'
        : body[0] === 0xfe && body[1] === 0xff ? 'utf-16be' : 'utf-8';
      if (!new TextDecoder(encoding, { fatal: true }).decode(body).trim()) throw new Error('empty public text');
      findings(entry.path, text, sink);
      if (entry.path.endsWith('.json')) {
        const references = publicReferences(JSON.parse(text.replace(/^\uFEFF/, '')));
        if ([...references].some((name) => !entry.dependencies.includes(name))) {
          throw new Error('public provenance dependency is not declared');
        }
      }
      inputs.push({ ...entry, bytes: body.length, sha256: sha256(body) });
    } catch {
      // Filesystem/JSON errors often quote their input. Do not move a private value into a log.
      fail(input, 'Required input could not be fully read within the public boundary, or its provenance dependencies are incomplete.');
    }
    for (const [kind, matches] of sink) {
      contentFindings.push({ input, ...label, kind, count: matches.length });
    }
  }

  const result = {
    schemaVersion: 1,
    status: contentFindings.length ? 'findings' : problems.length ? 'unanswered' : 'clean',
    code: contentFindings.length ? 1 : problems.length ? 2 : 0,
    problems, findings: contentFindings,
  };
  if (result.code !== 0) return result;
  inputs.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const receipt = { policySha256: preflightPolicyDigest(), inputs };
  const digest = sha256(JSON.stringify(receipt));
  if (expected && (expected.status !== 'clean' || expected.code !== 0
    || expected.digest !== digest || JSON.stringify(expected.inputs) !== JSON.stringify(inputs)
    || expected.policySha256 !== receipt.policySha256)) {
    return {
      ...result, status: 'unanswered', code: 2,
      problems: [{ input: null, reason: 'The clean public-input receipt is stale or invalid.' }],
    };
  }
  return { ...result, ...receipt, digest };
}

export function requireCleanPreflight(result) {
  if (result?.code !== 0 || result.status !== 'clean') {
    const error = new Error(`Publication preflight ${result?.status ?? 'unanswered'}; no approval or output is authorized.`);
    error.exitCode = result?.code === 1 ? 1 : 2;
    error.preflight = result;
    throw error;
  }
  return result;
}

export async function readPublicationInputs({ root = ROOT, paths }) {
  const contents = new Map();
  const files = [];
  try {
    if (!Array.isArray(paths) || paths.length === 0) throw new Error('missing public inputs');
    const directory = await realpath(root);
    const queue = paths.map((file) => publicPath(relative(resolve(root), resolve(file))));
    for (let index = 0; index < queue.length; index += 1) {
      const name = queue[index];
      if (contents.has(name)) continue;
      if (PROTECTED.some(([prefix]) => name.toLowerCase().startsWith(prefix))) {
        return requireCleanPreflight(await preflightPublication({
          root, files: [{ path: name, dependencies: [] }],
        }));
      }
      const file = await publicFile(directory, name, false);
      const body = await readFile(file);
      const text = decode(body);
      const dependencies = name.endsWith('.json')
        ? [...publicReferences(JSON.parse(text?.replace(/^\uFEFF/, '')))].sort() : [];
      contents.set(name, body);
      files.push({ path: name, dependencies });
      queue.push(...dependencies);
    }
  } catch (error) {
    if (error.exitCode) throw error;
    return requireCleanPreflight({
      code: 2, status: 'unanswered',
    });
  }
  const receipt = requireCleanPreflight(await preflightPublication({ root, files, proposed: contents }));
  return {
    receipt, contents,
    json(file) {
      const name = publicPath(relative(resolve(root), resolve(file)));
      const body = contents.get(name);
      if (!body) throw new Error('Required public JSON was not part of the preflight.');
      return JSON.parse(decode(body).replace(/^\uFEFF/, ''));
    },
  };
}

export async function preflightPublicationWrites({ root = ROOT, inputs, outputs }) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error('Publication preflight requires a nonempty output set.');
  }
  const files = inputs.receipt.inputs.map(({ path, dependencies }) => ({ path, dependencies }));
  requireCleanPreflight(await preflightPublication({ root, files, expected: inputs.receipt }));
  const declarations = new Map(files.map((entry) => [entry.path, entry]));
  const proposed = new Map(inputs.contents);
  const destinations = new Set();
  for (const output of outputs) {
    let name;
    let dependencies;
    try {
      name = publicPath(relative(resolve(root), resolve(output.file)));
      if (destinations.has(name.toLowerCase())) throw new Error('duplicate output');
      destinations.add(name.toLowerCase());
      dependencies = name.endsWith('.json')
        ? [...publicReferences(JSON.parse(output.content))].sort() : [];
    } catch {
      throw new Error('Publication preflight unanswered: invalid output name, bytes or provenance.');
    }
    declarations.set(name, { path: name, dependencies });
    proposed.set(name, output.content);
  }
  return requireCleanPreflight(await preflightPublication({
    root, files: [...declarations.values()], proposed,
  }));
}

async function preflightCli(args) {
  const options = new Map();
  if (args.filter((argument) => argument === '--preflight').length > 1) {
    throw new Error('duplicate preflight mode');
  }
  for (const argument of args.filter((value) => value !== '--preflight')) {
    const match = /^--(preflight|files|expect|output)=(.+)$/.exec(argument);
    const key = match?.[1] === 'preflight' ? 'files' : match?.[1];
    if (!match || options.has(key)) throw new Error('invalid preflight arguments');
    options.set(key, match[2]);
  }
  const declaration = JSON.parse(await readFile(options.get('files'), 'utf8'));
  if (declaration.schemaVersion !== 1 || Object.keys(declaration).some((key) => !['schemaVersion', 'files'].includes(key))) {
    throw new Error('invalid public declaration schema');
  }
  const expected = options.has('expect')
    ? JSON.parse(await readFile(options.get('expect'), 'utf8')) : null;
  const result = await preflightPublication({ files: declaration.files, expected });
  if (options.has('output')) {
    const output = resolve(options.get('output'));
    if (declaration.files.some((entry) => resolve(ROOT, entry.path).toLowerCase() === output.toLowerCase())) {
      throw new Error('receipt must not replace a public input');
    }
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
  return result.code;
}

function isShallow() {
  return git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
}

// ------------------------------------------------------------------ report

async function main() {
  if (process.argv.slice(2).some((arg) => arg.startsWith('--preflight'))) {
    try {
      return await preflightCli(process.argv.slice(2));
    } catch {
      console.error('Publication preflight unanswered: invalid arguments or an unreadable declaration/receipt.');
      return 2;
    }
  }
  if (BRANCHES) {
    const result = await advertisedBranchPolicy();
    if (result.code === 2) {
      console.error(result.message);
      console.error('The advertised branch policy was unanswered rather than clean.');
      return 2;
    }
    console.log(
      `Advertised branch policy: ${result.branches.length} branch(es), `
      + `default ${JSON.stringify(result.defaultBranch)}, ${result.openHeads.length} open pull request head(s).`,
    );
    if (result.unexpected.length) {
      console.log(`${result.unexpected.length} unexpected advertised branch(es):`);
      for (const branch of result.unexpected) console.log(`  ${JSON.stringify(branch)}`);
      console.log(
        'Only the default branch and heads of open pull requests from this repository '
        + 'belong on the published surface.',
      );
      return 1;
    }
    console.log('No unexpected advertised branches.');
    return 0;
  }

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
    code = await main();
  } catch (e) {
    // Anything thrown here is git or the filesystem refusing to co-operate. It used to surface as
    // an uncaught exception and exit 1, which is the code that means "findings were found", so an
    // infrastructure failure and a real leak were indistinguishable by exit code.
    console.error(`The publication gate could not run: ${String(e && e.message).split('\n')[0]}`);
    code = 2;
  }
  process.exitCode = code;
}
