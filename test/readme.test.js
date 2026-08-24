import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const SCREENSHOTS = join(ROOT, 'docs', 'screenshots');
const EXPECTED = [
  'avengers-disassembled-reading-1280.png',
  'home-1280.png',
];

function pngDimensions(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${path} is not a PNG`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

test('the README overview stays count-free as the catalog grows', () => {
  assert.match(README, /Pick a curated\s+reading order, follow it issue by issue/);
  assert.doesNotMatch(
    README,
    /\b\d[\d,]*\s+(?:curated\s+)?(?:reading orders?|reading lists?|issues?|cards?)\b/i,
  );
});

test('the README shows exactly the two current 1280 by 900 product views', () => {
  const images = [...README.matchAll(/!\[[^\]]+\]\(([^)]+\.png)\)/g)].map((match) => match[1]);
  assert.deepEqual(images, [
    'docs/screenshots/home-1280.png',
    'docs/screenshots/avengers-disassembled-reading-1280.png',
  ]);

  const files = readdirSync(SCREENSHOTS).filter((file) => file.endsWith('.png')).sort();
  assert.deepEqual(files, EXPECTED);
  for (const file of EXPECTED) {
    const path = join(SCREENSHOTS, file);
    assert.equal(existsSync(path), true, `${file} is missing`);
    assert.deepEqual(pngDimensions(path), { width: 1280, height: 900 });
  }
});
