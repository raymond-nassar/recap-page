import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

export const MANIFEST_PATH = fileURLToPath(new URL('./prototype.json', import.meta.url));
export const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

export function isLocalOriginUrl(value) {
  if (typeof value !== 'string') return false;
  const authority = value.match(/^https:\/\/([^/?#]*)/i)?.[1];
  if (!authority || authority.includes('@') || authority.includes(':') || authority.includes('\\')) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:'
    && url.origin === manifest.origin
    && !url.username
    && !url.password;
}

export function isApprovedReaderUrl(value) {
  if (typeof value !== 'string') return false;
  const authority = value.match(/^https:\/\/([^/?#]*)/i)?.[1];
  if (!authority || authority.includes('@') || authority.includes(':') || authority.includes('\\')) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:'
    && manifest.readerHosts.includes(url.hostname.toLowerCase())
    && url.port === ''
    && !url.username
    && !url.password;
}

export function relativeAssetPath(value) {
  if (!isLocalOriginUrl(value)) return null;
  const suffix = value.slice(manifest.origin.length);
  const rawPath = (suffix.split(/[?#]/, 1)[0] || '/');
  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes(':')) return null;
  const segments = pathname.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;
  const path = segments.filter(Boolean).join('/');
  if (!path) return 'index.html';
  return pathname.endsWith('/') ? `${path}/index.html` : path;
}
