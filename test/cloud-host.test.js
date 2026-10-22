import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCloudCredentialPersistence } from '../host/cloudCredentials.mjs';
import { createHash } from 'node:crypto';
import { createCloudOAuthTransactions } from '../host/cloudOAuth.mjs';

const PROFILE = 'a'.repeat(64);
const CALLBACK = 'http://localhost:49152/cloud/oauth/callback';

function oauthFixture() {
  let time = 1000;
  const transactions = createCloudOAuthTransactions({ now: () => time });
  const context = { profileId: PROFILE, provider: 'microsoft', epoch: 1, redirectUri: CALLBACK };
  return { transactions, context, advance: (duration) => { time += duration; } };
}

test('OAuth transactions expose S256 challenges but keep verifiers host-side until consumption', () => {
  const { transactions, context } = oauthFixture();
  const request = transactions.begin(context);
  assert.match(request.state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(request.codeChallengeMethod, 'S256');
  assert.equal(Object.hasOwn(request, 'codeVerifier'), false);
  const result = transactions.consume({
    ...context, callbackUrl: `${CALLBACK}?state=${request.state}&code=synthetic-code`,
  });
  assert.equal(result.code, 'synthetic-code');
  assert.equal(createHash('sha256').update(result.codeVerifier).digest('base64url'), request.codeChallenge);
  assert.equal(result.redirectUri, CALLBACK);
  assert.throws(() => transactions.consume({
    ...context, callbackUrl: `${CALLBACK}?state=${request.state}&code=synthetic-code`,
  }), /not active/);
});

test('OAuth expiry, replacement and cancellation invalidate pending attempts without affecting other profiles', () => {
  const { transactions, context, advance } = oauthFixture();
  const old = transactions.begin(context);
  const current = transactions.begin(context);
  const otherContext = { ...context, profileId: 'b'.repeat(64) };
  const other = transactions.begin(otherContext);
  assert.notEqual(old.state, current.state);
  assert.throws(() => transactions.consume({
    ...context, callbackUrl: `${CALLBACK}?state=${old.state}&code=old`,
  }), /not active/);
  transactions.cancel(PROFILE);
  assert.throws(() => transactions.consume({
    ...context, callbackUrl: `${CALLBACK}?state=${current.state}&code=cancelled`,
  }), /not active/);
  assert.equal(transactions.consume({
    ...otherContext, callbackUrl: `${CALLBACK}?state=${other.state}&code=other`,
  }).code, 'other');
  const expiring = transactions.begin(context);
  advance(5 * 60 * 1000);
  assert.throws(() => transactions.consume({
    ...context, callbackUrl: `${CALLBACK}?state=${expiring.state}&code=expired`,
  }), /not active/);
});

test('OAuth callbacks require exact redirect, profile, provider and connection epoch', () => {
  for (const change of [
    { profileId: 'b'.repeat(64) }, { provider: 'google' }, { epoch: 2 },
    { base: 'http://localhost:49153/cloud/oauth/callback' },
    { base: 'http://127.0.0.1:49152/cloud/oauth/callback' },
    { base: 'http://localhost:49152/cloud/oauth/other' },
    { base: 'http://user@localhost:49152/cloud/oauth/callback' },
    { base: 'http://LOCALHOST:49152/cloud/oauth/callback' },
    { base: 'http://localhost:49152/cloud/oauth/other/../callback' },
  ]) {
    const { transactions, context } = oauthFixture();
    const request = transactions.begin(context);
    const { base = CALLBACK, ...binding } = change;
    assert.throws(() => transactions.consume({
      ...context, ...binding, callbackUrl: `${base}?state=${request.state}&code=wrong`,
    }), /does not match/);
    assert.equal(transactions.consume({
      ...context, callbackUrl: `${CALLBACK}?state=${request.state}&code=right`,
    }).code, 'right');
  }
});

test('OAuth provider denial and malformed results consume valid attempts without reflecting provider text', () => {
  for (const suffix of [
    'error=access_denied&error_description=PRIVATE_PROVIDER_TEXT',
    'code=a&code=b', 'code=', 'code=a&error=access_denied', 'unexpected=value',
    `code=${'x'.repeat(8193)}`,
  ]) {
    const { transactions, context } = oauthFixture();
    const request = transactions.begin(context);
    const callbackUrl = `${CALLBACK}?state=${request.state}&${suffix}`;
    assert.throws(() => transactions.consume({ ...context, callbackUrl }), (error) =>
      /denied|invalid/.test(error.message) && !error.message.includes('PRIVATE_PROVIDER_TEXT'));
    assert.throws(() => transactions.consume({
      ...context, callbackUrl: `${CALLBACK}?state=${request.state}&code=retry`,
    }), /not active/);
  }
});

test('OAuth rejects malformed callback state and callback fragments without leaking or consuming another attempt', () => {
  const { transactions, context } = oauthFixture();
  const request = transactions.begin(context);
  for (const callbackUrl of [
    'not a URL', `${CALLBACK}?code=a`, `${CALLBACK}?state=unknown&code=a`,
    `${CALLBACK}?state=${request.state}&state=${request.state}&code=a`,
    `${CALLBACK}?state=${request.state}&code=a#fragment`,
  ]) {
    assert.throws(() => transactions.consume({ ...context, callbackUrl }), /invalid|not active/);
  }
  assert.equal(transactions.consume({
    ...context, callbackUrl: `${CALLBACK}?state=${request.state}&code=valid`,
  }).code, 'valid');
});

test('OAuth setup rejects arbitrary callbacks and bounds pending host transactions', () => {
  const { transactions, context, advance } = oauthFixture();
  for (const [provider, redirectUri] of [
    ['microsoft', 'http://localhost:49153/'],
    ['google', 'http://127.0.0.1:49154/'],
  ]) {
    const binding = { ...context, provider, redirectUri };
    const attempt = transactions.begin(binding);
    assert.equal(transactions.consume({
      ...binding, callbackUrl: `${redirectUri}?state=${attempt.state}&code=root-callback`,
    }).code, 'root-callback');
  }
  for (const redirectUri of [
    'https://example.com/callback', 'http://localhost/cloud/oauth/callback',
    'http://localhost:8787/cloud/oauth/callback', `${CALLBACK}?query=1`, `${CALLBACK}#fragment`,
    'http://user@localhost:49152/cloud/oauth/callback',
    'http://localhost:49152/other',
  ]) assert.throws(() => transactions.begin({ ...context, redirectUri }), /callback/);
  for (const change of [{ provider: 'other' }, { profileId: '..' }, { epoch: -1 }, { epoch: 1.5 }]) {
    assert.throws(() => transactions.begin({ ...context, ...change }), /binding/);
  }
  for (let index = 0; index < 32; index++) {
    transactions.begin({ ...context, profileId: index.toString(16).padStart(64, '0') });
  }
  assert.throws(() => transactions.begin(context), /Too many/);
  advance(5 * 60 * 1000);
  assert.doesNotThrow(() => transactions.begin(context));
});

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
