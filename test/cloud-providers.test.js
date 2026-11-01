import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHostTransport } from '../src/js/lib/cloudHostTransport.js';
import { cloudDeleteQuestion, cloudProviderName, cloudSignInChoices } from '../src/js/views/cloud.js';

// A host that answers every request with the status given, and records each request body the page sent.
function answering(status) {
  const sent = [];
  const fetchImpl = async (path, init) => {
    sent.push({ operation: path.split('/').pop(), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, status: typeof status === 'function' ? status() : status }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  return { sent, transport: createCloudHostTransport({ fetchImpl }) };
}

const BASE = { state: 'not-connected', connection: null, account: null, message: null, reason: null, signInExpiresAt: null };

test('the transport keeps the services a host offers, in its order, and reads a host that names none as offering its own', async () => {
  const cases = [
    [{ provider: 'onedrive', providers: ['onedrive', 'googledrive'] }, ['onedrive', 'googledrive']],
    [{ provider: 'onedrive' }, ['onedrive']],
    [{ provider: 'onedrive', providers: [] }, ['onedrive']],
    [{ provider: 'onedrive', providers: ['googledrive', 'googledrive', 'onedrive'] }, ['googledrive', 'onedrive']],
    [{ provider: 'onedrive', providers: ['Google Drive', 7, null, 'x'.repeat(33), 'googledrive'] }, ['googledrive']],
    [{ provider: 'onedrive', providers: 'onedrive' }, ['onedrive']],
    [{ provider: null }, []],
    [{ provider: 'OneDrive!', providers: [] }, []],
  ];
  for (const [fields, expected] of cases) {
    const { transport } = answering({ ...BASE, ...fields });
    assert.deepEqual((await transport.status()).providers, expected, JSON.stringify(fields));
  }
  const many = Array.from({ length: 12 }, (_, at) => `p${'abcdefghijkl'[at]}`);
  const { transport } = answering({ ...BASE, provider: 'onedrive', providers: many });
  assert.equal((await transport.status()).providers.length, 8, 'a host cannot fill the card with services');
});

test('connect names the chosen service, and names none when nobody chose, as every host before the choice expects', async () => {
  const { sent, transport } = answering({ ...BASE, state: 'signing-in', provider: 'googledrive', providers: ['onedrive', 'googledrive'] });
  await transport.connect();
  await transport.connect({});
  await transport.connect({ provider: 'googledrive' });
  assert.deepEqual(sent.map(({ body }) => body), [{}, {}, { provider: 'googledrive' }]);
});

test('a second list after each create follows the service the host last named, and a status naming none leaves it', async () => {
  let provider = 'onedrive';
  const { transport } = answering(() => ({ ...BASE, provider, providers: ['onedrive', 'googledrive'] }));
  assert.equal(transport.duplicateNames, false, 'nothing heard yet');
  await transport.status();
  assert.equal(transport.duplicateNames, false, 'OneDrive refuses a second item of one name');
  provider = 'googledrive';
  await transport.connect({ provider });
  assert.equal(transport.duplicateNames, true, 'Google Drive keeps two items under one name');
  provider = null;
  await transport.status();
  assert.equal(transport.duplicateNames, true, 'a status that names no service changes nothing');
  provider = 'onedrive';
  await transport.disconnect();
  assert.equal(transport.duplicateNames, false);
});

test('the card offers every known service while nobody is connected, and only the connected one when it asks again', () => {
  const offered = { host: 'not-connected', provider: 'onedrive' };
  assert.deepEqual(cloudSignInChoices({ ...offered, providers: ['onedrive', 'googledrive'] }), ['onedrive', 'googledrive']);
  assert.deepEqual(cloudSignInChoices({ ...offered, providers: ['onedrive'] }), ['onedrive']);
  assert.deepEqual(cloudSignInChoices({ ...offered, providers: [] }), ['onedrive'], 'a host older than the choice');
  assert.deepEqual(cloudSignInChoices(offered), ['onedrive']);
  assert.deepEqual(cloudSignInChoices({ ...offered, providers: ['somewhere'] }), [], 'never a button for a service the host did not offer');
  assert.deepEqual(cloudSignInChoices({ ...offered, providers: ['constructor', 'googledrive'] }), ['googledrive']);
  assert.deepEqual(cloudSignInChoices({ host: 'needs-sign-in', provider: 'googledrive', providers: ['onedrive', 'googledrive'] }), ['googledrive']);
  assert.deepEqual(cloudSignInChoices({ host: 'needs-sign-in', provider: 'somewhere' }), []);
  for (const host of ['connected', 'signing-in', 'unavailable', 'absent', 'not-answering']) {
    assert.deepEqual(cloudSignInChoices({ host, provider: 'onedrive', providers: ['onedrive', 'googledrive'] }), [], host);
  }
});

test('the card names each service in its own words', () => {
  assert.equal(cloudProviderName({ provider: 'googledrive' }), 'Google Drive');
  assert.equal(cloudProviderName({ provider: 'onedrive' }), 'OneDrive');
  assert.equal(cloudProviderName({ provider: 'toString' }), 'your cloud account');
  assert.match(cloudDeleteQuestion({ provider: 'googledrive' }), /delete those in Google Drive\. Deleted backups stay in Google Drive's trash/);
  assert.doesNotMatch(cloudDeleteQuestion({ provider: 'googledrive' }), /OneDrive|recycle bin/);
  assert.doesNotMatch(cloudDeleteQuestion({ provider: 'onedrive' }), /Google|trash/);
});
