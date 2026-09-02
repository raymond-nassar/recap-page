// Rewrites APP_VERSION in src/js/lib/version.js to whatever package.json now says.
//
// This runs from npm's `version` lifecycle, which fires after npm has bumped package.json
// and the lock file but before it makes the release commit and tag. That timing is the
// whole point: it means `npm version <level>` produces a single commit in which the
// constant the browser reads and the number npm recorded already agree, so the drift check
// in test/version.test.js is never red on an intermediate commit. Store package versions
// are derived from package.json by the MSIX packer and are not rewritten here.
//
// The constant is hand-written rather than generated at build time because the app has no
// build step, and the browser has to read the version from somewhere. See the "Releasing"
// section of the README for the surrounding process.

import { readFileSync, writeFileSync } from 'node:fs';

const versionFile = new URL('../src/js/lib/version.js', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const source = readFileSync(versionFile, 'utf8');
const pattern = /^(export const APP_VERSION = ')([^']*)(';)$/m;
const found = source.match(pattern);

if (!found) {
  console.error('sync-version: could not find the APP_VERSION line in src/js/lib/version.js.');
  console.error('If that declaration was reformatted, update this script to match.');
  process.exit(1);
}

if (found[2] === pkg.version) {
  console.log(`sync-version: already ${pkg.version}, nothing to do.`);
  process.exit(0);
}

// Preserve the file's line endings rather than writing whatever this platform defaults to.
const updated = source.replace(pattern, `$1${pkg.version}$3`);
writeFileSync(versionFile, updated);
console.log(`sync-version: ${found[2]} -> ${pkg.version}`);
