import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NODE_VERSION, NODE_ARCH, PAYLOAD_NAME, appFiles, readMe, readMeFor } from '../scripts/pack-windows.mjs';

// The packaging contract, checked here because the person it is for cannot diagnose it.
//
// Everything below is a way the archive has of being wrong on a stranger's machine while looking
// perfectly well on this one. A runtime copied from the build machine runs for the author and
// fails for nearly everyone else; a launcher that prefers PATH ignores the runtime it shipped
// with; a licence summarised instead of carried under-attributes 47 components; and a build output
// that is committable is a 34 MiB binary one push away from the history.
//
// The reader of this archive has no terminal, no Node and no way to read an error. So the checks
// are here instead.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACK = 'scripts/pack-windows.mjs';
const WINDOWS = 'Start on Windows.cmd';

const read = (name) => readFileSync(join(ROOT, name), 'utf8');
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

// Same stripping the launcher tests use: both files carry more comment than code, and a comment
// naming a command reads to a plain search as the command itself.
const codeOf = (name) => read(name)
  .split(/\r?\n/)
  .filter((line) => !/^\s*(rem\b|#|::)/i.test(line))
  .join('\n');

test('the packaging script is tracked and reachable by name', () => {
  assert.ok(git(['ls-files']).split(/\r?\n/).includes(PACK), `${PACK} is not tracked`);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.pack, 'node scripts/pack-windows.mjs');
});

// The trap this repository is most exposed to, because it cannot be seen from here. This machine
// is ARM64. An archive built from its own binary would pass every check on it and fail on the x64
// machines nearly all readers have, and the only person able to diagnose that is the one person
// who cannot reproduce it.
test('the runtime is fetched for x64 rather than copied from the build machine', () => {
  const source = read(PACK);
  assert.equal(NODE_ARCH, 'win-x64');
  assert.doesNotMatch(source, /process\.execPath/, 'the build machine\'s own runtime is being copied');
  assert.doesNotMatch(source, /process\.arch/, 'the archive is being built for whatever arch built it');
  assert.match(source, /https:\/\/nodejs\.org\/dist\//, 'the runtime is not fetched from nodejs.org');
});

// The version claim in the script says the matrix picks it, not the engines floor. That is a claim
// this repository can check, so it does. A future bump to a line CI never runs would ship the
// reader a runtime the suite has never passed on.
test('the bundled runtime is a line the test suite actually runs on', () => {
  const major = NODE_VERSION.match(/^v(\d+)\./)?.[1];
  assert.ok(major, `${NODE_VERSION} is not a version this can read`);

  const workflow = read('.github/workflows/ci.yml');
  const matrix = workflow.match(/node:\s*\[([^\]]+)\]/)?.[1];
  assert.ok(matrix, 'the CI matrix is not in the shape this test reads');

  const tested = matrix.split(',').map((entry) => entry.trim().replace(/'/g, ''));
  assert.ok(
    tested.includes(major),
    `the archive bundles Node ${major}, which CI does not test. CI runs ${tested.join(' and ')}.`,
  );

  const floor = JSON.parse(read('package.json')).engines.node;
  assert.ok(Number(major) >= Number(floor.replace(/[^\d]/g, '')), `Node ${major} is below the declared floor ${floor}`);
});

// Not "MIT". The runtime's own grant is MIT, but the file travelling with the distribution names 47
// bundled components, OpenSSL and V8 and ICU among them, each with its own attribution terms.
test('the whole runtime licence travels with the runtime', () => {
  const source = read(PACK);
  assert.match(source, /copyFile\(\s*join\(unpacked, 'LICENSE'\)/, 'the runtime licence is not copied from the distribution');
  assert.match(source, /LICENSE-node\.txt/, 'the runtime licence has no name in the archive');
  assert.doesNotMatch(source, /writeFile\([^)]*['"`]MIT['"`]/, 'a licence summary is being written instead of the file');
});

// Constraint 1 and Constraint 3 in delivery form: the archive is the app, not a copy of the
// project's working papers, and it carries our licence beside the runtime's.
test('the archive holds what the app runs and the licences, derived from git rather than a list', () => {
  const files = appFiles();
  assert.equal(PAYLOAD_NAME, 'recap-page');
  assert.equal(readMe.split(/\r?\n/)[0], 'Recap Page');
  assert.ok(files.includes('server.mjs'), 'the server is missing');
  assert.ok(files.includes(WINDOWS), 'the launcher is missing');
  assert.ok(files.includes('LICENSE'), 'this project\'s own licence is missing');
  assert.ok(files.filter((path) => path.startsWith('src/')).length > 50, 'the app itself is missing');
  assert.ok(files.includes('src/icons/icon.svg'), 'the shared SVG icon is missing');

  for (const unwanted of ['test/', 'scripts/', 'docs/', '.github/', 'design/']) {
    assert.deepEqual(
      files.filter((path) => path.startsWith(unwanted)),
      [],
      `${unwanted} is in the archive, which is the project's working papers rather than the app`,
    );
  }
  assert.ok(!files.includes('PRODUCT_BACKLOG.md'), 'the backlog is in the archive');
});

// The read-me's privacy sentence is true of the build it ships in, as the app's own is (#810, P02-T06): an
// archive given a cloud client configuration has cloud backup and says what that sends and where, and one
// without says exactly what it said before cloud backup existed.
test('the read-me promises what the archive it ships in does', () => {
  const words = (text) => text.replace(/\s+/g, ' ');
  const without = readMeFor();
  const withCloud = readMeFor({ cloudBackup: true });
  assert.equal(without, readMe, 'the default is the archive without cloud backup');
  assert.match(words(without), /Nothing is uploaded anywhere and no account is needed\./);
  assert.doesNotMatch(words(without), /cloud backup/i);
  assert.match(words(withCloud), /No Recap Page account is needed, and what you save is uploaded only if you turn on cloud backup, and then only to your own OneDrive\./);
  assert.doesNotMatch(words(withCloud), /Nothing is uploaded anywhere/);
  const widest = Math.max(...without.split('\r\n').map((line) => line.length));
  assert.ok(withCloud.split('\r\n').every((line) => line.length <= widest), 'no line wider than the rest of the read-me');
  assert.match(read(PACK), /readMeFor\(\{ cloudBackup: cloudClient !== null \}\)/, 'the archive gets the variant its configuration decides');
});

// The launcher is the one file in the archive the reader touches, and the bundled runtime is the
// whole point of the archive. Preferring PATH would hand a reader with an old or broken Node the
// failure the archive exists to remove, and they are the least equipped person to work out why.
test('the launcher prefers the runtime beside it over whatever is on PATH', () => {
  const code = codeOf(WINDOWS);
  const bundled = code.indexOf('runtime\\node.exe');
  const path = code.indexOf('where node');

  assert.ok(bundled > -1, 'the launcher never looks for a bundled runtime');
  assert.ok(path > -1, 'the launcher no longer falls back to PATH, so a clone cannot start');
  assert.ok(bundled < path, 'the launcher checks PATH before the runtime it shipped with');
  assert.match(code, /"%~dp0runtime\\node\.exe" server\.mjs/, 'the bundled runtime is found but never used to start the server');
});

// The archive is near 34 MiB. Committing one is a thing that happens once and is in the history
// for good, and a build output that only the person who ran it can see is the easiest possible
// version of that mistake.
test('the build output cannot be committed by accident', () => {
  assert.match(read('.gitignore'), /^dist\/$/m, 'dist/ is not ignored, so a 34 MiB archive is one add away from the history');
  assert.deepEqual(
    git(['ls-files', '--', 'dist']).split(/\r?\n/).filter(Boolean),
    [],
    'a build output is already tracked',
  );
  assert.deepEqual(
    git(['ls-files', '--', '*.exe']).split(/\r?\n/).filter(Boolean),
    [],
    'a runtime binary is tracked, which is not what this project ships',
  );
});

// Constraint 5, in the one place it is newly reachable. The archive is a second way in, and a
// second way in that lands on a different address is a second empty app.
test('nothing about the archive moves the address the app opens on', () => {
  const source = read(PACK);
  assert.doesNotMatch(source, /MRT_PORT/, 'the packaging script sets a port');
  assert.doesNotMatch(source, /localhost/i, 'the packaging script names localhost, which is a separate bucket');
  assert.doesNotMatch(codeOf(WINDOWS), /\b\d{4,5}\b/, 'the launcher gained a port number');
});
