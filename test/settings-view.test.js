import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
const DATA_VIEW = readFileSync(new URL('../src/js/views/data.js', import.meta.url), 'utf8');
const RECOVERY_VIEW = readFileSync(new URL('../src/js/views/recovery.js', import.meta.url), 'utf8');
const ALL_SOURCE = MAIN + DATA_VIEW + RECOVERY_VIEW;

test('catalog load failures retain a catalog-specific actionable Retry in both connection branches', () => {
  const reporter = MAIN.slice(MAIN.indexOf('async function reportBundledLoadFailure'),
    MAIN.indexOf('async function checkHealth'));
  assert.match(reporter, /Retry catalog/);
  assert.match(reporter, /key === CATALOG_LOAD/);
  const healthy = reporter.slice(reporter.indexOf('LOCAL_SERVER_STATUS.READY'), reporter.indexOf('return false;', reporter.indexOf('LOCAL_SERVER_STATUS.READY')));
  assert.match(healthy, /localRecoveryAction/);
  assert.match(reporter, /Try again/);
  assert.match(reporter, /if \(!isCurrent\(\)\) return false/);
});

const VIEW = sliceElement(
  HTML,
  'section',
  openingTags(HTML, 'section').find((tag) => getAttribute(tag.open, 'id') === 'view-data')?.start,
);
// Moved into the Data safety group at startup, so it is read from where it is written.
const HISTORY = sliceElement(
  HTML,
  'section',
  openingTags(HTML, 'section').find((tag) => getAttribute(tag.open, 'id') === 'completion-history-controls')?.start,
);

const HEADING_LEVELS = [1, 2, 3, 4, 3, 3, 3, 3, 2, 3, 3, 3, 2, 3, 3, 2, 3, 3, 2];
const GROUP_LABELS = ['Data safety', 'Personalization', 'Connectivity', 'Advanced'];
const REQUIRED_IDS = [
  'transfer-summary',
  'complete-backup',
  'btn-export-complete',
  'restore-complete',
  'restore-complete-hint',
  'complete-restore-unavailable',
  'complete-backup-report',
  'complete-restore-recovery',
  'complete-restore-recovery-status',
  'btn-complete-prior-copy',
  'btn-complete-finish',
  'btn-complete-restore-prior',
  'btn-complete-keep',
  'cloud-backup',
  'cloud-backup-intro',
  'cloud-backup-status',
  'cloud-backup-progress',
  'cloud-backup-primary',
  'btn-cloud-sign-in',
  'btn-cloud-retry',
  'cloud-auto',
  'opt-cloud-auto',
  'cloud-discovery',
  'cloud-discovery-summary',
  'cloud-discovery-list',
  'cloud-backup-actions',
  'btn-cloud-delete',
  'btn-cloud-disconnect',
  'cloud-backup-report',
  'btn-export-json',
  'backup-contents',
  'btn-export-md-2',
  'restore-file',
  'restore-file-hint',
  'btn-undo-restore',
  'btn-export-restore-copy',
  'restore-copy-summary',
  'normal-backup-history',
  'btn-export-draft',
  'restore-draft',
  'draft-transfer-report',
  'opt-covers',
  'opt-theme',
  'opt-reading-shortcut',
  'reading-shortcut-help',
  'reading-shortcut-storage-help',
  'reading-shortcut-report',
  'api-base',
  'pwa-install',
  'btn-install',
  'pwa-install-report',
  'btn-check-local-connection',
  'local-connection-status',
  'local-connection-help',
  'local-connection-report',
  'btn-clear-cache',
  'btn-wipe',
  'erase-contents',
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
  const at = ALL_SOURCE.indexOf(message);
  assert.notEqual(at, -1, `expected the message ${JSON.stringify(message)} to be in the source`);
  const call = ALL_SOURCE.slice(0, at).lastIndexOf('notify(');
  assert.notEqual(call, -1, `expected ${JSON.stringify(message)} to be passed to notify()`);
  const target = ALL_SOURCE.slice(call).match(/^notify\(\s*'([^']+)'/);
  assert.ok(target, `expected a literal pane selector in the notify() call for ${JSON.stringify(message)}`);
  assert.ok(
    closingParen(ALL_SOURCE, call + 'notify('.length - 1) > at,
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
  assert.match(ALL_SOURCE, /reportId: 'api-report',\s*reportError: \(message\) => notify\('#api-report', message, 'error'\)/);
  assert.match(ALL_SOURCE, /apiValidation\.fail\('That API URL is not usable/);
  assert.equal(noticeTarget('API URL saved.'), '#api-report');
  assert.equal(noticeTarget('The local app connection is ready.'), '#local-connection-report');
  assert.equal(noticeTarget('Cached metadata cleared.'), '#cache-report');
  assert.match(DATA_VIEW, /if \(res\.ok\) notify\('#restore-report', success, 'ok'\)/);
  assert.match(DATA_VIEW, /reportRestore\(res, 'Reading data restored/);
  assert.match(DATA_VIEW, /Restore undone\. The replaced reading data/);
});

test('normal reading, history and draft transfers precede exceptional recovery with independent formats', () => {
  const order = ['transfer-summary', 'btn-export-complete', 'restore-complete', 'btn-export-json', 'restore-file', 'normal-backup-history', 'btn-export-draft', 'restore-draft', 'salvage-list'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(idPosition(VIEW, order[i - 1]) < idPosition(VIEW, order[i]), `${order[i - 1]} precedes ${order[i]}`);
  }
  const summary = sliceElement(VIEW, 'p', openingTags(VIEW, 'p').find((entry) => getAttribute(entry.open, 'id') === 'transfer-summary').start);
  assert.ok(summary.includes('<strong>Moving to another device:</strong>'), summary);
  assert.ok(summary.includes('download a complete backup and restore it there.'), summary);
  assert.ok(summary.includes('The reading data, completion history and import draft backups below each hold one kind of data, without settings.'), summary);
  assert.match(VIEW, /Restoring reading data keeps the draft, but you review it before adding more comics\./);
  const details = sliceElement(HTML, 'details', openingTags(HTML, 'details')
    .find((entry) => getAttribute(entry.open, 'id') === 'history-troubleshooting').start);
  assert.ok(details.includes('btn-copy-history') && details.includes('btn-retry-history'));
  assert.match(HTML, /saved-value copy preserves unreadable data exactly; it is not a normal backup/);
});

// UX-07 (#835). Completion history used to sit between the reading-data download and its restore,
// so each kind of data now keeps its download, its labelled restore and its report in one group.
// The completion-history group is mounted at startup, into the placeholder between the other two.
test('each backup group keeps its download, labelled restore and report together', () => {
  const cards = elementsWithClass(VIEW, 'div', 'card');
  const cardOf = (id) => {
    const at = idPosition(VIEW, id);
    return cards.find((card) => card.start < at && at < card.end) ?? null;
  };
  const reading = cardOf('btn-export-json');
  const draft = cardOf('btn-export-draft');
  const complete = cardOf('btn-export-complete');
  assert.ok(reading && draft && reading !== draft, 'reading data and the import draft are separate groups');
  assert.ok(complete && complete !== reading && complete.end < reading.start, 'the complete backup is its own group, first');
  assert.equal(headingText(complete.html, 3), 'Complete backup');
  // The recovery section shows a restore that stopped, one that finished but was lost, and a cleanup
  // after one that finished, so its heading names the choice rather than an unfinished restore (#947).
  assert.equal(headingText(complete.html, 4), 'Complete restore needs a choice');
  assert.equal(headingText(reading.html, 3), 'Reading data');
  assert.equal(headingText(draft.html, 3), 'Import draft');
  assert.equal(headingText(HISTORY, 3), 'Completion history');
  for (const id of ['restore-complete', 'restore-complete-hint', 'complete-restore-unavailable', 'complete-backup-report', 'complete-restore-recovery',
    'btn-complete-prior-copy', 'btn-complete-finish', 'btn-complete-restore-prior', 'btn-complete-keep']) {
    assert.equal(cardOf(id), complete, `${id} belongs with the complete-backup download`);
  }
  for (const id of ['restore-file', 'restore-file-hint', 'btn-undo-restore', 'btn-export-restore-copy', 'restore-copy-summary', 'restore-report', 'backup-contents']) {
    assert.equal(cardOf(id), reading, `${id} belongs with the reading-data download`);
  }
  for (const id of ['restore-draft', 'draft-transfer-report']) assert.equal(cardOf(id), draft, `${id} belongs with the import-draft download`);
  for (const id of ['btn-export-history', 'restore-history-file', 'restore-history-hint', 'history-report']) {
    assert.ok(HISTORY.includes(`id="${id}"`), `${id} belongs with the completion-history download`);
  }
  for (const [fragment, download, field] of [[complete.html, 'btn-export-complete', 'restore-complete'], [reading.html, 'btn-export-json', 'restore-file'], [draft.html, 'btn-export-draft', 'restore-draft'],
    [HISTORY, 'btn-export-history', 'restore-history-file']]) {
    assert.ok(idPosition(fragment, download) < fragment.indexOf(`for="${field}"`), `${download} comes before the restore it pairs with`);
    assert.ok(fragment.indexOf(`for="${field}"`) < idPosition(fragment, field), `${field}'s label comes before it`);
  }
  const mount = idPosition(VIEW, 'normal-backup-history');
  assert.ok(reading.end < mount && mount < draft.start, 'completion history mounts between the other two groups');
  assert.ok(!cards.some((card) => card.start < mount && mount < card.end), 'and inside no other group');
});

// #810, P02-T05: cloud backup keeps a complete backup in the person's own account, so its card follows
// the complete backup's. It starts hidden, because only a build with cloud backup ever shows it, and its
// sign-in button carries Microsoft's logo exactly as Microsoft publishes it (OD-12), beside words that
// are the button's name.
test('the cloud backup card follows the complete backup, starts hidden, and signs in beside Microsoft\'s logo unaltered', async () => {
  const { createHash } = await import('node:crypto');
  const cards = elementsWithClass(VIEW, 'div', 'card');
  const cardOf = (id) => {
    const at = idPosition(VIEW, id);
    return cards.find((card) => card.start < at && at < card.end) ?? null;
  };
  const cloud = cardOf('btn-cloud-sign-in');
  const complete = cardOf('btn-export-complete');
  const reading = cardOf('btn-export-json');
  assert.ok(complete.end < cloud.start && cloud.end < reading.start, 'after the complete backup, before the reading data');
  assert.equal(getAttribute(cloud.open, 'id'), 'cloud-backup');
  assert.match(cloud.open, /\shidden[\s>]/, 'hidden until the page learns this build has cloud backup');
  assert.equal(headingText(cloud.html, 3), 'Cloud backup');
  for (const id of ['cloud-backup-status', 'btn-cloud-retry', 'opt-cloud-auto', 'cloud-discovery-list', 'btn-cloud-delete', 'btn-cloud-disconnect', 'cloud-backup-report']) {
    assert.equal(cardOf(id), cloud, `${id} belongs with the cloud backup card`);
  }
  const signIn = sliceElement(cloud.html, 'button', openingTags(cloud.html, 'button').find((entry) => getAttribute(entry.open, 'id') === 'btn-cloud-sign-in').start);
  // Read from the button's text nodes rather than by deleting its tags, which CodeQL reports as an
  // incomplete sanitizer even in a test (alert #25 on #970).
  const words = [...signIn.matchAll(/>([^<]*)</g)].map((match) => match[1]).join('').trim();
  assert.equal(words, 'Sign in with Microsoft', 'the words are the button\'s name');
  const logo = openingTags(signIn, 'img')[0]?.open ?? '';
  assert.deepEqual(['src', 'alt', 'width', 'height'].map((name) => getAttribute(logo, name)),
    ['./brands/ms-symbollockup_mssymbol_19.svg', '', '21', '21'], 'the logo at its own size, with nothing to say the words do not');
  // An eager image downloads even inside the hidden card, which a build without cloud backup did on every
  // start, four times in the browser check's four loads. A lazy one inside a hidden card never loads.
  assert.equal(getAttribute(logo, 'loading'), 'lazy', 'and downloaded only once the card shows');
  const bytes = readFileSync(new URL('../src/brands/ms-symbollockup_mssymbol_19.svg', import.meta.url));
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest, '929f48f88c8ca7f3f5d294be47ec4caf51acc28ac25340c19a903125d7ecd84a', 'the file Microsoft published on 2026-10-28');
  assert.ok(readFileSync(new URL('../src/brands/README.md', import.meta.url), 'utf8').includes(`\`${digest}\``), 'and the digest its provenance records');
  assert.match(readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8'), /^src\/brands\/\*\.svg -text$/m, 'no checkout converts it');
});

// The two fields that had only an aria-label now carry the visible label the completion-history
// field always had, and that text is each field's accessible name.
test('every file input on Backup & settings has a visible associated label', () => {
  const both = VIEW + HISTORY;
  const inputs = openingTags(both, 'input').filter((entry) => getAttribute(entry.open, 'type') === 'file');
  assert.deepEqual(inputs.map((entry) => getAttribute(entry.open, 'id')).sort(), ['restore-complete', 'restore-draft', 'restore-file', 'restore-history-file']);
  for (const { open } of inputs) {
    const id = getAttribute(open, 'id');
    const labels = [...both.matchAll(new RegExp(`<label\\b[^>]*\\bfor="${escapeRegExp(id)}"[^>]*>([^<]+)</label>`, 'g'))];
    assert.equal(labels.length, 1, `${id} has one label`);
    assert.ok(hasClass(labels[0][0], 'backup-restore-label') && !hasClass(labels[0][0], 'visually-hidden'), `${id}'s label is visible`);
    assert.match(labels[0][1], /^Restore an? [a-z-]+ backup$/, `${id}'s label names what it restores`);
    assert.equal(getAttribute(open, 'aria-label'), null, `${id} takes its name from the visible label`);
  }
});

function disclosureHolding(fragment, marker) {
  return openingTags(fragment, 'details')
    .map((entry) => sliceElement(fragment, 'details', entry.start))
    .find((html) => html.includes(marker)) ?? null;
}

// #835 roughly halves the visible hint text without losing a safety warning: each restore warning
// stays on screen and is read with the field it qualifies, and the longer explanations move into
// disclosures that start closed.
test('restore warnings stay visible with their fields while explanations start closed', () => {
  for (const [fragment, field, hint, warning] of [
    [VIEW, 'restore-complete', 'restore-complete-hint', 'Restoring replaces everything it holds, once you confirm, and cannot be undone.'],
    [VIEW, 'restore-file', 'restore-file-hint', 'Restoring replaces all reading data after confirmation and keeps a saved copy of what it replaces.'],
    [HISTORY, 'restore-history-file', 'restore-history-hint', 'Restoring replaces only completion and enjoyment, after confirmation, with no automatic Undo.'],
  ]) {
    const input = openingTags(fragment, 'input').find((entry) => getAttribute(entry.open, 'id') === field);
    assert.ok(getAttribute(input.open, 'aria-describedby').split(/\s+/).includes(hint), `${field} is described by ${hint}`);
    assert.ok(fragment.includes(`id="${hint}">${warning}</p>`), `${hint} says: ${warning}`);
    assert.equal(disclosureHolding(fragment, `id="${hint}"`), null, `${hint} stays on screen`);
  }
  assert.equal(disclosureHolding(VIEW, 'id="transfer-summary"'), null, 'the transfer summary stays on screen');
  for (const [fragment, marker] of [
    [VIEW, 'id="backup-contents"'],
    [VIEW, 'Undo is offered once, until you reload'],
    [VIEW, 'Only this backup and a complete backup include it.'],
    [HISTORY, 'Completion dates and enjoyment are saved separately'],
  ]) {
    const holder = disclosureHolding(fragment, marker);
    assert.ok(holder, `${marker} sits in a disclosure`);
    assert.ok(!/\sopen[\s>=]/.test(holder.slice(0, holder.indexOf('>') + 1)), `${marker}'s disclosure starts closed`);
  }
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
    ['btn-export-complete', ['btn']],
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

  assert.match(ALL_SOURCE, /class: 'btn btn-g',\s+dataset: \{ act: 'download'/);
  assert.match(ALL_SOURCE, /class: 'btn btn-danger',\s+dataset: \{ act: 'forget'/);
});

test('every settings binding id still appears exactly once in the shipped markup', () => {
  for (const id of REQUIRED_IDS) {
    const count = [...VIEW.matchAll(new RegExp(`id="${escapeRegExp(id)}"`, 'g'))].length;
    assert.equal(count, 1, `expected id="${id}" to appear once in the settings view`);
  }
});

test('cover art is changed only in Settings, not in the Home or reading headers', () => {
  const coverInput = openingTags(VIEW, 'input')
    .find((entry) => getAttribute(entry.open, 'id') === 'opt-covers');
  assert.ok(coverInput, 'expected the Settings cover art control');
  assert.match(coverInput.open, /type="checkbox"/);
  assert.equal([...HTML.matchAll(/id="opt-covers"/g)].length, 1);
  assert.doesNotMatch(HTML, /data-covers-toggle|id="btn-covers"|id="covers-label"/);
});

test('each notice kind keeps its own glyph in the stylesheet', () => {
  const actual = Object.fromEntries(
    Object.keys(NOTICE_GLYPHS).map((kind) => [kind, noticeGlyph(kind)]),
  );
  assert.deepEqual(actual, NOTICE_GLYPHS);
  assert.equal(new Set(Object.values(actual)).size, 4);
});
