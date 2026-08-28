import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../src/js/lib/version.js';

// The app has no build step, so the version the UI shows is a hand-written constant in
// src/js/lib/version.js while the version npm and any release tag use lives in
// package.json. Nothing mechanical keeps those two honest, and a build that reports a
// number it is not makes every bug report against it misleading. These tests are that
// mechanism: they run in CI, so the pair cannot drift silently.

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

test('the version the UI reports matches package.json', () => {
  assert.equal(APP_VERSION, pkg.version);
});

test('the version is a plain three-part semantic version', () => {
  // Not a general semver check. The release process tags `v<version>` and the About view
  // prints the string raw, so anything with a pre-release or build suffix would need both
  // of those looked at again first.
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
});

test('the changelog defines MAJOR as a product generation as well as a compatibility boundary', () => {
  const policy = changelog.slice(0, changelog.indexOf('## Unreleased'));
  assert.match(policy, /MAJOR[^.]*distinct product generation/i);
  assert.match(policy, /saved-data change[^.]*also requires a MAJOR/i);
});

test('the 2.0 release records compatibility with data saved by 1.4', () => {
  const start = changelog.indexOf('## 2.0.0');
  const end = changelog.indexOf('## 1.4.0');
  assert.notEqual(start, -1, 'the changelog must carry the 2.0.0 release');
  assert.ok(end > start, 'the 2.0.0 release must precede 1.4.0');
  assert.match(
    changelog.slice(start, end),
    /saved data from version 1\.4\.0 remains fully compatible with 2\.0\.0/i,
  );
});
