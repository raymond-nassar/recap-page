import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AXE_ROUTES, AXE_SHA256, AXE_TAGS, AXE_THEMES, AXE_VERSION,
  axeCandidates, axeCell, axeMarkdown, axeOutput, axeReadingState, loadAxe,
} from '../scripts/browser-axe.mjs';
import { parseRoute } from '../src/js/lib/route.js';

// #832 item 2 (UX-34). The rules pass is evidence rather than a gate, so what has to hold is that
// the evidence is what it says: the fixed routes and themes it claims, the pinned axe build and no
// other, and a report that says, by route and theme, what was found.

const root = fileURLToPath(new URL('../', import.meta.url));
const html = readFileSync(join(root, 'src', 'index.html'), 'utf8');

test('the pass covers a fixed list of the app\'s screens in light, dark and forced colors', () => {
  assert.deepEqual(AXE_THEMES.map((theme) => theme.id), ['light', 'dark', 'forced']);
  const forced = (theme) => theme.media.find((feature) => feature.name === 'forced-colors')?.value;
  assert.deepEqual(AXE_THEMES.map(forced), ['none', 'none', 'active']);
  assert.equal(new Set(AXE_ROUTES.map((route) => route.id)).size, AXE_ROUTES.length, 'route ids are unique');
  assert.deepEqual(AXE_ROUTES.filter((route) => !route.seeded).map((route) => route.id), ['home-first-run']);
  for (const route of AXE_ROUTES) {
    assert.equal(parseRoute(route.hash)?.view, route.view, `${route.id} is an address the app routes to ${route.view}`);
    assert.match(html, new RegExp(`id="view-${route.view}"`), `${route.id} names a screen the app has`);
    const anchor = /^#([\w-]+)/.exec(route.ready)?.[1];
    assert.ok(anchor && html.includes(`id="${anchor}"`), `${route.id} waits for an element the page has, ${route.ready}`);
  }
  assert.deepEqual(AXE_TAGS, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
});

test('the seeded routes open a real Reading List with some of it read', () => {
  const state = axeReadingState();
  const list = state.lists['house-of-m'];
  assert.equal(list.itemIds.length, 20);
  assert.equal(list.itemIds.filter((id) => state.read[id]).length, 3);
});

test('axe is looked for beside the browser driver, or only where it is named', () => {
  const scratch = resolve('/scratch');
  const driver = join(scratch, 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js');
  assert.deepEqual(axeCandidates({ driver }), [join(scratch, 'node_modules', 'axe-core', 'axe.min.js')]);
  const file = resolve('/elsewhere/axe.min.js');
  assert.deepEqual(axeCandidates({ explicit: file, driver }), [file]);
  const directory = resolve('/elsewhere');
  assert.deepEqual(axeCandidates({ explicit: directory, driver }), [
    join(directory, 'axe.min.js'), join(directory, 'node_modules', 'axe-core', 'axe.min.js'),
  ]);
  assert.deepEqual(axeCandidates({}), []);
});

test('an axe file that does not match the pin is refused, and only the pinned bytes are read', (t) => {
  assert.match(AXE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(AXE_SHA256, /^[0-9a-f]{64}$/);
  const dir = mkdtempSync(join(tmpdir(), 'recap-axe-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'axe.min.js');
  writeFileSync(file, 'window.axe = { version: "0.0.0" };');
  const refused = loadAxe([file]);
  assert.equal(refused.problem, 'mismatch');
  assert.equal(refused.sha256, createHash('sha256').update(readFileSync(file)).digest('hex'));
  assert.equal('source' in refused, false, 'a refused file is never returned to inject');
  const accepted = loadAxe([join(dir, 'absent.js'), file], refused.sha256);
  assert.equal(accepted.path, file);
  assert.equal(accepted.source, 'window.axe = { version: "0.0.0" };');
  assert.deepEqual(loadAxe([join(dir, 'absent.js')]), { problem: 'missing', tried: [join(dir, 'absent.js')] });
});

test('evidence goes outside the repository and never over an earlier report', (t) => {
  assert.equal(axeOutput(root, root).problem, 'inside');
  assert.equal(axeOutput(join(root, 'evidence'), root).problem, 'inside');
  const dir = mkdtempSync(join(tmpdir(), 'recap-axe-out-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(axeOutput(dir, root), { path: dir });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'axe-report.json'), '{}');
  assert.equal(axeOutput(dir, root).problem, 'exists');
});

test('the summary reports every route by theme and lists each finding where it was found', () => {
  const rule = (id, nodes, help = `${id} help`) => ({ id, impact: 'serious', help, nodes: Array.from({ length: nodes }, (_, i) => ({ target: `#n${i}` })) });
  const report = {
    axeVersion: AXE_VERSION, axeSha256: AXE_SHA256, tags: AXE_TAGS,
    revision: { commit: 'abc123', dirty: false }, viewport: { width: 1280, height: 900 },
    routes: [{ id: 'home', label: 'Home' }, { id: 'read', label: 'Reading List' }],
    themes: [{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }, { id: 'forced', label: 'Forced colors' }],
    runs: [
      { route: 'home', theme: 'light', violations: [rule('label-content-name-mismatch', 2, 'a | b')], incomplete: [] },
      { route: 'home', theme: 'dark', violations: [], incomplete: [rule('color-contrast', 3)] },
      { route: 'home', theme: 'forced', error: 'the app moved' },
      { route: 'read', theme: 'light', violations: [], incomplete: [] },
      { route: 'read', theme: 'dark', violations: [rule('label-content-name-mismatch', 1, 'a | b')], incomplete: [] },
      { route: 'read', theme: 'forced', violations: [rule('aria-valid-attr', 1, 'ends in \\')], incomplete: [] },
    ],
  };
  const markdown = axeMarkdown(report);
  assert.match(markdown, /^\| Route \| Light \| Dark \| Forced colors \|$/m);
  assert.match(markdown, /^\| Home \(`home`\) \| 1 \(2\) \| 0, review 1 \(3\) \| failed to run \|$/m);
  assert.match(markdown, /^\| Reading List \(`read`\) \| 0 \| 1 \(1\) \| 1 \(1\) \|$/m);
  assert.match(markdown, /^\| `label-content-name-mismatch` \| serious \| home light \(2\); read dark \(1\) \| a \\\| b \|$/m);
  // A backslash at the end of a cell would otherwise escape the bar that closes it.
  assert.match(markdown, /^\| `aria-valid-attr` \| serious \| read forced \(1\) \| ends in \\\\ \|$/m);
  assert.match(markdown, /#### For review\n\n\| Rule .*\n.*\n\| `color-contrast` \| serious \| home dark \(3\) \|/);
  assert.match(markdown, /#### Runs that produced no evidence\n\n- home forced: the app moved/);
  assert.match(markdown, /Recorded, not gated\./);
  assert.equal(axeCell({ violations: [], incomplete: [] }), '0');
  assert.equal(axeCell(undefined), 'not run');
});

test('neither axe-core nor the browser driver is a dependency of this repository', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of ['axe-core', 'puppeteer-core']) assert.equal(name in (pkg[field] ?? {}), false, `${name} in ${field}`);
  }
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const locked = Object.keys(lock.packages ?? {}).filter((path) => /(^|\/)node_modules\/(axe-core|puppeteer-core)$/.test(path));
  assert.deepEqual(locked, []);
});
