import { approvedText } from '../check-store-release.mjs';
import { StoreTextError } from './store-text.mjs';

export const DESCRIPTION_LIMIT = 4000;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function descriptionsPath(version) {
  if (typeof version !== 'string' || !VERSION.test(version)) {
    throw new StoreTextError('store descriptions: version must be x.y.z');
  }
  return `docs/releases/${version}-store-descriptions.json`;
}

export function approvedDescriptions(bytes, version) {
  const path = descriptionsPath(version);
  let value;
  try {
    value = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes);
  } catch {
    throw new StoreTextError(`store descriptions: ${path} is not valid JSON`);
  }
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'appStore,googlePlay,locale,version') {
      throw new Error('exactly appStore, googlePlay, locale and version are required');
    }
    if (value.version !== version) throw new Error('version must match the release');
    if (value.locale !== 'en-us') throw new Error('locale must be en-us');
    approvedText(value.appStore, DESCRIPTION_LIMIT, 'App Store description');
    approvedText(value.googlePlay, DESCRIPTION_LIMIT, 'Google Play description');
  } catch (error) {
    throw new StoreTextError(`store descriptions: ${path}: ${error.message}`);
  }
  return { ...value, path };
}

export function approvedDescriptionsAt({ revision, version, git }) {
  const path = descriptionsPath(version);
  const found = git('ls-tree', '--name-only', revision, '--', path);
  if (found === '') return null;
  if (found !== path) throw new StoreTextError(`store descriptions: unexpected tree entry for ${path}`);
  return approvedDescriptions(git('show', `${revision}:${path}`), version);
}

export const markdownFence = (value) =>
  '`'.repeat(Math.max(3, ...[...value.matchAll(/`+/g)].map((match) => match[0].length + 1)));
