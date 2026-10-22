import { createHash, randomBytes } from 'node:crypto';
import { URL } from 'node:url';

const PROFILE = /^[a-f0-9]{64}$/;
const STATE = /^[A-Za-z0-9_-]{43}$/;
const LIFETIME = 5 * 60 * 1000;
const MAX_PENDING = 32;

function validateBinding({ profileId, provider, epoch }) {
  if (!PROFILE.test(typeof profileId === 'string' ? profileId : '')
    || !['microsoft', 'google'].includes(provider)
    || !Number.isSafeInteger(epoch) || epoch < 0) {
    throw new TypeError('Invalid cloud authorization binding.');
  }
}

function parseUrl(value) {
  if (typeof value !== 'string' || value.length > 16384) {
    throw new Error('Cloud authorization callback is invalid.');
  }
  try {
    return new URL(value);
  } catch {
    throw new Error('Cloud authorization callback is invalid.');
  }
}

function validateRedirect(redirectUri) {
  const url = parseUrl(redirectUri);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || !url.port || url.port === '8787' || url.username || url.password
    || url.search || url.hash || !['/', '/cloud/oauth/callback'].includes(url.pathname)
    || url.href !== redirectUri) {
    throw new TypeError('Cloud authorization requires an exact temporary loopback callback.');
  }
  return url;
}

export function createCloudOAuthTransactions({ now = Date.now } = {}) {
  const pending = new Map();
  function prune() {
    const time = now();
    for (const [profileId, attempt] of pending) {
      if (time >= attempt.expiresAt) pending.delete(profileId);
    }
    return time;
  }
  return {
    begin(binding) {
      validateBinding(binding);
      validateRedirect(binding.redirectUri);
      const time = prune();
      if (!pending.has(binding.profileId) && pending.size >= MAX_PENDING) {
        throw new Error('Too many pending cloud sign-ins. Finish or cancel an existing sign-in.');
      }
      const state = randomBytes(32).toString('base64url');
      const codeVerifier = randomBytes(32).toString('base64url');
      pending.set(binding.profileId, {
        profileId: binding.profileId,
        provider: binding.provider,
        epoch: binding.epoch,
        redirectUri: binding.redirectUri,
        state,
        codeVerifier,
        expiresAt: time + LIFETIME,
      });
      return {
        state,
        codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
        codeChallengeMethod: 'S256',
      };
    },
    consume(binding) {
      validateBinding(binding);
      const url = parseUrl(binding.callbackUrl);
      const states = url.searchParams.getAll('state');
      if (url.hash || states.length !== 1 || !STATE.test(states[0])) {
        throw new Error('Cloud authorization callback is invalid.');
      }
      prune();
      const attempt = [...pending.values()].find((entry) => entry.state === states[0]);
      if (!attempt) throw new Error('Cloud sign-in is not active. Start sign-in again.');
      if (attempt.profileId !== binding.profileId || attempt.provider !== binding.provider
        || attempt.epoch !== binding.epoch || attempt.redirectUri !== binding.redirectUri
        || url.username || url.password
        || `${url.origin}${url.pathname}` !== attempt.redirectUri
        || binding.callbackUrl.split('?')[0] !== attempt.redirectUri) {
        throw new Error('Cloud authorization callback does not match the active sign-in.');
      }
      // Burn the attempt before parsing a result or awaiting a token exchange.
      pending.delete(attempt.profileId);
      const codes = url.searchParams.getAll('code');
      const errors = url.searchParams.getAll('error');
      if (codes.length === 0 && errors.length === 1 && errors[0]) {
        throw new Error('Cloud sign-in was denied or cancelled. Start sign-in again when ready.');
      }
      if (codes.length !== 1 || !codes[0] || codes[0].length > 8192 || errors.length) {
        throw new Error('Cloud authorization result is invalid. Start sign-in again.');
      }
      return { code: codes[0], codeVerifier: attempt.codeVerifier, redirectUri: attempt.redirectUri };
    },
    cancel(profileId) {
      if (typeof profileId !== 'string' || !PROFILE.test(profileId)) {
        throw new TypeError('Invalid cloud authorization binding.');
      }
      pending.delete(profileId);
    },
  };
}
