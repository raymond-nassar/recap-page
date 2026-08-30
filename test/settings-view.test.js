import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');

const VIEW = sliceElement(
  HTML,
  'section',
  openingTags(HTML, 'section').find((tag) => getAttribute(tag.open, 'id') === 'view-data')?.start,
);

const HEADING_LEVELS = [1, 2, 3, 4, 3, 2, 3, 3, 2, 3, 3, 3, 2, 3, 2];
const GROUP_LABELS = ['Data safety', 'Personalization', 'Connectivity', 'Advanced'];
const REQUIRED_IDS = [
  'btn-export-json',
  'btn-export-md-2',
  'restore-file',
  'btn-undo-restore',
  'opt-covers',
  'opt-update-checks',
  'opt-theme',
  'api-base',
  'btn-check-local-connection',
  'local-connection-status',
  'local-connection-help',
  'local-connection-report',
  'btn-clear-cache',
  'btn-wipe',
  'form-settings',
  'salvage-list',
  'salvage-report',
  'restore-report',
  'cache-usage',
];
const NOTICE_GLYPHS = {
  ok: '✓',
  warn: '▲',
  error: '×',
  busy: '•',
};

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function openingTags(text, tag) {
  return [...text.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((match) => ({
    start: match.index,
    open: match[0],
  }));
}

function getAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match?.[1] ?? null;
}

function hasClass(tag, name) {
  const classes = getAttribute(tag, 'class');
  return classes ? classes.split(/\s+/).includes(name) : false;
}

function sliceElement(text, tag, start) {
  assert.ok(start != null, `expected <${tag}> to be present`);
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'g');
  open.lastIndex = start;
  const match = open.exec(text);
  assert.ok(match && match.index === start, `expected <${tag}> at ${start}`);

  const tokens = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'g');
  tokens.lastIndex = start + match[0].length;
  let depth = 1;
  let token;
  while ((token = tokens.exec(text))) {
    depth += token[0].startsWith(`</${tag}`) ? -1 : 1;
    if (depth === 0) return text.slice(start, token.index + token[0].length);
  }
  assert.fail(`expected </${tag}> to close element that starts at ${start}`);
}

function elementsWithClass(text, tag, className) {
  return openingTags(text, tag)
    .filter((entry) => hasClass(entry.open, className))
    .map((entry) => {
      const html = sliceElement(text, tag, entry.start);
      return {
        ...entry,
        html,
        end: entry.start + html.length,
      };
    });
}

function headingText(fragment, level) {
  const match = fragment.match(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`));
  assert.ok(match, `expected an h${level} in:\n${fragment}`);
  return match[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
}

function idPosition(text, id) {
  const at = text.indexOf(`id="${id}"`);
  assert.notEqual(at, -1, `expected id="${id}" to be present`);
  return at;
}

// Keyed on the message rather than on a count of pane names, so moving a handler or adding an
// unrelated notice cannot turn this red, and re-routing one of these messages cannot turn it green.
function noticeTarget(message) {
  const at = MAIN.indexOf(message);
  assert.notEqual(at, -1, `expected the message ${JSON.stringify(message)} to be in main.js`);
  const call = MAIN.slice(0, at).lastIndexOf('notify(');
  assert.notEqual(call, -1, `expected ${JSON.stringify(message)} to be passed to notify()`);
  const target = MAIN.slice(call).match(/^notify\(\s*'([^']+)'/);
  assert.ok(target, `expected a literal pane selector in the notify() call for ${JSON.stringify(message)}`);
  // A message built above its call site, such as one assembled in a ternary, would otherwise match
  // whichever notify() came before it and pass while asserting nothing about its own routing.
  assert.ok(
    closingParen(MAIN, call + 'notify('.length - 1) > at,
    `${JSON.stringify(message)} is not inside the notify() call this test matched it to`,
  );
  return target[1];
}

function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function noticeGlyph(kind) {
  const match = CSS.match(new RegExp(`\\.notice-${kind}::before\\s*\\{[^}]*content:\\s*"([^"]+)"`, 's'));
  assert.ok(match, `expected .notice-${kind}::before to declare a glyph`);
  return match[1];
}

test('the settings view headings keep the shipped levels, in order, with no level skipped', () => {
  const levels = [...VIEW.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
  assert.deepEqual(levels, HEADING_LEVELS);
  for (let i = 1; i < levels.length; i += 1) {
    assert.ok(
      levels[i] <= levels[i - 1] + 1,
      `heading level ${levels[i]} skips past ${levels[i - 1]} at position ${i}`,
    );
  }
});

test('the settings view has four labelled groups, and every non-danger card sits inside one', () => {
  const groups = elementsWithClass(VIEW, 'section', 'setgroup');
  assert.equal(groups.length, 4);
  assert.deepEqual(groups.map((group) => headingText(group.html, 2)), GROUP_LABELS);

  const cards = elementsWithClass(VIEW, 'div', 'card');
  const nonDangerOutsideGroups = cards.filter((card) => {
    if (hasClass(card.open, 'card-danger')) return false;
    return !groups.some((group) => group.start < card.start && card.end < group.end);
  });
  assert.deepEqual(
    nonDangerOutsideGroups.map((card) => card.open),
    [],
    'every non-danger card should live inside one of the four settings groups',
  );
});

test('the danger card is the last card in the view', () => {
  const cards = elementsWithClass(VIEW, 'div', 'card');
  assert.ok(cards.length > 0, 'expected the settings view to contain cards');
  assert.ok(hasClass(cards.at(-1).open, 'card-danger'));
  assert.equal(cards.filter((card) => hasClass(card.open, 'card-danger')).length, 1);
});

test('the local connection, API and cache reports stay with the controls they report for', () => {
  const cards = elementsWithClass(VIEW, 'div', 'card');
  const containingCard = (id) => {
    const at = idPosition(VIEW, id);
    return cards.find((card) => card.start < at && at < card.end) ?? null;
  };
  const apiCard = containingCard('api-base');
  const apiReportCard = containingCard('api-report');
  const localCard = containingCard('btn-check-local-connection');
  const localReportCard = containingCard('local-connection-report');
  const cacheCard = containingCard('btn-clear-cache');
  const cacheReportCard = containingCard('cache-report');

  assert.ok(apiCard, 'expected the API base URL control to sit inside a card');
  assert.ok(localCard, 'expected the local connection control to sit inside a card');
  assert.ok(cacheCard, 'expected the cache clear control to sit inside a card');
  assert.equal(apiCard, apiReportCard);
  assert.equal(localCard, localReportCard);
  assert.equal(cacheCard, cacheReportCard);
  assert.equal(headingText(apiCard.html, 3), 'Metadata source');
  assert.equal(headingText(localCard.html, 3), 'Local app connection');
  assert.equal(headingText(cacheCard.html, 3), 'Cached metadata');
});

test('each report pane hears only about the control it sits with', () => {
  // A cache clear used to overwrite a restore refusal, because all three shared one pane.
  assert.equal(noticeTarget('That API URL is not usable'), '#api-report');
  assert.equal(noticeTarget('API URL saved.'), '#api-report');
  assert.equal(noticeTarget('The local app connection is ready.'), '#local-connection-report');
  assert.equal(noticeTarget('Cached metadata cleared.'), '#cache-report');
  assert.equal(noticeTarget('Restored. Your previous data was snapshotted'), '#restore-report');
  assert.equal(noticeTarget('Restore undone.'), '#restore-report');
});

test('the local connection control names its status and recovery guidance', () => {
  const button = openingTags(VIEW, 'button')
    .find((entry) => getAttribute(entry.open, 'id') === 'btn-check-local-connection');
  assert.ok(button, 'expected the local connection button');
  assert.equal(
    getAttribute(button.open, 'aria-describedby'),
    'local-connection-status local-connection-help',
  );
  assert.equal(hasClass(button.open, 'btn'), true);
  assert.equal(hasClass(button.open, 'quiet'), false);
  assert.equal(hasClass(button.open, 'setting-action'), true);
});

test('settings actions use full-size buttons while preserving their hierarchy', () => {
  const expected = new Map([
    ['btn-export-json', ['btn']],
    ['btn-export-md-2', ['btn', 'btn-g']],
    ['btn-undo-restore', ['btn', 'btn-g']],
    ['btn-check-local-connection', ['btn', 'setting-action']],
    ['btn-clear-cache', ['btn', 'btn-g', 'setting-action']],
    ['btn-wipe', ['btn', 'btn-danger', 'setting-action']],
  ]);
  const buttons = openingTags(VIEW, 'button');

  for (const [id, classes] of expected) {
    const button = buttons.find((entry) => getAttribute(entry.open, 'id') === id);
    assert.ok(button, `expected ${id}`);
    for (const className of classes) {
      assert.equal(hasClass(button.open, className), true, `${id} should use ${className}`);
    }
    assert.equal(hasClass(button.open, 'quiet'), false, `${id} should not use compact button sizing`);
  }

  assert.match(MAIN, /class: 'btn btn-g',\s+dataset: \{ act: 'download'/);
  assert.match(MAIN, /class: 'btn btn-danger',\s+dataset: \{ act: 'forget'/);
});

test('every settings binding id still appears exactly once in the shipped markup', () => {
  for (const id of REQUIRED_IDS) {
    const count = [...VIEW.matchAll(new RegExp(`id="${escapeRegExp(id)}"`, 'g'))].length;
    assert.equal(count, 1, `expected id="${id}" to appear once in the settings view`);
  }
});

test('each notice kind keeps its own glyph in the stylesheet', () => {
  const actual = Object.fromEntries(
    Object.keys(NOTICE_GLYPHS).map((kind) => [kind, noticeGlyph(kind)]),
  );
  assert.deepEqual(actual, NOTICE_GLYPHS);
  assert.equal(new Set(Object.values(actual)).size, 4);
});
