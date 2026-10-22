import { createServer } from 'node:http';
import { setTimeout, clearTimeout } from 'node:timers';
import { URL } from 'node:url';
import { CloudOAuthCallbackError, CloudOAuthResultError } from './cloudOAuth.mjs';

const HEADERS = Object.freeze({
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
});

export async function startCloudOAuthCallback({
  transactions, profileId, provider, epoch,
  signal,
  scheduleExpiry = (expire) => setTimeout(expire, 5 * 60 * 1000),
  clearExpiry = clearTimeout,
}) {
  if (!['microsoft', 'google'].includes(provider)) {
    throw new TypeError('Unknown cloud sign-in provider.');
  }
  if (signal?.aborted) throw new Error('Cloud sign-in was cancelled before it started.');
  let binding;
  let state;
  let finished = false;
  let expiry;
  let settle;
  const completion = new Promise((resolve) => { settle = resolve; });
  const server = createServer({ maxHeaderSize: 16384 }, (req, res) => {
    const respond = (status, text) => res.writeHead(status, HEADERS).end(text);
    if (finished || !binding) return respond(410, 'This sign-in is no longer active.');
    const host = new URL(binding.redirectUri).host;
    if (req.headers.host !== host || req.headers.origin
      || req.url?.length > 16384 || !req.url?.startsWith('/')
      || req.url.split('?')[0] !== '/'
      || req.headers['transfer-encoding']
      || (req.headers['content-length'] && req.headers['content-length'] !== '0')) {
      return respond(400, 'Invalid sign-in callback. Return to Recap Page.');
    }
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      return respond(405, 'Only a sign-in navigation is accepted.');
    }
    try {
      const result = transactions.consume({ ...binding, callbackUrl: `${binding.redirectUri.slice(0, -1)}${req.url}` });
      // Reserve completion before another socket can attempt to reuse the callback.
      finished = true;
      const complete = () => finish({ status: 'received', ...result });
      // A closed browser socket must not strand an already-consumed authorization.
      res.once('close', complete);
      res.writeHead(200, HEADERS).end('Sign-in received. Return to Recap Page.', complete);
    } catch (error) {
      if (!(error instanceof CloudOAuthCallbackError)) {
        respond(500, 'Sign-in stopped unexpectedly. Return to Recap Page.');
        finish({ status: 'failed', message: 'The cloud sign-in callback stopped unexpectedly.' });
        return;
      }
      respond(400, 'Sign-in could not be completed. Return to Recap Page.');
      if (error instanceof CloudOAuthResultError) {
        finish({ status: 'failed', message: error.message });
      }
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1;

  let settled = false;
  function finish(outcome) {
    if (settled) return;
    settled = true;
    finished = true;
    if (state) transactions.cancel(profileId, state);
    if (expiry !== undefined) clearExpiry(expiry);
    signal?.removeEventListener('abort', cancel);
    server.close(() => settle(outcome));
    server.closeAllConnections();
  }
  function cancel() {
    finish({ status: 'cancelled', message: 'Cloud sign-in was cancelled.' });
  }
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch {
    server.close();
    throw new Error('The cloud sign-in callback could not be started.');
  }
  server.removeAllListeners('error');
  server.on('error', () => finish({ status: 'failed', message: 'The cloud sign-in callback stopped unexpectedly.' }));
  try {
    const address = server.address();
    const hostname = provider === 'microsoft' ? 'localhost' : '127.0.0.1';
    const redirectUri = `http://${hostname}:${address.port}/`;
    binding = { profileId, provider, epoch, redirectUri };
    const authorization = transactions.begin(binding);
    state = authorization.state;
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    if (!settled) {
      expiry = scheduleExpiry(() => finish({
        status: 'expired', message: 'Cloud sign-in expired. Start sign-in again.',
      }));
    }
    return { redirectUri, authorization, completion, cancel };
  } catch {
    finish({ status: 'failed', message: 'The cloud sign-in callback could not be prepared.' });
    await completion;
    throw new Error('The cloud sign-in callback could not be prepared.');
  }
}
