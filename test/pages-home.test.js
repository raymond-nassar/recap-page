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
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  PAGE_OUTPUTS,
  PAGE_SOURCES,
  artifactInventory,
  buildPages,
  installArtifact,
} from '../scripts/build-pages.mjs';
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

const APP_ORIGIN = 'http://127.0.0.1:8787/';
const REPOSITORY = 'https://github.com/raymond-nassar/recap-page';
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
  '#overview',
  '#demo',
  '#getting-started',
  '#troubleshooting',
  '#documentation',
  '#project-questions',
  '#feedback',
  `${REPOSITORY}#readme`,
  '#getting-started',
  'https://apps.microsoft.com/detail/9PDJ7XR9Q40Q',
  `${REPOSITORY}/releases/latest/download/marvel-reading-tracker-windows.zip`,
  `${REPOSITORY}/blob/main/docs/RUNNING.md`,
  APP_ORIGIN,
  `${REPOSITORY}/releases`,
  `${REPOSITORY}/blob/main/docs/RUNNING.md#troubleshooting`,
  `${REPOSITORY}/blob/main/SUPPORT.md`,
  `${REPOSITORY}/blob/main/docs/RUNNING.md`,
  `${REPOSITORY}/blob/main/docs/ARCHITECTURE.md`,
  `${REPOSITORY}/blob/main/docs/DATA_PROVENANCE.md`,
  `${REPOSITORY}/blob/main/PRIVACY.md`,
  `${REPOSITORY}/blob/main/SECURITY.md`,
  `${REPOSITORY}/blob/main/docs/MAINTAINING.md`,
  `${REPOSITORY}/blob/main/CONTRIBUTING.md`,
  `${REPOSITORY}/blob/main/GOVERNANCE.md`,
  `${REPOSITORY}/blob/main/CHANGELOG.md`,
  `${REPOSITORY}/blob/main/docs/WHY_A_BROWSER_APP.md`,
  QUESTION_FORM_URL,
  `${REPOSITORY}/blob/main/SUPPORT.md`,
  `${REPOSITORY}/blob/main/SUPPORT.md`,
  `${REPOSITORY}/issues/new?template=bug.yml`,
  `${REPOSITORY}/issues/new?template=feature.yml`,
  `${REPOSITORY}/issues/new?template=data-order.yml`,
  `${REPOSITORY}/blob/main/SECURITY.md`,
  REPOSITORY,
  `${REPOSITORY}/issues`,
  `${REPOSITORY}/issues/403`,
  `${REPOSITORY}/commits/main`,
  `${REPOSITORY}/releases`,
  `${REPOSITORY}/blob/main/PRIVACY.md`,
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
  for (const { source } of PAGE_SOURCES) {
    const destination = join(root, ...source.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(ROOT, ...source.split('/')), destination);
  }
}

test('the source inventory and generated contract stay exact', async () => {
  assert.deepEqual((await readdir(join(ROOT, 'pages'))).sort(), ['index.html', 'site.css']);
  assert.deepEqual(PAGE_OUTPUTS, [
    'assets/avengers-disassembled-reading-1280.png',
    'assets/home-1280.png',
    'index.html',
    'site.css',
  ]);
  assert.deepEqual(
    PAGE_SOURCES.map(({ source }) => source),
    [
      'pages/index.html',
      'pages/site.css',
      'docs/screenshots/home-1280.png',
      'docs/screenshots/avengers-disassembled-reading-1280.png',
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
  assert.match(html, /<nav class="section-nav" aria-label="Page sections">/);
  assert.match(html, /<a class="skip-link" href="#main">Skip to main content<\/a>/);

  const requiredIds = [
    'main',
    'overview',
    'demo',
    'getting-started',
    'troubleshooting',
    'documentation',
    'project-questions',
    'feedback',
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
  assert.ok(hrefs.every((href) => href.startsWith('#') || href.startsWith('https://') || href === APP_ORIGIN));
});

test('the exact-origin warning appears before the only local-app link', () => {
  const warning = html.indexOf('<aside class="origin-warning"');
  const address = html.indexOf(`<code>${APP_ORIGIN}</code>`);
  const appLink = html.indexOf(`<a class="button" href="${APP_ORIGIN}">`);
  assert.ok(warning >= 0 && address > warning && appLink > address);
  assert.match(
    html.slice(warning, appLink),
    /different hostname or port uses separate browser storage and looks like a fresh app/,
  );
});

test('the demo is exactly the two current described product views', () => {
  const images = [...html.matchAll(/<img\b[\s\S]*?\/>/g)].map((tag) => attributes(tag[0]));
  assert.deepEqual(
    images.map(({ src }) => src),
    ['./assets/home-1280.png', './assets/avengers-disassembled-reading-1280.png'],
  );
  for (const image of images) {
    assert.ok(image.alt?.length > 20, `${image.src} has no useful text alternative`);
    assert.equal(image.width, '1280');
    assert.equal(image.height, '900');
    assert.equal(image.loading, 'lazy');
  }
});

test('the public question disclosure is complete before the form link', () => {
  const section = html.slice(
    html.indexOf('<section id="project-questions"'),
    html.indexOf('<section id="feedback"'),
  );
  assert.match(section, /You need a GitHub account and must sign in/);
  assert.match(section, /username, question, and every reply are public/);
  assert.match(section, /GitHub hosts and processes that content/);
  assert.match(section, /Recap Page sends nothing to the form automatically/);
  assert.match(section, /Name the maintained source you checked and what remains unclear/);
  assert.match(section, /Do not include reading progress, lists, notes, backups, personal information,\s+attachments, or vulnerability details/);
  assert.match(section, /Troubleshooting, defects, improvements, catalogue corrections, and security reports/);
  assert.ok(section.indexOf('Before you open the question form') < section.indexOf(QUESTION_FORM_URL));
  assert.equal([...section.matchAll(new RegExp(QUESTION_FORM_URL.replace('?', '\\?'), 'g'))].length, 1);

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
    await writeFile(join(root, 'pages', 'unexpected.html'), '<p>not approved</p>', 'utf8');

    await assert.rejects(
      buildPages({ root, destination }),
      /Pages source inventory/,
    );
    assert.equal(
      await readFile(join(destination, 'previous.txt'), 'utf8'),
      'keep this complete artifact',
    );
    assert.deepEqual(await readdir(destination), ['previous.txt']);
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
      sha: '820762786026740c76f36085b0efc47a31fe5020',
      version: 'v7.0.0',
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
