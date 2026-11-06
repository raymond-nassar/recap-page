// Resolve only an in-progress merge conflict whose base, ours and theirs differ
// solely in checked citation numbers. The selected files and their index stages
// are read as evidence; the helper never runs a repository merge or edits the lock.
//
//   node scripts/resolve-anchor-conflicts.mjs --file <path>
//   node scripts/resolve-anchor-conflicts.mjs --file <path> --apply --approved-sha256 <digest>
//
// A preview is the default. Any uncertain target or conflict blocks every write.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  citations,
  commentSyntax,
  explicitSourceMarker,
  fingerprint,
  linesOf,
} from './check-anchors.mjs';
import {
  endByCount,
  findHead,
  mapLine,
  parseHunks,
  rewriteLine,
  tokenAt,
} from './relocate-anchors.mjs';

const LOCK = 'docs/anchors.lock.json';
const MARKER = /^(?:<{7}(?: .*)?|={7}|>{7}(?: .*)?|\|{7}(?: .*)?)$/;
const GIT_ENV = { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' };
const USAGE = [
  'usage: node scripts/resolve-anchor-conflicts.mjs --file <path> [--file <path> ...] [--apply --approved-sha256 <digest>]',
  '  --file <path>             explicitly selected unmerged file; may be repeated',
  '  --apply                   write resolved files; requires the preview digest',
  '  --approved-sha256 <hex>   digest printed by the preview',
  'Run during an in-progress merge. The helper never edits docs/anchors.lock.json.',
].join('\n');

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, {
    encoding,
    env: GIT_ENV,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function validPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('-')
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.includes(':')
    && !value.split('/').some((part) => part === '' || part === '.' || part === '..');
}

export function parseArgs(argv) {
  const args = { files: [], apply: false, approved: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--apply') {
      args.apply = true;
    } else if (flag === '--file' || flag === '--approved-sha256') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`${flag} needs a value`);
      if (flag === '--file') {
        if (!validPath(value)) throw new Error('--file must be a repository-relative path');
        if (args.files.includes(value)) throw new Error(`--file ${value} was given twice`);
        args.files.push(value);
      } else {
        if (args.approved !== null) throw new Error('--approved-sha256 was given twice');
        args.approved = value;
      }
      i += 1;
    } else {
      throw new Error(`unknown argument ${flag}`);
    }
  }
  if (args.files.length === 0) throw new Error('--file <path> is required');
  if (args.approved !== null && !/^[0-9a-f]{64}$/.test(args.approved)) {
    throw new Error('--approved-sha256 must be 64 lowercase hex digits');
  }
  if (args.apply !== (args.approved !== null)) throw new Error('--apply and --approved-sha256 go together');
  return args;
}

function textFrom(bytes, label) {
  const text = bytes.toString('utf8');
  if (text.includes('\0') || !Buffer.from(text, 'utf8').equals(bytes)) {
    throw new Error(`${label} is not valid UTF-8 text`);
  }
  return text;
}

function splitLines(text) {
  return text.split('\n');
}

function cleanLine(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function sameLines(a, b) {
  return a.length === b.length && a.every((line, index) => cleanLine(line) === cleanLine(b[index]));
}

function hasConflictMarker(text) {
  return text.split(/\r?\n/).some((line) => MARKER.test(line));
}

function parseMarkers(text, path) {
  const lines = splitLines(text);
  const blocks = [];
  const segments = [];
  let cursor = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!cleanLine(lines[i]).startsWith('<<<<<<< ')) continue;
    segments.push(lines.slice(cursor, i));
    const start = i;
    const ours = [];
    const base = [];
    const theirs = [];
    i += 1;
    while (i < lines.length
      && !cleanLine(lines[i]).startsWith('=======')
      && !cleanLine(lines[i]).startsWith('||||||| ')) {
      if (MARKER.test(cleanLine(lines[i]))) throw new Error(`${path} has nested or malformed conflict markers`);
      ours.push(lines[i]);
      i += 1;
    }
    let hasBase = false;
    if (i < lines.length && cleanLine(lines[i]).startsWith('||||||| ')) {
      hasBase = true;
      i += 1;
      while (i < lines.length && !cleanLine(lines[i]).startsWith('=======')) {
        if (MARKER.test(cleanLine(lines[i]))) throw new Error(`${path} has nested or malformed conflict markers`);
        base.push(lines[i]);
        i += 1;
      }
    }
    if (i >= lines.length || cleanLine(lines[i]) !== '=======') {
      throw new Error(`${path} has an unterminated conflict block`);
    }
    i += 1;
    while (i < lines.length && !cleanLine(lines[i]).startsWith('>>>>>>> ')) {
      if (MARKER.test(cleanLine(lines[i]))) throw new Error(`${path} has nested or malformed conflict markers`);
      theirs.push(lines[i]);
      i += 1;
    }
    if (i >= lines.length) throw new Error(`${path} has an unterminated conflict block`);
    blocks.push({ start, end: i + 1, ours, theirs, base: hasBase ? base : null });
    cursor = i + 1;
  }
  if (blocks.length === 0) throw new Error(`${path} has no supported conflict markers`);
  segments.push(lines.slice(cursor));
  return { lines, blocks, segments };
}

function locateSequence(haystack, needle) {
  if (needle.length === 0) return null;
  const matches = [];
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    if (needle.every((line, index) => cleanLine(line) === cleanLine(haystack[i + index]))) matches.push(i);
  }
  return matches.length === 1 ? matches[0] : null;
}

function diffHunks(oldBytes, newBytes) {
  const directory = mkdtempSync(resolve(tmpdir(), 'mrt-anchor-conflict-'));
  const before = resolve(directory, 'base.txt');
  const after = resolve(directory, 'side.txt');
  try {
    writeFileSync(before, oldBytes);
    writeFileSync(after, newBytes);
    const result = spawnSync('git', [
      'diff',
      '--no-index',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--unified=0',
      '--',
      before,
      after,
    ], { encoding: 'utf8', env: GIT_ENV, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1) {
      throw new Error((result.stderr || 'git diff could not compare the merge inputs').trim());
    }
    return parseHunks(result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function baseSpanFor(blockLines, stageLines, hunks, path, side) {
  const index = locateSequence(stageLines, blockLines);
  if (index === null) throw new Error(`${path} ${side} conflict text is not unique in its index stage`);
  const start = index + 1;
  const matches = hunks.filter((hunk) => hunk.c === start && hunk.d === blockLines.length);
  if (matches.length !== 1) throw new Error(`${path} ${side} conflict text does not map to one exact diff hunk`);
  const [hunk] = matches;
  if (hunk.b === 0 || hunk.a < 1 || hunk.b !== blockLines.length || hunk.a + hunk.b - 1 < hunk.a) {
    throw new Error(`${path} ${side} conflict hunk has no one-to-one base lines`);
  }
  return { start: hunk.a, end: hunk.a + hunk.b - 1 };
}

function normalizedLines(lines, path) {
  const syntax = commentSyntax(path);
  return lines.map((raw) => {
    const line = cleanLine(raw);
    const edits = [];
    for (const citation of citations(line, syntax)) {
      const token = tokenAt(line, citation.at, citation.file);
      if (token === null) throw new Error(`${path} contains a malformed citation token`);
      edits.push({
        from: token.from,
        to: token.to,
        text: token.dashed ? 'N-N' : 'N',
      });
    }
    return rewriteLine(line, edits);
  });
}

function citationRows(lines, path) {
  const syntax = commentSyntax(path);
  const rows = [];
  lines.forEach((raw, lineIndex) => {
    for (const citation of citations(cleanLine(raw), syntax)) {
      const token = tokenAt(cleanLine(raw), citation.at, citation.file);
      if (token === null) throw new Error(`${path} contains a malformed citation token`);
      rows.push({ ...citation, line: lineIndex, dashed: token.dashed });
    }
  });
  return rows;
}

function lockEvidence(lock, document, citation, base) {
  const anchor = `${citation.file}:${citation.start}${citation.end === citation.start ? '' : `-${citation.end}`}`;
  const candidates = Object.entries(lock)
    .filter(([key, value]) => key.startsWith(`${document}|`) && value.anchor === anchor)
    .map(([, value]) => ({ fp: value.fp, head: value.head }));
  const identities = new Map(candidates.map((candidate) => [`${candidate.fp}\0${candidate.head}`, candidate]));
  if (identities.size !== 1) throw new Error(`${document} has no unique lock evidence for ${anchor}`);
  const [want] = identities.values();
  if (typeof want.head !== 'string') throw new Error(`${document} lock evidence for ${anchor} has no head`);
  const found = fingerprint(citation.file, citation.start, citation.end, base);
  if (found.fp === null || found.fp !== want.fp || found.head !== want.head || found.blankEdge) {
    throw new Error(`${document} lock evidence for ${anchor} does not match the merge base`);
  }
  return want;
}

function mapTarget(document, citation, want, base) {
  if (lstatSync(citation.file).isSymbolicLink()) {
    throw new Error(`${document} cites symbolic-link target ${citation.file}`);
  }
  const targetBytes = readFileSync(citation.file);
  const targetText = textFrom(targetBytes, citation.file);
  if (hasConflictMarker(targetText)) {
    throw new Error(`${document} cites conflicted target ${citation.file}`);
  }
  const beforeLines = linesOf(citation.file, base);
  const currentLines = splitLines(targetText);
  if (beforeLines === null) throw new Error(`${document} target ${citation.file} is missing at the merge base`);
  const diff = git(['diff', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', base, '--', citation.file]);
  const hunks = parseHunks(diff);
  const heads = findHead(currentLines, want.head);
  if (heads.length !== 1) throw new Error(`${document} target ${citation.file} has ${heads.length} matching head lines`);
  const start = heads[0];
  const count = beforeLines.slice(citation.start - 1, citation.end).filter((line) => line.trim() !== '').length;
  const end = endByCount(currentLines, start, count);
  const mappedStart = mapLine(hunks, citation.start);
  const mappedEnd = mapLine(hunks, citation.end);
  if (end === null || mappedStart === null || mappedEnd === null || mappedStart !== start || mappedEnd !== end) {
    throw new Error(`${document} target ${citation.file} movement is ambiguous`);
  }
  const after = fingerprint(citation.file, start, end, null);
  if (after.fp !== want.fp || after.blankEdge) throw new Error(`${document} target ${citation.file} content does not match the lock`);
  if (!citation.dashed && start !== end) throw new Error(`${document} single-line citation would become a range`);
  return { start, end };
}

function resolveBlock(block, baseLines, oursLines, theirsLines, path, lock, base) {
  if (baseLines.length !== oursLines.length || baseLines.length !== theirsLines.length) {
    throw new Error(`${path} conflict changes line structure`);
  }
  const normalized = [baseLines, oursLines, theirsLines].map((lines) => normalizedLines(lines, path));
  if (!sameLines(normalized[0], normalized[1]) || !sameLines(normalized[0], normalized[2])) {
    throw new Error(`${path} conflict changes non-citation text`);
  }
  const baseCitations = citationRows(baseLines, path);
  const oursCitations = citationRows(oursLines, path);
  const theirsCitations = citationRows(theirsLines, path);
  if (baseCitations.length === 0) throw new Error(`${path} conflict contains no checked citations`);
  if (baseCitations.length !== oursCitations.length || baseCitations.length !== theirsCitations.length) {
    throw new Error(`${path} conflict changes its citation set`);
  }

  let changed = false;
  const mapped = [];
  for (let i = 0; i < baseCitations.length; i += 1) {
    const original = baseCitations[i];
    const ours = oursCitations[i];
    const theirs = theirsCitations[i];
    if (original.file !== ours.file || original.file !== theirs.file
      || original.dashed !== ours.dashed || original.dashed !== theirs.dashed
      || original.line !== ours.line || original.line !== theirs.line) {
      throw new Error(`${path} conflict citation positions or forms do not match`);
    }
    if (ours.start !== theirs.start || ours.end !== theirs.end
      || original.start !== ours.start || original.end !== ours.end) changed = true;
    const want = lockEvidence(lock, path, original, base);
    mapped.push({ citation: original, range: mapTarget(path, original, want, base) });
  }
  if (!changed) throw new Error(`${path} conflict has no citation renumbering to resolve`);

  const editsByLine = new Map();
  for (const { citation, range } of mapped) {
    const raw = oursLines[citation.line];
    const line = cleanLine(raw);
    const token = tokenAt(line, citation.at, citation.file);
    if (token === null) throw new Error(`${path} resolved citation no longer reads back`);
    const text = token.dashed ? `${range.start}-${range.end}` : String(range.start);
    if (!editsByLine.has(citation.line)) editsByLine.set(citation.line, []);
    editsByLine.get(citation.line).push({ from: token.from, to: token.to, text });
  }
  const output = [...oursLines];
  for (const [lineIndex, edits] of editsByLine) {
    const raw = output[lineIndex];
    const line = cleanLine(raw);
    output[lineIndex] = `${rewriteLine(line, edits)}${raw.endsWith('\r') ? '\r' : ''}`;
  }
  return output;
}

function activeMerge() {
  if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    throw new Error('a shallow repository cannot establish merge provenance');
  }
  const theirs = git(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD^{commit}']).trim();
  const bases = git(['merge-base', '--all', 'HEAD', theirs]).trim().split(/\r?\n/).filter(Boolean);
  if (bases.length !== 1) throw new Error(`the active merge has ${bases.length} merge bases, not one`);
  return { ours: git(['rev-parse', '--verify', 'HEAD^{commit}']).trim(), theirs, base: bases[0] };
}

function readStage(stage, path) {
  try {
    return git(['show', `:${stage}:${path}`], 'buffer');
  } catch {
    throw new Error(`${path} is missing index stage ${stage}`);
  }
}

function planFile(path, merge, lock) {
  if (path === LOCK) throw new Error('the anchors lock is never edited by this helper');
  const baseBytes = git(['show', `${merge.base}:${path}`], 'buffer');
  const oursBytes = readStage(2, path);
  const theirsBytes = readStage(3, path);
  const stageBaseBytes = readStage(1, path);
  if (!stageBaseBytes.equals(baseBytes)) throw new Error(`${path} stage 1 does not match the merge base`);
  if (!oursBytes.equals(git(['show', `${merge.ours}:${path}`], 'buffer'))) throw new Error(`${path} stage 2 does not match HEAD`);
  if (!theirsBytes.equals(git(['show', `${merge.theirs}:${path}`], 'buffer'))) throw new Error(`${path} stage 3 does not match MERGE_HEAD`);

  const baseText = textFrom(baseBytes, `${path} base`);
  if (explicitSourceMarker(baseText) !== null) throw new Error(`${path} is pinned and is not a live citation source`);
  const oursLines = splitLines(textFrom(oursBytes, `${path} stage 2`));
  const theirsLines = splitLines(textFrom(theirsBytes, `${path} stage 3`));
  const baseFileLines = splitLines(baseText);
  if (lstatSync(path).isSymbolicLink()) throw new Error(`${path} conflict document is a symbolic link`);
  const currentBytes = readFileSync(path);
  const currentText = textFrom(currentBytes, path);
  const current = parseMarkers(currentText, path);
  const baseDiff = diffHunks(baseBytes, oursBytes);
  const theirsDiff = diffHunks(baseBytes, theirsBytes);
  const lockSha256 = sha256(git(['show', `${merge.base}:${LOCK}`], 'buffer'));
  const candidateLines = [...current.lines];
  const records = [];

  if (current.blocks.length !== current.segments.length - 1) {
    throw new Error(`${path} has malformed conflict boundaries`);
  }
  let lineShift = 0;
  for (let i = 0; i < current.blocks.length; i += 1) {
    const block = current.blocks[i];
    const oursAt = locateSequence(oursLines, block.ours);
    const theirsAt = locateSequence(theirsLines, block.theirs);
    if (oursAt === null || theirsAt === null) {
      throw new Error(`${path} worktree conflict sides do not uniquely match index stages`);
    }
    const oursSpan = baseSpanFor(block.ours, oursLines, baseDiff, path, 'ours');
    const theirsSpan = baseSpanFor(block.theirs, theirsLines, theirsDiff, path, 'theirs');
    if (oursSpan.start !== theirsSpan.start || oursSpan.end !== theirsSpan.end) {
      throw new Error(`${path} sides do not refer to the same base lines`);
    }
    const baseBlock = baseFileLines.slice(oursSpan.start - 1, oursSpan.end);
    if (baseBlock.length !== block.ours.length) throw new Error(`${path} base conflict range is incomplete`);
    if (block.base !== null && !sameLines(block.base, baseBlock)) {
      throw new Error(`${path} displayed base conflict text differs from stage 1`);
    }
    const resolved = resolveBlock(block, baseBlock, block.ours, block.theirs, path, lock, merge.base);
    const start = block.start + lineShift;
    candidateLines.splice(start, block.end - block.start, ...resolved);
    lineShift += resolved.length - (block.end - block.start);
    for (const citation of citationRows(baseBlock, path)) {
      records.push(`${path}:${oursSpan.start + citation.line} ${citation.file}:${citation.start} -> ${citation.file}:${mapTarget(path, citation, lockEvidence(lock, path, citation, merge.base), merge.base).start}`);
    }
  }

  const next = Buffer.from(candidateLines.join('\n'), 'utf8');
  if (hasConflictMarker(next.toString('utf8'))) throw new Error(`${path} still contains conflict markers after resolution`);
  return {
    path,
    sha256: sha256(currentBytes),
    nextSha256: sha256(next),
    lockSha256,
    stages: [stageBaseBytes, oursBytes, theirsBytes].map(sha256),
    next,
    records,
  };
}

export function plan(files) {
  const merge = activeMerge();
  const lockBytes = git(['show', `${merge.base}:${LOCK}`], 'buffer');
  const lock = JSON.parse(textFrom(lockBytes, LOCK));
  const records = [];
  const docs = [];
  for (const path of files) {
    try {
      const doc = planFile(path, merge, lock);
      docs.push(doc);
      records.push(...doc.records.map((line) => ({ verdict: 'resolve', line })));
    } catch (error) {
      records.push({ verdict: 'refuse', line: `${path}  ${error.message}` });
    }
  }
  docs.sort((a, b) => compare(a.path, b.path));
  return {
    merge,
    lockSha256: sha256(lockBytes),
    records,
    docs,
  };
}

export function digestOf({ merge, lockSha256, docs, records }) {
  const hash = createHash('sha256');
  const add = (...parts) => hash.update(`${parts.join('\t')}\n`);
  add('resolve-anchor-conflicts', '1', merge.base, merge.ours, merge.theirs, lockSha256);
  for (const doc of docs) {
    add('doc', doc.path, doc.sha256, doc.nextSha256, ...doc.stages);
  }
  for (const record of records) add(record.verdict, record.line);
  return hash.digest('hex');
}

function writeAtomic(path, bytes) {
  const temporary = resolve(dirname(path), `.anchor-conflict-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    chmodSync(temporary, lstatSync(path).mode & 0o777);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function applyPlan(planned) {
  for (const doc of planned.docs) {
    if (sha256(readFileSync(doc.path)) !== doc.sha256) {
      throw new Error(`${doc.path} changed after preview; nothing was written`);
    }
    const currentStages = [1, 2, 3].map((stage) => sha256(readStage(stage, doc.path)));
    if (!currentStages.every((value, index) => value === doc.stages[index])) {
      throw new Error(`${doc.path} index stages changed after preview; nothing was written`);
    }
  }
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
}

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    return 2;
  }
  let planned;
  try {
    planned = plan(args.files);
  } catch (error) {
    console.error(`FATAL: ${error.message}`);
    return 2;
  }
  for (const record of planned.records) {
    console.log(record.verdict === 'resolve' ? `RESOLVE ${record.line}` : `REFUSE  ${record.line}`);
  }
  const refused = planned.records.filter((record) => record.verdict === 'refuse').length;
  console.log(`base ${planned.merge.base}`);
  console.log(`${planned.docs.length} files resolved, ${refused} refusals`);
  if (refused > 0) {
    console.log('nothing was written because at least one selected file was refused');
    return 1;
  }
  if (planned.docs.length === 0) {
    console.log('nothing to resolve');
    return 0;
  }
  const digest = digestOf(planned);
  if (!args.apply) {
    console.log(`digest ${digest}`);
    console.log('to write the resolved files, rerun with --apply --approved-sha256 and that digest');
    return 0;
  }
  if (args.approved !== digest) {
    console.log(`approved digest does not match this plan (recomputed ${digest}); nothing was written`);
    return 1;
  }
  try {
    applyPlan(planned);
  } catch (error) {
    console.error(`FATAL: ${error.message}`);
    return 2;
  }
  console.log(`rewrote ${planned.docs.length} selected files; the anchors lock was not touched`);
  console.log('stage the resolved files, then resolve the anchors lock separately and run the normal anchors check');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
