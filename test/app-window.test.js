import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { win32 } from 'node:path';
import {
  APP_ID, APP_WINDOW_URL, MAX_FOLDER_ENTRIES, findInstalls, launchProxy, matchProxy, openAppWindow,
  parseDefaultBrowser, parseShortcut, readArguments, resolveAppWindow,
} from '../host/appWindow.mjs';
import { openAppOrTab } from '../packaging/windows/Launcher.mjs';
import { openBrowser } from '../server.mjs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge_proxy.exe';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome_proxy.exe';
const ENV = {
  APPDATA: 'C:\\Users\\reader\\AppData\\Roaming',
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  ProgramW6432: 'C:\\Program Files',
};
const PROGRAMS = win32.join(ENV.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
const CHROME_APPS = win32.join(PROGRAMS, 'Chrome Apps');
const EDGE_ARGS = ` --profile-directory=Default --app-id=${APP_ID} --app-url=${APP_WINDOW_URL}`;
const CHROME_ARGS = ` --profile-directory=Default --app-id=${APP_ID}`;

function u16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
}

function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
}

function linkInfo(target, unicode) {
  const cut = target.lastIndexOf('\\');
  const base = target.slice(0, cut + 1);
  const suffix = target.slice(cut + 1);
  const header = unicode ? 0x24 : 0x1c;
  const volume = Buffer.concat([u32(0x10), u32(3), u32(0), u32(0x10)]);
  const ansiBase = Buffer.from(`${base}\0`, 'latin1');
  const ansiSuffix = Buffer.from(`${suffix}\0`, 'latin1');
  const wideBase = unicode ? Buffer.from(`${base}\0`, 'utf16le') : Buffer.alloc(0);
  const wideSuffix = unicode ? Buffer.from(`${suffix}\0`, 'utf16le') : Buffer.alloc(0);
  const volumeOffset = header;
  const baseOffset = volumeOffset + volume.length;
  const suffixOffset = baseOffset + ansiBase.length;
  const wideBaseOffset = suffixOffset + ansiSuffix.length;
  const wideSuffixOffset = wideBaseOffset + wideBase.length;
  const size = wideSuffixOffset + wideSuffix.length;
  const head = [u32(size), u32(header), u32(1), u32(volumeOffset), u32(baseOffset), u32(0), u32(suffixOffset)];
  if (unicode) head.push(u32(wideBaseOffset), u32(wideSuffixOffset));
  return Buffer.concat([...head, volume, ansiBase, ansiSuffix, wideBase, wideSuffix]);
}

function utf16String(text) {
  return Buffer.concat([u16(text.length), Buffer.from(text, 'utf16le')]);
}

// A shell link in the shape both browsers write: an item list, LinkInfo and Unicode strings.
function shortcut({ target = EDGE, args = EDGE_ARGS, unicodeInfo = false, workingDir } = {}) {
  const flags = 0x1 | 0x2 | 0x10 | 0x20 | 0x80;
  const header = Buffer.alloc(0x4c);
  header.writeUInt32LE(0x4c, 0);
  Buffer.from('0114020000000000c000000000000046', 'hex').copy(header, 4);
  header.writeUInt32LE(flags, 20);
  const idList = Buffer.concat([u16(6), Buffer.from([4, 0, 1, 2, 0, 0])]);
  return Buffer.concat([
    header, idList, linkInfo(target, unicodeInfo),
    utf16String(workingDir ?? win32.dirname(target)), utf16String(args),
  ]);
}

function folders(files) {
  const byDir = new Map();
  for (const [path, bytes] of Object.entries(files)) {
    const dir = win32.dirname(path);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push({ name: win32.basename(path), bytes });
  }
  return {
    readdir: async (dir) => {
      if (!byDir.has(dir)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return byDir.get(dir).map(({ name }) => ({ name, isFile: () => true }));
    },
    readFile: async (path) => files[path],
    stat: async (path) => {
      if (path === EDGE || path === CHROME) return { size: 1000, isFile: () => true };
      if (!(path in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { size: files[path].length, isFile: () => true };
    },
  };
}

// Run 5's own output for the legacy record, which is what a hosted runner keeps.
const REG_EDGE = '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice\r\n'
  + '    Hash    REG_SZ    abc=\r\n    ProgId    REG_SZ    MSEdgeHTM\r\n\r\n';

function reg(stdout, error = null) {
  return (file, args, options, callback) => callback(error, stdout);
}

test('parseShortcut reads the target and arguments a browser writes, and refuses damaged bytes', () => {
  for (const unicodeInfo of [false, true]) {
    const link = parseShortcut(shortcut({ unicodeInfo }));
    assert.equal(link.target, EDGE);
    assert.equal(link.arguments, EDGE_ARGS);
  }
  const good = shortcut();
  assert.equal(parseShortcut(good.subarray(0, good.length - 4)), null, 'truncated arguments');
  assert.equal(parseShortcut(good.subarray(0, 0x40)), null, 'truncated header');
  const otherClass = Buffer.from(good);
  otherClass[5] ^= 0xff;
  assert.equal(parseShortcut(otherClass), null, 'wrong class id');
  const farOffset = Buffer.from(good);
  farOffset.writeUInt32LE(0x7fff, 0x4c + 8 + 16);
  assert.equal(parseShortcut(farOffset), null, 'path offset outside LinkInfo');
  const accented = shortcut({ target: 'C:\\Program Files\\Caf\u00e9\\proxy.exe' });
  assert.equal(parseShortcut(accented), null, 'an ANSI path outside ASCII is not guessed at');
});

test('readArguments accepts only the profile, this app id and this exact address, and passes no address on', () => {
  assert.deepEqual(readArguments(EDGE_ARGS), { profile: 'Default' });
  assert.deepEqual(readArguments(CHROME_ARGS), { profile: 'Default' });
  assert.deepEqual(readArguments(`--profile-directory="Profile 12" --app-id=${APP_ID}`), { profile: 'Profile 12' });
  const refused = {
    'a separate data directory': `--user-data-dir="C:\\Temp\\p" ${CHROME_ARGS}`,
    'a data directory without a path': `--user-data-dir=x ${CHROME_ARGS}`,
    'an extra switch': `${CHROME_ARGS} --incognito=1`,
    'a bare switch': `${CHROME_ARGS} --kiosk`,
    'a repeated profile': `${CHROME_ARGS} --profile-directory=Default`,
    'another app': ` --profile-directory=Default --app-id=${'a'.repeat(32)}`,
    'another address': `${CHROME_ARGS} --app-url=http://127.0.0.1:8787/evil`,
    'another port': `${CHROME_ARGS} --app-url=http://127.0.0.1:8788/`,
    'no profile': ` --app-id=${APP_ID}`,
    'a guest profile': ` --profile-directory="Guest Profile" --app-id=${APP_ID}`,
    'a profile path': ` --profile-directory=..\\Default --app-id=${APP_ID}`,
    'an unbalanced quote': ` --profile-directory="Default --app-id=${APP_ID}`,
    'a control character': ` --profile-directory=Default\t--app-id=${APP_ID}`,
  };
  for (const [label, args] of Object.entries(refused)) assert.equal(readArguments(args), null, label);
});

test('matchProxy accepts only the two browsers\' proxies under Program Files', () => {
  assert.equal(matchProxy(EDGE, ENV).browser.name, 'edge');
  assert.equal(matchProxy(CHROME.toUpperCase(), ENV).browser.name, 'chrome');
  assert.equal(matchProxy(CHROME, ENV).proxy, CHROME, 'the fixed path is used, not the shortcut\'s spelling');
  for (const target of [
    'C:\\PROGRA~1\\Google\\Chrome\\Application\\chrome_proxy.exe',
    'C:\\Users\\reader\\AppData\\Local\\Google\\Chrome\\Application\\chrome_proxy.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'D:\\Program Files\\Google\\Chrome\\Application\\chrome_proxy.exe',
    'Google\\Chrome\\Application\\chrome_proxy.exe',
    null,
  ]) assert.equal(matchProxy(target, ENV), null, String(target));
  assert.equal(matchProxy(CHROME, { ProgramFiles: '..\\x' }), null, 'a relative root is not a root');
});

test('findInstalls counts installs rather than files, and any doubtful shortcut of this app means the tab', async () => {
  const one = await findInstalls({ env: ENV, fs: folders({
    [win32.join(PROGRAMS, 'Recap Page.lnk')]: shortcut({ target: CHROME, args: CHROME_ARGS }),
    [win32.join(CHROME_APPS, 'Recap Page.lnk')]: shortcut({ target: CHROME, args: CHROME_ARGS }),
    [win32.join(PROGRAMS, 'Notepad.lnk')]: shortcut({ target: 'C:\\Windows\\notepad.exe', args: '' }),
    [win32.join(PROGRAMS, 'Notes.txt')]: Buffer.from(APP_ID),
  }) });
  assert.deepEqual(one, { ok: true, installs: [{ browser: one.installs[0].browser, proxy: CHROME, profile: 'Default' }] });
  assert.equal(one.installs[0].browser.name, 'chrome');

  const two = await findInstalls({ env: ENV, fs: folders({
    [win32.join(PROGRAMS, 'Recap Page.lnk')]: shortcut(),
    [win32.join(CHROME_APPS, 'Recap Page.lnk')]: shortcut({ target: CHROME, args: CHROME_ARGS }),
  }) });
  assert.equal(two.installs.length, 2);

  const doubtful = {
    'unexpected-arguments': shortcut({ args: `--user-data-dir=x ${CHROME_ARGS}` }),
    'unexpected-target': shortcut({ target: 'C:\\Tools\\msedge_proxy.exe' }),
    'malformed-shortcut': Buffer.concat([Buffer.from('not a link '), Buffer.from(APP_ID, 'utf16le')]),
  };
  for (const [reason, bytes] of Object.entries(doubtful)) {
    const found = await findInstalls({ env: ENV, fs: folders({ [win32.join(PROGRAMS, 'Recap Page.lnk')]: bytes }) });
    assert.deepEqual(found, { ok: false, reason });
  }

  const crowded = {};
  for (let i = 0; i <= MAX_FOLDER_ENTRIES; i += 1) crowded[win32.join(PROGRAMS, `x${i}.txt`)] = Buffer.alloc(1);
  assert.deepEqual(await findInstalls({ env: ENV, fs: folders(crowded) }), { ok: false, reason: 'folder-too-large' });
});

test('parseDefaultBrowser needs every record of the choice to agree', () => {
  assert.equal(parseDefaultBrowser(REG_EDGE), 'MSEdgeHTM');
  const latest = (progId) => `${REG_EDGE}HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoiceLatest\\ProgId\r\n`
    + `    ProgId    REG_SZ    ${progId}\r\n\r\n`;
  assert.equal(parseDefaultBrowser(latest('MSEdgeHTM')), 'MSEdgeHTM');
  assert.equal(parseDefaultBrowser(latest('ChromeHTML')), null, 'a newer record naming another browser wins nothing');
  assert.equal(parseDefaultBrowser(REG_EDGE.replace('\\http\\UserChoice', '\\https\\UserChoice')), null, 'https alone is not http');
  assert.equal(parseDefaultBrowser(''), null);
});

test('resolveAppWindow opens the window only for one install in the default browser, and says why not otherwise', async () => {
  const fs = folders({ [win32.join(PROGRAMS, 'Recap Page.lnk')]: shortcut() });
  const base = { platform: 'win32', env: ENV, fs, run: reg(REG_EDGE) };
  const ok = await resolveAppWindow(APP_WINDOW_URL, base);
  assert.equal(ok.ok, true);
  assert.equal(ok.install.proxy, EDGE);

  const cases = [
    ['not-windows', APP_WINDOW_URL, { platform: 'darwin' }],
    ['other-address', 'http://127.0.0.1:8787/#/settings', {}],
    ['not-installed', APP_WINDOW_URL, { fs: folders({}) }],
    ['other-default-browser', APP_WINDOW_URL, { run: reg(REG_EDGE.replace('MSEdgeHTM', 'ChromeHTML')) }],
    ['unknown-default-browser', APP_WINDOW_URL, { run: reg('', new Error('reg failed')) }],
    ['unknown-default-browser', APP_WINDOW_URL, { run: () => { throw new Error('no reg'); } }],
    ['missing-proxy', APP_WINDOW_URL, { fs: { ...fs, stat: async (path) => {
      if (path === EDGE) throw new Error('gone');
      return fs.stat(path);
    } } }],
    ['several-installs', APP_WINDOW_URL, { fs: folders({
      [win32.join(PROGRAMS, 'Recap Page.lnk')]: shortcut(),
      [win32.join(PROGRAMS, 'Recap Page (2).lnk')]: shortcut({ args: EDGE_ARGS.replace('Default', '"Profile 1"') }),
    }) }],
  ];
  for (const [reason, url, overrides] of cases) {
    assert.deepEqual(await resolveAppWindow(url, { ...base, ...overrides }), { ok: false, reason }, reason);
  }
});

function fakeChild(behavior) {
  const child = new EventEmitter();
  child.unref = () => { child.unrefed = true; };
  setImmediate(() => behavior(child));
  return child;
}

test('launchProxy starts only the fixed proxy with the profile and app id, and trusts only a clean exit', async () => {
  const calls = [];
  const start = (behavior) => (file, args, options) => {
    calls.push({ file, args, options });
    return fakeChild(behavior);
  };
  assert.equal(await launchProxy(EDGE, 'Profile 1', { start: start((c) => c.emit('exit', 0)) }), true);
  assert.deepEqual(calls[0].file, EDGE);
  assert.deepEqual(calls[0].args, ['--profile-directory=Profile 1', `--app-id=${APP_ID}`]);
  assert.equal(calls[0].options.detached, true);
  assert.equal(await launchProxy(EDGE, 'Default', { start: start((c) => c.emit('exit', 1)) }), false);
  assert.equal(await launchProxy(EDGE, 'Default', { start: start((c) => c.emit('error', new Error('x'))) }), false);
  assert.equal(await launchProxy(EDGE, 'Default', { start: start(() => {}), timeoutMs: 20 }), false);
  assert.equal(await launchProxy(EDGE, 'Default', { start: () => { throw new Error('denied'); } }), false);
});

test('openAppWindow answers false instead of failing, so the caller always has the tab', async () => {
  const broken = { readdir: async () => { throw new TypeError('boom'); } };
  assert.equal(await openAppWindow(APP_WINDOW_URL, { platform: 'win32', env: ENV, fs: broken, run: reg(REG_EDGE) }), false);
  assert.equal(await openAppWindow(APP_WINDOW_URL, { platform: 'win32', env: null }), false);
});

test('the pinned app id belongs to the manifest id the app ships', () => {
  const manifest = JSON.parse(readFileSync(new URL('../src/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(new URL(manifest.id, APP_WINDOW_URL).href, APP_WINDOW_URL,
    'changing the manifest id changes the app id browsers derive, so re-measure it with the pwa-probe job');
});

test('the launcher tries the app window first and opens the tab only when it does not open', async () => {
  for (const [load, tab] of [
    [async () => ({ openAppWindow: async () => true }), 0],
    [async () => ({ openAppWindow: async () => false }), 1],
    [async () => ({ openAppWindow: async () => 'yes' }), 1],
    [async () => ({ openAppWindow: async () => { throw new Error('boom'); } }), 1],
    [async () => { throw new Error('no host folder'); }, 1],
  ]) {
    let tabs = 0;
    const urls = [];
    await openAppOrTab({
      loadAppWindow: async () => {
        const module = await load();
        return { openAppWindow: async (url) => { urls.push(url); return module.openAppWindow(url); } };
      },
      openTab: async () => { tabs += 1; },
    });
    assert.equal(tabs, tab);
    assert.ok(urls.every((url) => url === APP_WINDOW_URL));
  }
});

test('the server tries the app window only on Windows and otherwise opens the tab as before', async () => {
  const spawned = [];
  const loadChildProcess = async () => ({
    spawn: (command, args, options) => { spawned.push({ command, args, options }); return { unref: () => {} }; },
  });
  const appCalls = [];
  const app = (result) => async () => ({ openAppWindow: async (url) => { appCalls.push(url); return result; } });
  assert.equal(await openBrowser(APP_WINDOW_URL, { platform: 'win32', loadAppWindow: app(true), loadChildProcess }), 'app');
  assert.equal(spawned.length, 0);
  assert.equal(await openBrowser(APP_WINDOW_URL, { platform: 'win32', loadAppWindow: app(false), loadChildProcess }), 'tab');
  assert.deepEqual(spawned.pop(), { command: 'cmd', args: ['/c', 'start', '', APP_WINDOW_URL], options: { stdio: 'ignore', detached: true } });
  assert.equal(await openBrowser(APP_WINDOW_URL, {
    platform: 'win32', loadAppWindow: async () => { throw new Error('no host folder'); }, loadChildProcess,
  }), 'tab');
  appCalls.length = 0;
  for (const platform of ['darwin', 'linux']) {
    assert.equal(await openBrowser(APP_WINDOW_URL, { platform, loadAppWindow: app(true), loadChildProcess }), 'tab');
  }
  assert.deepEqual(appCalls, []);
  assert.equal(await openBrowser(APP_WINDOW_URL, {
    platform: 'linux', loadChildProcess: async () => { throw new Error('no spawn'); },
  }), 'none');
});
