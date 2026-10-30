// Reads the cloud client configuration for an Android build (#810, P03). Gradle runs this once, when a build
// is given one, and adds the sign-in redirect only to the build types it names a redirect for. The
// configuration is the same file the Windows packagers take, checked by the same parser, so the two can never
// disagree on what a usable one is. Neither the file nor a release signature hash is ever committed; both are
// handed to the build that needs them (owner, OD-06).
//
//   node scripts/android-cloud-client.mjs <config path> [debug=<hash>] [release=<hash>]
//
// Prints {"clientId": ..., "redirectHashes": {"debug": ..., "release": ...}} with only the build types given.
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MAX_CLOUD_CLIENT_BYTES, parseCloudClient } from '../host/cloudConfig.mjs';

// The base64 SHA-1 of a signing certificate, as Microsoft's registration page takes it: 28 characters.
export const REDIRECT_HASH = /^[A-Za-z0-9+/]{27}=$/;
const BUILD_TYPES = new Set(['debug', 'release']);

export function androidCloudClient(path, assignments) {
  if (typeof path !== 'string' || path === '') throw new Error('A cloud client configuration path is required.');
  if (!statSync(path).isFile() || statSync(path).size > MAX_CLOUD_CLIENT_BYTES) {
    throw new Error('The cloud client configuration is missing or too large.');
  }
  const client = parseCloudClient(readFileSync(path, 'utf8'));
  const redirectHashes = {};
  for (const assignment of assignments) {
    const match = /^([a-z]+)(-file)?=(.*)$/s.exec(assignment);
    if (!match || !BUILD_TYPES.has(match[1]) || match[1] in redirectHashes) {
      throw new Error('Each redirect is given once, as debug=<hash> or release=<hash>.');
    }
    if (match[2] && (!statSync(match[3]).isFile() || statSync(match[3]).size !== 28)) {
      throw new Error(`The ${match[1]} redirect hash is not a signature hash.`);
    }
    const value = match[2] ? readFileSync(match[3], 'utf8') : match[3];
    if (!REDIRECT_HASH.test(value)) throw new Error(`The ${match[1]} redirect hash is not a signature hash.`);
    redirectHashes[match[1]] = value;
  }
  if (Object.keys(redirectHashes).length === 0) throw new Error('A cloud client configuration needs a redirect hash for at least one build type.');
  return { clientId: client.providers.onedrive.clientId, redirectHashes };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const [path, ...assignments] = process.argv.slice(2);
    process.stdout.write(`${JSON.stringify(androidCloudClient(path, assignments))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
