// The installed app window on Windows (#1412). When the reader has installed Recap Page from Microsoft
// Edge or Chrome, the browser leaves a Start menu shortcut that opens it in its own window. Opening the app
// that way instead of a tab is what the owner asked for, so that a reader who is not technical meets one
// app rather than a browser page.
//
// The window is opened through the browser's own proxy executable with the profile and app id the
// shortcut names, which is exactly what clicking the shortcut does. Nothing is installed, registered or
// written here: the shortcut is read, never executed, and the only value carried from it into a command
// line is a profile name that has matched a fixed pattern. Everything else on the command line is a
// constant of this file, and the executable is one of two fixed paths under Program Files.
//
// Saved progress lives in one browser profile on one origin (constraint 5), so the window is used only
// when there is exactly one installed copy and its browser is the reader's default browser, which is the
// browser the tab would have opened in. In every other case, and on any error at all, the answer is false
// and the caller opens today's tab. Measured on hosted runners on 2026-11-16 (#1412, probe runs 1 to 5):
// Edge 157 writes the shortcut to the Start menu Programs folder, Chrome 157 to its Chrome Apps subfolder
// plus a Desktop copy, and both target the proxy with --profile-directory and --app-id.
import { execFile, spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { win32 } from 'node:path';

export const APP_WINDOW_URL = 'http://127.0.0.1:8787/';
// Both browsers derive this from the manifest id, which resolves to APP_WINDOW_URL. It is the measured
// value rather than a derivation: no simple hash reproduced it locally. If a browser ever derives another,
// no shortcut names this one and the launcher opens the tab, which is the safe direction to fail in.
export const APP_ID = 'gdiemljfmnfogemddapdnihghiddfebn';

export const BROWSERS = Object.freeze([
  Object.freeze({ name: 'edge', progId: 'MSEdgeHTM', proxy: 'Microsoft\\Edge\\Application\\msedge_proxy.exe' }),
  Object.freeze({ name: 'chrome', progId: 'ChromeHTML', proxy: 'Google\\Chrome\\Application\\chrome_proxy.exe' }),
]);

const PROGRAM_ROOTS = ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432'];
const SHORTCUT_DIRS = [['Microsoft', 'Windows', 'Start Menu', 'Programs'], ['Microsoft', 'Windows', 'Start Menu', 'Programs', 'Chrome Apps']];
const PROFILE = /^(?:Default|Profile [1-9][0-9]{0,3})$/;
const DRIVE_ROOT = /^[A-Za-z]:\\/;
// A browser's shortcut is about two kilobytes. Anything far larger is not one, and is not read.
export const MAX_SHORTCUT_BYTES = 64 * 1024;
// A Start menu folder with more entries than this is not scanned at all, so the cost stays bounded.
export const MAX_FOLDER_ENTRIES = 512;
export const REG_TIMEOUT_MS = 5000;
// Measured on run 5: a cold proxy hands off to the browser and exits 0 within seconds.
export const PROXY_TIMEOUT_MS = 10000;
const UTF16_APP_ID = Buffer.from(APP_ID, 'utf16le');

const LNK_HEADER_SIZE = 0x4c;
const LNK_CLSID = '0114020000000000c000000000000046';
const HAS_ID_LIST = 0x1;
const HAS_LINK_INFO = 0x2;
const IS_UNICODE = 0x80;
const FORCE_NO_LINK_INFO = 0x100;
const STRING_FLAGS = [['name', 0x4], ['relativePath', 0x8], ['workingDir', 0x10], ['arguments', 0x20], ['iconLocation', 0x40]];

function ascii(buf, start, end) {
  if (start < 0 || start >= end) return null;
  const stop = buf.indexOf(0, start);
  if (stop < 0 || stop >= end) return null;
  const bytes = buf.subarray(start, stop);
  return bytes.every((b) => b >= 0x20 && b < 0x7f) ? bytes.toString('latin1') : null;
}

function utf16(buf, start, end) {
  if (start < 0 || start >= end) return null;
  for (let i = start; i + 1 < end; i += 2) {
    if (buf[i] === 0 && buf[i + 1] === 0) return buf.subarray(start, i).toString('utf16le');
  }
  return null;
}

// Reads the parts of a shell link (MS-SHLLINK) this module needs: the target path from LinkInfo and the
// strings, the arguments among them. Returns null for anything malformed rather than guessing.
export function parseShortcut(bytes) {
  try {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (buf.length < LNK_HEADER_SIZE || buf.readUInt32LE(0) !== LNK_HEADER_SIZE) return null;
    if (buf.subarray(4, 20).toString('hex') !== LNK_CLSID) return null;
    const flags = buf.readUInt32LE(20);
    let off = LNK_HEADER_SIZE;
    if (flags & HAS_ID_LIST) off += 2 + buf.readUInt16LE(off);
    let target = null;
    if ((flags & HAS_LINK_INFO) && !(flags & FORCE_NO_LINK_INFO)) {
      const size = buf.readUInt32LE(off);
      const end = off + size;
      if (size < 0x1c || end > buf.length) return null;
      const header = buf.readUInt32LE(off + 4);
      const infoFlags = buf.readUInt32LE(off + 8);
      if (infoFlags & 0x1) {
        let base;
        let suffix;
        if (header >= 0x24) {
          base = utf16(buf, off + buf.readUInt32LE(off + 28), end);
          suffix = utf16(buf, off + buf.readUInt32LE(off + 32), end);
        } else {
          base = ascii(buf, off + buf.readUInt32LE(off + 16), end);
          suffix = ascii(buf, off + buf.readUInt32LE(off + 24), end);
        }
        if (base === null || suffix === null) return null;
        target = base + suffix;
      }
      off = end;
    }
    const unicode = Boolean(flags & IS_UNICODE);
    const strings = {};
    for (const [key, bit] of STRING_FLAGS) {
      if (!(flags & bit)) continue;
      const count = buf.readUInt16LE(off);
      const length = unicode ? count * 2 : count;
      off += 2;
      if (off + length > buf.length) return null;
      strings[key] = buf.subarray(off, off + length).toString(unicode ? 'utf16le' : 'latin1');
      off += length;
    }
    return { target, arguments: strings.arguments ?? '', workingDir: strings.workingDir ?? null };
  } catch {
    return null;
  }
}

// Splits a shortcut's arguments the way the browser would for the only shapes a browser writes: switches
// separated by spaces, a value optionally in double quotes. Anything else, a backslash, a control
// character or an unbalanced quote, is refused rather than interpreted.
export function tokenizeArguments(text) {
  if (typeof text !== 'string' || !/^[\x20-\x7e]*$/.test(text) || text.includes('\\')) return null;
  const tokens = [];
  let current = '';
  let quoted = false;
  let started = false;
  for (const ch of text) {
    if (ch === '"') {
      quoted = !quoted;
      started = true;
    } else if (ch === ' ' && !quoted) {
      if (started) tokens.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (quoted) return null;
  if (started) tokens.push(current);
  return tokens;
}

// The only switches accepted, each at most once: the profile, this app's id, and the app address Edge
// adds, which must be this origin exactly and is never passed on. Anything else, --user-data-dir above
// all, means a copy this module cannot reopen faithfully, so the answer is the tab.
export function readArguments(text) {
  const tokens = tokenizeArguments(text);
  if (!tokens) return null;
  const seen = new Map();
  for (const token of tokens) {
    const match = /^--([a-z-]+)=(.*)$/.exec(token);
    if (!match || seen.has(match[1])) return null;
    seen.set(match[1], match[2]);
  }
  for (const key of seen.keys()) {
    if (!['profile-directory', 'app-id', 'app-url'].includes(key)) return null;
  }
  if (seen.get('app-id') !== APP_ID) return null;
  if (seen.has('app-url') && seen.get('app-url') !== APP_WINDOW_URL) return null;
  const profile = seen.get('profile-directory');
  return typeof profile === 'string' && PROFILE.test(profile) ? { profile } : null;
}

function programRoots(env) {
  const roots = [];
  for (const name of PROGRAM_ROOTS) {
    const value = env[name];
    if (typeof value === 'string' && DRIVE_ROOT.test(value) && !value.split('\\').includes('..')) roots.push(value);
  }
  return roots;
}

// The fixed proxy path the target must equal, case-insensitively, or null. A shortcut never chooses the
// executable: it can only agree with one of these.
export function matchProxy(target, env) {
  if (typeof target !== 'string' || !DRIVE_ROOT.test(target)) return null;
  const wanted = win32.normalize(target).toLowerCase();
  for (const browser of BROWSERS) {
    for (const root of programRoots(env)) {
      const proxy = win32.join(root, browser.proxy);
      if (proxy.toLowerCase() === wanted) return { browser, proxy };
    }
  }
  return null;
}

function mentionsThisApp(text) {
  return text.includes(APP_ID) || text.includes('127.0.0.1:8787');
}

function rawMentionsThisApp(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return buf.includes(APP_ID, 0, 'latin1') || buf.includes(UTF16_APP_ID);
}

// Every installed copy of this app found in the Start menu, one per browser, profile and proxy, with the
// Desktop copies Chrome also writes never looked at. A shortcut that names this app but cannot be read or
// does not pass every check makes the whole answer invalid, since it may be the copy the reader uses.
export async function findInstalls({ env = process.env, fs = { readdir, readFile, stat } } = {}) {
  const appData = env.APPDATA;
  if (typeof appData !== 'string' || !DRIVE_ROOT.test(appData)) return { ok: false, reason: 'no-appdata' };
  const installs = new Map();
  for (const parts of SHORTCUT_DIRS) {
    const dir = win32.join(appData, ...parts);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      return { ok: false, reason: 'unreadable-folder' };
    }
    if (entries.length > MAX_FOLDER_ENTRIES) return { ok: false, reason: 'folder-too-large' };
    for (const entry of entries) {
      if (!entry.isFile() || !/\.lnk$/i.test(entry.name)) continue;
      const file = win32.join(dir, entry.name);
      let bytes;
      try {
        const info = await fs.stat(file);
        if (info.size > MAX_SHORTCUT_BYTES) continue;
        bytes = await fs.readFile(file);
      } catch {
        return { ok: false, reason: 'unreadable-shortcut' };
      }
      const link = parseShortcut(bytes);
      if (!link) {
        if (rawMentionsThisApp(bytes)) return { ok: false, reason: 'malformed-shortcut' };
        continue;
      }
      if (!mentionsThisApp(link.arguments)) continue;
      const args = readArguments(link.arguments);
      if (!args) return { ok: false, reason: 'unexpected-arguments' };
      const proxy = matchProxy(link.target, env);
      if (!proxy) return { ok: false, reason: 'unexpected-target' };
      const key = `${proxy.proxy.toLowerCase()}|${args.profile}|${APP_ID}`;
      installs.set(key, { browser: proxy.browser, proxy: proxy.proxy, profile: args.profile });
    }
  }
  return { ok: true, installs: [...installs.values()] };
}

// The ProgIds recorded for http in reg.exe's listing of the association key and its subkeys. Windows 11
// records the choice in UserChoiceLatest on newer builds and may leave UserChoice behind, so each present
// record is collected and the caller requires them all to agree.
export function parseDefaultBrowser(stdout) {
  if (typeof stdout !== 'string') return null;
  const found = [];
  let key = '';
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('HKEY_')) {
      key = line.trim().toLowerCase();
      continue;
    }
    const value = /^ {4}(\S+) {4}(REG_\w+) {4}(.*)$/.exec(line);
    if (!value || value[1].toLowerCase() !== 'progid' || value[2] !== 'REG_SZ') continue;
    if (/\\http\\(?:userchoice|userchoicelatest|userchoicelatest\\progid)$/.test(key)) found.push(value[3].trim());
  }
  if (found.length === 0) return null;
  return found.every((progId) => progId === found[0]) ? found[0] : null;
}

export function readDefaultBrowser({ env = process.env, run = execFile } = {}) {
  const systemRoot = env.SystemRoot;
  if (typeof systemRoot !== 'string' || !DRIVE_ROOT.test(systemRoot)) return Promise.resolve(null);
  const reg = win32.join(systemRoot, 'System32', 'reg.exe');
  const key = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http';
  return new Promise((resolve) => {
    try {
      run(reg, ['query', key, '/s'], { windowsHide: true, timeout: REG_TIMEOUT_MS, maxBuffer: 64 * 1024, encoding: 'latin1' },
        (error, stdout) => resolve(error ? null : parseDefaultBrowser(stdout)));
    } catch {
      resolve(null);
    }
  });
}

// Starts the proxy the way the shortcut would and reports whether it handed the window to the browser. A
// non-zero exit, a failure to start or no answer in time is false, and the caller opens the tab. The proxy
// is never killed: if it is merely slow, the reader may see a window and a tab, which is better than
// seeing nothing.
export function launchProxy(proxy, profile, { start = spawn, timeoutMs = PROXY_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = start(proxy, [`--profile-directory=${profile}`, `--app-id=${APP_ID}`], { stdio: 'ignore', detached: true });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.unref(); } catch { /* already gone */ }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('error', () => finish(false));
    child.once('exit', (code) => finish(code === 0));
  });
}

// What opening the app window would do, without doing it: the install to open, or the reason for the tab.
export async function resolveAppWindow(url, { platform = process.platform, env = process.env, fs, run } = {}) {
  if (platform !== 'win32') return { ok: false, reason: 'not-windows' };
  if (url !== APP_WINDOW_URL) return { ok: false, reason: 'other-address' };
  const found = await findInstalls({ env, ...(fs ? { fs } : {}) });
  if (!found.ok) return found;
  if (found.installs.length === 0) return { ok: false, reason: 'not-installed' };
  if (found.installs.length > 1) return { ok: false, reason: 'several-installs' };
  const [install] = found.installs;
  const progId = await readDefaultBrowser({ env, ...(run ? { run } : {}) });
  if (progId === null) return { ok: false, reason: 'unknown-default-browser' };
  if (progId !== install.browser.progId) return { ok: false, reason: 'other-default-browser' };
  try {
    await (fs ?? { stat }).stat(install.proxy).then((info) => {
      if (!info.isFile()) throw new Error('not a file');
    });
  } catch {
    return { ok: false, reason: 'missing-proxy' };
  }
  return { ok: true, install };
}

// True when the app window is opening, false when the caller should open the tab. Never throws.
export async function openAppWindow(url, deps = {}) {
  try {
    const resolved = await resolveAppWindow(url, deps);
    if (!resolved.ok) return false;
    return await launchProxy(resolved.install.proxy, resolved.install.profile, deps);
  } catch {
    return false;
  }
}
