import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCloudClient } from '../host/cloudConfig.mjs';
import { REDIRECT_HASH } from './android-cloud-client.mjs';
import { ROOT } from './lib/release-identity.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw new Error('Release cloud configuration: approved inputs are missing or invalid.'); };

export function releaseCloudInput(clientId, redirectHash) {
  const bytes = Buffer.from(`${JSON.stringify({
    format: 'recap-page-cloud-client', version: 1,
    providers: { onedrive: { clientId, authority: 'consumers' } },
  })}\n`);
  parseCloudClient(bytes.toString('utf8'));
  if (redirectHash !== undefined && !REDIRECT_HASH.test(redirectHash)) fail();
  return {
    bytes,
    expectation: redirectHash === undefined ? null : `${clientId}\n${redirectHash}\n`,
    digest: redirectHash === undefined ? hash(bytes)
      : hash(JSON.stringify({ clientId, redirectHash })),
  };
}

async function location(env) {
  if (!env.RUNNER_TEMP || !isAbsolute(env.RUNNER_TEMP)
    || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) fail();
  const parent = await realpath(env.RUNNER_TEMP);
  const within = relative(await realpath(ROOT), parent);
  if (!(within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within))) fail();
  return {
    directory: join(parent, 'recap-release-cloud-client'),
    owner: `${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}`,
  };
}

export async function removeReleaseCloudInput(env = process.env) {
  const { directory, owner } = await location(env);
  let marker;
  try { marker = await readFile(join(directory, '.owner'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (marker !== owner || await realpath(directory) !== directory) fail();
  await rm(directory, { recursive: true });
}

export async function writeReleaseCloudInput(android, env = process.env) {
  const { directory, owner } = await location(env);
  const input = releaseCloudInput(env.RECAP_ONEDRIVE_CLIENT_ID,
    android ? env.RECAP_ONEDRIVE_PLAY_REDIRECT_HASH ?? '' : undefined);
  await mkdir(directory, { mode: 0o700 });
  try {
    await writeFile(join(directory, '.owner'), owner, { mode: 0o600, flag: 'wx' });
    await writeFile(join(directory, 'cloud-client.json'), input.bytes, { mode: 0o600, flag: 'wx' });
    if (android) {
      await writeFile(join(directory, 'redirect-hash'), env.RECAP_ONEDRIVE_PLAY_REDIRECT_HASH, { mode: 0o600, flag: 'wx' });
      await writeFile(join(directory, 'expectation'), input.expectation, { mode: 0o600, flag: 'wx' });
    }
    return { directory, digest: input.digest };
  } catch (error) {
    await removeReleaseCloudInput(env);
    throw error;
  }
}

async function main() {
  const [mode] = process.argv.slice(2);
  if (mode === 'cleanup') return removeReleaseCloudInput();
  if (mode === 'android') {
    await writeReleaseCloudInput(true);
    return;
  }
  const packager = { 'windows-msix': 'pack-msix.mjs', 'windows-portable': 'pack-windows.mjs' }[mode];
  if (!packager) fail();
  const { directory } = await writeReleaseCloudInput(false);
  try {
    const env = { ...process.env };
    delete env.RECAP_ONEDRIVE_CLIENT_ID;
    delete env.RECAP_ONEDRIVE_PLAY_REDIRECT_HASH;
    const result = spawnSync(process.execPath, [
      join(ROOT, 'scripts', packager), `--cloud-client=${join(directory, 'cloud-client.json')}`,
    ], { env, stdio: 'inherit' });
    if (result.error || result.signal || result.status !== 0) throw new Error('Release cloud configuration: packaging failed.');
  } finally {
    await removeReleaseCloudInput();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Release cloud configuration failed; no approved release output. Check the protected inputs.');
    process.exitCode = 1;
  });
}
