import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { CLOUD_SLOT_NAME } from './cloudDiscovery.mjs';
import { copyCloudFailureMetadata } from './cloudFailure.mjs';
import { isCloudMatchTag } from './cloudProviderTransport.mjs';
import {
  MICROSOFT_PUBLICATION_SEED, decodeMicrosoftPublicationDescription, microsoftPayloadName,
} from './cloudMicrosoftPublicationRecord.mjs';

const SEED = Buffer.from(MICROSOFT_PUBLICATION_SEED);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export class CloudMicrosoftPublicationReadError extends Error {
  constructor() {
    super('OneDrive publication or its immutable snapshot changed. No backup was selected; preserve its records and retry discovery when ready.');
    this.name = 'CloudMicrosoftPublicationReadError';
  }
}

export function createMicrosoftPublicationReads({ reads, isCurrent }) {
  if (typeof reads?.listFiles !== 'function' || typeof reads.readFile !== 'function'
    || typeof reads.readConditionalFile !== 'function' || typeof reads.readMetadata !== 'function'
    || typeof reads.discoverRoot !== 'function' || typeof isCurrent !== 'function') {
    throw new TypeError('OneDrive publication reads require bounded native metadata and payload owners.');
  }
  let discovered = new WeakMap();
  function current() { if (isCurrent() !== true) throw new CloudMicrosoftPublicationReadError(); }
  async function call(operation) {
    current();
    const result = await operation();
    current();
    return result;
  }
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) { throw copyCloudFailureMetadata(new CloudMicrosoftPublicationReadError(), error); }
  }
  async function recordFor(file) {
    const match = CLOUD_SLOT_NAME.exec(file.name);
    if (!match || file.size !== SEED.length) return null;
    const metadata = await call(() => reads.readMetadata({ id: file.id }));
    const selected = await call(() => reads.readConditionalFile({ id: file.id }));
    if (metadata.file?.id !== file.id || metadata.file.name !== file.name || metadata.file.size !== SEED.length
      || selected.file?.id !== file.id || selected.file.name !== file.name || selected.file.size !== SEED.length
      || selected.condition !== metadata.condition || !Buffer.isBuffer(selected.bytes)) throw new CloudMicrosoftPublicationReadError();
    if (!selected.bytes.equals(SEED)) return null;
    const record = metadata.description === null || metadata.description === '' ? null
      : decodeMicrosoftPublicationDescription(metadata.description, { streamId: match[1], slotId: file.id });
    return { metadata, record };
  }
  function sameVersion(before, after) {
    return after.file?.id === before.file.id && after.file.name === before.file.name
      && after.file.size === SEED.length && isCloudMatchTag(after.condition)
      && after.condition === before.condition && after.description === before.description;
  }
  async function published(source, identified, conditional) {
    if (!identified?.record?.publication) return source;
    const { metadata, record } = identified;
    const publication = record.publication;
    const data = await call(() => reads.readFile({ id: publication.payloadId }));
    if (data.file?.id !== publication.payloadId
      || data.file.name !== microsoftPayloadName(record.streamId, publication.attemptId)
      || !Buffer.isBuffer(data.bytes) || data.bytes.length !== publication.byteLength
      || hash(data.bytes) !== publication.digest) throw new CloudMicrosoftPublicationReadError();
    const after = await call(() => reads.readMetadata({ id: source.file.id }));
    if (after.file?.id !== source.file.id || after.file.name !== source.file.name || after.file.size !== SEED.length
      || after.condition !== metadata.condition || after.description !== metadata.description) {
      throw new CloudMicrosoftPublicationReadError();
    }
    const bytes = Buffer.from(data.bytes);
    return {
      file: { ...metadata.file, size: bytes.length }, bytes, digest: publication.digest, publication: record,
      ...(conditional ? { condition: metadata.condition } : {}),
    };
  }
  async function selected(selection, conditional) {
    const witness = discovered.get(selection);
    discovered.delete(selection);
    if (witness) {
      const metadata = await call(() => reads.readMetadata({ id: selection.id }));
      if (sameVersion(witness.metadata, metadata)) {
        return published({
          file: metadata.file, bytes: Buffer.from(SEED), digest: hash(SEED),
          ...(conditional ? { condition: metadata.condition } : {}),
        }, witness, conditional);
      }
    }
    const source = await call(() => conditional ? reads.readConditionalFile(selection) : reads.readFile(selection));
    if (!source.file || !Buffer.isBuffer(source.bytes) || !source.bytes.equals(SEED)) return source;
    return published(source, await recordFor(source.file), conditional);
  }
  return {
    discoverRoot: () => guarded(() => call(() => reads.discoverRoot())),
    readMetadata: (selection) => guarded(() => call(() => reads.readMetadata(selection))),
    listFiles: () => guarded(async () => {
      discovered = new WeakMap();
      const files = await call(() => reads.listFiles());
      if (!Array.isArray(files) || files.length > 2000) throw new CloudMicrosoftPublicationReadError();
      const result = [];
      for (const file of files) {
        const identified = await recordFor(file);
        const logical = identified?.record?.publication
          ? { ...identified.metadata.file, size: identified.record.publication.byteLength } : file;
        if (identified) discovered.set(logical, identified);
        result.push(logical);
      }
      return result;
    }),
    readFile: (selection) => guarded(() => selected(selection, false)),
    readConditionalFile: (selection) => guarded(() => selected(selection, true)),
  };
}
