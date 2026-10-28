// The connection's tokens at rest: one file in this Windows user's local application data, protected with
// Windows data protection for the current user, so another account on the computer or a copy of the disk
// cannot read it. It holds the refresh token, the connection id and the account, never an access token.
//
// Node has no built-in route to that protection and OD-03 rules out a native addon, so the inbox Windows
// PowerShell 5.1 does the protecting (coordinator, 2026-10-28), on four conditions: the script is fixed
// text and never assembled from data; the bytes travel on standard input only, never in an argument; its
// answer is read from the exit code and base64 alone, so a non-English Windows works; and it runs only
// when a connection is stored or first needed, never at startup. Measured on this project's ARM64
// Windows 11 machine on 2026-10-28: 0.33 to 0.44 seconds a call. Commit 5b8d9c94 removed PowerShell from
// packaged startup verification because a busy hosted runner took eight seconds to start it, hence the
// generous deadline here, where nobody is waiting on startup.
//
// Same-user processes can still read the tokens through the same protection. That is accepted and stated
// (P02-T01 threat T3): anything running as the person can already act as the person.

import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { systemDirectory } from './cloudSession.mjs';

export const PROTECT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { exit 3 }",
  'Add-Type -AssemblyName System.Security',
  '$mode = [Console]::In.ReadLine()',
  '$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
  "$entropy = [Text.Encoding]::UTF8.GetBytes('recap-page-cloud-tokens-v1')",
  '$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser',
  "if ($mode -eq 'protect') { $out = [Security.Cryptography.ProtectedData]::Protect($data, $entropy, $scope) }",
  "elseif ($mode -eq 'unprotect') { try { $out = [Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, $scope) } catch { exit 4 } }",
  'else { exit 2 }',
  '[Console]::Out.Write([Convert]::ToBase64String($out))',
  'exit 0',
].join('\n');
const ENCODED_SCRIPT = Buffer.from(PROTECT_SCRIPT, 'utf16le').toString('base64');
const PROTECT_MS = 20_000;
const MAX_OUTPUT = 1024 * 1024;
const MAX_RECORD = 64 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const CONNECTION = /^[a-f0-9]{32}$/;
// The app folder's OneDrive item id, by which the host lists and creates, so a deleted folder is noticed.
const FOLDER_ID = /^[A-Za-z0-9!._-]{1,256}$/;
export const TOKEN_FILE = 'onedrive.v1';

const REASONS = Object.freeze({
  platform: 'Cloud backup can keep a sign-in only on Windows in this version.',
  language: 'Windows is restricting PowerShell on this computer, so cloud backup cannot protect a sign-in here.',
  unreadable: 'The saved sign-in could not be read on this Windows account, so it has to be made again.',
  failed: 'Windows could not protect or read the cloud backup sign-in.',
  timeout: 'Windows took too long to protect or read the cloud backup sign-in.',
  invalid: 'The saved cloud backup sign-in is not one this version can use.',
});

export class CloudTokenError extends Error {
  constructor(code) {
    super(REASONS[code] ?? REASONS.failed);
    this.name = 'CloudTokenError';
    this.code = code;
  }
}

export function powershellPath(system = systemDirectory()) {
  return join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

// The arguments are the same for every call and carry no data: the only variable input is on stdin.
export function protectCommand(system = systemDirectory()) {
  return { command: powershellPath(system), args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_SCRIPT] };
}

export function createProtector({
  platform = process.platform, spawnImpl = spawn, system = systemDirectory(), timeoutMs = PROTECT_MS,
} = {}) {
  function call(mode, bytes) {
    if (platform !== 'win32') return Promise.reject(new CloudTokenError('platform'));
    return new Promise((resolve, reject) => {
      const { command, args } = protectCommand(system);
      let child;
      try { child = spawnImpl(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); }
      catch { reject(new CloudTokenError('failed')); return; }
      const chunks = [];
      let size = 0;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* already gone */ }
        finish(new CloudTokenError('timeout'));
      }, timeoutMs);
      child.on('error', () => finish(new CloudTokenError('failed')));
      child.stdout.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_OUTPUT) {
          try { child.kill(); } catch { /* already gone */ }
          finish(new CloudTokenError('failed'));
          return;
        }
        chunks.push(chunk);
      });
      child.on('close', (code) => {
        if (code === 3) { finish(new CloudTokenError('language')); return; }
        if (code === 4) { finish(new CloudTokenError('unreadable')); return; }
        const text = Buffer.concat(chunks).toString('latin1').trim();
        if (code !== 0 || !BASE64.test(text) || text.length === 0) { finish(new CloudTokenError('failed')); return; }
        finish(null, Buffer.from(text, 'base64'));
      });
      child.stdin.on('error', () => { /* the exit code decides */ });
      child.stdin.end(`${mode}\n${Buffer.from(bytes).toString('base64')}`);
    });
  }
  return {
    protect: (bytes) => call('protect', bytes),
    unprotect: (bytes) => call('unprotect', bytes),
  };
}

// Local application data is private to the person, and for an installed package Windows keeps it in the
// package's own location and removes it on uninstall.
export function tokenDirectory(env = process.env) {
  const base = typeof env.LOCALAPPDATA === 'string' && /^[A-Za-z]:\\/.test(env.LOCALAPPDATA) ? env.LOCALAPPDATA : null;
  return base ? join(base, 'Recap Page', 'cloud') : null;
}

function validText(value, limit) {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
    && [...value].every((character) => character.codePointAt(0) > 0x1f && character.codePointAt(0) !== 0x7f);
}

export function validRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'account,connection,folder,provider,refreshToken,savedAt,version'
    && value.version === 1 && value.provider === 'onedrive' && typeof value.connection === 'string'
    && CONNECTION.test(value.connection) && value.account !== null && typeof value.account === 'object'
    && Object.keys(value.account).sort().join(',') === 'hint,id' && validText(value.account.id, 512)
    && (value.account.hint === null || validText(value.account.hint, 256))
    && (value.folder === null || (typeof value.folder === 'string' && FOLDER_ID.test(value.folder)))
    && (value.refreshToken === null || validText(value.refreshToken, 16 * 1024))
    && Number.isSafeInteger(value.savedAt) && value.savedAt >= 0;
}

export function createTokenStore({ directory, protector, fs = { mkdir, readFile, rename, rm, stat, writeFile } } = {}) {
  const file = directory ? join(directory, TOKEN_FILE) : null;
  return {
    // Whether a sign-in is stored at all, answered without PowerShell, so a computer that never
    // connected never starts it.
    async exists() {
      if (!file) return false;
      try {
        return (await fs.stat(file)).isFile();
      } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw new CloudTokenError('failed');
      }
    },
    async load() {
      if (!file) throw new CloudTokenError('platform');
      let sealed;
      try { sealed = await fs.readFile(file); }
      catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw new CloudTokenError('failed');
      }
      if (sealed.length === 0 || sealed.length > MAX_RECORD) throw new CloudTokenError('unreadable');
      const plain = await protector.unprotect(sealed);
      let value;
      try { value = JSON.parse(plain.toString('utf8')); }
      catch { throw new CloudTokenError('invalid'); }
      if (!validRecord(value)) throw new CloudTokenError('invalid');
      return value;
    },
    // Written beside the file and renamed over it, so a crash leaves the old sign-in or the new one,
    // never half of either.
    async save(record) {
      if (!file) throw new CloudTokenError('platform');
      if (!validRecord(record)) throw new CloudTokenError('invalid');
      const sealed = await protector.protect(Buffer.from(JSON.stringify(record), 'utf8'));
      if (sealed.includes(Buffer.from(record.refreshToken ?? record.connection, 'utf8'))) throw new CloudTokenError('failed');
      try {
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(`${file}.tmp`, sealed);
        await fs.rename(`${file}.tmp`, file);
      } catch {
        throw new CloudTokenError('failed');
      }
    },
    async clear() {
      if (!file) return;
      try {
        await fs.rm(`${file}.tmp`, { force: true });
        await fs.rm(file, { force: true });
      } catch {
        throw new CloudTokenError('failed');
      }
    },
  };
}
