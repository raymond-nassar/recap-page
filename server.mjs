// Zero-dependency static server pinned to a single loopback origin.
//
// The origin matters: Chromium restricts IndexedDB on file://, ES modules do not load from
// file://, and file:// / localhost / 127.0.0.1 are three separate storage buckets. Always
// launching on the same origin is what keeps your reading progress where you left it.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVER_IMAGE_HOST } from './src/js/lib/coverHost.js';
import {
  LOCAL_SERVER_GENERATION_HEADER_NAME,
  LOCAL_SERVER_HEADER_NAME,
  LOCAL_SERVER_HEADER_VALUE,
  LOCAL_SERVER_HEALTH_PATH,
  LOCAL_SERVER_PROCESS_HEADER_NAME,
} from './src/js/lib/localServer.js';

const ROOT = resolve(fileURLToPath(new URL('./src', import.meta.url)));
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const PORT = parsePort(process.env.MRT_PORT);
const PACKAGE_GENERATION = await readFile(
  resolve(fileURLToPath(new URL('./src/msix-generation.json', import.meta.url))),
  'utf8',
).then((source) => JSON.parse(source).generation).catch(() => 'development');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

// The app renders titles, creator names and descriptions that come from a third-party
// metadata service, so it is worth assuming that response could one day be hostile or
// compromised. `script-src 'self'` is the directive that actually matters here: it means
// markup smuggled through a field like an issue title cannot execute. Everything under
// src/ loads from a file for exactly that reason, so no inline allowance is needed.
//
// `connect-src` is deliberately wider than the default endpoint. The API base is
// user-configurable at runtime, and the rule for what is accepted lives in
// src/js/lib/apiBase.js: any https origin, or plain http to loopback. Pinning this to
// marvel.emreparker.com would silently break anyone pointing the app at their own mirror.
// Restricting the scheme still rules out plaintext http to arbitrary hosts. The loopback
// entries here have to stay in step with that module, or a base the settings form accepts
// would be blocked at fetch time with no obvious explanation.
//
// `img-src` used to be wide for the same stated reason, and the reason was borrowed rather
// than checked. The app never requests an image from the API base: a cover address is a field
// inside the response body, and every service serving that shape reports Marvel's own CDN. So
// the mirror argument that keeps connect-src wide does not reach img-src, and leaving it wide
// only meant a compromised or hostile service could name any host it liked and have the browser
// fetch it on every render. The host is imported from the same module that decides which cover
// URLs may be built, so the directive and the URL policy cannot disagree. The favicon in
// index.html is a data: SVG, which is what the data: source is for, and nothing else in the
// app loads an image over the network.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  `img-src 'self' https://${COVER_IMAGE_HOST} data:`,
  "font-src 'self'",
  "connect-src 'self' https: http://127.0.0.1:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function safePath(urlPath) {
  // decodeURIComponent throws URIError on a malformed escape such as "/%" or "/a%2". This runs
  // before the request handler's try block, so an unhandled rejection would terminate the whole
  // process, and any web page the user has open could trigger it with a single fetch. Returning
  // null is what the handler answers 403 to, the same as a path that escapes the root: this
  // function's job is to say whether a URL names a file it is willing to serve, and a path it
  // cannot even decode is not one.
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  const full = resolve(join(ROOT, rel === '' ? 'index.html' : rel));
  // Reject anything that escapes src/ regardless of how it was encoded.
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

// A server that is not listening yet. Separating construction from binding is what lets a test
// drive the contract below on an ephemeral port without taking 8787, and without this module
// opening a browser the moment it is imported.
export function createStaticServer() {
  return createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      // A request must never be able to kill the process. Without this, any throw in the handler
      // becomes an unhandled rejection and Node exits, taking the user's session with it.
      console.error(`Request failed: ${req.method} ${req.url}: ${err?.message ?? err}`);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      if (!res.writableEnded) res.end('Internal error');
    }
  });
}

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }

  if ((req.url || '/').split('?')[0].split('#')[0] === LOCAL_SERVER_HEALTH_PATH) {
    res.writeHead(204, {
      'cache-control': 'no-store',
      [LOCAL_SERVER_HEADER_NAME]: LOCAL_SERVER_HEADER_VALUE,
      [LOCAL_SERVER_GENERATION_HEADER_NAME]: PACKAGE_GENERATION,
      [LOCAL_SERVER_PROCESS_HEADER_NAME]: String(process.pid),
    });
    res.end();
    return;
  }

  const target = safePath(req.url || '/');
  if (!target) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    let file = target;
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }

    // Everything here is served no-cache, so the browser revalidates on every load and always
    // sees a rebuilt file immediately. Without a validator it cannot revalidate, only re-fetch:
    // each reload pulled the whole of every asset, which the vendored search indexes turned into
    // 455 KB. Size and modification time identify a build well enough to answer that with a 304,
    // and the stat above has already paid for them.
    const etag = info ? `"${info.size.toString(16)}-${Math.round(info.mtimeMs).toString(16)}"` : null;
    const headers = {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': CSP,
      // frame-ancestors above is the modern control; this is the companion header for
      // anything that still honours only the older one.
      'x-frame-options': 'DENY',
      ...(etag ? { etag } : {}),
    };

    if (etag && req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    // Read after the 304 check, so an unchanged file is never loaded into memory at all. A file
    // that vanished between the stat and here still falls through to the 404 below.
    const body = await readFile(file);
    res.writeHead(200, headers);
    // Measured rather than assumed: node:http suppresses the body of a HEAD reply on its own, and
    // the headers it sends are identical either way, so this ternary is intent made visible rather
    // than the mechanism. A mutation that deletes it survives the suite for that reason. It is kept
    // because it says what the reply is meant to be, and because the day this stops writing through
    // res.end it stops being free.
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

// The port is read once, here, so an unusable value is reported in the same register as a taken
// one rather than as a stack trace. A typo in a hand-set `MRT_PORT` used to reach node:net and exit
// with ERR_SOCKET_BAD_PORT, which reads as a crash rather than as a correction. Zero is refused with
// the rest: it means "any free port" to the operating system, and the whole point of this server is
// that the origin does not move.
export function parsePort(raw) {
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  if (text === '') return DEFAULT_PORT;
  // Decimal digits only. Number() would take '0x2263' and bind 8803, and '1e3' and bind 1000, so a
  // value that does not read as a port would quietly become one and move the origin.
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= 65535 ? n : null;
}

// Which command opens a browser, as data rather than as a branch inside the spawn call. Two of the
// three branches cannot run on the machine this is developed on, so as a branch they were unread
// and untested; as a table they are all three checked on every platform.
//
// The empty string after `start` is not padding. `start` treats its first quoted argument as the
// title of the console window it opens, so a URL arriving as the only quoted argument is consumed
// as a title and nothing opens. Anything other than Windows and macOS gets the freedesktop
// launcher, which is the right default for the BSDs as well as Linux.
export function browserCommand(platform, url) {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

function openBrowser(url) {
  import('node:child_process')
    .then(({ spawn }) => {
      const { command, args } = browserCommand(process.platform, url);
      spawn(command, args, { stdio: 'ignore', detached: true }).unref();
    })
    .catch(() => {});
}

// The two startup failures a reader can actually hit, as data rather than as console.error calls
// buried in a branch that only runs when the port is taken. Returned as lines so a test can read
// the words without binding a socket, which is the same reason browserCommand above is a table.
//
// Neither names npm. The packaged Windows archive carries a runtime and the app and nothing else:
// no package.json, so no `npm start`, and the reader it was built for has installed nothing. That
// advice was written when a clone was the only way to run this, and it survived the archive.
//
// The busy-port text refuses to offer a different port, which is the opposite of what it used to
// do. Reading progress is stored by the browser against the exact origin it was saved at, so
// moving to 8788 opens an app with nothing in it while the reading sits at 8787, and a reader who
// has just been told their port is busy is the least equipped to know that. test/launcher.test.js
// already forbids the launcher from setting MRT_PORT for this reason; this is the same rule
// applied to the advice the server prints.
export function badPortMessage(raw) {
  return [
    '',
    `MRT_PORT is set to ${JSON.stringify(raw)}, which is not a port.`,
    'Use a whole number from 1 to 65535, or clear it and start the tracker again.',
    '',
  ];
}

export function busyPortMessage(host, port) {
  return [
    '',
    `Port ${port} is already in use.`,
    `If the tracker is already running, open http://${host}:${port}/ instead.`,
    'If that address does not show the tracker, then another program has the port.',
    'Close that program, then start the tracker again.',
    'Do not start the tracker on a different port to get past this. Your reading is',
    'saved against the address above and stays there, so another port opens an app',
    'with nothing in it.',
    '',
  ];
}

function start() {
  if (PORT === null) {
    for (const line of badPortMessage(process.env.MRT_PORT)) console.error(line);
    process.exit(1);
  }

  const server = createStaticServer();

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      for (const line of busyPortMessage(HOST, PORT)) console.error(line);
      process.exit(1);
    }
    throw err;
  });

  // Loopback only. This server is never exposed to the network.
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}/`;
    console.log(`Recap Page running at ${url}`);
    console.log('Always use this exact address. Other addresses are separate browser storage.');
    console.log('Press Ctrl+C to stop.');
    if (process.env.MRT_NO_OPEN !== '1') openBrowser(url);
  });

  return server;
}

// Only when this file is the program. Everything above is importable, and a test that imported a
// module which binds a port and launches a browser would be a test with side effects on the
// machine running it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start();

export {
  CSP, DEFAULT_PORT, HOST, PACKAGE_GENERATION, safePath,
};
