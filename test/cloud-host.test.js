import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCloudCredentialPersistence } from '../host/cloudCredentials.mjs';

const PROFILE = 'a'.repeat(64);

function fixture({ mismatch = false, saveError, deleteError, createError } = {}) {
  const calls = [];
  let value = null;
  const sdk = {
    DataProtectionScope: { CurrentUser: 'CurrentUser', LocalMachine: 'LocalMachine' },
    FilePersistenceWithDataProtection: {
      async create(path, scope, entropy, logger) {
        calls.push({ kind: 'create', path, scope, entropy, logger });
        if (createError) throw createError;
        return {
          async save(text) {
            calls.push({ kind: 'save', text });
            if (saveError) throw saveError;
            value = text;
          },
          async load() {
            calls.push({ kind: 'load' });
            return mismatch ? 'wrong bytes' : value;
          },
          async delete() {
            calls.push({ kind: 'delete' });
            if (deleteError) throw deleteError;
            return true;
          },
        };
      },
    },
  };
  return { calls, loadSdk: async () => sdk };
}

async function withDirectory(body) {
  const directory = await mkdtemp(join(tmpdir(), 'recap-cloud-host-'));
  try {
    await body(directory);
  } finally {
    const children = await readdir(directory);
    for (const child of children) await rmdir(join(directory, child));
    await rmdir(directory);
  }
}

test('unsupported cloud hosts reject before loading native code or touching disk', async () => {
  let loaded = false;
  for (const platform of ['linux', 'darwin', 'android', 'freebsd']) {
    await assert.rejects(createCloudCredentialPersistence({
      platform,
      directory: 'not used',
      profileId: PROFILE,
      loadSdk: async () => { loaded = true; throw new Error('must not load'); },
    }), /Local reading remains available/);
  }
  assert.equal(loaded, false);
});

test('credential paths require bounded profile identifiers and absolute host roots', async () => {
  const options = { platform: 'win32', loadSdk: async () => assert.fail('must not load') };
  await assert.rejects(createCloudCredentialPersistence({
    ...options, directory: 'relative', profileId: PROFILE,
  }), /absolute host-owned path/);
  for (const profileId of ['..', '../other', '..\\other', 'a'.repeat(63), 'A'.repeat(64), null]) {
    await assert.rejects(createCloudCredentialPersistence({
      ...options, directory: tmpdir(), profileId,
    }), /host-issued identifier/);
  }
});

test('CurrentUser protection is proved before the account cache is opened', async () => {
  await withDirectory(async (directory) => {
    const { calls, loadSdk } = fixture();
    const persistence = await createCloudCredentialPersistence({
      directory, profileId: PROFILE, platform: 'win32', loadSdk,
    });
    assert.equal(typeof persistence.save, 'function');
    assert.deepEqual(calls.map(({ kind }) => kind), ['create', 'save', 'load', 'delete', 'create']);
    const creates = calls.filter(({ kind }) => kind === 'create');
    assert.equal(creates[1].path, join(directory, PROFILE, 'credentials.bin'));
    assert.match(creates[0].path, /protection-[a-f0-9-]+\.bin$/);
    for (const entry of creates) {
      assert.equal(entry.scope, 'CurrentUser');
      assert.equal(entry.entropy, undefined);
      assert.equal(entry.logger.piiLoggingEnabled, false);
    }
  });
});

test('profiles never share cache locations and protection probes are unique', async () => {
  await withDirectory(async (directory) => {
    const { calls, loadSdk } = fixture();
    for (const profileId of [PROFILE, 'b'.repeat(64), PROFILE]) {
      await createCloudCredentialPersistence({
        directory, profileId, platform: 'win32', loadSdk,
      });
    }
    const paths = calls.filter(({ kind }) => kind === 'create').map(({ path }) => path);
    assert.equal(new Set([paths[0], paths[2], paths[4]]).size, 3);
    assert.notEqual(paths[1], paths[3]);
    assert.equal(paths[1], paths[5]);
  });
});

test('missing native dependencies remain an explicit cloud failure without a plaintext substitute', async () => {
  const failure = new Error('native dependency unavailable');
  await assert.rejects(createCloudCredentialPersistence({
    directory: tmpdir(), profileId: PROFILE, platform: 'win32',
    loadSdk: async () => { throw failure; },
  }), (error) => error === failure);
});

test('encryption, read-back and cleanup failures prevent opening the account cache', async () => {
  await withDirectory(async (directory) => {
    const saveError = new Error('protection unavailable');
    const createError = new Error('native cache unavailable');
    const deleteError = new Error('protection probe cleanup failed');
    for (const options of [{ saveError }, { mismatch: true }, { deleteError }, { createError }]) {
      const { calls, loadSdk } = fixture(options);
      await assert.rejects(createCloudCredentialPersistence({
        directory, profileId: PROFILE, platform: 'win32', loadSdk,
      }), options.saveError || options.deleteError || options.createError
        ? (error) => error === (options.saveError || options.deleteError || options.createError)
        : /could not be verified/);
      assert.equal(calls.filter(({ kind }) => kind === 'create').length, 1);
      assert.equal(calls.some(({ path }) => path?.endsWith('credentials.bin')), false);
      assert.equal(calls.filter(({ kind }) => kind === 'delete').length, createError === options.createError ? 0 : 1);
    }
  });
});
