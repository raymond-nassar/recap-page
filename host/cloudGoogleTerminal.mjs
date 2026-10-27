import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { CloudProviderTransportError, validateCloudUploadSession } from './cloudProviderTransport.mjs';

const HEX = /^[a-f0-9]{64}$/;
const SLOT = /^[A-Za-z0-9!_.:-]{1,256}$/;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_METADATA = 1024 * 1024;

export class CloudGoogleTerminalError extends Error {
  constructor(message = 'Google upload completion could not be verified. The stream remains fenced.') {
    super(message);
    this.name = 'CloudGoogleTerminalError';
  }
}

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function hex(value) { return typeof value === 'string' && HEX.test(value); }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }
function refuse() { throw new CloudGoogleTerminalError(); }

// Completion comes from the protected attempt's session, not a caller-supplied HTTP receipt.
export function createGoogleCloudTerminalVerifier({
  profileId, accountId, streamId, fixedSlots, sessions, request, readFile, isCurrent,
}) {
  if (!hex(profileId) || !hex(streamId) || typeof accountId !== 'string' || !accountId
    || Buffer.byteLength(accountId) > 1024 || !Array.isArray(fixedSlots) || fixedSlots.length !== 2
    || !fixedSlots.every((slot) => typeof slot === 'string' && SLOT.test(slot))
    || fixedSlots[0] === fixedSlots[1] || typeof sessions?.load !== 'function'
    || typeof request !== 'function' || typeof readFile !== 'function' || typeof isCurrent !== 'function') {
    throw new TypeError('Google terminal verification requires an exact native destination and protected session store.');
  }
  const slots = fixedSlots.slice();
  const account = hash(accountId);
  function current() {
    if (isCurrent() !== true) {
      throw new CloudGoogleTerminalError('The cloud connection changed. The stream remains fenced.');
    }
  }
  return async function verifyTerminal({ binding, slotId, attempt, evidence } = {}) {
    try {
      current();
      const byteLength = attempt?.byteLength ?? evidence?.byteLength;
      if (!binding || binding.provider !== 'google' || binding.profileId !== profileId
        || binding.account !== account || binding.streamId !== streamId || !attempt
        || !hex(attempt.id) || !hex(attempt.digest) || !hex(attempt.session)
        || !positive(attempt.generation) || !positive(attempt.epoch)
        || ![0, 1].includes(attempt.slot) || slotId !== slots[attempt.slot]
        || !['in-flight', 'unknown'].includes(attempt.phase)
        || !positive(byteLength) || byteLength > MAX_BYTES
        || (attempt.byteLength !== undefined && evidence?.byteLength !== undefined && evidence.byteLength !== attempt.byteLength)) refuse();
      const target = validateCloudUploadSession('google', await sessions.load({
        binding: { profileId, provider: 'google', accountId, streamId,
          attemptId: attempt.id, epoch: attempt.epoch, slotId },
        reference: attempt.session,
      }));
      current();
      const response = await request({
        kind: 'session', target, method: 'PUT', contentRange: `bytes */${byteLength}`, maxBytes: MAX_METADATA,
      });
      current();
      if (response.status === 308) {
        throw new CloudGoogleTerminalError('Google reports an incomplete upload. The stream remains fenced.');
      }
      if (![200, 201].includes(response.status) || !Buffer.isBuffer(response.bytes)
        || response.bytes.length > MAX_METADATA) refuse();
      const file = JSON.parse(response.bytes.toString('utf8'));
      if (!file || file.id !== slotId || typeof file.size !== 'string' || !/^\d+$/.test(file.size)
        || Number(file.size) !== byteLength) refuse();
      const selected = await readFile({ id: slotId });
      current();
      if (selected?.file?.id !== slotId || selected.file.size !== byteLength
        || !Buffer.isBuffer(selected.bytes) || selected.bytes.length !== byteLength
        || hash(selected.bytes) !== attempt.digest) refuse();
      return {
        result: 'completed', attemptId: attempt.id, generation: attempt.generation,
        digest: attempt.digest, slotId, noOutstandingMutation: true, exactReadback: true,
      };
    } catch (error) {
      if (error instanceof CloudGoogleTerminalError || error instanceof CloudProviderTransportError) throw error;
      throw new CloudGoogleTerminalError();
    }
  };
}
