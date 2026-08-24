// A count stated in prose is an evidence claim with nothing behind it. The anchors
// gate ended that for `path:line` citations by fingerprinting the lines they name,
// and a wrong count reads exactly like a right one for the same reason a wrong
// anchor did: nothing recomputes it. One figure in the backlog survived twelve
// consecutive shipped items with every gate green, and the pass that went looking
// for stale figures missed one it was explicitly hunting.
//
//   node scripts/check-counts.mjs
//
// Scope is the machine-checkable subset, not a general one. Every figure this gate
// knows about is derived from the ranked table in the same file, so it can be
// recomputed and compared. A general checker would have to decide which number in
// any English sentence is derived and from what, which is not tractable, so claims
// are recognised by rigid syntactic form rather than by reading the prose around
// them. Figures that need the tree rather than the table are out of scope here, and
// one class of them is now covered by a sibling gate: a stated file size names its
// file, so `scripts/check-sizes.mjs` recomputes it from the tree by the same
// rigid-form rule. The test total is not covered by either, because a sentence
// stating one names nothing that can be counted without running the suite.
//
// What it cannot do is decide whether a figure was right when it was written. It
// compares the prose against the table, so a table that is itself wrong will be
// agreed with.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DOC = 'PRODUCT_BACKLOG.md';

// A claim about a past state cites a count that is expected to disagree, exactly as
// a historical `path:line` citation does, and Appendix B carries one: BL-028's rank
// of 15 of 28 is what the ranking pass computed and is not a claim about the table
// now. The marker states that intent in the source, so a new frozen claim written
// without it fails loudly, which is the right direction to fail in. It is an HTML
// comment because it must not change what the rendered document says: a prose marker
// would mean editing the sentence to satisfy a checker.
export const FROZEN = '<!-- counts:frozen -->';

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty',
];

const ORDINAL_WORDS = [
  'zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth',
  'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth',
  'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth',
];

const TENS = {
  20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty', 70: 'seventy',
  80: 'eighty', 90: 'ninety',
};
const ORDINAL_TENS = {
  20: 'twentieth', 30: 'thirtieth', 40: 'fortieth', 50: 'fiftieth', 60: 'sixtieth',
  70: 'seventieth', 80: 'eightieth', 90: 'ninetieth',
};

// Spelled out because the document spells them out. Returning null above the top of the
// range rather than falling back to digits keeps the failure visible: a backlog that outgrows
// this wants the range extended, not a checker that quietly stops checking. It has
// outgrown it twice, when the seventieth item shipped and five tests went red at
// the same moment as the gate, and again when filing BL-124 made the ranked table a
// hundred rows long, so the extension is what the ceiling is for rather than a
// sign it was set wrong.
//
// The band above ninety-nine reads "a hundred and ninety-three" rather than "one hundred and
// ninety-three" because that is how the backlog already writes a figure of that size, at
// `PRODUCT_BACKLOG.md:2657`. Both are correct English and only one of them matches the
// document, which is the only thing these words are for. The ceiling stops below two hundred
// because no document here writes a figure that large, so its wording would be guessed
// rather than matched, and a guess is what the null is here to prevent.
const inHundreds = (n, exact, word) => {
  if (n >= 200) return null;
  if (n % 100 === 0) return exact;
  const rest = word(n % 100);
  return rest === null ? null : `a hundred and ${rest}`;
};

export function numberWord(n) {
  if (n >= 0 && n <= 20) return NUMBER_WORDS[n];
  if (n >= 100) return inHundreds(n, 'a hundred', numberWord);
  const tens = Math.floor(n / 10) * 10;
  const unit = n % 10;
  if (!TENS[tens]) return null;
  return unit === 0 ? TENS[tens] : `${TENS[tens]}-${NUMBER_WORDS[unit]}`;
}

export function ordinalWord(n) {
  if (n >= 0 && n <= 20) return ORDINAL_WORDS[n];
  if (n >= 100) return inHundreds(n, 'hundredth', ordinalWord);
  const tens = Math.floor(n / 10) * 10;
  const unit = n % 10;
  if (!TENS[tens]) return null;
  return unit === 0 ? ORDINAL_TENS[tens] : `${TENS[tens]}-${ORDINAL_WORDS[unit]}`;
}

const titleCase = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// The ranked table, the parked table and the detail blocks are three regions of one
// document. Locating them by heading rather than by line number is what keeps this
// gate from needing a re-aim every time the document grows, which is the failure mode
// it exists to prevent rather than to reproduce.
export function locate(lines) {
  const at = (re) => {
    const i = lines.findIndex((l) => re.test(l));
    return i === -1 ? null : i;
  };
  return {
    backlog: at(/^## The backlog\s*$/),
    parked: at(/^### Parked\s*$/),
    details: at(/^## Item details\s*$/),
  };
}

function rowsIn(lines, from, to) {
  const rows = [];
  for (let i = from; i < to; i += 1) {
    if (!/^\|\s*BL-\d+\s*\|/.test(lines[i])) continue;
    const cells = lines[i].split('|').map((c) => c.trim());
    rows.push({ id: cells[1], wsjf: cells[10], status: cells[13], line: i + 1 });
  }
  return rows;
}

export function derive(text) {
  const lines = text.split(/\r?\n/);
  const { backlog, parked, details } = locate(lines);
  if (backlog === null || parked === null || details === null) {
    throw new Error(
      'cannot locate the three regions of the document: expected "## The backlog", ' +
        '"### Parked" and "## Item details" headings',
    );
  }

  const ranked = rowsIn(lines, backlog, parked);
  const parkedRows = rowsIn(lines, parked, details);

  const rank = new Map();
  ranked.forEach((r, i) => rank.set(r.id, i + 1));

  const status = {};
  for (const r of [...ranked, ...parkedRows]) status[r.status] = (status[r.status] ?? 0) + 1;

  const headings = [];
  lines.forEach((l, i) => {
    const m = /^\*\*(BL-\d+):/.exec(l);
    if (m) headings.push({ id: m[1], line: i + 1 });
  });

  return {
    lines,
    ranked,
    parkedRows,
    rank,
    status,
    headings,
    shipped: ranked.filter((r) => r.status === 'Shipped').map((r) => r.id),
  };
}

// The subject of a rank claim is read from the line that states it where the document
// names it there, and from the nearest preceding heading where it does not. Both forms
// are in use. The rule is fixed rather than a search, because a guess about which item
// a number refers to is the kind of corroborating detail that makes a wrong report
// persuasive.
function subjectOf(lines, i) {
  const here = /(BL-\d+)/.exec(lines[i]);
  if (here) return here[1];
  for (let j = i; j >= 0; j -= 1) {
    if (/^#{2,4} /.test(lines[j])) return /(BL-\d+)/.exec(lines[j])?.[1] ?? null;
  }
  return null;
}

// Each check returns findings rather than printing them, so the tests can assert on
// what was found rather than on what reached a terminal.
export function checkRanks(d) {
  const found = [];
  const total = d.ranked.length;
  d.lines.forEach((line, i) => {
    if (line.includes(FROZEN)) return;
    for (const m of line.matchAll(/rank (\d+) of (\d+)/g)) {
      const n = Number(m[1]);
      const of = Number(m[2]);
      const id = subjectOf(d.lines, i);
      if (of !== total) {
        found.push({
          line: i + 1,
          claim: m[0],
          message: `states a table of ${of} rows; the ranked table has ${total}`,
        });
      }
      if (id && !d.rank.has(id)) {
        found.push({
          line: i + 1,
          claim: m[0],
          message: `names ${id}, which is not a row in the ranked table`,
        });
      } else if (id && d.rank.get(id) !== n) {
        found.push({
          line: i + 1,
          claim: m[0],
          message: `puts ${id} at rank ${n}; the table puts it at ${d.rank.get(id)}`,
        });
      }
    }
  });
  return found;
}

// A number word is a single token below a hundred and a phrase above it: "a hundred and two",
// or "hundredth" for the ordinal of a round hundred. A pattern reading only the first token
// captures "a", compares that against the whole phrase, and reports drift that no wording of
// the sentence could ever satisfy. Every reader of a number word below is built from this one
// fragment rather than repeating it, because a reader that stops short of what numberWord()
// writes is the defect, and it is the silent kind: two of the three skip the claim rather than
// failing it, so the gate goes quiet exactly where it should be loudest.
export const WORD = '[A-Za-z]+(?:-[a-z]+)?(?: hundred(?: and [a-z]+(?:-[a-z]+)?)?)?';

const RANKS = new RegExp(`^#{2,4} .*?(BL-\\d+).*?\\branks (${WORD})\\b`);

export function checkOrdinalHeadings(d) {
  const found = [];
  d.lines.forEach((line, i) => {
    if (line.includes(FROZEN)) return;
    const m = RANKS.exec(line);
    if (!m) return;
    const [, id, word] = m;
    if (!d.rank.has(id)) {
      found.push({
        line: i + 1,
        claim: `ranks ${word}`,
        message: `names ${id}, which is not a row in the ranked table`,
      });
      return;
    }
    const want = ordinalWord(d.rank.get(id));
    if (word !== want) {
      found.push({
        line: i + 1,
        claim: `ranks ${word}`,
        message: `spells ${id}'s rank as ${word}; the table puts it ${want}`,
      });
    }
  });
  return found;
}

// A cohort is the set of rows an id range names, and the roadmap makes the same two
// statements about more than one of them: how many are still `Ready`, and which have
// shipped. BL-059 derived those for the whole table by matching the one sentence that
// made them, so the second paragraph making them stayed prose and went stale as its
// items shipped, with every gate green. The fix was written to a sentence rather than
// to the shape of a sentence, which is the defect worth recording here.
//
// So the subject of a ledger claim is resolved the way `subjectOf` resolves the subject
// of a rank claim, by the nearest preceding mention, and a claim with no range before it
// is about the ranked table as a whole, which is what "the table below" names.
const RANGE = /`?(BL-\d+)`? through `?(BL-\d+)`?/g;

// Scoped to the roadmap above the table, which is the only region that introduces a
// cohort. Outside it the nearest preceding range can be thousands of lines back and mean
// nothing about the sentence it would be attached to, and a detail block that quotes the
// shape of one of these sentences would be read as making it. BL-105's own block quotes
// both shapes, three times between them, which is how the boundary came to be measured
// rather than assumed.
export function roadmap(d) {
  const end = locate(d.lines).backlog;
  return d.lines.slice(0, end === null ? d.lines.length : end);
}

// Both sentences wrap, and one of them breaks between "have since been" and "delivered",
// so a claim cannot be matched line by line. Matching the region as one string and
// mapping the offset back is what lets the shape be written as it reads.
function flatten(lines) {
  const starts = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  return {
    text: lines.join(' '),
    lineOf(offset) {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    },
  };
}

// A figure is recognised only when it is written as a number word, which is what keeps a
// quotation of the shape from being read as an instance of it: the backlog states the
// forms as "N items have since been delivered" and "N of them are still `Ready`", and N
// is not a number. The skip has to take the whole claim with it rather than the figure
// alone, because reading an id list out of a sentence that states no figure finds no ids
// and reports every Shipped row missing. That is wider than it sounds, and review measured
// what it costs: writing the opening count as a digit stopped the gate checking that
// paragraph's id list as well, silently, where the sentence-anchored version it replaced
// still caught a dropped id. So the backstop in `checkLedger` counts only the claims this
// function could read, which turns each of those cases into a finding instead.
export function wordNumber(word) {
  const w = (word ?? '').toLowerCase();
  for (let n = 0; numberWord(n) !== null; n += 1) if (numberWord(n) === w) return n;
  return null;
}

function cohortAt(cohorts, offset) {
  let best = null;
  for (const c of cohorts) {
    if (c.at >= offset) break;
    best = c;
  }
  return best;
}

// A range names its items wherever they sit, so a cohort is drawn from both tables while
// the whole-table default is the ranked one alone. They agree today only because every
// parked row is `Dropped`; the difference is real the moment one is not, and the sentence
// that says "in the table below" is the one that means the ranked table.
function rowsOf(d, cohort) {
  if (!cohort) return d.ranked;
  const lo = Number(cohort.from.slice(3));
  const hi = Number(cohort.to.slice(3));
  return [...d.ranked, ...d.parkedRows].filter((r) => {
    const n = Number(r.id.slice(3));
    return n >= lo && n <= hi;
  });
}

// The sentence carrying the claim, which is what the id list is read from. Either side of
// the phrase may hold the list: the first paragraph introduces it with a colon after, the
// second runs it in before. Reading the sentence rather than one anchored side is what
// covers both without a pattern per paragraph.
function sentenceAround(text, at) {
  const from = text.lastIndexOf('.', at) + 1;
  const to = text.indexOf('.', at);
  return text.slice(from, to === -1 ? text.length : to);
}

// A claim is anchored on a count word or on an id, never on the bare phrase, because the
// bare phrase is what a document quoting itself writes.
const DELIVERED = new RegExp(`(?:(${WORD}) items|BL-\\d+) have since been delivered`, 'g');
// The verb is part of the pattern and both forms are accepted, because the count this sentence
// carries reaches one. "One of them are still `Ready`" is not English, and a gate that only knew
// the plural would force the document to write it or, far worse, would match nothing and go
// quiet: REMAINING is not counted by the `readable` backstop below, so an unmatched claim is
// unchecked rather than reported. That is the silent skip the comment above wordNumber describes,
// arriving by a different door.
const REMAINING = new RegExp(`(${WORD}) of them (?:is|are) still \`([A-Za-z]+)\``, 'g');

export function checkLedger(d) {
  const found = [];
  const flat = flatten(roadmap(d));
  const cohorts = [...flat.text.matchAll(RANGE)]
    .map((m) => ({ at: m.index, from: m[1], to: m[2], text: `${m[1]} through ${m[2]}` }));
  const inRange = (cohort) => (cohort ? ` in ${cohort.text}` : '');

  let readable = 0;
  for (const m of flat.text.matchAll(DELIVERED)) {
    const stated = m[1] === undefined ? null : wordNumber(m[1]);
    if (m[1] !== undefined && stated === null) continue;
    const line = flat.lineOf(m.index);
    const cohort = cohortAt(cohorts, m.index);
    // Counted only for the whole table, and only when the figure could be read. The cohort
    // paragraph's claim is anchored on an id rather than a count word, so it is readable by
    // construction and would keep the backstop quiet however the opening sentence was
    // written. Gating on both is what lets a deleted, reworded or digit-written opening
    // ledger reach the backstop rather than pass in silence.
    if (cohort === null) readable += 1;
    const shipped = rowsOf(d, cohort).filter((r) => r.status === 'Shipped').map((r) => r.id);
    const want = numberWord(shipped.length);

    if (stated !== null && stated !== shipped.length) {
      found.push({
        line,
        claim: `${m[1]} items have since been delivered`,
        message: `${shipped.length} rows${inRange(cohort)} are marked Shipped, so this should read ${titleCase(want)}`,
      });
    }

    const claimed = [...sentenceAround(flat.text, m.index).matchAll(/BL-\d+/g)].map((x) => x[0]);
    const missing = shipped.filter((id) => !claimed.includes(id));
    const extra = claimed.filter((id) => !shipped.includes(id));
    // Set difference alone cannot see a duplicate: an id written twice leaves both
    // differences empty while the list enumerates one id more than the table has rows, and
    // the count word is derived from the rows rather than from the list, so it still agrees
    // too. The edit that writes an id twice is the one that copies a detail block it meant
    // to move, which checkBlocks below already had to grow a case for.
    const repeated = [...new Set(claimed.filter((id, n) => claimed.indexOf(id) !== n))];
    if (missing.length || extra.length || claimed.length !== shipped.length) {
      found.push({
        line,
        claim: 'the delivered id list',
        message:
          `lists ${claimed.length} id(s) for ${shipped.length} Shipped row(s)${inRange(cohort)}` +
          (missing.length ? `; missing ${missing.join(', ')}` : '') +
          (repeated.length ? `; names ${repeated.join(', ')} more than once` : '') +
          (extra.length ? `; names ${extra.join(', ')}, which the table does not mark Shipped` : ''),
      });
    }
  }

  for (const m of flat.text.matchAll(REMAINING)) {
    const stated = wordNumber(m[1]);
    if (stated === null) continue;
    const cohort = cohortAt(cohorts, m.index);
    const status = m[2];
    const n = rowsOf(d, cohort).filter((r) => r.status === status).length;
    if (stated !== n) {
      found.push({
        line: flat.lineOf(m.index),
        // Quoted from the match rather than rebuilt with a chosen verb, so the finding names the
        // sentence as the document writes it and can be searched for.
        claim: m[0],
        message: `${n} rows${inRange(cohort)} are marked ${status}, so this should read ${titleCase(numberWord(n))}`,
      });
    }
  }

  if (readable === 0) {
    found.push({
      line: 0,
      claim: 'the delivered ledger',
      message: 'nothing above the table states a delivered count as a number word, so neither that count nor its id list is being checked',
    });
  }
  return found.sort((a, b) => a.line - b.line);
}

// The same enumeration over the same table that found BL-050 had no detail block. It
// runs here rather than in a reviewer's head because the two sentences claiming
// otherwise stood, and were read past, for twenty-four ids.
export function checkBlocks(d) {
  const found = [];
  const rows = [...d.ranked, ...d.parkedRows];
  const rowIds = new Set(rows.map((r) => r.id));
  const headingIds = new Set(d.headings.map((h) => h.id));

  for (const r of rows) {
    if (!headingIds.has(r.id)) {
      found.push({
        line: r.line,
        claim: r.id,
        message: 'has a table row but no detail block heading',
      });
    }
  }
  for (const h of d.headings) {
    if (!rowIds.has(h.id)) {
      found.push({
        line: h.line,
        claim: h.id,
        message: 'has a detail block heading but no table row',
      });
    }
  }

  // A block that exists twice is a block that disagrees with itself, and the way it
  // gets written twice is an edit that copies a block it meant to move. That has
  // happened, and the enumeration above cannot see it: both copies match a row.
  const counts = new Map();
  for (const h of d.headings) counts.set(h.id, (counts.get(h.id) ?? 0) + 1);
  for (const [id, n] of counts) {
    if (n > 1) {
      found.push({
        line: d.headings.find((h) => h.id === id).line,
        claim: id,
        message: `has ${n} detail block headings, so one of them is a copy`,
      });
    }
  }
  return found;
}

// A block that exists twice is caught above by its heading. A block that states one of
// its own paragraphs twice is not, because it has one heading and one row, and that is
// the finer form of the same edit: a copy where a move was meant. It reached BL-054 and
// no gate could see it, since the anchors gate fingerprints only lines something cites
// and these were not cited.
//
// Deliberately not scoped to detail blocks, and deliberately without a minimum length.
// The defect arrived by copy and paste, which is not a habit that respects a section
// boundary, and an enumeration of where to look is the thing `scripts/check-anchors.mjs`
// argues against at length. Measured before it was written: across every tracked
// Markdown file, exhaustively, at every block length from 8 lines down to 1 and with no
// length floor at all, it reports exactly one hit, which is the defect. So the check
// needs no exception list today. That measurement is about the corpus as it stands, not
// a guarantee about every document that could be written: two identical consecutive
// table rows, list bullets or lines inside a fenced block would each report, correctly
// by the rule and unhelpfully in context. If one ever does, that is the decision this
// design defers rather than one it has already made.
export function checkRepeats(text) {
  const lines = text.split(/\r?\n/);
  // The ceiling is derived rather than picked. A repeat cannot span a blank line, by the
  // guard below, so both copies must fit inside one blank-free run, which bounds a block
  // at half the longest such run. That was 29 against a longest run of 59 when this pass
  // was written on 2026-08-10, and 47 against 95 when read again on 2026-08-14 before this
  // change landed. The growth is the argument rather than an aside: a fixed 8 would have
  // missed a duplicated paragraph merely for being long, which is the exact defect this
  // exists to catch, and a fixed 29 chosen on the first of those dates would already miss
  // one by the second. Deriving it cannot go stale, so only a figure written beside it
  // can, which is why both carry the day they were read.
  let run = 0;
  let longest = 0;
  for (const l of lines) {
    run = l.trim() === '' ? 0 : run + 1;
    if (run > longest) longest = run;
  }
  const found = [];
  const claimed = new Set();
  for (let n = Math.floor(longest / 2); n >= 1; n--) {
    for (let i = 0; i + 2 * n <= lines.length; i++) {
      if (claimed.has(i)) continue;
      const first = lines.slice(i, i + n);
      // A blank line inside the window would let two unrelated paragraphs that happen to
      // share a short line pair up across the gap between them.
      if (first.some((l) => l.trim() === '')) continue;
      if (first.join('\n') !== lines.slice(i + n, i + 2 * n).join('\n')) continue;
      for (let k = i; k < i + 2 * n; k += 1) claimed.add(k);
      found.push({
        line: i + n + 1,
        claim: first[0].trim().slice(0, 60),
        message: `repeats the ${n === 1 ? 'line' : `${n} lines`} above it word for word`,
      });
    }
  }

  // Then the same question asked of the whole document, because the walk above only ever
  // compares a block against the block touching it. The copy that prompted this sat 45
  // lines below its original in the draft of BL-075, which put pre-implementation framing
  // after the verification numbers that closed the block, and the gate said nothing was
  // said twice. Measured against that draft the walk above reports 0 and this pass
  // reports the one duplication, at four window sizes: 4 repeats at three lines, 3 at
  // four, 2 at five, 1 at six and 0 at seven, which is the overlap signature of a single
  // six-line block rather than five separate faults. That draft survives only in a local
  // checkpoint ref on one machine and is on no branch, so the test for this cites no
  // commit and rebuilds the shape instead, from a real paragraph of the real document
  // pasted at the same distance.
  //
  // The floor of three is measured, not guessed, and it is the whole of the second task
  // this item was filed with: once the copies can be anywhere, adjacency is no longer
  // doing the work of deciding what a legitimate repeat is. Counted on 2026-08-10 across
  // every tracked Markdown file outside `.copilot-tracking/`, `src/data/orders/` and
  // `docs/ux/`, seven of them then, and counted within each document rather than over the
  // set as a whole, the repeated blank-free windows came to 124 at one line, 4 at two, and
  // 0 at three and at every size above it. Every one of the 128 was meant: the constraint
  // gate line stood 25 times in the backlog and accounted for 24 of its 26 one-line
  // repeats, and the four at two lines were a table header, a fenced `npm start`, a WCAG
  // criterion line and a bare ```mermaid fence. So three is the smallest size at which a
  // repeat is not already ordinary practice here.
  //
  // That population and that method are written down because neither is recoverable from
  // the figure: counting that same 2026-08-10 tree but leaving the agent instructions out
  // of the seven gives 113, which reads as though 124 had been invented. It had not. Read
  // again on 2026-08-14, before the distant pass landed, the population was nine documents
  // and the one-line figure 165, with the gate line standing 59 times; two lines was still
  // 4 and the same four, three still 0, and 0 also across all 29 tracked Markdown files.
  // The floor held while the corpus grew from 124 one-line repeats to 165, which is better
  // evidence for it than the original count was. If a legitimate three-line repeat is ever
  // written the honest response is to raise it and record why, not to add an exception.
  //
  // Read a third time on 2026-08-15, against the population `proseDoc` derives rather than
  // the one a measurement chose: 18 documents of the 36 tracked Markdown files, and 0 at
  // three lines and above, 4 at two and 37 at one. The four at two lines are the same four,
  // in the same documents. Two of the three earlier readings counted a population that
  // could not be reconstructed from the code, because no code held it; this one is the set
  // the gate itself walks, so the next reading can be taken by running it. The floor has
  // now held across three populations of seven, nine and eighteen documents.
  //
  // The one-line figure needs its method named, because a review re-derived it as 39 and
  // both answers are right. 37 is this pass run with its floor lowered to one, which claims
  // the lines of every repeat it reports, so a line inside a longer repeat is not counted
  // again on its own. 39 is the count of distinct single lines that occur more than once,
  // with no claiming at all. The larger figures at three lines and above do not move between
  // the two methods, and it is the claiming rather than the population that separates them.
  //
  // The 1 in `n >= 1` above and the 3 here are not the same kind of number, and the reason
  // is the corpus rather than the distance. Each document is read as its own corpus, and
  // that is what keeps the floor at three honest: pooling the 18 into one corpus reports 2
  // repeats at three lines and above, and both are fenced command blocks that CONTRIBUTING
  // and README each state in full, one of them nine lines long. Neither is a defect and
  // neither document could sensibly drop it, so a pooled reading would need the exception
  // list this design is written to avoid.
  const MIN_DISTANT = 3;
  for (let n = longest; n >= MIN_DISTANT; n -= 1) {
    const firstSeen = new Map();
    for (let i = 0; i + n <= lines.length; i += 1) {
      const window = lines.slice(i, i + n);
      if (window.some((l) => l.trim() === '')) continue;
      const key = window.join('\n');
      if (!firstSeen.has(key)) {
        firstSeen.set(key, i);
        continue;
      }
      const origin = firstSeen.get(key);
      // Both copies are claimed, not just the second. With two copies it makes no
      // difference, because the overlap test below inspects the origin as well as the
      // duplicate, so a claimed duplicate already suppresses every smaller window. It is
      // the third copy that needs it: leaving the origin unclaimed lets it pair again with
      // the next copy along, and the same paragraph is reported twice carrying the same
      // origin line number, which reads as two faults where there is one. Measured on a
      // six-line block written three times: 1 finding as here, 2 with this claim removed.
      //
      // A hit from the adjacency walk above can hide a paste from this pass, because the
      // lines it claimed split the pasted block into runs shorter than the floor. A
      // paragraph containing one internally doubled line, pasted 40 lines away, is
      // reported only as the two one-line adjacency hits. That is an under-report rather
      // than a silent pass, since the gate still fails on those hits, which is why it is
      // recorded here rather than fixed by re-anchoring around claimed lines.
      let overlaps = false;
      for (let k = origin; k < origin + n; k += 1) if (claimed.has(k)) overlaps = true;
      for (let k = i; k < i + n; k += 1) if (claimed.has(k)) overlaps = true;
      if (overlaps) continue;
      for (let k = origin; k < origin + n; k += 1) claimed.add(k);
      for (let k = i; k < i + n; k += 1) claimed.add(k);
      found.push({
        line: i + 1,
        claim: window[0].trim().slice(0, 60),
        message: `repeats the ${n} lines at line ${origin + 1} word for word`,
      });
    }
  }

  return found;
}

export function checkFigures(derived) {
  return [
    ...checkRanks(derived),
    ...checkOrdinalHeadings(derived),
    ...checkLedger(derived),
    ...checkBlocks(derived),
  ];
}

export function checkAll(text) {
  const derived = derive(text);
  const findings = [
    ...checkFigures(derived),
    ...checkRepeats(text),
  ].sort((a, b) => a.line - b.line);
  return { derived, findings };
}

// Which documents the repeat pass reads. Three rules, each about a property of the path
// rather than about a file somebody remembered, because the alternative is the list the
// anchors gate argues against at length and the thing this item was filed to end was a
// population of exactly one.
//
// Markdown, because the check is about prose. A run of identical lines is ordinary in
// code: a switch arm, a test case and a CSS rule all repeat their own shape, and the
// repeats found in `src/js/main.js` at every floor down to three are all of that kind.
const PROSE = /\.md$/;
// The dated artifacts, by the same rule and for the same reason as the sizes gate. They
// are a record of passes that happened and are not ours to rewrite, so a repeat inside
// one is not a finding anybody is allowed to act on.
const HISTORICAL = /^\.copilot-tracking\//;
// The app's data, which is Markdown here because a reading order reads well as a
// checklist rather than because anybody wrote it as prose. Eight of the twelve say in
// their own first paragraph that a script writes them, and the other four are the same
// kind of thing maintained by hand; either way a repeated run of issue lines is a
// question for the order or its generator and not for a prose gate. The rule is the
// directory rather than the eight declarations, so a ninth generated file is covered on
// the day it lands rather than on the day somebody notices.
const DATA = /^src\/data\//;

// Exported so the three rules can be tested for what they do rather than for what the
// tree happens to contain today.
export const proseDoc = (path) => PROSE.test(path) && !HISTORICAL.test(path) && !DATA.test(path);

export function trackedFiles(root) {
  return execSync('git ls-files', { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
}

// BL-118. The repeat pass over every prose document, each read as its own corpus. A finding
// carries the file it is in, which the pass could not do before: it printed one document's
// name against every finding because it only ever read that document, and a message naming
// the wrong file is worse than no message at all.
//
// A tracked file that will not open is a fault rather than a skip. `git ls-files` lists a
// file that has been deleted from the working tree, and it quotes any path outside plain
// ASCII under the default `core.quotePath`, which is not a name `readFileSync` accepts. Both
// would otherwise be dropped silently while the closing line still counted them, so the gate
// would report a population larger than the one it read. "Could not look" and "looked and
// found nothing" must not print the same, which is the reason `scripts/check-publication.mjs`
// gives at `scripts/check-publication.mjs:140-144` for the same decision.
export function checkProse(root, files = trackedFiles(root)) {
  const docs = files.filter(proseDoc);
  const findings = [];
  for (const file of docs) {
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch (e) {
      throw new Error(`${file} is tracked but could not be read, so it was not scanned: ${e.message}`, { cause: e });
    }
    for (const f of checkRepeats(text)) findings.push({ file, ...f });
  }
  return { docs, findings };
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const derived = derive(readFileSync(join(root, DOC), 'utf8'));
  // The figure checks read the ranked table and only this document has one. The repeat
  // pass reads every prose document, this one included, which is why it is called here
  // rather than through `checkAll`: calling both would report every repeat in the backlog
  // twice, once against the right file and once against the same file by another route.
  const prose = checkProse(root);
  const findings = [
    ...checkFigures(derived).map((f) => ({ file: DOC, ...f })),
    ...prose.findings,
  ].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));

  const tally = Object.entries(derived.status)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  console.log(
    `${derived.ranked.length} ranked rows, ${derived.parkedRows.length} parked, ` +
      `${derived.headings.length} detail blocks (${tally})`,
  );

  for (const f of findings) {
    console.error(`WRONG  ${f.file}:${f.line}  ${f.claim}\n  ${f.message}`);
  }
  if (findings.length) {
    // Repeats are not figures and have no derived value to write, so the two classes
    // are counted apart rather than described by one sentence that fits neither.
    const repeats = findings.filter((f) => f.message.startsWith('repeats the')).length;
    const figures = findings.length - repeats;
    const parts = [];
    if (figures) {
      parts.push(
        `${figures} stated figure(s) disagree with the table they are derived from. ` +
          'Each message names the derived value, so the fix is to write that value, or to mark ' +
          `the claim historical with ${FROZEN} if it is about a past state.`,
      );
    }
    if (repeats) {
      parts.push(
        `${repeats} passage(s) are stated twice over. Delete the copy the surrounding prose ` +
          'does not read with, which is usually the second.',
      );
    }
    console.error(`\n${parts.join('\n\n')}`);
    process.exit(1);
  }
  console.log(
    'every stated figure agrees with the table it is derived from, and nothing is said ' +
      `twice in any of the ${prose.docs.length} prose documents`,
  );
}
