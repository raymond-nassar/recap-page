import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { deflateSync } from 'node:zlib';
import { crc32 } from '../scripts/build-icons.mjs';
import { FIXTURE_API, previewResponse } from '../scripts/play-assets.mjs';
import { DEFAULT_BASE } from '../src/js/api.js';
import {
  SETS, SCREENS, fixtures, screensForSet, seedScript, chooseDevice, decodeCapture, flatten, inspectOutput, finish,
} from '../scripts/ios-app-store-screenshots.mjs';

function chunk(type, value) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(value.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), value])), 0);
  return Buffer.concat([head, value, tail]);
}

// A striped RGB or RGBA capture, 8 or 16 bits, so it is not blank.
function capture(width, height, { depth = 8, channels = 4, alpha = 255, alpha16 = null, extra = [] } = {}) {
  const bytes = depth / 8;
  const stride = width * channels * bytes;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const values = [x % 2 ? 200 : 20, y % 3 ? 90 : 10, (x + y) % 255, alpha].slice(0, channels);
      values.forEach((value, c) => {
        const at = y * (stride + 1) + 1 + (x * channels + c) * bytes;
        if (depth === 16) raw.writeUInt16BE(c === 3 && alpha16 !== null ? alpha16 : value * 257, at);
        else raw[at] = value;
      });
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = channels === 4 ? 6 : 2;
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
    ['05-professor-x', 'light'], ['06-library', 'light'], ['07-backup-settings', 'light'],
  ]);
  assert.equal(SCREENS[6].caption, 'Download a complete backup of your lists and progress.');
  for (const { folder } of SETS) {
    const screens = fixtures(folder);
    assert.deepEqual(screens.map(({ name }) => name), SCREENS.map(({ name }) => name), folder);
    assert.deepEqual(screens.map(({ appearance }) => appearance),
      ['Dark', 'Dark', 'Dark', 'Dark', 'Light', 'Light', 'Light'], folder);
    for (const theme of ['dark', 'light']) {
      const phase = fixtures(folder, theme);
      assert.deepEqual(phase.map(({ name }) => name),
        SCREENS.filter((screen) => screen.theme === theme).map(({ name }) => name), `${folder} ${theme}`);
      assert.ok(phase.every(({ appearance }) => appearance.toLowerCase() === theme));
    }
    for (const screen of screens) {
      assert.match(screen.seed, /localStorage\.clear\(\);/);
      assert.match(screen.probe, /return scope \? 'ready'/);
      assert.match(screen.probe, /footer\.style\.visibility = 'hidden'/);
      assert.doesNotMatch(screen.probe, /paddingBottom/);
      assert.doesNotMatch(screen.seed + screen.probe, /[\u2013\u2014]/);
    }
  }
  assert.throws(() => fixtures('unknown'), /unknown set/);
  assert.throws(() => fixtures('ipad-13', 'automatic'), /unknown appearance/);
});

test('the seed is the fictional Play listing state with covers off and no notes', () => {
  const evaluate = (screen) => {
    const store = new Map();
    const localStorage = {
      clear: () => store.clear(),
      setItem: (key, value) => store.set(key, value),
    };
    runInNewContext(seedScript(screen), { localStorage, fetch: () => {}, Response });
    return { state: JSON.parse(store.get('mrt.state.v2')), settings: JSON.parse(store.get('mrt.settings')) };
  };
  const home = evaluate(SCREENS[0]);
  assert.deepEqual(home.state.lists, {});
  assert.deepEqual(home.settings, { covers: false, theme: 'dark', filter: 'all' });
  const list = evaluate(SCREENS[2]);
  assert.equal(list.settings.theme, 'dark');
  assert.equal(list.settings.hideDescriptions, false);
  assert.equal(evaluate(SCREENS[5]).settings.theme, 'light');
  assert.ok(Object.keys(list.state.issues).length > 0);
  assert.ok(Object.keys(list.state.issues).every((id) => Number(id) < 0), 'every issue is fictional');
  assert.deepEqual(list.state.notes, {});
  assert.ok(list.state.lists['play-lantern']);
  assert.equal(list.state.issues['-4'].description, undefined);
  const reading = fixtures('ipad-13', 'dark').find(({ name }) => name === '03-reading-list');
  assert.match(reading.probe, /SessionSynopsis/);
  assert.match(reading.probe, /A lighthouse keeper follows a strange signal across the harbor\./);
});

test('the iPad capture mixes collapsed and expanded sidebars without changing phone navigation', () => {
  const sidebarFor = (screen) => {
    const store = new Map();
    const localStorage = { clear: () => store.clear(), setItem: (key, value) => store.set(key, value) };
    runInNewContext(seedScript(screen), { localStorage, fetch: () => {}, Response });
    return store.get('sidebar.collapsed');
  };
  const ipad = screensForSet('ipad-13');
  assert.deepEqual(ipad.map(({ sidebar }) => sidebar), [
    'expanded', 'collapsed', 'collapsed', 'collapsed', 'expanded', 'expanded', 'collapsed',
  ]);
  assert.deepEqual(ipad.map(sidebarFor), ['false', 'true', 'true', 'true', 'false', 'false', 'true']);
  const probes = fixtures('ipad-13').map(({ probe }) => probe);
  probes.forEach((probe, index) => {
    assert.ok(probe.includes(`"sidebar":"${ipad[index].sidebar}"`), ipad[index].name);
  });
  for (const folder of ['iphone-6.3', 'iphone-6.9']) {
    assert.ok(screensForSet(folder).every((screen) => sidebarFor(screen) === undefined));
    assert.ok(fixtures(folder).every(({ probe }) => !probe.includes('"sidebar":"collapsed"')
      && !probe.includes('"sidebar":"expanded"')));
  }
});

test('the seed answers metadata health with the Play fixture and forwards every other request', async () => {
  const calls = [];
  const sandbox = {
    localStorage: { clear() {}, setItem() {} },
    fetch: async (input, options) => {
      calls.push([input, options]);
      return new Response('forwarded', { status: 202 });
    },
    Response,
  };
  runInNewContext(seedScript(SCREENS[0]), sandbox);
  const response = await sandbox.fetch(`${DEFAULT_BASE}/health`, { headers: { accept: 'application/json' } });
  const play = previewResponse(`${FIXTURE_API}/health`, 'GET', new Map());
  assert.equal(response.status, play.status);
  assert.deepEqual(await response.json(), JSON.parse(play.body));
  assert.equal(calls.length, 0);
  const posted = await sandbox.fetch(`${DEFAULT_BASE}/health`, { method: 'POST' });
  const other = await sandbox.fetch(`${DEFAULT_BASE}/issues/-1`);
  assert.equal(await posted.text(), 'forwarded');
  assert.equal(await other.text(), 'forwarded');
  assert.equal(calls.length, 2);
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
  assert.throws(() => flatten(decodeCapture(capture(4, 4, { depth: 16, alpha16: 65534 }))), /16 pixels are not opaque/);
  assert.equal(decodeCapture(capture(4, 4, { channels: 3 })).nonOpaque, 0);
  const transparentRGB = capture(4, 4, { channels: 3, extra: [['tRNS', Buffer.from([0, 20, 0, 10, 0, 0])]] });
  assert.throws(() => decodeCapture(transparentRGB), /transparency/);
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
      for (const theme of ['dark', 'light']) {
        const phase = join(directory, theme);
        await mkdir(phase);
        const screens = SCREENS.filter((screen) => screen.theme === theme);
        const attachments = screens.map((screen, index) => ({
          exportedFileName: `${index}.png`, suggestedHumanReadableName: `${screen.name}_0_ABC.png`,
        }));
        await writeFile(join(phase, 'manifest.json'), JSON.stringify([{ testIdentifier: 'x', attachments }]));
        for (let index = 0; index < screens.length; index++) {
          await writeFile(join(phase, `${index}.png`), capture(set.width, set.height));
        }
      }
    }
    assert.throws(() => finish({ input, output, source: 'abc', run: '1', xcode: 'Xcode 26.6' }),
      /ipad-13\/01-home is 6 x 5, not 2064 x 2752/);
    const manifest = finish({ input, output, source: 'abc', run: '1', xcode: 'Xcode 26.6', sets });
    assert.equal(manifest.files.length, 21);
    assert.deepEqual([...new Set(manifest.files.map(({ set }) => set))], ['ipad-13', 'iphone-6.3', 'iphone-6.9']);
    assert.deepEqual(SETS.map(({ folder }) => manifest.files.filter(({ set }) => set === folder).length), [7, 7, 7]);
    assert.equal(manifest.files.some(({ file }) => file.includes('08-about-your-data.png')), false);
    assert.match(manifest.framing.footer, /visibility.*hidden.*layout/i);
    assert.match(manifest.framing.omitted, /About.*credit/i);
    assert.match(manifest.data.method, /fictional.*synopsis/i);
    assert.deepEqual(manifest.files.filter(({ set }) => set === 'ipad-13').map(({ sidebar }) => sidebar), [
      'expanded', 'collapsed', 'collapsed', 'collapsed', 'expanded', 'expanded', 'collapsed',
    ]);
    assert.ok(manifest.files.filter(({ set }) => set.startsWith('iphone-')).every(({ sidebar }) => sidebar === undefined));
    const row = manifest.files[8];
    assert.equal(row.file, 'iphone-6.3/02-modern-timeline.png');
    assert.deepEqual([row.width, row.height, row.device, row.runtime, row.appearance], [7, 5, 'Device iphone-6.3', 'iOS 26.1', 'dark']);
    const bytes = await readFile(join(output, row.file));
    assert.equal(row.bytes, bytes.length);
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
    assert.equal(decodeCapture(bytes).channels, 3);
    const written = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    assert.deepEqual([written.source, written.captureRun, written.xcode], ['abc', '1', 'Xcode 26.6']);
    const darkManifest = join(input, 'ipad-13', 'dark', 'manifest.json');
    const original = await readFile(darkManifest, 'utf8');
    const wrongPhase = JSON.parse(original);
    wrongPhase[0].attachments.push({ exportedFileName: 'extra.png', suggestedHumanReadableName: '05-professor-x_0_ABC.png' });
    await writeFile(darkManifest, JSON.stringify(wrongPhase));
    assert.throws(() => finish({ input, output, source: 'abc', run: '1', xcode: 'Xcode 26.6', sets }),
      /unexpected.*05-professor-x.*dark/i);
    const missing = JSON.parse(original);
    missing[0].attachments.shift();
    await writeFile(darkManifest, JSON.stringify(missing));
    assert.throws(() => finish({ input, output, source: 'abc', run: '1', xcode: 'Xcode 26.6', sets }),
      /expected one 01-home attachment.*found 0/i);
    const duplicate = JSON.parse(original);
    duplicate[0].attachments.push(duplicate[0].attachments[0]);
    await writeFile(darkManifest, JSON.stringify(duplicate));
    assert.throws(() => finish({ input, output, source: 'abc', run: '1', xcode: 'Xcode 26.6', sets }),
      /expected one 01-home attachment.*found 2/i);
    await writeFile(darkManifest, original);
    await writeFile(join(output, 'ipad-13', '08-about-your-data.png'), capture(6, 5));
    assert.throws(() => finish({ input, output, source: 'abc', run: '1', xcode: 'Xcode 26.6', sets }),
      /unexpected image.*ipad-13.*08-about-your-data/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
