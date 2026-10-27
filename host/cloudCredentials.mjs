import { randomBytes, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';

const PROFILE_ID = /^[a-f0-9]{64}$/;
const HOST_PROFILE = '0'.repeat(64);
const HOST_READY = 'recap-cloud-host-identity-v1\n';

async function regularFile(path, limit) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size > limit) {
    throw new Error('Invalid protected identity file.');
  }
}

export async function loadCloudHostSigningKey({
  directory,
  platform = process.platform,
  loadSdk,
}) {
  if (platform !== 'win32') {
    throw new Error('Cloud host identity requires Windows protection. Local reading remains available.');
  }
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new TypeError('The cloud identity directory must be an absolute host-owned path.');
  }
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const root = join(directory, 'host-identity');
    let initialize = false;
    try {
      // Reserving the directory also preserves evidence if initialization never reaches its marker.
      await mkdir(root, { mode: 0o700 });
      initialize = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid identity directory.');
    const ready = join(root, 'ready');
    const path = join(root, HOST_PROFILE, 'credentials.bin');
    if (!initialize) {
      await regularFile(ready, Buffer.byteLength(HOST_READY));
      if (await readFile(ready, 'utf8') !== HOST_READY) throw new Error('Invalid identity marker.');
      await regularFile(path, 64 * 1024);
    }
    const persistence = await createCloudCredentialPersistence({
      directory: root, profileId: HOST_PROFILE, platform, loadSdk,
    });
    if (initialize) {
      const bytes = JSON.stringify({
        format: 'recap-cloud-host-identity', version: 1, key: randomBytes(32).toString('hex'),
      });
      await persistence.save(bytes);
      if (await persistence.load() !== bytes) throw new Error('Identity save could not be verified.');
      await regularFile(path, 64 * 1024);
      const protectedFile = await open(path, 'r+');
      try { await protectedFile.sync(); } finally { await protectedFile.close(); }
      const marker = await open(ready, 'wx', 0o600);
      try {
        await marker.writeFile(HOST_READY);
        await marker.sync();
      } finally {
        await marker.close();
      }
    }
    const bytes = await persistence.load();
    if (typeof bytes !== 'string' || Buffer.byteLength(bytes) > 256) throw new Error('Invalid identity.');
    const record = JSON.parse(bytes);
    if (!record || Object.keys(record).sort().join(',') !== 'format,key,version'
      || record.format !== 'recap-cloud-host-identity' || record.version !== 1
      || typeof record.key !== 'string' || !/^[a-f0-9]{64}$/.test(record.key)) {
      throw new Error('Invalid identity.');
    }
    return Buffer.from(record.key, 'hex');
  } catch {
    throw new Error('Cloud host identity is unavailable or incomplete. Preserve its files before recovery. Local reading remains available.');
  }
}

export async function createCloudCredentialPersistence({
  directory,
  profileId,
  platform = process.platform,
  loadSdk = () => import('@azure/msal-node-extensions'),
}) {
  if (platform !== 'win32') {
    throw new Error('Cloud credential protection requires a supported Windows host. Local reading remains available.');
  }
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new TypeError('The cloud credential directory must be an absolute host-owned path.');
  }
  if (typeof profileId !== 'string' || !PROFILE_ID.test(profileId)) {
    throw new TypeError('The cloud profile must be a host-issued identifier.');
  }
  const { FilePersistenceWithDataProtection, DataProtectionScope } = await loadSdk();
  const root = join(directory, profileId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const logger = {
    piiLoggingEnabled: false,
    // Operation failures still reject; SDK diagnostics never become token or callback logs.
    loggerCallback: () => {},
  };
  const create = (name) => FilePersistenceWithDataProtection.create(
    join(root, name), DataProtectionScope.CurrentUser, undefined, logger,
  );
  const probe = await create(`protection-${randomUUID()}.bin`);
  const sample = `Recap Page credential protection check ${randomUUID()}`;
  try {
    await probe.save(sample);
    if (await probe.load() !== sample) {
      throw new Error('Cloud credential protection could not be verified. No account credentials were saved.');
    }
  } finally {
    await probe.delete();
  }
  return create('credentials.bin');
}
