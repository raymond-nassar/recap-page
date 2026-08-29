#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKET = join(ROOT, 'docs', 'MICROSOFT_STORE_SUBMISSION.md');
export const ASSET_DIR = join(ROOT, 'docs', 'store-assets');
export const SCREENSHOTS = Object.freeze([
  '01-home-discovery.png',
  '02-browse-reading-lists.png',
  '03-reading-paths.png',
  '04-reading-progress.png',
  '05-about-privacy.png',
]);
export const STORE_TILE = 'store-tile-300.png';
export const PUBLIC_URLS = Object.freeze([
  'https://github.com/raymond-nassar/recap-page/blob/main/PRIVACY.md',
  'https://github.com/raymond-nassar/recap-page/blob/main/SUPPORT.md',
  'https://github.com/raymond-nassar/recap-page',
]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

export function pngInfo(file) {
  const bytes = readFileSync(file);
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${file} is not a PNG`);
  const chunks = [];
  let at = 8;
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('ascii', at + 4, at + 8);
    chunks.push(type);
    at += length + 12;
  }
  if (at !== bytes.length) throw new Error(`${file} has a malformed PNG chunk boundary`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bytes: bytes.length,
    chunks,
  };
}

function requireText(text, wanted, findings) {
  const normalized = (value) => value.replace(/\s+/g, ' ').trim();
  if (!text.includes(wanted) && !normalized(text).includes(normalized(wanted))) {
    findings.push(`submission packet is missing: ${wanted}`);
  }
}

export function validateSubmission() {
  const findings = [];
  if (!existsSync(PACKET)) return [`missing ${PACKET}`];
  if (!existsSync(ASSET_DIR)) return [`missing ${ASSET_DIR}`];

  const packet = readFileSync(PACKET, 'utf8');
  for (const heading of [
    '## Owner review card',
    '## Pricing, availability, and properties',
    '## English (United States) Store listing',
    '### Keywords',
    '## Age-rating answer draft',
    '## Restricted capability justification',
    '## Notes for certification',
    '## Listing assets',
    '## Final upload handoff',
    '## Owner-only stop points',
    '## Official sources',
  ]) requireText(packet, heading, findings);

  for (const value of [
    'PanelStackLabs.RecapPage',
    'CN=F6D9045B-46F0-4EAC-9524-4BFC8A75A472',
    'PanelStackLabs.RecapPage_we33aa8nvkpcc',
    'Books + reference',
    'United States only',
    'Public audience',
    'available and discoverable',
    "Don't publish this submission until I select Publish now",
    'English (United States)',
    '2.0.0.0',
    '127.0.0.1:8787',
    'runFullTrust',
    '`PASS` categories',
    'Blocked executables',
    'DPIAwarenessValidation',
    'Partner Center certification remains authoritative',
    'This is an unofficial fan companion',
    'Recap Page contains no comic pages',
    'Reading requires your own Marvel Unlimited subscription',
    'Comic Book Herald',
    'Comic Book Reading Orders',
    'There is no account, advertising, analytics, or telemetry',
    'Leave **Additional license terms** blank',
    'add-additional-information',
    'Do not upload',
    'Do not submit for certification',
    'Do not publish',
  ]) requireText(packet, value, findings);

  for (const url of PUBLIC_URLS) requireText(packet, url, findings);
  if (/[\u2013\u2014]/u.test(packet)) findings.push('submission packet contains an en dash or em dash');
  if (/[A-Za-z]:[\\/]+Users[\\/]+/u.test(packet)) findings.push('submission packet contains a private user-profile path');
  const withoutPublisher = packet.replaceAll('F6D9045B-46F0-4EAC-9524-4BFC8A75A472', '');
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu.test(withoutPublisher)) {
    findings.push('submission packet contains a session-shaped identifier');
  }

  const files = readdirSync(ASSET_DIR).filter((file) => file.endsWith('.png')).sort();
  const expected = [...SCREENSHOTS, STORE_TILE].sort();
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    findings.push(`Store asset inventory is ${JSON.stringify(files)}, expected ${JSON.stringify(expected)}`);
  }

  for (const file of SCREENSHOTS) {
    const path = join(ASSET_DIR, file);
    if (!existsSync(path)) {
      findings.push(`missing screenshot ${file}`);
      continue;
    }
    const info = pngInfo(path);
    if (info.width !== 1920 || info.height !== 1080) {
      findings.push(`${file} is ${info.width}x${info.height}, expected 1920x1080`);
    }
    if (info.bytes > MAX_IMAGE_BYTES) findings.push(`${file} exceeds 50 MB`);
    if (info.chunks.some((type) => !['IHDR', 'IDAT', 'IEND'].includes(type))) {
      findings.push(`${file} contains metadata-bearing PNG chunks: ${info.chunks.join(', ')}`);
    }
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
    requireText(packet, `| \`${file}\` | 1920 x 1080 | ${info.bytes} | \`${hash}\` |`, findings);
  }

  const tile = join(ASSET_DIR, STORE_TILE);
  if (!existsSync(tile)) {
    findings.push(`missing Store tile ${STORE_TILE}`);
  } else {
    const info = pngInfo(tile);
    if (info.width !== 300 || info.height !== 300) {
      findings.push(`${STORE_TILE} is ${info.width}x${info.height}, expected 300x300`);
    }
    if (info.bytes > MAX_IMAGE_BYTES) findings.push(`${STORE_TILE} exceeds 50 MB`);
    if (info.chunks.some((type) => !['IHDR', 'IDAT', 'IEND'].includes(type))) {
      findings.push(`${STORE_TILE} contains metadata-bearing PNG chunks: ${info.chunks.join(', ')}`);
    }
    const hash = createHash('sha256').update(readFileSync(tile)).digest('hex').toUpperCase();
    requireText(packet, `| \`${STORE_TILE}\` | 300 x 300 | ${info.bytes} | \`${hash}\` |`, findings);
  }
  return findings;
}

function main() {
  const findings = validateSubmission();
  if (findings.length) {
    for (const finding of findings) console.error(`FAIL ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Store submission packet: ready (${SCREENSHOTS.length} screenshots, 1 tile)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
