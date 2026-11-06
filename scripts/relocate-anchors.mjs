// Opt-in relocation of live citations whose target lines moved. The strict
// checker stays the only authority: this tool rewrites citing documents and
// nothing else, never the lock, and only when two independent computations
// agree on the new range and the cited text is unchanged apart from whitespace.
// Anything it cannot prove is refused, and a single refusal blocks the apply.
//
//   node scripts/relocate-anchors.mjs --base <rev>
//   node scripts/relocate-anchors.mjs --base <rev> --apply --approved-sha256 <digest>
//
// --base is the commit whose targets the lock was last blessed against. Pinned,
// historical and local-only citations are out of scope: their provenance is the
// normal gate's job, and this tool never reads the history registry.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collect, fingerprint, linesOf } from './check-anchors.mjs';

const LOCK = 'docs/anchors.lock.json';
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NOT_PLAIN_TEXT = /^(?:Binary files |GIT binary patch|rename (?:from|to) |copy (?:from|to) |deleted file mode |new file mode )/;
const GIT_ENV = { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' };
const USAGE = [
  'usage: node scripts/relocate-anchors.mjs --base <rev> [--apply --approved-sha256 <digest>]',
  '  --base <rev>             commit whose targets the lock was last blessed against (required)',
  '  --apply                  rewrite the citing documents; needs the digest from a preview',
  '  --approved-sha256 <hex>  digest printed by the preview of the same plan',
  'Run from the repository root. Without --apply nothing is written. The lock is never written.',
].join('\n');

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const compare = (a, b) => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    env: GIT_ENV,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function parseArgs(argv) {
  const args = { base: null, apply: false, approved: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--apply') {
      args.apply = true;
    } else if (flag === '--base' || flag === '--approved-sha256') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`${flag} needs a value`);
      const key = flag === '--base' ? 'base' : 'approved';
      if (args[key] !== null) throw new Error(`${flag} was given twice`);
      args[key] = value;
      i += 1;
    } else {
      throw new Error(`unknown argument ${flag}`);
    }
  }
  if (args.base === null) throw new Error('--base <rev> is required');
  if (args.approved !== null && !/^[0-9a-f]{64}$/.test(args.approved)) {
    throw new Error('--approved-sha256 must be 64 lowercase hex digits');
  }
  if (args.apply !== (args.approved !== null)) throw new Error('--apply and --approved-sha256 go together');
  return args;
}

// With zero context lines a hunk header is the whole movement record. An omitted
// count means 1, and anything that is not a plain text edit has no line map.
export function parseHunks(diffText) {
  const hunks = [];
  for (const line of diffText.split('\n')) {
    if (NOT_PLAIN_TEXT.test(line)) throw new Error(`the diff is not a plain text edit (${line.split(' ').slice(0, 2).join(' ')})`);
    const m = HUNK.exec(line);
    if (m) {
      hunks.push({
        a: Number(m[1]),
        b: m[2] === undefined ? 1 : Number(m[2]),
        c: Number(m[3]),
        d: m[4] === undefined ? 1 : Number(m[4]),
      });
    }
  }
  return hunks;
}

// A pure insertion is recorded as "after old line a", so line a keeps its number
// and every later line shifts. A line inside a replaced or deleted block has no
// answer, which is why the result can be null.
export function mapLine(hunks, line) {
  let shift = 0;
  for (const { a, b, d } of hunks) {
    if (b > 0 && line >= a && line <= a + b - 1) return null;
    const oldEnd = b === 0 ? a : a + b - 1;
    if (oldEnd < line) shift += d - b;
  }
  return line + shift;
}

// Heads are compared the way the checker stores them: trimmed, then cut to 100.
export function findHead(lines, head) {
  const hits = [];
  lines.forEach((line, index) => {
    const text = line.trim();
    if (text !== '' && text.slice(0, 100) === head) hits.push(index + 1);
  });
  return hits;
}

// The lock keeps no length, so the end is the count-th non-blank line from the
// head, with the count taken at the base. Blank lines never count, which is how
// the fingerprint itself ignores them.
export function endByCount(lines, headLine, count) {
  let seen = 0;
  for (let n = headLine; n <= lines.length; n += 1) {
    if (lines[n - 1].trim() !== '') {
      seen += 1;
      if (seen === count) return n;
    }
  }
  return null;
}

// The occurrence anchor drops a redundant N-N, so the written token has to be
// read back from the raw line rather than rebuilt from the anchor.
export function tokenAt(line, at, file) {
  if (line.slice(at, at + file.length) !== file) return null;
  const m = /^:(\d+)(?:-(\d+))?/.exec(line.slice(at + file.length));
  if (m === null) return null;
  return {
    from: at + file.length + 1,
    to: at + file.length + m[0].length,
    start: Number(m[1]),
    end: m[2] === undefined ? Number(m[1]) : Number(m[2]),
    dashed: m[2] !== undefined,
  };
}

export function rewriteLine(line, edits) {
  let out = '';
  let cursor = 0;
  for (const { from, to, text } of edits) {
    out += line.slice(cursor, from) + text;
    cursor = to;
  }
  return out + line.slice(cursor);
}

// The checker decodes lossily, so writing a lossy decode back would corrupt
// bytes. Anything that does not round-trip is refused instead.
function readDocument(path) {
  try {
    if (lstatSync(path).isSymbolicLink()) return { error: 'the citing document is a symbolic link' };
    const bytes = readFileSync(path);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) return { error: 'the citing document is not valid UTF-8' };
    return { sha256: sha256(bytes), lines: text.split('\n') };
  } catch (error) {
    return { error: `the citing document cannot be read (${error.code ?? error.message})` };
  }
}

function documentReader() {
  const cache = new Map();
  return (path) => {
    if (!cache.has(path)) cache.set(path, readDocument(path));
    return cache.get(path);
  };
}

function diffReader(base) {
  const cache = new Map();
  return (file) => {
    if (!cache.has(file)) {
      try {
        const text = git(['diff', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', base, '--', file]);
        cache.set(file, { hunks: parseHunks(text) });
      } catch (error) {
        cache.set(file, { error: error.message.split('\n')[0] });
      }
    }
    return cache.get(file);
  };
}

function resolveBase(rev) {
  try {
    return git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).trim();
  } catch {
    throw new Error(`--base ${rev} is not a commit in this repository`);
  }
}

function resolveCitation(o, want, context) {
  const doc = context.document(o.document);
  const record = {
    verdict: 'refuse',
    document: o.document,
    line: o.line,
    at: o.at,
    file: o.file,
    key: o.key,
    oldToken: o.anchor,
    newToken: null,
    to: null,
    edit: null,
    reason: null,
  };
  const refuse = (reason) => ({ ...record, reason });
  if (doc.error) return refuse(doc.error);
  const written = doc.lines[o.line - 1] ?? '';
  const token = tokenAt(written, o.at, o.file);
  if (token === null || token.start !== o.start || token.end !== o.end) {
    return refuse('the citing line does not hold the expected citation');
  }
  record.oldToken = `${o.file}:${written.slice(token.from, token.to)}`;

  // The old coordinates are only trusted once the lock fingerprint reproduces at
  // the base revision, so a wrong --base or a stale lock refuses here.
  if (typeof want.head !== 'string') return refuse('the lock entry has no head line');
  const before = fingerprint(o.file, o.start, o.end, context.base);
  if (before.fp === null) return refuse(`the old range does not resolve at the base revision (${before.why})`);
  if (before.fp !== want.fp || before.head !== want.head) return refuse('the lock does not match the base revision');
  if (before.blankEdge) return refuse('the old range begins or ends on a blank line');
  const count = linesOf(o.file, context.base).slice(o.start - 1, o.end).filter((text) => text.trim() !== '').length;

  const lines = linesOf(o.file);
  if (lines === null) return refuse('the target file is missing from the working tree');
  const diff = context.diffOf(o.file);
  if (diff.error) return refuse(`the target diff cannot be mapped (${diff.error})`);

  // A repeated head is refused even when the arithmetic would pick one copy:
  // identical lines are interchangeable, so a diff may align them either way.
  const heads = findHead(lines, want.head);
  if (heads.length === 0) return refuse('the head line is not in the working tree file');
  if (heads.length > 1) return refuse(`the head line appears ${heads.length} times in the working tree file`);
  const start = heads[0];
  const end = endByCount(lines, start, count);
  if (end === null) return refuse('the range runs past the end of the file');
  const mappedStart = mapLine(diff.hunks, o.start);
  const mappedEnd = mapLine(diff.hunks, o.end);
  if (mappedStart === null || mappedEnd === null) return refuse('a boundary line was edited, so its movement cannot be proven');
  if (mappedStart !== start || mappedEnd !== end) return refuse('the content search and the diff arithmetic disagree');

  const after = fingerprint(o.file, start, end);
  if (after.fp !== want.fp) return refuse('the cited text changed');
  if (after.blankEdge) return refuse('the new range begins or ends on a blank line');
  if (!token.dashed && start !== end) return refuse('a single line citation would become a range');
  const text = token.dashed ? `${start}-${end}` : String(start);
  return {
    ...record,
    verdict: 'resolve',
    newToken: `${o.file}:${text}`,
    to: { start, end },
    edit: { from: token.from, to: token.to, text },
  };
}

// Rewriting a line changes the text of whatever cites it, so a rewrite that
// lands inside another live citation's range would drift that citation.
function guardOverlap(records, held) {
  const moved = new Map();
  const touching = new Map();
  for (const record of records) {
    if (record.verdict !== 'resolve') continue;
    moved.set(record.key, record);
    if (!touching.has(record.document)) touching.set(record.document, []);
    touching.get(record.document).push(record);
  }
  const blocked = new Set();
  for (const o of held) {
    const rewrites = touching.get(o.file);
    if (!rewrites) continue;
    const range = moved.has(o.key) ? moved.get(o.key).to : { start: o.start, end: o.end };
    for (const record of rewrites) {
      if (record.line >= range.start && record.line <= range.end) blocked.add(record);
    }
  }
  return records.map((record) => {
    if (!blocked.has(record)) return record;
    return { ...record, verdict: 'refuse', newToken: null, to: null, edit: null, reason: 'the rewrite would change text that another live citation covers' };
  });
}

function rewrittenDocuments(records, context) {
  const groups = new Map();
  for (const record of records) {
    if (record.verdict !== 'resolve') continue;
    if (!groups.has(record.document)) groups.set(record.document, []);
    groups.get(record.document).push(record);
  }
  return [...groups.keys()].sort(compare).map((path) => {
    const doc = context.document(path);
    const lines = [...doc.lines];
    const perLine = new Map();
    for (const record of groups.get(path)) {
      if (!perLine.has(record.line)) perLine.set(record.line, []);
      perLine.get(record.line).push(record);
    }
    for (const [number, group] of perLine) {
      group.sort((a, b) => a.edit.from - b.edit.from);
      lines[number - 1] = rewriteLine(lines[number - 1], group.map((record) => record.edit));
      let shift = 0;
      for (const record of group) {
        const back = tokenAt(lines[number - 1], record.at + shift, record.file);
        if (back === null || back.start !== record.to.start || back.end !== record.to.end) {
          throw new Error(`the rewritten citation in ${path} does not read back as ${record.newToken}`);
        }
        shift += record.edit.text.length - (record.edit.to - record.edit.from);
      }
    }
    const next = Buffer.from(lines.join('\n'), 'utf8');
    return { path, sha256: doc.sha256, nextSha256: sha256(next), next };
  });
}

export function plan(rev) {
  const base = resolveBase(rev);
  const lockBytes = readFileSync(LOCK);
  const lock = JSON.parse(lockBytes.toString('utf8'));
  const { found, localOnly } = collect();
  const context = { base, document: documentReader(), diffOf: diffReader(base) };
  const counts = { unchanged: 0, fresh: 0, pinned: 0, localOnly: localOnly.length };
  const held = [];
  const drifted = [];
  for (const o of found) {
    const want = Object.hasOwn(lock, o.key) ? lock[o.key] : null;
    if (o.legacySource !== null) {
      counts.pinned += 1;
    } else if (want === null) {
      counts.fresh += 1;
    } else {
      held.push(o);
      if (o.fp !== null && o.fp === want.fp) {
        counts.unchanged += 1;
      } else {
        drifted.push(resolveCitation(o, want, context));
      }
    }
  }
  const records = guardOverlap(drifted, held)
    .sort((a, b) => compare(a.document, b.document) || a.line - b.line || a.at - b.at);
  return {
    base,
    lockSha256: sha256(lockBytes),
    counts,
    records,
    docs: rewrittenDocuments(records, context),
  };
}

// The digest binds the base, the lock, each document before and after, and every
// verdict, so an approval cannot be replayed against a different tree.
export function digestOf({ base, lockSha256, docs, records }) {
  const hash = createHash('sha256');
  const add = (...parts) => hash.update(`${parts.join('\t')}\n`);
  add('relocate-anchors', '1', base, lockSha256);
  for (const doc of docs) add('doc', doc.path, doc.sha256, doc.nextSha256);
  for (const r of records) add(r.verdict, r.document, r.line, r.at, r.oldToken, r.newToken ?? '', r.reason ?? '');
  return hash.digest('hex');
}

function writeAtomic(path, bytes) {
  const temporary = resolve(dirname(path), `.relocate-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    chmodSync(temporary, lstatSync(path).mode & 0o777);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

// No rollback: a half-finished rollback would be an untested recovery path of
// its own. The error names what was already rewritten and a rerun recomputes
// against what is on disk.
function applyPlan(planned) {
  const done = [];
  try {
    for (const doc of planned.docs) {
      writeAtomic(doc.path, doc.next);
      done.push(doc.path);
      if (!readFileSync(doc.path).equals(doc.next)) throw new Error(`${doc.path} reads back differently from the planned text`);
    }
  } catch (error) {
    error.message = `${error.message} (rewritten before the failure: ${done.join(', ') || 'none'})`;
    throw error;
  }
  return done;
}

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    return 2;
  }
  if (!existsSync(LOCK)) {
    console.error(`FATAL: ${LOCK} not found, run this from the repository root`);
    return 2;
  }
  let planned;
  try {
    planned = plan(args.base);
  } catch (error) {
    console.error(`FATAL: ${error.message}`);
    return 2;
  }
  for (const r of planned.records) {
    const where = `${r.document}:${r.line}`;
    console.log(r.verdict === 'resolve' ? `RELOCATE ${where}  ${r.oldToken} -> ${r.newToken}` : `REFUSE   ${where}  ${r.oldToken}  ${r.reason}`);
  }
  const refused = planned.records.filter((r) => r.verdict === 'refuse').length;
  const resolved = planned.records.length - refused;
  const { counts } = planned;
  console.log(`base ${planned.base}`);
  console.log(`${planned.records.length} drifted live citations: ${resolved} resolved, ${refused} refused`);
  console.log(`${counts.unchanged} unchanged, ${counts.fresh} not in the lock, ${counts.pinned} pinned or historical (out of scope), ${counts.localOnly} local-only (out of scope)`);
  if (refused > 0) {
    console.log('nothing was written, and nothing can be applied while any drifted citation is refused');
    return 1;
  }
  if (resolved === 0) {
    console.log('nothing to relocate');
    return 0;
  }
  const digest = digestOf(planned);
  if (!args.apply) {
    console.log(`digest ${digest}`);
    console.log('to rewrite the citing documents, rerun with --apply --approved-sha256 and that digest');
    return 0;
  }
  if (args.approved !== digest) {
    console.log(`the approved digest does not match this plan (recomputed ${digest}); nothing was written`);
    return 1;
  }
  try {
    const done = applyPlan(planned);
    console.log(`rewrote ${resolved} citations in ${done.length} documents; the lock was not touched`);
    console.log('next: npm run anchors, then npm run anchors:bless and read every pairing it prints against its claim, then npm run anchors again');
  } catch (error) {
    console.error(`FATAL: ${error.message}`);
    return 2;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
