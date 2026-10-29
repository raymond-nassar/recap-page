// The cloud client configuration: the provider registrations a build may sign in with (#810). A build
// without one has cloud backup off. Release builds get one injected by the packagers from a protected
// secret, and nothing in the repository is ever one (owner, 2026-10-28, OD-06).
//
// The identifiers in it are not secrets in the cryptographic sense, since every installed copy carries
// them. They are kept out of the repository and its history all the same, because that is the owner's
// decision, and because a Microsoft client identifier is a GUID, which the publication gate reports.

export const CLOUD_CLIENT_FORMAT = 'recap-page-cloud-client';
export const CLOUD_CLIENT_VERSION = 1;
export const CLOUD_CLIENT_FILENAME = 'cloud-client.json';
// Read only by a development checkout. A packaged build ignores it, and the MSIX launcher leaves it out of
// what it hands the server, because a variable must never choose which registration signs in.
export const CLOUD_CLIENT_ENV = 'MRT_CLOUD_CLIENT_CONFIG';
export const MAX_CLOUD_CLIENT_BYTES = 4096;
// Microsoft identifiers are GUIDs. Anything of this shape is accepted, so that test fixtures can use
// placeholders the publication gate does not mistake for one.
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class CloudConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CloudConfigError';
    this.code = 'invalid-config';
  }
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactFields(value, fields) {
  return object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
}

// The whole file is checked and nothing unknown is kept, so a configuration can only ever say what this
// version understands. OneDrive is the one provider P02 adds; Google Drive joins in a later version.
export function parseCloudClient(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_CLOUD_CLIENT_BYTES) {
    throw new CloudConfigError('The cloud client configuration is missing or too large.');
  }
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new CloudConfigError('The cloud client configuration is not readable JSON.'); }
  if (!exactFields(value, ['format', 'version', 'providers']) || value.format !== CLOUD_CLIENT_FORMAT
    || value.version !== CLOUD_CLIENT_VERSION || !exactFields(value.providers, ['onedrive'])) {
    throw new CloudConfigError('The cloud client configuration is not one this version understands.');
  }
  const onedrive = value.providers.onedrive;
  if (!exactFields(onedrive, ['clientId', 'authority']) || onedrive.authority !== 'consumers'
    || typeof onedrive.clientId !== 'string' || !CLIENT_ID.test(onedrive.clientId)) {
    throw new CloudConfigError('The OneDrive registration in the cloud client configuration is not usable.');
  }
  return Object.freeze({
    format: CLOUD_CLIENT_FORMAT, version: CLOUD_CLIENT_VERSION,
    providers: Object.freeze({ onedrive: Object.freeze({ clientId: onedrive.clientId, authority: 'consumers' }) }),
  });
}
