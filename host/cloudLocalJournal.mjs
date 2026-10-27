import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const MAX_RECORDS = 8192;
const MAX_BYTES = 32768;

function failure() {
  return new Error('Native cloud ownership journal is incomplete or inconsistent. Preserve its files before recovery.');
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

// Only native owners supply namespaces and validators; no browser-selected paths reach this helper.
export async function openCloudLocalJournal({ directory, namespace, format, initial, validate, transition }) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || !Array.isArray(namespace) || !namespace.length
    || namespace.some((part) => typeof part !== 'string' || !/^[a-z0-9-]{1,80}$/.test(part))
    || typeof format !== 'string' || !/^[a-z-]{1,80}$/.test(format)
    || typeof validate !== 'function' || typeof transition !== 'function') throw new TypeError('Native ownership configuration is required.');
  const root = join(directory, ...namespace);
  const name = (sequence) => `${String(sequence).padStart(16, '0')}.json`;
  async function regular(path, folder = false) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (folder ? !info.isDirectory()
      : !info.isFile() || info.size < 1 || info.size > MAX_BYTES)) throw failure();
  }
  async function write(path, bytes) {
    if (Buffer.byteLength(bytes) > MAX_BYTES) throw failure();
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); }
    finally { await file.close(); }
    await regular(path);
    if (await readFile(path, 'utf8') !== bytes) throw failure();
  }
  function decode(bytes) {
    const record = JSON.parse(bytes);
    if (!record || Object.keys(record).sort().join(',') !== 'format,kind,previous,sequence,state,version'
      || record.format !== format || record.version !== 1 || !Number.isSafeInteger(record.sequence) || record.sequence < 0
      || !['state', 'maintenance'].includes(record.kind)
      || (record.previous !== null && !/^[a-f0-9]{64}$/.test(record.previous))
      || JSON.stringify(record) !== bytes || validate(record.state) !== true) throw failure();
    return record;
  }
  async function load(visit) {
    await regular(root, true);
    const names = (await readdir(root)).sort();
    if (!names.length || names.some((entry) => !/^(?:c-)?\d{16}\.json$/.test(entry))) throw failure();
    const checkpoints = names.filter((entry) => entry.startsWith('c-'));
    const checkpoint = checkpoints.at(-1);
    let prior = null;
    if (checkpoint) {
      const path = join(root, checkpoint);
      await regular(path);
      const bytes = await readFile(path, 'utf8');
      const record = decode(bytes);
      if (record.kind !== 'maintenance' || checkpoint !== `c-${name(record.sequence)}`) throw failure();
      prior = { record, bytes, checkpoint: true };
      if (visit) visit(record.state);
    }
    const records = names.filter((entry) => !entry.startsWith('c-')
      && (!prior || entry > name(prior.record.sequence)));
    if (records.length > MAX_RECORDS + 1) throw failure();
    for (const entry of records) {
      const path = join(root, entry);
      await regular(path);
      const bytes = await readFile(path, 'utf8');
      const record = decode(bytes);
      if (entry !== name(prior ? prior.record.sequence + 1 : 0)
        || record.previous !== (prior ? hash(prior.bytes) : null)
        || (prior?.record.kind === 'maintenance' && !prior.checkpoint)) throw failure();
      if (record.kind === 'maintenance') {
        if (!prior || JSON.stringify(record.state) !== JSON.stringify(prior.record.state)) throw failure();
      } else if (transition(prior?.record.state ?? null, record.state) !== true) throw failure();
      prior = { record, bytes, checkpoint: false };
      if (visit) visit(record.state);
    }
    if (!prior) throw failure();
    if (records.length > MAX_RECORDS && prior.record.kind !== 'maintenance') throw failure();
    const last = join(root, prior.checkpoint ? `c-${name(prior.record.sequence)}` : name(prior.record.sequence));
    const file = await open(last, 'r+');
    try { await file.sync(); } finally { await file.close(); }
    return prior;
  }
  async function guarded(operation) {
    try { return await operation(); } catch { throw failure(); }
  }
  await guarded(async () => {
    try { await lstat(root); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(join(root, '..'), { recursive: true, mode: 0o700 });
      try { await mkdir(root, { mode: 0o700 }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await load();
        return;
      }
      if (validate(initial) !== true || transition(null, initial) !== true) throw failure();
      await write(join(root, name(0)), JSON.stringify({
        format, version: 1, sequence: 0, previous: null, kind: 'state', state: initial,
      }));
    }
    await load();
  });
  return {
    capacity: () => guarded(async () => {
      const prior = await load();
      const count = (await readdir(root)).filter((entry) => !entry.startsWith('c-')).length;
      return { maximumRecords: MAX_RECORDS, remainingTransitions: MAX_RECORDS - count,
        canUpdate: prior.record.kind !== 'maintenance' || prior.checkpoint === true };
    }),
    inspect: () => guarded(async () => {
      const prior = await load();
      return { sequence: prior.record.sequence, state: globalThis.structuredClone(prior.record.state) };
    }),
    update: ({ expectedSequence, change }) => guarded(async () => {
      const prior = await load();
      if (prior.record.sequence !== expectedSequence || (prior.record.kind === 'maintenance' && !prior.checkpoint)
        || !Number.isSafeInteger(expectedSequence + 1) || typeof change !== 'function') throw failure();
      const state = await change(globalThis.structuredClone(prior.record.state));
      if (validate(state) !== true || transition(prior.record.state, state) !== true) throw failure();
      const count = (await readdir(root)).filter((entry) => !entry.startsWith('c-')).length;
      if (count >= MAX_RECORDS) throw failure();
      const record = { format, version: 1, sequence: expectedSequence + 1, previous: hash(prior.bytes), kind: 'state', state };
      await write(join(root, name(record.sequence)), JSON.stringify(record));
      return { sequence: record.sequence, state: globalThis.structuredClone(state) };
    }),
    compact: ({ canCompact } = {}) => guarded(async () => {
      let prior = await load();
      if (canCompact !== undefined && (typeof canCompact !== 'function'
        || canCompact(globalThis.structuredClone(prior.record.state)) !== true)) throw failure();
      if (prior.record.kind !== 'maintenance' || prior.checkpoint) {
        const record = { ...prior.record, sequence: prior.record.sequence + 1, previous: hash(prior.bytes), kind: 'maintenance' };
        if (!Number.isSafeInteger(record.sequence)) throw failure();
        const bytes = JSON.stringify(record);
        await write(join(root, name(record.sequence)), bytes);
        prior = { record, bytes };
      }
      const checkpoint = `c-${name(prior.record.sequence)}`;
      if (!prior.checkpoint) await write(join(root, checkpoint), prior.bytes);
      // Publishing the flushed checkpoint releases later appends. Cleanup never touches that tail.
      for (const entry of await readdir(root)) {
        if (entry === checkpoint || (entry.startsWith('c-') ? entry > checkpoint : entry > name(prior.record.sequence))) continue;
        if (!/^(?:c-)?\d{16}\.json$/.test(entry)) throw failure();
        await regular(join(root, entry));
        await unlink(join(root, entry));
      }
      const after = await load();
      return { sequence: after.record.sequence, state: globalThis.structuredClone(after.record.state) };
    }),
  };
}
