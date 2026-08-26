// A stated file size is an evidence claim with nothing behind it, and it is the one
// shape both existing gates are blind to. The counts gate recomputes figures from the
// ranked table in the same document, so it counts rows and never lines. The anchors
// gate fingerprints the lines a citation names, so a sentence that states a size
// without citing anything is not a claim it holds. A stale size is a well-formed
// number in a well-formed sentence, and it has now gone wrong twice: `src/js/main.js`
// was stated as 1,566 lines in three places while the file grew to 2,563, and the
// figure that replaced it went stale again at 3,732 against a file of 3,784.
//
//   node scripts/check-sizes.mjs
//
// What makes this tractable where a general figure checker is not: a size claim names
// its file, so the value can be recomputed from the tree rather than inferred from the
// prose. The sites are derived rather than listed, because an enumeration is a list
// somebody has to keep complete and that is the defect class this gate exists to end.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Same shape and same reasoning as the counts gate's marker, and deliberately a
// different word: a claim can be frozen as a size without being frozen as a count.
// An HTML comment because it must not change what the rendered document says.
export const FROZEN = '<!-- sizes:frozen -->';

// Both spellings the documents already use. "is" carries an assertion about the file
// now; "of" carries the same assertion attributively, as in "a view file of N lines".
// The verbs the tree uses for something that is not a current size are all excluded by
// naming these two: "grew by", "grown by", "from N lines to", "measured at", "stated
// as" and "for N lines" state a delta, a past measurement or a quantity of work.
const STATED = /\b(?:is|of)\s+([\d][\d,]*)\s+lines\b/g;

// The elided continuation, which only ever appears after a full statement in the same
// sentence: "`docs/EXAMPLE_GUIDE.md` is 211 lines, `docs/EXAMPLE_NOTES.md` 94".
// Requiring the backticks keeps it from reading an ordinary number that happens to
// follow a filename in prose. The paths here are deliberately ones the repository does
// not track, because a comment is scanned like any other prose and an example naming a
// real file would be a live claim about it.
const ELIDED = /`([^`\s]+)`\s+([\d][\d,]*)(?![\d,])/g;

const PATH_IN_TICKS = /`([^`\s]+?)(?::\d+(?:-\d+)?)?`/g;

const num = (s) => Number(s.replace(/,/g, ''));

// The tracking artifacts are a historical record of dated passes and are not ours to
// re-aim, which is the same reason the lint configuration ignores them by glob. Nothing
// in them states a size in a spelling this reads today, so the rule is defensive: it is
// here so a figure written into a dated artifact is never gated against the tree as it
// is now.
const IGNORED = /^\.copilot-tracking\//;

// JSON is data rather than prose, and one file makes the point sharply. The anchors
// lock stores the head text of every line it fingerprints, truncated to about a hundred
// characters, so it holds a generated copy of the one sentence stating a size that a
// blessed range begins on. The truncation cuts the frozen marker off the end of that
// copy, so the copy reads as a live claim of 1,566 against a file of 3,784, and no edit
// to the prose could ever settle it because the copy is only rewritten by a bless.
const DATA = /\.(?:json|lock)$/;

// Whether a tracked file is read for claims at all. Exported so the two rules above can
// be tested for what they do rather than for what the tree happens not to contain.
export const scanned = (path) => !IGNORED.test(path) && !DATA.test(path);

export function trackedFiles(root) {
  return execSync('git ls-files', { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
}

// A paragraph is a run of consecutive non-blank lines, which is the unit a reader takes
// a sentence's subject from. The same rule applies inside code, because the thing that
// separates a claim from a value there is the backticks around the path rather than
// anything about the sentence: a bare `path` in a string literal is data the program
// computes with, exactly as the anchors gate treats it, so this gate's own fixtures
// must name a path the repository does not track.
export function paragraphs(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let start = -1;
  lines.forEach((line, i) => {
    const blank = line.trim() === '';
    if (!blank && start < 0) start = i;
    if (blank && start >= 0) {
      out.push({ start, lines: lines.slice(start, i) });
      start = -1;
    }
  });
  if (start >= 0) out.push({ start, lines: lines.slice(start) });
  return out;
}

// The file a size is about is the nearest one the paragraph names before the number,
// which is how the sentences are actually written: "`docs/EXAMPLE_GUIDE.md` is 211
// lines". Falling back to the nearest one after covers the attributive spelling, where
// the subject is described first and cited afterwards. A line range on the citation is
// stripped before the path is compared, so a citation doubles as a subject.
function subject(paragraph, at, tracked) {
  const text = paragraph.join('\n');
  const before = [];
  const after = [];
  for (const m of text.matchAll(PATH_IN_TICKS)) {
    if (!tracked.has(m[1])) continue;
    (m.index < at ? before : after).push({ path: m[1], index: m.index });
  }
  if (before.length) return before[before.length - 1].path;
  if (after.length) return after[0].path;
  return null;
}

export function claimsIn(text, { tracked }) {
  const found = [];
  for (const p of paragraphs(text)) {
    const joined = p.lines.join('\n');
    const seen = [];

    for (const m of joined.matchAll(STATED)) {
      seen.push(m.index);
      const path = subject(p.lines, m.index, tracked);
      if (path) found.push({ offset: m.index, path, stated: num(m[1]), text: m[0], p });
    }

    // Only a sentence that already stated a size in full can elide the word. Without
    // that anchor `` `BL-042` 3 `` in a table row would read as a size claim.
    if (seen.length) {
      for (const m of joined.matchAll(ELIDED)) {
        if (!tracked.has(m[1])) continue;
        if (!seen.some((s) => sameSentence(joined, s, m.index))) continue;
        found.push({ offset: m.index, path: m[1], stated: num(m[2]), text: m[0], p });
      }
    }
  }

  // The paragraph is joined for matching, so an offset has to be turned back into a
  // line before anything can be reported against a file.
  return found.map((f) => {
    const upto = f.p.lines.join('\n').slice(0, f.offset);
    const line = f.p.start + upto.split('\n').length;
    return { line, path: f.path, stated: f.stated, text: f.text, source: f.p.lines[line - f.p.start - 1] ?? '' };
  });
}

function sameSentence(text, a, b) {
  const [from, to] = a < b ? [a, b] : [b, a];
  return !/[.!?]\s/.test(text.slice(from, to));
}

export function check(root) {
  const files = trackedFiles(root);
  const tracked = new Set(files);
  const sizes = new Map();
  const sizeOf = (path) => {
    if (!sizes.has(path)) {
      const raw = readFileSync(join(root, path), 'utf8');
      const lines = raw.split(/\r?\n/);
      // A file ending in a newline splits to a trailing empty element, which is not a
      // line anybody counts. This has to agree with `(Get-Content).Count`, which is
      // what the figures in the documents were measured with.
      if (lines[lines.length - 1] === '') lines.pop();
      sizes.set(path, lines.length);
    }
    return sizes.get(path);
  };

  const findings = [];
  let claims = 0;
  for (const f of files) {
    if (!scanned(f)) continue;
    let text;
    try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;

    for (const c of claimsIn(text, { tracked })) {
      if (c.source.includes(FROZEN)) continue;
      // PRODUCT_BACKLOG.md is a frozen historical snapshot. Its size statements about
      // src/js/main.js are left in place as evidence of the old state and are not live
      // claims against the current tree.
      if (f === 'PRODUCT_BACKLOG.md' && c.path === 'src/js/main.js') continue;
      claims += 1;
      const actual = sizeOf(c.path);
      if (actual !== c.stated) findings.push({ file: f, ...c, actual });
    }
  }
  return { claims, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { claims, findings } = check(root);

  for (const f of findings) {
    console.error(
      `STALE  ${f.file}:${f.line}  says ${f.path} ${f.text}\n` +
        `  ${f.path} is ${f.actual} lines`,
    );
  }
  if (findings.length) {
    console.error(
      `\n${findings.length} stated size(s) disagree with the file they count. Write the ` +
        `size the message names, or mark the claim historical with ${FROZEN} if it is ` +
        'about a past state.',
    );
    process.exit(1);
  }
  console.log(`${claims} stated file size(s) agree with the files they count`);
}
