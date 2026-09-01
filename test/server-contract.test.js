import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { sep } from 'node:path';

import {
  CSP, DEFAULT_PORT, HOST, PACKAGE_GENERATION, browserCommand, createStaticServer, parsePort, safePath,
} from '../server.mjs';
import {
  LOCAL_SERVER_GENERATION_HEADER_NAME,
  LOCAL_SERVER_HEADER_NAME,
  LOCAL_SERVER_HEADER_VALUE,
  LOCAL_SERVER_HEALTH_PATH,
  LOCAL_SERVER_PROCESS_HEADER_NAME,
} from '../src/js/lib/localServer.js';

// The server is the install and runtime boundary and nothing started it. A Windows smoke run during
// the UX study proved it boots on one machine, which rejects a startup defect and says nothing about
// the HTTP contract or about the two launcher branches that cannot run on the machine it was
// developed on.
//
// The reason there were no tests is that importing this module used to bind port 8787 and open a
// browser. Everything below rests on that being separated: createStaticServer builds a server that
// is not listening, so each test binds an ephemeral loopback port of its own and gives it back.

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const packageName = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name;
assert.ok(packageName, 'package.json has no name, so the leak assertion would check an empty marker');

// Binds 127.0.0.1:0, so the operating system picks a free port and nothing collides with a tracker
// the developer already has running on 8787. Always closed, including when the body throws.
//
// closeAllConnections is not tidiness. server.close() waits for open connections to end and leaves
// idle keep-alive ones alone, so without it a pooled socket keeps the callback from ever firing and
// the run hangs with no failing test to point at. That happened here before agent:false below.
async function withServer(body, requestHandler) {
  const server = createStaticServer(requestHandler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  try {
    return await body(server.address().port, server);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

// agent: false gives every request its own connection. Node's global agent keeps connections alive
// and pools them by host and port, and these servers hand their port back to the operating system
// as soon as they close, so a later server can be handed the same one and be sent a request down a
// socket belonging to the server before it.
function fetchPath(port, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: HOST, port, path, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    // A reply the client can never finish reading is a defect, and without this it is one that
    // hangs the whole run with nothing named. A 304 carrying a content-length does exactly that.
    req.setTimeout(5000, () => req.destroy(new Error(`no complete reply for ${method} ${path}`)));
    req.on('error', reject);
    req.end();
  });
}

function assertSecurityHeaders(res, context) {
  assert.equal(res.headers['content-security-policy'], CSP, `${context}: content security policy`);
  assert.equal(res.headers['x-content-type-options'], 'nosniff', `${context}: content type options`);
  assert.equal(res.headers['referrer-policy'], 'no-referrer', `${context}: referrer policy`);
  assert.equal(res.headers['x-frame-options'], 'DENY', `${context}: frame options`);
}

// The Node client normalises and validates what it will put on the request line, so a target it
// refuses to send can only be produced by writing the bytes. A page in a browser cannot send this
// either, but a local script can, and the guard exists for exactly that.
function rawRequest(port, requestLine) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, HOST, () => {
      socket.write(`${requestLine} HTTP/1.1\r\nHost: ${HOST}:${port}\r\nConnection: close\r\n\r\n`);
    });
    socket.setTimeout(5000, () => socket.destroy());
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('error', reject);
    socket.on('close', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(text)?.[1] ?? 0), text });
    });
  });
}

test('importing the server does not bind a port or open a browser', () => {
  // Everything else in this file depends on it, and the dependency is a single line rather than a
  // property of the module, so it is asserted rather than assumed. Without the guard, `node --test`
  // would take 8787 from whatever is already using it and launch a browser tab per run.
  assert.match(
    source,
    /if \(process\.argv\[1\] && resolve\(process\.argv\[1\]\) === fileURLToPath\(import\.meta\.url\)\) start\(\);/,
    'server.mjs must only start itself when it is the program',
  );
  assert.equal(/^server\.listen\(/m.test(source), false, 'a listen at module scope would run on import');
});

// ---------------------------------------------------------------- the port

test('the port falls back to the pinned default when nothing sets it', () => {
  assert.equal(DEFAULT_PORT, 8787);
  for (const raw of [undefined, null, '', '   ']) {
    assert.equal(parsePort(raw), DEFAULT_PORT, `${JSON.stringify(raw)} should mean "unset"`);
  }
  assert.equal(parsePort('8788'), 8788);
  assert.equal(parsePort(' 8788 '), 8788, 'a value pasted with spaces is still the number it looks like');
});

// The error path this replaced was a stack trace. `Number('abc')` is NaN, node:net refuses it with
// ERR_SOCKET_BAD_PORT, and it was thrown from module scope where nothing was catching it, so a typo
// in the very advice the busy-port message prints looked like the app was broken.
test('a value that is not a port is refused rather than reaching node:net', () => {
  for (const raw of ['abc', '0', '-1', '65536', '80.5', '8787abc', 'Infinity', '1e3', '0x2263', '+8788', ' 87 88 ']) {
    assert.equal(parsePort(raw), null, `${raw} must not be accepted as a port`);
  }
  // Zero is the one that looks valid. It means "any free port" to the operating system, which is
  // the opposite of what this server is for: a moving origin is a moving storage bucket.
  assert.equal(parsePort(0), null);
  // 0x2263 is 8803 and 1e3 is 1000 to Number(), so a value nobody would call a port used to become
  // one. What the user typed and what the address bar shows have to be the same string.
  assert.equal(parsePort('0x2263'), null);
});

// ---------------------------------------------------------------- the launcher

// Two of these three branches cannot run on the machine this was developed on, so as a conditional
// inside spawn they were never read by anything. As data they are checked everywhere the tests run.
test('the launcher picks a command per platform', () => {
  assert.deepEqual(browserCommand('win32', 'http://127.0.0.1:8787/'), {
    command: 'cmd',
    args: ['/c', 'start', '', 'http://127.0.0.1:8787/'],
  });
  assert.deepEqual(browserCommand('darwin', 'http://127.0.0.1:8787/'), {
    command: 'open',
    args: ['http://127.0.0.1:8787/'],
  });
  assert.deepEqual(browserCommand('linux', 'http://127.0.0.1:8787/'), {
    command: 'xdg-open',
    args: ['http://127.0.0.1:8787/'],
  });
});

// The empty string is the whole reason the Windows branch is three arguments rather than two, and
// it looks exactly like a mistake to anyone tidying it up.
test('the Windows command keeps the empty title argument that stops start eating the URL', () => {
  const { args } = browserCommand('win32', 'http://127.0.0.1:8787/');
  assert.equal(args[1], 'start');
  assert.equal(args[2], '', 'start reads its first quoted argument as a window title');
  assert.equal(args[3], 'http://127.0.0.1:8787/');
});

// A platform nobody listed still gets a launcher rather than nothing. freebsd and openbsd ship the
// freedesktop tool, and on a platform that does not, spawn fails and openBrowser swallows it, which
// is the same outcome as having no branch at all but one line shorter.
test('an unlisted platform falls back to the freedesktop launcher', () => {
  for (const platform of ['freebsd', 'openbsd', 'sunos', 'android']) {
    assert.equal(browserCommand(platform, 'http://x/').command, 'xdg-open', platform);
  }
});

// ---------------------------------------------------------------- the HTTP contract

test('a GET of the root serves index.html with the security headers', async () => {
  await withServer(async (port) => {
    const res = await fetchPath(port, '/');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    // Compared against the exported value rather than a copy, so the two cannot drift.
    assert.equal(res.headers['content-security-policy'], CSP);
    assert.match(res.body.toString('utf8'), /<title>/);
  });
});

test('the served policy is the one the app is built against', async () => {
  await withServer(async (port) => {
    const sent = (await fetchPath(port, '/')).headers['content-security-policy'];
    // The directives that carry the two decisions this project has measured. script-src is what
    // makes a hostile metadata field inert, and img-src is the cover host pin.
    assert.match(sent, /(^|; )script-src 'self'(;|$)/);
    assert.match(sent, /(^|; )img-src 'self' https:\/\/i\.annihil\.us data:(;|$)/);
    assert.match(sent, /(^|; )frame-ancestors 'none'(;|$)/);
  });
});

// What this pins is that a HEAD is answered like the GET it stands in for. It does not pin the line
// in the handler that skips the body: node:http suppresses a HEAD body by itself, measured, so that
// line is deliberately not what makes this pass and a mutation removing it survives.
test('a HEAD gets the headers and no body', async () => {
  await withServer(async (port) => {
    const head = await fetchPath(port, '/', { method: 'HEAD' });
    const get = await fetchPath(port, '/');
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.ok(get.body.length > 0);
    assert.equal(head.headers['content-security-policy'], get.headers['content-security-policy']);
    assert.equal(head.headers.etag, get.headers.etag);
  });
});

test('anything other than GET or HEAD is refused and says what is allowed', async () => {
  await withServer(async (port) => {
    for (const path of ['/', LOCAL_SERVER_HEALTH_PATH]) {
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
        const res = await fetchPath(port, path, { method });
        assert.equal(res.status, 405, `${method} ${path}`);
        assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8', `${method} ${path}`);
        assert.equal(res.headers.allow, 'GET, HEAD', `${method} ${path}`);
      }
    }
  });
});

test('the local health response is identifiable and cannot be cached by the worker', async () => {
  await withServer(async (port) => {
    for (const method of ['GET', 'HEAD']) {
      const res = await fetchPath(port, LOCAL_SERVER_HEALTH_PATH, { method });
      assert.equal(res.status, 204, method);
      assert.equal(res.headers['cache-control'], 'no-store', method);
      assert.equal(
        res.headers[LOCAL_SERVER_HEADER_NAME.toLowerCase()],
        LOCAL_SERVER_HEADER_VALUE,
        method,
      );
      assert.equal(
        res.headers[LOCAL_SERVER_GENERATION_HEADER_NAME.toLowerCase()],
        PACKAGE_GENERATION,
        method,
      );
      assert.equal(
        res.headers[LOCAL_SERVER_PROCESS_HEADER_NAME.toLowerCase()],
        String(process.pid),
        method,
      );
      assert.equal(res.body.length, 0, method);
    }
  });
});

test('every application response carries the security headers', async () => {
  await withServer(async (port) => {
    const initial = await fetchPath(port, '/index.html');
    const cases = [
      ['200', initial],
      ['204', await fetchPath(port, LOCAL_SERVER_HEALTH_PATH)],
      ['304', await fetchPath(port, '/index.html', { headers: { 'if-none-match': initial.headers.etag } })],
      ['403', await fetchPath(port, '/%')],
      ['404', await fetchPath(port, '/does-not-exist.html')],
      ['405', await fetchPath(port, '/', { method: 'POST' })],
    ];
    for (const [status, res] of cases) {
      assert.equal(res.status, Number(status), status);
      assertSecurityHeaders(res, status);
    }
    assert.equal(cases[3][1].headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(cases[4][1].headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(cases[5][1].headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(cases[5][1].headers.allow, 'GET, HEAD');
  });

  const errors = [];
  const originalError = console.error;
  console.error = (message) => errors.push(message);
  try {
    await withServer(async (port) => {
      for (let requestNumber = 1; requestNumber <= 2; requestNumber += 1) {
        const res = await fetchPath(port, '/');
        assert.equal(res.status, 500, `request ${requestNumber}`);
        assertSecurityHeaders(res, `500 request ${requestNumber}`);
        assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
        assert.equal(res.body.toString('utf8'), 'Internal error');
      }
    }, async () => {
      throw new Error('planned test failure');
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(errors.length, 2);
  assert.ok(errors.every((message) => message.endsWith(': planned test failure')));
});

// ---------------------------------------------------------------- revalidation

test('an unchanged file answers a conditional request with 304 and no body', async () => {
  await withServer(async (port) => {
    const first = await fetchPath(port, '/index.html');
    assert.ok(first.headers.etag, 'a validator must be sent, or the browser can only re-fetch');
    const second = await fetchPath(port, '/index.html', { headers: { 'if-none-match': first.headers.etag } });
    assert.equal(second.status, 304);
    assert.equal(second.body.length, 0);
    assert.equal(second.headers['content-security-policy'], CSP, 'a 304 still carries the policy');
  });
});

test('a stale validator gets the file rather than a 304', async () => {
  await withServer(async (port) => {
    const res = await fetchPath(port, '/index.html', { headers: { 'if-none-match': '"0-0"' } });
    assert.equal(res.status, 200);
    assert.ok(res.body.length > 0);
  });
});

// The tag is built from size and modification time, so two different files must not share one. This
// is what stops a 304 from answering for the wrong file after an edit that keeps the length.
test('two different files do not share a validator', async () => {
  await withServer(async (port) => {
    const a = await fetchPath(port, '/index.html');
    const b = await fetchPath(port, '/styles.css');
    assert.equal(b.status, 200);
    assert.notEqual(a.headers.etag, b.headers.etag);
  });
});

// ---------------------------------------------------------------- types

test('each served extension gets the type the browser needs', async () => {
  await withServer(async (port) => {
    const cases = [
      ['/index.html', 'text/html; charset=utf-8'],
      ['/styles.css', 'text/css; charset=utf-8'],
      ['/js/main.js', 'text/javascript; charset=utf-8'],
      ['/data/catalog.json', 'application/json; charset=utf-8'],
    ];
    for (const [path, type] of cases) {
      const res = await fetchPath(port, path);
      assert.equal(res.status, 200, path);
      // A module served as anything but a JavaScript type is refused by the browser outright, and
      // a stylesheet served as text/plain is ignored under nosniff, so these are load-bearing.
      assert.equal(res.headers['content-type'], type, path);
    }
  });
});

test('an unknown extension is served as bytes rather than guessed at', async () => {
  await withServer(async (port) => {
    // package.json is not under src/, so this asks for something that cannot exist and reads the
    // 404 instead. The fallback itself is asserted from the table, which is where it is decided.
    assert.equal((await fetchPath(port, '/nothing.xyz')).status, 404);
    assert.match(source, /TYPES\[extname\(file\)\.toLowerCase\(\)\] \?\? 'application\/octet-stream'/);
  });
});

// ---------------------------------------------------------------- paths

test('a file that is not there is a 404, not a crash', async () => {
  await withServer(async (port) => {
    assert.equal((await fetchPath(port, '/does-not-exist.html')).status, 404);
    assert.equal((await fetchPath(port, '/js/does-not-exist.js')).status, 404);
  });
});

test('a directory with no index is a 404', async () => {
  await withServer(async (port) => {
    assert.equal((await fetchPath(port, '/js/')).status, 404);
    assert.equal((await fetchPath(port, '/data/')).status, 404);
  });
});

// normalize() clamps an absolute path at its own root, so the obvious traversal never leaves src/:
// "/../package.json" normalises to "/package.json" before the root check ever sees it, and answers
// 404 because src/package.json does not exist. That, and not the root check, is what actually stops
// traversal over HTTP, which is worth knowing before anyone simplifies either one away.
test('the obvious traversal is clamped before it is checked', () => {
  const clamped = safePath('/../package.json');
  assert.ok(clamped, 'normalize should have flattened this to a path inside the root');
  assert.match(clamped, /src[\\/]package\.json$/);
  assert.equal(safePath('/%2e%2e/%2e%2e/package.json'), clamped, 'encoding the dots changes nothing');
});

// The root check answers the shape normalize cannot clamp: a relative path, which has no root to be
// held at. Measured rather than assumed, Node's own parser answers 400 to a request line carrying
// one (see below), so today this is defence in depth rather than the live protection. It is asserted
// here at the function it lives in, because that is where it can be reached.
test('a path with no root to clamp against is refused', () => {
  for (const target of ['../package.json', '../../package.json', '..%2fpackage.json', '../']) {
    assert.equal(safePath(target), null, target);
  }
});

// A backslash is a separator on Windows and an ordinary character in a filename on everything else,
// so the two relative inputs below have two correct answers each: on Windows they are traversals and
// are refused, and on Linux they name files inside src/ that do not exist and are 404s. The third,
// with a leading slash, does not diverge, because normalize clamps an absolute path at its own root
// on both. Asserting a status literally would make this suite pass on one operating system and fail
// on the other, and asserting only the local answer would hide that. What every answer has in common
// is the property that matters, so that is what is asserted.
test('a separator that only some systems recognise still cannot reach outside', () => {
  const root = safePath('/');
  const srcDir = root.slice(0, root.lastIndexOf(sep));
  for (const target of ['..\\package.json', '..\\..\\package.json', '/..\\package.json']) {
    const resolved = safePath(target);
    if (resolved === null) continue;
    assert.ok(resolved.startsWith(srcDir + sep), `${target} resolved to ${resolved}`);
  }
});

// The claim that matters is not which of the two refuses a given shape, it is that no shape gets a
// file from outside src/. package.json is one directory above the root and is the file a traversal
// would be aiming at. The status assertion is a range rather than a value on purpose, and
// //../package.json is why: path.win32.normalize reads a leading // as a UNC root and refuses it, so
// Windows answers 403 where Linux answers 404. Both are refusals, which is the claim; only the
// choice of refusal moves.
test('no traversal shape serves a file from outside the served directory', async () => {
  await withServer(async (port) => {
    const targets = [
      '/../package.json',
      '/../../package.json',
      '/%2e%2e/package.json',
      '/%2e%2e%2fpackage.json',
      '/..%2f..%2fpackage.json',
      '/./../package.json',
      '/js/../../package.json',
      '/..\\package.json',
      '//../package.json',
    ];
    for (const target of targets) {
      const res = await rawRequest(port, `GET ${target}`);
      assert.ok([403, 404].includes(res.status), `${target} answered ${res.status}`);
      assert.equal(res.text.includes(`"name": "${packageName}"`), false, `${target} leaked package.json`);
    }
  });
});

// Written down because it is the reason the test above goes through raw sockets and still cannot
// reach the root check. If a future Node relaxes this, that check stops being a formality, so a
// change here is a signal rather than a nuisance.
test('a request line with a relative target is refused by the HTTP parser itself', async () => {
  await withServer(async (port) => {
    assert.equal((await rawRequest(port, 'GET ../package.json')).status, 400);
  });
});

test('a malformed escape is refused rather than taking the process down', async () => {
  await withServer(async (port) => {
    // decodeURIComponent throws URIError on each of these. Before the try inside safePath, that
    // threw out of the handler, and a page in any tab could have ended the session with one fetch.
    for (const target of ['/%', '/a%2', '/%zz', '/%e0%a4%a']) {
      assert.equal((await rawRequest(port, `GET ${target}`)).status, 403, target);
    }
    // The process is the thing under test here, so the server has to still answer afterwards.
    assert.equal((await fetchPath(port, '/')).status, 200, 'the server must survive a malformed path');
  });
});

test('a null byte in the path is refused rather than reaching the filesystem', async () => {
  await withServer(async (port) => {
    const res = await rawRequest(port, 'GET /index.html%00.txt');
    assert.ok([403, 404].includes(res.status), `expected a refusal, got ${res.status}`);
    assert.equal((await fetchPath(port, '/')).status, 200);
  });
});

test('a query string and a fragment are stripped before the file is looked up', async () => {
  await withServer(async (port) => {
    assert.equal((await fetchPath(port, '/index.html?v=2')).status, 200);
    assert.equal((await rawRequest(port, 'GET /index.html#top')).status, 200);
  });
});

// ---------------------------------------------------------------- shutdown

test('closing the server gives the port back', async () => {
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  const { port } = server.address();
  let again = null;
  // Every other test here borrows withServer's finally. This one owns two listeners and cannot,
  // so it carries its own: without it an assertion failure below leaks a listening handle into a
  // run that is already red, and a leaked listener is a second, misleading failure on top of the
  // real one.
  try {
    assert.equal((await fetchPath(port, '/')).status, 200);

    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));

    // Refused rather than hanging: nothing is listening, so the connection is reset at once.
    await assert.rejects(() => fetchPath(port, '/'), (err) => ['ECONNREFUSED', 'ECONNRESET'].includes(err.code));

    // And the port really is free, which is what a developer restarting `npm start` depends on.
    again = createStaticServer();
    await new Promise((resolve, reject) => {
      again.once('error', reject);
      again.listen(port, HOST, resolve);
    });
    assert.equal((await fetchPath(port, '/')).status, 200);
  } finally {
    for (const s of [server, again]) {
      if (!s?.listening) continue;
      s.closeAllConnections();
      await new Promise((resolve) => s.close(resolve));
    }
  }
});
