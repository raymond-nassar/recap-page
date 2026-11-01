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
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  PAGE_DOCUMENTS,
  PAGE_OUTPUTS,
  PAGE_SOURCES,
  RELEASE_PAGE,
  artifactInventory,
  buildPages,
  installArtifact,
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
const EXPECTED_HREFS = [
  '#main',
  '#android',
  '#features',
  '#getting-started',
  '#documentation',
  '#feedback',
  './support.html',
  './privacy.html',
  './data-sources.html',
  '#getting-started',
  '#android',
  PLAY_LISTING,
  `${REPOSITORY}/blob/main/docs/ANDROID.md`,
  './assets/android-library-preview.png',
  './assets/android-reading-preview.png',
  '#demo',
  './whats-new.html',
  './being-built.html',
  `${REPOSITORY}/issues/new?template=feature.yml`,
  `${REPOSITORY}/issues/new?template=reading-list.yml`,
  `${REPOSITORY}/issues/new?template=data-order.yml`,
  `${REPOSITORY}/issues/new?template=bug.yml`,
  'https://www.comicbookherald.com/where-do-i-start-with-avengers-trade-collections/',
  './assets/home-960.png',
  './assets/avengers-disassembled-reading-960.png',
  'https://apps.microsoft.com/detail/9PDJ7XR9Q40Q',
  PLAY_LISTING,
  `${REPOSITORY}/releases/latest/download/marvel-reading-tracker-windows.zip`,
  `${REPOSITORY}/blob/main/docs/RUNNING.md`,
  APP_ORIGIN,
  `${REPOSITORY}/blob/main/docs/RUNNING.md#troubleshooting`,
  './support.html',
  '#project-questions',
  `${REPOSITORY}/blob/main/docs/ANDROID.md`,
  `${REPOSITORY}#readme`,
  `${REPOSITORY}/blob/main/docs/RUNNING.md`,
  `${REPOSITORY}/blob/main/docs/ARCHITECTURE.md`,
  './data-sources.html',
  './privacy.html',
  './support.html',
  `${REPOSITORY}/blob/main/SECURITY.md`,
  `${REPOSITORY}/blob/main/docs/MAINTAINING.md`,
  `${REPOSITORY}/blob/main/CONTRIBUTING.md`,
  `${REPOSITORY}/blob/main/GOVERNANCE.md`,
  './whats-new.html',
  `${REPOSITORY}/blob/main/docs/WHY_A_BROWSER_APP.md`,
  QUESTION_FORM_URL,
  `${REPOSITORY}/blob/main/SECURITY.md`,
  REPOSITORY,
  `${REPOSITORY}/issues`,
  `${REPOSITORY}/commits/main`,
  `${REPOSITORY}/releases`,
  './privacy.html',
  './support.html',
  './data-sources.html',
  `${REPOSITORY}/blob/main/SECURITY.md`,
  `${REPOSITORY}/blob/main/LICENSE`,
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
  for (const { source } of [...PAGE_SOURCES, ...PAGE_DOCUMENTS]) {
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

test('the project home sends Android readers to Google Play and keeps the preview caveats', () => {
  const gradle = readFileSync(join(ROOT, 'packaging', 'android', 'app', 'build.gradle'), 'utf8');
  const applicationId = /^\s*applicationId '([\w.]+)'$/m.exec(gradle)?.[1];
  assert.equal(PLAY_LISTING, `https://play.google.com/store/apps/details?id=${applicationId}`);

  const navigation = html.match(/<nav class="section-nav"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.deepEqual(links(navigation)[0], { href: '#android', button: false, name: 'Android' });

  const overview = section('overview');
  assert.match(
    overview,
    /<p class="lede">\s*Find Marvel reading lists and keep track of what you've read\.\s*<\/p>\s*<p class="platform-status">Available for Windows and Android\. In App Store review for iPhone and iPad\.<\/p>\s*<p class="action-row">/,
  );
  assert.deepEqual(links(overview), [
    { href: '#getting-started', button: true, name: 'Get started' },
    { href: '#android', button: false, name: 'See the Android app' },
  ]);

  const android = section('android');
  const copy = plain(android);
  assert.deepEqual(links(android).slice(0, 2), [
    { href: PLAY_LISTING, button: true, name: 'Open Google Play' },
    { href: `${REPOSITORY}/blob/main/docs/ANDROID.md`, button: false, name: 'About the Android app' },
  ]);
  assert.doesNotMatch(copy, /The released app is available on Google Play|Android in development|Not available on Google Play/);
  assert.match(copy, /Android's Read uses an installed browser, not the Marvel Unlimited app/);
  assert.match(copy, /No computer needed/);
  assert.match(
    copy,
    /Android previews made in a desktop browser, not on a phone\. Lists and progress are made up; cover art is off\./,
  );
  assert.match(copy, /Desktop and Android save separately/);
  assert.match(copy, /Restoring replaces the app's saved data/);

  assert.doesNotMatch(html, /releases\/tag\/android-|ANDROID_BETA\.md/);
  assert.doesNotMatch(
    plain(html),
    /Try the beta|Android beta|Android preview\b|What we're building|not a native phone app|Get it on Google Play/,
  );

  const features = section('features');
  assert.match(features, /<p>On desktop and Android\.<\/p>/);
  for (const feature of [
    'Reading Paths', 'Modern Timeline', 'Character spotlights', 'MCU Prep',
    'Defer for later', 'notes', 'descriptions', 'Marvel Unlimited record',
    'historical record, not availability in Marvel Comics', 'JSON backups', 'Markdown checklists', 'Share an order',
  ]) assert.ok(features.includes(feature), `missing feature explanation: ${feature}`);
});

test('Get started offers both app stores and says iPhone and iPad is in App Store review', () => {
  const start = section('getting-started');
  const cards = [...start.matchAll(/<article class="card route-card">([\s\S]*?)<\/article>/g)]
    .map((match) => ({
      name: plain(match[1].match(/<h3>([\s\S]*?)<\/h3>/)?.[1] ?? ''),
      copy: plain(match[1].match(/<p>([\s\S]*?)<\/p>/)?.[1] ?? ''),
      links: links(match[1]),
    }));
  assert.deepEqual(cards, [
    {
      name: 'Windows',
      copy: 'Install and update through Microsoft Store.',
      links: [{ href: 'https://apps.microsoft.com/detail/9PDJ7XR9Q40Q', button: true, name: 'Open Microsoft Store' }],
    },
    {
      name: 'Android',
      copy: 'Android 8 or later, with an up-to-date Android System WebView.',
      links: [{ href: PLAY_LISTING, button: true, name: 'Open Google Play' }],
    },
    {
      name: 'Windows download',
      copy: 'Unzip, then run Start on Windows.cmd.',
      links: [{
        href: `${REPOSITORY}/releases/latest/download/marvel-reading-tracker-windows.zip`,
        button: false,
        name: 'Download for Windows',
      }],
    },
    {
      name: 'Run from source',
      copy: 'Requires Node.js 20 or newer.',
      links: [{ href: `${REPOSITORY}/blob/main/docs/RUNNING.md`, button: false, name: 'Source setup guide' }],
    },
    { name: 'iPhone and iPad', copy: 'In App Store review. Not available yet.', links: [] },
  ]);
  assert.match(
    plain(start.slice(start.indexOf('<p class="platform-note">'))),
    /^Uninstalling the Android app deletes its saved data\. Save and check a backup first\./,
  );

  assert.deepEqual(links(section('troubleshooting')).map(({ href, name }) => [href, name]), [
    [`${REPOSITORY}/blob/main/docs/RUNNING.md#troubleshooting`, 'Fix a problem Startup, reader links, or missing progress.'],
    ['./support.html', 'Get support Where to ask for help.'],
    ['#project-questions', 'Ask a question About Recap Page and how it works.'],
  ]);
  assert.deepEqual(links(section('documentation'))[0], {
    href: `${REPOSITORY}/blob/main/docs/ANDROID.md`,
    button: false,
    name: 'Android app Setup and features.',
  });
});

test('the showcase includes the supplied artwork and current phone previews', () => {
  const images = [...html.matchAll(/<img\b[\s\S]*?\/>/g)].map((tag) => attributes(tag[0]));
  assert.deepEqual(images.slice(0, 3).map(({ src, width, height }) => ({ src, width, height })), [
    { src: './assets/android-feature-graphic.png', width: '1024', height: '500' },
    { src: './assets/android-library-preview.png', width: '1080', height: '1920' },
    { src: './assets/android-reading-preview.png', width: '1080', height: '1920' },
  ]);
  assert.equal(images[0].fetchpriority, 'high');
  assert.equal(images[0].loading, 'eager');
  assert.ok(images.slice(1).every((image) => image.loading === 'lazy'));

  const provenance = JSON.parse(readFileSync(join(ROOT, 'docs', 'project-home-assets.json'), 'utf8'));
  assert.equal(provenance.androidPreviews.renderer.nativeDevice, null);
  assert.equal(provenance.androidPreviews.renderer.nativeBridge, false);
  assert.equal(provenance.androidPreviews.releaseAcceptance, false);
  assert.equal(provenance.androidPreviews.playListingApproval, false);
  assert.match(provenance.androidPreviews.sourceRevision, /^[0-9a-f]{40}$/);
  const records = [provenance.featureArtwork, ...provenance.androidPreviews.files];
  assert.deepEqual(records.map(({ file }) => file), [
    'pages/assets/android-feature-graphic.png',
    'pages/assets/android-library-preview.png',
    'pages/assets/android-reading-preview.png',
  ]);
  for (const record of records) {
    const bytes = readFileSync(join(ROOT, ...record.file.split('/')));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, record.file);
    assert.equal(bytes.readUInt32BE(16), record.width, record.file);
    assert.equal(bytes.readUInt32BE(20), record.height, record.file);
    if (record.bytes !== undefined) assert.equal(bytes.length, record.bytes, record.file);
  }
});

test('the source inventory and generated contract stay exact', async () => {
  assert.deepEqual((await readdir(join(ROOT, 'pages'))).sort(), ['assets', 'being-built.md', 'data-sources.md', 'index.html', 'site.css']);
  assert.deepEqual((await readdir(join(ROOT, 'pages', 'assets'))).sort(), [
    'android-feature-graphic.png',
    'android-library-preview.png',
    'android-reading-preview.png',
  ]);
  assert.deepEqual(PAGE_OUTPUTS, [
    'assets/android-feature-graphic.png',
    'assets/android-library-preview.png',
    'assets/android-reading-preview.png',
    'assets/avengers-disassembled-reading-960.png',
    'assets/home-960.png',
    'being-built.html',
    'data-sources.html',
    'index.html',
    'privacy.html',
    'site.css',
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
      'docs/screenshots/home-960.png',
      'docs/screenshots/avengers-disassembled-reading-960.png',
      'pages/assets/android-feature-graphic.png',
      'pages/assets/android-library-preview.png',
      'pages/assets/android-reading-preview.png',
    ],
  );
});

test('the page exposes every task through semantic no-script structure', () => {
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
    'android',
    'features',
    'demo',
    'getting-started',
    'troubleshooting',
    'documentation',
    'project-questions',
    'feedback',
    'security-report',
    'source-history',
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

  assert.doesNotMatch(html, /<(?:script|form|iframe)\b/i);
  assert.doesNotMatch(html, /\b(?:localStorage|serviceWorker|manifest\.webmanifest|localhost)\b/i);
  assert.doesNotMatch(html, /\btarget="/i);
  assert.match(html, /GitHub hosts this site and receives request details, including your IP address/);
  assert.match(html, /This site can't access your saved reading data/);
});

test('the project home keeps its copy concise and its navigation focused', () => {
  const visibleCopy = html.slice(html.indexOf('<body>')).replace(/<[^>]+>/g, ' ');
  const words = visibleCopy.match(/\S+/g) ?? [];
  assert.ok(words.length <= 810, `${words.length} words exceed the 810-word feature-tour budget`);
  const navigation = html.match(/<nav class="section-nav"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.deepEqual(links(navigation).map(({ href }) => href), [
    '#android', '#features', '#getting-started', '#documentation', '#feedback',
    './support.html', './privacy.html', './data-sources.html',
  ]);
  assert.doesNotMatch(html, /class="eyebrow"/);
});

test('the curated feature link and four suggestion routes precede the demo while security stays private', () => {
  assert.match(section('features'), /<h3>What's being built<\/h3>/);
  assert.deepEqual(links(section('features')).at(-1), {
    href: './being-built.html', button: false, name: 'see provider progress',
  });
  assert.match(html, /<\/section>\s*<section id="feedback"[\s\S]*?<\/section>\s*<section id="demo"/);
  assert.match(section('feedback'), /<h2 id="feedback-title">Help shape Recap Page<\/h2>/);
  assert.match(plain(section('feedback')), /Requests are reviewed; replies can take time or may be declined\./);
  assert.deepEqual(links(section('feedback')), [
    { href: `${REPOSITORY}/issues/new?template=feature.yml`, button: false, name: 'Suggest an improvement' },
    { href: `${REPOSITORY}/issues/new?template=reading-list.yml`, button: false, name: 'Request a reading list' },
    { href: `${REPOSITORY}/issues/new?template=data-order.yml`, button: false, name: 'Correct a reading list' },
    { href: `${REPOSITORY}/issues/new?template=bug.yml`, button: false, name: 'Report a bug' },
  ]);
  assert.deepEqual(links(section('security-report')), [{
    href: `${REPOSITORY}/blob/main/SECURITY.md`,
    button: false,
    name: 'Report a security problem Report privately, not in a public post.',
  }]);
  assert.ok(html.indexOf('<section id="security-report"') > html.indexOf('<section id="project-questions"'));
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
  assert.deepEqual(hrefs, EXPECTED_HREFS);

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
  assert.deepEqual(cleartext, [APP_ORIGIN, APP_ORIGIN]);
  assert.ok(hrefs.every((href) => href.startsWith('#') || href.startsWith('https://')
    || href === APP_ORIGIN || (href.startsWith('./') && PAGE_OUTPUTS.includes(href.slice(2)))));
});

test('the exact-origin warning appears before the only local-app link', () => {
  const warning = html.indexOf('<aside class="origin-warning"');
  const address = html.indexOf(`<code>${APP_ORIGIN}</code>`);
  const appLink = html.indexOf(`<a class="button" href="${APP_ORIGIN}">`);
  assert.ok(warning >= 0 && address > warning && appLink > address);
  assert.match(
    html.slice(warning, appLink),
    /different address, port, or profile won't show your saved progress/,
  );
});

test('all five showcase images have accurate dimensions and useful alternatives', () => {
  const images = [...html.matchAll(/<img\b[\s\S]*?\/>/g)].map((tag) => attributes(tag[0]));
  assert.deepEqual(
    images.map(({ src }) => src),
    [
      './assets/android-feature-graphic.png',
      './assets/android-library-preview.png',
      './assets/android-reading-preview.png',
      './assets/home-960.png',
      './assets/avengers-disassembled-reading-960.png',
    ],
  );
  let totalBytes = 0;
  for (const image of images) {
    assert.ok(image.alt?.length > 20, `${image.src} has no useful text alternative`);
    const entry = PAGE_SOURCES.find(({ destination }) => destination === image.src.slice(2));
    assert.ok(entry, `${image.src} is not included in the built page`);
    const bytes = readFileSync(join(ROOT, ...entry.source.split('/')));
    assert.equal(bytes.readUInt32BE(16), Number(image.width));
    assert.equal(bytes.readUInt32BE(20), Number(image.height));
    totalBytes += bytes.length;
  }
  assert.ok(totalBytes <= 2 * 1024 * 1024, `${totalBytes} image bytes exceed the 2 MiB showcase budget`);
});

test('the public question disclosure is complete before the form link', () => {
  const questionSection = section('project-questions');
  const disclosure = questionSection.slice(0, questionSection.indexOf(QUESTION_FORM_URL)).replace(/\s+/g, ' ');
  assert.match(disclosure, /Sign in to GitHub to post/);
  assert.match(disclosure, /username, question, and replies are public/);
  assert.match(disclosure, /GitHub hosts and processes posts/);
  assert.match(disclosure, /Recap Page sends nothing automatically/);
  assert.match(disclosure, /Questions about Recap Page\?/);
  assert.doesNotMatch(disclosure, /Get a human answer|Name the documentation you checked/);
  assert.match(disclosure, /Don't post reading progress, lists, notes, backups, personal information, attachments, or vulnerability details/);
  assert.match(disclosure, /Before you post/);
  assert.equal([...questionSection.matchAll(new RegExp(QUESTION_FORM_URL.replace('?', '\\?'), 'g'))].length, 1);

  const currentSources = [
    ['pages/index.html', html],
    ['SUPPORT.md', readFileSync(join(ROOT, 'SUPPORT.md'), 'utf8')],
    ['PRIVACY.md', readFileSync(join(ROOT, 'PRIVACY.md'), 'utf8')],
    ['SECURITY.md', readFileSync(join(ROOT, 'SECURITY.md'), 'utf8')],
    ['docs/ARCHITECTURE.md', readFileSync(join(ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8')],
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
  assert.doesNotMatch(html, /github\.com\/users\/raymond-nassar\/projects\/1/);
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
    const value = declaration[2].trim();
    assert.match(
      value,
      /^(?:0|auto|var\(--space-[1-7]\)|var\(--space-[1-7]\) var\(--space-[1-7]\))$/,
      `${declaration[1]} uses off-ladder spacing ${value}`,
    );
  }
});

test('Page colour pairs clear their text and boundary floors', () => {
  const dark = tokensFrom(blockFrom(css, css.indexOf(':root {')));
  const lightMedia = css.indexOf('@media (prefers-color-scheme: light)');
  const light = tokensFrom(blockFrom(css, css.indexOf(':root {', lightMedia)));
  const pairs = [
    ['--text', '--page', BODY],
    ['--muted', '--page', BODY],
    ['--accent', '--page', BODY],
    ['--text', '--surface', BODY],
    ['--muted', '--surface', BODY],
    ['--accent', '--surface', BODY],
    ['--accent-ink', '--accent-fill', BODY],
    ['--line', '--page', LARGE],
    ['--line', '--surface', LARGE],
    ['--focus', '--page', LARGE],
    ['--danger', '--surface', BODY],
  ];

  for (const [themeName, tokens] of [['dark', dark], ['light', light]]) {
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
  assert.doesNotMatch(css, /\b(?:animation|transition)(?:-[\w-]+)?\s*:/);
  assert.match(css, /a:focus-visible\s*\{[\s\S]*outline:/);
  assert.match(css, /@media \(max-width: 42rem\)\s*\{[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*scroll-behavior: auto !important/);
  assert.match(css, /@media \(forced-colors: active\)\s*\{[\s\S]*border-color: CanvasText/);
  assert.match(css, /@media \(forced-colors: active\)\s*\{[\s\S]*outline-color: Highlight/);
});

test('the builder copies only approved bytes and leaves no staging residue', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'recap-page-pages-test-'));
  const destination = join(temporary, 'artifact');
  try {
    const result = await buildPages({ destination });
    assert.deepEqual(result.files, PAGE_OUTPUTS);
    assert.deepEqual(await artifactInventory(destination), PAGE_OUTPUTS);

    for (const { source, destination: relativeDestination } of PAGE_SOURCES) {
      assert.deepEqual(
        await readFile(join(destination, ...relativeDestination.split('/'))),
        await readFile(join(ROOT, ...source.split('/'))),
        `${relativeDestination} differs from ${source}`,
      );
      assert.equal((await lstat(join(destination, ...relativeDestination.split('/')))).isFile(), true);
    }

    for (const document of PAGE_DOCUMENTS) {
      const markdown = await readFile(join(ROOT, ...document.source.split('/')), 'utf8');
      assert.equal(
        await readFile(join(destination, document.destination), 'utf8'),
        renderDocumentPage(document, markdown),
        `${document.destination} differs from the page rendered from ${document.source}`,
      );
    }
    assert.equal(
      await readFile(join(destination, RELEASE_PAGE.destination), 'utf8'),
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
  assert.match(copy, /iCloud: planned only for iPhone and iPad, not Windows or Android\. The iOS app currently has no cloud backup/);
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

const releaseItems = (version) => {
  const section = releaseContent.html.split(/<h2 /).find((part) => part.includes(`>Version ${version}</h2>`));
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

test('the What\'s new page lists the five latest finalized releases, newest first, with their dates', () => {
  const headings = [...releaseContent.html.matchAll(/<h2 id="([^"]+)">Version ([^<]+)<\/h2>\n<p>Finalized ([^<]+)\.<\/p>/g)]
    .map(([, id, version, date]) => [id, version, date]);
  assert.deepEqual(headings.map(([, version]) => version), ['4.3.0', '4.2.0', '4.1.0', '4.0.1', '4.0.0']);
  for (const [id, version, date] of headings) {
    assert.equal(id, `version-${version.replace(/\./g, '')}`);
    assert.match(date, /^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  }
  assert.match(releaseContent.html, /Version 4\.3\.0<\/h2>\n<p>Finalized October 30, 2026\.<\/p>/);
  assert.match(releaseContent.html, /Version 4\.0\.1<\/h2>\n<p>Finalized October 8, 2026\.<\/p>/,
    'an untagged Android patch is dated from its recorded bundle revision');
  assert.match(releaseContent.html, /href="https:\/\/github\.com\/raymond-nassar\/recap-page\/blob\/main\/CHANGELOG\.md">the full changelog<\/a>/);
});

test('the current release says exactly what the in-app What\'s new says', () => {
  assert.deepEqual(
    releaseItems(homeUpdatesContent.version),
    homeUpdatesContent.batch.features.map(expectedReleaseItem),
  );
});

test('platform-bound release notes name their platforms and nothing claims iPhone or iPad backup', () => {
  const backup = releaseItems('4.3.0').find((item) => item.includes('OneDrive'));
  assert.match(backup, /^<strong>OneDrive backup: Windows and Android only\.<\/strong> /);
  assert.match(releaseItems('4.0.1')[0], /^<strong>Android only\.<\/strong> /);
  for (const { version, features } of selectRecentReleases(changelog, releaseDates)) {
    assert.deepEqual(releaseItems(version), features.map(expectedReleaseItem));
    for (const feature of features) {
      if (/\b(?:Windows|Android|OneDrive|Edge|offline|install\w*)\b/i.test(feature)) {
        assert.ok(PLATFORM_LABELS.has(feature), `${version} names a platform without a label: ${feature}`);
      }
    }
  }
  assert.doesNotMatch(releaseContent.html, /\b(?:iPhone|iPad|iOS|iCloud)\b/, 'no line places a backup feature on Apple devices');
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
