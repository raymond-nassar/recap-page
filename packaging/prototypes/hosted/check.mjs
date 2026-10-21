/* global console, fetch, process, URL */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIME_TYPES, normalizeBasePath } from './build.mjs';

const CONTRACT_FILE = 'host-contract.json';
const MANIFEST_FILE = 'artifact-manifest.json';
const SECURITY_NAMES = new Set([
  'content-security-policy',
  'x-content-type-options',
  'referrer-policy',
  'x-frame-options',
  'cache-control',
]);

async function filesUnder(root, directory = root) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await filesUnder(root, path));
    else if (entry.isFile()) results.push(relative(root, path).split(sep).join('/'));
  }
  return results.sort();
}

export async function checkArtifact(outputDirectory, requestedBasePath) {
  const root = resolve(outputDirectory);
  const basePath = normalizeBasePath(requestedBasePath);
  const manifest = JSON.parse(await readFile(join(root, MANIFEST_FILE), 'utf8'));
  const contract = JSON.parse(await readFile(join(root, CONTRACT_FILE), 'utf8'));
  assert.equal(manifest.format, 'recap-page-hosted-artifact-v1');
  assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);
  assert.equal(manifest.basePath, basePath);
  assert.equal(contract.format, 'recap-page-hosted-contract-v1');
  assert.equal(contract.basePath, basePath);
  assert.equal(contract.spaFallback, `${basePath}index.html`);
  assert.deepEqual(contract.mimeTypes, MIME_TYPES);
  assert.ok(Array.isArray(manifest.inputInventory) && manifest.inputInventory.length > 0);
  assert.ok(Array.isArray(manifest.outputInventory) && manifest.outputInventory.length > 0);
  assert.ok(Array.isArray(manifest.transformations) && manifest.transformations.length > 0);
  assert.ok(!manifest.inputInventory.some(({ path }) => /(?:^|\/)dev-faults\./.test(path)));
  assert.ok(!manifest.outputInventory.some(({ path }) => /(?:^|\/)dev-faults\./.test(path)));
  assert.ok(manifest.transformations.some(({ name }) => name === 'replace-local-health-with-not-applicable-capability'));
  assert.ok(manifest.transformations.some(({ name }) => name === 'nested-reader-launch'));

  const actualFiles = (await filesUnder(root)).filter((path) => path !== MANIFEST_FILE);
  assert.deepEqual(actualFiles, manifest.outputInventory.map(({ path }) => path).sort(),
    'the output inventory must account for every generated file exactly once');
  const digestRows = [];
  for (const entry of manifest.outputInventory) {
    assert.ok(!entry.path.startsWith('/') && !entry.path.split('/').includes('..'), `unsafe output path: ${entry.path}`);
    const bytes = await readFile(join(root, ...entry.path.split('/')));
    assert.equal(bytes.length, entry.bytes, `output size drift: ${entry.path}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha256, entry.sha256, `output hash drift: ${entry.path}`);
    digestRows.push(`${entry.path}\0${sha256}\0${bytes.length}`);
  }
  assert.equal(createHash('sha256').update(digestRows.join('\n')).digest('hex'), manifest.contentDigest);

  const headers = contract.responseHeaders;
  const csp = headers['Content-Security-Policy'];
  assert.match(csp, /(?:^|; )script-src 'self'(?:;|$)/);
  assert.match(csp, /(?:^|; )style-src 'self'(?:;|$)/);
  assert.match(csp, /(?:^|; )frame-ancestors 'none'(?:;|$)/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Cache-Control'], 'no-cache');
  assert.equal(await stat(join(root, 'index.html')).then((info) => info.isFile()), true);
  const html = await readFile(join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /http-equiv=["']Content-Security-Policy/i,
    'frame-ancestors must be sent as a response header, not claimed through a meta element');
  assert.match(html, /Local-server health checks do not apply to this static copy\./);
  assert.match(await readFile(join(root, 'js/lib/localServer.js'), 'utf8'), /NOT_APPLICABLE/);
  assert.doesNotMatch(await readFile(join(root, 'js/lib/localServer.js'), 'utf8'), /\bfetch\s*\(/);
  const reader = await readFile(join(root, 'js/reader.js'), 'utf8');
  assert.ok(reader.includes(`\${origin}${basePath}open.html?`), 'reader launch must remain within the selected base path');
  const webmanifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(webmanifest.id, basePath);
  assert.equal(webmanifest.start_url, basePath);
  assert.equal(webmanifest.scope, basePath);
  assert.ok(webmanifest.icons.every(({ src }) => src.startsWith(`${basePath}icons/`)));
  return { root, basePath, manifest, contract };
}

function headerMap(headers) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
}

export function createHeaderHarness(outputDirectory, requestedBasePath) {
  const root = resolve(outputDirectory);
  const basePath = normalizeBasePath(requestedBasePath);
  const contractPath = join(root, CONTRACT_FILE);
  let contractPromise;
  const server = createServer(async (request, response) => {
    const contract = await (contractPromise ??= readFile(contractPath, 'utf8').then(JSON.parse));
    const security = headerMap(contract.responseHeaders);
    const reply = (status, body, contentType = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { ...security, 'content-type': contentType });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('allow', 'GET, HEAD');
      reply(405, 'Method Not Allowed');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch {
      reply(403, 'Forbidden');
      return;
    }
    if (pathname !== basePath.slice(0, -1) && !pathname.startsWith(basePath)) {
      reply(404, 'Not found');
      return;
    }
    const suffix = pathname.slice(basePath.length).replace(/^\/+/, '');
    const relativePath = !suffix || pathname.endsWith('/') ? 'index.html' : suffix;
    const target = resolve(root, ...relativePath.split('/'));
    const pathFromRoot = relative(root, target);
    if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) {
      reply(403, 'Forbidden');
      return;
    }
    try {
      const body = await readFile(target);
      const mime = MIME_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
      reply(200, body, mime);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'EISDIR') reply(404, 'Not found');
      else {
        console.error(`Hosted prototype harness failed: ${error.message}`);
        reply(500, 'Harness error');
      }
    }
  });
  return server;
}

export async function startHeaderHarness(outputDirectory, basePath) {
  const server = createHeaderHarness(outputDirectory, basePath);
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return {
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    }),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const output = args.find((arg) => arg.startsWith('--out='))?.slice('--out='.length);
  const basePath = args.find((arg) => arg.startsWith('--base-path='))?.slice('--base-path='.length) ?? '/';
  if (!output || args.some((arg) => !arg.startsWith('--out=') && !arg.startsWith('--base-path='))) {
    throw new Error('Usage: node packaging/prototypes/hosted/check.mjs --out=<artifact-dir> [--base-path=/nested/]');
  }
  const checked = await checkArtifact(output, basePath);
  const harness = await startHeaderHarness(output, basePath);
  const checks = [];
  try {
    const checksToFetch = [
      ['', 'text/html; charset=utf-8'],
      ['styles.css', 'text/css; charset=utf-8'],
      ['js/app.js', 'text/javascript; charset=utf-8'],
      ['data/catalog.json', 'application/json; charset=utf-8'],
      ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
      ['icons/icon.svg', 'image/svg+xml'],
      ['icons/icon-192.png', 'image/png'],
    ];
    for (const [path, expectedType] of checksToFetch) {
      const response = await fetch(`${harness.origin}${basePath}${path}`);
      assert.equal(response.status, 200, `${path || '/'} response`);
      assert.equal(response.headers.get('content-type'), expectedType, `${path || '/'} MIME`);
      for (const name of SECURITY_NAMES) {
        assert.ok(response.headers.has(name), `${path || '/'} is missing ${name}`);
      }
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      checks.push(path || '/');
      await response.arrayBuffer();
    }
    const health = await fetch(`${harness.origin}/__recap_page_health__`);
    assert.equal(health.status, 404, 'hosted static mode must not provide local-server health');
    checks.push('health endpoint absent');
    console.log(JSON.stringify({
      basePath: checked.basePath,
      sourceCommit: checked.manifest.sourceCommit,
      contentDigest: checked.manifest.contentDigest,
      checks,
      harnessOrigin: harness.origin,
      liveHttps: 'blocked: no approved host/destination/upload scope',
    }, null, 2));
  } finally {
    await harness.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
