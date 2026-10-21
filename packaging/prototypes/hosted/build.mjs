/* global Buffer, console, process */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, '../../..');
export const SOURCE_ROOT = join(REPO_ROOT, 'src');
const MANIFEST_NAME = 'artifact-manifest.json';
const CONTRACT_NAME = 'host-contract.json';
const ALLOWED_EXTENSIONS = new Set([
  '.css', '.html', '.js', '.json', '.md', '.png', '.svg', '.webmanifest',
]);
const EXCLUDED_NAMES = new Set(['dev-faults.css', 'dev-faults.html', 'dev-faults.js']);
const EXCLUDED_PATHS = new Set(['icons/README.md']);

export const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
});

const HASH = (bytes) => createHash('sha256').update(bytes).digest('hex');
const posix = (value) => value.split(sep).join('/');

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected exactly one source shape for ${label}.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replacePatternOnce(source, pattern, after, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`Expected exactly one source shape for ${label}.`);
  return source.replace(pattern, after);
}

export function normalizeBasePath(value = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')
      || value.includes('\\') || /[?#\s]/.test(value) || value.split('/').includes('..')) {
    throw new Error('Base path must be an absolute URL path without query, fragment, spaces or parent segments.');
  }
  const parts = value.split('/').filter(Boolean);
  if (parts.some((part) => !/^[A-Za-z0-9._~-]+$/.test(part) || part === '.')) {
    throw new Error('Base path contains an unsupported segment.');
  }
  return parts.length ? `/${parts.join('/')}/` : '/';
}

async function listSourceFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const fullPath = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed in source inventory: ${fullPath}`);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(root, fullPath));
      continue;
    }
    if (!entry.isFile() || EXCLUDED_NAMES.has(entry.name) || !ALLOWED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      continue;
    }
    const path = posix(relative(root, fullPath));
    if (EXCLUDED_PATHS.has(path)) continue;
    files.push({ path, fullPath });
  }
  return files;
}

function sourceCommit(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function hostedLocalServerModule() {
  return [
    'export const LOCAL_SERVER_STATUS = Object.freeze({',
    '  READY: \'ready\',',
    '  UNREACHABLE: \'unreachable\',',
    '  UNEXPECTED: \'unexpected\',',
    '  NOT_APPLICABLE: \'not-applicable\',',
    '});',
    '',
    'export async function checkLocalServer() {',
    '  return LOCAL_SERVER_STATUS.NOT_APPLICABLE;',
    '}',
    '',
  ].join('\n');
}

function adaptIndex(source) {
  source = source.replace(/\r\n?/g, '\n');
  const transformations = [];
  const edits = [
    ['<h3>Local app connection</h3>', '<h3>Hosted static availability</h3>', 'local-health-heading'],
    [
      'Checking the local app connection…',
      'Local-server health checks do not apply to this static copy.',
      'local-health-status',
    ],
    [
      'id="btn-check-local-connection"',
      'id="btn-check-local-connection"\n                  disabled',
      'disable-local-health-control',
    ],
    ['>Check connection</button>', '>Local health check unavailable</button>', 'local-health-label'],
  ];
  for (const [before, after, label] of edits) {
    source = replaceOnce(source, before, after, label);
    transformations.push(label);
  }
  source = replacePatternOnce(
    source,
    /<details class="setting-more">\s*<summary>If the connection needs attention<\/summary>[\s\S]*?<p id="local-connection-help"[^>]*>[\s\S]*?<\/p>\s*<\/details>/,
    '<details class="setting-more"><summary>About this status</summary>'
      + '<p id="local-connection-help" class="rail-hint">A hosted static copy has no local app server. '
      + 'This prototype does not report the static host\'s availability.</p></details>',
    'local-health-guidance',
  );
  transformations.push('local-health-guidance');
  return { source, transformations };
}

function adaptMain(source) {
  source = source.replace(/\r\n?/g, '\n');
  const transformations = [];
  const edits = [
    [
      'function paintLocalConnectionStatus(status) {\n'
        + '  dataView.renderLocalConnectionStatus(status, LOCAL_SERVER_STATUS.READY);\n'
        + '}',
      'function paintLocalConnectionStatus() {\n'
        + '  const line = $(\'#local-connection-status\');\n'
        + '  if (line) line.textContent = \'Local-server health checks do not apply to this static copy.\';\n'
        + '  dataView.clearLocalConnectionReport();\n'
        + '}',
      'hosted-local-status-copy',
    ],
    [
      'const result = await runLocalConnectionProbe({ fresh: explicit });\n'
        + '  if (!result.current) return result;',
      'const result = await runLocalConnectionProbe({ fresh: explicit });\n'
        + '  if (!result.current || result.status === LOCAL_SERVER_STATUS.NOT_APPLICABLE) return result;',
      'suppress-local-health-guidance',
    ],
    [
      'if (!result.current || result.status === LOCAL_SERVER_STATUS.READY) {',
      'if (!result.current || result.status === LOCAL_SERVER_STATUS.READY\n'
        + '      || result.status === LOCAL_SERVER_STATUS.NOT_APPLICABLE) {',
      'bundled-load-uses-static-error',
    ],
    [
      'if (result.current && result.status !== LOCAL_SERVER_STATUS.READY) {',
      'if (result.current && result.status !== LOCAL_SERVER_STATUS.READY\n'
        + '        && result.status !== LOCAL_SERVER_STATUS.NOT_APPLICABLE) {',
      'preview-load-uses-static-error',
    ],
  ];
  for (const [before, after, label] of edits) {
    source = replaceOnce(source, before, after, label);
    transformations.push(label);
  }
  return { source, transformations };
}

function adaptReader(source, basePath) {
  const before = 'return `${origin}/open.html?${params.toString()}`;';
  const after = `return \`\${origin}${basePath}open.html?\${params.toString()}\`;`;
  return {
    source: replaceOnce(source, before, after, 'nested-reader-launch'),
    transformations: ['nested-reader-launch'],
  };
}

function adaptManifest(source, basePath) {
  const manifest = JSON.parse(source);
  if (manifest.id !== '/' || manifest.start_url !== '/' || manifest.scope !== '/'
      || !Array.isArray(manifest.icons) || manifest.icons.length !== 2
      || manifest.icons.some((icon) => !icon.src.startsWith('/icons/'))) {
    throw new Error('Manifest source shape changed; hosted path adaptation refused.');
  }
  manifest.id = basePath;
  manifest.start_url = basePath;
  manifest.scope = basePath;
  manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: `${basePath}${icon.src.slice(1)}` }));
  return { source: `${JSON.stringify(manifest, null, 2)}\n`, transformations: ['manifest-base-path'] };
}

function securityHeaders() {
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' https://i.annihil.us data:",
      "font-src 'self'",
      "connect-src 'self' https: http://127.0.0.1:* http://localhost:*",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-cache',
  };
}

export async function buildArtifact({
  sourceRoot = SOURCE_ROOT,
  repoRoot = REPO_ROOT,
  outputDirectory,
  basePath: rawBasePath = '/',
} = {}) {
  if (!outputDirectory) throw new Error('Provide an output directory outside the repository.');
  const basePath = normalizeBasePath(rawBasePath);
  const outputRoot = resolve(outputDirectory);
  const rootRelative = relative(resolve(repoRoot), outputRoot);
  if (rootRelative === '' || (!rootRelative.startsWith(`..${sep}`) && rootRelative !== '..' && !isAbsolute(rootRelative))) {
    throw new Error('Generated artifact output must be outside the repository.');
  }

  await mkdir(outputRoot, { recursive: true });
  if ((await readdir(outputRoot)).length > 0) {
    throw new Error(`Output directory must be empty: ${outputRoot}`);
  }

  const inputs = await listSourceFiles(resolve(sourceRoot));
  const sourceByPath = new Map();
  for (const input of inputs) {
    sourceByPath.set(input.path, await readFile(input.fullPath));
  }

  const transforms = [];
  const outputs = new Map();
  for (const input of inputs) {
    const raw = sourceByPath.get(input.path);
    let bytes = raw;
    if (input.path === 'index.html') {
      const adapted = adaptIndex(raw.toString('utf8'));
      bytes = Buffer.from(adapted.source);
      transforms.push(...adapted.transformations.map((name) => ({ path: input.path, name })));
    } else if (input.path === 'js/main.js') {
      const adapted = adaptMain(raw.toString('utf8'));
      bytes = Buffer.from(adapted.source);
      transforms.push(...adapted.transformations.map((name) => ({ path: input.path, name })));
    } else if (input.path === 'js/reader.js') {
      const adapted = adaptReader(raw.toString('utf8'), basePath);
      bytes = Buffer.from(adapted.source);
      transforms.push(...adapted.transformations.map((name) => ({ path: input.path, name })));
    } else if (input.path === 'manifest.webmanifest') {
      const adapted = adaptManifest(raw.toString('utf8'), basePath);
      bytes = Buffer.from(adapted.source);
      transforms.push(...adapted.transformations.map((name) => ({ path: input.path, name })));
    } else if (input.path === 'js/lib/localServer.js') {
      bytes = Buffer.from(hostedLocalServerModule());
      transforms.push({ path: input.path, name: 'replace-local-health-with-not-applicable-capability' });
    }
    outputs.set(input.path, bytes);
  }

  const contract = {
    format: 'recap-page-hosted-contract-v1',
    basePath,
    spaFallback: `${basePath}index.html`,
    responseHeaders: securityHeaders(),
    mimeTypes: MIME_TYPES,
    limitations: [
      'This static prototype does not provide local-server health.',
      'Frame protection is response-header-only; a meta CSP does not satisfy it.',
      'External metadata CORS and real HTTPS behavior are unverified.',
    ],
  };
  const contractBytes = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`);
  outputs.set(CONTRACT_NAME, contractBytes);

  const outputInventory = [...outputs.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, bytes]) => ({ path, sha256: HASH(bytes), bytes: bytes.length }));
  const contentDigest = HASH(outputInventory.map(({ path, sha256, bytes }) => `${path}\0${sha256}\0${bytes}`).join('\n'));
  const inputInventory = inputs.map(({ path }) => {
    const bytes = sourceByPath.get(path);
    return { path: `src/${path}`, sha256: HASH(bytes), bytes: bytes.length };
  });
  const manifest = {
    format: 'recap-page-hosted-artifact-v1',
    sourceCommit: sourceCommit(resolve(repoRoot)),
    basePath,
    contentDigest,
    digestScope: 'Sorted output path, SHA-256 and byte length; excludes this self-referential manifest.',
    inputInventory,
    outputInventory,
    transformations: transforms,
  };
  await Promise.all([...outputs.entries()].map(async ([path, bytes]) => {
    const target = join(outputRoot, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }));
  await writeFile(join(outputRoot, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, outputRoot };
}

function readOption(args, prefix) {
  const value = args.find((arg) => arg.startsWith(prefix));
  return value === undefined ? undefined : value.slice(prefix.length);
}

async function main() {
  const args = process.argv.slice(2);
  const outputDirectory = readOption(args, '--out=');
  const basePath = readOption(args, '--base-path=') ?? '/';
  const unknown = args.filter((arg) => !arg.startsWith('--out=') && !arg.startsWith('--base-path='));
  if (unknown.length || !outputDirectory) {
    throw new Error('Usage: node packaging/prototypes/hosted/build.mjs --out=<outside-repo-dir> [--base-path=/nested/]');
  }
  const result = await buildArtifact({ outputDirectory, basePath });
  console.log(JSON.stringify({
    sourceCommit: result.manifest.sourceCommit,
    basePath: result.manifest.basePath,
    contentDigest: result.manifest.contentDigest,
    inputs: result.manifest.inputInventory.length,
    outputs: result.manifest.outputInventory.length,
    outputDirectory: result.outputRoot,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
