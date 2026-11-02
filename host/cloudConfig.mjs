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

// The secret Google issues a Desktop client, which its guide says an installed app cannot keep
// confidential. Anything of this shape is accepted, so fixtures can use placeholders.
const CLIENT_SECRET = /^[A-Za-z0-9_-]{8,128}$/;
const ANDROID_BUILD_TYPES = ['debug', 'release'];

// Google Drive, which is optional (#810, P04): a Desktop client for the Windows host, with its secret, and
// an Android client for each build type that signs in, since Google ties an Android client to one signing
// certificate. Either half may be absent, and a build without the half for its platform has no Google Drive.
function parseGoogleDrive(value) {
  const unusable = () => new CloudConfigError('The Google Drive registration in the cloud client configuration is not usable.');
  const keys = object(value) ? Object.keys(value) : [];
  if (keys.length === 0 || !keys.every((key) => key === 'windows' || key === 'android')) throw unusable();
  const result = {};
  if ('windows' in value) {
    const windows = value.windows;
    if (!exactFields(windows, ['clientId', 'clientSecret']) || typeof windows.clientId !== 'string' || !CLIENT_ID.test(windows.clientId)
      || typeof windows.clientSecret !== 'string' || !CLIENT_SECRET.test(windows.clientSecret)) throw unusable();
    result.windows = Object.freeze({ clientId: windows.clientId, clientSecret: windows.clientSecret });
  }
  if ('android' in value) {
    const android = value.android;
    const types = object(android) ? Object.keys(android) : [];
    if (types.length === 0 || !types.every((type) => ANDROID_BUILD_TYPES.includes(type))
      || !types.every((type) => typeof android[type] === 'string' && CLIENT_ID.test(android[type]))) throw unusable();
    result.android = Object.freeze(Object.fromEntries(types.sort().map((type) => [type, android[type]])));
  }
  return Object.freeze(result);
}

// The whole file is checked and nothing unknown is kept, so a configuration can only ever say what this
// version understands. OneDrive is required; Google Drive is optional (P04).
export function parseCloudClient(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_CLOUD_CLIENT_BYTES) {
    throw new CloudConfigError('The cloud client configuration is missing or too large.');
  }
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new CloudConfigError('The cloud client configuration is not readable JSON.'); }
  if (!exactFields(value, ['format', 'version', 'providers']) || value.format !== CLOUD_CLIENT_FORMAT
    || value.version !== CLOUD_CLIENT_VERSION
    || !(exactFields(value.providers, ['onedrive']) || exactFields(value.providers, ['onedrive', 'googledrive']))) {
    throw new CloudConfigError('The cloud client configuration is not one this version understands.');
  }
  const onedrive = value.providers.onedrive;
  if (!exactFields(onedrive, ['clientId', 'authority']) || onedrive.authority !== 'consumers'
    || typeof onedrive.clientId !== 'string' || !CLIENT_ID.test(onedrive.clientId)) {
    throw new CloudConfigError('The OneDrive registration in the cloud client configuration is not usable.');
  }
  const providers = { onedrive: Object.freeze({ clientId: onedrive.clientId, authority: 'consumers' }) };
  if ('googledrive' in value.providers) providers.googledrive = parseGoogleDrive(value.providers.googledrive);
  return Object.freeze({ format: CLOUD_CLIENT_FORMAT, version: CLOUD_CLIENT_VERSION, providers: Object.freeze(providers) });
}
