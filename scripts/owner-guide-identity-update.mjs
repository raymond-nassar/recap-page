#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emitOwnerGuideIdentityUpdate, prepareOwnerGuideIdentityUpdate,
} from './lib/owner-guide.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

function optionsFor(args) {
  const command = args.shift();
  assert.ok(['prepare', 'apply'].includes(command), 'Use prepare or apply.');
  const allowed = command === 'prepare' ? ['request', 'proposal'] : ['proposal', 'approval'];
  const options = {};
  for (const argument of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    assert.ok(match && allowed.includes(match[1]) && !Object.hasOwn(options, match[1]),
      'Use the required distinct --option=value arguments.');
    options[match[1]] = path.resolve(match[2]);
  }
  for (const field of allowed) assert.ok(options[field], `Missing --${field}=path.`);
  return { command, options };
}

function requireOutsideWorktree(file) {
  const relative = path.relative(ROOT, path.resolve(file));
  assert.ok(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    'Identity update working files must remain outside the repository.');
}

async function main() {
  const { command, options } = optionsFor(process.argv.slice(2));
  for (const file of Object.values(options)) requireOutsideWorktree(file);
  if (command === 'prepare') {
    const proposal = await prepareOwnerGuideIdentityUpdate(await readJson(options.request));
    const body = json(proposal);
    await writeFile(options.proposal, body, { encoding: 'utf8', flag: 'wx' });
    console.log(json({
      status: proposal.status,
      id: proposal.id,
      proposalDigest: proposal.proposalDigest,
      rows: proposal.request.identities.length,
      outputs: proposal.outputs.length,
    }).trim());
    return;
  }
  const proposal = await readJson(options.proposal);
  const approval = await readJson(options.approval);
  console.log(json(await emitOwnerGuideIdentityUpdate(proposal, approval)).trim());
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
