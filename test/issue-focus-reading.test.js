import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(join(ROOT, 'src/js/main.js'), 'utf8');

test('full-order title and cover reuse the shared issue-focus route while Read stays separate', () => {
  const rows = main.slice(main.indexOf('function renderRows'), main.indexOf('function openInReader'));
  assert.match(rows, /issueFocusAnchor\(item, \{\s*context: \{ kind: 'list', id \},\s*surface: 'full-order',\s*control: 'cover'/);
  assert.match(rows, /issueFocusAnchor\(item, \{\s*context: \{ kind: 'list', id \},\s*surface: 'full-order',\s*control: 'title'/);
  assert.match(rows, /className: 'thumb row-focus-cover',\s*tabIndex: '-1'/);
  assert.match(rows, /tabIndex: '-1', ariaLabel: `Inspect \$\{item\.title\}`/);
  assert.match(rows, /className: 'rt row-focus-title'/);
  assert.match(rows, /data-act: 'open'|act: 'open'/);
  assert.match(rows, /openInReader\(item, e\)/);
});

test('the issue-focus opener stores only stable source identity', () => {
  const navigate = main.slice(main.indexOf('function openIssueFocus'), main.indexOf('function issueFocusAnchor'));
  assert.match(navigate, /history\.replaceState\(\{ \.\.\.current, issueFocusOpener: opener \}/);
  assert.doesNotMatch(navigate, /localStorage|store\.update/);
  const anchor = main.slice(main.indexOf('function issueFocusAnchor'), main.indexOf('function emptyAction'));
  for (const field of ['view', 'surface', 'control', 'issueId', 'contextId']) {
    assert.match(anchor, new RegExp(`\\b${field}\\b`), `missing opener field ${field}`);
  }
});

test('Back restores exact full-order focus and uses the accepted fallback order', () => {
  const restore = main.slice(
    main.indexOf('async function restoreIssueFocusOpener'),
    main.indexOf('function loadBundledOrder'),
  );
  const exact = restore.indexOf('target.focus({ preventScroll: true })');
  const checked = restore.indexOf("document.querySelectorAll('input[name=\"filter\"]')");
  const summary = restore.indexOf("$('#full').querySelector('summary')");
  const heading = restore.indexOf('focusViewHeading(view)');
  assert.ok(exact >= 0 && exact < checked, 'exact source is not the first return target');
  assert.ok(checked < summary, 'the checked filter is not before the summary fallback');
  assert.ok(summary < heading, 'the summary is not before the view-heading fallback');
  assert.match(restore, /\$\('#full'\)\.open = true;\s*renderRows\(\);/);
  assert.match(restore, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(restore, /localStorage|DOMNode|HTMLElement/);
});

test('issue inspection does not mutate reading progress', () => {
  const navigate = main.slice(main.indexOf('function openIssueFocus'), main.indexOf('function issueFocusAnchor'));
  assert.doesNotMatch(navigate, /markRead|toggleRead|setActive|store\.update/);
});
