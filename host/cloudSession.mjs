// Refuses control API callers from another Windows session (#810, P02-T01 threat T4). Loopback is shared
// by every session on a computer, so another person's browser reaching this server through fast user
// switching or Remote Desktop would otherwise see and use this person's connection. The answer comes from
// the operating system and never from anything the caller sends: netstat maps the caller's port to its
// process, and tasklist gives that process's session.
//
// Both commands print localized words and headings, so only their numeric columns are read: the address
// and port pairs and the process id from netstat, and the process id and session number from tasklist's
// CSV. Measured on this project's ARM64 Windows 11 machine on 2026-10-28: netstat 72 to 212 ms and tasklist
// for one process 96 to 402 ms, so the check runs once per connection, never once per request.

import { execFile } from 'node:child_process';
import { join } from 'node:path';

const NETSTAT_ROW = /^\s*TCP\s+(\S+)\s+(\S+)\s+\S+\s+(\d+)\s*$/i;
const CSV_FIELD = /"((?:[^"]|"")*)"/g;
const COMMAND_MS = 10_000;

export function systemDirectory(env = process.env) {
  const root = typeof env.SystemRoot === 'string' && /^[A-Za-z]:\\[^"]*$/.test(env.SystemRoot) ? env.SystemRoot : 'C:\\Windows';
  return join(root, 'System32');
}

// The process holding the caller's end of the connection: the row whose local address is the caller's
// port and whose foreign address is this server's. More than one process, or none, is no answer.
export function callerProcess(netstat, { callerPort, serverPort }) {
  const local = `127.0.0.1:${callerPort}`;
  const foreign = `127.0.0.1:${serverPort}`;
  const found = new Set();
  for (const line of String(netstat).split(/\r?\n/)) {
    const row = NETSTAT_ROW.exec(line);
    if (row && row[1] === local && row[2] === foreign) found.add(Number(row[3]));
  }
  const [pid] = found;
  return found.size === 1 && Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

// tasklist /FO CSV /NH prints one quoted row per process: image, process id, session name, session
// number, memory. The image name and the memory figure can carry commas, which is why the fields are read
// as quoted values rather than split.
export function processSession(tasklist, pid) {
  const sessions = new Set();
  for (const line of String(tasklist).split(/\r?\n/)) {
    const fields = [...line.matchAll(CSV_FIELD)].map((match) => match[1].replaceAll('""', '"'));
    if (fields.length >= 4 && fields[1] === String(pid) && /^\d{1,10}$/.test(fields[3])) sessions.add(Number(fields[3]));
  }
  const [session] = sessions;
  return sessions.size === 1 ? session : null;
}

function runCommand(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'latin1', windowsHide: true, timeout: COMMAND_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

// Resolves true only when the caller is a process in this server's own Windows session. Anything that
// cannot be decided is a refusal. The verdict is kept for the life of the connection, so a browser's
// kept-alive connection pays for the two commands once.
export function createSessionCheck({
  platform = process.platform, run = runCommand, ownPid = process.pid, system = systemDirectory(),
} = {}) {
  const verdicts = new WeakMap();
  let own = null;
  const sessionOf = async (pid) => processSession(await run(join(system, 'tasklist.exe'),
    ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']), pid);
  async function decide(socket) {
    if (platform !== 'win32' || socket?.remoteAddress !== '127.0.0.1') return false;
    own ??= sessionOf(ownPid);
    const mine = await own.catch(() => null);
    if (mine === null) {
      own = null;
      return false;
    }
    const pid = callerProcess(await run(join(system, 'netstat.exe'), ['-ano', '-p', 'TCP']),
      { callerPort: socket.remotePort, serverPort: socket.localPort });
    if (pid === null) return false;
    if (pid === ownPid) return true;
    return (await sessionOf(pid)) === mine;
  }
  return function check(socket) {
    if (!socket || typeof socket !== 'object') return Promise.resolve(false);
    if (!verdicts.has(socket)) verdicts.set(socket, decide(socket).catch(() => false));
    return verdicts.get(socket);
  };
}
