import { CloudBackupError } from './cloudProtocol.js';

const PREFIX = 'mrt.cloud-backup.upload-permit.v1.';
const unavailable = () => new CloudBackupError('Cloud upload permission could not be checked. Automatic backups stay paused.', 'storage');

// Unlike a checking tab's lock, a revoked worker permit does not reappear when that tab closes.
// Revocation and grants run under the existing backup worker lock, never around a provider request.
export class CloudUploadPermit {
  constructor({ locks = globalThis.navigator?.locks, id = globalThis.crypto?.randomUUID?.(), onLost = () => {} } = {}) {
    this.locks = locks;
    this.name = typeof id === 'string' && id ? `${PREFIX}${id}` : null;
    this.onLost = onLost;
    this.ticket = null;
  }

  async query() {
    if (!this.name || typeof this.locks?.request !== 'function' || typeof this.locks?.query !== 'function') {
      throw new CloudBackupError('This app or browser cannot safely coordinate cloud uploads. Update it, then check again. Automatic backups stay paused.', 'unsupported');
    }
    const state = await this.locks.query();
    if (!Array.isArray(state?.held) || !Array.isArray(state?.pending)) throw unavailable();
    return state;
  }

  async revokeAll(authorize = () => true) {
    const state = await this.query();
    for (const name of new Set([...state.held, ...state.pending].map((lock) => lock.name)
      .filter((name) => typeof name === 'string' && name.startsWith(PREFIX)))) {
      if (!authorize()) throw unavailable();
      await this.locks.request(name, { mode: 'exclusive', steal: true }, () => {});
    }
    if (!authorize()) throw unavailable();
  }

  release() {
    const ticket = this.ticket;
    this.ticket = null;
    ticket?.release();
  }

  async grant(authorize = () => true) {
    await this.query();
    if (!authorize()) throw unavailable();
    this.release();
    let acquired;
    let failed;
    const ready = new Promise((resolve, reject) => { acquired = resolve; failed = reject; });
    const ticket = { release: () => {}, held: false };
    const lifetime = new Promise((resolve) => { ticket.release = resolve; });
    this.ticket = ticket;
    void this.locks.request(this.name, { mode: 'exclusive' }, async () => {
      if (this.ticket !== ticket || !authorize()) { failed(unavailable()); return; }
      ticket.held = true;
      acquired();
      await lifetime;
    }).catch(() => {
      failed(unavailable());
      if (this.ticket !== ticket) return;
      this.ticket = null;
      ticket.release();
      this.onLost();
    });
    await ready;
    if (this.ticket !== ticket || !authorize()) {
      if (this.ticket === ticket) this.release();
      throw unavailable();
    }
  }

  async allowed() {
    const ticket = this.ticket;
    if (!ticket?.held) return false;
    const state = await this.query();
    return this.ticket === ticket && state.held.some((lock) => lock.name === this.name && lock.mode === 'exclusive');
  }
}
