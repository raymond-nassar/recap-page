import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';
import { createCloudCredentialPersistence } from './cloudCredentials.mjs';
import { validateCloudUploadSession } from './cloudProviderTransport.mjs';

const HEX = /^[a-f0-9]{64}$/;
const READY = 'recap-cloud-upload-session-v1\n';
const MAX_RECORD = 32768;

function failure() {
  return new Error('Protected cloud upload session is unavailable, incomplete or does not match its attempt. Preserve its files; the stream remains fenced.');
}

function hex(value) { return typeof value === 'string' && HEX.test(value); }

function retirementFailure() {
  return new Error('Protected upload session retirement or cleanup could not be verified. Preserve its files; no completed retirement was reported.');
}

function bindingOf(value) {
  if (!value || !hex(value.profileId) || !['google', 'microsoft'].includes(value.provider)
    || typeof value.accountId !== 'string' || !value.accountId || Buffer.byteLength(value.accountId) > 1024
    || !hex(value.streamId) || !hex(value.attemptId)
    || !Number.isSafeInteger(value.epoch) || value.epoch < 1
    || typeof value.slotId !== 'string' || !/^[A-Za-z0-9!_.:-]{1,256}$/.test(value.slotId)) throw failure();
  return {
    profileId: value.profileId, provider: value.provider,
    account: createHash('sha256').update(value.accountId).digest('hex'),
    streamId: value.streamId, attemptId: value.attemptId, epoch: value.epoch, slotId: value.slotId,
  };
}

async function regular(path, limit, directory = false) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory()
    : !info.isFile() || info.size === 0 || info.size > limit)) throw failure();
}

// Capability URLs never enter the unencrypted stream journal or browser transport.
export function createWindowsCloudUploadSessions({
  directory, platform = process.platform, loadSdk, readTerminal, removeCiphertext = unlink,
}) {
  if (platform !== 'win32' || typeof directory !== 'string' || !isAbsolute(directory)
    || (readTerminal !== undefined && typeof readTerminal !== 'function') || typeof removeCiphertext !== 'function') {
    throw new Error('Protected upload sessions require a Windows host-owned absolute storage directory.');
  }
  function paths(binding, reference) {
    const root = join(directory, 'upload-sessions', binding.profileId, binding.provider,
      binding.account, binding.streamId, reference);
    return { root, ready: join(root, 'ready'), retired: join(root, 'retired.json'),
      ciphertext: join(root, reference, 'credentials.bin') };
  }
  async function exists(path) {
    try { return await lstat(path); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async function active(retired) {
    if (await exists(retired)) throw failure();
  }
  async function persistence(root, reference) {
    return createCloudCredentialPersistence({ directory: root, profileId: reference, platform, loadSdk });
  }
  async function claim(root) {
    await regular(root, 0, true);
    const token = randomBytes(32).toString('hex');
    const file = await open(join(root, 'use.lock'), 'wx', 0o600);
    try { await file.writeFile(token); await file.sync(); } finally { await file.close(); }
    return async (location = root) => {
      await regular(join(location, 'use.lock'), 64);
      if (await readFile(join(location, 'use.lock'), 'utf8') !== token) throw failure();
      await unlink(join(location, 'use.lock'));
    };
  }
  async function use(root, operation) {
    const release = await claim(root);
    try { return await operation(); } finally { await release(); }
  }
  async function read(binding, reference) {
    if (!hex(reference)) throw failure();
    const { root, ready, ciphertext, retired } = paths(binding, reference);
    return use(root, async () => {
      await active(retired);
      await regular(root, 0, true);
      await regular(ready, Buffer.byteLength(READY));
      if (await readFile(ready, 'utf8') !== READY) throw failure();
      // The native SDK creates missing files on open, so require the completed ciphertext first.
      await regular(ciphertext, MAX_RECORD * 2);
      const store = await persistence(root, reference);
      const bytes = await store.load();
      if (typeof bytes !== 'string' || Buffer.byteLength(bytes) > MAX_RECORD) throw failure();
      const record = JSON.parse(bytes);
      if (!record || Object.keys(record).sort().join(',') !== 'binding,format,reference,target,version'
        || record.format !== 'recap-cloud-upload-session' || record.version !== 1
        || record.reference !== reference || JSON.stringify(record.binding) !== JSON.stringify(binding)
        || typeof record.target !== 'string'
        || validateCloudUploadSession(binding.provider, record.target) !== record.target) throw failure();
      await active(retired);
      return record.target;
    });
  }
  function terminalOf(proof, binding, reference) {
    const expected = { profileId: binding.profileId, provider: binding.provider, account: binding.account, streamId: binding.streamId };
    const attempt = proof?.attempt;
    if (JSON.stringify(proof?.binding) !== JSON.stringify(expected) || !Array.isArray(proof?.fixedSlots)
      || proof.fixedSlots.length !== 2 || !attempt || attempt.id !== binding.attemptId || attempt.epoch !== binding.epoch
      || !['acknowledged', 'failed'].includes(attempt.phase) || attempt.session !== reference
      || ![0, 1].includes(attempt.slot) || proof.fixedSlots[attempt.slot] !== binding.slotId
      || !hex(attempt.digest) || !Number.isSafeInteger(attempt.generation) || attempt.generation < 1) throw retirementFailure();
    return {
      attemptId: attempt.id, generation: attempt.generation, digest: attempt.digest,
      phase: attempt.phase, epoch: attempt.epoch, slotId: binding.slotId,
    };
  }
  async function retiredRecord(path, binding, reference) {
    if (!await exists(path)) return null;
    await regular(path, MAX_RECORD);
    const bytes = await readFile(path, 'utf8');
    const record = JSON.parse(bytes);
    const terminal = record?.terminal;
    if (!record || Object.keys(record).sort().join(',') !== 'binding,format,reference,terminal,version'
      || record.format !== 'recap-cloud-upload-retirement' || record.version !== 1
      || record.reference !== reference || JSON.stringify(record.binding) !== JSON.stringify(binding)
      || JSON.stringify(record) !== bytes || !terminal
      || Object.keys(terminal).sort().join(',') !== 'attemptId,digest,epoch,generation,phase,slotId'
      || terminal.attemptId !== binding.attemptId || terminal.epoch !== binding.epoch
      || terminal.slotId !== binding.slotId || !hex(terminal.digest)
      || !Number.isSafeInteger(terminal.generation) || terminal.generation < 1
      || !['acknowledged', 'failed'].includes(terminal.phase)) throw retirementFailure();
    return record;
  }
  return {
    async save({ binding, target }) {
      try {
        const exact = bindingOf(binding);
        const validated = validateCloudUploadSession(exact.provider, target);
        const reference = randomBytes(32).toString('hex');
        const { root, ready, ciphertext } = paths(exact, reference);
        const bytes = JSON.stringify({
          format: 'recap-cloud-upload-session', version: 1, reference, binding: exact, target: validated,
        });
        if (Buffer.byteLength(bytes) > MAX_RECORD) throw failure();
        await mkdir(join(root, '..'), { recursive: true, mode: 0o700 });
        await mkdir(root, { mode: 0o700 });
        await regular(root, 0, true);
        const store = await persistence(root, reference);
        await store.save(bytes);
        if (await store.load() !== bytes) throw failure();
        await regular(ciphertext, MAX_RECORD * 2);
        const file = await open(ciphertext, 'r+');
        try { await file.sync(); } finally { await file.close(); }
        const marker = await open(ready, 'wx', 0o600);
        try {
          await marker.writeFile(READY);
          await marker.sync();
        } finally { await marker.close(); }
        if (await read(exact, reference) !== validated) throw failure();
        return reference;
      } catch { throw failure(); }
    },
    async load({ binding, reference }) {
      try { return await read(bindingOf(binding), reference); }
      catch { throw failure(); }
    },
    async retire({ binding, reference }) {
      try {
        const exact = bindingOf(binding);
        if (!hex(reference)) throw retirementFailure();
        const { root, retired, ciphertext } = paths(exact, reference);
        await regular(root, 0, true);
        let record = await retiredRecord(retired, exact, reference);
        if (!record) {
          if (!readTerminal) throw retirementFailure();
          const terminal = terminalOf(await readTerminal(exact.attemptId), exact, reference);
          await read(exact, reference);
          record = { format: 'recap-cloud-upload-retirement', version: 1, binding: exact, reference, terminal };
          const marker = await open(retired, 'wx', 0o600);
          try {
            await marker.writeFile(JSON.stringify(record));
            await marker.sync();
          } finally { await marker.close(); }
          if (!await retiredRecord(retired, exact, reference)) throw retirementFailure();
        }
        await use(root, async () => {
          const info = await exists(ciphertext);
          if (info) {
            if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_RECORD * 2) throw retirementFailure();
            await removeCiphertext(ciphertext);
          }
          if (await exists(ciphertext)) throw retirementFailure();
        });
        return { retired: true, reference };
      } catch { throw retirementFailure(); }
    },
    async sweep({ profileId, provider, accountId, streamId }) {
      try {
        const scope = bindingOf({ profileId, provider, accountId, streamId, attemptId: '0'.repeat(64), epoch: 1, slotId: 'sweep' });
        const parent = join(directory, 'upload-sessions', profileId, provider, scope.account, streamId);
        if (!await exists(parent)) return { removed: 0, retained: 0 };
        await regular(parent, 0, true);
        const names = await readdir(parent);
        if (names.length > 8192 || names.some((name) => !/^(?:swept-)?[a-f0-9]{64}$/.test(name))) throw retirementFailure();
        let removed = 0;
        let retained = 0;
        for (const name of names) {
          const moved = name.startsWith('swept-');
          const reference = moved ? name.slice(6) : name;
          let root = join(parent, name);
          await regular(root, 0, true);
          let entries = (await readdir(root)).sort();
          if (moved && entries.length === 0) { await rmdir(root); removed++; continue; }
          const marker = join(root, 'retired.json');
          if (!await exists(marker)) {
            if (moved) throw retirementFailure();
            retained++;
            continue;
          }
          await regular(marker, MAX_RECORD);
          const raw = JSON.parse(await readFile(marker, 'utf8'));
          const binding = bindingOf({ ...raw.binding, accountId });
          if (binding.profileId !== scope.profileId || binding.provider !== scope.provider
            || binding.account !== scope.account || binding.streamId !== scope.streamId
            || !await retiredRecord(marker, binding, reference)) throw retirementFailure();
          if (entries.includes('use.lock')) { retained++; continue; }
          if (entries.some((entry) => ![reference, 'ready', 'retired.json'].includes(entry))) throw retirementFailure();
          const ready = join(root, 'ready');
          if (entries.includes('ready')) {
            await regular(ready, Buffer.byteLength(READY));
            if (await readFile(ready, 'utf8') !== READY) throw retirementFailure();
          }
          if (entries.includes(reference)) {
            await regular(join(root, reference), 0, true);
            if ((await readdir(join(root, reference))).length) throw retirementFailure();
          }
          if (!moved) {
            const release = await claim(root);
            const target = join(parent, `swept-${reference}`);
            let location = root;
            try {
              if (await exists(target)) throw retirementFailure();
              await rename(root, target);
              location = target;
              root = target;
            } finally { await release(location); }
          }
          // The old reference cannot reopen after rename. Partial pruning resumes only in this namespace.
          entries = await readdir(root);
          if (entries.includes('use.lock')) { retained++; continue; }
          if (entries.includes('ready')) await unlink(join(root, 'ready'));
          if (entries.includes(reference)) await rmdir(join(root, reference));
          await unlink(join(root, 'retired.json'));
          await rmdir(root);
          removed++;
        }
        return { removed, retained };
      } catch { throw retirementFailure(); }
    },
  };
}
