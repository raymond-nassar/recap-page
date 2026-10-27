import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { MICROSOFT_PUBLICATION_PROTOCOL } from './cloudMicrosoftPublicationRecord.mjs';

const HEX = /^[a-f0-9]{64}$/;
const READY = 'recap-cloud-destination-v1\n';
const PUBLICATION_READY = 'recap-cloud-destination-v2\n';
const MAX_BYTES = 8192;

export class CloudDestinationError extends Error {
  constructor() {
    super('Cloud destination ownership is missing, incomplete or does not match this account. Preserve its files before recovery; uploads remain blocked.');
    this.name = 'CloudDestinationError';
  }
}

function identifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9!_.:-]{1,256}$/.test(value) && !['.', '..'].includes(value);
}

function slots(value) {
  return Array.isArray(value) && value.length === 2 && value.every(identifier) && value[0] !== value[1];
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function regular(path, limit, directory = false) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory()
    : !info.isFile() || info.size < 1 || info.size > limit)) throw new CloudDestinationError();
}

async function writeExclusive(path, bytes) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally { await file.close(); }
  await regular(path, Buffer.byteLength(bytes));
  if (await readFile(path, 'utf8') !== bytes) throw new CloudDestinationError();
}

// Read only host-owned metadata to recover the exact root, never the special-folder creating lookup.
export async function loadCloudDestination({ directory, profileId, provider, accountId, clientId }) {
  if (typeof directory !== 'string' || !isAbsolute(directory)
    || typeof profileId !== 'string' || !HEX.test(profileId) || !['google', 'microsoft'].includes(provider)
    || [accountId, clientId].some((value) => typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024)) {
    throw new TypeError('Native destination identity is required.');
  }
  try {
    let publication = false;
    if (provider === 'microsoft') {
      try {
        await lstat(join(directory, 'cloud-publication-destinations', profileId, provider, hash(accountId)));
        publication = true;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const root = join(directory, publication ? 'cloud-publication-destinations' : 'cloud-destinations',
      profileId, provider, hash(accountId));
    await regular(root, 0, true);
    const path = join(root, 'destination.json');
    await regular(path, MAX_BYTES);
    const record = JSON.parse(await readFile(path, 'utf8'));
    const binding = record?.binding;
    if (!binding || binding.profileId !== profileId || binding.provider !== provider
      || binding.account !== hash(accountId) || binding.client !== hash(clientId)) throw new CloudDestinationError();
    if (publication && (record.version !== 2 || record.protocol !== MICROSOFT_PUBLICATION_PROTOCOL)) throw new CloudDestinationError();
    return await openCloudDestination({ directory, profileId, provider, accountId, clientId,
      appRootId: binding.appRootId, driveId: binding.driveId,
      ...(publication ? { protocol: MICROSOFT_PUBLICATION_PROTOCOL } : {}) });
  } catch { throw new CloudDestinationError(); }
}

// Initialization must follow explicit discovery/choice; restored snapshots never supply ownership.
export async function openCloudDestination({
  directory, profileId, provider, accountId, clientId, appRootId, driveId = null,
  fixedSlots, initialize = false, streamId, protocol,
}) {
  if (typeof directory !== 'string' || !isAbsolute(directory)
    || typeof profileId !== 'string' || !HEX.test(profileId)
    || !['google', 'microsoft'].includes(provider)
    || typeof accountId !== 'string' || !accountId || Buffer.byteLength(accountId) > 1024
    || typeof clientId !== 'string' || !clientId || Buffer.byteLength(clientId) > 1024
    || (provider === 'google' ? appRootId !== 'appDataFolder' || driveId !== null
      : !identifier(appRootId) || !identifier(driveId))
    || typeof initialize !== 'boolean' || (initialize ? !slots(fixedSlots) : fixedSlots !== undefined || streamId !== undefined)
    || (protocol !== undefined && (provider !== 'microsoft' || protocol !== MICROSOFT_PUBLICATION_PROTOCOL))
    || (streamId !== undefined && (typeof streamId !== 'string' || !HEX.test(streamId)))) {
    throw new TypeError('Cloud destination requires an exact native account, client, app root and reserved slot binding.');
  }

  const binding = {
    profileId, provider, account: hash(accountId), client: hash(clientId), appRootId, driveId,
  };
  const publication = protocol === MICROSOFT_PUBLICATION_PROTOCOL;
  const ready = publication ? PUBLICATION_READY : READY;
  const parent = join(directory, publication ? 'cloud-publication-destinations' : 'cloud-destinations', profileId, provider);
  const root = join(parent, binding.account);
  const manifest = join(root, 'destination.json');
  const marker = join(root, 'ready');
  async function read() {
    await regular(root, 0, true);
    const names = (await readdir(root)).sort();
    if (!same(names, ['destination.json', 'ready'])) throw new CloudDestinationError();
    await regular(marker, Buffer.byteLength(ready));
    if (await readFile(marker, 'utf8') !== ready) throw new CloudDestinationError();
    await regular(manifest, MAX_BYTES);
    const bytes = await readFile(manifest, 'utf8');
    if (Buffer.byteLength(bytes) > MAX_BYTES) throw new CloudDestinationError();
    const record = JSON.parse(bytes);
    if (!record || Object.keys(record).sort().join(',') !== (publication
      ? 'binding,fixedSlots,format,protocol,streamId,version' : 'binding,fixedSlots,format,streamId,version')
      || record.format !== 'recap-cloud-destination' || record.version !== (publication ? 2 : 1)
      || (publication && record.protocol !== MICROSOFT_PUBLICATION_PROTOCOL)
      || !same(record.binding, binding) || typeof record.streamId !== 'string' || !HEX.test(record.streamId)
      || !slots(record.fixedSlots) || JSON.stringify(record) !== bytes) throw new CloudDestinationError();
    return record;
  }
  try {
    if (initialize) {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      await mkdir(root, { mode: 0o700 });
      await regular(root, 0, true);
      const bytes = JSON.stringify({
        format: 'recap-cloud-destination', version: publication ? 2 : 1,
        ...(publication ? { protocol: MICROSOFT_PUBLICATION_PROTOCOL } : {}), binding,
        streamId: streamId ?? randomBytes(32).toString('hex'), fixedSlots: fixedSlots.slice(),
      });
      if (Buffer.byteLength(bytes) > MAX_BYTES) throw new CloudDestinationError();
      await writeExclusive(manifest, bytes);
      await writeExclusive(marker, ready);
      if (JSON.stringify(await read()) !== bytes) throw new CloudDestinationError();
    }
    const record = await read();
    // A reopener can observe completed records before the initializer's flush has returned.
    for (const path of [manifest, marker]) {
      const file = await open(path, 'r+');
      try { await file.sync(); } finally { await file.close(); }
    }
    return {
      profileId, provider, account: binding.account, client: binding.client, appRootId, driveId,
      streamId: record.streamId, fixedSlots: record.fixedSlots.slice(),
      ...(publication ? { protocol: MICROSOFT_PUBLICATION_PROTOCOL } : {}),
    };
  } catch {
    throw new CloudDestinationError();
  }
}
