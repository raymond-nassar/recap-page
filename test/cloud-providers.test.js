import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHostTransport } from '../src/js/lib/cloudHostTransport.js';
import { cloudCardStatus, cloudDeleteQuestion, cloudDeleteReport, cloudDisconnectQuestion, cloudProviderName, cloudSignInChoices } from '../src/js/views/cloud.js';

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
  provider = 'icloud';
  await transport.connect({ provider });
  assert.equal(transport.duplicateNames, true, 'iCloud concurrent writes need the second list too');
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
  assert.equal(cloudProviderName({ provider: 'icloud' }), 'iCloud');
  assert.deepEqual(cloudSignInChoices({ host: 'not-connected', provider: 'icloud', providers: ['icloud'] }), ['icloud']);
  const iCloud = { provider: 'icloud', scope: 'device' };
  assert.match(cloudDeleteQuestion(iCloud), /cannot bring deleted backups back/);
  assert.doesNotMatch(cloudDeleteQuestion(iCloud), /recycle|trash|30 days|OneDrive|Google/);
  assert.doesNotMatch(cloudDeleteReport({ deleted: 2, failed: [] }, iCloud), /recycle|trash|30 days|OneDrive|Google/);
  assert.match(cloudDisconnectQuestion(iCloud, false), /does not sign you out of iCloud/);
  assert.equal(cloudProviderName({ provider: 'googledrive' }), 'Google Drive');
  assert.equal(cloudProviderName({ provider: 'onedrive' }), 'OneDrive');
  assert.equal(cloudProviderName({ provider: 'toString' }), 'your cloud account');
  assert.match(cloudDeleteQuestion({ provider: 'googledrive' }), /delete those in Google Drive\./);
  assert.match(cloudDeleteQuestion({ provider: 'googledrive' }), /Deleted backups stay in Google Drive's trash/);
  assert.doesNotMatch(cloudDeleteQuestion({ provider: 'googledrive' }), /OneDrive|recycle bin/);
  assert.doesNotMatch(cloudDeleteQuestion({ provider: 'onedrive' }), /Google|trash/);
});

test('the card and deletion question explain saved copies from earlier connections', () => {
  const model = { host: 'connected', provider: 'onedrive', scope: 'device', on: false, hasStream: true, earlierKept: 2 };
  const status = cloudCardStatus(model);
  assert.match(status, /2 recorded kept copies from earlier connections may remain/);
  assert.match(status, /other earlier copies/i);
  assert.match(status, /delete them by hand in their cloud folders/i);
  const question = cloudDeleteQuestion(model);
  assert.match(question, /2 recorded kept copies from earlier connections may remain/);
  assert.match(cloudDisconnectQuestion(model, true), /2 recorded kept copies from earlier connections may remain/);
  assert.match(cloudCardStatus({ ...model, earlierKept: 1 }), /One recorded kept copy from an earlier connection may remain/);
});

test('with no recorded copies and no problem, the card and questions say nothing about saved copies', () => {
  const quiet = { host: 'connected', provider: 'onedrive', account: 'reader@example.test', scope: 'device', on: false, hasStream: true };
  for (const extra of [{}, { earlierKept: 0, keptAttention: 0, keptProblem: false }, { earlierKept: null, keptAttention: null }]) {
    const model = { ...quiet, ...extra };
    for (const text of [cloudCardStatus(model), cloudDeleteQuestion(model), cloudDisconnectQuestion(model, true),
      cloudDeleteReport({ deleted: 0, failed: [] }, model)]) {
      assert.doesNotMatch(text, /kept cop|saved cop|saved-copy|regular backups|cloud folders/i, text);
    }
    assert.equal(cloudDeleteQuestion(model), cloudDeleteQuestion(quiet));
    assert.equal(cloudDisconnectQuestion(model, true), cloudDisconnectQuestion(quiet, true));
  }
  assert.equal(cloudDeleteQuestion(quiet), "This turns automatic backup off and deletes every backup made on this device in the OneDrive account reader@example.test. Backups from other devices or other accounts are kept; delete those in OneDrive. Deleted backups stay in OneDrive's recycle bin for up to 30 days, but Recap Page cannot bring them back.");
  assert.equal(cloudDeleteReport({ deleted: 0, failed: [] }, quiet), 'No backups made on this device were in the OneDrive account reader@example.test. Any made in another account are still there. Automatic backup is off.');
});

test('an absent reservation is reported as attention without promising a deletion retry', () => {
  const report = cloudDeleteReport({ deleted: 1, failed: [], attention: 1 }, { provider: 'onedrive', scope: 'device' });
  assert.match(report, /One saved or attempted cloud copy could not be confirmed or removed/);
  assert.doesNotMatch(report, /could not be deleted|delete again to finish/);
});

test('the delete question reports copies the app could not confirm or remove', () => {
  const model = { host: 'connected', provider: 'onedrive', scope: 'device', hasStream: true, earlierKept: 0, keptAttention: 2 };
  const question = cloudDeleteQuestion(model);
  assert.match(question, /2 saved or attempted cloud copies could not be confirmed or removed/);
  assert.match(question, /delete any unwanted copies by hand/i);
});

test('unreadable saved-copy records do not become a zero count, and deletion reports earlier copies', () => {
  const model = { host: 'connected', provider: 'googledrive', scope: 'profiles', on: false, earlierKept: null, keptProblem: true };
  assert.match(cloudCardStatus(model), /saved-copy record could not be checked/i);
  assert.match(cloudCardStatus(model), /earlier connections may need deleting by hand/i);
  assert.match(cloudDeleteQuestion(model), /earlier connections may need deleting by hand/i);
  const report = cloudDeleteReport({ deleted: 1, failed: [], earlier: 2 }, model);
  assert.match(report, /Deleted 1 backup/);
  assert.match(report, /2 recorded kept copies from earlier connections may remain/);
  const partial = cloudDeleteReport({ deleted: 0, failed: [{ code: 'unconfirmed' }], earlier: 1 }, model);
  assert.match(partial, /could not be confirmed/i);
  assert.match(partial, /One recorded kept copy from an earlier connection may remain/);
  const recordFailure = cloudDeleteReport({ deleted: 1, failed: [{ code: 'storage', deleted: true }] }, model);
  assert.match(recordFailure, /Deleted 1 backup/);
  assert.match(recordFailure, /saved-copy record could not be updated/i);
  assert.doesNotMatch(recordFailure, /Deleted 1 of 2|could not be deleted/);
});

test('only a true upload wait survives the transport and appears in connected feedback', async () => {
  for (const waitingForUpload of [undefined, false, true, 'true', 1]) {
    const { transport } = answering({ ...BASE, state: 'connected', provider: 'icloud', waitingForUpload });
    const status = await transport.status();
    assert.equal(status.waitingForUpload, waitingForUpload === true ? true : undefined);
    const model = { ...status, host: status.state, scope: 'device', on: false };
    assert.equal(cloudCardStatus(model), `Connected to iCloud.${waitingForUpload === true ? ' iCloud has not finished uploading the latest backup yet.' : ''}`);
    assert.match(cloudCardStatus({ ...model, on: true, backup: { phase: 'saving' } }), /Backing up now\.$/);
  }
});

test('the card describes the Android Google sign-in screen without changing browser sign-ins', () => {
  const pending = { host: 'signing-in', provider: 'googledrive', scope: 'device', signInExpiresAt: 42 };
  const options = { at: (value) => `time ${value}` };
  assert.equal(cloudCardStatus(pending, options),
    'Finish signing in to Google on the sign-in screen. The sign-in stops by itself at time 42.');
  assert.equal(cloudCardStatus({ ...pending, signInExpiresAt: null }, options),
    'Finish signing in to Google on the sign-in screen.');
  assert.equal(cloudCardStatus({ ...pending, scope: 'profiles' }, options),
    'Finish signing in to Google in the browser window that opened. The sign-in stops by itself at time 42.');
  assert.equal(cloudCardStatus({ ...pending, provider: 'onedrive' }, options),
    'Finish signing in to Microsoft in the browser window that opened. The sign-in stops by itself at time 42.');
});
