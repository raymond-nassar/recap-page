// The cloud backup client configuration's path into a release (#810, P02-T01 section 3.2, OD-06): put in
// when an approved release build is made, from a protected secret, and never committed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLOUD_CLIENT_ARGUMENT, cloudClientInjection } from '../scripts/lib/cloud-client.mjs';
import { ROOT, buildIdentity } from '../scripts/lib/release-identity.mjs';

const CONFIG = JSON.stringify({
  format: 'recap-page-cloud-client', version: 1, providers: { onedrive: { clientId: 'test-client.recap-page', authority: 'consumers' } },
});
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

test('only protected release workflows ask for configuration, none is committed, and a copy left here is ignored', () => {
  assert.deepEqual(git('ls-files').split(/\r?\n/).filter((path) => /(^|\/)cloud-client\.json$/.test(path)), []);
  const workflows = join(ROOT, '.github', 'workflows');
  for (const name of readdirSync(workflows)) {
    const source = readFileSync(join(workflows, name), 'utf8');
    assert.ok(!source.includes(CLOUD_CLIENT_ARGUMENT), `${name} uses the checked release wrapper, not raw injection`);
    if (!['wack.yml', 'microsoft-store-release.yml', 'android-release-candidate.yml'].includes(name)) {
      assert.doesNotMatch(source, /secrets\.RECAP_ONEDRIVE_|release-cloud-client\.mjs/);
    }
  }
  for (const path of ['cloud-client.json', 'host/cloud-client.json', 'dist/cloud-client.json']) {
    assert.match(git('check-ignore', '--no-index', '-v', path), /cloud-client\.json/, path);
  }
  for (const packager of ['scripts/pack-windows.mjs', 'scripts/pack-msix.mjs']) {
    const source = readFileSync(join(ROOT, packager), 'utf8');
    assert.equal(source.split('cloudClientInjection()').length - 1, 1, `${packager} takes it in one place`);
    assert.doesNotMatch(source, /MRT_CLOUD_CLIENT_CONFIG|process\.env\.[A-Z_]*CLOUD/, `${packager} never reads it from the environment`);
  }
});

test('a configuration is taken only as an absolute path outside the repository, checked as the host checks it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-cloud-client-'));
  const outside = mkdtempSync(join(tmpdir(), 'recap-cloud-link-'));
  const saved = process.env.MRT_CLOUD_CLIENT_CONFIG;
  try {
    const good = join(directory, 'client.json');
    writeFileSync(good, CONFIG);
    process.env.MRT_CLOUD_CLIENT_CONFIG = good;
    assert.equal(cloudClientInjection([]), null, 'the environment is never read');
    assert.equal(cloudClientInjection(['--quiet']), null);
    const taken = cloudClientInjection([`${CLOUD_CLIENT_ARGUMENT}${good}`]);
    assert.equal(taken.name, 'cloud-client.json');
    assert.deepEqual(taken.bytes, Buffer.from(CONFIG), 'copied byte for byte');
    assert.equal(taken.sha256, createHash('sha256').update(CONFIG).digest('hex'));
    const odd = join(directory, 'odd.json');
    writeFileSync(odd, JSON.stringify({ format: 'recap-page-cloud-client', version: 2 }));
    for (const [argv, why] of [
      [[`${CLOUD_CLIENT_ARGUMENT}client.json`], 'a relative path'],
      [[`${CLOUD_CLIENT_ARGUMENT}${join(ROOT, 'cloud-client.json')}`], 'a path inside the repository'],
      [[`${CLOUD_CLIENT_ARGUMENT}${good}`, `${CLOUD_CLIENT_ARGUMENT}${good}`], 'two of them'],
      [[`${CLOUD_CLIENT_ARGUMENT}${odd}`], 'a configuration the host would refuse'],
      [[`${CLOUD_CLIENT_ARGUMENT}${join(directory, 'missing.json')}`], 'a file that is not there'],
    ]) assert.throws(() => cloudClientInjection(argv), undefined, why);
    // A valid configuration inside the repository is refused before it is read: the directory stands in
    // for the repository here, so the file exists and only the rule can refuse it.
    for (const path of [good, directory]) {
      assert.throws(() => cloudClientInjection([`${CLOUD_CLIENT_ARGUMENT}${path}`], directory), /outside this repository/, path);
    }
    // A file at the root whose name begins with two dots is inside, and so is one reached through a link
    // from outside: the rule reads whole segments of real paths (stage 2 review, L4). A junction stands in
    // for the link, because Windows lets anyone make one.
    const dotted = join(directory, '..cloud-client.json');
    writeFileSync(dotted, CONFIG);
    const inner = join(directory, 'inner');
    mkdirSync(inner);
    writeFileSync(join(inner, 'client.json'), CONFIG);
    symlinkSync(inner, join(outside, 'link'), 'junction');
    for (const path of [dotted, join(outside, 'link', 'client.json')]) {
      assert.throws(() => cloudClientInjection([`${CLOUD_CLIENT_ARGUMENT}${path}`], directory), /outside this repository/, path);
    }
    assert.equal(cloudClientInjection([`${CLOUD_CLIENT_ARGUMENT}${join(outside, 'link', 'client.json')}`]).sha256,
      createHash('sha256').update(CONFIG).digest('hex'), 'the same link is taken by this repository, which its target is outside');
  } finally {
    if (saved === undefined) delete process.env.MRT_CLOUD_CLIENT_CONFIG;
    else process.env.MRT_CLOUD_CLIENT_CONFIG = saved;
    rmSync(join(outside, 'link'), { recursive: false, force: true });
    rmSync(outside, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a Windows build identity records the configuration\'s digest, or null, and never its contents', async () => {
  const dormant = await buildIdentity('windows-portable', JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
  assert.equal(dormant.cloudClient, null);
  const digest = createHash('sha256').update(CONFIG).digest('hex');
  const carried = await buildIdentity('windows-msix', `${dormant.productVersion}.0`, undefined, ROOT, { cloudClient: digest });
  assert.equal(carried.cloudClient, digest);
  assert.ok(!JSON.stringify(carried).includes('test-client'), 'the client identifier is not in the identity');
});
