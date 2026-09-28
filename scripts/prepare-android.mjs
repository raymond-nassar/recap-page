import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSP, DEFAULT_PORT, HOST } from '../server.mjs';
import {
  LOCAL_SERVER_HEADER_NAME,
  LOCAL_SERVER_HEADER_VALUE,
  LOCAL_SERVER_HEALTH_PATH,
} from '../src/js/lib/localServer.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'src');
const WEB = join(ROOT, 'packaging', 'android', 'web');
const MARKER = '.recap-android-assets';
const MARKER_CONTENT = 'Recap Page generated Android assets v1\n';
const EXCLUDED = new Set(['dev-faults.html', 'dev-faults.js', 'dev-faults.css', 'sw.js', 'js/app.js']);
export const ANDROID_ASSET_DIR = join(ROOT, 'packaging', 'android', 'app', 'build', 'generated', 'assets', 'recap');

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

async function filesIn(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Android assets cannot contain a symbolic link: ${entry.name}`);
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await filesIn(join(directory, entry.name), path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unsupported Android asset: ${path}`);
  }
  return result.sort();
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function cleanOwnedOutput(directory) {
  for (let current = directory; ; current = dirname(current)) {
    const info = await lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info?.isSymbolicLink()) throw new Error('Android output cannot traverse symbolic links');
    if (current === dirname(current)) break;
  }
  // Tests may choose an empty directory; never turn an arbitrary nonempty path into a clean target.
  const entries = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (entries.length) {
    const marker = await readFile(join(directory, MARKER), 'utf8').catch(() => '');
    if (marker !== MARKER_CONTENT) throw new Error('Refusing to clean an unowned Android asset directory');
    await rm(directory, { recursive: true });
  }
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, MARKER), MARKER_CONTENT);
}

export async function prepareAndroid(output = ANDROID_ASSET_DIR) {
  const directory = resolve(output);
  for (const protectedPath of [SOURCE, WEB, join(ROOT, 'scripts')]) {
    if (inside(directory, protectedPath) || inside(protectedPath, directory)) {
      throw new Error('Android output must not overlap maintained source files');
    }
  }
  if (inside(directory, ROOT)) throw new Error('Android output must not contain the repository');
  const [sharedPaths, webPaths, packageText] = await Promise.all([
    filesIn(SOURCE),
    filesIn(WEB),
    readFile(join(ROOT, 'package.json'), 'utf8'),
  ]);
  for (const required of ['app.js', 'bridge.js', 'mobile.css', 'launch.css', 'launcher.js', 'reader.js']) {
    if (!webPaths.includes(required)) throw new Error(`Missing Android entry asset: ${required}`);
  }
  const { version } = JSON.parse(packageText);
  const config = {
    version,
    origin: `http://${HOST}:${DEFAULT_PORT}`,
    securityHeaders: {
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `${CSP}; frame-src 'none'; worker-src 'none'`,
      'x-frame-options': 'DENY',
    },
    health: {
      path: LOCAL_SERVER_HEALTH_PATH,
      headers: { [LOCAL_SERVER_HEADER_NAME]: LOCAL_SERVER_HEADER_VALUE },
    },
  };
  let index = await readFile(join(SOURCE, 'index.html'), 'utf8');
  const stylesheet = '<link rel="stylesheet" href="./styles.css" />';
  const entry = '<script type="module" src="./js/app.js"></script>';
  if (index.split(stylesheet).length !== 2 || index.split(entry).length !== 2) {
    throw new Error('Shared index entry changed; Android injection needs review');
  }
  index = index.replace(stylesheet, `${stylesheet}\n    <link rel="stylesheet" href="./android/mobile.css" />`)
    .replace(entry, '<script type="module" src="./android/app.js"></script>');
  const privacyHeading = '<h3>Your data</h3>';
  if (index.split(privacyHeading).length !== 2) {
    throw new Error('Shared privacy heading changed; Android disclosure needs review');
  }
  index = index.replace(privacyHeading, `${privacyHeading}
              <p>In this Android prototype, Read also sends the digital issue ID to Marvel's Bifrost service to resolve an app link. Marvel sees the request and network address, not your saved lists, notes or read markers. The lookup is not stored by Recap Page. Open in browser remains available if the service or app cannot open the comic.</p>`);
  let launcher = await readFile(join(SOURCE, 'open.html'), 'utf8');
  const launchStylesheet = '<link rel="stylesheet" href="./open.css" />';
  const launchEntry = '<script type="module" src="./open.js"></script>';
  if (launcher.split(launchStylesheet).length !== 2 || launcher.split(launchEntry).length !== 2) {
    throw new Error('Shared launcher entry changed; Android injection needs review');
  }
  launcher = launcher.replace(launchStylesheet,
    `${launchStylesheet}\n    <link rel="stylesheet" href="./android/launch.css" />`)
    .replace(launchEntry, '<script type="module" src="./android/launcher.js"></script>');
  await cleanOwnedOutput(directory);
  const entries = [];
  for (const path of sharedPaths) {
    if (EXCLUDED.has(path)) continue;
    const source = join(SOURCE, path);
    const destination = join(directory, path);
    await mkdir(dirname(destination), { recursive: true });
    if (path === 'index.html') await writeFile(destination, index);
    else if (path === 'open.html') await writeFile(destination, launcher);
    else await cp(source, destination);
    const sha256 = hash(await readFile(destination));
    const sourceSha256 = hash(await readFile(source));
    if (path !== 'index.html' && path !== 'open.html' && sha256 !== sourceSha256) {
      throw new Error(`Shared source changed during Android preparation: ${path}. Run preparation again.`);
    }
    entries.push({
      path,
      sha256,
      source: `src/${path}`,
      sourceSha256,
    });
  }
  for (const path of webPaths) {
    const destination = join(directory, 'android', path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(WEB, path), destination);
    const sha256 = hash(await readFile(destination));
    entries.push({ path: `android/${path}`, sha256, source: `packaging/android/web/${path}`, sourceSha256: sha256 });
  }
  await writeFile(join(directory, 'android-config.json'), `${JSON.stringify(config, null, 2)}\n`);
  entries.push({ path: 'android-config.json', sha256: hash(await readFile(join(directory, 'android-config.json'))) });
  const manifest = { version, files: entries.sort((a, b) => a.path.localeCompare(b.path, 'en')) };
  await writeFile(join(directory, 'android-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { directory: await realpath(directory), manifest, config };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareAndroid();
  console.log(`Prepared ${result.manifest.files.length} Android assets in ${result.directory}`);
}
