import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  CLAIM, captureBindings, composeCapture, creationReceipt, parseCaptureReport, premise,
  qualifiedHostSamples, recordDigest, reduceStartupContract, validateCreationReceipt,
} from '../scripts/lib/startup-contract.mjs';

const binding = {
  commit: 'a'.repeat(40), tree: 'b'.repeat(40), captureId: 'c'.repeat(32), architecture: 'x64',
  proofInputDigest: 'd'.repeat(64), creationReceiptDigest: 'e'.repeat(64), startupInputsDigest: 'f'.repeat(64),
  deployment: { kind: 'fixed-fixture', architecture: 'x64' },
};
function input() {
  return {
    schemaVersion: 2, claim: CLAIM, profile: 'native-inert', bindings: structuredClone(binding),
    premises: Object.fromEntries(['I', 'H', 'O', 'A', 'C', 'B', 'R'].map((key) => [
      key, premise('satisfied', 'none', key === 'I' ? binding.startupInputsDigest
        : key === 'O' ? binding.creationReceiptDigest : binding.captureId),
    ])),
    actors: { roots: 11, coordinators: 9, verifiers: 0, servers: 0, commands: 0 },
    terminals: { visible: 0, unresolved: 0 }, behavior: { completed: true },
    cleanup: { scope: 'capture', completed: true, reportValid: true, closingInputs: true },
    unassessedGlobal: { records: 19, unknownMetadata: 6, externalRequests: 2 }, executionFailures: [],
  };
}
function hostSamples() {
  return ['begin', 'end'].flatMap((phase) => ['0', '1'].map((slot) => ({
    phase, slot, registryView: 'native64', open: '2', query: '0', type: '0', bytes: '0',
    literalEmpty: '0', registryClosed: '1', helperKnown: '1', helperMachine: '34404', helperError: '0',
  })));
}
function nativeText() {
  const samples = hostSamples().map((sample) => 'DIAG host-sample ' + Object.entries(sample).map(([key, value]) => `${key}=${value}`).join(' '));
  const values = {
    profile: 'native-inert', ...Object.fromEntries(Object.entries(binding).filter(([key]) => key !== 'deployment')),
    hostState: 'satisfied', hostReason: 'none', actorState: 'satisfied', actorReason: 'none',
    captureState: 'satisfied', captureReason: 'none', roots: 11, coordinators: 9, verifiers: 0,
    servers: 0, commands: 0, visible: 0, unresolved: 0, rawUnknown: 6, unassessed: 19, externalRequests: 2,
  };
  const ordered = ['profile', 'captureId', 'commit', 'tree', 'architecture', 'proofInputDigest', 'creationReceiptDigest',
    'startupInputsDigest', 'hostState', 'hostReason', 'actorState', 'actorReason', 'captureState', 'captureReason',
    'roots', 'coordinators', 'verifiers', 'servers', 'commands', 'visible', 'unresolved', 'rawUnknown', 'unassessed', 'externalRequests'];
  return [...samples, `DIAG app-capture-v2 ${ordered.map((key) => `${key}=${values[key]}`).join(' ')}`].join('\n');
}
async function scenario(body, cleanup, afterCleanup) {
  const source = readFileSync(new URL('../scripts/msix-proof.mjs', import.meta.url), 'utf8')
    .match(/^async function runInstalledScenario\([\s\S]*?^\}/m)?.[0];
  return runInNewContext(`${source}\nrunInstalledScenario(body, { afterCleanup });`, {
    body, cleanupPackage: cleanup, afterCleanup, AggregateError,
  });
}

test('startup composition requires every premise independently of global metadata', () => {
  assert.equal(reduceStartupContract(input()).verdict, 'pass');
  for (const key of ['I', 'H', 'O', 'A', 'C', 'B', 'R']) {
    const value = input();
    value.premises[key] = premise('unknown', key === 'A' ? 'actor-missing' : 'input-missing', value.premises[key].evidenceBinding);
    assert.equal(reduceStartupContract(value).verdict, 'inconclusive');
  }
  const unknowns = input();
  unknowns.unassessedGlobal.records = 8192;
  assert.equal(reduceStartupContract(unknowns).verdict, 'pass');
  const missing = input(); delete missing.premises.A;
  assert.throws(() => reduceStartupContract(missing), /report-invalid/);
});

test('startup capture and later journey failures keep their distinct ownership and chronology', async () => {
  const violation = input();
  violation.premises.I = premise('unknown', 'input-missing', binding.startupInputsDigest);
  violation.premises.C = premise('violated', 'app-terminal-visible', binding.captureId);
  assert.equal(reduceStartupContract(violation).verdict, 'fail');
  const terminal = input(); terminal.terminals.visible = 1;
  terminal.premises.C = premise('violated', 'app-terminal-visible', binding.captureId);
  assert.equal(reduceStartupContract(terminal).primaryReason, 'app-terminal-visible');
  const unknown = input(); unknown.premises.A = premise('unknown', 'actor-missing', binding.captureId);
  assert.equal(reduceStartupContract(unknown).verdict, 'inconclusive');
  const report = input(); report.executionFailures = ['report-invalid'];
  report.premises.R = premise('violated', 'report-invalid', binding.captureId);
  assert.equal(reduceStartupContract(report).verdict, 'fail');
  const capture = reduceStartupContract(input());
  const cleanupError = new Error('outer-cleanup');
  await assert.rejects(scenario((context) => { context.cleanupAuthorized = true; return capture; },
    () => { throw cleanupError; }), (error) => error.errors[0] === cleanupError);
  assert.equal(capture.verdict, 'pass');
  const original = new Error('body-failed');
  await assert.rejects(scenario((context) => { context.cleanupAuthorized = true; throw original; },
    () => { throw cleanupError; }, () => {}), (error) => error.errors[0] === original && error.errors[1] === cleanupError);
});

test('startup terminal records reject legacy malformed duplicate and unsafe report shapes', () => {
  const text = nativeText();
  assert.equal(parseCaptureReport(text, binding, 'native-inert').roots, 11);
  const variants = [
    'PASS observer',
    text + '\n' + text,
    text.replace('app-capture-v2', 'app-capture-v1'),
    text.replace('captureState=satisfied', 'captureState=maybe'),
    text.replace('hostReason=none', 'hostReason=unlisted'),
    text.replace('roots=11', 'roots=-1'),
    text.replace('roots=11', 'roots=11 extra=1'),
    text.replace(' roots=11', ''),
    text + '\nDIAG path=C:\\private',
    text.replace('visible=0', 'visible=1'),
    'DIAG ' + 'a'.repeat(4096),
  ];
  for (const invalid of variants) assert.throws(() => parseCaptureReport(invalid, binding, 'native-inert'));
});

test('typed host samples require native view literal emptiness and both qualified endpoints', () => {
  assert.equal(qualifiedHostSamples(hostSamples()), true);
  const empty = hostSamples();
  Object.assign(empty[0], { open: '0', query: '0', type: '2', bytes: '2', literalEmpty: '1' });
  assert.equal(qualifiedHostSamples(empty), true);
  for (const patch of [
    { registryView: 'native32' }, { type: '3', open: '0', query: '0' },
    { open: '0', query: '0', type: '1', bytes: '8', literalEmpty: '0' },
    { open: '5' }, { helperKnown: '0' },
  ]) {
    const sample = hostSamples(); Object.assign(sample[3], patch);
    assert.equal(qualifiedHostSamples(sample), false);
  }
  assert.throws(() => qualifiedHostSamples(hostSamples().slice(0, 3)), /host-unqualified/);
});

test('creation receipts and capture bindings reject stale or inconsistent source evidence', (t) => {
  t.diagnostic(`creation-runtime=${process.version}`);
  const expected = { commit: binding.commit, tree: binding.tree, proofInputDigest: binding.proofInputDigest, sources: [] };
  const tap = '# tests 93\n# pass 93\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  const receipt = creationReceipt({ ...expected, tap, exitCode: 0, nodeVersion: 'v24.19.0' });
  assert.equal(validateCreationReceipt(receipt, expected), receipt);
  for (const change of [{ commit: '0'.repeat(40) }, { tree: '0'.repeat(40) },
    { proofInputDigest: '0'.repeat(64) }, { sources: ['missing'] }, { skipped: 1 }]) {
    assert.throws(() => validateCreationReceipt({ ...receipt, ...change }, expected));
  }
  assert.throws(() => creationReceipt({ ...expected, tap, exitCode: 1, nodeVersion: 'v24.19.0' }));
  const proof = { record: { commit: binding.commit, creationReceipt: receipt, inputDigest: binding.proofInputDigest } };
  const bound = captureBindings(proof, 'x64', binding.startupInputsDigest, binding.deployment, binding.captureId);
  assert.equal(bound.creationReceiptDigest, recordDigest(receipt));
  assert.throws(() => parseCaptureReport(nativeText(), { ...binding, captureId: '0'.repeat(32) }, 'native-inert'));
});

test('fixed startup profiles cannot downgrade installed applicability or predict outer cleanup', () => {
  const inert = input();
  assert.equal(reduceStartupContract(inert).verdict, 'pass');
  const functionProfile = input(); functionProfile.profile = 'installed-functionality';
  assert.throws(() => reduceStartupContract(functionProfile), /profile-invalid/);
  const busy = input(); busy.profile = 'installed-busy';
  busy.bindings.deployment = { kind: 'installed', family: 'PanelStackLabs.RecapPage_we33aa8nvkpcc',
    architecture: 'x64', packageDigest: '1'.repeat(64) };
  assert.throws(() => reduceStartupContract(busy), /actor-missing/);
  const future = input(); future.cleanup.scope = 'journey';
  assert.throws(() => reduceStartupContract(future));
  const optional = input(); optional.premises.A.required = false;
  assert.throws(() => reduceStartupContract(optional));
  const missing = parseCaptureReport(nativeText(), binding, 'native-inert');
  const capture = composeCapture({ bindings: binding, profile: 'native-inert', record: missing,
    inputs: true, creation: true, behavior: true,
    cleanup: { scope: 'capture', completed: false, reportValid: true, closingInputs: true } });
  assert.equal(capture.verdict, 'fail');
});
