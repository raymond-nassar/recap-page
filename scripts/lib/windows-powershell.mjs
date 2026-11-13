import { execFileSync } from 'node:child_process';

export function powershell(script, options = {}) {
  // A pwsh parent can point Windows PowerShell at modules built for a different .NET runtime.
  // Let the child reconstruct its own host-compatible module paths instead.
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => name.toLowerCase() !== 'psmodulepath'));
  return execFileSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; ${script}`,
  ], {
    encoding: 'utf8',
    maxBuffer: 64e6,
    ...options,
    env,
  });
}
