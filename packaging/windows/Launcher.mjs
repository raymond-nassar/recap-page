import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const server = join(root, 'server.mjs');

if (process.env.MRT_PACKAGE_ARCH_PROBE === '1') {
  console.log(`launcher=${process.arch}`);
}

function pauseThenExit(code) {
  process.stdout.write('Press any key to close.');
  if (!process.stdin.isTTY) {
    process.stdout.write('\n');
    process.exitCode = code;
    return;
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.once('data', () => {
    process.stdin.setRawMode(false);
    process.stdout.write('\n');
    process.exit(code);
  });
}

function startFailed(error) {
  console.error('Recap Page could not start its packaged server.');
  if (error) console.error(error.message);
  console.error('Reinstall the app, then start it again.');
  pauseThenExit(1);
}

if (!existsSync(server)) {
  console.error('Recap Page could not find its packaged server.');
  console.error('Reinstall the app, then start it again.');
  pauseThenExit(1);
} else {
  const env = { ...process.env };
  delete env.MRT_PORT;
  delete env.MRT_NO_OPEN;

  const child = spawn(process.execPath, [server], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  let finished = false;

  process.on('SIGINT', () => {});
  child.once('error', (error) => {
    if (finished) return;
    finished = true;
    startFailed(error);
  });
  child.once('exit', (code) => {
    if (finished) return;
    finished = true;
    console.log();
    console.log('The tracker has stopped. Your reading progress is saved in your browser and is not lost.');
    pauseThenExit(Number.isInteger(code) ? code : 1);
  });
}
