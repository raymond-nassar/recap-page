import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudUploadPermit } from '../src/js/lib/cloudUploadPermit.js';

function fixture() {
  const held = new Map();
  const locks = {
    async query() {
      return { held: [...held.keys()].map((name) => ({ name, mode: 'exclusive' })), pending: [] };
    },
    request(name, options, operation) {
      if (options.steal) {
        held.get(name)?.reject(new DOMException('Lock stolen', 'AbortError'));
        held.delete(name);
      }
      assert.equal(held.has(name), false, 'permit names do not contend');
      return new Promise((resolve, reject) => {
        const owner = { reject };
        held.set(name, owner);
        Promise.resolve().then(() => operation({ name, mode: 'exclusive' })).then(resolve, reject).finally(() => {
          if (held.get(name) === owner) held.delete(name);
        });
      });
    },
  };
  return { locks, make: (id, onLost) => new CloudUploadPermit({ locks, id, onLost }) };
}

test('revoking permits survives the checking tab closing with neither hold stored', async () => {
  const env = fixture();
  let lost = 0;
  const older = env.make('older', () => { lost += 1; });
  const checking = env.make('checking');
  await older.grant();
  assert.equal(await older.allowed(), true);
  await checking.revokeAll();
  checking.release();
  assert.equal(await older.allowed(), false, 'closing the checking tab cannot restore the old permit');
  assert.equal(lost, 1);
  await older.grant();
  assert.equal(await older.allowed(), true, 'a later successful check can grant a new permit');
  older.release();
});

test('all running permits are revoked, while unrelated locks are left alone', async () => {
  const env = fixture();
  const one = env.make('one');
  const two = env.make('two');
  let release;
  const other = env.locks.request('ordinary-lock', {}, () => new Promise((resolve) => { release = resolve; }));
  await Promise.all([one.grant(), two.grant()]);
  await env.make('checking').revokeAll();
  assert.equal(await one.allowed(), false);
  assert.equal(await two.allowed(), false);
  assert.ok((await env.locks.query()).held.some((lock) => lock.name === 'ordinary-lock'));
  release();
  await other;
});

test('a stale grant and unavailable lock inspection cannot authorize an upload', async () => {
  const env = fixture();
  const permit = env.make('one');
  let current = true;
  const grant = permit.grant(() => current);
  current = false;
  await assert.rejects(grant, { code: 'storage' });
  assert.equal(await permit.allowed(), false);
  const unsupported = new CloudUploadPermit({ locks: { request() {} }, id: 'one' });
  await assert.rejects(unsupported.grant(), { code: 'unsupported' });
  assert.equal(await unsupported.allowed(), false);
  await permit.grant();
  env.locks.query = async () => { throw new Error('query failed'); };
  await assert.rejects(permit.allowed(), /query failed/);
  permit.release();
});
