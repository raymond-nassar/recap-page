import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// A workflow step runs third-party code on a runner holding a token for this repository.
// `actions/checkout@v7` is not a version, it is a subscription: the tag is a pointer its owner
// can move, so the build agrees in advance to run whatever they publish next. Pinning a full
// commit revision is what turns that back into a decision someone made once and can be shown to
// have made.
//
// The three properties below are each cheap to lose in a one-line edit and invisible when lost,
// which is why they are held here rather than by the comments beside them.

// Every workflow the repository has, not the one this was written against. An enumeration is a
// list someone has to remember to extend, and a second workflow added later is exactly when the
// pinning discipline would lapse unnoticed. `git ls-files` is how the anchors gate enumerates for
// the same reason, and it inherits the same property: it sees tracked files only. That is right
// here, because a contributor's new workflow reaches CI tracked or not at all, but it means a
// local run cannot judge a file that has not been added yet.
//
// `.github/actions` is swept too, though nothing lives there yet. A composite action is a place
// `uses:` can be written that is not a workflow, so leaving it out would make the enumeration the
// very thing the paragraph above says not to build.
function trackedYaml(...dirs) {
  const out = execFileSync('git', ['ls-files', ...dirs], { encoding: 'utf8' });
  return out.split(/\r?\n/).filter((line) => /\.ya?ml$/.test(line));
}

const workflowPaths = trackedYaml('.github/workflows');
const files = trackedYaml('.github/workflows', '.github/actions')
  .map((path) => ({ path, text: readFileSync(path, 'utf8') }));

// `uses:` in either position: a step opener or a key on its own line. `-\s+` rather than the
// literal `"- "`, because `-   uses:` is valid YAML that Actions runs and a single space is not
// something the format requires. Reading it as a fixed string made every check below blind to a
// step written that way, which is the failure mode a checker can least afford.
function usesLines(text) {
  return text.split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /^\s*(-\s+)?uses\s*:/.test(line));
}

// Steps, not lines. A step's keys can be written in any order, so `uses:` is as often the second
// key under a `- name:` opener as it is the opener itself. Anything that recognises a step by the
// shape of its first line therefore sees some steps and not others, which is worse than seeing
// none: the count is non-zero, so a guard on the count still passes.
function steps(text) {
  const lines = text.split(/\r?\n/);
  const found = [];
  lines.forEach((line, index) => {
    const opener = /^(\s*)-\s/.exec(line);
    if (!opener) return;
    const indent = opener[1].length;
    const body = [line];
    for (let i = index + 1; i < lines.length; i += 1) {
      const next = lines[i];
      // Blank lines and comments sit inside a step body legitimately, so neither ends it.
      if (next.trim() === '') continue;
      if (/^(\s*)/.exec(next)[1].length <= indent) break;
      body.push(next);
    }
    found.push({ number: index + 1, text: body.join('\n') });
  });
  return found;
}

test('the repository has workflows to check, so a rename cannot empty this file silently', () => {
  assert.ok(workflowPaths.length > 0, 'git ls-files found at least one workflow');
  const total = files.reduce((sum, f) => sum + usesLines(f.text).length, 0);
  assert.ok(total > 0, `the workflows call at least one action, found ${total}`);
});

test('every action is pinned to a full commit revision, never a tag or a branch', () => {
  for (const { path, text } of files) {
    for (const { line, number } of usesLines(text)) {
      const ref = /uses\s*:\s*(\S+)/.exec(line)[1];
      // A path into this repository is not a third-party pin; it moves when this repository does.
      if (ref.startsWith('./') || ref.startsWith('.\\')) continue;
      // A container image is pinned by digest, not by revision, and `alpine:3.19` is a moving tag
      // in exactly the way `@v7` is. Reading it by the same rule got this backwards both ways:
      // the mutable form has no `@` so it was skipped, and the correctly pinned form has one but
      // is 64 hex, so it was the only container reference the check could fail.
      if (ref.startsWith('docker://')) {
        assert.match(
          ref,
          /@sha256:[0-9a-f]{64}$/,
          `${path} line ${number} runs ${ref}, a container image named by tag rather than by `
          + 'digest. A tag on a registry is a pointer its publisher can move, exactly as an '
          + 'action tag is',
        );
        continue;
      }
      assert.ok(
        ref.includes('@'),
        `${path} line ${number} calls ${ref} with no reference at all, so it runs whatever the `
        + 'default branch holds at the moment CI starts',
      );
      const after = ref.slice(ref.indexOf('@') + 1);
      assert.match(
        after,
        /^[0-9a-f]{40}$/,
        `${path} line ${number} calls ${ref}, whose reference "${after}" is not a 40-character `
        + 'commit revision. A tag or branch is a pointer its owner can move after review',
      );
    }
  }
});

test('every pinned revision carries a readable version comment, so the pin is reviewable', () => {
  for (const { path, text } of files) {
    for (const { line, number } of usesLines(text)) {
      if (!/@[0-9a-f]{40}/.test(line)) continue;
      assert.match(
        line,
        /@[0-9a-f]{40}\s+# v\d+\.\d+\.\d+$/,
        `${path} line ${number} pins a revision with no trailing "# vX.Y.Z" comment. Without it `
        + 'nobody can tell what was pinned, and Dependabot has nothing to rewrite when it bumps it',
      );
    }
  }
});

test('no checkout leaves its token behind in the git config', () => {
  const checkouts = [];
  for (const { path, text } of files) {
    for (const { number, text: body } of steps(text)) {
      if (!/uses\s*:\s*actions\/checkout@/.test(body)) continue;
      checkouts.push({ path, number, body });
    }
  }

  assert.ok(checkouts.length > 0, 'at least one checkout step was found to check');
  for (const { path, number, body } of checkouts) {
    assert.match(
      body,
      /persist-credentials\s*:\s*false/,
      `the checkout at ${path} line ${number} does not set persist-credentials: false, so its `
      + 'token is written into the git config where every later step can read it',
    );
  }
});

// `npm i` is the alias people actually type, and it runs lifecycle scripts exactly as `npm
// install` does. Reading only the two long spellings left the boundary one character wide.
test('no install step runs the dependency graph lifecycle scripts', () => {
  const installs = [];
  for (const { path, text } of files) {
    text.split(/\r?\n/).forEach((line, index) => {
      if (/\bnpm\s+(ci|i|install|add)\b/.test(line)) installs.push({ path, number: index + 1, line });
    });
  }

  assert.ok(installs.length > 0, 'at least one install command was found to check');
  for (const { path, number, line } of installs) {
    assert.match(
      line,
      /--ignore-scripts/,
      `${path} line ${number} installs without --ignore-scripts. A manifest is contributor `
      + 'editable, so an install script is arbitrary code a pull request can run before review',
    );
  }
});

test('CI installs do not wait for npm registry audit requests', () => {
  const ci = files.find(({ path }) => path === '.github/workflows/ci.yml');
  const installs = ci.text.split(/\r?\n/).filter((line) => /\bnpm ci\b/.test(line));

  assert.ok(installs.length > 0, 'the CI workflow has npm ci commands');
  for (const line of installs) {
    assert.match(line, /--no-audit/, 'CI dependency installation must not wait for npm audit');
  }
});

// The flag above is only worth having if nothing undoes it afterwards. `npm rebuild` re-runs the
// scripts the install skipped, and `npx` fetches and executes a package outright, so either one
// reopens the boundary while every other check here stays green. Neither is forbidden anywhere
// else in the repository: this is a rule about a runner that holds a token, not about tooling.
test('nothing runs package code the install step was told to skip', () => {
  for (const { path, text } of files) {
    text.split(/\r?\n/).forEach((line, index) => {
      assert.doesNotMatch(
        line,
        /\bnpm\s+rebuild\b/,
        `${path} line ${index + 1} runs npm rebuild, which runs the very lifecycle scripts the `
        + 'install step skipped',
      );
      assert.doesNotMatch(
        line,
        /\bnpx\b/,
        `${path} line ${index + 1} runs npx, which fetches and executes a package on a runner `
        + 'holding a token for this repository. If one is ever needed it wants the same review a '
        + 'pinned action gets, rather than arriving as an ordinary run: line',
      );
    });
  }
});

// The claim in the workflow's own comment, which is the one thing here a reader is asked to take
// on trust. Measured at the time of pinning: 0 of 90. If a package with an install script ever
// enters the lockfile this turns red, which is the moment the decision above needs revisiting
// rather than a moment to discover it silently stopped being free.
test('the locked graph declares no install scripts, which is what makes ignoring them free', () => {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  // The lockfile keys its own root as "", which is this project rather than a locked package.
  // Counting it made every stated figure one too many.
  const packages = Object.entries(lock.packages ?? {}).filter(([name]) => name !== '');
  assert.ok(packages.length > 0, 'the lockfile lists packages');
  const withScripts = packages.filter(([, meta]) => meta.hasInstallScript).map(([name]) => name);
  assert.deepEqual(
    withScripts,
    [],
    `${withScripts.length} of ${packages.length} locked packages declare an install script `
    + `(${withScripts.join(', ')}). Ignoring scripts now changes what gets installed, so the `
    + 'workflow comment claiming it costs nothing is no longer true and the tooling needs a look',
  );
});
