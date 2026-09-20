import { deflateRawSync } from 'node:zlib';
import { Buffer } from 'node:buffer';

export const bundleName = 'RecapPage_3.1.0.0_x64_arm64.msixbundle';
export const payload = Buffer.from('synthetic qualified bundle');

export function archive({ method = 0, descriptor = false, signed = true, filename = bundleName } = {}) {
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const bytes = Buffer.from(filename);
  const data = method === 8 ? deflateRawSync(payload) : payload;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(descriptor ? 8 : 0, 6);
  local.writeUInt16LE(method, 8);
  if (!descriptor) {
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(payload.length, 22);
  }
  local.writeUInt16LE(bytes.length, 26);
  const footer = Buffer.alloc(descriptor ? signed ? 16 : 12 : 0);
  if (descriptor) {
    if (signed) footer.writeUInt32LE(0x08074b50);
    footer.writeUInt32LE(crc, signed ? 4 : 0);
    footer.writeUInt32LE(data.length, signed ? 8 : 4);
    footer.writeUInt32LE(payload.length, signed ? 12 : 8);
  }
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(descriptor ? 8 : 0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(bytes.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + bytes.length, 12);
  end.writeUInt32LE(local.length + bytes.length + data.length + footer.length, 16);
  return Buffer.concat([local, bytes, data, footer, central, bytes, end]);
}
