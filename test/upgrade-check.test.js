import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp, mkdir, readFile, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as upgradeCheck from '../scripts/upgrade-check.mjs';

const runGit = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });

test('the upgrade journey refuses indistinguishable old and new builds', () => {
  assert.match(upgradeCheck.upgradeVersionProblem('1.4.0', '1.4.0'), /Bump the candidate version/);
  assert.equal(upgradeCheck.upgradeVersionProblem('1.4.0', '2.0.0'), null);
});

test('the historical install is reconstructed from committed Git bytes', async (t) => {
  assert.equal(
    typeof upgradeCheck.installHistorical,
    'function',
    'the upgrade runner has no historical materialization seam',
  );

  const repo = await mkdtemp(join(tmpdir(), 'mrt-upgrade-git-'));
  const dest = await mkdtemp(join(tmpdir(), 'mrt-upgrade-install-'));
  t.after(() => Promise.all([
    rm(repo, { recursive: true, force: true }),
    rm(dest, { recursive: true, force: true }),
  ]));

  runGit(repo, 'init', '--quiet');
  runGit(repo, 'config', 'user.email', 'fixture@example.invalid');
  runGit(repo, 'config', 'user.name', 'Fixture');
  await mkdir(join(repo, 'src', 'nested'), { recursive: true });
  await writeFile(join(repo, 'server.mjs'), 'historical server\n');
  await writeFile(join(repo, 'src', 'nested', 'text.txt'), 'historical source\n');
  await writeFile(join(repo, 'src', 'nested', 'bytes.bin'), Buffer.from([0, 10, 255, 13]));
  runGit(repo, 'add', '.');
  runGit(repo, 'commit', '--quiet', '-m', 'fixture release');
  runGit(repo, 'tag', 'v1.2.0');

  await writeFile(join(repo, 'server.mjs'), 'working server\n');
  await writeFile(join(repo, 'src', 'nested', 'text.txt'), 'working source\n');

  await upgradeCheck.installHistorical({ repo, ref: 'v1.2.0', dest });

  assert.equal(await readFile(join(dest, 'server.mjs'), 'utf8'), 'historical server\n');
  assert.equal(await readFile(join(dest, 'src', 'nested', 'text.txt'), 'utf8'), 'historical source\n');
  assert.deepEqual(
    await readFile(join(dest, 'src', 'nested', 'bytes.bin')),
    Buffer.from([0, 10, 255, 13]),
  );
});

test('the upgrade journey owns historical source and nonzero read progress', async () => {
  const source = await readFile(new URL('../scripts/upgrade-check.mjs', import.meta.url), 'utf8');

  assert.match(source, /installHistorical\(\{\s*repo:\s*REPO,\s*ref:\s*OLD_REF,\s*dest:\s*oldDir,?\s*\}\)/);
  assert.match(
    source,
    /const HISTORICAL_GIT_ENV = Object\.freeze\(\{\s*\.\.\.process\.env,\s*GIT_NO_LAZY_FETCH: '1',?\s*\}\);/,
  );
  const historicalGitCalls = [...source.matchAll(/execFileAsync\(\s*'git',[\s\S]*?\);/g)];
  assert.equal(historicalGitCalls.length, 3);
  for (const [call] of historicalGitCalls) assert.match(call, /env: HISTORICAL_GIT_ENV/);
  assert.match(source, /#btn-hero-done/);
  assert.match(source, /readIds/);
  assert.match(source, /progressPainted\(paintedBefore,\s*1,\s*before\.itemIds\.length\)/);
  assert.match(source, /progressPainted\(paintedAfter,\s*1,\s*after\.itemIds\.length\)/);
  assert.match(source, /id:\s*'read-state-lost'/);
});
