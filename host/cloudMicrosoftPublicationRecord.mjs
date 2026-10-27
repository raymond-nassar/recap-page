import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export const MICROSOFT_PUBLICATION_PROTOCOL = 'microsoft-publication-v1';
export const MICROSOFT_PUBLICATION_SEED = '{"format":"recap-page-cloud-publication-slot","version":1}';
export const MICROSOFT_PUBLICATION_MAX_BYTES = 1024;
const FORMAT = 'recap-ms-publication';
const HEX = /^[a-f0-9]{64}$/;
const MAX_PAYLOAD = 32 * 1024 * 1024;

export class CloudMicrosoftPublicationRecordError extends Error {
  constructor() {
    super('OneDrive publication metadata is incomplete or does not match this backup. Preserve local and cloud records before recovery.');
    this.name = 'CloudMicrosoftPublicationRecordError';
  }
}

function refuse() { throw new CloudMicrosoftPublicationRecordError(); }
function hex(value) { return typeof value === 'string' && HEX.test(value); }
function identifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9!_.:-]{1,256}$/.test(value) && !['.', '..'].includes(value);
}
function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
}
function validate(record) {
  if (!exact(record, ['streamId', 'slotId', 'nonce', 'publication'])
    || !hex(record.streamId) || !identifier(record.slotId) || !hex(record.nonce)) refuse();
  const publication = record.publication;
  if (publication !== null && (!exact(publication, ['attemptId', 'generation', 'payloadId', 'byteLength', 'digest'])
    || !hex(publication.attemptId) || !hex(publication.digest)
    || !identifier(publication.payloadId) || publication.payloadId === record.slotId
    || !Number.isSafeInteger(publication.generation) || publication.generation < 1
    || !Number.isSafeInteger(publication.byteLength) || publication.byteLength < 1
    || publication.byteLength > MAX_PAYLOAD)) refuse();
}

export function microsoftPayloadName(streamId, attemptId) {
  if (!hex(streamId) || !hex(attemptId)) refuse();
  return `recap-payload-${streamId}-${attemptId}.json`;
}

export function encodeMicrosoftPublication(record) {
  validate(record);
  const publication = record.publication;
  const text = JSON.stringify({
    f: FORMAT, n: record.nonce,
    p: publication === null ? null : {
      a: publication.attemptId, d: publication.digest, g: publication.generation,
      i: publication.payloadId, z: publication.byteLength,
    },
    r: record.slotId, s: record.streamId, v: 1,
  });
  if (Buffer.byteLength(text) > MICROSOFT_PUBLICATION_MAX_BYTES) refuse();
  return text;
}

export function decodeMicrosoftPublication(text, expected) {
  try {
    if (typeof text !== 'string' || Buffer.byteLength(text) > MICROSOFT_PUBLICATION_MAX_BYTES
      || !hex(expected?.streamId) || !identifier(expected?.slotId)) refuse();
    const value = JSON.parse(text);
    if (!exact(value, ['f', 'v', 's', 'r', 'n', 'p']) || value.f !== FORMAT || value.v !== 1
      || value.s !== expected.streamId || value.r !== expected.slotId
      || (value.p !== null && !exact(value.p, ['a', 'g', 'i', 'z', 'd']))) refuse();
    const record = {
      streamId: value.s, slotId: value.r, nonce: value.n,
      publication: value.p === null ? null : {
        attemptId: value.p.a, generation: value.p.g, payloadId: value.p.i,
        byteLength: value.p.z, digest: value.p.d,
      },
    };
    if (encodeMicrosoftPublication(record) !== text) refuse();
    return record;
  } catch {
    throw new CloudMicrosoftPublicationRecordError();
  }
}

export function decodeMicrosoftPublicationDescription(text, expected) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 6 * MICROSOFT_PUBLICATION_MAX_BYTES) refuse();
  // Native qualification returned entity-encoded punctuation in OneDrive Personal descriptions.
  const canonical = text.replace(/&quot;|&#([0-9]{1,3});/g, (entity, digits) => {
    if (entity === '&quot;') return '"';
    const code = Number(digits);
    if (code < 32 || code > 126) refuse();
    return String.fromCharCode(code);
  });
  return decodeMicrosoftPublication(canonical, expected);
}

export function requireMicrosoftPublicationSnapshot(record, snapshot, bytes) {
  validate(record);
  const publication = record.publication;
  if (!publication || !snapshot || snapshot.version !== 1
    || snapshot.streamId !== record.streamId || snapshot.slotId !== record.slotId
    || snapshot.attemptId !== publication.attemptId || snapshot.generation !== publication.generation
    || !Buffer.isBuffer(bytes) || bytes.length !== publication.byteLength
    || createHash('sha256').update(bytes).digest('hex') !== publication.digest) refuse();
}
