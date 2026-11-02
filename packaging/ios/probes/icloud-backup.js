// The shipping protocol and coordinator, driven through the native handler's configurable fake.
// Only the clock and timer queue are virtual: one simulated hour takes no network or wall-clock wait.
window.recapICloudBackupProbe = async ({ offline }) => {
  const load = (path) => import(new URL(path, location.href).href);
  const { CloudBackupProtocol, createCloudRecordStore } = await load('js/lib/cloudProtocol.js');
  const { CloudBackupCoordinator } = await load('js/lib/cloudCoordinator.js');
  const { createCloudHostTransport } = await load('js/lib/cloudHostTransport.js');
  const { captureCompleteBackup } = await load('js/lib/completeBackup.js');
  const { createEmptyState, exportBackup } = await load('js/lib/model.js');
  const { CLOUD_BACKUP_DATABASE, KEY, SETTINGS_KEY } = await load('js/storage.js');
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(CLOUD_BACKUP_DATABASE);
    request.onsuccess = resolve;
    request.onerror = () => reject(new Error('The probe could not reset its cloud record.'));
    request.onblocked = () => reject(new Error('Another page holds the cloud record.'));
  });
  const start = 1_800_000_000_000;
  let now = start;
  let nextTimer = 0;
  const timers = new Map();
  const setTimer = (callback, ms) => {
    const id = ++nextTimer;
    timers.set(id, { at: now + ms, callback });
    return id;
  };
  const clearTimer = (id) => timers.delete(id);
  const native = async (operation, body) => {
    const result = await window.webkit.messageHandlers.icloudProbe.postMessage({ operation, body });
    now = start + result.elapsed * 1000;
    return result;
  };
  const transport = createCloudHostTransport({
    prefix: '',
    fetchImpl: async (operation, { body }) => {
      const result = await native(operation, body);
      return { status: result.status, json: async () => JSON.parse(result.body) };
    },
  });
  const connected = await transport.connect({ provider: 'icloud' });
  const records = createCloudRecordStore();
  const protocol = new CloudBackupProtocol({ transport, records, clock: () => now, locks: null });
  await protocol.recordConsent({
    connection: connected.connection, provider: 'icloud', device: 'Recap Page on iPhone',
  });
  const saved = new Map([[KEY, JSON.stringify(exportBackup(createEmptyState()))]]);
  const storage = { getItem: (key) => saved.get(key) ?? null };
  let verified = 0;
  const coordinator = new CloudBackupCoordinator({
    capture: () => captureCompleteBackup({ storage }),
    upload: async (snapshot) => { await protocol.upload(snapshot); verified += 1; },
    lastUploaded: () => protocol.lastUploaded({ connection: connected.connection }),
    isOnline: () => true, isHidden: () => false, events: null, locks: null,
    clock: () => now, setTimer, clearTimer,
  });
  const advance = async (end) => {
    for (let attempts = 0; attempts < 1000; attempts += 1) {
      const due = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!due || due[1].at > end || now >= end) break;
      timers.delete(due[0]);
      await native('advance', { seconds: Math.max(0, due[1].at - now) / 1000 });
      due[1].callback();
      await coordinator.idle();
      if (attempts === 999) throw new Error('The probe exceeded its bounded timer budget.');
    }
    await native('advance', { seconds: Math.max(0, end - now) / 1000 });
  };
  try {
    coordinator.start();
    const changes = offline ? 1 : 10;
    for (let change = 0; change < changes; change += 1) {
      saved.set(SETTINGS_KEY, JSON.stringify({
        apiBase: 'https://metadata.example.test/v1', theme: change % 2 ? 'dark' : 'light',
      }));
      coordinator.notify();
      await advance(start + (change + 1) * (offline ? 3_600_000 : 360_000));
    }
    const summary = await native('summary', {});
    return JSON.stringify({
      changes, verified, phase: coordinator.state.phase,
      files: summary.files, pending: summary.pending,
      creates: summary.creates, maximumPending: summary.maximumPending,
    });
  } finally {
    coordinator.stop();
    records.close();
  }
};
