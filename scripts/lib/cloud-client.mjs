// The cloud backup client configuration a release carries (#810, P02-T01 section 3.2, OD-06). It is put in
// when a release build is made, from a protected secret, and never committed. A packager takes it only as
// --cloud-client=<absolute path outside this repository>, never from the environment, so nothing on the
// building machine can slip a configuration into a build that was not asked for one. It is checked as
// the host will check it, copied byte for byte beside the server, and the build identity records its
// SHA-256, never its contents.

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { CLOUD_CLIENT_FILENAME, parseCloudClient } from '../../host/cloudConfig.mjs';
import { ROOT } from './release-identity.mjs';

export const CLOUD_CLIENT_ARGUMENT = '--cloud-client=';

export function verifyCloudClientDigest(identity, bytes) {
  const digest = bytes === null ? null : createHash('sha256').update(bytes).digest('hex');
  if (bytes !== null) parseCloudClient(bytes.toString('utf8'));
  if (identity.cloudClient !== digest) throw new Error('cloud client: packaged configuration differs from its build identity');
  return digest;
}

// null when no configuration was asked for, which is every build until cloud backup is turned on.
export function cloudClientInjection(argv = process.argv.slice(2), root = ROOT) {
  const given = argv.filter((arg) => arg.startsWith(CLOUD_CLIENT_ARGUMENT));
  if (given.length === 0) return null;
  if (given.length > 1) throw new Error('cloud client: give --cloud-client once at most');
  const path = given[0].slice(CLOUD_CLIENT_ARGUMENT.length);
  if (!isAbsolute(path)) throw new Error('cloud client: the configuration path must be absolute');
  // Compared as real paths, so a link outside the repository naming a file inside it is inside, and by
  // whole segments, so a file at the root whose name begins with two dots is inside too (stage 2 review,
  // L4). A path that does not exist throws here, as reading it would.
  const within = relative(realpathSync(resolve(root)), realpathSync(path));
  const outside = within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within);
  if (within === '' || !outside) {
    throw new Error('cloud client: the configuration must stay outside this repository, so it is never committed');
  }
  const bytes = readFileSync(path);
  parseCloudClient(bytes.toString('utf8'));
  return { name: CLOUD_CLIENT_FILENAME, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
