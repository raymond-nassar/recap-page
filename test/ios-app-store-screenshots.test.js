import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { crc32 } from '../scripts/build-icons.mjs';
import {
  SETS, SCREENS, fixtures, seedScript, chooseDevice, decodeCapture, flatten, inspectOutput, finish,
} from '../scripts/ios-app-store-screenshots.mjs';

function chunk(type, value) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(value.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), value])), 0);
  return Buffer.concat([head, value, tail]);
}

// An RGBA capture, 8 or 16 bits, with a striped pattern so it is not blank.
function capture(width, height, { depth = 8, alpha = 255, extra = [] } = {}) {
  const bytes = depth / 8;
  const stride = width * 4 * bytes;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const values = [x % 2 ? 200 : 20, y % 3 ? 90 : 10, (x + y) % 255, alpha];
      values.forEach((value, c) => {
        const at = y * (stride + 1) + 1 + (x * 4 + c) * bytes;
        if (depth === 16) raw.writeUInt16BE(value * 257, at);
        else raw[at] = value;
      });
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    ...extra.map(([type, value]) => chunk(type, value)),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('the capture matches the three App Store slots and their screens in order', () => {
  assert.deepEqual(SETS.map(({ folder, width, height }) => [folder, width, height]),
    [['ipad-13', 2064, 2752], ['iphone-6.3', 1206, 2622], ['iphone-6.9', 1320, 2868]]);
  assert.deepEqual(SCREENS.map(({ name, theme }) => [name, theme]), [
    ['01-home', 'dark'], ['02-modern-timeline', 'dark'], ['03-reading-list', 'dark'], ['04-storylines', 'dark'],
    ['05-professor-x', 'light'], ['06-library', 'light'], ['07-backup-settings', 'light'], ['08-about-your-data', 'light'],
  ]);
  for (const { folder } of SETS) {
    const screens = fixtures(folder);
    const count = folder === 'ipad-13' ? 7 : 8;
    assert.deepEqual(screens.map(({ name }) => name), SCREENS.slice(0, count).map(({ name }) => name), folder);
    assert.deepEqual(screens.map(({ appearance }) => appearance),
      ['Dark', 'Dark', 'Dark', 'Dark', 'Light', 'Light', 'Light', 'Light'].slice(0, count), folder);
    for (const screen of screens) {
      assert.match(screen.seed, /localStorage\.clear\(\);/);
      assert.match(screen.probe, /return scope \? 'ready'/);
      assert.match(screen.probe, /footer\.style\.visibility = 'hidden'/);
      assert.doesNotMatch(screen.probe, /paddingBottom/);
      assert.doesNotMatch(screen.seed + screen.probe, /[\u2013\u2014]/);
    }
  }
  assert.throws(() => fixtures('unknown'), /unknown set/);
});

test('the seed is the fictional Play listing state with covers off and no notes', () => {
  const evaluate = (screen) => {
    const store = new Map();
    const localStorage = {
      clear: () => store.clear(),
      setItem: (key, value) => store.set(key, value),
    };
    new Function('localStorage', seedScript(screen))(localStorage);
    return { state: JSON.parse(store.get('mrt.state.v2')), settings: JSON.parse(store.get('mrt.settings')) };
  };
  const home = evaluate(SCREENS[0]);
  assert.deepEqual(home.state.lists, {});
  assert.deepEqual(home.settings, { covers: false, theme: 'dark', filter: 'all' });
  const list = evaluate(SCREENS[2]);
  assert.equal(list.settings.theme, 'dark');
  assert.equal(evaluate(SCREENS[5]).settings.theme, 'light');
  assert.ok(Object.keys(list.state.issues).length > 0);
  assert.ok(Object.keys(list.state.issues).every((id) => Number(id) < 0), 'every issue is fictional');
  assert.deepEqual(list.state.notes, {});
  assert.ok(list.state.lists['play-lantern']);
});

test('the newest runtime supplies each Simulator, and a missing one stops the capture', () => {
  const listing = {
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [{ name: 'iPhone 17 Pro', udid: 'old' }],
      'com.apple.CoreSimulator.SimRuntime.iOS-26-1': [
        { name: 'iPhone 17 Pro', udid: 'pro' }, { name: 'iPhone 17 Pro Max', udid: 'max' },
        { name: 'iPad Pro 13-inch (M5)', udid: 'ipad' },
      ],
      'com.apple.CoreSimulator.SimRuntime.watchOS-26-1': [{ name: 'iPhone 17 Pro', udid: 'watch' }],
    },
  };
  assert.deepEqual(chooseDevice(listing, 'iphone-6.3'), { set: 'iphone-6.3', udid: 'pro', name: 'iPhone 17 Pro', runtime: 'iOS 26.1' });
  assert.equal(chooseDevice(JSON.stringify(listing), 'iphone-6.9').udid, 'max');
  assert.equal(chooseDevice(listing, 'ipad-13').name, 'iPad Pro 13-inch (M5)');
  delete listing.devices['com.apple.CoreSimulator.SimRuntime.iOS-26-1'][1];
  assert.throws(() => chooseDevice(listing, 'iphone-6.9'), /iPhone 17 Pro Max Simulator is not available/);
});

test('flattening drops the alpha channel, keeps the color profile and refuses translucent or blank captures', () => {
  for (const depth of [8, 16]) {
    const source = capture(6, 5, { depth, extra: [['sRGB', Buffer.from([0])], ['tEXt', Buffer.from('a\0b')]] });
    const decoded = decodeCapture(source);
    assert.equal(decoded.depth, depth);
    const output = flatten(decoded);
    const again = decodeCapture(output);
    assert.equal(again.channels, 3);
    assert.equal(again.depth, 8);
    assert.deepEqual(again.kept.map(({ type }) => type), ['sRGB']);
    assert.ok(again.pixels.equals(decoded.pixels), `depth ${depth} keeps every pixel`);
  }
  assert.throws(() => flatten(decodeCapture(capture(4, 4, { alpha: 128 }))), /16 pixels are not opaque/);
  const set = { folder: 'tiny', width: 6, height: 5 };
  assert.doesNotThrow(() => inspectOutput(flatten(decodeCapture(capture(6, 5))), set));
  assert.throws(() => inspectOutput(flatten(decodeCapture(capture(6, 4))), set), /expects 6 x 5 but found 6 x 4/);
  assert.throws(() => inspectOutput(capture(6, 5), set), /no alpha channel/);
});

test('finish writes each set with its own manifest rows and refuses a wrong size', async () => {
  const root = await mkdtemp(join(tmpdir(), 'recap-app-store-'));
  try {
    const input = join(root, 'in');
    const output = join(root, 'out');
    // Real sizes would make this test slow, so the sets are shrunk for it.
    const sets = SETS.map((set, index) => ({ ...set, width: 6 + index, height: 5 }));
    for (const set of sets) {
      const directory = join(input, set.folder);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'device.json'), JSON.stringify({ set: set.folder, name: `Device ${set.folder}`, runtime: 'iOS 26.1' }));
      const screens = SCREENS.slice(0, set.folder === 'ipad-13' ? 7 : 8);
      const attachments = screens.map((screen, index) => ({
        exportedFileName: `${index}.png`, suggestedHumanReadableName: `${screen.name}_0_ABC.png`,
      }));
      await writeFile(join(directory, 'manifest.json'), JSON.stringify([{ testIdentifier: 'x', attachments }]));
      for (let index = 0; index < screens.length; index++) {
        await writeFile(join(directory, `${index}.png`), capture(set.width, set.height));
      }
    }
    assert.throws(() => finish({ input, output, source: 'abc', run: '1', xcode: 'Xcode 26.6' }),
      /ipad-13\/01-home is 6 x 5, not 2064 x 2752/);
    const manifest = finish({ input, output, source: 'abc', run: '1', xcode: 'Xcode 26.6', sets });
    assert.equal(manifest.files.length, 23);
    assert.deepEqual([...new Set(manifest.files.map(({ set }) => set))], ['ipad-13', 'iphone-6.3', 'iphone-6.9']);
    assert.deepEqual(SETS.map(({ folder }) => manifest.files.filter(({ set }) => set === folder).length), [7, 8, 8]);
    assert.equal(manifest.files.some(({ file }) => file === 'ipad-13/08-about-your-data.png'), false);
    assert.match(manifest.framing.footer, /visibility.*hidden.*layout/i);
    assert.match(manifest.framing.ipad, /About.*credit/i);
    const row = manifest.files[8];
    assert.equal(row.file, 'iphone-6.3/02-modern-timeline.png');
    assert.deepEqual([row.width, row.height, row.device, row.runtime, row.appearance], [7, 5, 'Device iphone-6.3', 'iOS 26.1', 'dark']);
    const bytes = await readFile(join(output, row.file));
    assert.equal(row.bytes, bytes.length);
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
    assert.equal(decodeCapture(bytes).channels, 3);
    const written = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    assert.deepEqual([written.source, written.captureRun, written.xcode], ['abc', '1', 'Xcode 26.6']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
