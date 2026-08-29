import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('the package supervisor clears origin-changing environment values case-insensitively', () => {
  for (const blocked of [
    { MRT_PORT: '8788', MRT_NO_OPEN: '1' },
    { mrt_port: '8788', mrt_no_open: '1' },
    { Mrt_Port: '8788', Mrt_No_Open: '1' },
  ]) {
    const working = mkdtempSync(join(tmpdir(), 'recap-page-launcher-test-'));
    try {
      copyFileSync(LAUNCHER, join(working, 'Launcher.mjs'));
      writeFileSync(
        join(working, 'server.mjs'),
        'const blocked = Object.keys(process.env).filter((key) => '
        + '/^(MRT_PORT|MRT_NO_OPEN)$/i.test(key)); '
        + 'console.log(JSON.stringify(blocked)); process.exitCode = 7;\n',
      );
      const result = spawnSync(process.execPath, [join(working, 'Launcher.mjs')], {
        cwd: working,
        encoding: 'utf8',
        env: { ...process.env, ...blocked },
      });

      assert.equal(result.status, 7);
      assert.match(result.stdout, /^\[\]/);
      assert.match(result.stdout, /reading progress is saved in your browser and is not lost/);
      assert.match(result.stdout, /Press any key to close\./);
    } finally {
      rmSync(working, { recursive: true, force: true });
    }
  }
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

  assert.equal(pkg.scripts['msix:pack'], 'node scripts/pack-msix.mjs');
  assert.equal(pkg.scripts['msix:inspect'], 'node scripts/inspect-msix.mjs');
  assert.equal(pkg.scripts['msix:prove'], 'node scripts/msix-proof.mjs');
  assert.deepEqual(proof.SCENARIOS, [
    'start-profile-reader-relaunch',
    'busy-port-refusal',
    'update-state-continuity',
  ]);
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

test('the proof fails when either canonical ready guidance line is absent', async () => {
  const { assertReadyGuidance } = await import('../scripts/msix-proof.mjs');
  assert.doesNotThrow(() => assertReadyGuidance(
    'Recap Page running at http://127.0.0.1:8787/\n'
    + 'Other addresses are separate browser storage.',
  ));
  assert.throws(
    () => assertReadyGuidance('Recap Page running at http://127.0.0.1:8787/'),
    /Other addresses are separate browser storage/,
  );
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

test('package process enumeration retains direct children with unreadable paths', async () => {
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
      runPowerShell: (script) => {
        assert.match(script, /\$_.ParentProcessId -eq \$parent/);
        return JSON.stringify([
          supervisor,
          {
            Name: 'node.exe',
            ProcessId: 42,
            ParentProcessId: supervisor.ProcessId,
            ExecutablePath: null,
            CommandLine: null,
          },
        ]);
      },
    },
  );

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
