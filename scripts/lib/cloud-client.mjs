// The cloud backup client configuration a release carries (#810, P02-T01 section 3.2, OD-06). It is put in
// when a release build is made, from a protected secret, and never committed. A packager takes it only as
// --cloud-client=<absolute path outside this repository>, never from the environment, so nothing on the
// building machine can slip a configuration into a build that was not asked for one. It is checked as
// the host will check it, copied byte for byte beside the server, and the build identity records its
// SHA-256, never its contents.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { CLOUD_CLIENT_FILENAME, parseCloudClient } from '../../host/cloudConfig.mjs';
import { ROOT } from './release-identity.mjs';

export const CLOUD_CLIENT_ARGUMENT = '--cloud-client=';

// null when no configuration was asked for, which is every build until cloud backup is turned on.
export function cloudClientInjection(argv = process.argv.slice(2), root = ROOT) {
  const given = argv.filter((arg) => arg.startsWith(CLOUD_CLIENT_ARGUMENT));
  if (given.length === 0) return null;
  if (given.length > 1) throw new Error('cloud client: give --cloud-client once at most');
  const path = given[0].slice(CLOUD_CLIENT_ARGUMENT.length);
  if (!isAbsolute(path)) throw new Error('cloud client: the configuration path must be absolute');
  const within = relative(resolve(root), resolve(path));
  if (within === '' || (!within.startsWith('..') && !isAbsolute(within))) {
    throw new Error('cloud client: the configuration must stay outside this repository, so it is never committed');
  }
  const bytes = readFileSync(path);
  parseCloudClient(bytes.toString('utf8'));
  return { name: CLOUD_CLIENT_FILENAME, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
