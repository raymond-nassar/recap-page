import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { URL, URLSearchParams } from 'node:url';
import { CloudProviderTransportError, isCloudMatchTag, validateCloudDownloadHandoff } from './cloudProviderTransport.mjs';

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_LIST_BYTES = 8 * MAX_METADATA_BYTES;
const MAX_PAGES = 20;
const MAX_ENTRIES = 2000;
const GOOGLE_FIELDS = 'id,name,size,mimeType,spaces,trashed,modifiedTime';
const MICROSOFT_FIELDS = 'id,name,size,file,folder,package,remoteItem,deleted,parentReference,lastModifiedDateTime,eTag';

export class CloudProviderReadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CloudProviderReadError';
  }
}

function refuse(message = 'Cloud file metadata or content is incomplete or unsupported. No backup was selected or changed.') {
  return new CloudProviderReadError(message);
}

function identifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9!_.:-]{1,256}$/.test(value) && !['.', '..'].includes(value);
}

function metadata(response) {
  if (response.status !== 200 || !Buffer.isBuffer(response.bytes)
    || response.bytes.length > MAX_METADATA_BYTES) throw refuse();
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw refuse();
  return value;
}

function descriptor(provider, file, root) {
  if (!file || !identifier(file.id) || typeof file.name !== 'string' || !file.name
    || Buffer.byteLength(file.name) > 1024) throw refuse();
  if (provider === 'google') {
    if (!Array.isArray(file.spaces) || !file.spaces.includes('appDataFolder')
      || file.trashed !== false || typeof file.mimeType !== 'string') throw refuse();
  } else if (!file.parentReference || file.parentReference.id !== root.id
    || file.parentReference.driveId !== root.driveId || file.remoteItem || file.deleted || file.package) throw refuse();
  if (provider === 'microsoft' && file.folder !== undefined && file.folder !== null
    && (typeof file.folder !== 'object' || Array.isArray(file.folder))) throw refuse();
  const folder = provider === 'google' ? file.mimeType === 'application/vnd.google-apps.folder' : Boolean(file.folder);
  if (folder) return null;
  if (provider === 'microsoft' && (!file.file || typeof file.file !== 'object' || Array.isArray(file.file))) throw refuse();
  const mimeType = provider === 'google' ? file.mimeType : file.file.mimeType;
  if (typeof mimeType !== 'string') throw refuse();
  if (mimeType !== 'application/json') return null;
  if (provider === 'google' && (typeof file.size !== 'string' || !/^(?:0|[1-9]\d*)$/.test(file.size))) throw refuse();
  const size = provider === 'google' ? Number(file.size) : file.size;
  const modifiedAt = (provider === 'google' ? file.modifiedTime : file.lastModifiedDateTime) ?? null;
  if (!Number.isSafeInteger(size) || size < 0
    || (modifiedAt !== null && (typeof modifiedAt !== 'string' || modifiedAt.length > 64
      || !Number.isFinite(Date.parse(modifiedAt))))) throw refuse();
  return { id: file.id, name: file.name, size, modifiedAt };
}

function nextMicrosoftPage(value, path) {
  if (typeof value !== 'string' || value.length > 16384 || /[\s\\#]/.test(value)) throw refuse();
  const url = new URL(value);
  if (url.origin !== 'https://graph.microsoft.com' || url.username || url.password || url.port
    || url.pathname !== path) throw refuse();
  const keys = new Set();
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (!['$select', '$top', '$skiptoken'].includes(normalized) || keys.has(normalized)) throw refuse();
    keys.add(normalized);
  }
  if (!keys.has('$skiptoken') || ![...url.searchParams].some(([key, value]) =>
    key.toLowerCase() === '$skiptoken' && value.length > 0)) throw refuse();
  return url.pathname + url.search;
}

// File candidates are not validated snapshots or evidence that an upload is terminal.
export function createCloudProviderReads({ provider, request, isCurrent, appRootId, driveId }) {
  if (!['google', 'microsoft'].includes(provider) || typeof request !== 'function' || typeof isCurrent !== 'function'
    || (appRootId !== undefined && (provider === 'google' ? appRootId !== 'appDataFolder' || driveId !== null
      : !identifier(appRootId) || !identifier(driveId))) || (appRootId === undefined && driveId !== undefined)) {
    throw new TypeError('Cloud file reads require a host-owned provider transport and current connection binding.');
  }
  function current() {
    if (isCurrent() !== true) throw refuse('This cloud connection changed. Discard its file results and reconnect.');
  }
  async function call(options) {
    current();
    const result = await request(options);
    current();
    return result;
  }
  async function guarded(operation) {
    try {
      current();
      const result = await operation();
      current();
      return result;
    } catch (error) {
      if (error instanceof CloudProviderReadError || error instanceof CloudProviderTransportError) throw error;
      throw refuse();
    }
  }
  async function appRoot() {
    if (provider === 'google') return null;
    const owned = appRootId !== undefined;
    const root = metadata(await call({
      target: owned ? `/v1.0/me/drive/items/${encodeURIComponent(appRootId)}?$select=id,folder,parentReference,specialFolder`
        : '/v1.0/me/drive/special/approot?$select=id,folder,parentReference', maxBytes: MAX_METADATA_BYTES,
    }));
    if (!identifier(root.id) || !root.folder || typeof root.folder !== 'object' || Array.isArray(root.folder)
      || !identifier(root.parentReference?.driveId) || (owned && (root.id !== appRootId || root.parentReference.driveId !== driveId
        || typeof root.specialFolder?.name !== 'string' || root.specialFolder.name.toLowerCase() !== 'approot'))) throw refuse();
    return { id: root.id, driveId: root.parentReference.driveId };
  }
  async function fileMetadata(selection, conditional = false, includeDescription = false) {
    const id = selection?.id;
    if (!identifier(id) || (conditional && provider !== 'microsoft')) throw refuse();
    const root = await appRoot();
    const path = provider === 'google' ? `/drive/v3/files/${encodeURIComponent(id)}`
      : `/v1.0/me/drive/items/${encodeURIComponent(id)}`;
    const fields = provider === 'google' ? GOOGLE_FIELDS
      : `${MICROSOFT_FIELDS}${includeDescription ? ',description' : ''}`;
    const info = metadata(await call({
      target: `${path}?${new URLSearchParams(provider === 'google' ? { fields } : { $select: fields })}`,
      maxBytes: MAX_METADATA_BYTES,
    }));
    const file = descriptor(provider, info, root);
    if (!file || file.id !== id || file.size > MAX_FILE_BYTES
      || (conditional && !isCloudMatchTag(info.eTag))) throw refuse();
    if (includeDescription && info.description !== undefined && info.description !== null
      && typeof info.description !== 'string') throw refuse();
    return { file, path, info };
  }
  async function selectedFile(selection, conditional = false) {
    const { file, path, info } = await fileMetadata(selection, conditional);
    let response = await call({
      target: `${path}${provider === 'google' ? '?alt=media' : '/content'}`, maxBytes: Math.max(1, file.size),
    });
    if (provider === 'microsoft' && response.status === 302) {
      const first = response.location;
      response = await call({ kind: 'download', target: first, maxBytes: Math.max(1, file.size) });
      if (response.status === 302) {
        const next = validateCloudDownloadHandoff(first, response.location);
        response = await call({ kind: 'download', target: next, maxBytes: Math.max(1, file.size) });
      }
    }
    if (response.status !== 200 || !Buffer.isBuffer(response.bytes) || response.bytes.length !== file.size) throw refuse();
    const bytes = Buffer.from(response.bytes);
    return { file, bytes, digest: createHash('sha256').update(bytes).digest('hex'),
      ...(conditional ? { condition: info.eTag } : {}) };
  }
  return {
    discoverRoot: () => guarded(async () => {
      const root = await appRoot();
      return root ? { appRootId: root.id, driveId: root.driveId } : { appRootId: 'appDataFolder', driveId: null };
    }),
    listFiles: () => guarded(async () => {
      const root = await appRoot();
      const microsoftPath = root ? `/v1.0/me/drive/items/${encodeURIComponent(root.id)}/children` : null;
      const googleQuery = new URLSearchParams({
        spaces: 'appDataFolder', q: 'trashed = false', pageSize: '100',
        fields: `nextPageToken,incompleteSearch,files(${GOOGLE_FIELDS})`,
      });
      let target = provider === 'google' ? `/drive/v3/files?${googleQuery}`
        : `${microsoftPath}?${new URLSearchParams({ $select: MICROSOFT_FIELDS, $top: '100' })}`;
      const pages = new Set();
      const ids = new Set();
      const files = [];
      let totalBytes = 0;
      for (let index = 0; index < MAX_PAGES; index++) {
        if (pages.has(target)) throw refuse('Cloud discovery repeated a page. No partial file list was accepted.');
        pages.add(target);
        const response = await call({ target, maxBytes: MAX_METADATA_BYTES });
        const page = metadata(response);
        totalBytes += response.bytes.length;
        const entries = provider === 'google' ? page.files : page.value;
        if (!Array.isArray(entries) || totalBytes > MAX_LIST_BYTES
          || (provider === 'google' && page.incompleteSearch !== undefined && page.incompleteSearch !== false)) throw refuse();
        for (const file of entries) {
          const candidate = descriptor(provider, file, root);
          if (ids.has(file.id) || ids.size >= MAX_ENTRIES) throw refuse();
          ids.add(file.id);
          if (candidate) files.push(candidate);
        }
        const next = provider === 'google' ? page.nextPageToken : page['@odata.nextLink'];
        if (next === undefined || next === null) return files;
        if (provider === 'google') {
          if (typeof next !== 'string' || !next || Buffer.byteLength(next) > 8192) throw refuse();
          googleQuery.set('pageToken', next);
          target = `/drive/v3/files?${googleQuery}`;
        } else target = nextMicrosoftPage(next, microsoftPath);
      }
      throw refuse('Cloud discovery exceeds its page limit. No partial file list was accepted.');
    }),
    readFile: (selection) => guarded(() => selectedFile(selection)),
    readConditionalFile: (selection) => guarded(() => selectedFile(selection, true)),
    readMetadata: (selection) => guarded(async () => {
      const { file, info } = await fileMetadata(selection, true, true);
      return { file, condition: info.eTag, description: info.description ?? null };
    }),
  };
}
