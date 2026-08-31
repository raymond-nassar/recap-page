import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LOCAL_SERVER_GENERATION_HEADER_NAME,
  LOCAL_SERVER_HEADER_NAME,
  LOCAL_SERVER_HEADER_VALUE,
  LOCAL_SERVER_HEALTH_PATH,
  LOCAL_SERVER_PROCESS_HEADER_NAME,
} from '../src/js/lib/localServer.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'packaging', 'windows', 'Package.appxmanifest');
const LAUNCHER = join(ROOT, 'packaging', 'windows', 'Launcher.mjs');
const PACK = join(ROOT, 'scripts', 'pack-msix.mjs');
const INSPECT = join(ROOT, 'scripts', 'inspect-msix.mjs');
const PROOF = join(ROOT, 'scripts', 'msix-proof.mjs');

const read = (path) => readFileSync(path, 'utf8');

function element(source, name) {
  return source.match(new RegExp(`<${name}\\b[^>]*>`, 'i'))?.[0] ?? '';
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1] ?? null;
}

test('the maintained MSIX inputs exist outside the browser application', () => {
  assert.ok(existsSync(MANIFEST), 'the package manifest is missing');
  assert.ok(existsSync(LAUNCHER), 'the package launcher is missing');
  assert.ok(existsSync(PACK), 'the MSIX packer is missing');
  assert.ok(existsSync(INSPECT), 'the MSIX inspector is missing');
  assert.ok(existsSync(PROOF), 'the installed proof runner is missing');
  assert.equal(existsSync(join(ROOT, 'src', 'Package.appxmanifest')), false);
});

test('the manifest uses the exact Partner Center identity', () => {
  const source = read(MANIFEST);
  const identity = element(source, 'Identity');
  const properties = source.match(/<Properties>[\s\S]*?<\/Properties>/i)?.[0] ?? '';

  assert.equal(attribute(identity, 'Name'), 'PanelStackLabs.RecapPage');
  assert.equal(attribute(identity, 'Publisher'), 'CN=F6D9045B-46F0-4EAC-9524-4BFC8A75A472');
  assert.equal(attribute(identity, 'Version'), '2.0.0.0');
  assert.equal(attribute(identity, 'ProcessorArchitecture'), 'x64');
  assert.match(properties, /<DisplayName>Recap Page<\/DisplayName>/);
  assert.match(properties, /<PublisherDisplayName>PanelStack Labs<\/PublisherDisplayName>/);
});

test('Start activation uses the architecture-matched Node supervisor', () => {
  const source = read(MANIFEST);
  const application = element(source, 'Application');

  assert.equal(attribute(application, 'Id'), 'App');
  assert.equal(attribute(application, 'Executable'), 'runtime\\node.exe');
  assert.equal(attribute(application, 'uap10:RuntimeBehavior'), 'packagedClassicApp');
  assert.equal(attribute(application, 'uap10:TrustLevel'), 'mediumIL');
  assert.equal(attribute(application, 'uap10:Subsystem'), 'console');
  assert.equal(attribute(application, 'uap10:SupportsMultipleInstances'), 'true');
  assert.equal(
    attribute(application, 'uap10:Parameters'),
    '&quot;$(package.effectivePath)\\Launcher.mjs&quot;',
  );
});

test('the package declares only runFullTrust', () => {
  const source = read(MANIFEST);
  const capabilities = source.match(/<Capabilities>[\s\S]*?<\/Capabilities>/i)?.[0] ?? '';
  const declared = [...capabilities.matchAll(/<[\w]+:Capability\b[^>]*\bName="([^"]+)"/gi)]
    .map((match) => match[1]);

  assert.deepEqual(declared, ['runFullTrust']);
  assert.match(source, /xmlns:rescap="http:\/\/schemas\.microsoft\.com\/appx\/manifest\/foundation\/windows10\/restrictedcapabilities"/);
  assert.match(source, /xmlns:uap10="http:\/\/schemas\.microsoft\.com\/appx\/manifest\/uap\/windows10\/10"/);
});

test('the packer separates the Store bundle from its proof-only update', async () => {
  assert.ok(existsSync(PACK), 'the MSIX packer is missing');
  const packer = await import('../scripts/pack-msix.mjs');

  assert.deepEqual(packer.PACKAGE_VERSIONS, ['2.0.0.0', '2.0.0.1']);
  assert.equal(packer.STORE_PACKAGE_VERSION, '2.0.0.0');
  assert.equal(packer.PROOF_UPDATE_VERSION, '2.0.0.1');
  assert.deepEqual(
    packer.PACKAGE_ARCHITECTURES.map(({ id, node }) => ({ id, node })),
    [
      { id: 'x64', node: 'win-x64' },
      { id: 'arm64', node: 'win-arm64' },
    ],
  );
  assert.equal(packer.PACKAGE_NAME, 'PanelStackLabs.RecapPage');
  assert.equal(packer.PACKAGE_FAMILY, 'PanelStackLabs.RecapPage_we33aa8nvkpcc');
  assert.equal(packer.AUMID, 'PanelStackLabs.RecapPage_we33aa8nvkpcc!App');
  assert.equal(packer.LAUNCHER_NAME, 'Launcher.mjs');
  assert.equal(packer.winAppCliVersion([
    'Windows App Development CLI - Version 0.6.0',
    '0.6.0',
  ].join('\n')), '0.6.0');
  assert.equal(packer.winAppCliVersion('Windows App Development CLI - Version 0.6.0'), null);
  assert.match(packer.packagePath('x64'), /dist[\\/]msix[\\/]RecapPage_2\.0\.0\.0_x64\.msix$/);
  assert.match(packer.packagePath('arm64'), /dist[\\/]msix[\\/]RecapPage_2\.0\.0\.0_arm64\.msix$/);
  assert.match(packer.bundlePath(), /RecapPage_2\.0\.0\.0_x64_arm64\.msixbundle$/);
  assert.match(
    packer.proofPackagePath('2.0.0.1'),
    /dist[\\/]msix-proof[\\/]RecapPage_2\.0\.0\.1_x64\.msix$/,
  );
});

test('the MSIX lane adds ARM64 without changing the ZIP runtime target', () => {
  const source = read(PACK);
  const zip = read(join(ROOT, 'scripts', 'pack-windows.mjs'));

  assert.match(source, /from '\.\/pack-windows\.mjs'/);
  assert.match(source, /\bNODE_VERSION\b/);
  assert.match(source, /\bNODE_ARCH\b/);
  assert.match(source, /\bfetchRuntime\b/);
  assert.match(source, /win-arm64/);
  assert.match(source, /Launcher\.mjs/);
  assert.doesNotMatch(source, /Launcher\.cs|Framework64|platform:x64/);
  assert.match(zip, /const NODE_ARCH = 'win-x64'/);
  assert.match(zip, /marvel-reading-tracker-windows\.zip/);
});

test('the package coordinator clears origin-changing environment values case-insensitively', async () => {
  const { packageEnvironment } = await import('../packaging/windows/Launcher.mjs');
  for (const blocked of [
    { MRT_PORT: '8788', MRT_NO_OPEN: '1' },
    { mrt_port: '8788', mrt_no_open: '1' },
    { Mrt_Port: '8788', Mrt_No_Open: '1' },
  ]) {
    const env = packageEnvironment({ ...blocked, KEEP_ME: 'yes' });
    assert.deepEqual(
      Object.keys(env).filter((key) => /^(MRT_PORT|MRT_NO_OPEN)$/i.test(key)),
      ['MRT_NO_OPEN'],
    );
    assert.equal(env.MRT_NO_OPEN, '1');
    assert.equal(env.KEEP_ME, 'yes');
  }
});

function fakeChild(pid = 41) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.unrefCalls = 0;
  child.killCalls = 0;
  child.unref = () => { child.unrefCalls += 1; };
  child.kill = () => {
    child.killCalls += 1;
    child.exitCode = 1;
    queueMicrotask(() => child.emit('exit', 1));
    return true;
  };
  return child;
}

test('the coordinator starts a hidden detached server with independent stdio', async () => {
  const { spawnServer } = await import('../packaging/windows/Launcher.mjs');
  let call;
  const child = fakeChild();
  const returned = spawnServer('C:\\Package\\server.mjs', {
    root: 'C:\\Package',
    executable: 'C:\\Package\\runtime\\node.exe',
    environment: { MRT_NO_OPEN: '1' },
    spawnImpl: (...args) => {
      call = args;
      return child;
    },
  });

  assert.equal(returned, child);
  assert.deepEqual(call, [
    'C:\\Package\\runtime\\node.exe',
    ['C:\\Package\\server.mjs'],
    {
      cwd: 'C:\\Package',
      detached: true,
      env: { MRT_NO_OPEN: '1' },
      stdio: 'ignore',
      windowsHide: true,
    },
  ]);
});

test('the coordinator accepts only a full package-input generation digest', async () => {
  const { readPackageGeneration } = await import('../packaging/windows/Launcher.mjs');
  const digest = 'a'.repeat(64);
  assert.equal(readPackageGeneration('C:\\Package', () => JSON.stringify({
    packageVersion: '2.0.0.0',
    generation: digest,
  })), digest);
  assert.equal(readPackageGeneration('C:\\Package', () => JSON.stringify({
    packageVersion: '2.0.0.0',
    generation: 'proof-2.0.0.0',
  })), null);
});

test('the coordinator health probe requires identity and exact generation', async () => {
  const { probeServer } = await import('../packaging/windows/Launcher.mjs');
  const response = (status, identity, generation, processId = '41') => ({
    status,
    headers: {
      get(name) {
        if (name === LOCAL_SERVER_HEADER_NAME) return identity;
        if (name === LOCAL_SERVER_GENERATION_HEADER_NAME) return generation;
        if (name === LOCAL_SERVER_PROCESS_HEADER_NAME) return processId;
        return null;
      },
    },
  });
  let requestedUrl;

  assert.deepEqual(
    await probeServer('current-build', {
      fetchImpl: async (url) => {
        requestedUrl = url;
        return response(204, LOCAL_SERVER_HEADER_VALUE, 'current-build');
      },
      verifyProcess: (pid) => pid === 41,
    }),
    { status: 'ready', processId: 41 },
  );
  assert.equal(requestedUrl, `http://127.0.0.1:8787${LOCAL_SERVER_HEALTH_PATH}`);
  assert.deepEqual(
    await probeServer('current-build', {
      fetchImpl: async () => response(
        204,
        LOCAL_SERVER_HEADER_VALUE,
        'older-build',
      ),
      verifyProcess: () => true,
    }),
    { status: 'stale', generation: 'older-build' },
  );
  assert.deepEqual(
    await probeServer('current-build', { fetchImpl: async () => response(204, null, null) }),
    { status: 'foreign' },
  );
  assert.deepEqual(
    await probeServer('current-build', { fetchImpl: async () => { throw new Error('refused'); } }),
    { status: 'unreachable' },
  );
  assert.deepEqual(
    await probeServer('current-build', {
      fetchImpl: async () => response(
        204,
        LOCAL_SERVER_HEADER_VALUE,
        'current-build',
      ),
      verifyProcess: () => false,
    }),
    { status: 'foreign' },
  );
  assert.deepEqual(
    await probeServer('current-build', {
      fetchImpl: async () => response(
        204,
        LOCAL_SERVER_HEADER_VALUE,
        'current-build',
      ),
      verifyProcess: () => null,
    }),
    { status: 'verifying', processId: 41 },
  );
});

test('server ownership requires the listening packaged executable and server command', async () => {
  const { verifyServerProcess } = await import('../packaging/windows/Launcher.mjs');
  let invocation;
  const options = {
    executable: 'C:\\Package\\runtime\\node.exe',
    server: 'C:\\Package\\server.mjs',
  };
  assert.equal(verifyServerProcess(41, {
    ...options,
    execFile: (...args) => {
      invocation = args;
      return JSON.stringify({
        ExecutablePath: 'C:\\Package\\runtime\\node.exe',
        CommandLine: '"C:\\Package\\runtime\\node.exe" C:\\Package\\server.mjs',
      });
    },
  }), true);
  assert.equal(invocation[0], 'powershell');
  assert.match(invocation[1].join(' '), /OwningProcess -eq 41/);
  assert.equal(invocation[2].timeout, 8000);
  assert.equal(verifyServerProcess(41, {
    ...options,
    execFile: () => JSON.stringify({
      ExecutablePath: 'C:\\Other\\node.exe',
      CommandLine: '"C:\\Other\\node.exe" C:\\Package\\server.mjs',
    }),
  }), false);
  assert.equal(verifyServerProcess(41, {
    ...options,
    execFile: () => {
      const error = new Error('PowerShell timed out');
      error.code = 'ETIMEDOUT';
      throw error;
    },
  }), null);
});

test('the coordinator detaches the server and opens only after matching readiness', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  const events = [];
  const child = fakeChild();
  const states = [{ status: 'unreachable' }, { status: 'ready' }];
  const result = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => {
      const state = states.shift() ?? { status: 'ready' };
      events.push(`probe:${state.status}`);
      return state;
    },
    startServer: () => {
      events.push('spawn');
      return child;
    },
    openBrowser: async () => events.push('open'),
    portOccupied: async () => false,
    sleep: async () => {},
  });

  assert.equal(result.status, LAUNCH_RESULT.OPENED);
  assert.deepEqual(events, ['probe:unreachable', 'spawn', 'probe:ready', 'open']);
  assert.equal(child.unrefCalls, 1);
  assert.equal(child.killCalls, 0);
});

test('the coordinator reuses only the matching packaged generation', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  let starts = 0;
  let opens = 0;
  const ready = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => ({ status: 'ready' }),
    startServer: () => { starts += 1; return fakeChild(); },
    openBrowser: async () => { opens += 1; },
  });
  const stale = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => ({ status: 'stale', generation: 'older-build' }),
    startServer: () => { starts += 1; return fakeChild(); },
    openBrowser: async () => { opens += 1; },
  });

  assert.equal(ready.status, LAUNCH_RESULT.OPENED);
  assert.equal(stale.status, LAUNCH_RESULT.FAILED);
  assert.match(stale.lines.join('\n'), /different build of Recap Page/);
  assert.equal(starts, 0);
  assert.equal(opens, 1);
});

test('overlapping coordinators converge without reporting the winning server as foreign', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  let starts = 0;
  let opens = 0;
  const children = [];
  const probe = async () => (starts >= 2 ? { status: 'ready' } : { status: 'unreachable' });
  const startServer = () => {
    starts += 1;
    const child = fakeChild(40 + starts);
    children.push(child);
    return child;
  };
  const options = {
    exists: () => true,
    generation: 'current-build',
    probe,
    startServer,
    openBrowser: async () => { opens += 1; },
    portOccupied: async () => false,
    sleep: async () => Promise.resolve(),
  };

  const results = await Promise.all([coordinateLaunch(options), coordinateLaunch(options)]);
  assert.deepEqual(results.map(({ status }) => status), [LAUNCH_RESULT.OPENED, LAUNCH_RESULT.OPENED]);
  assert.equal(starts, 2);
  assert.equal(opens, 2);
  assert.equal(children.every((child) => child.unrefCalls === 1), true);
  assert.equal(children.every((child) => child.killCalls === 0), true);
});

test('a silent listener receives actionable busy-port guidance without spawning', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  let starts = 0;
  const result = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => ({ status: 'unreachable' }),
    portOccupied: async () => true,
    startServer: () => {
      starts += 1;
      return fakeChild();
    },
  });

  assert.equal(result.status, LAUNCH_RESULT.FAILED);
  assert.equal(starts, 0);
  assert.match(result.lines.join('\n'), /Port 8787 is already in use/);
  assert.match(result.lines.join('\n'), /Do not start Recap Page on a different port/);
});

test('a matching server that binds during the port check is re-probed before refusal', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  let probes = 0;
  let starts = 0;
  let opens = 0;
  const result = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => {
      probes += 1;
      return probes === 1
        ? { status: 'unreachable' }
        : { status: 'ready', processId: 41 };
    },
    portOccupied: async () => true,
    startServer: () => {
      starts += 1;
      return fakeChild();
    },
    openBrowser: async () => {
      opens += 1;
    },
  });

  assert.equal(result.status, LAUNCH_RESULT.OPENED);
  assert.equal(probes, 2);
  assert.equal(starts, 0);
  assert.equal(opens, 1);
});

test('an inconclusive ownership check cannot kill the server just started', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  const child = fakeChild(41);
  const states = [
    { status: 'unreachable' },
    { status: 'verifying', processId: 41 },
  ];
  const result = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => states.shift() ?? { status: 'verifying', processId: 41 },
    portOccupied: async () => false,
    startServer: () => child,
    openBrowser: async () => {},
  });

  assert.equal(result.status, LAUNCH_RESULT.OPENED);
  assert.equal(result.serverProcessId, 41);
  assert.equal(child.killCalls, 0);
});

test('an existing server with inconclusive ownership is retried without being replaced', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  let probes = 0;
  let starts = 0;
  const result = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => {
      probes += 1;
      return probes === 1
        ? { status: 'verifying', processId: 41 }
        : { status: 'ready', processId: 41 };
    },
    startServer: () => {
      starts += 1;
      return fakeChild();
    },
    openBrowser: async () => {},
    sleep: async () => {},
  });

  assert.equal(result.status, LAUNCH_RESULT.OPENED);
  assert.equal(probes, 2);
  assert.equal(starts, 0);
});

test('browser handoff failure keeps the healthy server available with manual guidance', async () => {
  const { coordinateLaunch, LAUNCH_RESULT } = await import('../packaging/windows/Launcher.mjs');
  const result = await coordinateLaunch({
    exists: () => true,
    generation: 'current-build',
    probe: async () => ({ status: 'ready' }),
    openBrowser: async () => { throw new Error('no browser association'); },
  });

  assert.equal(result.status, LAUNCH_RESULT.FAILED);
  assert.equal(result.retainServer, true);
  assert.match(result.lines.join('\n'), /Open http:\/\/127\.0\.0\.1:8787\//);
});

test('the MSIX inspector reads x64 and ARM64 PE machine values', async () => {
  const { peMachine } = await import('../scripts/inspect-msix.mjs');
  for (const expected of [0x8664, 0xaa64]) {
    const bytes = Buffer.alloc(128);
    bytes.write('MZ');
    bytes.writeUInt32LE(64, 0x3c);
    bytes.write('PE\0\0', 64, 'ascii');
    bytes.writeUInt16LE(expected, 68);
    assert.equal(peMachine(bytes), expected);
  }
});

test('the MSIX inspector cannot miss a short-lived runtime exit', async () => {
  const { measureRuntime } = await import('../scripts/inspect-msix.mjs');
  const child = new EventEmitter();
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  const measured = measureRuntime('C:\\Package', 'x64', {
    spawnImpl: () => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('runtime=x64\n'));
        child.exitCode = 0;
        child.emit('exit', 0);
      });
      return child;
    },
  });

  const result = await Promise.race([
    measured,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('runtime inspection missed the child exit')),
      500,
    )),
  ]);
  assert.deepEqual(result, {
    runtime: 'x64',
    output: 'runtime=x64',
  });
});

test('generated package and trust material stay under the ignored output boundary', () => {
  const ignored = read(join(ROOT, '.gitignore'));
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);

  assert.match(ignored, /^dist\/$/m);
  assert.deepEqual(tracked.filter((path) => path.startsWith('dist/')), []);
  assert.deepEqual(tracked.filter((path) => /\.(?:pfx|cer|msix|msixbundle)$/i.test(path)), []);
});

test('package scripts expose build and independently invocable proof scenarios', async () => {
  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  const proof = await import('../scripts/msix-proof.mjs');
  const houseOfM = JSON.parse(read(join(ROOT, 'src', 'data', 'catalog.json'))).lists
    .find((list) => list.id === 'house-of-m');

  assert.equal(pkg.scripts['msix:pack'], 'node scripts/pack-msix.mjs');
  assert.equal(pkg.scripts['msix:inspect'], 'node scripts/inspect-msix.mjs');
  assert.equal(pkg.scripts['msix:prove'], 'node scripts/msix-proof.mjs');
  assert.deepEqual(proof.SCENARIOS, [
    'certification-functionality',
    'busy-port-refusal',
    'update-state-continuity',
  ]);
  assert.match(read(PROOF), /const CATALOG_ROUTE = '#\/catalog'/);
  assert.match(read(PROOF), /const CATALOG_RESULTS = '#catalog-results'/);
  assert.equal(houseOfM?.type, 'event');
  assert.doesNotMatch(read(PROOF), /#\/storylines/);
  assert.equal(
    [...read(PROOF).matchAll(/waitForCatalogCard\(page, 'House of M'\)/g)].length,
    2,
  );
});

test('busy-port proof captures the installed supervisor without Windows Terminal', async () => {
  const { startInstalledLauncher } = await import('../scripts/msix-proof.mjs');
  const installLocation = 'C:\\Program Files\\WindowsApps\\RecapPage';
  const child = fakeChild(73);
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let invocation;
  const launched = startInstalledLauncher(
    { InstallLocation: installLocation },
    {
      environment: { PATH: 'C:\\Windows' },
      spawnImpl: (...args) => {
        invocation = args;
        return child;
      },
    },
  );
  child.stderr.emit('data', Buffer.from('Port 8787 is already in use.\n'));

  assert.deepEqual(invocation, [
    join(installLocation, 'runtime', 'node.exe'),
    [join(installLocation, 'Launcher.mjs')],
    {
      cwd: installLocation,
      env: { PATH: 'C:\\Windows' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  ]);
  assert.equal(launched.child, child);
  assert.equal(launched.output.join(''), 'Port 8787 is already in use.\n');
  assert.equal(launched.error(), null);
});

test('certification proof selects the process that actually owns port 8787', async () => {
  const { selectListenerServer } = await import('../scripts/msix-proof.mjs');
  const losingServer = {
    ProcessId: 81,
    CommandLine: '"node.exe" "C:\\Package\\server.mjs"',
  };
  const listener = {
    ProcessId: 82,
    CommandLine: '"node.exe" "C:\\Package\\server.mjs"',
  };

  assert.equal(selectListenerServer([losingServer, listener], 82), listener);
  assert.equal(selectListenerServer([losingServer, listener], 83), null);
  assert.throws(
    () => selectListenerServer([{ ProcessId: 82, CommandLine: '"node.exe" "Launcher.mjs"' }], 82),
    /did not run the package server/,
  );
});

test('proof cleanup force-stops only its exact recorded process IDs', async () => {
  const { stopPids } = await import('../scripts/msix-proof.mjs');
  const scripts = [];
  stopPids([41, 41, 0, null], (script) => {
    scripts.push(script);
    return '';
  });

  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /Get-Process -Id 41/);
  assert.match(scripts[0], /Stop-Process -Id 41 -Force -ErrorAction Stop/);
  assert.match(scripts[0], /\$p\.WaitForExit\(10000\)/);
  assert.doesNotMatch(scripts[0], /if \(Get-Process -Id 41.*remains after stop/);
  assert.doesNotMatch(scripts[0], /Stop-Process -Name|taskkill/);
});

test('the proof refuses a foreign package identity before invoking PowerShell', async () => {
  const { removePackage } = await import('../scripts/msix-proof.mjs');
  let calls = 0;
  assert.throws(
    () => removePackage('Foreign.Package', 'Foreign.Package_family', {
      runPowerShell: () => { calls += 1; },
      getPackageInfo: () => { calls += 1; },
    }),
    /outside the exact Recap Page identity/,
  );
  assert.equal(calls, 0);
});

test('package removal fails if the exact identity remains registered', async () => {
  const { removePackage } = await import('../scripts/msix-proof.mjs');
  const remaining = {
    Name: 'PanelStackLabs.RecapPage',
    PackageFamilyName: 'PanelStackLabs.RecapPage_we33aa8nvkpcc',
    PackageFullName: 'PanelStackLabs.RecapPage_2.0.0.1_x64__we33aa8nvkpcc',
  };
  let removalCalls = 0;
  assert.throws(
    () => removePackage(remaining.Name, remaining.PackageFamilyName, {
      runPowerShell: () => {
        removalCalls += 1;
        return '';
      },
      getPackageInfo: () => remaining,
    }),
    (error) => error instanceof AggregateError
      && error.errors.some((failure) => /package identity remains registered/.test(failure.message)),
  );
  assert.equal(removalCalls, 1);
});

test('package absence is verified even when the removal command fails', async () => {
  const { removePackage } = await import('../scripts/msix-proof.mjs');
  const calls = [];
  assert.throws(
    () => removePackage(
      'PanelStackLabs.RecapPage',
      'PanelStackLabs.RecapPage_we33aa8nvkpcc',
      {
        runPowerShell: () => {
          calls.push('remove');
          throw new Error('removal failed');
        },
        getPackageInfo: () => {
          calls.push('verify');
          return null;
        },
      },
    ),
    (error) => error instanceof AggregateError
      && /removal or absence verification failed/.test(error.message),
  );
  assert.deepEqual(calls, ['remove', 'verify']);
});

test('aggregate proof failures retain every scenario and cleanup cause', async () => {
  const { formatProofError } = await import('../scripts/msix-proof.mjs');
  const error = new AggregateError(
    [
      new Error('scenario failed'),
      new AggregateError([new Error('cleanup failed')], 'cleanup aggregate'),
    ],
    'scenario and cleanup failed',
  );

  const output = formatProofError(error);
  assert.match(output, /scenario and cleanup failed/);
  assert.match(output, /scenario failed/);
  assert.match(output, /cleanup aggregate/);
  assert.match(output, /cleanup failed/);
});

test('the proof distinguishes the Node supervisor from its server child', async () => {
  const { waitForProcess } = await import('../scripts/msix-proof.mjs');
  const processes = [
    { Name: 'node.exe', ProcessId: 41, CommandLine: 'node.exe Launcher.mjs' },
    { Name: 'node.exe', ProcessId: 42, CommandLine: 'node.exe server.mjs' },
  ];
  const original = await waitForProcess(
    { InstallLocation: 'C:\\Program Files\\WindowsApps\\RecapPage' },
    new Date(0),
    'node.exe',
    'Launcher.mjs',
    () => processes,
  );
  assert.equal(original.ProcessId, 41);
});

test('busy-port exit uses supervisor-child ownership when CommandLine is unreadable', async () => {
  const { serverChildExited } = await import('../scripts/msix-proof.mjs');
  const supervisor = {
    Name: 'node.exe',
    ProcessId: 41,
    ParentProcessId: 7,
    ExecutablePath: 'C:\\Program Files\\WindowsApps\\RecapPage\\runtime\\node.exe',
    CommandLine: 'node.exe Launcher.mjs',
  };
  const child = {
    Name: 'NODE.EXE',
    ProcessId: 42,
    ParentProcessId: 41,
    ExecutablePath: supervisor.ExecutablePath.toUpperCase(),
    CommandLine: null,
  };

  assert.equal(serverChildExited([supervisor, child], supervisor), false);
  assert.equal(serverChildExited([supervisor], supervisor), true);
});

test('busy-port exit fails closed when package process ownership metadata is missing', async () => {
  const { serverChildExited } = await import('../scripts/msix-proof.mjs');
  const supervisor = {
    Name: 'node.exe',
    ProcessId: 41,
    ParentProcessId: 7,
    ExecutablePath: 'C:\\Program Files\\WindowsApps\\RecapPage\\runtime\\node.exe',
  };
  const unknown = {
    Name: 'node.exe',
    ProcessId: 42,
    ParentProcessId: null,
    ExecutablePath: supervisor.ExecutablePath,
    CommandLine: null,
  };

  assert.equal(serverChildExited([supervisor, unknown], supervisor), false);
});

test('package process enumeration applies package-root or direct-child retention behavior', async () => {
  const { packageProcesses, serverChildExited } = await import('../scripts/msix-proof.mjs');
  const supervisor = {
    Name: 'node.exe',
    ProcessId: 41,
    ParentProcessId: 7,
    ExecutablePath: 'C:\\Program Files\\WindowsApps\\RecapPage\\runtime\\node.exe',
  };
  const processes = packageProcesses(
    { InstallLocation: 'C:\\Program Files\\WindowsApps\\RecapPage' },
    new Date(0),
    {
      parentProcessId: supervisor.ProcessId,
      runPowerShell: () => JSON.stringify([
        supervisor,
        {
          Name: 'node.exe',
          ProcessId: 42,
          ParentProcessId: supervisor.ProcessId,
          ExecutablePath: null,
          CommandLine: null,
        },
        {
          Name: 'unrelated.exe',
          ProcessId: 43,
          ParentProcessId: 9,
          ExecutablePath: null,
          CommandLine: null,
        },
        {
          Name: 'helper.exe',
          ProcessId: 44,
          ParentProcessId: 9,
          ExecutablePath: 'C:\\Program Files\\WindowsApps\\RecapPage\\helper.exe',
          CommandLine: null,
        },
      ]),
    },
  );

  assert.deepEqual(processes.map(({ ProcessId }) => ProcessId), [41, 42, 44]);
  assert.equal(serverChildExited(processes, supervisor), false);
});

test('cleanup still attempts package removal when process enumeration fails', async () => {
  const { cleanupPackage } = await import('../scripts/msix-proof.mjs');
  const calls = [];
  assert.throws(
    () => cleanupPackage({
      installed: { InstallLocation: 'C:\\Program Files\\WindowsApps\\RecapPage' },
      since: new Date(0),
      owned: [41],
    }, {
      listProcesses: () => {
        calls.push('enumerate');
        throw new Error('enumeration failed');
      },
      stopProcesses: () => calls.push('stop'),
      removeOwnedPackage: () => calls.push('remove'),
    }),
    (error) => error instanceof AggregateError && /cleanup did not complete/.test(error.message),
  );
  assert.deepEqual(calls, ['enumerate', 'stop', 'remove']);
});

test('Windows packaging adds no browser runtime dependency', () => {
  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.equal(Object.keys(pkg.devDependencies ?? {}).some((name) => /winapp|msix|package.?support/i.test(name)), false);
});
