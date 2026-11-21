import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const base = '1b70fce93ec2def69755e52d7e5ae155f971fb55';
const originalExec = childProcess.execFileSync;
const git = (args) => originalExec('git', args, { encoding: 'utf8' });
const source = git(['rev-parse', 'HEAD']).trim();
const baseline = (path) => git(['show', `${base}:${path}`]);
const normalize = (text) => text.replace(/\r\n/g, '\n');
const workflow = readFileSync(resolve('.github', 'workflows', 'wack.yml'), 'utf8');
const fixture = readFileSync(resolve('test', 'wack-workflow.test.js'), 'utf8');
assert.match(source, /^[0-9a-f]{40}$/);
assert.equal(normalize(fixture), normalize(baseline('test/wack-workflow.test.js')));

function guards(text) {
  const jobs = text.slice(text.search(/^jobs:\r?$/m))
    .split(/(?=^ {2}[a-z][\w-]*:)/m).slice(1);
  const browser = jobs.find((job) => /^ {2}browser-diagnostic:/m.test(job));
  const extract = (job) => job.match(/ {8}run: \|\r?\n([\s\S]*?)(?=\r?\n {6}-)/)?.[1]
    .replace(/^ {10}/gm, '');
  const result = { browser: extract(browser), native: extract(jobs[0]) };
  assert.ok(result.browser && result.native);
  return result;
}

const actualGuards = guards(workflow);
const originalGuards = guards(baseline('.github/workflows/wack.yml'));
assert.equal(normalize(actualGuards.browser), normalize(originalGuards.browser));
assert.equal(normalize(actualGuards.native), normalize(originalGuards.native));
if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS !== undefined) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(process.env.GITHUB_SHA, source);
  assert.equal(process.env.GITHUB_WORKFLOW_SHA, source);
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1');
  assert.match(process.env.GITHUB_RUN_ID, /^[1-9]\d*$/);
  assert.match(process.version, /^v24\./);
}
console.log(JSON.stringify({
  diagnostic: 'windows-guard-timing', qualified: false, source, fixtureBase: base,
  workflow: process.env.GITHUB_WORKFLOW_SHA ?? null,
  run: process.env.GITHUB_RUN_ID ?? null, attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  node: process.version,
}));

const mark = (phase) => `[Console]::Error.WriteLine(('GUARD-TIMING ${phase} ' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())); [Console]::Error.Flush();`;
const elapsed = (end, start) => Number.isFinite(end) && Number.isFinite(start) && end >= start ? end - start : null;
let measurements = 0;
childProcess.execFileSync = function measure(file, args, options) {
  if (file !== 'powershell.exe' || !options?.input?.includes('PASS browser-mode-guards cases=')) {
    return originalExec(file, args, options);
  }
  measurements += 1;
  assert.equal(measurements, 1);
  assert.deepEqual(args, [
    '-NoProfile', '-NonInteractive', '-Command', 'Invoke-Expression ([Console]::In.ReadToEnd())',
  ]);
  assert.equal(options.timeout, 15000);
  assert.equal(options.encoding, 'utf8');
  const input = options.input;
  const cases = (input.match(/\$env:DIAGNOSTIC_TARGET = '/g) ?? []).length;
  const browserCopies = input.split(actualGuards.browser).length - 1;
  const nativeCopies = input.split(actualGuards.native).length - 1;
  const valid = (input.match(/if \(\$rejected -ne \$false\)/g) ?? []).length;
  const invalid = (input.match(/if \(\$rejected -ne \$true\)/g) ?? []).length;
  assert.equal(cases, 35);
  assert.equal(browserCopies, 35);
  assert.equal(nativeCopies, 28);
  assert.equal(valid, 7);
  assert.equal(invalid, 28);
  const instrumented = input
    .replace("$ErrorActionPreference = 'Stop';", `$ErrorActionPreference = 'Stop'; ${mark('dispatch')}`)
    .replace("Write-Output 'PASS browser-mode-guards", `${mark('guards-done')} Write-Output 'PASS browser-mode-guards`);
  assert.notEqual(instrumented, input);
  const measuredArgs = [...args];
  measuredArgs[3] = `${mark('started')} [Console]::Error.WriteLine(('GUARD-ENGINE ' + $PSVersionTable.PSVersion.ToString())); [Console]::Error.Flush(); $diagnosticInput = [Console]::In.ReadToEnd(); ${mark('input-read')} Invoke-Expression $diagnosticInput; ${mark('returned')}`;
  const startedAt = Date.now();
  const start = performance.now();
  const result = childProcess.spawnSync(file, measuredArgs, { ...options, input: instrumented });
  const wallMs = performance.now() - start;
  const finishedAt = Date.now();
  const stderr = String(result.stderr ?? '');
  const markers = Object.fromEntries([...stderr.matchAll(/GUARD-TIMING ([\w-]+) (\d+)/g)]
    .map((match) => [match[1], Number(match[2])]));
  const lastMarker = Object.keys(markers).at(-1) ?? null;
  const powershell = /GUARD-ENGINE ([\d.]+)/.exec(stderr)?.[1] ?? null;
  console.log(JSON.stringify({
    cases, valid, invalid, browserGuardBlocks: browserCopies, nativeGuardBlocks: nativeCopies,
    inputBytes: Buffer.byteLength(input, 'utf8'), timeoutMs: options.timeout,
    wallMs: Math.round(wallMs), powershell,
    startupToFirstCommandMs: elapsed(markers.started, startedAt),
    inputReadMs: elapsed(markers['input-read'], markers.started),
    parseDispatchMs: elapsed(markers.dispatch, markers['input-read']),
    guardExecutionMs: elapsed(markers['guards-done'], markers.dispatch),
    expressionReturnMs: elapsed(markers.returned, markers['guards-done']),
    exitCollectionMs: elapsed(finishedAt, markers.returned),
    lastMarker, lastMarkerToExitMs: elapsed(finishedAt, markers[lastMarker]),
    markers, status: result.status, signal: result.signal, error: result.error?.code ?? null,
  }));
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(`Guard timing child failed: ${result.error?.code ?? 'nonzero exit'}, status=${result.status}, signal=${result.signal}`);
  }
  assert.match(powershell ?? '', /^5\.1\./);
  for (const phase of ['started', 'input-read', 'dispatch', 'guards-done', 'returned']) {
    assert.ok(Number.isFinite(markers[phase]), `Missing timing marker: ${phase}`);
  }
  return result.stdout;
};
syncBuiltinESMExports();
await import(pathToFileURL(resolve('test', 'wack-workflow.test.js')).href);
process.on('exit', () => {
  if (measurements !== 1) {
    console.error(`Expected one guard measurement; observed ${measurements}.`);
    process.exitCode = 1;
  }
});
