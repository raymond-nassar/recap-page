import test from 'node:test';
import assert from 'node:assert/strict';
import { isDocumentationOnly } from '../scripts/docs-only.mjs';

test('documentation markdown and its evidence lock are documentation-only', () => {
  assert.equal(isDocumentationOnly([
    'docs/UX_FEEDBACK.md',
    'docs/ux/landing-page-journey.md',
    'docs/anchors.lock.json',
    'README.md',
  ]), true);
});

test('application, data, workflow, and documentation asset changes keep expensive checks enabled', () => {
  for (const path of [
    'src/js/main.js',
    'src/data/curated-lists.json',
    '.github/workflows/ci.yml',
    'docs/ios-app-store-assets/manifest.json',
    'docs/screenshots/home-960.png',
    'docs/releases/4.4.0-store.json',
  ]) {
    assert.equal(isDocumentationOnly(['docs/UX_FEEDBACK.md', path]), false, path);
  }
});

test('project skill playbooks are documentation-only but executable skill resources are not', () => {
  assert.equal(isDocumentationOnly([
    '.github/skills/diagnose-ci/SKILL.md',
    '.github/skills/verify-ui-change/SKILL.md',
    'CONTRIBUTING.md',
    'docs/anchors.lock.json',
  ]), true);

  for (const path of [
    '.github/skills/diagnose-ci/run.mjs',
    '.github/skills/diagnose-ci/references/check.sh',
    '.github/skills/diagnose-ci/manifest.json',
    '.github/skills/diagnose-ci/nested/SKILL.md',
    '.github/skills/diagnose-ci/skill.md',
    '.github/skills/../workflows/SKILL.md',
    'scripts/docs-only.mjs',
    'test/docs-only.test.js',
  ]) {
    assert.equal(isDocumentationOnly(['.github/skills/diagnose-ci/SKILL.md', path]), false, path);
  }
});

test('an empty change list is never classified as documentation-only', () => {
  assert.equal(isDocumentationOnly([]), false);
});
