import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The npm manifest has no browser runtime dependencies, even though the Android app has an
// owner-approved Play services exception. A package used from src/ would make the browser claim
// untrue while leaving the other repository gates green.

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Collapsed, because the policy is hard-wrapped and every sentence worth asserting on spans a
// line break. Matching the raw text passes only for phrases that happen not to wrap, which is a
// check whose result depends on where the paragraph was reflowed.
const policy = readFileSync(new URL('../SECURITY.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');

test('the browser app ships no runtime dependencies, which is what the security policy scopes on', () => {
  // Checked as "no names" rather than "no key", because an empty object is how npm leaves the
  // field after the last dependency is removed and is not itself a problem.
  const names = Object.keys(pkg.dependencies ?? {});
  assert.deepEqual(names, [], `runtime dependencies present: ${names.join(', ')}`);
  assert.deepEqual(Object.keys(pkg.peerDependencies ?? {}), []);
  assert.deepEqual(Object.keys(pkg.optionalDependencies ?? {}), []);
});

test('the security policy distinguishes browser dependencies from the Android exception', () => {
  // The test above would keep passing on its own if the sentence were deleted, and then it would
  // be guarding a promise nobody had made. This is the half that fails in that direction.
  assert.match(policy, /The browser app has no runtime dependencies/);
  assert.match(policy, /Android app includes Google Play services auth and its transitive libraries/);
});

test('the packages the policy calls lint tooling are all it declares', () => {
  // The policy says "the four packages". A fifth added later would make that sentence wrong in
  // a document whose whole value is that a reporter can trust it. It was three until ESLint 10
  // stopped bundling its own recommended rule set, which is a package appearing without anything
  // new being wanted, and so is exactly the drift this asserts on.
  const dev = Object.keys(pkg.devDependencies ?? {});
  assert.equal(dev.length, 4, `devDependencies are now ${dev.length}: ${dev.join(', ')}`);
  assert.match(policy, /the four packages listed at/);
});

test('security fixes target the default branch and latest release without backports', () => {
  assert.match(policy, /default branch and the latest published release/);
  assert.match(policy, /fixes are not backported/);
});
