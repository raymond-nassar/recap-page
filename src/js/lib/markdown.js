// Markdown checklist parsing and serialization.
// Upstream format: - [ ] [Title](https://www.marvel.com/comics/issue/<id>/<slug>)

const MARVEL_ISSUE_RE = /^https?:\/\/(?:www\.)?marvel\.com\/comics\/issue\/(\d+)(?:\/([^/?#]*))?/i;
// Link text allows backslash escapes so a title containing "]" survives a
// serialize -> parse round trip. Without this, escapeLinkText produces output
// this parser cannot read back.
const LINK_TEXT = '((?:[^\\]\\\\]|\\\\.)*)';
const CHECKBOX_LINK_RE = new RegExp(`^\\s*[-*]\\s*\\[( |x|X)\\]\\s*\\[${LINK_TEXT}\\]\\(([^)\\s]+)(?:\\s+"[^"]*")?\\)`);
const CHECKBOX_PLAIN_RE = /^\s*[-*]\s*\[( |x|X)\]\s*(.+?)\s*$/;
const BULLET_LINK_RE = new RegExp(`^\\s*[-*]\\s*\\[${LINK_TEXT}\\]\\(([^)\\s]+)(?:\\s+"[^"]*")?\\)`);
const SOURCE_OCCURRENCE_RE = /\s*<!--\s*mrt:source-occurrence=([1-9]\d*)\s*-->\s*$/;

function sourceIdentity(title) {
  const match = SOURCE_OCCURRENCE_RE.exec(title);
  return match
    ? { title: title.slice(0, match.index).trim(), sourceKey: match[1] }
    : { title, sourceKey: null };
}

export function unescapeLinkText(s) {
  return String(s ?? '').replace(/\\(.)/g, '$1');
}

export function issueIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const m = MARVEL_ISSUE_RE.exec(url.trim());
  return m ? Number(m[1]) : null;
}

// The digital book id read off the Marvel Unlimited reader's own address bar.
//
// This is the only remaining route to a working reader link for a recent issue. The metadata
// service that supplied digitalId stopped at 2025-10-29, and no other catalogue reachable from a
// browser carries the field at all: it was checked against Comic Vine, Metron, the Grand Comics
// Database, Wikidata and the Marvel Fandom wiki on 2026-08-18 and is absent from every one. So a
// subscriber pasting the address of a book they already have open is not a convenience, it is the
// whole supply.
export function digitalIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  // Its sibling below and the private copy in the reader module both refuse anything outside http
  // and https, and this function had no such check. Probed with crafted addresses, ftp, file,
  // javascript and data URLs naming read.marvel.com every one yielded a book id here while being
  // rejected there. Nothing could reach it, because the caller gates on the sibling first, but two
  // functions answering the same question differently is a contract waiting to be relied on.
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.hostname.toLowerCase() !== 'read.marvel.com') return null;
  const m = /^#\/book\/(\d+)/.exec(u.hash);
  if (!m) return null;
  const n = Number(m[1]);
  // Rejects 0 and anything past the safe integer range. Both would build a reader URL that loads
  // nothing, and a dead Read button is worse than a missing one because it looks like it worked.
  // Twelve digits is that same rule: it is the ceiling the launcher in src/open.js enforces before
  // it will build a reader address, so a longer id accepted here would store and then be refused
  // there, which is precisely the dead button this comment rules out.
  return Number.isSafeInteger(n) && n > 0 && String(n).length <= 12 ? n : null;
}

export function isSafeMarvelUrl(url) {
  if (typeof url !== 'string') return false;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  return host === 'marvel.com' || host === 'www.marvel.com' || host === 'read.marvel.com';
}

// Returns { entries, unresolved, headings }
// entry: { issueId|null, title, url|null, read, index, section|null }
//
// `index` is the item's position in the checklist, counted across both arrays. Splitting a
// list into resolved and unresolved loses the reading order between them, and reading order is
// the whole point of these files, so each item carries where it came from.
//
// `section` is the nearest preceding heading of level 2 or deeper, which is how a trade order
// says which collected edition an issue belongs to. Level 1 is excluded because
// serializeChecklist writes the list's own name as `# name`, so treating it as a section would
// put every issue in one section named after the list. An order with no sub-headings, which is
// every order vendored before trade orders existed, reports `section: null` throughout.
export function parseChecklist(text) {
  const entries = [];
  const unresolved = [];
  const headings = [];
  const sourcePositions = [];
  if (typeof text !== 'string') return {
    entries, unresolved, headings, sourcePositions,
  };

  let index = 0;
  let section = null;
  let sourcePosition = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\u00a0/g, ' ');
    if (!line.trim()) continue;

    const h = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const title = h[2].trim();
      headings.push(title);
      // A level-1 heading ends the current section rather than starting one. Without this a
      // second `#` further down the file would leave the issues under it still labelled with
      // the last trade, which is the one wrong answer that looks right.
      section = h[1].length >= 2 ? (title || null) : null;
      sourcePosition = null;
      continue;
    }

    const quoted = /^\s{0,3}>\s+(.+)$/.exec(line);
    if (quoted) {
      const label = stripInlineMarkdown(quoted[1]);
      sourcePosition = label ? {
        ordinal: sourcePositions.length + 1,
        label,
        section,
        start: index,
        count: 0,
      } : null;
      if (sourcePosition) sourcePositions.push(sourcePosition);
      continue;
    }

    let read = false;
    // No initialiser, unlike its neighbours: every branch below either sets a title or skips the
    // line, so a starting value here would be one no read can ever see. `url` keeps its null
    // because the two plain-checkbox branches leave it unset and the issue-id lookup still reads it.
    let title;
    let url = null;

    const cl = CHECKBOX_LINK_RE.exec(line);
    if (cl) {
      read = cl[1].toLowerCase() === 'x';
      title = unescapeLinkText(cl[2]).trim();
      url = cl[3].trim();
    } else {
      const bl = BULLET_LINK_RE.exec(line);
      if (bl) {
        title = unescapeLinkText(bl[1]).trim();
        url = bl[2].trim();
      } else {
        const cp = CHECKBOX_PLAIN_RE.exec(line);
        if (cp) {
          read = cp[1].toLowerCase() === 'x';
          title = stripInlineMarkdown(cp[2]);
        } else if (/^\s*[-*]\s+/.test(line)) {
          title = stripInlineMarkdown(line.replace(/^\s*[-*]\s+/, ''));
        } else {
          continue;
        }
      }
    }

    const identified = sourceIdentity(title);
    title = identified.title;
    if (!title) continue;
    const issueId = issueIdFromUrl(url);
    const at = index;
    index += 1;
    if (sourcePosition) sourcePosition.count += 1;

    if (issueId != null) {
      entries.push({
        issueId, title, url: url, read, index: at, section,
        ...(identified.sourceKey ? { sourceKey: identified.sourceKey } : {}),
      });
    } else {
      // A title we could not map to a Marvel issue id. Never silently dropped.
      unresolved.push({
        title, url: url && isSafeMarvelUrl(url) ? url : null, read, index: at, section,
        ...(identified.sourceKey ? { sourceKey: identified.sourceKey } : {}),
      });
    }
  }

  return {
    entries, unresolved, headings, sourcePositions,
  };
}

// Plain title list: one per line, optional leading bullet or checkbox.
export function parseTitleList(text) {
  const out = [];
  if (typeof text !== 'string') return out;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cp = CHECKBOX_PLAIN_RE.exec(line);
    if (cp) {
      out.push({ title: stripInlineMarkdown(cp[2]), read: cp[1].toLowerCase() === 'x' });
      continue;
    }
    out.push({ title: stripInlineMarkdown(line.replace(/^[-*]\s+/, '')), read: false });
  }
  return out.filter((e) => e.title);
}

export function stripInlineMarkdown(s) {
  return String(s)
    .replace(/\[((?:[^\]\\]|\\.)*)\]\([^)]*\)/g, (_, t) => unescapeLinkText(t))
    .replace(/[*_`]/g, '')
    .trim();
}

// Serializes a list back to the same format it can be re-imported from.
//
// Notes export but do not re-import: `parseChecklist` has no syntax for them, and inventing one
// would change a format this app does not own. The lossless path is the JSON backup.
//
// An item's `collectedIn` is written as a `## ` heading whenever it changes, which is exactly
// what parseChecklist reads back as a section. Without this, exporting a trade order and
// re-importing it would silently flatten it into an ordinary issue list, and the reader would
// have no way to tell from the file that anything had been lost.
export function serializeChecklist({ name, description, items, note }) {
  const lines = [];
  if (name) lines.push(`# ${name}`, '');
  if (description) lines.push(description, '');
  if (note) lines.push(...quoteNote(note), '');
  let section;
  let wroteItem = false;
  for (const it of items) {
    const next = it.collectedIn || null;
    if (next !== section) {
      section = next;
      if (next) {
        if (wroteItem) lines.push('');
        lines.push(`## ${next}`, '');
      }
    }
    const box = it.read ? '- [x]' : '- [ ]';
    const url = it.url || (it.issueId > 0 ? `https://www.marvel.com/comics/issue/${it.issueId}/` : null);
    lines.push(url ? `${box} [${escapeLinkText(it.title)}](${url})` : `${box} ${it.title}`);
    if (it.note) lines.push(...quoteNote(it.note));
    wroteItem = true;
  }
  lines.push('');
  return lines.join('\n');
}

// Every line prefixed, and the prefix is not decoration. A note beginning "- " or "# " would
// otherwise be read back as an item or a heading, so exporting a list and re-importing it would
// invent issues the reader never added. Every pattern in this file anchors on "-", "*" or "#"
// after optional whitespace alone, so a leading ">" defeats all of them.
function quoteNote(note) {
  return String(note).split(/\r?\n/).map((line) => `> ${line}`.trimEnd());
}

// The backslash must be escaped first, or escaping "]" would corrupt any title that already
// contained a backslash: "a\" + "]" would emit "a\\]", which reads back as a literal backslash
// followed by an unescaped "]" and terminates the link early.
export function escapeLinkText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

// Normalization used only for exact-match title resolution. Deliberately strict:
// we auto-accept a search result only when exactly one candidate normalizes identically.
export function normalizeTitle(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function resolveUniqueExact(title, candidates) {
  const want = normalizeTitle(title);
  if (!want) return { status: 'ambiguous', matches: candidates ?? [] };
  const matches = (candidates ?? []).filter((c) => normalizeTitle(c.title) === want);
  if (matches.length === 1) return { status: 'resolved', match: matches[0] };
  if (matches.length === 0) return { status: 'unmatched', matches: candidates ?? [] };
  return { status: 'ambiguous', matches };
}
