import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The security policy's scope rests on one fact about this repository: nothing in package.json
// reaches the browser, so a report about a dependency is a report about the lint tooling and CI
// rather than about anything a reader runs. That is Repository Constraint 4, it has been true
// since the first commit, and until now nothing checked it. A single `npm i` of a package used
// from src/ would make the policy untrue in the part a reporter reads first, and would do it
// silently, because every other gate in this repository would stay green.

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Collapsed, because the policy is hard-wrapped and every sentence worth asserting on spans a
// line break. Matching the raw text passes only for phrases that happen not to wrap, which is a
// check whose result depends on where the paragraph was reflowed.
const policy = readFileSync(new URL('../SECURITY.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');

test('the app ships no runtime dependencies, which is what the security policy scopes on', () => {
  // Checked as "no names" rather than "no key", because an empty object is how npm leaves the
  // field after the last dependency is removed and is not itself a problem.
  const names = Object.keys(pkg.dependencies ?? {});
  assert.deepEqual(names, [], `runtime dependencies present: ${names.join(', ')}`);
  assert.deepEqual(Object.keys(pkg.peerDependencies ?? {}), []);
  assert.deepEqual(Object.keys(pkg.optionalDependencies ?? {}), []);
});

test('the security policy still says so, so the check and the claim cannot part company', () => {
  // The test above would keep passing on its own if the sentence were deleted, and then it would
  // be guarding a promise nobody had made. This is the half that fails in that direction.
  assert.match(policy, /no runtime dependencies/);
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
