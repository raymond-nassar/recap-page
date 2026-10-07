#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublicationInputs } from './check-publication.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PHASES = new Set([
  'preparation', 'resolution', 'authority', 'authoring', 'validation', 'repair',
  'publication', 'hosted-checks', 'owner-merge-wait',
]);
const KINDS = new Set(['active', 'metadata-or-clarification-wait', 'hosted-check-wait', 'owner-or-app-wait', 'unclassified']);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const iso = (value) => {
  assert.ok(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'A recorded timestamp is required.');
  return new Date(value).toISOString();
};

export function beginDelivery({ handedAt, input, recordedAt = new Date().toISOString() }) {
  handedAt = iso(handedAt);
  recordedAt = iso(recordedAt);
  assert.ok(handedAt <= recordedAt, 'A handoff cannot be in the future.');
  assert.ok(input && typeof input.name === 'string' && /^[a-f0-9]{64}$/.test(input.sha256)
    && Number.isInteger(input.bytes) && input.bytes > 0, 'Bind the supplied Markdown bytes.');
  return {
    schemaVersion: 1, handedAt, recordedAt, input, events: [{ at: recordedAt, phase: 'preparation', kind: 'active' }],
    note: 'Elapsed time starts at the supplied handoff, not at tool launch. Earlier unclassified time is included.',
  };
}

export function deliveryPhase(clock, { at = new Date().toISOString(), phase, kind }) {
  assert.equal(clock.schemaVersion, 1);
  assert.ok(PHASES.has(phase) && KINDS.has(kind), 'Use a named delivery phase and active/wait category.');
  at = iso(at);
  assert.ok(at >= clock.events.at(-1).at, 'Delivery events cannot move backwards.');
  return { ...clock, events: [...clock.events, { at, phase, kind }] };
}

export function summarizeDelivery(clock, merge, observedAt = new Date().toISOString()) {
  const start = Date.parse(iso(clock.handedAt));
  const merged = merge?.state === 'MERGED' && typeof merge.url === 'string'
    && /^[a-f0-9]{40}$/.test(merge.mergeCommit?.oid ?? '')
    && /^[a-f0-9]{40}$/.test(merge.headRefOid ?? '')
    && typeof merge.mergedAt === 'string';
  const end = Date.parse(iso(merged ? merge.mergedAt : observedAt));
  assert.ok(end >= start, 'Merge or observation predates the handoff.');
  const byPhase = {};
  const byKind = {};
  let previous = start;
  let current = { phase: 'unclassified-before-tool-recording', kind: 'unclassified' };
  for (const event of [...clock.events, { at: new Date(end).toISOString() }]) {
    const at = Date.parse(iso(event.at));
    assert.ok(at >= previous && at <= end, 'Clock events must partition the measured interval in order.');
    const seconds = (at - previous) / 1000;
    byPhase[current.phase] = (byPhase[current.phase] ?? 0) + seconds;
    byKind[current.kind] = (byKind[current.kind] ?? 0) + seconds;
    current = event;
    previous = at;
  }
  const elapsedSeconds = (end - start) / 1000;
  return {
    schemaVersion: 1, status: merged ? 'merged' : 'awaiting-actual-merge',
    handedAt: clock.handedAt, endedAt: new Date(end).toISOString(), elapsedSeconds,
    targetSeconds: 3600, targetMet: Boolean(merged && elapsedSeconds < 3600),
    secondsByPhase: byPhase, secondsByKind: byKind,
    merge: merged ? merge : null,
    note: 'All preparation, validation, rework and external waits remain in elapsed time. PR readiness is not merge.',
  };
}

export function qualifyMergedDelivery(summary, { validatedTree, headTree, mergedTree, unanswered = [] }) {
  if (summary.status !== 'merged') return summary;
  const blockers = [...unanswered];
  if (!/^[a-f0-9]{40}$/.test(validatedTree ?? '')) blockers.push('The exact validated candidate tree is unavailable.');
  if (headTree !== validatedTree) blockers.push('The published head differs from the validated candidate.');
  if (mergedTree !== validatedTree) blockers.push('The actual merge differs from the validated candidate.');
  return {
    ...summary, status: blockers.length ? 'merged-unverified' : 'merged',
    targetMet: summary.targetMet && blockers.length === 0,
    validatedTree: validatedTree ?? null, headTree: headTree ?? null, mergedTree: mergedTree ?? null, blockers,
  };
}

export async function runDeliveryCommand({ name, executable, args, cwd, logDir }) {
  assert.match(name, /^[a-z0-9-]+$/);
  assert.ok(typeof executable === 'string' && executable && typeof cwd === 'string');
  assert.ok(Array.isArray(args) && args.every((argument) => typeof argument === 'string'));
  await mkdir(logDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, '-');
  const prefix = path.join(logDir, `${stamp}-${name}`);
  const stdout = createWriteStream(`${prefix}.stdout.log`, { flags: 'wx' });
  const stderr = createWriteStream(`${prefix}.stderr.log`, { flags: 'wx' });
  try {
    await Promise.all([once(stdout, 'open'), once(stderr, 'open')]);
  } catch (error) {
    stdout.destroy();
    stderr.destroy();
    throw error;
  }
  const streams = Promise.all([finished(stdout), finished(stderr)]);
  streams.catch(() => { child.kill(); });
  let spawnError = null;
  const child = spawn(executable, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  child.once('error', (error) => { spawnError = error.code ?? 'SPAWN_ERROR'; });
  const outcome = await new Promise((resolve) => {
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  await streams;
  const receipt = {
    schemaVersion: 1, name, executable, args, startedAt, completedAt: new Date().toISOString(),
    ...outcome, spawnError, success: outcome.exitCode === 0 && !outcome.signal && !spawnError,
    stdoutSha256: hash(await readFile(`${prefix}.stdout.log`)),
    stderrSha256: hash(await readFile(`${prefix}.stderr.log`)),
  };
  await writeFile(`${prefix}.json`, json(receipt), { encoding: 'utf8', flag: 'wx' });
  return receipt;
}

function optionsFor(args) {
  const command = args.shift();
  assert.ok(['intake', 'prepare', 'author', 'vendor', 'check', 'phase', 'finish'].includes(command),
    'Use intake, prepare, author, vendor, check, phase or finish.');
  const options = {};
  const allowed = {
    intake: ['markdown', 'handed-at'], prepare: ['request', 'handed-at'],
    author: ['approval'], vendor: [], check: ['scope'], phase: ['phase', 'kind'], finish: ['pr'],
  };
  for (const argument of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    assert.ok(match && !Object.hasOwn(options, match[1]), 'Use distinct --option=value arguments.');
    assert.ok(match[1] === 'work' || allowed[command].includes(match[1]), 'Unknown option for this delivery command.');
    options[match[1]] = match[2];
  }
  assert.ok(options.work, 'A private --work directory is required.');
  const work = path.resolve(options.work);
  const relative = path.relative(ROOT, work);
  assert.ok(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    'Delivery receipts must remain outside the repository.');
  return { command, options, work };
}

async function privateWorkDirectory(value) {
  const location = path.resolve(value);
  const outside = path.relative(ROOT, location);
  assert.ok(outside.startsWith(`..${path.sep}`) || path.isAbsolute(outside),
    'Working evidence must stay outside the repository.');
  await mkdir(location, { recursive: true });
  const actual = await realpath(location);
  const insideGit = spawnSync('git', ['-C', actual, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8', windowsHide: true,
  });
  assert.ok(insideGit.status === 128 && /not a git repository/i.test(insideGit.stderr),
    'The private work directory must not resolve inside a Git worktree.');
  return actual;
}

async function preserveJson(file, value) {
  const body = json(value);
  try {
    await writeFile(file, body, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assert.equal(await readFile(file, 'utf8'), body, 'A preserved proposal must not be overwritten.');
  }
}

async function requireRegisteredProposal(proposal) {
  const { readOwnerGuideRegistry } = await import('./lib/owner-guide-registry.mjs');
  assert.equal(proposal.status, 'awaiting-review', 'Unresolved input is not an authored guide.');
  const registration = readOwnerGuideRegistry().guides.find((entry) => entry.id === proposal.id);
  assert.ok(registration, 'Author the approved guide before vendoring or validation.');
  const contract = await readJson(path.join(ROOT, registration.contract));
  assert.equal(contract.proposalDigest, proposal.proposalDigest, 'The registered guide names a different proposal.');
}

function npmCommand() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  const cli = candidates.find((candidate) => candidate.endsWith('.js') && existsSync(candidate));
  assert.ok(cli, 'Run through npm so the native npm CLI can be resolved without shell quoting.');
  return cli;
}

function gitRead(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, 'Could not establish the exact staged candidate.');
  return result.stdout.trim();
}

function stagedCandidate() {
  gitRead(['diff', '--quiet']);
  assert.equal(gitRead(['ls-files', '--others', '--exclude-standard']), '',
    'Preflight and stage the complete proposed public set before validation.');
  return { head: gitRead(['rev-parse', 'HEAD']), tree: gitRead(['write-tree']) };
}

async function main() {
  const { command, options } = optionsFor(process.argv.slice(2));
  const work = await privateWorkDirectory(options.work);
  const { emitOwnerGuide, ownerApprovalRequest, parseOwnerMarkdown, prepareOwnerGuide, verifyOwnerMetadataCache }
    = await import('./lib/owner-guide.mjs');
  const { readOwnerGuideRegistry } = await import('./lib/owner-guide-registry.mjs');
  const clockFile = path.join(work, 'clock.json');
  const clockExists = existsSync(clockFile);
  if (command === 'intake' || command === 'prepare') {
    const request = command === 'prepare' ? await readJson(options.request) : null;
    const markdownFile = request?.markdownFile ?? options.markdown;
    const body = await readFile(markdownFile);
    const intake = parseOwnerMarkdown(new TextDecoder('utf-8', { fatal: true }).decode(body));
    const receipt = { name: path.basename(markdownFile), sha256: hash(body), bytes: body.length };
    if (!clockExists) {
      await writeFile(clockFile, json(beginDelivery({ handedAt: options['handed-at'], input: receipt })), { flag: 'wx' });
    } else {
      const clock = await readJson(clockFile);
      assert.deepEqual(clock.input, receipt, 'A different Markdown handoff needs a new delivery record.');
      if (options['handed-at']) assert.equal(iso(options['handed-at']), clock.handedAt, 'The original handoff clock cannot be reset.');
    }
    const originalFile = path.join(work, `original-${receipt.sha256}.md`);
    if (existsSync(originalFile)) {
      assert.equal(hash(await readFile(originalFile)), receipt.sha256, 'The preserved private original changed.');
    } else {
      await writeFile(originalFile, body, { flag: 'wx' });
    }
    if (command === 'intake') {
      await writeFile(path.join(work, 'intake.json'), json({ status: 'needs-resolution', input: receipt, selections: intake }));
      const template = {
        schemaVersion: 1, id: null, name: null, description: null, sourceUrl: null,
        sourceRetrievedAt: new Date().toISOString().slice(0, 10),
        markdownFile: path.resolve(markdownFile), metadataCache: null,
        metadataIssueIds: [...new Set(intake.map((entry) => entry.issueId).filter((id) => id != null))],
        selections: [], publicFiles: [], insertionAnchor: { beforeId: null }, characters: [], keywords: [],
      };
      const requestFile = path.join(work, 'request.json');
      if (!existsSync(requestFile)) await writeFile(requestFile, json(template), { flag: 'wx' });
      console.log(json({ status: 'needs-resolution', selections: intake.length }));
      return 0;
    }
    const proposal = await prepareOwnerGuide(request, { onPhase: async (phase) => {
      const clock = await readJson(clockFile);
      await writeFile(clockFile, json(deliveryPhase(clock, { phase, kind: 'active' })));
    } });
    const archive = path.join(work, 'proposals', proposal.proposalDigest ?? hash(json(proposal)));
    await mkdir(archive, { recursive: true });
    await preserveJson(path.join(archive, 'proposal.json'), proposal);
    await writeFile(path.join(work, 'proposal.json'), json(proposal));
    if (proposal.status === 'awaiting-review') {
      const approvalRequest = path.join(archive, 'approval-request.json');
      if (!existsSync(approvalRequest)) {
        await writeFile(approvalRequest, json(ownerApprovalRequest(proposal)), { flag: 'wx' });
      }
    }
    await writeFile(path.join(work, 'request-reference.json'), json({ requestFile: path.resolve(options.request) }));
    await writeFile(clockFile, json(deliveryPhase(await readJson(clockFile), {
      phase: proposal.status === 'needs-resolution' ? 'resolution' : 'authority',
      kind: proposal.status === 'needs-resolution' ? 'metadata-or-clarification-wait' : 'owner-or-app-wait',
    })));
    console.log(json({ status: proposal.status, proposalDigest: proposal.proposalDigest,
      sourceCounts: proposal.sourceCounts,
      approvalRequest: proposal.status === 'awaiting-review'
        ? `proposals/${proposal.proposalDigest}/approval-request.json` : null }));
    return proposal.status === 'needs-resolution' ? 2 : 0;
  }
  assert.ok(clockExists, 'Start with the real Markdown handoff before later delivery work.');
  let clock = await readJson(clockFile);
  const phase = async (phase, kind = 'active') => {
    clock = deliveryPhase(clock, { phase, kind });
    await writeFile(clockFile, json(clock));
  };
  if (command === 'phase') {
    await phase(options.phase, options.kind);
    console.log(json({ status: 'recorded', phase: options.phase, kind: options.kind }));
    return 0;
  }
  const proposal = await readJson(path.join(work, 'proposal.json'));
  if (command === 'author') {
    await phase('authoring');
    const result = await emitOwnerGuide(proposal, await readJson(options.approval));
    console.log(json(result));
    return 0;
  }
  await requireRegisteredProposal(proposal);
  const run = async (name, args) => {
    const receipt = await runDeliveryCommand({ name, executable: process.execPath, args, cwd: ROOT, logDir: work });
    console.log(json({ command: name, success: receipt.success, exitCode: receipt.exitCode,
      startedAt: receipt.startedAt, completedAt: receipt.completedAt }));
    return receipt.success;
  };
  if (command === 'vendor') {
    await phase('authoring');
    const reference = await readJson(path.join(work, 'request-reference.json'));
    const request = await readJson(reference.requestFile);
    assert.equal(request.id, proposal.id);
    await verifyOwnerMetadataCache(proposal, request.metadataCache);
    if (!await run('vendor', [
      path.join(ROOT, 'scripts', 'vendor-orders.mjs'), `--only=${proposal.id}`, `--metadata-cache=${request.metadataCache}`,
    ])) return 1;
    const registry = readOwnerGuideRegistry();
    const guide = registry.guides.find((entry) => entry.id === proposal.id);
    assert.ok(guide, 'Authored guide is missing from the independent validation registry.');
    await readPublicationInputs({
      paths: [
        ...Object.values(proposal.paths).map((name) => path.join(ROOT, name)),
        path.join(ROOT, 'src', 'data', proposal.artifacts.packet.proposedManifest.out),
        path.join(ROOT, 'src', 'data', 'catalog.json'), path.join(ROOT, 'src', 'data', 'curated-lists.json'),
        path.join(ROOT, 'scripts', 'data', 'owner-deliveries.json'),
      ],
    });
    return 0;
  }
  if (command === 'check') {
    await phase('validation');
    const staged = gitRead(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean);
    await readPublicationInputs({
      paths: [...new Set([
        ...staged, ...Object.values(proposal.paths), ...proposal.libraryFiles,
        ...proposal.publicFiles.map((entry) => entry.path),
        `src/data/${proposal.artifacts.packet.proposedManifest.out}`,
        'scripts/data/owner-deliveries.json',
      ])].map((name) => path.join(ROOT, name)),
    });
    if (options.scope === 'targeted') {
      if (!await run('owner-contract', ['--test', path.join(ROOT, 'test', 'owner-delivery-contracts.test.js')])) return 1;
      return await run('owner-browser', [path.join(ROOT, 'scripts', 'browser-check.mjs'), `--only=owner-guide-${proposal.id}`]) ? 0 : 1;
    }
    assert.ok(options.scope == null || options.scope === 'full', 'Use targeted or full validation scope.');
    const candidate = stagedCandidate();
    for (const script of ['lint', 'test', 'counts', 'sizes', 'spacing', 'palette', 'anchors', 'browser']) {
      if (!await run(script, [npmCommand(), ...(script === 'test' ? ['test'] : ['run', script])])) return 1;
    }
    assert.deepEqual(stagedCandidate(), candidate, 'The candidate changed during validation.');
    clock.validatedTree = candidate.tree;
    await writeFile(clockFile, json(clock));
    return 0;
  }
  assert.equal(command, 'finish');
  assert.match(options.pr ?? '', /^[1-9]\d*$/, 'Name the actual guide pull request.');
  const readback = spawnSync('gh', ['pr', 'view', options.pr, '--repo', 'raymond-nassar/recap-page',
    '--json', 'state,mergedAt,mergeCommit,headRefOid,url'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(readback.status, 0, 'Could not read the actual pull request merge event.');
  const merge = JSON.parse(readback.stdout);
  let summary = summarizeDelivery(clock, merge);
  if (summary.status === 'merged') {
    const trees = [];
    const unanswered = [];
    for (const revision of [merge.headRefOid, merge.mergeCommit?.oid]) {
      const commit = spawnSync('gh', ['api', `repos/raymond-nassar/recap-page/git/commits/${revision}`],
        { cwd: ROOT, encoding: 'utf8', windowsHide: true });
      if (commit.status !== 0) {
        unanswered.push('Could not read a published or merged commit tree.');
        trees.push(null);
      } else {
        trees.push(JSON.parse(commit.stdout).tree?.sha);
      }
    }
    summary = qualifyMergedDelivery(summary, {
      validatedTree: clock.validatedTree, headTree: trees[0], mergedTree: trees[1], unanswered,
    });
  }
  await writeFile(path.join(work, 'merge-timing.json'), json(summary));
  console.log(json(summary));
  return summary.targetMet ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch(async (error) => {
    const work = process.argv.find((argument) => argument.startsWith('--work='))?.slice('--work='.length);
    if (work) {
      try {
        const location = await privateWorkDirectory(work);
        const failure = {
          status: 'failed', recordedAt: new Date().toISOString(), message: error.message,
          stack: error.stack, preflight: error.preflight,
        };
        await preserveJson(path.join(location, `failure-${failure.recordedAt.replace(/[:.]/g, '-')}.json`), failure);
        await writeFile(path.join(location, 'failure.json'), json(failure));
      } catch {
        console.error('The private failure receipt could not be written safely.');
      }
    }
    console.error('Owner delivery stopped. Read failure.json in the specified private work directory; no private error values are printed.');
    process.exitCode = error.exitCode ?? 2;
  });
}
