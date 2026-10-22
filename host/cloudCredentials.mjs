import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';

const PROFILE_ID = /^[a-f0-9]{64}$/;

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
