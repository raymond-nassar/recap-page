import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderAppDemo } from '../scripts/lib/pages-demo.mjs';

test('the homepage embeds the real app in a scripts-only sandbox, not a recreated readout', async () => {
  const html = await readFile(new URL('../pages/index.html', import.meta.url), 'utf8');
  assert.match(html, /<iframe[^>]+title="Recap Page guided app demo"[^>]+sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /data-tour-(?:cover|issue|progress)/);
});

test('the demo ships the real app graph, sample source data and a no-network policy', async () => {
  const demo = await renderAppDemo(fileURLToPath(new URL('..', import.meta.url)));
  const map = JSON.parse(demo.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  for (const entry of ['main.js', 'views/reading.js', 'storage.js', 'lib/model.js']) {
    const encoded = map[`https://recap.invalid/js/${entry}`];
    assert.ok(encoded, `the tour must ship the app's ${entry}, not a mock controller`);
    const bundled = Buffer.from(encoded.split(',')[1], 'base64').toString('utf8');
    const original = await readFile(new URL(`../src/js/${entry}`, import.meta.url), 'utf8');
    const imports = /^import\s+(?:[^;'"]+?\s+from\s+)?['"][^'"]+['"];/gm;
    assert.equal(
      bundled.replace(imports, '').replaceAll('"https://recap.invalid/js/main.js"', 'import.meta.url'),
      original.replace(imports, ''),
    );
  }
  for (const [url, encoded] of Object.entries(map)) {
    const code = Buffer.from(encoded.split(',')[1], 'base64').toString('utf8');
    for (const match of code.matchAll(/^import\s+(?:[^;'"]+?\s+from\s+)?['"]([^'"]+)['"];/gm)) {
      assert.ok(map[match[1]], `${url} has an unresolved import: ${match[1]}`);
    }
  }
  assert.match(demo, /connect-src 'none'/);
  assert.doesNotMatch(demo, /<link[^>]+rel="manifest"|src="\.\/js\/app.js"/);
  assert.match(demo, /<aside id="demo-guide"/);
  assert.match(demo, /<section id="view-read"/);
  assert.match(demo, /id="btn-hero-done"/);
  assert.match(demo, /<style>[\s\S]+--t-body:/);
});
