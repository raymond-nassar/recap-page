import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function writeFixture(rootPath) {
  cpSync(path.join(root, 'scripts'), path.join(rootPath, 'scripts'), { recursive: true });
  cpSync(path.join(root, 'src', 'js'), path.join(rootPath, 'src', 'js'), { recursive: true });
  writeFileSync(path.join(rootPath, 'package.json'), '{"type":"module"}\n');
  const data = path.join(rootPath, 'src', 'data');
  const orders = path.join(data, 'orders');
  mkdirSync(orders, { recursive: true });
  writeFileSync(path.join(data, 'curated-lists.json'), JSON.stringify({
    lists: [{
      id: 'atomic-order',
      name: 'Atomic Order',
      description: 'A fixture reading order.',
      type: 'event',
      depth: 'complete',
      beginner: false,
      group: null,
      groupName: null,
      variant: null,
      sourceFile: 'atomic-order.md',
      sourcePage: 'https://example.test/atomic-order',
      sourceOrigin: 'Fixture source',
      sourceLicense: null,
      out: 'atomic_order.json',
      characters: [],
      keywords: [],
      expect: 1,
      timeline: 2026,
      coverIssueId: 2,
    }],
  }, null, 2));
  writeFileSync(path.join(orders, 'atomic-order.md'), '- [ ] [Atomic Order #1](https://www.marvel.com/comics/issue/1/atomic_order_1)\n');
  writeFileSync(path.join(data, 'atomic_order.json'), '{"sentinel":"existing payload"}\n');
  writeFileSync(path.join(data, 'catalog.json'), '{"sentinel":"existing catalog"}\n');
  const hook = path.join(rootPath, 'fetch-hook.mjs');
  writeFileSync(hook, `globalThis.fetch = async () => new Response(JSON.stringify({
    id: 1, title: 'Atomic Order #1', detailUrl: 'https://www.marvel.com/comics/issue/1/atomic_order_1',
    seriesId: 1, seriesName: 'Atomic Order', cover: { path: 'https://example.test/cover', extension: 'jpg' },
  }), { status: 200, headers: { 'content-type': 'application/json' } });\n`);
  return hook;
}

test('an invalid configured cover leaves both final vendor outputs unchanged', (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'mrt-vendor-atomic-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const hook = writeFixture(fixture);
  const output = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, 'scripts/vendor-orders.mjs', '--only=atomic-order'], {
    cwd: fixture,
    encoding: 'utf8',
  });

  assert.notEqual(output.status, 0);
  assert.match(output.stderr, /coverIssueId 2 is not an issue in this order/);
  assert.equal(readFileSync(path.join(fixture, 'src', 'data', 'atomic_order.json'), 'utf8'), '{"sentinel":"existing payload"}\n');
  assert.equal(readFileSync(path.join(fixture, 'src', 'data', 'catalog.json'), 'utf8'), '{"sentinel":"existing catalog"}\n');
});
