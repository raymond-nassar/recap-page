import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const CLAIM = 'app-startup-contract-v2';
export const RECORD_LIMIT = 16384;
export const CREATION_TESTS = Object.freeze([
  'test/msix-packaging.test.js', 'test/server-contract.test.js', 'test/startup-contract.test.js',
]);
export const STARTUP_FILES = Object.freeze([
  'AppxManifest.xml', 'RecapPageLauncher.exe', 'runtime/node.exe', 'Launcher.mjs',
  'server.mjs', 'src/js/lib/coverHost.js', 'src/js/lib/localServer.js',
  'native-build.json', 'src/msix-generation.json',
]);
export const SOURCE_FILES = Object.freeze([
  ['Launcher.mjs', 'packaging/windows/Launcher.mjs'],
  ['server.mjs', 'server.mjs'],
  ['src/js/lib/coverHost.js', 'src/js/lib/coverHost.js'],
  ['src/js/lib/localServer.js', 'src/js/lib/localServer.js'],
]);
export const REASONS = Object.freeze([
  'none', 'input-missing', 'input-mismatch', 'host-unqualified', 'host-changed',
  'creation-receipt-missing', 'creation-receipt-stale', 'actor-missing', 'actor-ambiguous',
  'actor-wrong-input', 'actor-unexpected', 'app-terminal-visible',
  'app-console-association-incomplete', 'capture-incomplete', 'behavior-mismatch',
  'report-invalid', 'resource-cleanup-failed', 'profile-invalid', 'result-binding-mismatch',
]);
const PROFILES = ['native-inert', 'installed-functionality', 'installed-busy'];
const HEX = /^[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const ID = /^[0-9a-f]{32}$/;
const STATES = ['satisfied', 'violated', 'unknown'];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGE_NAME = 'PanelStackLabs.RecapPage';
const PUBLISHER = 'CN=F6D9045B-46F0-4EAC-9524-4BFC8A75A472';

export class StartupContractError extends Error {
  constructor(reason, state = 'violated') {
    super(`startup contract: ${reason}`);
    this.reason = reason;
    this.state = state;
  }
}
function requireFact(value, reason = 'input-mismatch') {
  if (!value) throw new StartupContractError(reason);
}
export const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const recordDigest = (value) => hashBytes(Buffer.from(JSON.stringify(value)));
export function exactKeys(value, keys, reason = 'report-invalid') {
  requireFact(value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), reason);
}
export function sourceRevision() {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  return { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']) };
}
function pathKey(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}
export function boundedFile(root, path, expectedBytes = null) {
  requireFact(typeof path === 'string' && !isAbsolute(path) && !path.split(/[\\/]/).includes('..'));
  let fd;
  try {
    const canonicalRoot = realpathSync(root);
    const target = join(root, ...path.split('/'));
    let component = root;
    for (const part of path.split('/')) {
      component = join(component, part);
      requireFact(!lstatSync(component).isSymbolicLink());
    }
    const actual = realpathSync(target);
    const nested = relative(pathKey(canonicalRoot), pathKey(actual));
    requireFact(nested && !isAbsolute(nested) && nested !== '..' && !nested.startsWith(`..${sep}`));
    fd = openSync(target, 'r');
    const before = fstatSync(fd, { bigint: true });
    const size = Number(before.size);
    requireFact(before.isFile() && Number.isSafeInteger(size) && size >= 0 && size <= 160 * 1024 * 1024);
    requireFact(expectedBytes === null || size === expectedBytes);
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(65536);
    let remaining = size;
    while (remaining) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, remaining), null);
      requireFact(count > 0);
      hash.update(buffer.subarray(0, count));
      remaining -= count;
    }
    requireFact(readSync(fd, buffer, 0, 1, null) === 0);
    const after = fstatSync(fd, { bigint: true });
    requireFact(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every((key) => before[key] === after[key]));
    requireFact(pathKey(realpathSync(target)) === pathKey(actual));
    return { path, bytes: size, sha256: hash.digest('hex') };
  } catch (error) {
    if (error instanceof StartupContractError) throw error;
    throw new StartupContractError('input-missing', 'unknown');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function startupSourceInputs(root = ROOT) {
  const { Linter } = createRequire(import.meta.url)('eslint');
  const linter = new Linter();
  const inputs = SOURCE_FILES.map(([path, source]) => ({ ...boundedFile(root, source), path }));
  for (const [path, source] of SOURCE_FILES) {
    const text = readFileSync(join(root, ...source.split('/')), 'utf8');
    const imports = [];
    const dynamic = [];
    let requires = false;
    const declaration = (node) => {
      if (node.source) imports.push(node.source.value);
    };
    const messages = linter.verify(text, {
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      plugins: {
        startup: {
          rules: {
            dependencies: {
              meta: { schema: [] },
              create: () => ({
                ImportDeclaration: declaration,
                ExportNamedDeclaration: declaration,
                ExportAllDeclaration: declaration,
                ImportExpression(node) {
                  dynamic.push(node.source.type === 'Literal' && typeof node.source.value === 'string'
                    ? node.source.value : null);
                },
                CallExpression({ callee }) {
                  if ((callee.type === 'Identifier' && callee.name === 'require') ||
                      (callee.type === 'MemberExpression' &&
                        (callee.computed ? callee.property.value === 'require' : callee.property.name === 'require'))) {
                    requires = true;
                  }
                },
              }),
            },
          },
        },
      },
      rules: { 'startup/dependencies': 'error' },
    }, { filename: 'startup-source.mjs', allowInlineConfig: false });
    requireFact(messages.length === 0 && !requires);
    const local = imports.filter((name) => !name.startsWith('node:'));
    requireFact(JSON.stringify(local.sort()) === JSON.stringify(path === 'server.mjs'
      ? ['./src/js/lib/coverHost.js', './src/js/lib/localServer.js'] : []));
    requireFact(dynamic.every((name) => path === 'server.mjs' && name === 'node:child_process'));
  }
  return inputs;
}
export function validateActivationManifest(text, architecture, version) {
  requireFact(typeof text === 'string' && Buffer.byteLength(text) <= 65536 && !/<!DOCTYPE|<!ENTITY/i.test(text));
  const attributes = (name) => {
    const tags = [...text.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'g'))];
    requireFact(tags.length === 1);
    const values = {};
    for (const [, key, value] of tags[0][1].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
      requireFact(!Object.hasOwn(values, key));
      values[key] = value;
    }
    return values;
  };
  const identity = attributes('Identity');
  requireFact(identity.Name === PACKAGE_NAME && identity.Publisher === PUBLISHER
    && identity.ProcessorArchitecture === architecture && identity.Version === version);
  const app = attributes('Application');
  requireFact(app.Id === 'App' && app.Executable === 'RecapPageLauncher.exe'
    && !Object.hasOwn(app, 'uap10:Parameters') && app['uap10:Subsystem'] === 'windows'
    && app['uap10:RuntimeBehavior'] === 'packagedClassicApp' && app['uap10:TrustLevel'] === 'mediumIL'
    && app['uap10:SupportsMultipleInstances'] === 'true');
  requireFact(attributes('TargetDeviceFamily').MinVersion === '10.0.19041.0');
  const capabilities = [...text.matchAll(/<(?:[\w]+:)?(?:Capability|DeviceCapability)\b[^>]*>/g)];
  requireFact(capabilities.length === 1);
  const capability = attributes('rescap:Capability');
  exactKeys(capability, ['Name'], 'input-mismatch');
  requireFact(capability.Name === 'runFullTrust');
  return { name: PACKAGE_NAME, publisher: PUBLISHER, version, architecture, application: 'App' };
}
function validateFileMap(files) {
  requireFact(Array.isArray(files) && files.length === STARTUP_FILES.length);
  requireFact(JSON.stringify(files.map((file) => file.path)) === JSON.stringify(STARTUP_FILES));
  for (const file of files) {
    exactKeys(file, ['path', 'bytes', 'sha256'], 'input-mismatch');
    requireFact(Number.isSafeInteger(file.bytes) && file.bytes > 0 && HEX.test(file.sha256));
  }
}
export function buildStartupVariant({ layout, architecture, version, native, nodeHash, sourceInputs }) {
  const files = STARTUP_FILES.map((path) => boundedFile(layout, path));
  validateFileMap(files);
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const expected of sourceInputs) {
    const actual = byPath.get(expected.path);
    requireFact(actual?.sha256 === expected.sha256 && actual.bytes === expected.bytes);
  }
  requireFact(byPath.get('runtime/node.exe').sha256 === nodeHash);
  const output = native.record.outputs.find((item) => item.architecture === architecture);
  requireFact(output && byPath.get('RecapPageLauncher.exe').sha256 === output.sha256
    && byPath.get('native-build.json').sha256 === native.digest);
  const identity = validateActivationManifest(readFileSync(join(layout, 'AppxManifest.xml'), 'utf8'), architecture, version);
  const generation = JSON.parse(readFileSync(join(layout, 'src', 'msix-generation.json'), 'utf8'));
  exactKeys(generation, ['packageVersion', 'generation'], 'input-mismatch');
  requireFact(generation.packageVersion === version && HEX.test(generation.generation));
  return { identity, files, generation };
}
export function validateExpectations(value, { commit, tree, nativeDigest, sourceInputs }) {
  exactKeys(value, ['schemaVersion', 'commit', 'tree', 'nativeDigest', 'sourceInputs', 'variants', 'packages']);
  requireFact(value.schemaVersion === 2 && SHA.test(commit) && SHA.test(tree)
    && value.commit === commit && value.tree === tree && value.nativeDigest === nativeDigest);
  requireFact(JSON.stringify(value.sourceInputs) === JSON.stringify(sourceInputs));
  requireFact(Array.isArray(value.variants) && value.variants.length === 3);
  const variants = new Set();
  for (const variant of value.variants) {
    exactKeys(variant, ['identity', 'files', 'generation'], 'input-mismatch');
    exactKeys(variant.identity, ['name', 'publisher', 'version', 'architecture', 'application'], 'input-mismatch');
    const { identity } = variant;
    requireFact(identity.name === PACKAGE_NAME && identity.publisher === PUBLISHER && identity.application === 'App'
      && ['x64', 'arm64'].includes(identity.architecture) && /^\d+\.\d+\.\d+\.[01]$/.test(identity.version));
    requireFact(!variants.has(`${identity.version}:${identity.architecture}`));
    variants.add(`${identity.version}:${identity.architecture}`);
    validateFileMap(variant.files);
    exactKeys(variant.generation, ['packageVersion', 'generation'], 'input-mismatch');
    requireFact(variant.generation.packageVersion === identity.version && HEX.test(variant.generation.generation));
  }
  requireFact(Array.isArray(value.packages) && value.packages.length === 4);
  for (const item of value.packages) {
    exactKeys(item, ['version', 'architecture', 'source', 'sha256'], 'input-mismatch');
    requireFact(['package', 'bundle'].includes(item.source) && HEX.test(item.sha256));
    requireFact(item.source === 'bundle' ? item.architecture === 'bundle'
      : variants.has(`${item.version}:${item.architecture}`));
  }
  requireFact(new Set(value.packages.map((p) => `${p.version}:${p.architecture}:${p.source}`)).size === 4);
  requireFact(value.variants.filter((v) => v.identity.version.endsWith('.0')).length === 2
    && value.variants.some((v) => v.identity.architecture === 'x64' && v.identity.version.endsWith('.1')));
  return value;
}
export function bindInstalledInputs(root, variant) {
  validateFileMap(variant.files);
  for (const expected of variant.files) {
    const actual = boundedFile(root, expected.path, expected.bytes);
    requireFact(actual.sha256 === expected.sha256);
  }
  validateActivationManifest(readFileSync(join(root, 'AppxManifest.xml'), 'utf8'),
    variant.identity.architecture, variant.identity.version);
  return { state: 'satisfied', digest: recordDigest(variant), files: STARTUP_FILES.length };
}
export function selectDeployment(expectations, version, architecture, source, packageFile) {
  const variant = expectations.variants.find((entry) => entry.identity.version === version
    && entry.identity.architecture === architecture);
  const packaged = expectations.packages.find((entry) => entry.version === version
    && entry.architecture === (source === 'bundle' ? 'bundle' : architecture) && entry.source === source);
  requireFact(variant && packaged);
  requireFact(boundedFile(dirname(packageFile), relative(dirname(packageFile), packageFile)).sha256 === packaged.sha256);
  return { variant, packageDigest: packaged.sha256, source };
}

export function creationReceipt({ tap, exitCode, nodeVersion, commit, tree, proofInputDigest, sources }) {
  const count = (name) => {
    const matches = [...tap.replace(/\r\n/g, '\n').matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
    requireFact(matches.length === 1, 'creation-receipt-missing');
    return Number(matches[0][1]);
  };
  requireFact(exitCode === 0 && count('tests') === 93 && count('pass') === 93
    && ['fail', 'cancelled', 'skipped', 'todo'].every((name) => count(name) === 0), 'creation-receipt-missing');
  const receipt = {
    schemaVersion: 1, command: 'production-creation-tests-v2', tests: 93, passed: 93, failed: 0,
    cancelled: 0, skipped: 0, todo: 0, exitCode, nodeVersion, commit, tree, proofInputDigest, sources,
  };
  return validateCreationReceipt(receipt, { commit, tree, proofInputDigest, sources });
}
export function validateCreationReceipt(value, expected) {
  exactKeys(value, ['schemaVersion', 'command', 'tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo',
    'exitCode', 'nodeVersion', 'commit', 'tree', 'proofInputDigest', 'sources'], 'creation-receipt-missing');
  requireFact(value.schemaVersion === 1 && value.command === 'production-creation-tests-v2'
    && value.tests === 93 && value.passed === 93 && value.exitCode === 0
    && ['failed', 'cancelled', 'skipped', 'todo'].every((key) => value[key] === 0)
    && /^v24\.\d+\.\d+$/.test(value.nodeVersion), 'creation-receipt-missing');
  requireFact(SHA.test(value.commit) && SHA.test(value.tree) && HEX.test(value.proofInputDigest)
    && value.commit === expected.commit && value.tree === expected.tree
    && value.proofInputDigest === expected.proofInputDigest
    && JSON.stringify(value.sources) === JSON.stringify(expected.sources), 'creation-receipt-stale');
  return value;
}

export function captureBindings(proof, architecture, startupInputsDigest, deployment, captureId = randomBytes(16).toString('hex')) {
  return {
    commit: proof.record.commit, tree: proof.record.creationReceipt.tree, captureId, architecture,
    proofInputDigest: proof.record.inputDigest, creationReceiptDigest: recordDigest(proof.record.creationReceipt),
    startupInputsDigest, deployment,
  };
}
function validBindings(value) {
  exactKeys(value, ['commit', 'tree', 'captureId', 'architecture', 'proofInputDigest', 'creationReceiptDigest',
    'startupInputsDigest', 'deployment']);
  requireFact(SHA.test(value.commit) && SHA.test(value.tree) && ID.test(value.captureId)
    && ['x64', 'arm64'].includes(value.architecture)
    && ['proofInputDigest', 'creationReceiptDigest', 'startupInputsDigest'].every((key) => HEX.test(value[key]))
    && value.deployment && typeof value.deployment === 'object', 'result-binding-mismatch');
}
export function captureRequest(bindings, context) {
  validBindings(bindings);
  requireFact([...PROFILES, 'preflight', 'N2', 'N3', 'LC-001'].includes(context), 'profile-invalid');
  return ['RCPAPP2', context, bindings.captureId, bindings.commit, bindings.tree, bindings.architecture,
    bindings.proofInputDigest, bindings.creationReceiptDigest, bindings.startupInputsDigest].join('\n') + '\n';
}
const CAPTURE_FIELDS = [
  'profile', 'captureId', 'commit', 'tree', 'architecture', 'proofInputDigest', 'creationReceiptDigest', 'startupInputsDigest',
  'hostState', 'hostReason', 'actorState', 'actorReason', 'captureState', 'captureReason',
  'roots', 'coordinators', 'verifiers', 'servers', 'commands', 'visible', 'unresolved', 'rawUnknown', 'unassessed', 'externalRequests',
];
export function qualifiedHostSamples(samples) {
  requireFact(Array.isArray(samples) && samples.length === 4, 'host-unqualified');
  const slots = new Set();
  let qualified = true;
  for (const sample of samples) {
    exactKeys(sample, ['phase', 'slot', 'registryView', 'open', 'query', 'type', 'bytes', 'literalEmpty',
      'registryClosed', 'helperKnown', 'helperMachine', 'helperError'], 'host-unqualified');
    requireFact(['begin', 'end'].includes(sample.phase) && /^[01]$/.test(sample.slot)
      && !slots.has(`${sample.phase}:${sample.slot}`), 'host-unqualified');
    slots.add(`${sample.phase}:${sample.slot}`);
    requireFact(['open', 'query', 'type', 'bytes', 'helperMachine', 'helperError'].every((key) => /^\d{1,10}$/.test(sample[key]))
      && ['literalEmpty', 'registryClosed', 'helperKnown'].every((key) => /^[01]$/.test(sample[key])), 'host-unqualified');
    const absent = sample.open === '2' || (sample.open === '0' && sample.query === '2');
    const empty = sample.open === '0' && sample.query === '0' && ['1', '2'].includes(sample.type)
      && ['0', '2'].includes(sample.bytes) && sample.literalEmpty === '1';
    qualified = qualified && sample.registryView === 'native64' && (absent || empty)
      && sample.registryClosed === '1' && sample.helperKnown === '1' && sample.helperError === '0'
      && ['34404', '43620', '42561'].includes(sample.helperMachine);
  }
  return qualified;
}
export function parseCaptureReport(text, bindings, profile) {
  validBindings(bindings);
  requireFact(PROFILES.includes(profile), 'profile-invalid');
  requireFact(typeof text === 'string' && Buffer.byteLength(text) <= 1024 * 1024, 'report-invalid');
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  requireFact(lines.length <= 4096 && lines.every((line) => line.length <= 4096
    && !/[^\x20-\x7e]|[\\/:<>]/.test(line)
    && /^(CHECK (?:ENTER|EXIT|FAIL|INFO) |HANDLE |DIAG |PASS |FAIL |selected-font=|dpi-message-cases=)/.test(line)), 'report-invalid');
  const terminal = lines.filter((line) => line.startsWith('DIAG app-capture-v2'));
  requireFact(terminal.length === 1, 'report-invalid');
  const fields = terminal[0].split(' ').slice(2);
  requireFact(fields.length === CAPTURE_FIELDS.length, 'report-invalid');
  const result = {};
  for (let index = 0; index < fields.length; index += 1) {
    const [key, value, extra] = fields[index].split('=');
    requireFact(key === CAPTURE_FIELDS[index] && value && extra === undefined, 'report-invalid');
    result[key] = value;
  }
  requireFact(result.profile === profile, 'profile-invalid');
  for (const key of ['captureId', 'commit', 'tree', 'architecture', 'proofInputDigest', 'creationReceiptDigest', 'startupInputsDigest']) {
    requireFact(result[key] === bindings[key], 'result-binding-mismatch');
  }
  for (const prefix of ['host', 'actor', 'capture']) {
    requireFact(STATES.includes(result[`${prefix}State`]) && REASONS.includes(result[`${prefix}Reason`]), 'report-invalid');
    requireFact((result[`${prefix}State`] === 'satisfied') === (result[`${prefix}Reason`] === 'none'), 'report-invalid');
  }
  const hostSamples = lines.filter((line) => line.startsWith('DIAG host-sample ')).map((line) => {
    const pairs = line.split(' ').slice(2).map((part) => part.split('='));
    requireFact(pairs.every((pair) => pair.length === 2) && new Set(pairs.map(([key]) => key)).size === pairs.length, 'host-unqualified');
    return Object.fromEntries(pairs);
  });
  if (result.hostState === 'satisfied') requireFact(qualifiedHostSamples(hostSamples), 'host-unqualified');
  for (const key of CAPTURE_FIELDS.slice(14)) {
    requireFact(/^(0|[1-9]\d{0,5})$/.test(result[key]) && Number(result[key]) <= 65536, 'report-invalid');
    result[key] = Number(result[key]);
  }
  requireFact(!result.visible || (result.captureState === 'violated' && result.captureReason === 'app-terminal-visible'), 'report-invalid');
  requireFact(!result.unresolved || result.captureState !== 'satisfied', 'report-invalid');
  return result;
}
export function premise(state, reason, evidenceBinding) {
  return { state, evaluated: true, reason, evidenceBinding };
}
export function reduceStartupContract(input) {
  exactKeys(input, ['schemaVersion', 'claim', 'profile', 'bindings', 'premises', 'actors', 'terminals',
    'behavior', 'cleanup', 'unassessedGlobal', 'executionFailures']);
  requireFact(input.schemaVersion === 2 && input.claim === CLAIM && PROFILES.includes(input.profile), 'profile-invalid');
  validBindings(input.bindings);
  exactKeys(input.premises, ['I', 'H', 'O', 'A', 'C', 'B', 'R']);
  exactKeys(input.cleanup, ['scope', 'completed', 'reportValid', 'closingInputs']);
  requireFact(input.cleanup.scope === 'capture'
    && ['completed', 'reportValid', 'closingInputs'].every((key) => typeof input.cleanup[key] === 'boolean'));
  requireFact(Array.isArray(input.executionFailures) && input.executionFailures.length <= 32);
  exactKeys(input.actors, ['roots', 'coordinators', 'verifiers', 'servers', 'commands']);
  exactKeys(input.terminals, ['visible', 'unresolved']);
  exactKeys(input.behavior, ['completed']);
  exactKeys(input.unassessedGlobal, ['records', 'unknownMetadata', 'externalRequests']);
  requireFact(typeof input.behavior.completed === 'boolean'
    && [input.actors, input.terminals, input.unassessedGlobal].every((values) => Object.values(values)
      .every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 65536)));
  for (const entry of input.executionFailures) requireFact(typeof entry === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(entry));
  for (const key of ['I', 'H', 'O', 'A', 'C', 'B', 'R']) {
    const value = input.premises[key];
    exactKeys(value, ['state', 'evaluated', 'reason', 'evidenceBinding']);
    requireFact(STATES.includes(value.state) && typeof value.evaluated === 'boolean' && REASONS.includes(value.reason));
    requireFact(value.state !== 'satisfied' || (value.evaluated && value.reason === 'none'));
    const expected = key === 'I' ? input.bindings.startupInputsDigest
      : key === 'O' ? input.bindings.creationReceiptDigest : input.bindings.captureId;
    requireFact(value.evidenceBinding === expected, 'result-binding-mismatch');
  }
  const deployment = input.bindings.deployment;
  requireFact(input.profile === 'native-inert' ? deployment.kind === 'fixed-fixture'
    : deployment.kind === 'installed' && deployment.architecture === input.bindings.architecture
      && deployment.family === 'PanelStackLabs.RecapPage_we33aa8nvkpcc' && HEX.test(deployment.packageDigest), 'profile-invalid');
  if (input.premises.A.state === 'satisfied') {
    const expected = input.profile === 'native-inert' ? [11, 9] : input.profile === 'installed-functionality' ? [3, 3] : [1, 1];
    requireFact(input.actors.roots === expected[0] && input.actors.coordinators === expected[1], 'actor-missing');
    requireFact(input.profile === 'installed-functionality'
      ? input.actors.commands === 3 && input.actors.verifiers > 0 && input.actors.servers > 0
      : input.actors.commands === 0 && input.actors.verifiers === 0 && input.actors.servers === 0, 'actor-missing');
  }
  requireFact(input.terminals.visible === 0 || input.premises.C.state === 'violated');
  requireFact(input.terminals.unresolved === 0 || input.premises.C.state !== 'satisfied');
  requireFact(input.premises.B.state !== 'satisfied' || input.behavior.completed === true, 'behavior-mismatch');
  requireFact(input.premises.R.state !== 'satisfied' || Object.entries(input.cleanup)
    .every(([key, value]) => key === 'scope' || value === true));
  requireFact(!input.executionFailures.length || input.premises.R.state !== 'satisfied');
  const values = Object.values(input.premises);
  const violation = values.find((value) => value.state === 'violated');
  const unknown = values.find((value) => value.state !== 'satisfied' || !value.evaluated);
  const verdict = violation ? 'fail' : unknown ? 'inconclusive' : 'pass';
  const result = { ...input, verdict, primaryReason: (violation ?? unknown)?.reason ?? 'none' };
  requireFact(Buffer.byteLength(JSON.stringify(result)) <= RECORD_LIMIT, 'report-invalid');
  return Object.freeze(result);
}
export function composeCapture({ bindings, profile, record, inputs, creation, behavior, cleanup, failures = [] }) {
  requireFact([inputs, creation, behavior].every((value) => typeof value === 'boolean'), 'report-invalid');
  const state = (yes, reason, binding) => premise(yes ? 'satisfied' : 'violated', yes ? 'none' : reason, binding);
  return reduceStartupContract({
    schemaVersion: 2, claim: CLAIM, profile, bindings,
    premises: {
      I: state(inputs, 'input-mismatch', bindings.startupInputsDigest),
      H: premise(record.hostState, record.hostReason, bindings.captureId),
      O: state(creation, 'creation-receipt-stale', bindings.creationReceiptDigest),
      A: premise(record.actorState, record.actorReason, bindings.captureId),
      C: premise(record.captureState, record.captureReason, bindings.captureId),
      B: state(behavior, 'behavior-mismatch', bindings.captureId),
      R: state(cleanup.completed && cleanup.reportValid && cleanup.closingInputs && !failures.length,
        failures.length ? 'report-invalid' : 'resource-cleanup-failed', bindings.captureId),
    },
    actors: Object.fromEntries(['roots', 'coordinators', 'verifiers', 'servers', 'commands'].map((key) => [key, record[key]])),
    terminals: { visible: record.visible, unresolved: record.unresolved },
    behavior: { completed: behavior }, cleanup,
    unassessedGlobal: { records: record.unassessed, unknownMetadata: record.rawUnknown, externalRequests: record.externalRequests },
    executionFailures: failures,
  });
}
export function demandCapturePass(result) {
  if (result.verdict !== 'pass') throw new StartupContractError(result.primaryReason,
    result.verdict === 'inconclusive' ? 'unknown' : 'violated');
  return result;
}

async function main() {
  requireFact(process.argv.length === 3 && process.argv[2] === '--compose-native');
  const chunks = [];
  let length = 0;
  for (;;) {
    const bytes = Buffer.alloc(4096);
    const count = readSync(0, bytes, 0, bytes.length, null);
    if (!count) break;
    length += count;
    requireFact(length <= RECORD_LIMIT, 'report-invalid');
    chunks.push(bytes.subarray(0, count));
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\ufeff/, ''));
  exactKeys(input, ['bindings', 'profile', 'record', 'inputs', 'creation', 'behavior', 'cleanup', 'failures']);
  requireFact(input.profile === 'native-inert', 'profile-invalid');
  const { verifyNativeArtifact } = await import('./native-launcher.mjs');
  const proof = await verifyNativeArtifact({ proof: true });
  const runtimeHash = input.bindings.architecture === 'x64'
    ? '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237'
    : '3958e4bb3f2d4ef37c938215dfc65a9d3c9d839b5060fec103bd2345fa78e951';
  const fixtureHash = proof.record.inputs.find((entry) => entry.path === 'test/native/Launcher.fixture.mjs.in')?.sha256;
  const expectedInputs = hashBytes(Buffer.from(`${proof.record.productionDigest}|${fixtureHash}|${runtimeHash}`));
  const expected = captureBindings(proof, input.bindings.architecture, expectedInputs,
    input.bindings.deployment, input.bindings.captureId);
  requireFact(recordDigest(expected) === recordDigest(input.bindings), 'result-binding-mismatch');
  const record = parseCaptureReport(input.record, expected, 'native-inert');
  const result = demandCapturePass(composeCapture({ ...input, bindings: expected, record }));
  console.log(`PASS app-startup-contract-v2 profile=${result.profile} verdict=pass`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const reason = error instanceof StartupContractError && REASONS.includes(error.reason)
      ? error.reason : 'report-invalid';
    console.error(`FAIL ${CLAIM} reason=${reason}`);
    process.exitCode = 1;
  });
}
