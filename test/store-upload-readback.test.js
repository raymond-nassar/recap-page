import test from 'node:test';
import assert from 'node:assert/strict';
import { observeUploadedBundle, readSingleBundle } from '../scripts/store-upload-readback.mjs';
import { sha256 } from '../scripts/store-readback.mjs';
import { archive, payload, bundleName as name } from './support/store-zip.mjs';

const sas = 'https://fixture.blob.core.windows.net/ingestion/PRIVATE_PATH?sig=PRIVATE_SAS&se=2099-01-01';

test('bounded upload read hashes exactly one approved stored or deflated bundle without forwarding auth', async () => {
  for (const options of [{}, { method: 8 }, { method: 8, descriptor: true },
    { method: 8, descriptor: true, signed: false }]) {
    const zip = archive(options);
    const calls = [];
    const result = await observeUploadedBundle(sas, name, sha256(payload), {
      fetchImpl: async (url, init) => {
        calls.push(url);
        assert.deepEqual(Object.keys(init).sort(), ['method', 'redirect', 'signal']);
        assert.equal(init.method, 'GET');
        assert.equal(init.redirect, 'error');
        assert.ok(init.signal instanceof AbortSignal);
        return new Response(zip);
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(result.state, 'verified');
    assert.equal(result.originalUploadZipSha256, 'UNRECORDED');
    assert.equal(result.currentZipSha256, sha256(zip));
    assert.equal(result.bundleSha256, sha256(payload));
    assert.equal(result.bundleSize, payload.length);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|https:|sig=|qualified bundle/);
  }
});

test('invalid SAS host, credentials, path, expiry or scheme sends no network request', async () => {
  for (const url of [
    sas.replace('https:', 'http:'), sas.replace('fixture.blob.core.windows.net', 'evil.invalid'),
    sas.replace('https://', 'https://user:pass@'), sas.replace('/ingestion/', '/other/'),
    sas.replace('2099-01-01', '2000-01-01'), `${sas}#fragment`, `${sas}&sig=other`, undefined,
  ]) {
    let calls = 0;
    const result = await observeUploadedBundle(url, name, sha256(payload), { fetchImpl: async () => { calls++; } });
    assert.equal(calls, 0);
    assert.equal(result.checks.at(-1).code, 'UPLOAD_READ_URL');
  }
});

test('unreadable upload, byte limits, HTTP errors and transport exceptions stay explicit without retries or values', async () => {
  for (const [fetchImpl, maxBytes, code] of [
    [async () => new Response('PRIVATE denied', { status: 403 }), 1024, 'UPLOAD_READ_HTTP'],
    [async () => { throw new Error(`PRIVATE ${sas}`); }, 1024, 'UPLOAD_READ_HTTP'],
    [async () => new Response(archive(), { headers: { 'content-length': '9999' } }), 1024, 'UPLOAD_READ_BOUNDS'],
    [async () => new Response(archive()), 10, 'UPLOAD_READ_BOUNDS'],
    [async () => new Response('PRIVATE not zip'), 1024, 'UPLOAD_READ_SINGLE_BUNDLE'],
  ]) {
    let calls = 0;
    const result = await observeUploadedBundle(sas, name, sha256(payload), {
      maxBytes, fetchImpl: async (...args) => { calls++; return fetchImpl(...args); },
    });
    assert.equal(calls, 1);
    assert.equal(result.state, 'unavailable');
    assert.equal(result.checks.at(-1).code, code);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|https:|sig=|Error:|stack/);
  }
});

test('ZIP proof rejects wrong names, multiple entries, truncation, encryption, overflow and hash mismatch', async () => {
  for (const zip of [
    archive({ filename: 'unapproved.msixbundle' }), archive().subarray(0, 60),
    (() => { const z = archive(); z.writeUInt16LE(2, z.length - 12); return z; })(),
    (() => { const z = archive(); z.writeUInt16LE(1, 6); return z; })(),
    (() => { const z = archive(); z.writeUInt32LE(0xffffffff, z.length - 6); return z; })(),
    (() => { const z = archive(); z.writeUInt32LE(0xffffffff, 22); return z; })(),
    (() => { const z = archive(); z[30 + Buffer.byteLength(name)] ^= 1; return z; })(),
    (() => {
      const z = archive();
      const central = z.readUInt32LE(z.length - 6);
      z.writeUInt32LE(0, 14);
      z.writeUInt32LE(0, central + 16);
      return z;
    })(),
  ]) assert.throws(() => readSingleBundle(zip, name));
  const result = await observeUploadedBundle(sas, name, 'f'.repeat(64), {
    fetchImpl: async () => new Response(archive()),
  });
  assert.equal(result.bundleMatches, false);
  assert.equal(result.checks.at(-1).code, 'UPLOAD_READ_BUNDLE_HASH');
  assert.equal(result.state, 'unavailable');
});
