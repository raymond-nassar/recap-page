import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  PROTECTED,
  PATTERNS,
  ALLOWED,
  boundaryFaults,
  protectedTrackedFingerprint,
  findings,
  decode,
  excluded,
} from '../scripts/check-publication.mjs';

// The publication gate answered a question that only gets asked once, and it was asked on
// 2026-08-16, the day this repository was made public. The day has happened, and by then every
// answer was already fixed. So the checks below are about keeping that answer true rather than
// about producing it: that the ignore rules holding local-only content local are still in force,
// that the shapes the gate looks for are shapes it can find, and that the tracked tree is clean.
//
// Every credential-shaped fixture here is assembled from pieces rather than written out. A literal
// one would be a real string of that shape in a real file, which is precisely what push protection
// and the gate itself exist to stop, and a check that cannot be committed is not a check.
//
// This file is no longer exempt from the gate, and neither is the gate. The three shapes below that
// the gate does find in this file are allowed one hit at a time rather than by exempting the file,
// so a fourth, unplanned one still fails.

const root = new URL('../', import.meta.url);

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: fileURLToPath(root), encoding: 'utf8', maxBuffer: 64e6, ...opts });
}

// One `git cat-file --batch` rather than a `git show` per file. The difference is not a nicety:
// spawning git 187 times took ten seconds, which is more than the rest of the suite together, and a
// check that slow is one somebody eventually stops running.
function trackedText() {
  const entries = git(['-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', 'HEAD'])
    .split('\u0000')
    .filter(Boolean)
    .map((row) => {
      const tab = row.indexOf('\t');
      return { sha: row.slice(0, tab).split(' ')[2], file: row.slice(tab + 1) };
    });
  const raw = execFileSync('git', ['cat-file', '--batch'], {
    cwd: fileURLToPath(root),
    input: entries.map(({ sha }) => sha).join('\n'),
    maxBuffer: 512e6,
  });
  const out = [];
  let at = 0;
  for (const { file } of entries) {
    const nl = raw.indexOf(0x0a, at);
    const size = Number(raw.toString('utf8', at, nl).trim().split(' ')[2]);
    const body = raw.subarray(nl + 1, nl + 1 + size);
    at = nl + 1 + size + 1;
    out.push({ file, body });
  }
  return out;
}

function match(text) {
  const sink = new Map();
  findings('fixture', text, sink);
  return [...sink.keys()];
}

// One positive and one negative per pattern. The negative is the point: a pattern that matches its
// own example proves nothing if it also matches ordinary prose, and the ones most likely to do that
// are the loose ones, the assignment shape and the home-directory path.
const FIXTURES = [
  ["a path inside one machine's user profile", 'C:' + '\\Users\\somebody\\projects', 'the user profile directory'],
  ["a path inside one machine's home directory", ' /home/somebody/projects', 'a file under the home directory'],
  ['a session or workspace identifier', '577facd0-f9e4-4c0a-a5ff-77182d49c2c5', 'session 577facd0 and its workspace'],
  ['an AWS access key id', 'AKIA' + 'QRSTUVWX23456789', 'the AKIA prefix marks an access key id'],
  ['a GitHub token', 'gh' + 'p_' + 'x'.repeat(36), 'a token issued by GitHub'],
  ['a private key block', '-----BEGIN RSA PRIVATE KEY-----', 'a private key never belongs here'],
  ['a bearer token written out', 'Bearer ' + 'y'.repeat(24), 'send it as a bearer token'],
  ['a secret assigned in code', 'api_key = ' + '"' + 'z'.repeat(16) + '"', 'the api_key is read from the environment'],
  ['a Slack token', 'xox' + 'b-' + '2'.repeat(14), 'a Slack app token'],
];

test('every shape the gate looks for is a shape it can find, and none of them fires on ordinary prose', () => {
  assert.equal(FIXTURES.length, PATTERNS.length, 'each pattern carries a fixture');
  const named = new Set(PATTERNS.map(([name]) => name));
  for (const [name, positive, negative] of FIXTURES) {
    assert.ok(named.has(name), `${name} is a pattern the gate carries`);
    assert.ok(match(positive).includes(name), `${name} matches the shape it describes`);
    assert.deepEqual(match(negative), [], `${name}: prose describing the shape is not the shape`);
  }
});

// The raw backslash form is the one a person spots by eye, and it was the only one the pattern
// found. Everything here is developed under a Windows profile directory, so the forms that would
// actually leak are the ones a machine writes: escaped into a JSON or JavaScript string literal,
// forward-slashed by a tool that normalises separators, or wrapped in a file URL.
test('a Windows profile path is found in every form a tool would serialise it into', () => {
  const name = "a path inside one machine's user profile";
  // Assembled, like every other fixture here, so that writing the test does not commit the shape
  // the test is about. The forward-slash forms would otherwise be found by the home-directory
  // pattern in this very file.
  const drive = 'C' + ':';
  const u = '/Us' + 'ers/';
  const forms = [
    ['raw backslash', drive + '\\Users\\somebody\\projects\\file.js'],
    ['escaped for a string literal', drive + '\\\\Users\\\\somebody\\\\projects'],
    ['forward slashed', drive + u + 'somebody/projects/file.js'],
    ['quoted and forward slashed', '"' + drive + u + 'somebody/"'],
    ['a file url', 'file:///' + drive + u + 'somebody/projects/'],
  ];
  for (const [why, text] of forms) {
    assert.ok(match(text).includes(name), `${why}: ${text}`);
  }
  assert.deepEqual(match('the user profile directory'), [], 'prose about the directory is not a path');
  assert.deepEqual(match('a drive letter and a colon'), [], 'prose about the shape is not the shape');
});

test('the roots holding one session\'s working artifacts are still ignored', () => {
  const { faults, errors } = boundaryFaults();
  assert.deepEqual(faults, [], faults.join('\n'));
  // An error is git failing to answer. It used to be folded into "not ignored" and reported as a
  // policy violation, which sent the reader after a rule that was never the problem.
  assert.deepEqual(errors, [], errors.join('\n'));
  // Named rather than counted, because the failure this guards is a rule quietly disappearing and a
  // count of zero faults is equally true of a list that has been emptied.
  const roots = PROTECTED.map(([dir]) => dir);
  assert.ok(roots.includes('.copilot-tracking/'), 'the tracking root is protected');
  assert.ok(roots.includes('.github/prompts/'), 'the prompts root is protected');
});

// A rule can be narrowed so that it still holds one directory deeper while leaving the root of it
// committable. `.copilot-tracking/*/*` does exactly that, and the single nested probe the gate
// started with passed against it.
test('the boundary is probed at the root of a protected directory as well as inside it', () => {
  const ignored = (path) => spawnSync('git', ['-c', 'core.excludesFile=', 'check-ignore', '--quiet', '--no-index', '--', path],
    { cwd: fileURLToPath(root) }).status === 0;
  for (const [dir] of PROTECTED) {
    assert.ok(ignored(`${dir}2099-01-01/nested-artifact.md`), `${dir} holds a nested file out`);
    assert.ok(ignored(`${dir}artifact-at-the-root.md`), `${dir} holds a file at its own root out`);
  }
});

test('the protected tracked-path fingerprint has unambiguous canonical framing', () => {
  const ordered = protectedTrackedFingerprint(['.github/prompts/b', '.copilot-tracking/a']);
  const reversed = protectedTrackedFingerprint(['.copilot-tracking/a', '.github\\prompts\\b']);
  assert.deepEqual(reversed, ordered, 'input order and path separators do not change the corpus');
  assert.notEqual(
    protectedTrackedFingerprint(['.copilot-tracking/a', '.copilot-tracking/bc']).sha256,
    protectedTrackedFingerprint(['.copilot-tracking/ab', '.copilot-tracking/c']).sha256,
    'a NUL after every path prevents path-boundary collisions',
  );
  assert.equal(
    protectedTrackedFingerprint(['.copilot-tracking/a\nb']).count,
    1,
    'a newline belongs to one path instead of becoming a delimiter',
  );
  assert.deepEqual(
    protectedTrackedFingerprint(['ordinary.txt']),
    protectedTrackedFingerprint([]),
    'unprotected paths do not affect the protected corpus',
  );
});

test('the production gate rejects a force-added protected path without touching the real index', () => {
  const workspace = fileURLToPath(root);
  const dir = mkdtempSync(join(tmpdir(), 'mrt-publication-index-'));
  const realIndexText = git(['rev-parse', '--git-path', 'index']).trim();
  const realIndex = resolve(workspace, realIndexText);
  const before = readFileSync(realIndex);
  const protectedFile = join(workspace, '.copilot-tracking', 'publication-boundary-proof.tmp');
  const controlFile = join(workspace, 'publication-boundary-control.tmp');
  const runWith = (file, indexName) => {
    const alternateIndex = join(dir, indexName);
    cpSync(realIndex, alternateIndex);
    const env = { ...process.env, GIT_INDEX_FILE: alternateIndex };
    writeFileSync(file, 'publication boundary proof\n');
    const add = spawnSync('git', ['add', '--force', '--', file], { cwd: workspace, env, encoding: 'utf8' });
    assert.equal(add.status, 0, add.stderr);
    return spawnSync(process.execPath, ['scripts/check-publication.mjs'], {
      cwd: workspace,
      env,
      encoding: 'utf8',
      maxBuffer: 512e6,
    });
  };
  try {
    const protectedRun = runWith(protectedFile, 'protected.index');
    assert.equal(protectedRun.status, 1, `${protectedRun.stdout}${protectedRun.stderr}`);
    assert.match(protectedRun.stdout, /protected tracked-path corpus changed/);

    const controlRun = runWith(controlFile, 'control.index');
    const shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
    assert.equal(controlRun.status, shallow ? 2 : 0, `${controlRun.stdout}${controlRun.stderr}`);
    assert.doesNotMatch(controlRun.stdout, /could not read publication-boundary-control\.tmp/);
    if (shallow) assert.match(controlRun.stdout, /history half of this gate was not answered/);
    assert.deepEqual(readFileSync(realIndex), before, 'the real Git index is unchanged');
  } finally {
    rmSync(protectedFile, { force: true });
    rmSync(controlFile, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no tracked file carries a credential or one machine\'s private detail', () => {
  const files = trackedText();
  assert.ok(files.length > 100, 'the tracked tree was actually enumerated');
  const sink = new Map();
  for (const { file, body } of files) {
    const text = decode(body);
    if (text === null) continue;
    findings(file, text, sink);
  }
  const report = [...sink].map(([name, list]) => `${name}: ${list.map((h) => `${h.hit} in ${h.label}`).join(', ')}`);
  assert.deepEqual(report, [], report.join('\n'));
});

// The allowance replaced a whole-file exemption, which skipped every pattern at every revision and
// so hid anything real that was ever committed to one of those two paths. Keyed to one hit in one
// file, it can go stale instead: the fixture it names can be reworded or removed, and an allowance
// covering nothing is one nobody will notice is no longer needed.
test('every allowance still covers a hit that is really there, in a file that is really tracked', () => {
  assert.ok(ALLOWED.size > 0, 'the allowances are enumerated');
  const named = new Map(PATTERNS);
  const tracked = new Set(git(['-c', 'core.quotePath=false', 'ls-files', '-z']).split('\u0000').filter(Boolean));
  for (const [key, why] of ALLOWED) {
    const [file, pattern, hit] = key.split('|');
    assert.ok(why && why.length > 20, `${key} records why it is allowed`);
    assert.ok(tracked.has(file), `${file} is tracked, so the allowance still names something`);
    assert.ok(named.has(pattern), `${pattern} is a pattern the gate carries`);
    // ls-files describes the index, so read the same population. This also keeps a newly added,
    // already staged allowance testable before its first commit instead of requiring a red commit.
    const text = git(['show', `:${file}`]);
    const hits = new Set((text.match(named.get(pattern)) || []).map((h) => h.trim()));
    assert.ok(hits.has(hit), `${file} still contains the allowed hit for ${pattern}`);
  }
});

// The allowance is exact, so a second occurrence of an allowed shape in the same file is still a
// finding. That is the whole difference between this and the exemption it replaced.
test('an unplanned second occurrence of an allowed shape is still reported', () => {
  const key = [...ALLOWED.keys()].find((k) => k.split('|')[1] === 'a session or workspace identifier');
  assert.ok(key, 'the identifier fixture is allowed by name');
  const [file, pattern, hit] = key.split('|');
  // Assembled: the whole shape as one literal here would be a fourth hit in this file, which is
  // precisely the thing the assertion below says would fail.
  const different = '00000000-0000-4000-8000-0000000000' + '01';

  const allowed = new Map();
  findings(file, hit, allowed);
  assert.deepEqual([...allowed.keys()], [], 'the allowed hit is allowed in the file that carries it');

  const elsewhere = new Map();
  findings('some/other/file.js', hit, elsewhere);
  assert.deepEqual([...elsewhere.keys()], [pattern], 'the same hit in another file is a finding');

  const second = new Map();
  findings(file, different, second);
  assert.deepEqual([...second.keys()], [pattern], 'a different hit of the same shape in the same file is a finding');
});

const STORE_PUBLISHER_FILES = [
  'docs/MICROSOFT_STORE.md',
  'docs/MICROSOFT_STORE_SUBMISSION.md',
  'packaging/windows/Package.appxmanifest',
  'scripts/pack-msix.mjs',
  'scripts/run-wack.ps1',
  'test/msix-packaging.test.js',
];

test('the public Store publisher GUID is allowed only at its six intended identity sites', () => {
  const entries = [...ALLOWED.keys()]
    .map((key) => key.split('|'))
    .filter(([file, pattern]) => (
      STORE_PUBLISHER_FILES.includes(file)
      && pattern === 'a session or workspace identifier'
    ));
  assert.deepEqual(
    entries.map(([file]) => file).sort(),
    [...STORE_PUBLISHER_FILES].sort(),
    'each intended identity site needs one exact allowance',
  );

  const publisher = entries[0]?.[2];
  assert.ok(publisher, 'the public publisher identity is absent from the allowance map');
  for (const file of STORE_PUBLISHER_FILES) {
    const sink = new Map();
    findings(file, publisher, sink);
    assert.deepEqual([...sink.keys()], [], `${file} allows the exact publisher identity`);
  }

  const elsewhere = new Map();
  findings('some/other/file.js', publisher, elsewhere);
  assert.deepEqual(
    [...elsewhere.keys()],
    ['a session or workspace identifier'],
    'the same GUID remains private-shaped outside the intended files',
  );

  const arbitrary = '00000000-0000-4000-8000-0000000000' + '02';
  for (const file of STORE_PUBLISHER_FILES) {
    const sink = new Map();
    findings(file, arbitrary, sink);
    assert.deepEqual(
      [...sink.keys()],
      ['a session or workspace identifier'],
      `${file} does not allow another GUID`,
    );
  }
});

// PowerShell 5.1 is the shell this repository is developed in, and its `>` and `Set-Content` write
// UTF-16LE by default. Every second byte of such a file is NUL, so the gate discarded captured logs
// and transcripts as binary, which is the artifact class most likely to carry a path or a token.
test('text with a byte order mark is decoded rather than discarded as binary', () => {
  const secret = 'AKIA' + 'QRSTUVWX23456789';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`key = ${secret}`, 'utf16le')]);
  const beBody = Buffer.from(`key = ${secret}`, 'utf16le');
  beBody.swap16();
  const be = Buffer.concat([Buffer.from([0xfe, 0xff]), beBody]);

  assert.equal(decode(le), `key = ${secret}`, 'little endian is decoded');
  assert.equal(decode(be), `key = ${secret}`, 'big endian is decoded');
  assert.equal(decode(Buffer.from('plain text', 'utf8')), 'plain text', 'utf-8 is unchanged');
  assert.equal(decode(Buffer.from([0x89, 0x50, 0x00, 0x01])), null, 'a real binary is still skipped');

  const sink = new Map();
  findings('capture.log', decode(le), sink);
  assert.deepEqual([...sink.keys()], ['an AWS access key id'], 'and the decoded text is scanned');
});

// The gate degrades to reading the working tree when it has no history, and that degraded answer
// used to exit 0. Nothing in the pipeline pinned the full-depth checkout that keeps it out of that
// state, so dropping `fetch-depth: 0` in a merge would have left the step green and the summary
// unchanged. Every other decision here is pinned by a machine check; this one was pinned by a
// comment.
test('the workflow runs the publication gate in a job that checks out the full history', () => {
  const yml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  // Split on job headers, tolerating either line ending. Written once without the `\r?` it never
  // split at all, so the block searched below was the whole file and the assertion was true of any
  // workflow that mentioned both things anywhere. It still went red when the setting was deleted,
  // which is exactly how a vacuous check hides.
  const jobs = yml.split(/\r?\n(?= {2}[A-Za-z0-9_-]+:\r?\n)/);
  const owners = jobs.filter((block) => block.includes('npm run publication'));
  assert.equal(owners.length, 1, 'exactly one block runs the gate, which is also how we know the file was split into jobs');
  const owner = owners[0];
  assert.match(owner, /^ {2}[A-Za-z0-9_-]+:/, 'and that block starts at a job');
  assert.ok(owner.includes('actions/checkout'), 'that job checks the repository out');
  assert.match(owner, /fetch-depth:\s*0/, 'and it asks for the whole history, which the gate needs to answer at all');
});

// A shallow clone is the state the gate cannot answer from, so it is the state worth owning a test.
// Built rather than cloned from here: a depth-1 clone of this repository takes fifteen seconds, and
// a suite slow enough to notice is one somebody eventually stops running. Two commits and a depth of
// one is all "shallow" needs to mean.
// The population line is the sentence somebody would quote beside a claim that the history is
// clean, so anything left out of the scan has to be left in the sentence. Blobs over the size
// limit, blobs that decode to nothing and blobs git could not read were all dropped silently, and
// the count that was printed read as though they had been examined.
test('whatever the scan left out is named in the line that describes the scan', () => {
  assert.equal(excluded({ scanned: 10, large: 0, binary: 0, unreadable: 0 }), '', 'nothing left out, nothing said');
  assert.equal(excluded({ scanned: 10, large: 3, binary: 0, unreadable: 0 }), ', 3 skipped as 4 MB or larger');
  assert.equal(excluded({ scanned: 10, large: 0, binary: 12, unreadable: 0 }), ', 12 skipped as binary');
  assert.equal(excluded({ scanned: 10, large: 0, binary: 0, unreadable: 2 }), ', 2 git could not read');
  assert.equal(
    excluded({ scanned: 10, large: 3, binary: 12, unreadable: 2 }),
    ', 3 skipped as 4 MB or larger, 12 skipped as binary, 2 git could not read',
    'and all three together',
  );
});

test('the gate reports what it could not read rather than reporting it clean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mrt-shallow-'));
  const run = (args, cwd) => {
    const out = spawnSync('git', ['-c', 'user.email=gate@example.invalid', '-c', 'user.name=gate', ...args],
      { cwd, encoding: 'utf8' });
    assert.equal(out.status, 0, `git ${args.join(' ')}: ${out.stderr}`);
    return out;
  };
  try {
    const origin = join(dir, 'origin');
    mkdirSync(join(origin, 'scripts'), { recursive: true });
    run(['init', '--quiet', '-b', 'main', origin], dir);
    // The boundary half reads the working tree, so it holds on a shallow clone and must pass here.
    // Otherwise this would exit 1 for a reason that has nothing to do with the history.
    writeFileSync(join(origin, '.gitignore'), PROTECTED.map(([root]) => root).join('\n') + '\n');
    const protectedPaths = git(['-c', 'core.quotePath=false', 'ls-files', '-z', '.copilot-tracking', '.github/prompts'])
      .split('\u0000').filter(Boolean);
    for (const path of protectedPaths) {
      const target = join(origin, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, '');
    }
    for (let at = 0; at < protectedPaths.length; at += 50) {
      run(['add', '--force', '--', ...protectedPaths.slice(at, at + 50)], origin);
    }
    writeFileSync(join(origin, 'readme.md'), 'first\n');
    run(['add', '-A'], origin);
    run(['commit', '--quiet', '-m', 'first'], origin);
    writeFileSync(join(origin, 'readme.md'), 'second\n');
    run(['commit', '--quiet', '-a', '-m', 'second'], origin);

    const clone = join(dir, 'clone');
    run(['clone', '--quiet', '--depth', '1', pathToFileURL(origin).href, clone], dir);
    assert.equal(
      spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: clone, encoding: 'utf8' }).stdout.trim(),
      'true',
      'the clone really is shallow',
    );
    mkdirSync(join(clone, 'scripts'), { recursive: true });
    cpSync(fileURLToPath(new URL('../scripts/check-publication.mjs', import.meta.url)), join(clone, 'scripts', 'check-publication.mjs'));

    const shallow = spawnSync(process.execPath, ['scripts/check-publication.mjs'], { cwd: clone, encoding: 'utf8' });
    assert.equal(shallow.status, 2, `a shallow clone is unanswered, not clean:\n${shallow.stdout}${shallow.stderr}`);
    assert.match(shallow.stdout, /shallow/, 'and it says why');
    assert.match(shallow.stdout, /unanswered rather than as a pass/, 'in the words that stop it being read as a pass');

    // `--surface` used to sit before the shallow check and so could never reach it, which is the
    // one mode where a truncated scan reading as a complete one does the most damage.
    const surface = spawnSync(process.execPath, ['scripts/check-publication.mjs', '--surface'], { cwd: clone, encoding: 'utf8' });
    assert.equal(surface.status, 2, `--surface on a shallow clone is unanswered too:\n${surface.stdout}${surface.stderr}`);

    // `git ls-files` quotes any path outside plain ASCII unless told not to, and the quoted form is
    // not a path `git show` accepts. The read failed, the failure was swallowed, and the file was
    // reported as though it had been read and found clean.
    writeFileSync(join(clone, 'caf\u00e9.md'), 'key = ' + 'AKIA' + 'QRSTUVWX23456789' + '\n');
    run(['add', '-A'], clone);
    run(['commit', '--quiet', '-m', 'a path git would quote'], clone);
    const quoted = spawnSync(process.execPath, ['scripts/check-publication.mjs'], { cwd: clone, encoding: 'utf8' });
    assert.equal(quoted.status, 1, `a credential in a quoted path is a finding:\n${quoted.stdout}${quoted.stderr}`);
    assert.match(quoted.stdout, /an AWS access key id/, 'and it is named');

    // `--surface` describes its population as what the remote advertises, but reads the local cache
    // of the last fetch. A branch pushed since then was neither scanned nor mentioned.
    const full = join(dir, 'full');
    run(['clone', '--quiet', pathToFileURL(origin).href, full], dir);
    mkdirSync(join(full, 'scripts'), { recursive: true });
    cpSync(fileURLToPath(new URL('../scripts/check-publication.mjs', import.meta.url)), join(full, 'scripts', 'check-publication.mjs'));
    const fresh = spawnSync(process.execPath, ['scripts/check-publication.mjs', '--surface'], { cwd: full, encoding: 'utf8' });
    assert.equal(fresh.status, 0, `a current view of the remote answers:\n${fresh.stdout}${fresh.stderr}`);

    run(['branch', 'pushed-since-you-last-looked'], origin);
    const stale = spawnSync(process.execPath, ['scripts/check-publication.mjs', '--surface'], { cwd: full, encoding: 'utf8' });
    assert.equal(stale.status, 2, `a stale view of the remote is unanswered:\n${stale.stdout}${stale.stderr}`);
    assert.match(stale.stderr, /never fetched/, 'and it says which way it is out of date');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
