import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ASSET_DIR, PACKET, PUBLIC_URLS, SCREENSHOTS, STORE_TILE, pngInfo, validateSubmission,
} from '../scripts/check-store-submission.mjs';
import { drawIcon, encodePng } from '../scripts/build-icons.mjs';

test('the Store submission packet and asset inventory satisfy their contract', () => {
  assert.deepEqual(validateSubmission(), []);
});

test('the Store tile is the existing purple panels mark at the listing size', () => {
  const tile = pngInfo(join(ASSET_DIR, STORE_TILE));
  assert.deepEqual({ width: tile.width, height: tile.height }, { width: 300, height: 300 });

  const expected = createHash('sha256').update(encodePng(300, drawIcon(300))).digest('hex');
  const bytes = readFileSync(join(ASSET_DIR, STORE_TILE));
  const actual = createHash('sha256').update(bytes).digest('hex');
  assert.equal(actual, expected);
});

test('listing copy stays within the Store field limits', () => {
  const packet = readFileSync(PACKET, 'utf8');
  const short = /### Short description\r?\n\r?\n([\s\S]*?)\r?\n\r?\n### Long description/.exec(packet)?.[1]
    .replace(/\s+/g, ' ').trim();
  assert.ok(short, 'short description is missing');
  assert.ok(short.length <= 270, `short description is ${short.length} characters`);

  const features = /### Feature fields\r?\n\r?\n([\s\S]*?)\r?\n\r?\n### Search terms/.exec(packet)?.[1]
    .split(/\r?\n/)
    .filter((line) => /^\d+\. /.test(line))
    .map((line) => line.replace(/^\d+\. /, ''));
  assert.ok(features.length > 0 && features.length <= 20);
  assert.ok(features.every((feature) => feature.length <= 200));

  const terms = /### Search terms\r?\n\r?\n([\s\S]*?)\r?\n\r?\n### Copyright/.exec(packet)?.[1]
    .split(/\r?\n/)
    .filter((line) => /^\d+\. `/.test(line))
    .map((line) => line.replace(/^\d+\. `|`$/g, ''));
  assert.equal(terms.length, 7);
  assert.ok(terms.every((term) => term.length <= 40));
  assert.ok(new Set(terms.flatMap((term) => term.split(/\s+/))).size <= 21);
});

test('every public handoff URL uses HTTPS and every screenshot has a caption', () => {
  assert.ok(PUBLIC_URLS.every((url) => url.startsWith('https://')));
  const packet = readFileSync(PACKET, 'utf8');
  for (const file of SCREENSHOTS) {
    assert.match(packet, new RegExp(`\\| \`${file.replaceAll('.', '\\.')}\` \\|`));
  }
});
