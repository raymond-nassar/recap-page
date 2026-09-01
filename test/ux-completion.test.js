import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VIEWS } from '../src/js/lib/route.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const html = read('src/index.html');
const main = read('src/js/main.js');
const add = read('src/js/views/add.js');
const catalogPresentation = read('src/js/views/shared/catalog-presentation.js');
const catalogView = read('src/js/views/catalog.js');
const library = read('src/js/lib/library.js');
const libraryView = read('src/js/views/library.js');
const styles = read('src/styles.css');
function filesUnder(relativeDir, extension) {
  const out = [];
  const visit = (relativeDirPath) => {
    for (const entry of readdirSync(join(ROOT, relativeDirPath), { withFileTypes: true })) {
      const relativePath = join(relativeDirPath, entry.name);
      if (entry.isDirectory()) visit(relativePath);
      else if (entry.isFile() && entry.name.endsWith(extension)) out.push(relativePath);
    }
  };
  visit(relativeDir);
  return out;
}

const productCopy = [
  html.replace(/<!--[\s\S]*?-->/g, ''),
  main.replace(/^\s*\/\/.*$/gm, ''),
  add.replace(/^\s*\/\/.*$/gm, ''),
  read('src/js/lib/catalog.js').replace(/^\s*\/\/.*$/gm, ''),
  library.replace(/^\s*\/\/.*$/gm, ''),
  ...filesUnder('src/data', '.json').map((path) => (
    JSON.stringify(JSON.parse(read(path)), (key, value) => key === 'sourceSection' ? undefined : value)
  )),
  ...filesUnder(join('src', 'data', 'orders'), '.md').map(read),
].join('\n');

function between(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText} after ${startText}`);
  return source.slice(start, end);
}

test('the rail stays fixed while Library, Browse, and Add own their child pages', () => {
  const rail = between(html, '<nav id="sidebar-nav"', '</nav>');
  assert.match(rail, /<h2 id="rail-reading" class="rail-h">Reading<\/h2>/);
  assert.match(rail, /id="list-nav"/, 'the conditional Continue reading slot left the rail');
  for (const view of ['library', 'browse', 'add', 'data', 'about']) {
    assert.match(rail, new RegExp(`data-view="${view}"`), `${view} is missing from the fixed rail`);
  }
  for (const child of ['library-read', 'progress', 'library-manual', 'catalog', 'lines', 'spotlights', ...['add-search', 'add-series', 'add-creator', 'add-import', 'add-manual']]) {
    assert.doesNotMatch(rail, new RegExp(`data-view="${child}"`), `${child} still grows the rail`);
  }
  assert.match(main, /function railParentView\(next\)/, 'child pages no longer select their rail hub');
  assert.match(main, /HOME_CATEGORIES\.some\(\(\{ route \}\) => route === next\)/);
  assert.match(main, /ADD_VIEWS\.includes\(next\)/);
  assert.match(main, /LIBRARY_VIEWS\.some\(\(\{ value \}\) => value === next\)/);
});

test('one shared breadcrumb renderer covers routed views but never Home or dialogs', () => {
  assert.match(main, /function renderBreadcrumbs\(\)/);
  assert.match(main, /const trail = breadcrumbHierarchy\(\{/);
  assert.match(main, /el\('nav', \{ class: 'breadcrumb', 'aria-label': 'Breadcrumb' \}\)/);
  assert.match(main, /if \(existing\?\.dataset\.trail === trailKey\) return;/);
  assert.match(main, /if \(!existing\) head\.before\(breadcrumb\);/);
  assert.match(main, /if \(next === 'issue'\) void issueView\.render\(issueRoute\);\s*renderBreadcrumbs\(\);/);
  assert.match(main, /const issueView = createIssueView\(\{[\s\S]*?\n\s*renderBreadcrumbs,[\s\S]*?\n\}\);/);
  assert.doesNotMatch(html, /<dialog[^>]*>[\s\S]*?class="breadcrumb"/);
  assert.doesNotMatch(main, /#preview[\s\S]{0,120}renderBreadcrumbs|#ask[\s\S]{0,120}renderBreadcrumbs/);
  assert.match(styles, /\.breadcrumb ol\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(styles, /\.breadcrumb li\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
});

test('the narrow rail override follows the base rule it must replace', () => {
  const baseRail = styles.match(/\.rail\s*\{[^}]*position:\s*sticky;[^}]*height:\s*100vh;[^}]*\}/s);
  const narrowRail = styles.match(
    /@media \(max-width:\s*880px\)\s*\{\s*\.shell, \.shell\.railed\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*\}\s*\.rail\s*\{[^}]*position:\s*static;[^}]*height:\s*auto;[^}]*\}\s*\}/s,
  );
  assert.ok(baseRail, 'the base rail no longer owns the wide sticky viewport');
  assert.ok(narrowRail, 'the 880px layout no longer restores document flow');
  assert.ok(
    narrowRail.index > baseRail.index,
    'the base rail overrides the earlier narrow rule at equal specificity',
  );
});

test('product copy uses Reading List everywhere and capitalizes both words', () => {
  const terms = productCopy
    .replace(/Comic Book Reading Orders/g, '')
    .match(/\breading (?:orders?|lists?)\b/gi) ?? [];
  assert.ok(terms.length > 0, 'the product no longer contains any Reading List labels to check');
  assert.deepEqual([...new Set(terms)].sort(),   ['Reading List', 'Reading Lists', 'reading order']);
  assert.doesNotMatch(productCopy, /\breading\s+\$\{/i, 'a dynamic label can bypass the capitalization contract');
  assert.equal(
    [...library.matchAll(/['"]My Reading List['"]/g)].length,
    1,
    'the default list name must have one source rather than repeated literals',
  );
  assert.doesNotMatch(`${main}\n${add}`, /['"]My Reading List['"]/);
  assert.match(add, /ensureList\(DEFAULT_LIST_NAME\)/);
});

test('Search issues groups the destinations the app can actually open', () => {
  const page = between(html, 'id="view-add-search"', 'id="view-add-series"');
  assert.match(page, /<h2 id="search-browse-h">Browse by<\/h2>/);
  assert.match(page, /<h2 id="search-other-h">Other ways to add<\/h2>/);
  for (const view of ['add-series', 'add-creator', 'spotlights', 'catalog', 'add-import', 'add-manual']) {
    assert.ok(VIEWS.includes(view), `${view} is grouped on Search but is not a route`);
    assert.match(page, new RegExp(`data-view="${view}"`), `${view} is missing from the Search groups`);
  }
});

test('browse screens render safe cover-led cards with one-sentence summaries', () => {
  const start = catalogPresentation.indexOf('function catalogCard');
  const body = catalogPresentation.slice(
    start,
    catalogPresentation.indexOf('function markOwnedPaths', start),
  );
  assert.match(body, /paintCoverUrl\(img, fallback, catalogCoverUrl\(list\)/);
  assert.match(body, /desc\.textContent = firstSentence\(list\.description\)/);
  assert.match(body, /class: 'catalog-card'/);
  assert.match(body, /attributionLine\(list\)/, 'Source disclosure left the clean card');
  assert.doesNotMatch(body, /pathChooser\(/, 'variant radios are still standing on every card');
  assert.match(
    styles,
    /\.catalog-card-actions\s*\{[^}]*margin-top:\s*auto;/s,
    'card actions no longer stay aligned at the bottom of equal-height cards',
  );
});

test('the timeline is a vertical chronology rather than a separate year navigator', () => {
  assert.doesNotMatch(html, /id="catalog-timeline"/);
  assert.match(catalogPresentation, /class: 'timeline-flow'/);
  assert.match(catalogPresentation, /class: 'timeline-year-marker is-empty'/);
  assert.match(catalogView, /cardLevel: 'h4'/);
  assert.match(styles, /\.timeline-flow::before\s*\{[^}]*left:\s*var\(--timeline-axis\)/s);
  assert.match(styles, /\.timeline-year-marker\s*\{[^}]*position:\s*sticky;[^}]*padding:\s*var\(--space-2\) var\(--space-9\) var\(--space-2\) 0;/s);
  assert.match(styles, /\.railed \.nav-scroll\s*\{[^}]*scrollbar-width:\s*none;/s);
});

test('Home offers three equal primary path tracks and a responsive compact tier', () => {
  assert.match(
    styles,
    /\.home-paths\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
    'the primary gateway does not give its three paths equal tracks',
  );
  assert.match(
    styles,
    /\.home-paths-secondary\s*\{[^}]*repeat\(auto-fit,[^}]*grid-auto-rows:\s*1fr;/s,
    'secondary gateway cards do not share equal row heights',
  );
  assert.match(
    styles,
    /\.home-path\s*\{[^}]*height:\s*100%;/s,
    'gateway cards do not fill their equal-height tracks',
  );
  assert.match(styles, /@media \(max-width:\s*620px\)\s*\{[^}]*\.home-paths-primary\s*\{[^}]*grid-template-columns:\s*1fr;/s);
});

test('Marvel Ages uses one generated accessible gateway instead of static markup', () => {
  assert.doesNotMatch(html, /id="view-marvel-ages"/);
  assert.match(main, /function renderPublishingIndex\(category, allStories\)/);
  assert.match(
    main,
    /if \(periods\) periods\.hidden = true;\s*if \(periodList\) periodList\.replaceChildren\(\);/,
  );
  assert.match(
    main,
    /if \(category\.kind === 'publishing-index'\) \{\s*renderPublishingIndex\(category, allStories\);\s*return;\s*\}/,
  );
  assert.match(
    main,
    /category\.kind === 'publishing-index' \? \[\] : \[\s*el\('section'/,
    'the gateway still receives the ordinary period picker',
  );
  for (const id of [
    'marvel-ages-earlier',
    'marvel-ages-earlier-h',
    'marvel-ages-earlier-list',
    'marvel-ages-modern',
    'marvel-ages-modern-h',
    'marvel-ages-modern-all',
    'marvel-ages-modern-list',
  ]) {
    assert.match(main, new RegExp(`['"]${id}['"]`), `${id} is missing`);
  }
  assert.match(main, /'aria-labelledby': 'marvel-ages-earlier-h'/);
  assert.match(main, /'aria-labelledby': 'marvel-ages-modern-h'/);
  assert.match(main, /text: 'No Reading Lists are published by age yet\.'/);
  assert.match(
    main,
    /labelledName\(\s*'Browse all Modern Age Reading Lists',\s*`\$\{modern\.label\}, \$\{modern\.count\} Reading Lists`,?\s*\)/,
  );
  assert.match(main, /showView\('age-modern', \{ push: true \}\)/);
});

test('saved Reading Lists use bounded responsive tiles instead of full-width rows', () => {
  assert.match(
    styles,
    /\.yours\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*18rem\),\s*24rem\)\)[^}]*align-items:\s*start;/s,
    'saved Reading Lists still expand into full-width rows',
  );
});

test('the continue-reading panel uses the same bounded measure', () => {
  assert.match(
    styles,
    /\.chero\s*\{[^}]*max-width:\s*72rem;/s,
    'the continue-reading panel still expands across every available pixel',
  );
});

test('Home headings are not explained twice', () => {
  assert.doesNotMatch(html, /id="home-sub"/);
  assert.match(html, /id="home-h" class="home-brand">RECAP PAGE!<\/h1>/);
  assert.match(html, /class="home-action">Browse\. Choose\. Read\.<\/p>/);
  assert.match(styles, /#view-home > \.head\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.home-lockup\s*\{[^}]*grid-column:\s*2;[^}]*justify-items:\s*center;/);
  assert.doesNotMatch(main, /\$\('#home-h'\)\.textContent/);
  assert.doesNotMatch(html, /Featured journey|A place to start|Filter Reading Lists/);
  assert.match(catalogPresentation, /if \(blurb\) children\.push\(/);
});

test('standing explanations move behind disclosures or become compact labels', () => {
  for (const view of ['catalog', 'lines', 'spotlights']) {
    const page = between(html, `id="view-${view}"`, '\n          <section id="view-');
    assert.doesNotMatch(page, /<div class="sub">/, `${view} still has an explanatory page subtitle`);
  }
  assert.doesNotMatch(
    between(html, 'id="view-about"', '</main>'),
    /<div class="sub">/,
    'about still has an explanatory page subtitle',
  );
  assert.match(html, /<summary>How counts work<\/summary>/);
  assert.doesNotMatch(html, /id="progress-sub"|id="progress-note"/);
  assert.match(html, /<summary>What lookup sends<\/summary>/);
  assert.doesNotMatch(html, /Follow your system setting, or pick one and keep it/);
  assert.doesNotMatch(html, /Once a day, the app can ask GitHub/);
  assert.equal(existsSync(join(ROOT, 'src', 'js', 'lib', 'updateCheck.js')), false);
  assert.doesNotMatch(html, /opt-update-checks|btn-check-updates|update-check-report/);
  assert.doesNotMatch(
    main,
    /updateChecks|updateCheckedAt|updateSeenVersion|runAutomaticUpdateCheck|runExplicitUpdateCheck/,
  );
  assert.doesNotMatch(
    `${html}\n${main}`,
    /api\.github\.com\/repos\/raymond-nassar\/recap-page\/releases|marvel-reading-tracker-windows\.zip|delete the old folder|Unzip it anywhere/,
  );
  assert.match(libraryView, /class: 'library-sort', text: view\.sort/);
  assert.match(main, /`\$\{upcoming\.length\} \$\{upcoming\.length === 1 \? 'issue' : 'issues'\}`/);
});
