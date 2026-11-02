import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const java = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac')
  : 'javac';
const jdk = spawnSync(java, ['-version'], { encoding: 'utf8' }).status === 0;

test('Android Google consent keeps delayed answers and launches bound to their attempts', {
  skip: jdk ? false : 'JDK required to compile the actual Android adapter against the JVM stubs',
}, () => {
  const result = spawnSync(process.execPath, ['scripts/android-google-adapter-proof.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const scenario of [
    'delayed authorization', 'delayed screen result', 'delayed direct token', 'queued cancelled activity',
    'unavailable Play services', 'interrupted token cache clear', 'malformed consent responses', 'cancellation before activity launch',
    'cancellation before consent launch',
  ]) {
    assert.ok(result.stdout.includes(`PASS: ${scenario}`), `Missing JVM scenario: ${scenario}`);
  }
});

test('Android sign-in paths do not call Google revocation', () => {
  const root = join('packaging', 'android', 'app', 'src', 'main', 'java',
    'io', 'github', 'raymondnassar', 'recappage', 'prototype');
  const files = readdirSync(root).filter((name) => name.endsWith('.java'));
  assert.ok(files.includes('AndroidGoogle.java') && files.includes('GoogleConsentActivity.java'));
  const revoke = /\.\s*revokeAccess\s*\(|(?:oauth2\.googleapis\.com|accounts\.google\.com)\/(?:o\/oauth2\/)?revoke\b/;
  for (const name of files) {
    assert.doesNotMatch(readFileSync(join(root, name), 'utf8'), revoke, `${name} must not revoke Google access`);
  }
});
