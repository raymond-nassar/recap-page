// #832 item 1 (UX-33): what the Android alignment owner's watched elements did between a pull
// request's base and its head. The CI job gates on a baseline recorded from the head's own tree, so
// an intended move stays green; this is the record that lists every move anyway, with its size, so
// the author can explain each one. It reads the evidence both trees' baseline passes wrote and never
// fails: a move is information here, and so is a base whose harness no longer matches the head's.
//
//   node scripts/alignment-moves.mjs --base=<dir> --head=<dir> --out=<dir>
//     [--base-sha=<commit>] [--base-exit=<code>] [--head-exit=<code>]

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BOX_KEYS = ['left', 'right', 'top', 'bottom', 'width', 'height'];
export const STYLE_KEYS = ['text', 'font', 'family', 'weight', 'transform', 'align', 'display', 'name', 'current'];
export const PAGE_KEYS = ['rootWidth', 'scrollWidth', 'inner', 'visual', 'active', 'body'];

const union = (a, b) => [...new Set([...a, ...b])];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const round = (value) => Math.round(value * 10) / 10;

export function profileLabel(evidence) {
  const profile = evidence?.profile;
  if (!profile) return '';
  const scale = profile.textScale ? `, text ${profile.textScale * 100}%` : '';
  return `${profile.width}x${profile.height} ${profile.theme}${scale}${profile.desktop ? ', desktop entry' : ''}`;
}

// Moves are box edges that shifted by more than the threshold, which is the owner's own tolerance.
// Changes are any other watched property that differs at all. Unmatched is everything one side
// recorded and the other did not: a profile, a screen or an element.
export function alignmentMoves(base, head, threshold = 1) {
  const moves = [];
  const changes = [];
  const unmatched = [];
  for (const id of union(Object.keys(base), Object.keys(head)).sort()) {
    if (!base[id] || !head[id]) {
      unmatched.push({ id, what: base[id] ? 'recorded by the base only' : 'recorded by the head only' });
      continue;
    }
    const before = base[id].snapshots ?? {};
    const after = head[id].snapshots ?? {};
    for (const state of union(Object.keys(before), Object.keys(after))) {
      if (!before[state] || !after[state]) {
        unmatched.push({ id, state, what: before[state] ? 'recorded by the base only' : 'recorded by the head only' });
        continue;
      }
      for (const key of PAGE_KEYS) {
        if (!same(before[state][key], after[state][key])) {
          changes.push({ id, state, selector: 'page', key, base: before[state][key], head: after[state][key] });
        }
      }
      const nodes = (snapshot) => new Map((snapshot.nodes ?? []).map((node) => [node.selector, node]));
      const was = nodes(before[state]);
      const now = nodes(after[state]);
      for (const selector of union(was.keys(), now.keys())) {
        if (!was.has(selector) || !now.has(selector)) {
          unmatched.push({ id, state, selector, what: was.has(selector) ? 'recorded by the base only' : 'recorded by the head only' });
          continue;
        }
        const from = was.get(selector);
        const to = now.get(selector);
        const deltas = {};
        for (const key of BOX_KEYS) {
          const delta = (to.box?.[key] ?? 0) - (from.box?.[key] ?? 0);
          if (Math.abs(delta) > threshold) deltas[key] = round(delta);
        }
        if (Object.keys(deltas).length) moves.push({ id, state, selector, deltas });
        for (const key of [...STYLE_KEYS, 'clipped']) {
          if (!same(from[key], to[key])) changes.push({ id, state, selector, key, base: from[key], head: to[key] });
        }
      }
    }
  }
  return { moves, changes, unmatched };
}

const signed = (value) => `${value > 0 ? '+' : ''}${value}`;
// Backslashes first, so a cell can never end in an escape that swallows the column bar after it.
const cell = (value) => String(typeof value === 'string' ? value : JSON.stringify(value))
  .replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function alignmentMarkdown(result, { labels = {}, baseSha = null, baseExit = null, headExit = null } = {}) {
  const lines = [
    '### Android alignment against the base',
    '',
    `Recorded, not gated. Every element the \`alignment\` owner watches, on this pull request's merge, compared with its base${baseSha ? ` \`${baseSha}\`` : ''}. Explain each move this lists in the pull request.`,
    '',
  ];
  const where = (entry) => `${entry.id}${labels[entry.id] ? ` (${labels[entry.id]})` : ''}`;
  if (result.moves.length) {
    lines.push('| Profile | Screen | Element | Moved, in CSS px |', '|---|---|---|---|');
    for (const move of result.moves) {
      const deltas = Object.entries(move.deltas).map(([key, value]) => `${key} ${signed(value)}`).join(', ');
      lines.push(`| ${cell(where(move))} | ${move.state} | \`${cell(move.selector)}\` | ${deltas} |`);
    }
  } else {
    lines.push('No watched element moved more than 1px.');
  }
  if (result.changes.length) {
    lines.push('', '| Profile | Screen | Element | Property | Base | Head |', '|---|---|---|---|---|---|');
    for (const change of result.changes) {
      lines.push(`| ${cell(where(change))} | ${change.state} | \`${cell(change.selector)}\` | ${change.key} | ${cell(change.base)} | ${cell(change.head)} |`);
    }
  }
  if (result.unmatched.length) {
    lines.push('', 'Not compared, because only one side recorded it:', '');
    for (const entry of result.unmatched) {
      lines.push(`- ${[where(entry), entry.state, entry.selector && `\`${entry.selector}\``].filter(Boolean).join(' ')}: ${entry.what}`);
    }
  }
  const exits = [];
  const ran = (code) => (/^-?\d+$/.test(String(code)) ? `exited ${code}` : 'did not run');
  if (baseExit !== null) exits.push(`the base's baseline pass ${ran(baseExit)}`);
  if (headExit !== null) exits.push(`the head's own comparison against it ${ran(headExit)}`);
  const sentence = exits.join(', and ');
  if (sentence) lines.push('', `${sentence[0].toUpperCase()}${sentence.slice(1)}.`);
  return `${lines.join('\n')}\n`;
}

export function readEvidence(directory) {
  if (!directory || !existsSync(directory)) return {};
  return Object.fromEntries(readdirSync(directory)
    .filter((name) => /^A\d{2}\.json$/.test(name))
    .sort()
    .map((name) => [name.slice(0, -'.json'.length), JSON.parse(readFileSync(join(directory, name), 'utf8'))]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
  const base = readEvidence(option('base'));
  const head = readEvidence(option('head'));
  const result = alignmentMoves(base, head);
  const labels = Object.fromEntries(Object.entries({ ...base, ...head }).map(([id, evidence]) => [id, profileLabel(evidence)]));
  let markdown = alignmentMarkdown(result, {
    labels, baseSha: option('base-sha'), baseExit: option('base-exit'), headExit: option('head-exit'),
  });
  if (!Object.keys(base).length || !Object.keys(head).length) {
    markdown += `\n${!Object.keys(base).length ? 'The base' : 'The head'} recorded no alignment evidence, so nothing could be compared.\n`;
  }
  const out = option('out');
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'alignment-moves.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    writeFileSync(join(out, 'alignment-moves.md'), markdown, { flag: 'wx' });
  }
  process.stdout.write(markdown);
}
