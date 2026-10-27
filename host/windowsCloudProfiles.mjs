import { createWindowsCloudAuth, CloudAuthenticationError } from './windowsCloudAuth.mjs';

const PROFILE = /^[a-f0-9]{64}$/;

export function createWindowsCloudProfiles({ directory, clients, openBrowser, createAuth = createWindowsCloudAuth }) {
  if (typeof openBrowser !== 'function' || typeof createAuth !== 'function') {
    throw new TypeError('Native cloud profiles require host-owned authentication configuration.');
  }
  const profiles = new Map();
  function failure() {
    return new CloudAuthenticationError('Native cloud profile initialization or cleanup failed. Preserve its files and check the host configuration before retrying.');
  }
  return async function adapterForProfile({ profileId, provider }) {
    if (typeof profileId !== 'string' || !PROFILE.test(profileId)
      || !['google', 'microsoft'].includes(provider)) {
      throw new TypeError('Invalid native cloud profile binding.');
    }
    let owner = profiles.get(profileId);
    if (!owner) {
      if (profiles.size >= 256) {
        throw new CloudAuthenticationError('Native cloud profile limit reached. Restart the host before opening more profiles.');
      }
      owner = { epoch: 0, active: null };
      profiles.set(profileId, owner);
    }
    if (owner.active && owner.active.provider !== provider) {
      throw new CloudAuthenticationError('Disconnect the existing provider before choosing another destination.');
    }
    if (!owner.active) {
      const client = clients?.[provider];
      if (!client || typeof client.clientId !== 'string' || !client.clientId) {
        throw new CloudAuthenticationError('The selected native cloud provider is not configured.');
      }
      const epoch = ++owner.epoch;
      const entry = { provider, epoch, stopped: false, cleanup: null, initialization: null };
      owner.active = entry;
      // Queue construction after recording ownership so simultaneous requests share one factory.
      entry.initialization = Promise.resolve().then(() => createAuth({
        directory, provider, profileId, epoch, openBrowser,
        clientId: client.clientId, clientSecret: client.clientSecret,
        isCurrent: (binding) => owner.active === entry && !entry.stopped
          && binding.profileId === profileId && binding.provider === provider && binding.epoch === epoch,
      }));
      // The owner retains the failure for explicit diagnostics/cleanup without an unhandled rejection.
      entry.initialization.catch(() => {});
    }
    const entry = owner.active;
    function check() {
      if (entry.stopped || owner.active !== entry) {
        throw new CloudAuthenticationError('This cloud profile connection is no longer active.');
      }
    }
    async function use(operation) {
      check();
      let auth;
      try { auth = await entry.initialization; } catch { throw failure(); }
      check();
      const result = await auth[operation]();
      check();
      return result;
    }
    return {
      status: () => use('status'),
      connect: () => use('connect'),
      getAccessToken: () => use('getAccessToken'),
      disconnect() {
        if (owner.active !== entry) {
          return Promise.reject(new CloudAuthenticationError('This cloud profile connection is no longer active.'));
        }
        entry.stopped = true;
        if (!entry.cleanup) {
          entry.cleanup = (async () => {
            try {
              const auth = await entry.initialization;
              await auth.disconnect();
              if (owner.active === entry) owner.active = null;
            } catch {
              throw failure();
            }
          })();
          entry.cleanup.catch(() => { entry.cleanup = null; });
        }
        return entry.cleanup;
      },
    };
  };
}
