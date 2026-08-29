import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'packaging', 'windows', 'Package.appxmanifest');
const PACK = join(ROOT, 'scripts', 'pack-msix.mjs');
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
  assert.ok(existsSync(PACK), 'the MSIX packer is missing');
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

test('Start activation names the x64 console shim', () => {
  const source = read(MANIFEST);
  const application = element(source, 'Application');

  assert.equal(attribute(application, 'Id'), 'App');
  assert.equal(attribute(application, 'Executable'), 'RecapPageLauncher.exe');
  assert.equal(attribute(application, 'uap10:RuntimeBehavior'), 'packagedClassicApp');
  assert.equal(attribute(application, 'uap10:TrustLevel'), 'mediumIL');
  assert.equal(attribute(application, 'uap10:Subsystem'), 'console');
  assert.equal(attribute(application, 'uap10:SupportsMultipleInstances'), 'true');
  assert.equal(attribute(application, 'uap10:Parameters'), null);
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

test('the packer owns the explicit update pair and package identity', async () => {
  assert.ok(existsSync(PACK), 'the MSIX packer is missing');
  const packer = await import('../scripts/pack-msix.mjs');

  assert.deepEqual(packer.PACKAGE_VERSIONS, ['2.0.0.0', '2.0.0.1']);
  assert.equal(packer.PACKAGE_NAME, 'PanelStackLabs.RecapPage');
  assert.equal(packer.PACKAGE_FAMILY, 'PanelStackLabs.RecapPage_we33aa8nvkpcc');
  assert.equal(packer.AUMID, 'PanelStackLabs.RecapPage_we33aa8nvkpcc!App');
  assert.equal(packer.LAUNCHER_NAME, 'RecapPageLauncher.exe');
});

test('the MSIX lane reuses the ZIP runtime pin without changing its artifact', () => {
  const source = read(PACK);
  const zip = read(join(ROOT, 'scripts', 'pack-windows.mjs'));

  assert.match(source, /from '\.\/pack-windows\.mjs'/);
  assert.match(source, /\bNODE_VERSION\b/);
  assert.match(source, /\bNODE_ARCH\b/);
  assert.match(source, /\bfetchRuntime\b/);
  assert.match(source, /Framework64/);
  assert.match(source, /Launcher\.cs/);
  assert.match(zip, /marvel-reading-tracker-windows\.zip/);
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
  let verified = false;
  assert.throws(
    () => removePackage(
      'PanelStackLabs.RecapPage',
      'PanelStackLabs.RecapPage_we33aa8nvkpcc',
      {
        runPowerShell: () => {
          throw new Error('removal failed');
        },
        getPackageInfo: () => {
          verified = true;
          return null;
        },
      },
    ),
    (error) => error instanceof AggregateError
      && /removal or absence verification failed/.test(error.message),
  );
  assert.equal(verified, true);
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
