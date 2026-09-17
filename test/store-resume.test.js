import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fingerprint } from '../scripts/inspect-store-recovery.mjs';
import { prepareApiDraft } from '../scripts/check-store-release.mjs';
import {
  TARGET, bindApplication, prepareRecovery, verifyRecovery, uploadLocation, transport,
} from '../scripts/resume-store-recovery.mjs';

const notes = JSON.parse(readFileSync(new URL('../docs/releases/3.0.0-store.json', import.meta.url), 'utf8'));
const app = {
  id: TARGET.product, pendingApplicationSubmission: { id: TARGET.draft },
  lastPublishedApplicationSubmission: { id: TARGET.published },
};
function draft() {
  return {
    id: TARGET.draft, status: 'PendingCommit', statusDetails: { errors: [] },
    applicationPackages: [{ fileName: 'old.msixbundle', fileStatus: 'Uploaded', version: '2.1.0.0' }],
    pricing: { priceId: 'Free' }, listings: {
      'en-us': { baseListing: { releaseNotes: 'Earlier', description: 'Keep me', images: [{ id: '123' }] } },
    },
    targetPublishMode: 'Immediate', targetPublishDate: '1601-01-01T00:00:00Z',
    packageDeliveryOptions: { packageRollout: { isPackageRollout: false } },
    fileUploadUrl: 'https://productingestionbin1.blob.core.windows.net/ingestion/example?sig=fixture&se=2099-01-01',
  };
}
function prepared() {
  const value = prepareApiDraft(draft(), TARGET.bundle, TARGET.draft, notes, TARGET.version);
  value.targetPublishDate = draft().targetPublishDate;
  return value;
}

test('Store recovery pins observed identities, snapshots and approved release notes', () => {
  bindApplication(app);
  for (const invalid of [
    { ...app, id: 'other' },
    { ...app, pendingApplicationSubmission: null },
    { ...app, pendingApplicationSubmission: { id: 'other' } },
    { ...app, lastPublishedApplicationSubmission: { id: 'other' } },
  ]) assert.throws(() => bindApplication(invalid), /approved draft/);
  assert.equal(fingerprint(notes), TARGET.notesFingerprint);
  assert.throws(() => prepareRecovery(app, draft(), draft(), notes), /baseline changed/);
});

test('Store recovery readback preserves all unrelated content and existing rollout intent', () => {
  const value = prepared();
  verifyRecovery(value, value, notes);
  for (const mutate of [
    (copy) => { copy.listings['en-us'].baseListing.description = 'Changed'; },
    (copy) => { copy.pricing.priceId = 'Paid'; },
    (copy) => { copy.targetPublishDate = null; },
    (copy) => { copy.listings['en-us'].baseListing.images = []; },
    (copy) => { copy.applicationPackages[0].version = '9.0.0.0'; },
    (copy) => { copy.applicationPackages.push({ fileName: 'extra.appx' }); },
    (copy) => { copy.statusDetails.errors.push({ code: 'Error' }); },
    (copy) => { copy.status = 'CommitStarted'; },
    (copy) => { copy.listings['en-us'].baseListing.releaseNotes = 'Wrong'; },
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(() => verifyRecovery(changed, value, notes));
  }
});

test('Store recovery upload rejects expired or untrusted locations', () => {
  assert.ok(uploadLocation(draft().fileUploadUrl).startsWith('https:'));
  for (const url of [
    'https://example.com/ingestion/a?sig=x&se=2099-01-01',
    'http://productingestionbin1.blob.core.windows.net/ingestion/a?sig=x&se=2099-01-01',
    draft().fileUploadUrl.replace('2099', '2000'),
    draft().fileUploadUrl.replace('sig=', 'absent='),
  ]) assert.throws(() => uploadLocation(url));
});

test('Store recovery executes one existing-draft upload, update and commit with no ambiguous retry', async () => {
  // Replace only sealed live fingerprints with fixture fingerprints to exercise the actual orchestration.
  const original = draft();
  const published = { ...draft(), id: TARGET.published, status: 'Published' };
  let source = readFileSync(new URL('../scripts/resume-store-recovery.mjs', import.meta.url), 'utf8');
  source = source.replace(TARGET.draftFingerprint, fingerprint(original))
    .replace(TARGET.publishedFingerprint, fingerprint(published));
  for (const file of ['inspect-store-recovery.mjs', 'check-store-release.mjs']) {
    source = source.replace(`'./${file}'`, `'${new URL(`../scripts/${file}`, import.meta.url).href}'`);
  }
  const { resume: exercise } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const failAt of [null, 'snapshot', 'upload', 'PUT', 'POST', 'readback', 'commit-body']) {
    let current = structuredClone(original);
    if (failAt === 'snapshot') current.listings['en-us'].baseListing.description = 'Changed before recovery';
    const mutations = [];
    const request = async (method, url, body) => {
      if (method !== 'GET') {
        mutations.push(method);
        if (failAt === method) throw new Error('ambiguous');
        if (method === 'PUT') {
          current = structuredClone(body);
          if (failAt === 'readback') current.listings['en-us'].baseListing.description = 'Changed';
          return current;
        }
        return { status: failAt === 'commit-body' ? 'PendingCommit' : 'CommitStarted' };
      }
      if (url.endsWith(`/submissions/${TARGET.draft}`)) return structuredClone(current);
      if (url.endsWith(`/submissions/${TARGET.published}`)) return published;
      return app;
    };
    const upload = async () => {
      mutations.push('upload');
      if (failAt === 'upload') throw new Error('ambiguous');
    };
    const result = exercise(request, upload, notes, Buffer.from('fixture'));
    if (failAt === null) {
      assert.deepEqual(await result, { submissionId: TARGET.draft, status: 'CommitStarted' });
      assert.deepEqual(mutations, ['upload', 'PUT', 'POST']);
    } else {
      await assert.rejects(result);
      assert.deepEqual(mutations, failAt === 'snapshot' ? [] : failAt === 'upload' ? ['upload']
        : ['POST', 'commit-body'].includes(failAt) ? ['upload', 'PUT', 'POST'] : ['upload', 'PUT']);
    }
  }
});

test('Store recovery HTTP transport accepts 202 only for commit and blocks other mutation endpoints', async (t) => {
  const names = ['PARTNER_CENTER_TENANT_ID', 'PARTNER_CENTER_CLIENT_ID', 'PARTNER_CENTER_CLIENT_SECRET'];
  const before = names.map((name) => process.env[name]);
  names.forEach((name) => { process.env[name] = 'fixture'; });
  t.after(() => names.forEach((name, index) => {
    if (before[index] === undefined) delete process.env[name];
    else process.env[name] = before[index];
  }));
  let status = 200;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    if (new URL(url).hostname === 'login.microsoftonline.com') {
      return { status: 200, json: async () => ({ access_token: 'fixture' }) };
    }
    return { status, json: async () => ({ status: 'CommitStarted' }) };
  });
  const { request } = await transport();
  const root = `https://manage.devcenter.microsoft.com/v1.0/my/applications/${TARGET.product}`;
  for (status of [200, 202]) {
    assert.deepEqual(await request('POST', `${root}/submissions/${TARGET.draft}/commit`),
      { status: 'CommitStarted' });
  }
  for (status of [201, 204, 400, 409, 500]) {
    const count = calls.length;
    await assert.rejects(request('POST', `${root}/submissions/${TARGET.draft}/commit`), /not accepted/);
    assert.equal(calls.length, count + 1);
  }
  status = 202;
  await assert.rejects(request('PUT', `${root}/submissions/${TARGET.draft}`, {}), /not accepted/);
  for (const [method, url] of [
    ['POST', `${root}/submissions`], ['DELETE', `${root}/submissions/${TARGET.draft}`],
    ['PUT', `${root}/submissions/999`],
  ]) {
    const count = calls.length;
    await assert.rejects(request(method, url), /not allowlisted/);
    assert.equal(calls.length, count);
  }
});
