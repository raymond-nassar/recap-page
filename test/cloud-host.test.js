import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rmdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCloudCredentialPersistence } from '../host/cloudCredentials.mjs';
import { createHash } from 'node:crypto';
import { createCloudOAuthTransactions } from '../host/cloudOAuth.mjs';
import { startCloudOAuthCallback } from '../host/cloudCallback.mjs';
import { request } from 'node:http';
import { createWindowsCloudAuth } from '../host/windowsCloudAuth.mjs';

const PROFILE = 'a'.repeat(64);
const CALLBACK = 'http://localhost:49152/cloud/oauth/callback';

function nativeAuthFixture(provider, { exchange, tokenInfo, tokenError, persistenceError } = {}) {
  const files = new Map();
  const calls = [];
  let nonce;
  let client;
  const identity = { homeAccountId: 'stable-microsoft-account', username: 'reader@example.test' };
  const googleTokens = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', id_token: 'synthetic-identity' };
  const result = { accessToken: 'synthetic-access', scopes: ['Files.ReadWrite.AppFolder'], account: identity };
  function authorization(options, microsoft) {
    calls.push({ kind: 'authorize', options });
    nonce = options.nonce;
    const url = new URL(microsoft
      ? 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'
      : 'https://accounts.google.com/o/oauth2/v2/auth');
    for (const [key, value] of Object.entries(options)) url.searchParams.set(key, String(value));
    return url.href;
  }
  class GoogleClient {
    constructor(options) { client = this; this.options = options; this.credentials = {}; }
    generateAuthUrl(options) { return authorization(options, false); }
    async getToken(options) {
      calls.push({ kind: 'exchange', options });
      if (exchange) await exchange();
      if (tokenError) throw tokenError;
      return { tokens: googleTokens };
    }
    async verifyIdToken(options) {
      calls.push({ kind: 'verify', options });
      return { getPayload: () => ({ sub: 'stable-google-account', nonce }) };
    }
    async getTokenInfo(token) {
      calls.push({ kind: 'info', token });
      return tokenInfo || {
        aud: 'public-client', sub: 'stable-google-account', email: 'reader@example.test',
        scopes: ['https://www.googleapis.com/auth/drive.appdata'],
      };
    }
    setCredentials(credentials) { this.credentials = credentials; }
    async getAccessToken() { return { token: this.credentials.access_token }; }
  }
  class MicrosoftClient {
    constructor(options) { client = this; this.options = options; this.cache = ''; }
    async getAuthCodeUrl(options) { return authorization(options, true); }
    async acquireTokenByCode(options) {
      calls.push({ kind: 'exchange', options });
      if (exchange) await exchange();
      if (tokenError) throw tokenError;
      this.cache = JSON.stringify({ accounts: [identity], token: 'synthetic-access', padding: 'x'.repeat(9000) });
      return result;
    }
    getTokenCache() {
      return {
        serialize: () => this.cache,
        deserialize: (value) => { this.cache = value; },
        getAllAccounts: async () => JSON.parse(this.cache).accounts,
      };
    }
    async acquireTokenSilent(options) { calls.push({ kind: 'silent', options }); return result; }
  }
  return {
    files, calls, getClient: () => client,
    options: {
      provider, clientId: 'public-client', profileId: PROFILE, epoch: 1,
      platform: 'win32', isCurrent: () => true,
      fetchImpl: async () => assert.fail('Fake SDK authentication must not use the network'),
      loadMsal: async () => ({ PublicClientApplication: MicrosoftClient }),
      loadGoogle: async () => ({ OAuth2Client: GoogleClient }),
      loadPersistenceSdk: async () => ({
        DataProtectionScope: { CurrentUser: 'CurrentUser' },
        FilePersistenceWithDataProtection: {
          async create(path) {
            return {
              async save(value) {
                if (persistenceError && path.endsWith('credentials.bin')) throw persistenceError;
                files.set(path, value);
              },
              async load() { return files.get(path) || null; },
              async delete() { files.delete(path); return true; },
            };
          },
        },
      }),
      async openBrowser(target) {
        const url = new URL(target);
        const redirectUri = url.searchParams.get(provider === 'microsoft' ? 'redirectUri' : 'redirect_uri');
        const response = await callbackRequest({ redirectUri },
          `/?state=${url.searchParams.get('state')}&code=synthetic-code`);
        assert.equal(response.status, 200);
      },
    },
  };
}

async function withAuthDirectory(body) {
  const directory = await mkdtemp(join(tmpdir(), 'recap-native-auth-'));
  try { await body(directory); } finally { await rm(directory, { recursive: true }); }
}

test('Windows SDK sign-in exchanges loopback PKCE natively and reopens provider-separated protected caches', async () => {
  await withAuthDirectory(async (directory) => {
    for (const provider of ['microsoft', 'google']) {
      const fixture = nativeAuthFixture(provider);
      const auth = await createWindowsCloudAuth({ ...fixture.options, directory });
      assert.equal(auth.status().account, null);
      const connected = await auth.connect();
      assert.equal(connected.account.label, 'reader@example.test');
      assert.doesNotMatch(JSON.stringify(connected), /synthetic-access|synthetic-refresh|synthetic-identity/);
      const request = fixture.calls.find(({ kind }) => kind === 'exchange').options;
      assert.match(request.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
      const cachePath = [...fixture.files.keys()].find((path) => path.endsWith('credentials.bin'));
      assert.equal(cachePath, join(directory, provider, PROFILE, 'credentials.bin'));
      assert.equal(await auth.getAccessToken(), 'synthetic-access');
      const reopened = await createWindowsCloudAuth({ ...fixture.options, directory });
      assert.equal(reopened.status().account.id, connected.account.id);
      assert.equal(await reopened.getAccessToken(), 'synthetic-access');
      assert.equal(fixture.calls.filter(({ kind }) => kind === 'authorize').length, 1);
      await reopened.disconnect();
      assert.equal(fixture.files.size, 0);
      await assert.rejects(reopened.getAccessToken(), /no longer active/);
    }
  });
});

test('Windows auth rejects partial Google permission and changed account or client without persisting credentials', async () => {
  await withAuthDirectory(async (directory) => {
    for (const tokenInfo of [
      { scopes: [], aud: 'public-client', sub: 'stable-google-account' },
      { scopes: ['https://www.googleapis.com/auth/drive.appdata'], aud: 'other-client', sub: 'stable-google-account' },
      { scopes: ['https://www.googleapis.com/auth/drive.appdata'], aud: 'public-client', sub: 'other-account' },
    ]) {
      const fixture = nativeAuthFixture('google', { tokenInfo });
      const auth = await createWindowsCloudAuth({ ...fixture.options, directory });
      await assert.rejects(auth.connect(), /permission|different account/);
      assert.equal(auth.status().account, null);
      assert.equal(fixture.files.size, 0);
      await auth.disconnect();
    }
  });
});

test('disconnect during SDK exchange invalidates late completion before protected cache or status commit', async () => {
  await withAuthDirectory(async (directory) => {
    for (const provider of ['microsoft', 'google']) {
      let release;
      let started;
      const pending = new Promise((resolve) => { started = resolve; });
      const held = new Promise((resolve) => { release = resolve; });
      const fixture = nativeAuthFixture(provider, { exchange: () => { started(); return held; } });
      const auth = await createWindowsCloudAuth({ ...fixture.options, directory });
      const connecting = auth.connect();
      await pending;
      const failure = assert.rejects(connecting, /no longer active/);
      const disconnected = auth.disconnect();
      release();
      await failure;
      await disconnected;
      assert.equal(fixture.files.size, 0);
      assert.throws(() => auth.status(), /no longer active/);
    }
  });
});

test('a stale connection epoch and failed native cache saves cannot report connected status', async () => {
  await withAuthDirectory(async (directory) => {
    let current = true;
    const stale = nativeAuthFixture('google', { exchange: async () => { current = false; } });
    const auth = await createWindowsCloudAuth({ ...stale.options, directory, isCurrent: () => current });
    await assert.rejects(auth.connect(), /no longer active/);
    assert.equal(stale.files.size, 0);
    await auth.disconnect();
    const failed = nativeAuthFixture('google', { persistenceError: new Error('PRIVATE_CACHE_DETAIL') });
    const failedAuth = await createWindowsCloudAuth({ ...failed.options, directory });
    await assert.rejects(failedAuth.connect(), (error) =>
      /authentication failed/.test(error.message) && !error.message.includes('PRIVATE_CACHE_DETAIL'));
    assert.equal(failedAuth.status().account, null);
    await failedAuth.disconnect();
  });
});

test('SDK failures stay explicit and never expose native token-bearing diagnostics', async () => {
  await withAuthDirectory(async (directory) => {
    for (const provider of ['microsoft', 'google']) {
      const fixture = nativeAuthFixture(provider, { tokenError: new Error('PRIVATE_ACCESS_TOKEN') });
      const auth = await createWindowsCloudAuth({ ...fixture.options, directory });
      await assert.rejects(auth.connect(), (error) =>
        /authentication failed/.test(error.message) && !error.message.includes('PRIVATE_ACCESS_TOKEN'));
      assert.equal(auth.status().account, null);
      assert.equal(fixture.files.size, 0);
      await auth.disconnect();
    }
  });
});

test('a corrupt protected cache remains explicitly disconnectable without attempting sign-in or refresh', async () => {
  await withAuthDirectory(async (directory) => {
    const fixture = nativeAuthFixture('google');
    const path = join(directory, 'google', PROFILE, 'credentials.bin');
    fixture.files.set(path, 'corrupt protected cache');
    const auth = await createWindowsCloudAuth({ ...fixture.options, directory });
    assert.equal(auth.status().state, 'reconnect-required');
    assert.equal(auth.status().account, null);
    await assert.rejects(auth.connect(), /could not be read/);
    await assert.rejects(auth.getAccessToken(), /could not be read/);
    assert.equal(fixture.calls.length, 0);
    await auth.disconnect();
    assert.equal(fixture.files.size, 0);
  });
});

test('authentication transports refuse unrelated origins and bound SDK requests without implicit retries or redirects', async () => {
  await withAuthDirectory(async (directory) => {
    const fixture = nativeAuthFixture('google');
    const calls = [];
    const auth = await createWindowsCloudAuth({
      ...fixture.options, directory,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return globalThis.Response.json({ scope: 'synthetic' });
      },
    });
    const transport = fixture.getClient().options.transporter;
    await assert.rejects(transport.request({ url: 'https://attacker.example/token', method: 'POST' }), /unsupported endpoint/);
    assert.equal(calls.length, 0);
    const response = await transport.request({ url: 'https://oauth2.googleapis.com/tokeninfo', method: 'POST' });
    assert.equal(response.data.scope, 'synthetic');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.redirect, 'error');
    assert(calls[0].options.signal);
    await auth.disconnect();
  });
});

function oauthFixture() {
  let time = 1000;
  const transactions = createCloudOAuthTransactions({ now: () => time });
  const context = { profileId: PROFILE, provider: 'microsoft', epoch: 1, redirectUri: CALLBACK };
  return { transactions, context, advance: (duration) => { time += duration; } };
}

function callbackRequest(handle, target, { headers = {}, method = 'GET' } = {}) {
  const url = new URL(handle.redirectUri);
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port: url.port, path: target, method,
      headers: { host: url.host, ...headers }, agent: false,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (part) => { text += part; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
      res.on('error', reject);
    });
    req.setTimeout(2000, () => req.destroy(new Error('Synthetic callback timed out')));
    req.on('error', reject);
    req.end();
  });
}

test('temporary callback listeners bind IPv4 loopback and deliver native-only codes for both providers', async () => {
  for (const provider of ['microsoft', 'google']) {
    const transactions = createCloudOAuthTransactions();
    const handle = await startCloudOAuthCallback({ transactions, profileId: PROFILE, provider, epoch: 1 });
    try {
      assert.equal(new URL(handle.redirectUri).hostname, provider === 'microsoft' ? 'localhost' : '127.0.0.1');
      assert.notEqual(new URL(handle.redirectUri).port, '8787');
      const response = await callbackRequest(handle, `/?state=${handle.authorization.state}&code=synthetic-code`);
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.doesNotMatch(response.text, /synthetic-code|codeVerifier/);
      const outcome = await handle.completion;
      assert.equal(outcome.status, 'received');
      assert.equal(outcome.code, 'synthetic-code');
      assert.equal(createHash('sha256').update(outcome.codeVerifier).digest('base64url'), handle.authorization.codeChallenge);
      await assert.rejects(callbackRequest(handle, '/'), /ECONNREFUSED|ECONNRESET/);
    } finally {
      handle.cancel();
      await handle.completion;
    }
  }
});

test('callback listener rejects hostile request shapes without losing the valid pending sign-in', async () => {
  const handle = await startCloudOAuthCallback({
    transactions: createCloudOAuthTransactions(), profileId: PROFILE, provider: 'microsoft', epoch: 1,
  });
  const target = `/?state=${handle.authorization.state}&code=synthetic-code`;
  try {
    for (const [path, options, status] of [
      [target, { headers: { host: 'attacker.example' } }, 400],
      [target, { headers: { origin: 'https://attacker.example' } }, 400],
      [target, { method: 'POST' }, 405],
      [`/other${target}`, {}, 400],
      ['/?state=wrong&code=bad', {}, 400],
      [`http://attacker.example${target}`, {}, 400],
    ]) {
      assert.equal((await callbackRequest(handle, path, options)).status, status);
    }
    assert.equal((await callbackRequest(handle, target)).status, 200);
    assert.equal((await handle.completion).status, 'received');
  } finally {
    handle.cancel();
    await handle.completion;
  }
});

test('callback cancellation and expiry close the listener without cancelling a newer profile transaction', async () => {
  for (const reason of ['cancelled', 'expired']) {
    const transactions = createCloudOAuthTransactions();
    let expire;
    const controller = new AbortController();
    const handle = await startCloudOAuthCallback({
      transactions, profileId: PROFILE, provider: 'google', epoch: 1, signal: controller.signal,
      scheduleExpiry: (callback) => { expire = callback; return 1; },
      clearExpiry: () => {},
    });
    const binding = { profileId: PROFILE, provider: 'google', epoch: 2, redirectUri: handle.redirectUri };
    const newer = transactions.begin(binding);
    if (reason === 'expired') expire();
    else controller.abort();
    assert.equal((await handle.completion).status, reason);
    await assert.rejects(callbackRequest(handle, '/'), /ECONNREFUSED|ECONNRESET/);
    assert.equal(transactions.consume({
      ...binding, callbackUrl: `${handle.redirectUri}?state=${newer.state}&code=newer`,
    }).code, 'newer');
    handle.cancel();
  }
});

test('provider denial closes callback with explicit failure and never echoes provider details', async () => {
  const handle = await startCloudOAuthCallback({
    transactions: createCloudOAuthTransactions(), profileId: PROFILE, provider: 'google', epoch: 1,
  });
  try {
    const response = await callbackRequest(handle,
      `/?state=${handle.authorization.state}&error=access_denied&error_description=PRIVATE_DETAIL`);
    assert.equal(response.status, 400);
    assert.doesNotMatch(response.text, /PRIVATE_DETAIL|access_denied/);
    const outcome = await handle.completion;
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.message, /denied|cancelled/);
    assert.doesNotMatch(outcome.message, /PRIVATE_DETAIL/);
  } finally {
    handle.cancel();
    await handle.completion;
  }
});

test('callback internal faults terminate sign-in explicitly without reflecting native error details', async () => {
  const transactions = createCloudOAuthTransactions();
  const handle = await startCloudOAuthCallback({
    transactions: {
      ...transactions,
      consume() { throw new Error('PRIVATE_INTERNAL_TOKEN'); },
    },
    profileId: PROFILE, provider: 'google', epoch: 1,
  });
  try {
    const response = await callbackRequest(handle, `/?state=${handle.authorization.state}&code=synthetic`);
    assert.equal(response.status, 500);
    assert.doesNotMatch(response.text, /PRIVATE_INTERNAL_TOKEN/);
    const outcome = await handle.completion;
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.message, /unexpectedly/);
    assert.doesNotMatch(outcome.message, /PRIVATE_INTERNAL_TOKEN/);
    await assert.rejects(callbackRequest(handle, '/'), /ECONNREFUSED|ECONNRESET/);
  } finally {
    handle.cancel();
    await handle.completion;
  }
});

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
