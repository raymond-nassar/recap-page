import { inflateRawSync } from 'node:zlib';
import { sha256 } from './store-readback.mjs';

const MAX_BYTES = 256 * 1024 * 1024;
const TIMEOUT_MS = 60000;

function demand(condition) {
  if (!condition) throw new Error('Upload proof contract failed');
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

export function readSingleBundle(zip, bundleName) {
  demand(Buffer.isBuffer(zip) && zip.length >= 22 && zip.length <= MAX_BYTES);
  const end = zip.length - 22;
  // Compress-Archive emits a single-file, non-ZIP64 archive with no archive comment.
  demand(zip.readUInt32LE(end) === 0x06054b50 && zip.readUInt16LE(end + 4) === 0
    && zip.readUInt16LE(end + 6) === 0 && zip.readUInt16LE(end + 8) === 1
    && zip.readUInt16LE(end + 10) === 1 && zip.readUInt16LE(end + 20) === 0);
  const central = zip.readUInt32LE(end + 16);
  demand(central + zip.readUInt32LE(end + 12) === end && central + 46 <= end
    && zip.readUInt32LE(central) === 0x02014b50);
  const flags = zip.readUInt16LE(central + 8);
  const method = zip.readUInt16LE(central + 10);
  const compressedSize = zip.readUInt32LE(central + 20);
  const size = zip.readUInt32LE(central + 24);
  const nameSize = zip.readUInt16LE(central + 28);
  const extraSize = zip.readUInt16LE(central + 30);
  const commentSize = zip.readUInt16LE(central + 32);
  demand((flags & ~0x808) === 0 && [0, 8].includes(method) && size > 0 && size <= MAX_BYTES
    && compressedSize > 0 && zip.readUInt16LE(central + 34) === 0
    && zip.readUInt32LE(central + 42) === 0 && central + 46 + nameSize + extraSize + commentSize === end);
  const name = Buffer.from(bundleName, 'utf8');
  demand(nameSize === name.length && zip.subarray(central + 46, central + 46 + nameSize).equals(name));
  demand(central >= 30 && zip.readUInt32LE(0) === 0x04034b50
    && zip.readUInt16LE(6) === flags && zip.readUInt16LE(8) === method && zip.readUInt16LE(26) === name.length);
  const start = 30 + name.length + zip.readUInt16LE(28);
  demand(start <= central && zip.subarray(30, 30 + name.length).equals(name));
  const dataEnd = start + compressedSize;
  const crc = zip.readUInt32LE(central + 16);
  if ((flags & 8) !== 0) {
    const signed = dataEnd + 16 === central && zip.readUInt32LE(dataEnd) === 0x08074b50;
    const descriptor = dataEnd + (signed ? 4 : 0);
    demand(descriptor + 12 === central && zip.readUInt32LE(descriptor) === crc
      && zip.readUInt32LE(descriptor + 4) === compressedSize && zip.readUInt32LE(descriptor + 8) === size);
  } else {
    demand(dataEnd === central && zip.readUInt32LE(14) === crc
      && zip.readUInt32LE(18) === compressedSize && zip.readUInt32LE(22) === size);
  }
  const compressed = zip.subarray(start, dataEnd);
  const bundle = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: MAX_BYTES });
  demand(bundle.length === size && crc32(bundle) === crc);
  return { sha256: sha256(bundle), size };
}

export async function observeUploadedBundle(value, bundleName, expectedHash, {
  fetchImpl = globalThis.fetch, now = Date.now, maxBytes = MAX_BYTES,
} = {}) {
  const result = { state: 'unavailable', originalUploadZipSha256: 'UNRECORDED', checks: [], httpStatus: null };
  let stage = 'UPLOAD_READ_URL';
  const pass = () => result.checks.push({ checkId: stage, result: 'pass', code: 'OK' });
  try {
    const url = new URL(value);
    demand(url.protocol === 'https:' && /^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(url.hostname)
      && !url.username && !url.password && !url.port && !url.hash && /^\/ingestion\/[^/]+$/.test(url.pathname)
      && url.searchParams.getAll('sig').length === 1 && Boolean(url.searchParams.get('sig'))
      && url.searchParams.getAll('se').length === 1 && Date.parse(url.searchParams.get('se')) > now()
      && Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_BYTES);
    pass();
    stage = 'UPLOAD_READ_HTTP';
    const response = await fetchImpl(url.href, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) {
      result.httpStatus = response.status;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      demand(false);
    }
    pass();
    stage = 'UPLOAD_READ_BOUNDS';
    const chunks = [];
    let bytes = 0;
    demand(response.body);
    const reader = response.body.getReader();
    try {
      const length = response.headers.get('content-length');
      demand(length === null || (/^\d+$/.test(length) && Number(length) <= maxBytes));
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        bytes += chunk.byteLength;
        demand(bytes <= maxBytes);
        chunks.push(Buffer.from(chunk));
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    pass();
    const zip = Buffer.concat(chunks, bytes);
    result.currentZipSha256 = sha256(zip);
    result.currentZipSize = bytes;
    stage = 'UPLOAD_READ_SINGLE_BUNDLE';
    const bundle = readSingleBundle(zip, bundleName);
    pass();
    result.bundleSha256 = bundle.sha256;
    result.bundleSize = bundle.size;
    result.bundleMatches = bundle.sha256 === expectedHash;
    stage = 'UPLOAD_READ_BUNDLE_HASH';
    demand(result.bundleMatches);
    pass();
    result.state = 'verified';
  } catch {
    result.checks.push({ checkId: stage, result: 'fail', code: stage });
  }
  return result;
}
