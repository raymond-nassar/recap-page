import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const identifiers = ['__recapPassiveGuard', 'passiveAuditTrackingScript', 'RECAP_IOS_SCREENSHOT_SEED'];
const needles = identifiers.flatMap((identifier) => {
  const littleEndian = Buffer.from(identifier, 'utf16le');
  return [Buffer.from(identifier), littleEndian, Buffer.from(littleEndian).swap16()];
});

export function scanReleaseApp(appPath) {
  const app = resolve(appPath);
  const appStat = lstatSync(app, { throwIfNoEntry: false });
  if (!app.endsWith('.app') || !appStat?.isDirectory() || appStat.isSymbolicLink()) {
    throw new Error('Release app missing or not a real .app directory');
  }
  const executable = join(app, 'RecapPage');
  const executableStat = lstatSync(executable, { throwIfNoEntry: false });
  if (!executableStat?.isFile() || executableStat.isSymbolicLink()) {
    throw new Error('Release executable missing or not a regular file');
  }
  if (!executableStat.size) throw new Error('Release executable is empty');
  let files = 0;
  const pending = [app];
  while (pending.length) {
    const directory = pending.pop();
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`Release app has an unscanned symbolic link: ${path}`);
      if (stat.isDirectory()) {
        pending.push(path);
      } else if (stat.isFile()) {
        const bytes = readFileSync(path);
        if (needles.some((needle) => bytes.includes(needle))) {
          throw new Error(`Debug instrumentation in Release app: ${path}`);
        }
        files += 1;
      } else {
        throw new Error(`Release app contains an unscanned entry: ${path}`);
      }
    }
  }
  return { files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node check-release-surface.mjs <built .app>');
  const result = scanReleaseApp(process.argv[2]);
  console.log(`Release debug surface: ${result.files} files, no instrumentation`);
}
