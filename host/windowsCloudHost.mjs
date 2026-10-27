import process from 'node:process';
import { isAbsolute } from 'node:path';
import { createCloudControlHandler } from './cloudControl.mjs';
import { loadCloudHostSigningKey } from './cloudCredentials.mjs';
import { createWindowsCloudAuth } from './windowsCloudAuth.mjs';
import { createWindowsCloudBackupService } from './windowsCloudBackup.mjs';

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nativeString(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 8192
    && /^[\x21-\x7e]+$/.test(value);
}

function clientConfiguration(clients) {
  if (!object(clients) || Object.keys(clients).sort().join(',') !== 'google,microsoft'
    || !object(clients.google) || !object(clients.microsoft)
    || Object.keys(clients.google).sort().join(',') !== 'clientId,clientSecret'
    || Object.keys(clients.microsoft).join(',') !== 'clientId'
    || !nativeString(clients.google.clientId) || !nativeString(clients.google.clientSecret)
    || !nativeString(clients.microsoft.clientId)) {
    throw new TypeError('Native cloud client configuration is incomplete or unsupported.');
  }
  return Object.freeze({
    google: Object.freeze({ clientId: clients.google.clientId, clientSecret: clients.google.clientSecret }),
    microsoft: Object.freeze({ clientId: clients.microsoft.clientId }),
  });
}

export function createWindowsCloudHostControl({
  directory, clients, openBrowser, platform = process.platform,
  createAuth = createWindowsCloudAuth, fetchImpl = globalThis.fetch,
  loadSdk, loadMsal, loadGoogle, loadSigningKey = loadCloudHostSigningKey,
} = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new TypeError('Native cloud state requires an absolute host-owned private directory.');
  }
  if ([openBrowser, createAuth, fetchImpl, loadSigningKey].some((value) => typeof value !== 'function')
    || [loadSdk, loadMsal, loadGoogle].some((value) => value !== undefined && typeof value !== 'function')
    || typeof platform !== 'string') {
    throw new TypeError('Native cloud host configuration is incomplete.');
  }
  const nativeClients = clientConfiguration(clients);
  const adapterForProfile = createWindowsCloudBackupService({
    directory, clients: nativeClients, openBrowser, fetchImpl, loadSdk,
    createAuth: (binding) => createAuth({
      ...binding, fetchImpl, loadMsal, loadGoogle, loadPersistenceSdk: loadSdk,
    }),
  });
  return Object.freeze(createCloudControlHandler({
    adapterForProfile,
    loadSigningKey: () => {
      if (platform !== 'win32') throw new Error('Native cloud protection requires a supported Windows host.');
      return loadSigningKey({ directory, platform, loadSdk });
    },
  }));
}
