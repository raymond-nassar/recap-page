import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { createCloudCredentialPersistence } from './cloudCredentials.mjs';
import { createCloudOAuthTransactions } from './cloudOAuth.mjs';
import { startCloudOAuthCallback } from './cloudCallback.mjs';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const MICROSOFT_SCOPE = 'Files.ReadWrite.AppFolder';
const CACHE_LIMIT = 1024 * 1024;

export class CloudAuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CloudAuthenticationError';
  }
}

function requireValue(value, message) {
  if (typeof value !== 'string' || !value || value.length > 8192) {
    throw new CloudAuthenticationError(message);
  }
  return value;
}

function requireScope(scopes, scope) {
  if (!Array.isArray(scopes) || !scopes.some((value) =>
    typeof value === 'string' && value.toLowerCase() === scope.toLowerCase())) {
    throw new CloudAuthenticationError('The required private app-storage permission was not granted.');
  }
}

function boundedTransport(provider, fetchImpl) {
  return async (target, options = {}) => {
    const url = new URL(target);
    const allowed = provider === 'microsoft'
      ? url.origin === 'https://login.microsoftonline.com'
      : (url.origin === 'https://oauth2.googleapis.com' && ['/token', '/tokeninfo'].includes(url.pathname))
        || (url.origin === 'https://www.googleapis.com' && url.pathname === '/oauth2/v1/certs');
    if (!allowed || url.username || url.password || url.hash) {
      throw new CloudAuthenticationError('The authentication SDK requested an unsupported endpoint.');
    }
    const response = await fetchImpl(url, {
      ...options, redirect: 'error', signal: globalThis.AbortSignal.timeout(30000),
    });
    if (!response.ok || !response.body) {
      throw new CloudAuthenticationError('The provider could not complete authentication. Reconnect when ready.');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > CACHE_LIMIT) {
          throw new CloudAuthenticationError('The authentication response exceeded its size limit.');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    return { response, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  };
}

export async function createWindowsCloudAuth({
  provider, clientId, profileId, epoch, directory, isCurrent, openBrowser,
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  loadMsal = () => import('@azure/msal-node'),
  loadGoogle = () => import('google-auth-library'),
  loadPersistenceSdk = () => import('@azure/msal-node-extensions'),
}) {
  if (!['microsoft', 'google'].includes(provider) || typeof isCurrent !== 'function'
    || typeof openBrowser !== 'function' || !Number.isSafeInteger(epoch) || epoch < 0) {
    throw new TypeError('Invalid native cloud authentication configuration.');
  }
  requireValue(clientId, 'A registered public-client identifier is required.');
  const persistence = await createCloudCredentialPersistence({
    directory: join(directory, provider), profileId, platform, loadSdk: loadPersistenceSdk,
  });
  const transport = boundedTransport(provider, fetchImpl);
  let client;
  try {
    if (provider === 'microsoft') {
      const { PublicClientApplication } = await loadMsal();
      const request = async (url, options, method) => {
        const { response, data } = await transport(url, {
          method, headers: options?.headers, body: method === 'POST' ? options?.body : undefined,
        });
        return { status: response.status, headers: Object.fromEntries(response.headers), body: data };
      };
      client = new PublicClientApplication({
        auth: { clientId, authority: 'https://login.microsoftonline.com/consumers' },
        system: {
          loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} },
          networkClient: {
            sendGetRequestAsync: (url, options) => request(url, options, 'GET'),
            sendPostRequestAsync: (url, options) => request(url, options, 'POST'),
          },
        },
      });
    } else {
      const { OAuth2Client } = await loadGoogle();
      client = new OAuth2Client({
        clientId, clientAuthentication: 'None', useAuthRequestParameters: false,
        transporter: {
          async request(options) {
            const { response, data } = await transport(options.url, {
              method: options.method, headers: options.headers, body: options.data,
            });
            return { data, status: response.status, headers: response.headers, config: options };
          },
        },
      });
    }
  } catch {
    throw new CloudAuthenticationError('The native authentication library could not be loaded. Local reading remains available.');
  }

  const transactions = createCloudOAuthTransactions();
  let account = null;
  let cacheFailure = null;
  let stopped = false;
  let callback;
  let tail = Promise.resolve();
  function check() {
    if (stopped || isCurrent({ profileId, provider, epoch }) !== true) {
      throw new CloudAuthenticationError('This cloud connection is no longer active.');
    }
  }
  async function step(operation) {
    check();
    const result = await operation();
    check();
    return result;
  }
  function enqueue(operation) {
    const result = tail.then(async () => {
      try { return await operation(); } catch (error) {
        if (error instanceof CloudAuthenticationError) throw error;
        throw new CloudAuthenticationError('Cloud authentication failed. Reconnect when ready.');
      }
    });
    // Keep cleanup usable after a failed operation without hiding its caller-visible rejection.
    tail = result.catch(() => {});
    return result;
  }
  async function save(identity) {
    const record = {
      version: 1, provider, clientId, account: identity,
      credentials: provider === 'microsoft' ? client.getTokenCache().serialize() : client.credentials,
    };
    const bytes = JSON.stringify(record);
    if (Buffer.byteLength(bytes) > CACHE_LIMIT) {
      throw new CloudAuthenticationError('The protected credential cache exceeded its size limit.');
    }
    await step(() => persistence.save(bytes));
    if (await step(() => persistence.load()) !== bytes) {
      throw new CloudAuthenticationError('The protected credential save could not be verified.');
    }
    account = identity;
  }
  async function googleIdentity(token, expected) {
    const info = await step(() => client.getTokenInfo(token));
    requireScope(info.scopes, GOOGLE_SCOPE);
    if (info.aud !== clientId || (expected && info.sub !== expected)) {
      throw new CloudAuthenticationError('The provider returned a different account or application.');
    }
    return {
      id: requireValue(info.sub, 'The provider did not identify the authorized account.'),
      label: requireValue(info.email || info.sub, 'The provider did not identify the authorized account.'),
    };
  }
  function microsoftIdentity(result, expected) {
    requireScope(result?.scopes, MICROSOFT_SCOPE);
    const id = requireValue(result?.account?.homeAccountId, 'The provider did not identify the authorized account.');
    if (expected && id !== expected) {
      throw new CloudAuthenticationError('The provider returned a different account.');
    }
    return { id, label: requireValue(result.account.username || id, 'The account label is invalid.') };
  }

  try {
    const bytes = await step(() => persistence.load());
    if (bytes) {
      if (typeof bytes !== 'string' || Buffer.byteLength(bytes) > CACHE_LIMIT) throw new Error('Invalid cache');
      const record = JSON.parse(bytes);
      if (record.version !== 1 || record.provider !== provider || record.clientId !== clientId) throw new Error('Invalid cache');
      requireValue(record.account?.id, 'The protected account cache is invalid.');
      requireValue(record.account?.label, 'The protected account cache is invalid.');
      if (provider === 'microsoft') {
        if (typeof record.credentials !== 'string' || !record.credentials) throw new Error('Invalid cache');
        client.getTokenCache().deserialize(record.credentials);
      } else {
        requireValue(record.credentials?.refresh_token, 'Reconnect to renew this account session.');
        client.setCredentials(record.credentials);
      }
      account = { id: record.account.id, label: record.account.label };
    }
  } catch (error) {
    account = null;
    cacheFailure = error instanceof CloudAuthenticationError ? error
      : new CloudAuthenticationError('The protected account cache could not be read. Disconnect, then reconnect this account.');
  }

  return {
    status() {
      check();
      return {
        provider, epoch, account: account ? { ...account } : null,
        state: cacheFailure ? 'reconnect-required' : account ? 'connected' : 'disconnected',
        ...(cacheFailure ? { message: cacheFailure.message } : {}),
      };
    },
    connect() {
      return enqueue(async () => {
        check();
        if (cacheFailure) throw cacheFailure;
        if (account) throw new CloudAuthenticationError('Disconnect the existing destination before signing in again.');
        const listener = await startCloudOAuthCallback({ transactions, profileId, provider, epoch });
        callback = listener;
        try {
          check();
          const nonce = randomBytes(32).toString('base64url');
          const { redirectUri, authorization } = callback;
          const url = provider === 'microsoft'
            ? await step(() => client.getAuthCodeUrl({
              scopes: [MICROSOFT_SCOPE], redirectUri, nonce, prompt: 'select_account',
              state: authorization.state, codeChallenge: authorization.codeChallenge, codeChallengeMethod: 'S256',
            }))
            : client.generateAuthUrl({
              scope: ['openid', 'email', GOOGLE_SCOPE], redirect_uri: redirectUri, nonce,
              access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: false,
              state: authorization.state, code_challenge: authorization.codeChallenge, code_challenge_method: 'S256',
            });
          const target = new URL(url);
          const origin = provider === 'microsoft' ? 'https://login.microsoftonline.com' : 'https://accounts.google.com';
          if (target.origin !== origin || target.username || target.password) {
            throw new CloudAuthenticationError('The authentication SDK returned an unsupported sign-in location.');
          }
          check();
          await step(() => openBrowser(url));
          const result = await step(() => callback.completion);
          if (result.status !== 'received') throw new CloudAuthenticationError(result.message);
          let identity;
          if (provider === 'microsoft') {
            const tokens = await step(() => client.acquireTokenByCode({
              scopes: [MICROSOFT_SCOPE], code: result.code, codeVerifier: result.codeVerifier, redirectUri, nonce,
            }));
            requireValue(tokens?.accessToken, 'The provider did not return an access token.');
            identity = microsoftIdentity(tokens);
          } else {
            const { tokens } = await step(() => client.getToken({
              code: result.code, codeVerifier: result.codeVerifier, redirect_uri: redirectUri,
            }));
            requireValue(tokens.id_token, 'The provider did not return a verified account identity.');
            requireValue(tokens.refresh_token, 'The provider did not grant a persistent session. Reconnect is required.');
            const ticket = await step(() => client.verifyIdToken({ idToken: tokens.id_token, audience: clientId }));
            const payload = ticket.getPayload();
            if (payload?.nonce !== nonce) throw new CloudAuthenticationError('The provider identity did not match this sign-in.');
            const subject = requireValue(payload.sub, 'The provider did not identify the authorized account.');
            identity = await googleIdentity(requireValue(tokens.access_token, 'The provider did not return an access token.'), subject);
            client.setCredentials(tokens);
          }
          await save(identity);
          return { provider, epoch, account: { ...identity } };
        } finally {
          callback.cancel();
          await callback.completion;
          callback = undefined;
        }
      });
    },
    getAccessToken() {
      return enqueue(async () => {
        check();
        if (cacheFailure) throw cacheFailure;
        if (!account) throw new CloudAuthenticationError('Connect a cloud account first.');
        let token;
        let identity;
        if (provider === 'microsoft') {
          const accounts = await step(() => client.getTokenCache().getAllAccounts());
          const selected = accounts.find((item) => item.homeAccountId === account.id);
          if (!selected) throw new CloudAuthenticationError('The saved account session is unavailable. Reconnect is required.');
          const result = await step(() => client.acquireTokenSilent({ scopes: [MICROSOFT_SCOPE], account: selected }));
          identity = microsoftIdentity(result, account.id);
          token = result.accessToken;
        } else {
          const result = await step(() => client.getAccessToken());
          token = result.token;
          identity = await googleIdentity(token, account.id);
        }
        requireValue(token, 'The provider did not return an access token.');
        await save(identity);
        return token;
      });
    },
    disconnect() {
      stopped = true;
      callback?.cancel();
      return enqueue(async () => {
        try {
          await persistence.delete();
          try {
            await stat(join(directory, provider, profileId, 'credentials.bin'));
            throw new Error('Cache remained');
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          account = null;
          client = null;
        } catch {
          throw new CloudAuthenticationError('The protected account cache could not be removed. Cloud remains disabled.');
        }
      });
    },
  };
}
