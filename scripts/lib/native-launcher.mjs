import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CREATION_TESTS, creationReceipt, recordDigest, startupSourceInputs, validateCreationReceipt,
} from './startup-contract.mjs';

export const NATIVE_NAME = 'RecapPageLauncher.exe';
export const NATIVE_INPUTS = Object.freeze([
  'packaging/windows/native/Launcher.cpp',
  'packaging/windows/native/Launcher.manifest',
  'packaging/windows/native/Launcher.rc',
  'packaging/windows/native/StartupProcess.h',
  'packaging/windows/native/StartupProtocol.h',
  'scripts/build-native-launcher.ps1',
  'scripts/lib/native-launcher.mjs',
  'src/icons/icon-512.png',
]);
export const PROOF_INPUTS = Object.freeze([
  ...NATIVE_INPUTS,
  'scripts/native-startup-proof.ps1',
  'test/native/Launcher.fixture.mjs.in',
  'test/native/ProofHost.cs',
  'test/native/StartupObserver.h',
  'test/native/StartupTests.cpp',
  'test/native/startup-frames.txt',
  'test/native/StartupContract.h',
  'scripts/lib/startup-contract.mjs',
  'scripts/msix-proof.mjs',
  'scripts/inspect-msix.mjs',
  'test/msix-packaging.test.js',
  'test/server-contract.test.js',
  'test/startup-contract.test.js',
  'test/wack-workflow.test.js',
].sort());
export const NATIVE_TARGETS = Object.freeze([
  Object.freeze({ id: 'x64', machine: 0x8664 }),
  Object.freeze({ id: 'arm64', machine: 0xaa64 }),
]);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NATIVE_ROOT = join(ROOT, 'dist', 'native-launcher');
export const NATIVE_PROOF_ROOT = join(ROOT, 'dist', 'native-proof');
const HEX = /^[0-9a-f]{64}$/;
const SYSTEM_IMPORTS = new Set([
  'kernel32.dll', 'user32.dll', 'gdi32.dll', 'ole32.dll', 'oleaut32.dll',
  'windowscodecs.dll', 'comctl32.dll', 'msimg32.dll', 'advapi32.dll',
  'shell32.dll', 'shlwapi.dll',
]);

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function demand(condition, message) {
  if (!condition) throw new Error(`native launcher: ${message}`);
}

export function nativePe(bytes, target, { proof = false } = {}) {
  const range = (offset, size) => {
    demand(Number.isSafeInteger(offset) && offset >= 0 && size >= 0
      && offset <= bytes.length - size, 'truncated or out-of-bounds PE header');
    return offset;
  };
  const u16 = (offset) => bytes.readUInt16LE(range(offset, 2));
  const u32 = (offset) => bytes.readUInt32LE(range(offset, 4));
  range(0, 64);
  demand(bytes.toString('ascii', 0, 2) === 'MZ', 'missing DOS signature');
  const pe = u32(0x3c);
  range(pe, 24);
  demand(bytes.toString('ascii', pe, pe + 4) === 'PE\0\0', 'missing PE signature');
  const machine = u16(pe + 4);
  const sections = u16(pe + 6);
  const optionalSize = u16(pe + 20);
  const characteristics = u16(pe + 22);
  demand(machine === target.machine, `wrong ${target.id} machine`);
  demand((characteristics & 2) !== 0 && (characteristics & 0x2000) === 0, 'not an executable image or is a DLL');
  const optional = pe + 24;
  range(optional, optionalSize);
  demand(optionalSize >= 112 && u16(optional) === 0x20b, 'not a complete PE32+ image');
  const subsystem = u16(optional + 68);
  demand(subsystem === (proof ? 3 : 2), `wrong ${proof ? 'proof console' : 'GUI'} subsystem`);
  demand(sections <= 96, 'invalid section count');
  const sectionTable = optional + optionalSize;
  range(sectionTable, sections * 40);
  const rvaOffset = (rva) => {
    for (let index = 0; index < sections; index += 1) {
      const section = sectionTable + index * 40;
      const address = u32(section + 12);
      const rawSize = u32(section + 16);
      const delta = rva - address;
      if (delta >= 0 && delta < rawSize) return range(u32(section + 20) + delta, 1);
    }
    throw new Error('native launcher: import RVA is outside file-backed sections');
  };
  const imports = [];
  if (u32(optional + 108) > 1) {
    demand(optionalSize >= 128, 'truncated import directory');
    const importRva = u32(optional + 120);
    if (importRva) {
      let ended = false;
      for (let index = 0; index < 128; index += 1) {
        const descriptor = rvaOffset(importRva + index * 20);
        range(descriptor, 20);
        if ([0, 4, 8, 12, 16].every((offset) => u32(descriptor + offset) === 0)) {
          ended = true;
          break;
        }
        const nameOffset = rvaOffset(u32(descriptor + 12));
        const end = bytes.indexOf(0, nameOffset);
        demand(end > nameOffset && end - nameOffset <= 260, 'invalid imported library name');
        const name = bytes.toString('ascii', nameOffset, end).toLowerCase();
        demand(SYSTEM_IMPORTS.has(name)
          || (proof && ['tdh.dll', 'uiautomationcore.dll', 'kernelbase.dll'].includes(name)),
        `unexpected runtime dependency ${name}`);
        imports.push(name);
      }
      demand(ended, 'unterminated import directory');
    }
  }
  return { machine, subsystem, imports: imports.sort() };
}

export function exactExecutablePayloads(paths) {
  const actual = paths.filter((path) => /\.(?:exe|dll|node)$/i.test(path))
    .map((path) => path.replaceAll('\\', '/').toLowerCase()).sort();
  demand(JSON.stringify(actual) === JSON.stringify(['recappagelauncher.exe', 'runtime/node.exe']),
    `unexpected executable payloads: ${actual.join(', ')}`);
  return actual;
}

function exactKeys(value, keys, role) {
  demand(value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()),
  `invalid ${role} fields`);
}

export function inputDigest(inputs) {
  return sha256(Buffer.from(JSON.stringify(inputs)));
}

export function validateNativeRecord(record, { commit, tree, inputs, outputs, proof = false, productionDigest = null, creationSources }) {
  exactKeys(record, ['schemaVersion', 'commit', 'inputs', 'inputDigest', 'outputs', 'toolchain', 'productionDigest',
    ...(proof ? ['creationReceipt', 'creationReceiptDigest'] : [])], 'build record');
  demand(record.schemaVersion === (proof ? 2 : 1), 'unsupported build record');
  demand(/^[0-9a-f]{40}$/.test(record.commit) && record.commit === commit, 'stale source commit');
  demand(Array.isArray(record.inputs)
    && JSON.stringify(record.inputs) === JSON.stringify(inputs), 'source input bytes or paths differ');
  for (const input of inputs) {
    exactKeys(input, ['path', 'bytes', 'sha256'], 'input');
    demand(Number.isSafeInteger(input.bytes) && input.bytes > 0 && HEX.test(input.sha256), 'invalid input hash or size');
  }
  demand(record.inputDigest === inputDigest(inputs), 'input digest differs');
  demand(record.productionDigest === (proof ? productionDigest : null), 'production artifact binding differs');
  if (proof) validateCreationReceipt(record.creationReceipt, {
    commit, tree, proofInputDigest: record.inputDigest, sources: creationSources,
  });
  if (proof) demand(record.creationReceiptDigest === recordDigest(record.creationReceipt), 'creation receipt digest differs');
  demand(Array.isArray(record.outputs)
    && JSON.stringify(record.outputs) === JSON.stringify(outputs), 'native output bytes, paths or PE policy differ');
  exactKeys(record.toolchain, ['image', 'sdk', 'compilerVersion', 'targets'], 'toolchain');
  demand(record.toolchain.sdk === '10.0.26100.0', 'unexpected Windows SDK');
  demand(typeof record.toolchain.image === 'string' && record.toolchain.image.length <= 200
    && /^[\w .-]*$/.test(record.toolchain.image), 'invalid runner image');
  demand(/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(record.toolchain.compilerVersion), 'invalid compiler version');
  demand(Array.isArray(record.toolchain.targets) && record.toolchain.targets.length === 2, 'incomplete toolchain targets');
  for (const [index, target] of NATIVE_TARGETS.entries()) {
    const tools = record.toolchain.targets[index];
    exactKeys(tools, ['architecture', 'compiler', 'linker', 'resources'], 'toolchain target');
    demand(tools.architecture === target.id
      && [tools.compiler, tools.linker, tools.resources].every((hash) => HEX.test(hash)), 'invalid native tool hashes');
  }
  return record;
}

async function regularBytes(path) {
  const metadata = await lstat(path);
  demand(metadata.isFile() && !metadata.isSymbolicLink(), `not a regular input: ${path}`);
  return readFile(path);
}

function head() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}
function tree() {
  return execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: ROOT, encoding: 'utf8' }).trim();
}
function creationSources(inputs) {
  return [
    ...inputs.filter((input) => CREATION_TESTS.includes(input.path)),
    ...startupSourceInputs(ROOT),
  ];
}

async function sourceInputs(proof) {
  const paths = proof ? PROOF_INPUTS : NATIVE_INPUTS;
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', ...paths], { cwd: ROOT, encoding: 'utf8' });
  const tracked = execFileSync('git', ['ls-files', '-z', '--', ...paths], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean).sort();
  demand(JSON.stringify(tracked) === JSON.stringify([...paths].sort()), 'native inputs must be tracked');
  const inputs = [];
  for (const path of paths) {
    const bytes = await regularBytes(join(ROOT, ...path.split('/')));
    inputs.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return inputs;
}

async function artifactFiles(root, prefix = '') {
  const paths = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    demand(!entry.isSymbolicLink(), 'artifact contains a symbolic link');
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...await artifactFiles(join(root, entry.name), path));
    else paths.push(path);
  }
  return paths.sort();
}

async function outputRecords(root, proof) {
  const name = proof ? 'NativeStartupTests.exe' : NATIVE_NAME;
  const outputs = [];
  for (const target of NATIVE_TARGETS) {
    const path = `${target.id}/${name}`;
    const bytes = await regularBytes(join(root, target.id, name));
    outputs.push({ architecture: target.id, path, bytes: bytes.length, sha256: sha256(bytes), ...nativePe(bytes, target, { proof }) });
  }
  return outputs;
}

export async function verifyNativeArtifact({ proof = false } = {}) {
  const root = proof ? NATIVE_PROOF_ROOT : NATIVE_ROOT;
  const name = proof ? 'NativeStartupTests.exe' : NATIVE_NAME;
  const expected = ['build.json', ...NATIVE_TARGETS.map(({ id }) => `${id}/${name}`)].sort();
  demand(JSON.stringify(await artifactFiles(root)) === JSON.stringify(expected), 'artifact file set differs');
  const recordBytes = await regularBytes(join(root, 'build.json'));
  const expectedDigest = process.env[proof ? 'MRT_NATIVE_PROOF_SHA256' : 'MRT_NATIVE_SHA256'];
  if (expectedDigest) {
    demand(HEX.test(expectedDigest) && sha256(recordBytes) === expectedDigest,
      'artifact differs from the producer job digest');
  }
  const record = JSON.parse(recordBytes.toString('utf8'));
  const production = proof ? await verifyNativeArtifact() : null;
  const inputs = await sourceInputs(proof);
  validateNativeRecord(record, {
    commit: head(), tree: proof ? tree() : undefined, inputs, outputs: await outputRecords(root, proof),
    proof, productionDigest: production?.digest ?? null,
    creationSources: proof ? creationSources(inputs) : undefined,
  });
  return { record, bytes: recordBytes, digest: sha256(recordBytes), root };
}

async function recordBuild(toolchainPath, proof) {
  const toolchain = JSON.parse((await readFile(toolchainPath, 'utf8')).replace(/^\ufeff/u, ''));
  const write = async (isProof, productionDigest) => {
    const root = isProof ? NATIVE_PROOF_ROOT : NATIVE_ROOT;
    const inputs = await sourceInputs(isProof);
    const record = {
      schemaVersion: isProof ? 2 : 1, commit: head(), inputs, inputDigest: inputDigest(inputs),
      outputs: await outputRecords(root, isProof), toolchain, productionDigest,
    };
    if (isProof) {
      const execution = JSON.parse((await readFile(join(dirname(toolchainPath), 'creation-execution.json'), 'utf8')).replace(/^\ufeff/u, ''));
      record.creationReceipt = creationReceipt({
        tap: (await readFile(join(dirname(toolchainPath), 'creation-tests.tap'), 'utf8')).replace(/^\ufeff/u, ''),
        exitCode: execution.exitCode, nodeVersion: execution.nodeVersion,
        commit: record.commit, tree: tree(), proofInputDigest: record.inputDigest, sources: creationSources(inputs),
      });
      record.creationReceiptDigest = recordDigest(record.creationReceipt);
    }
    await writeFile(join(root, 'build.json'), `${JSON.stringify(record, null, 2)}\n`);
    return verifyNativeArtifact({ proof: isProof });
  };
  const production = await write(false, null);
  const proofArtifact = proof ? await write(true, production.digest) : null;
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `native_sha256=${production.digest}\n`
      + (proofArtifact ? `proof_sha256=${proofArtifact.digest}\n` : ''));
  }
  console.log(JSON.stringify({ commit: production.record.commit, native: production.record.outputs }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--verify' && args.length <= 2 && (args.length === 1 || args[1] === '--proof')) {
    const artifact = await verifyNativeArtifact({ proof: args[1] === '--proof' });
    console.log(JSON.stringify({ commit: artifact.record.commit, digest: artifact.digest, outputs: artifact.record.outputs }));
  } else if (args[0] === '--record' && [2, 3].includes(args.length)
    && (args.length === 2 || args[2] === '--proof')) {
    await recordBuild(args[1], args[2] === '--proof');
  } else {
    throw new Error('usage: native-launcher.mjs --verify [--proof] or --record <toolchain.json> [--proof]');
  }
}
