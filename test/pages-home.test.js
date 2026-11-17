import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  ASSET_STAMPS,
  PAGE_DOCUMENTS,
  PAGE_OUTPUTS,
  PAGE_SOURCES,
  RELEASE_PAGE,
  artifactInventory,
  assetVersion,
  buildPages,
  installArtifact,
  stampAssets,
  stampedReference,
} from '../scripts/build-pages.mjs';
import {
  SITE_ICON,
  escapeHtml,
  renderDocumentPage,
  renderFooter,
  renderMarkdown,
  renderSitePage,
  resolveDocumentLink,
} from '../scripts/lib/pages-documents.mjs';
import {
  PLATFORM_LABELS,
  formatReleaseDate,
  readReleaseDates,
  releasesPage,
  selectRecentReleases,
} from '../scripts/lib/pages-releases.mjs';
import { readerFeatures, releaseRecords } from '../scripts/generate-home-updates.mjs';
import { DEMO_INPUTS } from '../scripts/lib/pages-demo.mjs';
import { homeUpdatesContent } from '../src/js/lib/homeUpdatesContent.js';
import {
  BODY,
  LARGE,
  parseHex,
  ratio,
} from '../scripts/check-palette.mjs';

const ROOT = join(import.meta.dirname, '..');
const PAGE = join(ROOT, 'pages', 'index.html');
const CSS = join(ROOT, 'pages', 'site.css');
const QUESTION_FORM = join(ROOT, '.github', 'ISSUE_TEMPLATE', 'project-question.yml');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'pages.yml');
const html = readFileSync(PAGE, 'utf8');
const css = readFileSync(CSS, 'utf8');
const questionForm = readFileSync(QUESTION_FORM, 'utf8');
const workflow = readFileSync(WORKFLOW, 'utf8');
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const releaseDates = readReleaseDates(ROOT);
const releaseContent = releasesPage(changelog, releaseDates);
const releaseHtml = renderSitePage(RELEASE_PAGE, releaseContent);

const APP_ORIGIN = 'http://127.0.0.1:8787/';
const REPOSITORY = 'https://github.com/raymond-nassar/recap-page';
const PLAY_LISTING = 'https://play.google.com/store/apps/details?id=io.github.raymondnassar.recappage';
const APP_STORE_LISTING = 'https://apps.apple.com/us/app/recap-page/id6828494712';
const QUESTION_FORM_URL = `${REPOSITORY}/issues/new?template=project-question.yml`;
const QUESTION_CONTEXT_LINKS = [
  `${REPOSITORY}#readme`,
  `${REPOSITORY}/blob/main/docs/RUNNING.md`,
  `${REPOSITORY}/blob/main/PRIVACY.md`,
  `${REPOSITORY}/blob/main/docs/ARCHITECTURE.md`,
  `${REPOSITORY}/blob/main/docs/DATA_PROVENANCE.md`,
  `${REPOSITORY}/blob/main/GOVERNANCE.md`,
  `${REPOSITORY}/blob/main/CONTRIBUTING.md`,
  `${REPOSITORY}/releases`,
];
function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/\s([A-Za-z][\w-]*)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
  );
}

function stripComments(source, extension) {
  const pattern = extension === 'html' ? /<!--[\s\S]*?-->/g : /\/\*[\s\S]*?\*\//g;
  return source.replace(pattern, (comment) => comment.replace(/[^\n]/g, ' '));
}

function blockFrom(source, opener) {
  const start = source.indexOf('{', opener);
  assert.notEqual(start, -1, `no block starts after ${source.slice(opener, opener + 40)}`);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start + 1, index);
  }
  assert.fail('CSS block does not close');
}

function tokensFrom(block) {
  return new Map(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)]
      .map((match) => [`--${match[1]}`, match[2].trim()]),
  );
}

function colour(tokens, name) {
  const parsed = parseHex(tokens.get(name) ?? '');
  assert.ok(parsed, `${name} is not a hex colour`);
  return parsed;
}

function contrast(tokens, foreground, background) {
  return ratio(colour(tokens, foreground), colour(tokens, background));
}

async function copyApprovedSources(root) {
  for (const { source } of [...PAGE_SOURCES, ...PAGE_DOCUMENTS, ...DEMO_INPUTS.map((source) => ({ source }))]) {
    const destination = join(root, ...source.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(ROOT, ...source.split('/')), destination);
  }
}

function plain(source) {
  return source
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .trim();
}

function section(id) {
  return html.match(new RegExp(`<section id="${id}"[\\s\\S]*?<\\/section>`))?.[0] ?? '';
}

function links(source) {
  return [...source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => {
    const attrs = attributes(match[1]);
    return {
      href: attrs.href,
      button: (attrs.class ?? '').split(/\s+/).includes('button'),
      name: plain(match[2]),
    };
  });
}

test('the project home accurately describes its Android listing and available store apps', () => {
  const gradle = readFileSync(join(ROOT, 'packaging', 'android', 'app', 'build.gradle'), 'utf8');
  const applicationId = /^\s*applicationId '([\w.]+)'$/m.exec(gradle)?.[1];
  assert.equal(PLAY_LISTING, `https://play.google.com/store/apps/details?id=${applicationId}`);

  const platforms = [...section('get-started').matchAll(/<article data-platform="([^"]+)">([\s\S]*?)<\/article>/g)];
  assert.deepEqual(platforms.map(([, id]) => id), ['windows', 'android', 'iphone', 'ipad']);
  const android = platforms[1][2];
  assert.match(android, /Android 8 or later, with an up-to-date Android System WebView/);
  assert.deepEqual(links(android).map(({ href, name }) => [href, name]), [
    [PLAY_LISTING, 'Open Google Play'],
    [`${REPOSITORY}/blob/main/docs/ANDROID.md`, 'Android app details'],
  ]);
  for (const ios of platforms.slice(2)) {
    assert.ok(links(ios[2]).some(({ href }) => href === APP_STORE_LISTING));
  }
  assert.match(section('overview'), /curated reading lists with real sources, not AI-generated orders/);
  assert.match(section('get-started'), /Uninstalling Android deletes its saved data/);
});

test('device filtering remains an enhancement over the full no-script platform list', () => {
  const picker = section('get-started');
  assert.match(picker, /<select id="platform-picker" aria-controls="platform-details">/);
  assert.match(picker, /<option value="all">Show all devices<\/option>/);
  assert.equal((picker.match(/<article data-platform=/g) ?? []).length, 4);
  assert.match(readFileSync(join(ROOT, 'pages', 'site.js'), 'utf8'), /card\.hidden = platformPicker\.value !== 'all'/);
});

test('the guide demo keeps comic art remote and the app screenshot has a real alternative', () => {
  const images = [...html.matchAll(/<img\b[\s\S]*?\/>/g)].map((tag) => attributes(tag[0]))
    .filter(({ src }) => src !== './assets/wordmark-dark.svg');
  const screenshot = images.find(({ src }) => src === './assets/avengers-disassembled-reading-960.png');
  assert.equal(screenshot.width, '960');
  assert.equal(screenshot.height, '900');
  assert.ok(screenshot.alt.length > 40);
  assert.equal(screenshot.loading, 'lazy');
  assert.match(html, /Cover art loads directly from Marvel's image server/);
  assert.match(html, /stores cover links, not image files/);
  const script = readFileSync(join(ROOT, 'pages', 'site.js'), 'utf8');
  assert.doesNotMatch(script, /\b(?:localStorage|sessionStorage|fetch|XMLHttpRequest)\b/);
});

test('home and generated mastheads use separate wordmark artwork with a forced-colors text fallback', () => {
  assert.match(html, /<picture>[\s\S]*?srcset="\.\/assets\/wordmark\.svg"[\s\S]*?alt="Recap Page"/);
  assert.match(releaseHtml, /<picture>[\s\S]*?srcset="\.\/assets\/wordmark\.svg"[\s\S]*?alt="Recap Page"/);
  assert.match(css, /\.masthead \{[^}]*background: var\(--surface\)/);
  assert.match(css, /\.site-name img \{[^}]*height: 2\.75rem;/);
  assert.match(css, /@media \(forced-colors: active\) \{[\s\S]*?\.site-name-text \{[\s\S]*?display: inline;[\s\S]*?color: CanvasText;/);
});

test('the source inventory and generated contract stay exact', async () => {
  assert.deepEqual((await readdir(join(ROOT, 'pages'))).sort(), ['assets', 'being-built.md', 'data-sources.md', 'demo.css', 'demo.js', 'index.html', 'site.css', 'site.js']);
  assert.deepEqual((await readdir(join(ROOT, 'pages', 'assets'))).sort(), [
    'android-feature-graphic.png',
    'android-library-preview.png',
    'android-reading-preview.png',
    'wordmark-dark.svg',
    'wordmark.svg',
  ]);
  assert.deepEqual(PAGE_OUTPUTS, [
    'assets/android-feature-graphic.png',
    'assets/android-library-preview.png',
    'assets/android-reading-preview.png',
    'assets/avengers-disassembled-reading-960.png',
    'assets/home-960.png',
    'assets/wordmark-dark.svg',
    'assets/wordmark.svg',
    'being-built.html',
    'data-sources.html',
    'demo.html',
    'index.html',
    'privacy.html',
    'site.css',
    'site.js',
    'support.html',
    'whats-new.html',
  ]);
  assert.deepEqual(
    PAGE_DOCUMENTS.map(({ source, destination }) => [source, destination]),
    [
      ['SUPPORT.md', 'support.html'],
      ['PRIVACY.md', 'privacy.html'],
      ['pages/data-sources.md', 'data-sources.html'],
      ['pages/being-built.md', 'being-built.html'],
    ],
  );
  assert.deepEqual(
    PAGE_SOURCES.map(({ source }) => source),
    [
      'pages/index.html',
      'pages/site.css',
      'pages/site.js',
      'docs/screenshots/home-960.png',
      'docs/screenshots/avengers-disassembled-reading-960.png',
      'pages/assets/android-feature-graphic.png',
      'pages/assets/android-library-preview.png',
      'pages/assets/android-reading-preview.png',
      'pages/assets/wordmark.svg',
      'pages/assets/wordmark-dark.svg',
    ],
  );
});

test('the page exposes its main tasks as semantic HTML and keeps JavaScript external', () => {
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<meta name="referrer" content="no-referrer"\s*\/>/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.equal((html.match(/<header\b/g) ?? []).length, 1);
  assert.equal((html.match(/<main\b/g) ?? []).length, 1);
  assert.equal((html.match(/<footer\b/g) ?? []).length, 1);
  assert.match(html, /<nav class="section-nav" aria-label="Site">/);
  assert.match(html, /<a class="skip-link" href="#main">Skip to main content<\/a>/);

  const requiredIds = [
    'main',
    'overview',
    'demo',
    'reading-orders',
    'timeline',
    'explore',
    'mcu-prep',
    'guides',
    'get-started',
    'faq',
    'feedback',
    'support-project',
  ];
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const id of requiredIds) assert.ok(ids.has(id), `missing required page region ${id}`);

  const headings = [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
  assert.equal(headings[0], 1);
  headings.slice(1).forEach((level, index) => {
    assert.ok(level <= headings[index] + 1, `heading level jumps from ${headings[index]} to ${level}`);
  });

  for (const section of html.matchAll(/<section\b[^>]*>/g)) {
    const attrs = attributes(section[0]);
    assert.ok(attrs.id, `section has no id: ${section[0]}`);
    assert.ok(attrs['aria-labelledby'], `section ${attrs.id} has no accessible label`);
    assert.ok(ids.has(attrs['aria-labelledby']), `section ${attrs.id} names a missing heading`);
  }

  assert.match(html, /<script type="module" src="\.\/site\.js"><\/script>/);
  assert.doesNotMatch(html, /<form\b/i);
  assert.match(html, /sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /\b(?:localStorage|serviceWorker|manifest\.webmanifest|localhost)\b/i);
  assert.doesNotMatch(readFileSync(join(ROOT, 'pages', 'site.js'), 'utf8'), /\b(?:localStorage|sessionStorage|fetch|XMLHttpRequest)\b/);
  assert.doesNotMatch(html, /\btarget="/i);
  assert.match(html, /GitHub hosts this site and receives request details, including your IP address/);
  assert.match(html, /This site cannot access your saved reading data/);
  assert.match(html, /The guided controls need JavaScript/);
});

test('the project home keeps its copy concise and its navigation focused', () => {
  const visibleCopy = html.slice(html.indexOf('<body>')).replace(/<[^>]+>/g, ' ');
  const words = visibleCopy.match(/\S+/g) ?? [];
  assert.ok(words.length <= 1100, `${words.length} words exceed the 1100-word feature-tour budget`);
  const navigation = html.match(/<nav class="section-nav"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.deepEqual(links(navigation).map(({ href }) => href), [
    '#demo', '#reading-orders', '#timeline', '#explore', '#mcu-prep', '#get-started', '#guides',
  ]);
});

test('the project distinguishes guide permissions and includes all four feedback routes', () => {
  const guideCopy = plain(section('guides'));
  assert.match(guideCopy, /Some publishers have explicitly permitted building from eligible public reading orders/);
  assert.match(guideCopy, /without granting a broader license/);
  assert.match(guideCopy, /not a blanket license over its editorial work or Marvel's comics/);
  assert.deepEqual(links(section('feedback')).filter(({ href }) => href.includes('/issues/new?template=')), [
    { href: `${REPOSITORY}/issues/new?template=feature.yml`, button: false, name: 'Suggest an improvement' },
    { href: `${REPOSITORY}/issues/new?template=reading-list.yml`, button: false, name: 'Request a reading list' },
    { href: `${REPOSITORY}/issues/new?template=data-order.yml`, button: false, name: 'Correct a reading list' },
    { href: `${REPOSITORY}/issues/new?template=bug.yml`, button: false, name: 'Report a bug' },
  ]);
  assert.match(plain(section('feedback')), /Requests are reviewed\. Replies can take time or may be declined/);
  assert.deepEqual(links(section('support-project')).filter(({ href }) => href === 'https://ko-fi.com/panelstacklabs').map(({ name }) => name), [
    'Buy Ray a Coffee',
  ]);
});

test('the reading list request form asks only for the list and an optional permitted guide', () => {
  const form = readFileSync(join(ROOT, '.github', 'ISSUE_TEMPLATE', 'reading-list.yml'), 'utf8');
  assert.match(form, /^name: Request a reading list$/m);
  assert.doesNotMatch(form, /^labels:/m);
  assert.deepEqual([...form.matchAll(/^\s{4}id: ([\w-]+)$/gm)].map((match) => match[1]), ['reading-list', 'guide']);
  assert.match(form, /Which story, character, or event would you like to read\?[\s\S]*?required: true/);
  assert.match(form, /Which published guide should the list follow, if any\?[\s\S]*?required: false/);
  assert.match(form, /\[Comic Book Herald\]\(https:\/\/www\.comicbookherald\.com\/\)/);
  assert.match(form, /\[Comic Book Reading Orders\]\(https:\/\/comicbookreadingorders\.com\/\)/);
  assert.match(form, /except its\s+Marvel Master Reading Order and Patreon-only orders/);
  assert.match(form, /Other guides need permission before they can be used/);
  assert.match(form, /Do not include reading progress, notes, backups,\s+personal details, or attachments/);
  assert.doesNotMatch(form, /[\u2013\u2014]|type: (?:dropdown|checkboxes)/);
});

test('the project icon is self-contained so the owner-site root is never requested', () => {
  const icon = /<link\s+rel="icon"\s+href="data:image\/svg\+xml;base64,([^"]+)"\s*\/>/m.exec(html);
  assert.ok(icon, 'the Page has no in-document SVG icon');
  const svg = Buffer.from(icon[1], 'base64').toString('utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 32 32">/);
  assert.match(svg, /fill="#6d28d9"/);
  assert.match(svg, /fill="#9e71e6"/);
  assert.match(svg, /<\/svg>$/);
  assert.doesNotMatch(html, /href="\/favicon\.ico"|href="https:\/\/raymond-nassar\.github\.io\/favicon\.ico"/);
});

test('all links and fragments resolve to the approved destinations', () => {
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]);
  const linked = new Set(hrefs);
  assert.ok(linked.has('https://ko-fi.com/panelstacklabs'));
  assert.ok(linked.has('./data-sources.html'));
  assert.ok(linked.has('./support.html'));

  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const href of hrefs.filter((value) => value.startsWith('#'))) {
    assert.ok(ids.has(href.slice(1)), `${href} names no page region`);
  }

  const blobPrefix = `${REPOSITORY}/blob/main/`;
  for (const href of hrefs.filter((value) => value.startsWith(blobPrefix))) {
    const path = href.slice(blobPrefix.length).split('#')[0];
    assert.ok(existsSync(join(ROOT, ...path.split('/'))), `${href} names a missing project file`);
  }

  for (const href of hrefs.filter((value) => value.includes('/issues/new?template='))) {
    const template = new URL(href).searchParams.get('template');
    assert.ok(
      existsSync(join(ROOT, '.github', 'ISSUE_TEMPLATE', template)),
      `${href} names a missing issue form`,
    );
  }

  const cleartext = [...html.matchAll(/http:\/\/[^"<\s]+/g)].map((match) => match[0]);
  assert.deepEqual(cleartext, [APP_ORIGIN]);
  assert.ok(hrefs.every((href) => href.startsWith('#') || href.startsWith('https://')
    || (href.startsWith('./') && PAGE_OUTPUTS.includes(href.slice(2)))));
});

test('desktop setup documents the exact progress-preserving origin', () => {
  const setup = section('get-started');
  assert.match(setup, new RegExp(`<code>${APP_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</code>`));
  assert.doesNotMatch(setup, /localhost|flexible origin/i);
  assert.match(setup, /Keep the same browser profile and address to see your progress/);
});

test('published local screenshots have accurate dimensions and useful alternatives', () => {
  const images = [...html.matchAll(/<img\b[\s\S]*?\/>/g)].map((tag) => attributes(tag[0]))
    .filter(({ src }) => src === './assets/avengers-disassembled-reading-960.png');
  assert.deepEqual(
    images.map(({ src }) => src),
    [
      './assets/avengers-disassembled-reading-960.png',
    ],
  );
  for (const image of images) {
    assert.ok(image.alt?.length > 20, `${image.src} has no useful text alternative`);
    const entry = PAGE_SOURCES.find(({ destination }) => destination === image.src.slice(2));
    assert.ok(entry, `${image.src} is not included in the built page`);
    const bytes = readFileSync(join(ROOT, ...entry.source.split('/')));
    assert.equal(bytes.readUInt32BE(16), Number(image.width));
    assert.equal(bytes.readUInt32BE(20), Number(image.height));
  }
});

test('the site does not imply access to private progress or publish a public question form', () => {
  assert.match(html, /This site cannot access your saved reading data/);
  assert.match(html, /this demo never opens a reader/i);
  assert.doesNotMatch(html, new RegExp(QUESTION_FORM_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /github\.com\/users\/raymond-nassar\/projects\/1/);

  const currentSources = [
    ['pages/index.html', html],
    ['SUPPORT.md', readFileSync(join(ROOT, 'SUPPORT.md'), 'utf8')],
    ['PRIVACY.md', readFileSync(join(ROOT, 'PRIVACY.md'), 'utf8')],
    ['SECURITY.md', readFileSync(join(ROOT, 'SECURITY.md'), 'utf8')],
    ['docs/ARCHITECTURE.md', readFileSync(join(ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8')],
    ['docs/ARCHITECTURE_REFERENCE.md', readFileSync(join(ROOT, 'docs', 'ARCHITECTURE_REFERENCE.md'), 'utf8')],
    ['docs/MAINTAINING.md', readFileSync(join(ROOT, 'docs', 'MAINTAINING.md'), 'utf8')],
    ['CHANGELOG.md', readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')],
  ];
  for (const [path, source] of currentSources) {
    assert.doesNotMatch(
      source,
      /github\.com\/copilot\/spaces|Optional answers from GitHub Copilot|Configure the Copilot Space|Ask GitHub Copilot/,
      `${path} still advertises the unavailable Space`,
    );
  }
});

test('the public question form is source-framed and safe', () => {
  assert.match(questionForm, /^name: Ask a project question$/m);
  assert.match(questionForm, /^description: Ask how Recap Page works or why a documented project decision was made\.$/m);
  assert.match(questionForm, /^labels: \["question"\]$/m);

  const intro = questionForm.slice(0, questionForm.indexOf('  - type: dropdown'));
  assert.match(intro, /You need a GitHub account and must sign in/);
  assert.match(intro, /username, question and every reply are public/);
  assert.match(intro, /GitHub hosts and processes that content/);
  assert.match(intro, /Recap Page does not send reading progress or anything else here automatically/);
  for (const href of QUESTION_CONTEXT_LINKS) {
    assert.equal(
      [...intro.matchAll(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].length,
      1,
      `${href} is not present exactly once in the question context`,
    );
  }
  for (const route of [
    `${REPOSITORY}/blob/main/SUPPORT.md`,
    `${REPOSITORY}/issues/new?template=bug.yml`,
    `${REPOSITORY}/issues/new?template=feature.yml`,
    `${REPOSITORY}/issues/new?template=data-order.yml`,
    `${REPOSITORY}/blob/main/SECURITY.md`,
  ]) {
    assert.match(intro, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const controls = [...questionForm.matchAll(/^\s{4}id: ([\w-]+)$/gm)]
    .map((match) => match[1]);
  assert.deepEqual(controls, ['topic', 'question', 'source-context', 'public-content']);
  const options = [...questionForm.matchAll(/^\s{8}- "([^"]+)"$/gm)]
    .map((match) => match[1]);
  assert.deepEqual(options, [
    'The product or running it',
    'Privacy or saved data',
    'Architecture',
    'Data provenance',
    'Governance, contributing, or releases',
    'No maintained source seems to fit',
  ]);
  assert.match(questionForm, /Name the source and what remains unclear, or state that none of the listed sources fits/);
  assert.doesNotMatch(questionForm, /^\s+- type: input$/m);
  assert.match(
    questionForm,
    /I understand that this issue, my username and every reply are public\.\s+required: true/,
  );
  assert.match(
    questionForm,
    /I have not included reading progress, lists, notes, backup content, personal information,\s+attachments or vulnerability details\.\s+required: true/,
  );
});

test('Page HTML and CSS enforce the shipped writing rule', () => {
  const dash = /[\u2013\u2014]/;
  assert.doesNotMatch(stripComments(html, 'html'), dash);
  assert.doesNotMatch(stripComments(css, 'css'), dash);
});

test('Page spacing stays on its own small ladder', () => {
  const tokens = [...css.matchAll(/--space-(\d+):/g)].map((match) => Number(match[1]));
  assert.deepEqual(tokens, [1, 2, 3, 4, 5, 6, 7]);

  const declarations = [...stripComments(css, 'css').matchAll(
    /^\s*(margin(?:-(?:top|right|bottom|left|inline|block))?|padding(?:-(?:top|right|bottom|left|inline|block))?|gap|row-gap|column-gap):\s*([^;]+);/gm,
  )];
  assert.ok(declarations.length > 20, 'no meaningful Page spacing inventory was found');
  for (const declaration of declarations) {
    const values = declaration[2].trim().split(/\s+/);
    assert.ok(
      values.every((value) => /^(?:0|auto|var\(--space-[1-7]\))$/.test(value)),
      `${declaration[1]} uses off-ladder spacing ${declaration[2].trim()}`,
    );
  }
});

test('Page colour pairs clear their text and boundary floors', () => {
  const light = tokensFrom(blockFrom(css, css.indexOf(':root {')));
  const darkMedia = css.indexOf('@media (prefers-color-scheme: dark)');
  const dark = new Map([
    ...light,
    ...tokensFrom(blockFrom(css, css.indexOf(':root {', darkMedia))),
  ]);
  const pairs = [
    ['--text', '--page', BODY],
    ['--muted', '--page', BODY],
    ['--accent-fill', '--page', BODY],
    ['--text', '--surface', BODY],
    ['--muted', '--surface', BODY],
    ['--accent-fill', '--surface', BODY],
    ['--accent-ink', '--accent-fill', BODY],
    ['--blue', '--page', BODY],
    ['--blue', '--surface', BODY],
    ['--red', '--page', BODY],
    ['--red', '--surface', BODY],
    ['--line', '--page', LARGE],
    ['--line', '--surface', LARGE],
    ['--opening-text', '--opening-bg', BODY],
    ['--opening-muted', '--opening-bg', BODY],
    ['--source-text', '--source-bg', BODY],
    ['--source-muted', '--source-bg', BODY],
    ['--source-link', '--source-card', BODY],
    ['--mcu-text', '--mcu-bg', BODY],
    ['--mcu-muted', '--mcu-bg', BODY],
    ['--tour-ink', '--tour-surface', BODY],
    ['--tour-muted', '--tour-surface', BODY],
  ];

  for (const [themeName, tokens] of [['light', light], ['dark', dark]]) {
    for (const [foreground, background, floor] of pairs) {
      const measured = contrast(tokens, foreground, background);
      assert.ok(
        measured >= floor,
        `${themeName} ${foreground} on ${background} is ${measured.toFixed(2)}:1, below ${floor}:1`,
      );
    }
  }
});

test('motion, focus, narrow layout and forced colours have explicit contracts', () => {
  assert.match(css, /:focus-visible\s*\{[\s\S]*outline:/);
  assert.match(css, /@media \(max-width: 40rem\)\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*scroll-behavior: auto !important/);
  assert.match(css, /@media \(forced-colors: active\)\s*\{[\s\S]*border: var\(--frame\) solid CanvasText/);
  assert.match(css, /@media \(forced-colors: active\)\s*\{[\s\S]*outline: 0\.2rem solid Highlight/);
  assert.match(css, /transition: background-color 140ms ease, color 140ms ease, transform 140ms ease/);
});

test('the design uses its palette and semantic colors consistently', () => {
  const source = css.replace(/\r\n/g, '\n');
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bodies = [...source.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1]);
    assert.ok(bodies.length > 0, `${selector} has a rule`);
    return bodies.join('\n');
  };
  assert.match(rule('a'), /color: var\(--blue\)/);
  assert.match(rule(':focus-visible'), /outline: 0\.2rem solid var\(--focus\)/);
  assert.match(rule('.section-nav a[aria-current="page"]'), /color: var\(--accent-fill\)/);
  assert.match(rule('.footer'), /border-top: var\(--frame\) solid var\(--line\)/);
  assert.match(rule('.opening'), /background: var\(--opening-bg\)/);
  assert.match(rule('.source-section'), /background: var\(--source-bg\)/);
  assert.match(rule('.source-copy a'), /color: var\(--source-link\)/);
  assert.match(source, /@media \(forced-colors: active\)\s*\{[\s\S]*\.site-name picture\s*\{\s*display: none;/);
  assert.match(source, /--focus:/);
});

test('the builder copies only approved bytes and leaves no staging residue', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'recap-page-pages-test-'));
  const destination = join(temporary, 'artifact');
  try {
    const result = await buildPages({ destination });
    assert.deepEqual(result.files, PAGE_OUTPUTS);
    assert.deepEqual(await artifactInventory(destination), PAGE_OUTPUTS);

    // The version stamps are checked against the deployed bytes by their own test below.
    const stamped = new Set(ASSET_STAMPS.map(({ file }) => file));
    const unstamped = async (file) => (
      (await readFile(join(destination, file), 'utf8')).replace(/\?v=[0-9a-f]{12}/g, '')
    );

    for (const { source, destination: relativeDestination } of PAGE_SOURCES) {
      if (stamped.has(relativeDestination)) {
        assert.equal(
          await unstamped(relativeDestination),
          await readFile(join(ROOT, ...source.split('/')), 'utf8'),
          `${relativeDestination} differs from ${source} beyond its version stamps`,
        );
      } else {
        assert.deepEqual(
          await readFile(join(destination, ...relativeDestination.split('/'))),
          await readFile(join(ROOT, ...source.split('/'))),
          `${relativeDestination} differs from ${source}`,
        );
      }
      assert.equal((await lstat(join(destination, ...relativeDestination.split('/')))).isFile(), true);
    }

    for (const document of PAGE_DOCUMENTS) {
      const markdown = await readFile(join(ROOT, ...document.source.split('/')), 'utf8');
      assert.equal(
        await unstamped(document.destination),
        renderDocumentPage(document, markdown),
        `${document.destination} differs from the page rendered from ${document.source}`,
      );
    }
    assert.equal(
      await unstamped(RELEASE_PAGE.destination),
      releaseHtml,
      `${RELEASE_PAGE.destination} differs from the page generated from the changelog`,
    );

    await buildPages({ destination });
    assert.deepEqual(await artifactInventory(destination), PAGE_OUTPUTS);
    const leftovers = (await readdir(temporary)).filter((entry) => (
      entry.startsWith('artifact.staged-') || entry.startsWith('artifact.previous-')
    ));
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('every page asks for its stylesheet, script and demo by a digest of the deployed bytes', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'recap-page-pages-stamps-'));
  const destination = join(temporary, 'artifact');
  try {
    await buildPages({ destination });
    for (const stamp of ASSET_STAMPS) {
      const page = await readFile(join(destination, stamp.file), 'utf8');
      const version = assetVersion(await readFile(join(destination, stamp.asset)));
      assert.equal(
        page.split(stampedReference(stamp, version)).length,
        2,
        `${stamp.file} asks for ./${stamp.asset} once, by the digest ${version} of the deployed bytes`,
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('a page whose asset reference was rewritten is refused rather than published unstamped', async () => {
  const root = await mkdtemp(join(tmpdir(), 'recap-page-pages-unstamped-'));
  const [stamp] = ASSET_STAMPS.filter(({ file, asset }) => file === 'index.html' && asset === 'site.css');
  try {
    await writeFile(join(root, 'site.css'), 'body {}\n', 'utf8');
    for (const [page, found] of [
      [stamp.reference.replace('href="./site.css"', 'href="site.css"'), 0],
      [`${stamp.reference}\n${stamp.reference}`, 2],
    ]) {
      await writeFile(join(root, 'index.html'), page, 'utf8');
      await assert.rejects(
        stampAssets(root, [stamp]),
        new RegExp(`index\\.html must contain .*\\./site\\.css.* exactly once, found ${found}`),
      );
      assert.equal(await readFile(join(root, 'index.html'), 'utf8'), page);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an invalid source inventory is refused before the destination is touched', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'recap-page-pages-refusal-'));
  const root = join(temporary, 'source');
  const destination = join(temporary, 'artifact');
  try {
    await copyApprovedSources(root);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'previous.txt'), 'keep this complete artifact', 'utf8');
    for (const unexpected of [
      join(root, 'pages', 'unexpected.html'),
      join(root, 'pages', 'assets', 'unexpected.png'),
    ]) {
      await writeFile(unexpected, 'not approved', 'utf8');
      await assert.rejects(
        buildPages({ root, destination }),
        /Pages source inventory/,
      );
      assert.equal(
        await readFile(join(destination, 'previous.txt'), 'utf8'),
        'keep this complete artifact',
      );
      assert.deepEqual(await readdir(destination), ['previous.txt']);
      await rm(unexpected);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('a failed artifact installation restores the previous bytes and leaves no residue', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'recap-page-pages-restore-'));
  const destination = join(temporary, 'artifact');
  try {
    await buildPages({ destination });
    const previous = Buffer.concat([
      await readFile(join(destination, 'index.html')),
      Buffer.from('\n<!-- previous complete artifact -->\n'),
    ]);
    await writeFile(join(destination, 'index.html'), previous);

    let moveCalls = 0;
    const installer = (staged, target) => installArtifact(staged, target, {
      move: async (source, next) => {
        moveCalls += 1;
        if (moveCalls === 2) {
          const error = new Error('forced staged artifact installation failure');
          error.code = 'EACCES';
          throw error;
        }
        return rename(source, next);
      },
    });

    await assert.rejects(
      buildPages({ destination, installer }),
      /forced staged artifact installation failure/,
    );
    assert.equal(moveCalls, 3, 'destination move, failed install and previous restoration all ran');
    assert.deepEqual(await readFile(join(destination, 'index.html')), previous);
    assert.deepEqual(await artifactInventory(destination), PAGE_OUTPUTS);
    assert.deepEqual(
      await readdir(temporary),
      ['artifact'],
      'no staged or previous artifact remains beside the restored destination',
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('the Pages workflow deploys only reviewed main with isolated authority', () => {
  assert.match(workflow, /^name: Pages home$/m);
  assert.match(workflow, /^ {2}push:\r?\n {4}branches: \[main\]$/m);
  assert.match(workflow, /^ {2}workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^ {2}pull_request:/m);
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /^ {2}group: pages\r?\n {2}cancel-in-progress: false$/m);

  const build = workflow.slice(workflow.indexOf('  build:'), workflow.indexOf('  deploy:'));
  const deploy = workflow.slice(workflow.indexOf('  deploy:'));
  assert.match(build, /^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
  assert.match(build, /^ {4}permissions:\r?\n {6}contents: read$/m);
  assert.doesNotMatch(build, /^ {6}(?:pages|id-token):/m);
  assert.match(build, /run: node --test test\/pages-home\.test\.js/);
  assert.match(build, /run: npm run pages:build/);
  assert.match(build, /^ {10}path: dist\/pages$/m);
  assert.match(build, /^ {10}retention-days: 1$/m);
  assert.match(build, /persist-credentials: false/);
  assert.match(build, /^ {10}fetch-depth: 0$/m, 'release dates need the tags a shallow checkout omits');

  assert.match(deploy, /^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
  assert.match(deploy, /^ {4}needs: build$/m);
  assert.match(deploy, /^ {4}permissions:\r?\n {6}pages: write\r?\n {6}id-token: write$/m);
  assert.doesNotMatch(deploy, /^ {6}contents:/m);
  assert.match(deploy, /^ {4}environment:\r?\n {6}name: github-pages$/m);
  assert.match(deploy, /url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/);

  assert.doesNotMatch(workflow, /actions\/configure-pages/);
  assert.doesNotMatch(workflow, /\b(?:npm\s+(?:ci|install|i)|npx)\b/);
  assert.doesNotMatch(workflow, /\bsecrets\./);
});

test('the Pages workflow pins the current reviewed actions exactly', () => {
  const actions = [...workflow.matchAll(
    /^\s*uses: (actions\/[^@\s]+)@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)$/gm,
  )].map((match) => ({
    action: match[1],
    sha: match[2],
    version: match[3],
  }));
  assert.deepEqual(actions, [
    {
      action: 'actions/checkout',
      sha: '3d3c42e5aac5ba805825da76410c181273ba90b1',
      version: 'v7.0.1',
    },
    {
      action: 'actions/setup-node',
      sha: '949feb2413d6458794dcd2491c4babbbce0c15c1',
      version: 'v7.1.0',
    },
    {
      action: 'actions/upload-pages-artifact',
      sha: 'fc324d3547104276b827a68afc52ff2a11cc49c9',
      version: 'v5.0.0',
    },
    {
      action: 'actions/deploy-pages',
      sha: '368f82528645a54fb793d4d04e342629a3f51346',
      version: 'v5.0.1',
    },
  ]);
});

test('every Pages workflow step times out before its job backstop', () => {
  for (const [name, block, expectedSteps] of [
    ['build', workflow.slice(workflow.indexOf('  build:'), workflow.indexOf('  deploy:')), 5],
    ['deploy', workflow.slice(workflow.indexOf('  deploy:')), 1],
  ]) {
    const jobTimeout = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(block)?.[1]);
    const stepOpeners = [...block.matchAll(/^ {6}- (?:name|uses):/gm)].length;
    const stepTimeouts = [...block.matchAll(/^ {8}timeout-minutes: (\d+)$/gm)]
      .map((match) => Number(match[1]));
    assert.equal(stepOpeners, expectedSteps, `${name} step count changed`);
    assert.equal(stepTimeouts.length, expectedSteps, `${name} has a step without a deadline`);
    assert.ok(
      jobTimeout >= stepTimeouts.reduce((sum, timeout) => sum + timeout, 0) + 1,
      `${name} job timeout can fire before its steps finish`,
    );
  }
});

const DOCUMENT_PAGES = PAGE_DOCUMENTS.map((document) => {
  const markdown = readFileSync(join(ROOT, ...document.source.split('/')), 'utf8');
  return { ...document, markdown, page: renderDocumentPage(document, markdown) };
});
const pageByDestination = new Map([
  ['index.html', html],
  ...DOCUMENT_PAGES.map(({ destination, page }) => [destination, page]),
  [RELEASE_PAGE.destination, releaseHtml],
]);
const SHELL_PAGES = [
  ...DOCUMENT_PAGES,
  { ...RELEASE_PAGE, page: releaseHtml },
];

test('the curated source publishes only cloud backup with the approved provider distinctions', () => {
  const { markdown, page } = DOCUMENT_PAGES.find(({ destination }) => destination === 'being-built.html');
  assert.deepEqual([...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]), ['Cloud backup']);
  const copy = plain(page);
  assert.match(copy, /OneDrive: automatic backup shipped in 4\.3\.0 on Windows and Android/);
  assert.match(copy, /Google Drive: work for Windows and Android is deferred while the owner hears from users\. It has not shipped/);
  assert.match(copy, /iCloud: automatic backup is part of version 4\.4\.0 on iPhone and iPad\. Windows and Android back up automatically to OneDrive\./);
  assert.doesNotMatch(copy, /iCloud:[^.]*not Windows or Android/);
  assert.match(copy, /not automatic device sync/);
  assert.match(copy, /There are no promised release dates/);
  assert.ok(page.includes(`href="${REPOSITORY}/issues/810"`));
  assert.ok(page.includes(`href="${REPOSITORY}/issues/949"`));
  assert.ok(page.includes('href="./index.html#feedback"'));
  assert.doesNotMatch(page, /github\.com\/users\/[^/]+\/projects|<script\b/);
});

function decode(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

function words(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function idsOf(page) {
  return new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
}

test('each document page renders its Markdown source with the site shell', () => {
  for (const { destination, label, page } of SHELL_PAGES) {
    assert.match(page, /^<!doctype html>\n<html lang="en">/, destination);
    assert.equal((page.match(/<h1\b/g) ?? []).length, 1, `${destination} has one heading level 1`);
    assert.match(page, /<a class="skip-link" href="#main">Skip to main content<\/a>/, destination);
    assert.equal((page.match(/<main id="main">/g) ?? []).length, 1, destination);
    assert.equal((page.match(/<header class="masthead">/g) ?? []).length, 1, destination);
    assert.equal((page.match(/<footer class="footer">/g) ?? []).length, 1, destination);
    assert.match(page, /<nav class="section-nav" aria-label="Site">/, destination);
    assert.deepEqual(
      [...page.matchAll(/aria-current="page"/g)].length,
      1,
      `${destination} marks exactly one current page`,
    );
    assert.match(page, new RegExp(`<a href="\\./${destination.replace('.', '\\.')}" aria-current="page">${label}</a>`));
    assert.match(page, /<link rel="stylesheet" href="\.\/site\.css" \/>/);
    assert.ok(page.includes(`<link rel="icon" href="${SITE_ICON}" />`), `${destination} icon`);
    assert.doesNotMatch(page, /<script\b|<form\b|<iframe\b|\btarget=|\son[a-z]+=/i, destination);
    assert.ok(page.includes(renderFooter()), `${destination} footer matches the shared footer`);
  }
  assert.ok(html.includes(`href="${SITE_ICON}"`), 'project home icon matches');
  assert.ok(html.replace(/\r\n/g, '\n').includes(renderFooter()), 'project home footer matches the shared footer');
});

test('document page main text says exactly what the Markdown says', () => {
  for (const { destination, markdown, page } of DOCUMENT_PAGES) {
    const article = page.slice(page.indexOf('<article class="document">'), page.indexOf('</article>'));
    const rendered = words(decode(article
      .replace(/<\/?(?:a|strong|code)\b[^>]*>/g, '')
      .replace(/<[^>]+>/g, ' ')));
    const source = words(markdown
      .replace(/^#{1,2} /gm, '')
      .replace(/^- /gm, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1'));
    assert.equal(rendered, source, `${destination} text drifted from its source`);
  }
});

test('published headings keep the anchors the repository files gave them', () => {
  const expected = {
    'privacy.html': [
      'recap-page-privacy-policy',
      'what-stays-on-your-device',
      'optional-onedrive-backup',
      'optional-icloud-backup',
      'requests-the-app-makes-to-other-services',
      'deleting-your-data',
      'the-windows-package',
      'contact',
    ],
    'support.html': [
      'support',
      'start-with-the-troubleshooting-section',
      'asking-a-question-or-reporting-a-problem',
      'reporting-a-reading-list-correction',
      'asking-a-public-project-question',
      'a-suspected-security-problem-never-goes-in-an-issue',
      'things-that-are-somebody-elses-to-fix',
      'asking-for-a-change',
      'which-version-you-have',
    ],
    'data-sources.html': [
      'data-sources-and-credits',
      'comic-details',
      'covers',
      'reading-lists',
      'the-optional-marvel-fandom-lookup',
      'what-the-project-license-covers',
    ],
    'being-built.html': ['whats-being-built', 'cloud-backup'],
  };
  for (const { destination, markdown, page } of DOCUMENT_PAGES) {
    const headings = [...markdown.matchAll(/^#{1,2} (.+)$/gm)].length;
    const anchors = [...page.matchAll(/<h[12] id="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(anchors.length, headings, `${destination} heading count`);
    assert.deepEqual(anchors, expected[destination], `${destination} heading anchors`);
  }
});

test('duplicate heading anchors avoid collisions with earlier suffixed headings', () => {
  const markdown = '# A\n\n## A-1\n\n## A\n\n## A';
  const { html: rendered } = renderMarkdown(markdown, 'headings.md');
  const ids = [...rendered.matchAll(/<h[12] id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ['a', 'a-1', 'a-2', 'a-3']);
});

test('linked headings are refused instead of publishing an incorrect anchor', () => {
  const markdown = '# Privacy\n\n## [Delete data](https://example.com)';
  assert.throws(
    () => renderMarkdown(markdown, 'headings.md'),
    /Links in headings are not supported/,
  );
});

test('headings without a usable anchor are refused', () => {
  assert.throws(
    () => renderMarkdown('# Privacy\n\n## !!!', 'headings.md'),
    /Heading has no usable anchor/,
  );
});

test('every link on the published pages resolves', () => {
  for (const [name, page] of pageByDestination) {
    for (const [, raw] of page.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)) {
      const href = decode(raw);
      if (href.startsWith('#')) {
        assert.ok(idsOf(page).has(href.slice(1)), `${name} links to missing ${href}`);
      } else if (href.startsWith('./')) {
        const [path, fragment] = href.slice(2).split('#');
        assert.ok(PAGE_OUTPUTS.includes(path), `${name} links to unpublished ${href}`);
        if (fragment !== undefined) {
          assert.ok(idsOf(pageByDestination.get(path)).has(fragment), `${name} links to missing ${href}`);
        }
      } else if (href.startsWith(`${REPOSITORY}/blob/main/`)) {
        const path = href.slice(`${REPOSITORY}/blob/main/`.length).split('#')[0];
        assert.ok(existsSync(join(ROOT, ...path.split('/'))), `${name} links to missing file ${path}`);
        assert.ok(
          !PAGE_DOCUMENTS.some(({ source }) => source === path),
          `${name} links to the repository view of ${path} instead of its published page`,
        );
      } else {
        assert.match(href, /^(?:https:\/\/|http:\/\/127\.0\.0\.1:8787\/$)/, `${name} has unexpected ${href}`);
      }
    }
  }
});

test('links between the documents land on their published pages and sections', () => {
  const support = pageByDestination.get('support.html');
  const privacy = pageByDestination.get('privacy.html');
  assert.ok(support.includes('href="./privacy.html#requests-the-app-makes-to-other-services"'), 'support links privacy section');
  assert.ok(privacy.includes('href="./support.html"'), 'privacy links support');

  const cases = [
    ['PRIVACY.md#deleting-your-data', 'SUPPORT.md', './privacy.html#deleting-your-data'],
    ['../PRIVACY.md#deleting-your-data', 'pages/data-sources.md', './privacy.html#deleting-your-data'],
    ['../SUPPORT.md', 'pages/data-sources.md', './support.html'],
    ['pages/data-sources.md', 'PRIVACY.md', './data-sources.html'],
    ['docs/DATA_PROVENANCE.md', 'PRIVACY.md', './data-sources.html'],
    ['../docs/DATA_PROVENANCE.md', 'pages/data-sources.md', `${REPOSITORY}/blob/main/docs/DATA_PROVENANCE.md`],
    ['docs/DATA_PROVENANCE.md#licensing', 'PRIVACY.md', `${REPOSITORY}/blob/main/docs/DATA_PROVENANCE.md#licensing`],
    ['SECURITY.md', 'PRIVACY.md', `${REPOSITORY}/blob/main/SECURITY.md`],
    ['#deleting-your-data', 'PRIVACY.md', '#deleting-your-data'],
    ['https://raymond-nassar.github.io/recap-page/', 'SUPPORT.md', './index.html'],
    ['https://raymond-nassar.github.io/recap-page/#feedback', 'pages/being-built.md', './index.html#feedback'],
  ];
  for (const [target, source, expected] of cases) {
    assert.equal(resolveDocumentLink(target, source), expected, `${target} from ${source}`);
  }
  assert.throws(() => resolveDocumentLink('../../outside.md', 'pages/data-sources.md'));
});

test('the converter refuses Markdown it cannot render faithfully', () => {
  const refusals = [
    '# A\n\n### Deeper',
    '# A\n\n# B',
    'Intro\n\n# A',
    '# A\n\n## ',
    '# ',
    '# A\n\n### ',
    '# A\n\n##',
    '# A\n\n#\tB',
    '# A\n\n##\tB',
    '# A\n\n## B ##',
    '# A\n\n## B #',
    '# A\n\n<div>raw</div>',
    '# A\n\nText with <b>tags</b>.',
    '# A\n\n![cover](cover.png)',
    '# A\n\n- one\n  - nested',
    '# A\n\n- one\n  + nested',
    '# A\n\n- one\n  * nested',
    '# A\n\n- one\n  1) nested',
    '# A\n\n- one\n  1. nested',
    '# A\n\n- one\n  > quoted',
    '# A\n\n- one\nlazy continuation',
    '# A\n\n- one\n- two\nlazy continuation',
    '# A\n\n- * starred',
    '# A\n\n1. ordered',
    '# A\n\n1) ordered',
    '# A\n\n> quoted',
    '# A\n\n| table |',
    '# T\n\nService | What it receives\n--- | ---\nMetadata API | Search text',
    '# T\n\nService | What it receives\n---|---\nMetadata API | Search text',
    '# T\n\nService | What it receives\n---: | :---\nMetadata API | Search text',
    '# T\n\nService | What it receives\n----|----\nMetadata API | Search text',
    '# T\n\n-\tFirst point',
    '# A\n\n```\ncode\n```',
    '# A\n\nText\n---',
    '# A\n\nText\n--',
    '# A\n\nText\n-',
    '# A\n\nText\n===',
    '# A\n\nText\n==',
    '# A\n\n---',
    '# A\n\n-',
    '# A\n\nSome _emphasis_ here.',
    '# A\n\nSome ~~struck~~ text.',
    '# A\n\nA tilde ~ here.',
    '# A\n\nA back\\slash here.',
    '# A\n\nAn entity &amp; here.',
    '# A\n\nAn entity &#169; here.',
    '# A\n\nAn entity &#x27; here.',
    '# A\n\nA bare https://example.com/ address.',
    '# A\n\nA bare www.example.com address.',
    '# A\n\nA [link](mailto:someone)',
    '# A\n\nA [link](/rooted)',
    '# A\n\nA stray * star.',
    '# A\n\nA [link] without a target.',
  ];
  for (const markdown of refusals) {
    assert.throws(() => renderMarkdown(markdown, 'test.md'), undefined, JSON.stringify(markdown));
  }
  assert.deepEqual(renderMarkdown('# Title\n\nSome `snake_case` **bold** [x](https://example.com/) & more.', 'x.md'), {
    title: 'Title',
    html: '<h1 id="title">Title</h1>\n<p>Some <code>snake_case</code> <strong>bold</strong> <a href="https://example.com/">x</a> &amp; more.</p>',
  });
});

test('document pages carry no dashes the house style forbids and no contact details', () => {
  for (const { destination, page } of SHELL_PAGES) {
    assert.doesNotMatch(page, /[\u2013\u2014]/, `${destination} contains an en or em dash`);
    assert.doesNotMatch(page, /mailto:|tel:|@[a-z0-9-]+\.[a-z]{2,}/i, `${destination} carries an address`);
    assert.doesNotMatch(page, /\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/, `${destination} carries a phone number`);
  }
});

test('the data sources page credits every source and links the full record', () => {
  const { page } = DOCUMENT_PAGES.find(({ destination }) => destination === 'data-sources.html');
  for (const phrase of [
    'Comic Book Herald',
    'Comic Book Reading Orders',
    'Master Reading Order',
    'Patreon',
    'Marvel Fandom',
    'cover',
  ]) {
    assert.ok(page.includes(phrase), `data-sources.html names ${phrase}`);
  }
  assert.ok(page.includes(`href="${REPOSITORY}/blob/main/docs/DATA_PROVENANCE.md"`), 'links the full record');
});

const unsafeLinkDestinations = [
  ['parentheses', 'https://example.com/News_(2026)'],
  ['named entities', 'https://example.com/?a=1&amp;b=2'],
  ['decimal entities', 'https://example.com/?value=&#169;'],
  ['hexadecimal entities', 'https://example.com/?value=&#x27;'],
  ['backslash escapes', String.raw`https://example.com/a\_b`],
];

for (const [kind, target] of unsafeLinkDestinations) {
  test(`the converter refuses link destinations with ${kind}`, () => {
    assert.throws(
      () => renderMarkdown(`# Title\n\n[Details](${target})`, 'test.md'),
      /Unsupported link destination/,
    );
  });
}

test('the converter preserves percent-encoded URLs and ordinary query ampersands', () => {
  const { html: rendered } = renderMarkdown(
    '# Title\n\n[Details](https://example.com/%28news%29?a=1&b=2)',
    'test.md',
  );
  assert.ok(rendered.includes('href="https://example.com/%28news%29?a=1&amp;b=2"'));
});

const releaseItems = (version, page = releaseContent.html) => {
  const section = page.split(/<h2 /).find((part) => part.includes(`>Version ${version}</h2>`));
  assert.ok(section, `Version ${version} is published`);
  return [...section.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, item]) => item);
};
const expectedReleaseItem = (feature) => {
  const label = PLATFORM_LABELS.get(feature);
  return label
    ? `<strong>${escapeHtml(label)}</strong> ${escapeHtml(feature)}`
    : escapeHtml(feature);
};
const syntheticChangelog = (releases) => releases
  .map(([version, features]) => `## ${version}\n\n### What changed\n\n${features.map((line) => `- ${line}`).join('\n')}\n`)
  .join('\n');
// Undated, so never published, but present so the stale-label check passes.
const labelledReleases = [...PLATFORM_LABELS.keys()].map((feature, index) => [`1.0.${index}`, [feature]]);

const assertCurrentReleaseMatchesApp = (changelogText, dates, app, page) => {
  const records = releaseRecords(changelogText).filter(({ version }) => version === app.version);
  assert.equal(records.length, 1, 'the current release has exactly one changelog record');
  assert.deepEqual(readerFeatures(records[0].body), app.batch.features);
  if (selectRecentReleases(changelogText, dates).some(({ version }) => version === app.version)) {
    assert.deepEqual(releaseItems(app.version, page), app.batch.features.map(expectedReleaseItem));
  } else {
    assert.ok(!page.includes(`>Version ${app.version}</h2>`), 'an unpublished release is not displayed');
  }
};

test('the What\'s new page lists the five latest finalized releases, newest first, with their dates', () => {
  const records = Array.from({ length: 6 }, (_, index) => [`9.0.${6 - index}`, ['Read faster.']]);
  const dates = new Map(records.map(([version], index) => [version, `2030-01-0${6 - index}`]));
  const page = releasesPage(syntheticChangelog([...records, ...labelledReleases]), dates).html;
  const headings = [...page.matchAll(/<h2 id="([^"]+)">Version ([^<]+)<\/h2>\n<p>Finalized ([^<]+)\.<\/p>/g)]
    .map(([, id, version, date]) => [id, version, date]);
  assert.deepEqual(headings, [
    ['version-906', '9.0.6', 'January 6, 2030'],
    ['version-905', '9.0.5', 'January 5, 2030'],
    ['version-904', '9.0.4', 'January 4, 2030'],
    ['version-903', '9.0.3', 'January 3, 2030'],
    ['version-902', '9.0.2', 'January 2, 2030'],
  ]);
  assert.ok(!page.includes('>Version 9.0.1</h2>'));
  assert.match(page, /href="https:\/\/github\.com\/raymond-nassar\/recap-page\/blob\/main\/CHANGELOG\.md">the full changelog<\/a>/);
});

test('the current release uses the in-app What\'s new content when published', () => {
  assertCurrentReleaseMatchesApp(changelog, releaseDates, homeUpdatesContent, releaseContent.html);
});

test('platform-bound release notes name their platforms and nothing claims iPhone or iPad backup', () => {
  const historical = releasesPage(changelog, new Map([
    ['4.3.0', releaseDates.get('4.3.0')],
    ['4.0.1', releaseDates.get('4.0.1')],
  ])).html;
  const backup = releaseItems('4.3.0', historical).find((item) => item.includes('OneDrive'));
  assert.match(backup, /^<strong>OneDrive backup: Windows and Android only\.<\/strong> /);
  assert.match(releaseItems('4.0.1', historical)[0], /^<strong>Android only\.<\/strong> /);
  assert.match(historical, /Version 4\.3\.0<\/h2>\n<p>Finalized October 30, 2026\.<\/p>/);
  assert.match(historical, /Version 4\.0\.1<\/h2>\n<p>Finalized October 8, 2026\.<\/p>/,
    'an untagged Android patch is dated from its recorded bundle revision');
  for (const { version, features } of selectRecentReleases(changelog, releaseDates)) {
    assert.deepEqual(releaseItems(version), features.map(expectedReleaseItem));
    for (const feature of features) {
      if (/\b(?:Windows|Android|OneDrive|Edge|offline|install\w*)\b/i.test(feature)) {
        assert.ok(PLATFORM_LABELS.has(feature), `${version} names a platform without a label: ${feature}`);
      }
    }
  }
  assert.doesNotMatch(historical, /\b(?:iPhone|iPad|iOS|iCloud)\b/, 'these releases do not place a backup feature on Apple devices');
});

test('a reviewed release stays unpublished until dated, then matches the in-app content', () => {
  const features = [[...PLATFORM_LABELS.keys()][0]];
  const app = { version: '9.0.0', batch: { features } };
  const input = syntheticChangelog([
    [app.version, features],
    ['8.0.0', ['Read faster.']],
    ...labelledReleases,
  ]);
  const dates = new Map([['8.0.0', '2030-01-02']]);
  const before = releasesPage(input, dates).html;
  assertCurrentReleaseMatchesApp(input, dates, app, before);
  assert.ok(!before.includes('>Version 9.0.0</h2>'));
  dates.set(app.version, '2030-01-03');
  const after = releasesPage(input, dates).html;
  assertCurrentReleaseMatchesApp(input, dates, app, after);
  assert.deepEqual(releaseItems(app.version, after), features.map(expectedReleaseItem));
});

test('release notes are published as escaped text, never as markup', () => {
  const page = releasesPage(syntheticChangelog([
    ['9.0.0', ['Read Thunderbolts* & <Avengers> "first".']],
    ...labelledReleases,
  ]), new Map([['9.0.0', '2030-01-02']]));
  assert.match(page.html, /<li>Read Thunderbolts\* &amp; &lt;Avengers&gt; &quot;first&quot;\.<\/li>/);
  assert.match(page.html, /Finalized January 2, 2030\./);
  assert.match(page.html, /The latest release of Recap Page/);
});

test('the What\'s new build refuses an unlabelled platform note and a stale label', () => {
  assert.throws(
    () => releasesPage(syntheticChangelog([['9.0.0', ['Sync to iCloud on iPad.']], ...labelledReleases]), new Map([['9.0.0', '2030-01-02']])),
    /Release note needs a reviewed platform label .*Sync to iCloud on iPad\./,
  );
  assert.throws(
    () => releasesPage(syntheticChangelog([['9.0.0', ['Read faster.']]]), new Map([['9.0.0', '2030-01-02']])),
    /Platform label names a release note the changelog no longer has/,
  );
  assert.throws(() => releasesPage(syntheticChangelog([['9.0.0', ['Read faster.']]]), new Map()), /No tagged release/);
});

test('an untagged newest release must have reviewed platform labels before publication', () => {
  assert.throws(
    () => releasesPage(syntheticChangelog([
      ['9.0.0', ['Sync to iCloud on iPad.']],
      ['8.0.0', ['Read faster.']],
      ...labelledReleases,
    ]), new Map([['8.0.0', '2030-01-02']])),
    /Release note needs a reviewed platform label .*Sync to iCloud on iPad\./,
  );
});

test('release dates come from the local clone and a clone without tags is refused', async () => {
  assert.equal(releaseDates.get('4.3.0'), '2026-10-30');
  assert.equal(releaseDates.get('4.0.1'), '2026-10-08');
  const root = await mkdtemp(join(tmpdir(), 'pages-releases-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    assert.throws(() => readReleaseDates(root), /No release tags found/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  assert.throws(() => formatReleaseDate('2026-13-01'), /Unreadable release date/);
  assert.throws(() => formatReleaseDate('Oct 30'), /Unreadable release date/);
  assert.equal(formatReleaseDate('2026-10-30'), 'October 30, 2026');
});

test('the 4.5.0 progress offer does not advertise Google Drive backup', () => {
  const feature = 'When OneDrive backup is on, Recap Page can offer progress from another device when your reading progress differs: comics marked read, your lists, ratings and finished lists. Choose which progress to use, or dismiss the notice to keep yours; the app never merges backups.';
  const label = 'OneDrive progress offer: Windows, Android, iPhone and iPad. iCloud keeps its existing backup and manual restore.';
  const page = releasesPage(changelog, new Map([['4.5.0', '2030-01-02']])).html;
  const item = releaseItems('4.5.0', page).find((entry) => entry.includes(escapeHtml(feature)));
  assert.equal(item, `<strong>${escapeHtml(label)}</strong> ${escapeHtml(feature)}`);
});

test('the 4.5.0 navigation and layout summary identifies its phone-width scope', () => {
  const feature = 'Back now sits at the top left on secondary screens. On phones held upright, Continue reading centers the comic above Read and Done. Notices, Search and large-text dialogs stay readable and reachable without widening the page.';
  const label = 'Every platform. Continue reading layout: phone-width screens.';
  const page = releasesPage(changelog, new Map([['4.5.0', '2030-01-02']])).html;
  const item = releaseItems('4.5.0', page).find((entry) => entry.includes(escapeHtml(feature)));
  assert.equal(item, `<strong>${escapeHtml(label)}</strong> ${escapeHtml(feature)}`);
});
