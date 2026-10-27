import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { CloudProviderTransportError, isCloudMatchTag } from './cloudProviderTransport.mjs';

const HEX = /^[a-f0-9]{64}$/;
const SLOT = /^[A-Za-z0-9!_.:-]{1,256}$/;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_METADATA = 1024 * 1024;

export class CloudMicrosoftTerminalError extends Error {
  constructor(message = 'Microsoft upload outcome is not conditionally fenced. The stream remains paused.') {
    super(message);
    this.name = 'CloudMicrosoftTerminalError';
  }
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function hex(value) { return typeof value === 'string' && HEX.test(value); }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }
function refuse() { throw new CloudMicrosoftTerminalError(); }

// Only conditioned item-ID writes qualify. Older upload sessions cannot adopt this fence.
export function createMicrosoftCloudTerminalVerifier({
  profileId, accountId, streamId, fixedSlots, request, readConditionalFile, isCurrent,
}) {
  if (!hex(profileId) || !hex(streamId) || typeof accountId !== 'string' || !accountId
    || Buffer.byteLength(accountId) > 1024 || !Array.isArray(fixedSlots) || fixedSlots.length !== 2
    || !fixedSlots.every((slot) => typeof slot === 'string' && SLOT.test(slot) && !['.', '..'].includes(slot))
    || fixedSlots[0] === fixedSlots[1] || typeof request !== 'function'
    || typeof readConditionalFile !== 'function' || typeof isCurrent !== 'function') {
    throw new TypeError('Microsoft terminal verification requires an exact native destination and conditional file reader.');
  }
  const slots = fixedSlots.slice();
  const account = hash(accountId);
  function current() {
    if (isCurrent() !== true) throw new CloudMicrosoftTerminalError('The cloud connection changed. Its old stream remains fenced.');
  }
  async function selected(id) {
    current();
    const result = await readConditionalFile({ id });
    current();
    if (result?.file?.id !== id || !Number.isSafeInteger(result.file.size) || result.file.size < 0
      || result.file.size > MAX_BYTES || !Buffer.isBuffer(result.bytes) || result.bytes.length !== result.file.size
      || !isCloudMatchTag(result.condition)) refuse();
    return result;
  }
  return async function verifyTerminal({ binding, slotId, attempt } = {}) {
    try {
      current();
      if (!binding || binding.provider !== 'microsoft' || binding.profileId !== profileId
        || binding.account !== account || binding.streamId !== streamId || !attempt
        || !hex(attempt.id) || !hex(attempt.digest) || !positive(attempt.generation) || !positive(attempt.epoch)
        || ![0, 1].includes(attempt.slot) || slotId !== slots[attempt.slot]
        || !['in-flight', 'unknown'].includes(attempt.phase) || attempt.session !== null
        || !isCloudMatchTag(attempt.condition)) refuse();
      let observed = await selected(slotId);
      let uncertain;
      if (observed.condition === attempt.condition) {
        current();
        try {
          const response = await request({
            target: `/v1.0/me/drive/items/${encodeURIComponent(slotId)}?$select=id,eTag`,
            method: 'PATCH', ifMatch: attempt.condition,
            body: JSON.stringify({ description: `Recap backup conditional fence ${attempt.id}` }),
            maxBytes: MAX_METADATA,
          });
          current();
          if (response.status !== 200 || !Buffer.isBuffer(response.bytes) || response.bytes.length > MAX_METADATA) refuse();
          const changed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
          if (changed.id !== slotId || !isCloudMatchTag(changed.eTag) || changed.eTag === attempt.condition) refuse();
        } catch (error) {
          if (!(error instanceof CloudProviderTransportError)) throw error;
          uncertain = error;
        }
        observed = await selected(slotId);
      }
      current();
      if (observed.condition === attempt.condition) {
        if (uncertain) throw uncertain;
        refuse();
      }
      const completed = hash(observed.bytes) === attempt.digest;
      return {
        result: completed ? 'completed' : 'failed',
        attemptId: attempt.id, generation: attempt.generation, digest: attempt.digest, slotId,
        noOutstandingMutation: true, ...(completed ? { exactReadback: true } : {}),
      };
    } catch (error) {
      if (error instanceof CloudMicrosoftTerminalError || error instanceof CloudProviderTransportError) throw error;
      throw new CloudMicrosoftTerminalError();
    }
  };
}
