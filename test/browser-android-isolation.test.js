import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// #1286: the Android runner's one launch must carry the desktop collected-editions isolation, or an
// outside request that slips past interception could resolve or leave through a system proxy.
test('the Android browser runner launches with the desktop network isolation and runs collected editions', () => {
  const android = read('scripts/browser-android.mjs');
  const launches = android.match(/puppeteer\.launch\(\{[\s\S]*?\}\);/g) ?? [];
  assert.equal(launches.length, 1);
  assert.match(launches[0], /'--no-proxy-server'/);
  assert.match(launches[0], /'--host-resolver-rules=MAP \* ~NOTFOUND, EXCLUDE 127\.0\.0\.1'/);
  assert.match(android, /'collected-editions',\s*\]\);/);
  assert.match(android, /collectedEditions\.run\(page,/);
});
