// Real-browser regression evidence, made reproducible.
//
// The backlog and the UX study rest on browser verification that was real but unrepeatable: the
// scripts lived outside the tree, so a clean clone could rerun none of it. This file is that
// evidence, committed. It drives installed Edge through the journeys the app is for, and it
// is the only place where a claim about what the interface does in a browser can be checked
// rather than argued.
//
// **puppeteer-core is not a dependency of this repository and must not become one.** It is
// resolved at run time from outside the tree, and its absence is a prerequisite failure with
// instructions attached, not a test failure. Nothing here is installed by `npm ci`, nothing here
// runs in CI, and `package.json` gains no entry for it. If your first instinct on reading the
// import below is to add it to devDependencies, that is the instinct this paragraph exists to
// stop.
//
// **The server binds an ephemeral port, and that is a guarantee rather than a convenience.**
// Constraint 5 says a different origin is a different storage bucket. For the app that is a
// hazard; for a check that writes corrupt state and starts fresh, it is exactly the isolation
// wanted. Running on a port the app never uses means this file structurally cannot read, damage
// or clear the reading progress saved at 127.0.0.1:8787. That is also the whole of the cleanup
// story: there is nothing to tidy up, because nothing durable was ever written where the app
// would look for it.
//
// **The data is fixtures, not the catalog.** The scenarios assert what the interface does, and
// the vendored orders have their own gates. Stubbing `fetch` for the two data files keeps this
// check fast, deterministic and immune to a catalog edit that has nothing to do with it. The
// Modern Timeline contract is the exception: its boundary and aggregate assertions intentionally
// run against the checked-in snapshot because the exact first entry and totals are the contract.

import { createStaticServer, HOST } from '../server.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { APP_VERSION } from '../src/js/lib/version.js';
import {
  LATEST_RELEASE_API_URL, UPDATE_DOWNLOAD_URL, UPDATE_RELEASE_NOTES_URL,
} from '../src/js/lib/updateCheck.js';
import { DEFAULT_BASE } from '../src/js/api.js';
import {
  availablePublishingCategories, decadeSections, eraSections, groupCatalog, publishingAgeGroups,
  shelfSections,
} from '../src/js/lib/catalog.js';

// Exit 2 rather than 1 for a missing prerequisite. A failed assertion and an uninstalled browser
// driver are different answers to different questions, and a caller that cannot tell them apart
// reports "the app is broken" when the truth is "the driver is not here".
const EXIT_PREREQ = 2;

// ------------------------------------------------------------------ prerequisites

// Every published layout of the entry point, newest first. puppeteer-core moved it once, so a
// machine with an older scratch install still resolves.
const DRIVER_SUFFIXES = [
  join('lib', 'puppeteer', 'puppeteer-core.js'),
  join('lib', 'esm', 'puppeteer', 'puppeteer-core.js'),
];

function driverCandidates() {
  const roots = [];
  if (process.env.MRT_PUPPETEER) roots.push(process.env.MRT_PUPPETEER);
  for (const dir of ['.mrt-scratch', 'mrt-scratch-pptr', 'mrt-scratch']) {
    roots.push(join(homedir(), dir));
  }

  const out = [];
  for (const root of roots) {
    // MRT_PUPPETEER may name the entry file itself, the package, or the directory the package was
    // installed into. All three are things a person reasonably types.
    if (root.endsWith('.js')) out.push(root);
    for (const suffix of DRIVER_SUFFIXES) {
      out.push(join(root, suffix));
      out.push(join(root, 'node_modules', 'puppeteer-core', suffix));
    }
  }
  return out;
}

function resolveDriver() {
  for (const candidate of driverCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge',
];

function resolveEdge() {
  if (process.env.MRT_EDGE) return existsSync(process.env.MRT_EDGE) ? process.env.MRT_EDGE : null;
  return EDGE_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

function prerequisiteFailure(what, how) {
  console.error(`\nCannot run the browser check: ${what}\n`);
  for (const line of how) console.error(`  ${line}`);
  console.error('');
  process.exit(EXIT_PREREQ);
}

// ------------------------------------------------------------------ fixtures

// Three issues is the smallest order that can still show an order: a first, a middle and a last.
// The second deliberately has no digitalId, because the launcher has two paths and only one of
// them is exercised by an issue we already know the reference for.
const ORDER_FILE = 'browser_check_fixture.json';
const ACTUAL_CATALOG = JSON.parse(
  readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'),
);
const ACTUAL_MARVEL_KNIGHTS_PARENT = JSON.parse(
  readFileSync(new URL('../src/data/marvel_knights_to_planet_x.json', import.meta.url), 'utf8'),
);

function legacyMarvelKnightsState() {
  const items = ACTUAL_MARVEL_KNIGHTS_PARENT.items;
  const issues = Object.fromEntries(items.map(({ collectedIn: _collectedIn, ...item }) => [
    item.issueId,
    { ...item, source: 'curated' },
  ]));
  const collectedIn = Object.fromEntries(
    items.filter((item) => item.collectedIn).map((item) => [item.issueId, item.collectedIn]),
  );
  return {
    schemaVersion: 2,
    issues,
    read: { [items[0].issueId]: 1234 },
    overrides: { [items[1].issueId]: 'available' },
    notes: { [items[2].issueId]: 'Legacy issue note' },
    lists: {
      legacy: {
        id: 'legacy',
        name: ACTUAL_MARVEL_KNIGHTS_PARENT.name,
        description: ACTUAL_MARVEL_KNIGHTS_PARENT.description,
        note: 'Legacy list note',
        created: 1234,
        catalogId: ACTUAL_MARVEL_KNIGHTS_PARENT.id,
        itemIds: items.map((item) => item.issueId),
        collectedIn,
      },
    },
    listOrder: ['legacy'],
    active: 'legacy',
  };
}

const ORDER = {
  id: 'browser-check',
  name: 'Browser Check Order',
  description: 'A fixture order used only by the browser check.',
  source: null,
  sourceOrigin: 'Fixture',
  sourceLicense: null,
  generatedAt: '2026-01-01T00:00:00.000Z',
  apiBase: null,
  count: 3,
  placeholders: 0,
  unresolved: 0,
  items: [
    {
      issueId: 900001,
      title: 'Browser Check (2026) #1',
      number: '1',
      url: 'https://www.marvel.com/comics/issue/900001/browser_check_1',
      seriesId: 90000,
      seriesName: 'Browser Check (2026)',
      onSale: '2026-01-01T00:00:00+0000',
      mu: '2026-02-01T00:00:00+0000',
      digitalId: 700001,
      cover: null,
      description: null,
      pageCount: 0,
      creators: [],
    },
    {
      issueId: 900002,
      title: 'Browser Check (2026) #2',
      number: '2',
      url: 'https://www.marvel.com/comics/issue/900002/browser_check_2',
      seriesId: 90000,
      seriesName: 'Browser Check (2026)',
      onSale: '2026-02-01T00:00:00+0000',
      mu: null,
      digitalId: null,
      cover: null,
      description: null,
      pageCount: 0,
      creators: [],
    },
    {
      issueId: 900003,
      title: 'Browser Check (2026) #3',
      number: '3',
      url: 'https://www.marvel.com/comics/issue/900003/browser_check_3',
      seriesId: 90000,
      seriesName: 'Browser Check (2026)',
      onSale: '2026-03-01T00:00:00+0000',
      mu: '2026-04-01T00:00:00+0000',
      digitalId: 700003,
      cover: null,
      description: null,
      pageCount: 0,
      creators: [],
    },
  ],
};

const LONG_ORDER = {
  ...ORDER,
  id: 'browser-check-long',
  name: 'Browser Check Long Order',
  count: 219,
  items: Array.from({ length: 219 }, (_, index) => {
    const template = ORDER.items[index % ORDER.items.length];
    const number = index + 1;
    return {
      ...template,
      issueId: 910000 + number,
      title: `Browser Check Long Order #${number}`,
      number: String(number),
      url: `https://www.marvel.com/comics/issue/${910000 + number}/browser_check_long_${number}`,
      digitalId: 710000 + number,
      onSale: `2026-${String((index % 12) + 1).padStart(2, '0')}-01T00:00:00+0000`,
    };
  }),
};

const NEGATIVE_ORDER_ITEM = {
  issueId: -900004,
  title: 'Local Browser Check Issue',
  number: 'Local',
  url: null,
  seriesId: null,
  seriesName: 'Browser Check',
  onSale: null,
  mu: null,
  digitalId: null,
  cover: null,
  description: null,
  pageCount: 0,
  creators: [],
};

// A shelf entry, with only the fields a row reads. Written as a factory because the path needs
// five of them and repeating twenty fields five times would bury the two that differ per stop.
const shelfEntry = (id, name, extra = {}) => ({
  id,
  file: ORDER_FILE,
  name,
  description: `A fixture order used only by the browser check.`,
  type: 'event',
  depth: 'complete',
  count: 3,
  collections: 0,
  characters: [],
  keywords: [],
  group: null,
  groupName: null,
  variant: null,
  beginner: false,
  cover: null,
  source: null,
  sourceOrigin: 'Fixture',
  sourceLicense: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  timeline: null,
  ...extra,
});

// Thirty-four entries make thirty-two stories. Three event stories sit on one path, while two
// storylines each cross to another browse screen. The thirteen Character Spotlight stories put
// that shelf over its search threshold, the ten extra events do the same for Timeline, and five
// screen companions populate MCU Prep.
// The third stop is a story read two ways, which is the case the shelf and the path disagree about
// most easily: the
// path step names one reading, the shelf draws one row for the story, and the stop has to be
// named the way the row is or it points at something not on screen.
//
// The character fixture freezes the five Best of and two complete-guide baseline that introduced the
// filter behavior. Current catalog totals are checked separately against the real bundled data. The
// remaining records stay available only under All, including a grouped pair, Essential Avengers, and
// three additional records that keep search available while either visible subset is selected.
const CATALOG = {
  lists: [
    shelfEntry('browser-check', 'Browser Check Order', {
      timeline: 2004, beginner: true,
      source: 'https://example.com/shared-page', sourceSection: 'Fixture section',
    }),
    shelfEntry('browser-check-two', 'Second Stop', { timeline: 2005 }),
    shelfEntry('browser-check-three-main', 'Third Stop: The Long Way', {
      group: 'bc-third', groupName: 'Third Stop', variant: 'Complete', timeline: 2006,
    }),
    shelfEntry('browser-check-three-short', 'Third Stop: The Short Way', {
      group: 'bc-third', groupName: 'Third Stop', variant: 'Essential', depth: 'essential', timeline: 2006,
    }),
    shelfEntry('browser-check-line', 'Across the Line', { type: 'creator-run', timeline: 2012 }),
    shelfEntry('browser-check-age-line', 'Across Two Periods', { type: 'creator-run', timeline: 2004 }),
    ...[
      'Doctor Strange: Multiverse of Madness',
      'Spider-Man: No Way Home',
      'Marvel Multiverse',
      'Marvel What If?',
      'Spider-Man: Far From Home',
    ].map((name, index) => shelfEntry(
      `screen-companion-${index + 1}`,
      name,
      { type: 'screen-companion', depth: 'selected', timeline: null, beginner: false },
    )),
    shelfEntry('browser-check-off', 'Off The Path', { type: 'character-run', spotlightKind: 'other' }),
    shelfEntry('essential-avengers', 'Essential Avengers', { type: 'character-run', spotlightKind: 'other' }),
    shelfEntry('x-men-spine', 'X-Men Spine', {
      type: 'character-run', spotlightKind: 'other',
      group: 'x-men', groupName: 'X-Men', variant: 'Spine',
    }),
    shelfEntry('x-men-complete', 'X-Men Complete', {
      type: 'character-run', spotlightKind: 'other',
      group: 'x-men', groupName: 'X-Men', variant: 'Complete',
    }),
    ...['Phoenix', 'Captain America', 'Spider-Man', 'Thor', 'Scarlet Witch'].map((name, index) => shelfEntry(
      `spotlight-best-${index + 1}`,
      name,
      { type: 'character-run', spotlightKind: 'best-of' },
    )),
    shelfEntry('spotlight-complete-1', 'White Tiger', {
      type: 'character-run', spotlightKind: 'complete-guide',
    }),
    shelfEntry('spotlight-complete-2', 'Phalanx', {
      type: 'character-run', spotlightKind: 'complete-guide',
    }),
    ...Array.from({ length: 3 }, (_, index) => shelfEntry(
      `spotlight-other-${index + 1}`,
      `Other Spotlight ${index + 1}`,
      { type: 'character-run', spotlightKind: 'other' },
    )),
    shelfEntry('avengers-disassembled', 'Avengers Disassembled', { timeline: 2004, beginner: true }),
    ...Array.from({ length: 9 }, (_, index) => shelfEntry(
      `browser-check-extra-${index + 1}`,
      `Fixture Event ${index + 1}`,
      { timeline: index === 0 ? 2012 : 2008 },
    )),
    shelfEntry('setup-to-modern-timeline', 'Setup to Modern Timeline', {
      type: 'era', timeline: null,
    }),
  ],
  paths: [
    {
      id: 'bc-path',
      name: 'The Fixture Path',
      description: 'A fixture path used only by the browser check.',
      sourceOrigin: 'Fixture',
      // The last step names the *short* reading on purpose, so a row that echoed the step rather
      // than resolving it to the story would read "Third Stop: The Short Way" and be caught.
      steps: ['browser-check', 'browser-check-two', 'browser-check-three-short'],
    },
    {
      id: 'bc-age-path',
      name: 'Across Two Periods',
      description: 'A fixture path crossing two publishing periods.',
      sourceOrigin: 'Fixture',
      steps: ['browser-check-age-line', 'browser-check-extra-1'],
    },
    {
      id: 'spotlight-arrival',
      name: 'The Spotlight Path',
      description: 'A fixture path that arrives at a card hidden by either visible subset.',
      sourceOrigin: 'Fixture',
      steps: ['browser-check-line', 'essential-avengers'],
    },
  ],
};

const PUBLISHING_CATALOG = {
  ...CATALOG,
  lists: [
    ...CATALOG.lists,
    shelfEntry('silver-age-fixture', 'Silver Age Fixture', { timeline: 1961 }),
    shelfEntry('bronze-age-fixture', 'Bronze Age Fixture', { timeline: 1975 }),
    shelfEntry('copper-age-fixture', 'Copper Age Fixture', { timeline: 1988 }),
  ],
};
const EMPTY_CATALOG = { lists: [], paths: [] };
const SPARSE_PUBLISHING_CATALOG = {
  lists: [
    shelfEntry('sparse-silver', 'Sparse Silver Fixture', { timeline: 1961 }),
    shelfEntry('sparse-bronze-one', 'Sparse Bronze Fixture One', { timeline: 1975 }),
    shelfEntry('sparse-bronze-two', 'Sparse Bronze Fixture Two', { timeline: 1976 }),
  ],
  paths: [],
};

const FIXTURE_SHELVES = new Map(
  shelfSections(groupCatalog(CATALOG.lists)).map((shelf) => [shelf.key, shelf.stories]),
);
const FIXTURE_TIMELINE_SECTIONS = eraSections(FIXTURE_SHELVES.get('catalog'));
const FIXTURE_STORYLINE_SECTIONS = decadeSections(FIXTURE_SHELVES.get('lines'));
const FIXTURE_PUBLISHING_GROUPS = publishingAgeGroups(groupCatalog(PUBLISHING_CATALOG.lists));
const FIXTURE_PUBLISHING_AGES = availablePublishingCategories(groupCatalog(PUBLISHING_CATALOG.lists));
const FIXTURE_MODERN_PERIODS = availablePublishingCategories(
  groupCatalog(PUBLISHING_CATALOG.lists),
  'modern',
);
const IMPORT_BUTTON = `#catalog-results button[aria-label="Add to library: ${CATALOG.lists[0].name}"]`;
const ORDER_COUNT = ORDER.items.length;
const EXPECTED_TITLES = ORDER.items.map((i) => i.title);

// ------------------------------------------------------------------ mutations

// A check that has never been seen to fail is not evidence. Each entry below breaks one capability
// a scenario asserts, and --prove runs them and records which scenarios each one turns red. They
// are injected into the page rather than edited into a source file, so a killed run cannot leave
// the tree modified, which is a failure mode a file-editing harness has and this one cannot.
const MUTATIONS = [
  {
    id: 'first-run-question-generic',
    breaks: 'home-first-run-wayfinding',
    why: 'the first-run question no longer asks the reader where they want to start',
    script: () => {
      addEventListener('load', () => {
        document.querySelector('#home-first-run-h').textContent = 'Choose something to read';
      });
    },
  },
  {
    id: 'home-copy-return',
    breaks: 'home-category-gateway',
    why: 'the first-run question is replaced by a generic heading and explanatory sentence',
    script: () => {
      addEventListener('load', () => {
        const heading = document.querySelector('#home-h');
        heading.textContent = 'Pick something to read';
        const sub = document.createElement('p');
        sub.className = 'sub';
        sub.textContent = 'Every order below ships with the app.';
        heading.after(sub);
      });
    },
  },
  {
    id: 'marvel-ages-index-dispatch-off',
    breaks: 'publishing-ages',
    why: 'the shared Marvel Ages route falls through to generic Reading List cards',
    rewriteMain: (source) => source.replace(
      / {2}if \(category\.kind === 'publishing-index'\) \{\r?\n {4}renderPublishingIndex\(category, allStories\);\r?\n {4}return;\r?\n {2}\}\r?\n/,
      '',
    ),
  },
  {
    id: 'publishing-render-dispatch-off',
    breaks: 'publishing-ages',
    why: 'an age route opens its panel but never renders the Reading Lists selected for it',
    rewriteMain: (source) => source.replace(
      '  if (generatedCategoryByRoute.has(next)) renderPublishingCategory(next);',
      '',
    ),
  },
  {
    id: 'publishing-canonical-year-heading-flat',
    breaks: 'publishing-ages',
    why: 'the canonical Timeline year loses its h3 level after the shared renderer is configured',
    rewriteMain: (source) => source.replace(
      "      yearLevel: 'h3',",
      "      yearLevel: 'h2',",
    ),
  },
  {
    id: 'publishing-timeline-id-scope-off',
    breaks: 'publishing-ages',
    why: 'an age timeline reuses the canonical id prefix after both route panels have rendered',
    rewriteMain: (source) => source.replace(
      '    idPrefix: route, showEmptyYears: true, sectionBlurb: false,',
      "    idPrefix: 'timeline', showEmptyYears: true, sectionBlurb: false,",
    ),
  },
  {
    id: 'publishing-report-target-catalog',
    breaks: 'publishing-ages',
    why: 'an age-card import failure is written into the hidden canonical catalog report',
    rewriteMain: (source) => source.replace(
      '      report: `#${route}-report`,',
      "      report: '#catalog-report',",
    ),
  },
  {
    id: 'preview-open-dialog-stays',
    breaks: 'publishing-ages',
    why: 'Preview stays modal after its Open action navigates to a saved Reading List',
    rewriteMain: (source) => source.replace(
      / {8}if \(\$\('#preview'\)\.open\) \$\('#preview'\)\.close\(\);\r?\n {8}showView\('read', \{ push: true \}\);/,
      "        showView('read', { push: true });",
    ),
  },
  {
    id: 'gateway-status-silent',
    breaks: 'home-category-gateway',
    why: 'asynchronous Home and Browse categories lose their polite completion status',
    script: () => {
      addEventListener('load', () => {
        for (const status of document.querySelectorAll('[data-paths-status]')) {
          status.removeAttribute('role');
        }
      });
    },
  },
  {
    id: 'publishing-count-silent',
    breaks: 'publishing-ages',
    why: 'an asynchronously rendered publishing result count is no longer announced',
    script: () => {
      addEventListener('load', () => {
        for (const count of document.querySelectorAll('.publishing-count')) {
          count.removeAttribute('role');
        }
      });
    },
  },
  {
    id: 'browse-subtitle-return',
    breaks: 'copy-density',
    why: 'an explanatory subtitle returns beneath a browse screen heading',
    script: () => {
      addEventListener('load', () => {
        const heading = document.querySelector('#catalog-h');
        const sub = document.createElement('p');
        sub.className = 'sub';
        sub.textContent = 'Events in the order they were published.';
        heading.after(sub);
      });
    },
  },
  {
    id: 'add-header-copy-return',
    breaks: 'copy-density',
    why: 'the Add destination is repeated in the page header as well as the working card',
    script: () => {
      addEventListener('load', () => {
        const sub = document.createElement('p');
        sub.className = 'sub add-target';
        sub.textContent = 'Anything you add goes into this list.';
        document.querySelector('#add-search-h').after(sub);
      });
    },
  },
  {
    id: 'progress-copy-return',
    breaks: 'copy-density',
    why: 'Progress methodology returns as standing text above the results',
    script: () => {
      addEventListener('load', () => {
        const note = document.createElement('p');
        note.className = 'rail-hint';
        note.id = 'progress-note';
        note.textContent = 'Tracked means what you have added, not the size of the whole series.';
        document.querySelector('#progress-method').before(note);
      });
    },
  },
  {
    id: 'settings-copy-return',
    breaks: 'copy-density',
    why: 'a Settings card repeats what its control already says',
    script: () => {
      addEventListener('load', () => {
        const card = [...document.querySelectorAll('#view-data .setting')]
          .find((candidate) => candidate.querySelector('h3')?.textContent === 'Theme');
        const desc = document.createElement('p');
        desc.className = 'rail-hint setting-desc';
        desc.textContent = 'Follow your system setting, or pick one and keep it.';
        card.querySelector('h3').after(desc);
      });
    },
  },
  {
    id: 'home-paths-stack-wide',
    breaks: 'home-category-gateway',
    why: 'the three primary reading paths stack at desktop width instead of reading as equal choices',
    script: () => {
      addEventListener('load', () => {
        const sheet = [...document.styleSheets].find((s) => s.href?.endsWith('styles.css'));
        sheet.insertRule('#home-primary-paths { grid-template-columns: 1fr !important; }', sheet.cssRules.length);
      });
    },
  },
  {
    id: 'home-path-explanation',
    breaks: 'home-category-gateway',
    why: 'standing explanatory copy returns inside a category tile',
    script: () => {
      addEventListener('load', () => {
        const insert = () => {
          const copy = document.querySelector('.home-path-copy');
          if (!copy || copy.querySelector('.home-path-explanation')) return false;
          const note = document.createElement('p');
          note.className = 'home-path-explanation';
          note.textContent = 'Use this route when you want the stories arranged around publication milestones.';
          copy.append(note);
          return true;
        };
        if (insert()) return;
        const observer = new MutationObserver(() => {
          if (insert()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
    },
  },
  {
    id: 'timeline-sticky-off',
    breaks: 'shelf-sections',
    why: 'year labels scroll away from their own card groups instead of staying beside them',
    script: () => {
      addEventListener('load', () => {
        const sheet = [...document.styleSheets].find((s) => s.href?.endsWith('styles.css'));
        sheet.insertRule('.timeline-year-marker { position: static !important; }', sheet.cssRules.length);
      });
    },
  },
  {
    id: 'timeline-node-overlap',
    breaks: 'shelf-sections',
    why: 'year labels are allowed back under their Timeline nodes',
    script: () => {
      addEventListener('load', () => {
        const sheet = [...document.styleSheets].find((s) => s.href?.endsWith('styles.css'));
        sheet.insertRule('.timeline-year-marker { padding-right: .75rem !important; }', sheet.cssRules.length);
      });
    },
  },
  {
    id: 'catalog-card-height',
    breaks: 'shelf-sections',
    why: 'one Timeline card grows taller than the other cards in its year group',
    script: () => {
      addEventListener('load', () => {
        const sheet = [...document.styleSheets].find((s) => s.href?.endsWith('styles.css'));
        sheet.insertRule('#catalog-results .timeline-year-cards { grid-auto-rows: auto; align-items: start; }', sheet.cssRules.length);
        sheet.insertRule('#catalog-results .timeline-year-cards .catalog-card:first-child { min-height: 390px; }', sheet.cssRules.length);
      });
    },
  },
  {
    id: 'rail-scrollbar-visible',
    breaks: 'rail-collapse',
    why: 'Windows scrollbar chrome takes the space reserved for compact navigation icons',
    script: () => {
      addEventListener('load', () => {
        const sheet = [...document.styleSheets].find((s) => s.href?.endsWith('styles.css'));
        sheet.insertRule('.railed .nav-scroll { scrollbar-width: auto !important; }', sheet.cssRules.length);
        sheet.insertRule('.railed .nav-scroll::-webkit-scrollbar { display: block !important; }', sheet.cssRules.length);
      });
    },
  },
  {
    id: 'rail-bleed',
    breaks: 'rail-collapse',
    why: 'the collapsed-sidebar rule is unscoped again, exactly as it shipped, so it reaches every pill in the shelf',
    script: () => {
      addEventListener('load', () => {
        // Through the CSSOM, not as an injected <style>. The app sends `style-src 'self'`, which
        // drops an injected stylesheet in silence, and the first shape of this mutation was
        // dropped that way: --prove reported it breaking nothing, which reads as a scenario that
        // cannot fail rather than as a mutation that never ran.
        const sheet = [...document.styleSheets].find((s) => s.href?.endsWith('styles.css'));
        sheet.insertRule('.railed .result-path > summary { width: 10px; height: 10px; padding: 0; color: transparent; overflow: hidden; }', sheet.cssRules.length);
      });
    },
  },
  {
    id: 'rail-unscoped',
    breaks: 'rail-collapse',
    why: 'the rule is scoped away from the rail as well, so the sidebar keeps a full-width pill in a lane too narrow for it',
    script: () => {
      addEventListener('load', () => {
        const sheet = [...document.styleSheets].find((s) => s.href?.endsWith('styles.css'));
        sheet.insertRule('.railed .rail-foot .pill { width: auto; height: auto; padding: .2rem .6rem; }', sheet.cssRules.length);
      });
    },
  },
  {
    id: 'path-strip',
    breaks: 'reading-path',
    why: 'the catalog arrives with no paths, so a shelf that still shows a reading order is showing one it was not given',
    script: () => {
      window.__mrtMutation = 'path-strip';
    },
  },
  {
    id: 'group-strip',
    breaks: 'reading-path',
    why: 'a story read two ways loses its shared name, so a stop naming the story rather than one reading of it cannot be resolving anything',
    script: () => {
      window.__mrtMutation = 'group-strip';
    },
  },
  {
    id: 'type-flatten',
    breaks: 'shelf-sections',
    why: 'every order arrives typed as one kind, so a shelf that still draws two headings is dividing on something other than the rule it claims to divide on',
    script: () => {
      window.__mrtMutation = 'type-flatten';
    },
  },
  {
    id: 'spotlight-filter-noop',
    breaks: 'spotlight-filter',
    why: 'the selected Character Spotlight subset is ignored before search and grouping',
    rewriteMain: (source) => source.replace(
      '? filterBySpotlightKind(mine, state.spotlight)',
      '? mine',
    ),
  },
  {
    id: 'import-fail',
    breaks: 'import',
    why: 'the order file cannot be fetched, so an import that reports success is reporting nothing',
    script: () => {
      window.__mrtMutation = 'import-fail';
    },
  },
  {
    id: 'persist-noop',
    breaks: 'persistence',
    why: 'writes to the state key are dropped, so progress that survives a reload cannot be real',
    script: () => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === 'mrt.state.v2') return undefined;
        return real.call(this, key, value);
      };
    },
  },
  {
    id: 'forget-marks',
    breaks: 'persistence',
    why: 'read marks are stripped from every write, so a mark that appears to reach storage never did',
    script: () => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key, value) {
        if (key !== 'mrt.state.v2') return real.call(this, key, value);
        try {
          const parsed = JSON.parse(value);
          // Only touch a write the app made. The recovery scenario writes a corrupt payload of its
          // own through this same setItem, and rewriting that one would redden recovery's
          // byte-for-byte row as harness interference rather than as an app fault.
          if (!Object.prototype.hasOwnProperty.call(parsed, 'read')) return real.call(this, key, value);
          parsed.read = {};
          return real.call(this, key, JSON.stringify(parsed));
        } catch {
          return real.call(this, key, value);
        }
      };
    },
  },
  {
    id: 'route-freeze',
    breaks: 'navigation',
    why: 'history stops recording, so an address bar that tracks the view cannot be doing so',
    script: () => {
      history.pushState = () => {};
      history.replaceState = () => {};
    },
  },
  {
    id: 'breadcrumb-wrong-parent',
    breaks: 'breadcrumb-navigation',
    why: 'an Add comics child is placed under Browse, so the trail no longer states the route hierarchy',
    rewriteRoute: (source) => source.replace(
      "return [home, linked('add', 'Add comics'), current(addLabel)];",
      "return [home, linked('browse', 'Browse'), current(addLabel)];",
    ),
  },
  {
    id: 'breadcrumb-on-home',
    breaks: 'breadcrumb-navigation',
    why: 'Home receives a redundant trail even though it has no route ancestors',
    script: () => {
      const inject = () => {
        if (!['', '#', '#/', '#/home'].includes(location.hash)) return;
        const head = document.querySelector('#view-home > .head');
        if (!head || document.querySelector('#view-home > .breadcrumb')) return;
        const nav = document.createElement('nav');
        nav.className = 'breadcrumb';
        nav.setAttribute('aria-label', 'Breadcrumb');
        nav.innerHTML = '<ol><li><span aria-current="page">Home</span></li></ol>';
        head.before(nav);
      };
      addEventListener('load', inject);
      addEventListener('hashchange', () => queueMicrotask(inject));
    },
  },
  {
    id: 'breadcrumb-in-preview',
    breaks: 'breadcrumb-navigation',
    why: 'the Preview dialog receives route ancestry even though it is not a routed page',
    script: () => {
      const inject = () => {
        const dialog = document.querySelector('#preview[open]');
        if (!dialog || dialog.querySelector('.breadcrumb')) return;
        const nav = document.createElement('nav');
        nav.className = 'breadcrumb';
        nav.setAttribute('aria-label', 'Breadcrumb');
        nav.innerHTML = '<ol><li><a href="#/browse">Browse</a></li><li><span aria-current="page">Preview</span></li></ol>';
        dialog.prepend(nav);
      };
      addEventListener('load', () => {
        new MutationObserver(inject).observe(document.body, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        inject();
      });
    },
  },
  {
    id: 'breadcrumb-non-anchor',
    breaks: 'breadcrumb-navigation',
    why: 'ancestor destinations become inert text instead of real hash links',
    rewriteMain: (source) => source.replace(
      "? el('a', { href: item.href }, item.label)",
      "? el('span', {}, item.label)",
    ),
  },
  {
    id: 'add-comics-drift',
    breaks: 'breadcrumb-navigation',
    why: 'the destination and its hub regress to the ambiguous Add name',
    script: () => {
      addEventListener('DOMContentLoaded', () => {
        const rail = document.querySelector('.ri[data-view="add"]');
        const heading = document.querySelector('#add-h');
        if (rail) rail.querySelector('.lbl').textContent = 'Add';
        if (heading) heading.textContent = 'Add';
      });
    },
  },
  {
    id: 'issue-focus-no-push',
    breaks: 'issue-focus',
    why: 'issue inspection stops creating its one history entry, so Back cannot return to the source',
    rewriteMain: (source) => source.replace("  history.pushState(null, '', href);", ''),
  },
  {
    id: 'issue-focus-forget-opener',
    breaks: 'issue-focus',
    why: 'the source entry loses its ephemeral opener, so Back cannot restore focus to the inspect link',
    rewriteMain: (source) => source.replace(
      '  history.replaceState({ ...current, issueFocusOpener: opener }, \'\', location.href);',
      '',
    ),
  },
  {
    id: 'issue-focus-writes-state',
    breaks: 'issue-focus',
    why: 'opening issue details mutates saved progress, violating the URL-only selection contract',
    script: () => {
      const real = history.pushState.bind(history);
      history.pushState = (state, unused, url) => {
        if (String(url).startsWith('#/issue/')) {
          localStorage.setItem('mrt.state.v2', `${localStorage.getItem('mrt.state.v2')} `);
        }
        return real(state, unused, url);
      };
    },
  },
  {
    id: 'issue-focus-coming-read-missing',
    breaks: 'issue-focus',
    why: 'Coming up loses its separate Read action and leaves inspection as the only tile action',
    script: () => {
      const remove = () => document.querySelectorAll('#shelf .tile-read').forEach((node) => node.remove());
      addEventListener('load', () => {
        new MutationObserver(remove).observe(document.body, { childList: true, subtree: true });
        remove();
      });
    },
  },
  {
    id: 'issue-focus-control-identity-missing',
    breaks: 'issue-focus',
    why: 'full-order title and cover links collapse to one opener identity, so Back lands on the first link',
    rewriteMain: (source) => source.replace(
      '    && (node.dataset.focusControl || null) === (opener.control || null)',
      '',
    ),
  },
  {
    id: 'issue-focus-opener-not-consumed',
    breaks: 'issue-focus',
    why: 'a deliberate later navigation leaves the old opener on its source history entry',
    rewriteMain: (source) => source.replace('      delete current.issueFocusOpener;', ''),
  },
  {
    id: 'full-order-builds-while-closed',
    breaks: 'full-order-performance',
    why: 'the closed guard is removed, so an ordinary 219-issue route eagerly creates every row',
    rewriteMain: (source) => source.replace(
      / {4}if \(!\$\('#full'\)\.open\) \{ rowsPending = true; return; \}/,
      '    if (false) { rowsPending = true; return; }',
    ),
  },
  {
    id: 'full-order-paints-empty',
    breaks: 'full-order-discoverability',
    why: 'manual opening defers row construction past the first animation-frame boundary',
    rewriteMain: (source) => source
      .replace(
        "    queueMicrotask(() => { if ($('#full').open && rowsPending) renderRows(); });",
        '    requestAnimationFrame(() => requestAnimationFrame(renderRows));',
      )
      .replace(
        '    renderRows();\n    if (!routeDriven) syncHash();',
        '    requestAnimationFrame(() => requestAnimationFrame(renderRows));\n'
          + '    if (!routeDriven) syncHash();',
      ),
  },
  {
    id: 'full-order-addresses-restored-filter',
    breaks: 'full-order-discoverability',
    why: 'passive state renders serialize a restored filter and turn it into opening intent on reload',
    rewriteMain: (source) => source.replace(
      '      filter: showFilter ? shown : DEFAULT_FILTER,',
      '      filter: shown,',
    ),
  },
  {
    id: 'full-order-discards-row-cache',
    breaks: 'full-order-performance',
    why: 'every render gets a new row key, so a one-issue progress change rebuilds all 219 rows',
    rewriteMain: (source) => source.replace(
      '  return `${JSON.stringify(item)}|${item.issueId === currentId}|${today}|${covers !== false}`;',
      '  return `${JSON.stringify(item)}|${item.issueId === currentId}|${today}|${covers !== false}|${Math.random()}`;',
    ),
  },
  {
    id: 'hide-blocked',
    breaks: 'recovery',
    why: 'the banner is forced hidden, so unreadable data would be met with silence',
    script: () => {
      document.addEventListener('DOMContentLoaded', () => {
        const banner = document.querySelector('#blocked-banner');
        if (!banner) return;
        new MutationObserver(() => {
          if (!banner.hidden) banner.hidden = true;
        }).observe(banner, { attributes: true });
        banner.hidden = true;
      });
    },
  },
  {
    id: 'disable-recovery',
    breaks: 'recovery',
    why: 'the banner still appears but its two buttons are unusable, so the reader is told their data is unreadable and offered no way out of it',
    script: () => {
      document.addEventListener('DOMContentLoaded', () => {
        for (const id of ['#btn-download-salvage', '#btn-start-fresh']) {
          const el = document.querySelector(id);
          if (el) el.disabled = true;
        }
      });
    },
  },
  {
    id: 'fade-recovery',
    breaks: 'recovery',
    why: 'the two buttons are faded out the way this stylesheet already hides row actions, so they are on screen and out of reach',
    script: () => {
      document.addEventListener('DOMContentLoaded', () => {
        // Inserted through the CSSOM rather than as a <style> element, because the app sends
        // style-src 'self' and an injected stylesheet would be refused rather than applied.
        const sheet = document.styleSheets[0];
        if (!sheet) return;
        sheet.insertRule('#btn-download-salvage, #btn-start-fresh { opacity: 0; pointer-events: none; }', sheet.cssRules.length);
      });
    },
  },
  {
    id: 'wipe-original',
    breaks: 'recovery',
    why: 'the unreadable original is deleted once it has been copied aside, which is the wipe the banner promises has not happened',
    script: () => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key, value) {
        const out = real.call(this, key, value);
        if (String(key).startsWith('mrt.state.salvage')) this.removeItem('mrt.state.v2');
        return out;
      };
    },
  },
  {
    id: 'keep-reader-url',
    breaks: 'manual-book-id',
    why: 'the pasted reader address is written back as the issue url, which is the mislabelled Info link, an entry offering one destination twice under two names',
    script: () => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key, value) {
        if (key !== 'mrt.state.v2') return real.call(this, key, value);
        try {
          const parsed = JSON.parse(value);
          for (const issue of Object.values(parsed?.issues ?? {})) {
            if (issue?.digitalId && !issue.url) issue.url = `https://read.marvel.com/#/book/${issue.digitalId}`;
          }
          return real.call(this, key, JSON.stringify(parsed));
        } catch {
          return real.call(this, key, value);
        }
      };
    },
  },
  {
    id: 'unlink-hint',
    breaks: 'manual-book-id',
    why: 'the address field stops naming its explanation, so the one line saying which of the two addresses yields a working Read button is reachable only by reading past the field',
    script: () => {
      document.addEventListener('DOMContentLoaded', () => {
        document.querySelector('#manual-url')?.removeAttribute('aria-describedby');
      });
    },
  },
  {
    id: 'open-async',
    breaks: 'handoff',
    why: 'the tab is opened after an await, which is the shape constraint 7 says gets popup blocked',
    script: () => {
      const real = window.open.bind(window);
      window.open = (...args) => {
        Promise.resolve().then(() => real(...args));
        return null;
      };
    },
  },
  {
    id: 'wiki-collide',
    breaks: 'wiki-lookup',
    why: 'a second hand entry for an issue already held rewrites it, which is the merge the collision guard exists to refuse',
    script: () => {
      // The guard lives in a module the page cannot reach, and hooking the write cannot reproduce
      // its absence either: a refused add performs no write, so there is nothing to intercept. The
      // first attempt did exactly that and turned nothing red. What is reproduced instead is the
      // hazard's signature, the state carrying the second lookup's facts at the moment the reader
      // is told nothing was added. Keyed on the flag only the wiki scenario sets.
      document.addEventListener('DOMContentLoaded', () => {
        const report = document.querySelector('#manual-report');
        if (!report) return;
        const collide = () => {
          if (window.__mrtWikiAlt !== true) return;
          if (!/nothing was added/.test(report.textContent ?? '')) return;
          try {
            const parsed = JSON.parse(localStorage.getItem('mrt.state.v2') ?? 'null');
            const held = parsed?.issues?.['129648'];
            if (!held) return;
            held.onSale = '2026-07-01';
            held.pageCount = 99;
            held.creators = [{ name: 'Replacement Writer', role: 'writer' }];
            localStorage.setItem('mrt.state.v2', JSON.stringify(parsed));
          } catch {
            // A malformed payload is not this mutation's business to repair.
          }
        };
        new MutationObserver(collide).observe(report, { childList: true, characterData: true, subtree: true });
      });
    },
  },
  {
    id: 'synopsis-attempts',
    breaks: 'synopsis',
    why: 'the running line is rewritten to report attempts rather than answers, which is the miscount this scenario exists to catch',
    script: () => {
      // The counter itself lives in a module the page cannot reach, so the rendered line is
      // rewritten instead. Against a service refusing everything, requests settled is exactly the
      // number refused, so this restores the line the app printed before it learned to subtract.
      // The first mutation aimed here made the service answer instead, which starved the wait and
      // reddened only the catch-all row: it proved the scenario could break, not that any named
      // claim in it could fail.
      document.addEventListener('DOMContentLoaded', () => {
        const status = document.querySelector('#synopsis-status');
        if (!status) return;
        const restate = () => {
          const text = status.textContent ?? '';
          const next = text.replace(/^Fetching synopses 0 of /, `Fetching synopses ${window.__mrtRefused ?? 0} of `);
          // Converges rather than loops: once rewritten the line no longer starts with a zero, so
          // the write this observer makes cannot match its own pattern a second time.
          if (next !== text) status.textContent = next;
        };
        new MutationObserver(restate).observe(status, { childList: true, characterData: true, subtree: true });
        restate();
      });
    },
  },
  {
    id: 'undo-no-dismiss',
    breaks: 'undo-delete-dismiss',
    why: 'the notice carries the undo alone, exactly as it shipped, so the message the reader is left with has no way out of it',
    script: () => {
      // The second control is stripped as it is painted rather than by editing the builder, which
      // the page cannot reach. What is left is byte for byte the notice this item was filed about.
      document.addEventListener('DOMContentLoaded', () => {
        const strip = () => {
          for (const notice of document.querySelectorAll('#app-report .notice')) {
            const buttons = notice.querySelectorAll('button');
            if (buttons.length > 1) buttons[buttons.length - 1].remove();
          }
        };
        new MutationObserver(strip).observe(document.body, { childList: true, subtree: true });
        strip();
      });
    },
  },
  {
    id: 'dismiss-hides-only',
    breaks: 'undo-delete-dismiss',
    why: 'dismissing takes the paragraph off the screen without spending the undo, so the offer is still outstanding and the next screen paints it again',
    script: () => {
      // Capture phase, so the app's own handler never runs whether it was attached as a property
      // or as a listener. This is the tempting shape of the fix: hide the message, keep the buffer.
      // It reads as working until the reader changes screen and the message they closed is back.
      document.addEventListener('click', (e) => {
        const btn = e.target.closest?.('#app-report .notice button');
        if (!btn || btn.textContent.trim() !== 'Dismiss') return;
        e.stopImmediatePropagation();
        e.preventDefault();
        btn.closest('.notice').remove();
      }, true);
    },
  },
  {
    id: 'update-default-newer',
    breaks: 'updates',
    why: 'the default release answer becomes newer, so an unchanged app would start warning every scenario',
    script: () => {
      window.__mrtUpdate = 'newer';
    },
  },
  {
    id: 'update-suppressed',
    breaks: 'updates',
    why: 'the update endpoint keeps reporting the running version, so the newer-release assertion has to notice the missing offer',
    script: () => {
      window.__mrtUpdate = 'current';
    },
  },
  {
    id: 'update-download-wrong',
    breaks: 'updates',
    why: 'the primary action is pointed at the release page instead of the stable zip download',
    script: () => {
      document.addEventListener('DOMContentLoaded', () => {
        const rewrite = () => {
          const target = 'https://github.com/raymond-nassar/recap-page/releases/latest';
          for (const link of document.querySelectorAll('#app-report .notice a')) {
            if (/Download version/.test(link.textContent ?? '')) {
              if (link.href !== target) link.href = target;
            }
          }
        };
        new MutationObserver(rewrite).observe(document.body, { childList: true, subtree: true });
        rewrite();
      });
    },
  },
  {
    id: 'update-notes-missing',
    breaks: 'updates',
    why: 'the secondary release-notes link is removed while the download stays present',
    script: () => {
      document.addEventListener('DOMContentLoaded', () => {
        const remove = () => {
          for (const link of document.querySelectorAll('#app-report .notice a')) {
            if ((link.textContent ?? '').trim() === 'What changed') link.remove();
          }
        };
        new MutationObserver(remove).observe(document.body, { childList: true, subtree: true });
        remove();
      });
    },
  },
  {
    id: 'update-await',
    breaks: 'updates',
    why: 'the boot path waits for the update check, so a hanging release request keeps the app from drawing',
    script: () => {
      document.addEventListener('DOMContentLoaded', () => {
        if (sessionStorage.getItem('mrt.update.stub') !== 'hang') return;
        for (const view of document.querySelectorAll('.view')) view.hidden = true;
      });
    },
    rewriteMain: (source) => source
      .replace('export function boot() {', 'export async function boot() {')
      .replace('  void runAutomaticUpdateCheck();', '  await runAutomaticUpdateCheck();'),
  },
  {
    id: 'modern-timeline-boundary-2000',
    breaks: 'modern-timeline-actual-data',
    why: 'the chosen opening year moves forward, so the intended 1998 chapter disappears',
    rewriteCatalog: (source) => source.replace(
      'export const MODERN_TIMELINE_START_YEAR = 1998;',
      'export const MODERN_TIMELINE_START_YEAR = 2000;',
    ),
  },
  {
    id: 'modern-timeline-static-era-bounds',
    breaks: 'modern-timeline-actual-data',
    why: 'named eras expose their static assignment bounds again, so the visible spine starts decades before its first selected story',
    rewriteCatalog: (source) => source
      .replace(
        /( {4}key: 'marvel-knights',[\s\S]*? {4}from:) 1998,/,
        '$1 1965,',
      )
      .replace(/ {8}\.\.\.\(span && !era\.fallback \? span : \{\}\),\r?\n/, ''),
  },
  {
    id: 'modern-timeline-extra-opening',
    breaks: 'modern-timeline-actual-data',
    why: 'one Marvel Ages event is admitted beside the intended 1998 opening',
    rewriteCatalog: (source) => source.replace(
      '(isModernTimelineChapterId(list.id) && list.timeline >= MODERN_TIMELINE_START_YEAR)',
      "((isModernTimelineChapterId(list.id) || list.id === 'spider-man-identity-crisis') && list.timeline >= MODERN_TIMELINE_START_YEAR)",
    ),
  },
  {
    id: 'modern-timeline-stale-era-heading',
    breaks: 'modern-timeline-actual-data',
    why: 'the first era reverts to the historical heading that no longer describes its cards',
    rewriteCatalog: (source) => source.replace(
      "    heading: 'Marvel Knights to Planet X',",
      "    heading: \"Reed Richards and Sue Storm's Wedding to Eighth Day\",",
    ),
  },
  {
    id: 'modern-timeline-prose-cap',
    breaks: 'modern-timeline-layout',
    why: 'the era description is forced back under the shared prose measure instead of using its box',
    script: () => {
      addEventListener('load', () => {
        const sheet = [...document.styleSheets].find((s) => s.href?.endsWith('styles.css'));
        sheet.insertRule(
          '#view-catalog .shelf-section-blurb { max-width: 64ch !important; }',
          sheet.cssRules.length,
        );
      });
    },
  },
];

// ------------------------------------------------------------------ scenarios

// Every scenario gets its own browser context, so its storage bucket is its own and the order
// they run in cannot matter. A scenario that passed only because the one before it left the right
// state behind is not evidence either.
const SCENARIOS = [
  {
    id: 'shelf-sections',
    title: 'each reading kind has its own browse screen and grouping',
    async run(page, t) {
      await open(page, '/');
      await openBrowseCategory(page, 'timeline');
      await page.waitForSelector('#catalog-results .catalog-card', { timeout: 15000 });

      // Read headings and cards in one pass, in document order, so "which heading is this card under"
      // is answered by the page as painted rather than by re-deriving the rule that painted it.
      const readShelf = (selector) => page.$$eval(`${selector} .shelf-section, ${selector} .catalog-card`, (els) => els.map((e) => (
        e.classList.contains('shelf-section')
          ? {
            kind: 'head',
            level: e.querySelector('h1, h2, h3, h4')?.tagName ?? null,
            heading: e.querySelector('.shelf-section-title')?.textContent.trim() ?? '',
            blurb: e.querySelector('.shelf-section-blurb')?.textContent.trim() ?? '',
          }
          : {
            kind: 'row',
            level: e.querySelector('.catalog-card-title')?.tagName ?? null,
            title: e.querySelector('.catalog-card-title')?.textContent.trim() ?? '',
            step: e.querySelector('.path-step')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
          }
      )));

      const shelf = await readShelf('#catalog-results');
      const heads = shelf.filter((x) => x.kind === 'head');
      const expectedTimelineHeadings = FIXTURE_TIMELINE_SECTIONS.map((section) => section.heading);
      const expectedTimelineHeading = FIXTURE_TIMELINE_SECTIONS[0]?.heading;

      t.check('the Timeline draws the derived eras containing the fixture events',
        heads.map((head) => head.heading).join('/') === expectedTimelineHeadings.join('/'),
        heads.map((h) => h.heading).join(' / '));
      t.check('the era says what its part of the timeline is for', heads[0]?.blurb.length > 40, JSON.stringify(heads[0]?.blurb));

      // The view titles itself with an h1 and every card titles itself with an h3, so h2 is the level
      // that makes the era navigable by heading instead of a skip a screen reader has to guess at.
      t.check('the era is a real heading at the level between the view and its cards',
        heads[0]?.level === 'H2', JSON.stringify(heads[0]?.level));

      // The acceptance criterion, read off the page rather than off the model. A route whose steps
      // straddle a heading is a route the heading is telling the reader not to follow.
      let head = null;
      const mainPathTitles = new Set(['Browser Check Order', 'Second Stop', 'Third Stop']);
      const under = new Map();
      for (const x of shelf) {
        if (x.kind === 'head') head = x.heading;
        else if (x.step && mainPathTitles.has(x.title)) under.set(x.title, head);
      }
      t.check('every stop of the path is on the shelf', under.size === 3, JSON.stringify([...under]));
      t.check('and every one of them sits under the same era',
        [...under.values()].every((h) => h === expectedTimelineHeading), JSON.stringify([...under]));

      const emptyYear = await page.$$eval('.timeline-year-marker.is-empty', (els) => {
        const el = els.find((candidate) => candidate.textContent.includes('2007'));
        const channel = (text) => (text.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const luminance = (text) => {
          const linear = channel(text).map((value) => {
            const srgb = value / 255;
            return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
        };
        const style = getComputedStyle(el);
        const surface = getComputedStyle(document.body);
        const foreground = luminance(style.color);
        const background = luminance(surface.backgroundColor);
        return {
          ariaLabel: el.getAttribute('aria-label'),
          hiddenText: el.querySelector('.visually-hidden')?.textContent ?? null,
          opacity: style.opacity,
          contrast: (Math.max(foreground, background) + 0.05)
            / (Math.min(foreground, background) + 0.05),
        };
      });
      t.check('an empty Timeline year carries its meaning as real assistive text',
        emptyYear.ariaLabel === null && emptyYear.hiddenText === '2007, no Reading Lists',
        JSON.stringify(emptyYear));
      t.check('and its small text keeps normal-text contrast at full opacity',
        emptyYear.opacity === '1' && emptyYear.contrast >= 4.5, JSON.stringify(emptyYear));

      const vertical = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.timeline-year-row:not(.is-empty)')];
        const clearance = (row) => {
          const marker = row.querySelector('.timeline-year-marker');
          const label = row.querySelector('.timeline-year-label');
          const node = getComputedStyle(marker, '::after');
          const border = parseFloat(node.borderLeftWidth) + parseFloat(node.borderRightWidth);
          const width = parseFloat(node.width) + (node.boxSizing === 'border-box' ? 0 : border);
          const nodeLeft = marker.getBoundingClientRect().right - parseFloat(node.right) - width;
          return Math.round((nodeLeft - label.getBoundingClientRect().right) * 10) / 10;
        };
        return {
          flow: Boolean(document.querySelector('.timeline-flow')),
          oldNavigator: Boolean(document.querySelector('#catalog-timeline')),
          sticky: rows.map((row) => getComputedStyle(row.querySelector('.timeline-year-marker')).position),
          clearances: rows.map(clearance),
          groups: rows.map((row) => ({
            year: row.querySelector('.timeline-year-label')?.textContent.trim() ?? '',
            cards: [...row.querySelectorAll('.catalog-card')].map((card) => card.dataset.year),
            heights: [...row.querySelectorAll('.catalog-card')].map((card) => Math.round(card.getBoundingClientRect().height)),
          })),
        };
      });
      t.check('the year spine is part of the result flow rather than a separate navigator',
        vertical.flow && !vertical.oldNavigator, JSON.stringify(vertical));
      t.check('each populated year owns only cards from that year',
        vertical.groups.length > 0
        && vertical.groups.every((group) => group.cards.length > 0 && group.cards.every((year) => year === group.year)),
        JSON.stringify(vertical.groups));
      t.check('cards within each year use one height',
        vertical.groups.every((group) => Math.max(...group.heights) - Math.min(...group.heights) <= 1),
        JSON.stringify(vertical.groups));
      t.check('each year label clears the circle beside it',
        vertical.clearances.every((gap) => gap >= 4), JSON.stringify(vertical.clearances));
      t.check('each populated year stays pinned beside its card group',
        vertical.sticky.every((position) => position === 'sticky'), JSON.stringify(vertical.sticky));

      await page.setViewport({ width: 620, height: 900 });
      await page.waitForFunction(() => matchMedia('(max-width: 700px)').matches);
      const narrowTimeline = await page.$eval('.timeline-year-row:not(.is-empty)', (row) => {
        const marker = row.querySelector('.timeline-year-marker').getBoundingClientRect();
        const cards = row.querySelector('.timeline-year-cards').getBoundingClientRect();
        return {
          markerPosition: getComputedStyle(row.querySelector('.timeline-year-marker')).position,
          markerBottom: Math.round(marker.bottom),
          cardsTop: Math.round(cards.top),
        };
      });
      t.check('a narrow window moves the year above its one-column cards',
        narrowTimeline.markerPosition === 'relative'
        && narrowTimeline.markerBottom <= narrowTimeline.cardsTop,
        JSON.stringify(narrowTimeline));
      await page.setViewport({ width: 1280, height: 900 });

      await openBrowseCategory(page, 'storylines');
      await page.waitForSelector('#lines-results .catalog-card', { timeout: 15000 });
      const lines = await readShelf('#lines-results');
      const expectedStorylineHeadings = FIXTURE_STORYLINE_SECTIONS.map(({ heading }) => heading);
      const expectedStorylineTitles = FIXTURE_STORYLINE_SECTIONS.flatMap(
        ({ stories }) => stories.map((story) => story.name ?? story.lists[0].name),
      );
      t.check('Storylines holds every whole-line reading under its derived decade',
        JSON.stringify(lines.filter((x) => x.kind === 'head').map((x) => x.heading))
          === JSON.stringify(expectedStorylineHeadings)
        && JSON.stringify(lines.filter((x) => x.kind === 'row').map((x) => x.title))
          === JSON.stringify(expectedStorylineTitles),
        JSON.stringify(lines));

      await openBrowseCategory(page, 'character-spotlights');
      await page.waitForSelector('#spotlights-results .catalog-card', { timeout: 15000 });
      const spotlights = await readShelf('#spotlights-results');
      t.check('Character spotlights holds every character story without a redundant group heading',
        spotlights.filter((x) => x.kind === 'head').length === 0
        && spotlights.filter((x) => x.kind === 'row').length === 13
        && spotlights.some((x) => x.kind === 'row' && x.title === 'Off The Path'),
        JSON.stringify(spotlights));
      t.check('spotlight cards sit directly under the view heading',
        spotlights.filter((x) => x.kind === 'row').every((x) => x.level === 'H2'),
        JSON.stringify(spotlights));
    },
  },
  {
    id: 'spotlight-filter',
    title: 'Character Spotlight subsets stay explicit, local, accessible, and responsive',
    async run(page, t) {
      await open(page, '/');
      await click(page, '[data-view="spotlights"]');
      await page.waitForFunction(() => document.querySelectorAll('#spotlights-results .catalog-card').length === 13);

      const cardTitles = () => page.$$eval(
        '#spotlights-results .catalog-card-title',
        (nodes) => nodes.map((node) => node.textContent.trim()),
      );
      const chooseKind = async (value) => {
        await click(page, `input[name="spotlights-kind"][value="${value}"]`);
        await page.waitForFunction(
          (expected) => (
            document.querySelector('input[name="spotlights-kind"]:checked')?.value === expected
            && !document.querySelector('#spotlights-results')?.textContent.includes('Loading the catalog')
          ),
          {},
          value,
        );
      };
      const chooseSort = async (value) => {
        await click(page, `input[name="spotlights-sort"][value="${value}"]`);
        await page.waitForFunction(
          (expected) => (
            document.querySelector('input[name="spotlights-sort"]:checked')?.value === expected
           && !document.querySelector('#spotlights-results')?.textContent.includes('Loading the catalog')
          ),
          {},
          value,
        );
      };

      const currentTitles = [
        'Off The Path',
        'Essential Avengers',
        'X-Men',
        'Phoenix',
        'Captain America',
        'Spider-Man',
        'Thor',
        'Scarlet Witch',
        'White Tiger',
        'Phalanx',
        'Other Spotlight 1',
        'Other Spotlight 2',
        'Other Spotlight 3',
      ];
      const popularityTitles = [
        'Spider-Man',
        'Captain America',
        'Thor',
        'Scarlet Witch',
        'Phoenix',
        'Essential Avengers',
        'X-Men',
        'Off The Path',
        'White Tiger',
        'Phalanx',
        'Other Spotlight 1',
        'Other Spotlight 2',
        'Other Spotlight 3',
      ];

      const initial = await page.evaluate(() => ({
        kindLabels: [...document.querySelectorAll('input[name="spotlights-kind"]')]
          .map((input) => input.nextElementSibling.textContent.trim()),
        kindChecked: document.querySelector('input[name="spotlights-kind"]:checked')?.value ?? null,
        kindLegend: document.querySelector('.spotlight-filters legend')?.textContent.trim() ?? null,
        sortLabels: [...document.querySelectorAll('input[name="spotlights-sort"]')]
          .map((input) => input.nextElementSibling.textContent.trim()),
        sortChecked: document.querySelector('input[name="spotlights-sort"]:checked')?.value ?? null,
        sortLegend: document.querySelector('.spotlight-sort legend')?.textContent.trim() ?? null,
      }));
      t.check('the header exposes the popularity sort and the three requested choices with Current order selected',
        initial.kindLabels.join('/') === 'All/Best of/Complete guides'
       && initial.kindChecked === 'all'
       && initial.kindLegend === 'Filter Character Spotlight guides'
       && initial.sortLabels.join('/') === 'Current order/Popularity'
       && initial.sortChecked === 'current-order'
       && initial.sortLegend === 'Sort Character Spotlight guides',
        JSON.stringify(initial));
      t.check('Current order keeps the fixture stories in their shipped order',
        JSON.stringify(await cardTitles()) === JSON.stringify(currentTitles),
        JSON.stringify(await cardTitles()));

      await chooseSort('popularity');
      await page.waitForFunction(() => /Sorted by popularity\./.test(
        document.querySelector('#announcer')?.textContent ?? '',
      ));
      const popular = await cardTitles();
      const hashAfterPopularity = await page.evaluate(() => location.hash);
      const reportAfterPopularity = await page.$eval('#announcer', (node) => node.textContent.trim());
      t.check('Popularity ranks the matching stories first and preserves the unranked tail',
        JSON.stringify(popular) === JSON.stringify(popularityTitles),
        JSON.stringify(popular));
      t.check('Popularity writes the sort into the address and announces it',
        hashAfterPopularity.includes('sort=popularity') && /Sorted by popularity\./.test(reportAfterPopularity),
        JSON.stringify({ hashAfterPopularity, reportAfterPopularity }));

      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => (
        document.querySelector('input[name="spotlights-sort"]:checked')?.value === 'popularity'
       && !document.querySelector('#spotlights-results')?.textContent.includes('Loading the catalog')
      ));
      t.check('Reload keeps the popularity sort and its URL',
        await page.evaluate(() => location.hash) === hashAfterPopularity
       && await page.$eval('input[name="spotlights-sort"]:checked', (input) => input.value) === 'popularity'
       && JSON.stringify(await cardTitles()) === JSON.stringify(popularityTitles),
        JSON.stringify({ hash: await page.evaluate(() => location.hash), titles: await cardTitles() }));

      await chooseSort('current-order');
      const currentHash = await page.evaluate(() => location.hash);
      t.check('returning to Current order restores the shipped order and clears the sort from the URL',
        !currentHash.includes('sort=') && JSON.stringify(await cardTitles()) === JSON.stringify(currentTitles),
        JSON.stringify({ hash: currentHash, titles: await cardTitles() }));

      await page.goBack({ waitUntil: 'load' }).catch(() => {});
      await page.waitForFunction(() => (
        document.querySelector('input[name="spotlights-sort"]:checked')?.value === 'popularity'
       && !document.querySelector('#spotlights-results')?.textContent.includes('Loading the catalog')
      )).catch(() => {});
      t.check('Back returns to the popularity sort',
        await page.evaluate(() => location.hash) === hashAfterPopularity
       && await page.$eval('input[name="spotlights-sort"]:checked', (input) => input.value) === 'popularity',
        JSON.stringify({ hash: await page.evaluate(() => location.hash), checked: await page.$eval('input[name="spotlights-sort"]:checked', (input) => input.value) }));

      await chooseKind('best-of');
      await page.$eval('#spotlights-q', (input) => {
        input.value = 'Phoenix';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForFunction(() => document.querySelectorAll('#spotlights-results .catalog-card').length === 1);
      t.check('search composes with the selected subset',
        (await cardTitles()).join('/') === 'Phoenix'
       && await page.$eval('input[name="spotlights-kind"]:checked', (input) => input.value) === 'best-of'
       && await page.$eval('input[name="spotlights-sort"]:checked', (input) => input.value) === 'popularity',
        JSON.stringify(await cardTitles()));
      await click(page, '#spotlights-clear');
      await page.waitForFunction(() => (
        !document.querySelector('#spotlights-results')?.textContent.includes('Loading the catalog')
      ));
      t.check('clearing search restores the selected Best of subset',
        (await cardTitles()).length === 5, JSON.stringify(await cardTitles()));

      await chooseKind('all');
      await page.focus('input[name="spotlights-kind"][value="all"]');
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => (
        document.querySelector('input[name="spotlights-kind"]:checked')?.value === 'best-of'
       && !document.querySelector('#spotlights-results')?.textContent.includes('Loading the catalog')
      ));
      const keyboard = await page.evaluate(() => ({
        checked: document.querySelector('input[name="spotlights-kind"]:checked')?.value ?? null,
        focused: document.activeElement?.value ?? null,
        cards: document.querySelectorAll('#spotlights-results .catalog-card').length,
      }));
      t.check('native arrow-key selection renders Best of and keeps focus on the selected radio',
        keyboard.checked === 'best-of' && keyboard.focused === 'best-of' && keyboard.cards === 5,
        JSON.stringify(keyboard));

      await chooseKind('complete-guide');
      const client = await page.createCDPSession();
      await client.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'forced-colors', value: 'active' }],
      });
      const forced = await page.$eval('input[name="spotlights-kind"]:checked + span', (span) => {
        const sample = document.createElement('span');
        sample.style.color = 'Highlight';
        document.body.append(sample);
        const style = getComputedStyle(span);
        const highlight = getComputedStyle(sample).color;
        sample.remove();
        return {
          active: matchMedia('(forced-colors: active)').matches,
          borderWidth: style.borderLeftWidth,
          borderColor: style.borderLeftColor,
          highlight,
        };
      });
      t.check('forced colors keeps the checked radio marked by a Highlight border',
        forced.active && forced.borderWidth === '2px' && forced.borderColor === forced.highlight,
        JSON.stringify(forced));
      await client.send('Emulation.setEmulatedMedia', { features: [] });
      const restored = await page.$eval('input[name="spotlights-kind"]:checked + span', (span) => ({
        active: matchMedia('(forced-colors: active)').matches,
        borderWidth: getComputedStyle(span).borderLeftWidth,
      }));
      t.check('normal media styling returns after forced colors is restored',
        !restored.active && restored.borderWidth === '1px',
        JSON.stringify(restored));

      await openBrowseCategory(page, 'storylines');
      await page.waitForSelector('#lines-results .catalog-card', { timeout: 15000 });
      await click(page, '[data-view="spotlights"]');
      await page.waitForFunction(() => (
        document.querySelector('input[name="spotlights-kind"]:checked')?.value === 'complete-guide'
        && document.querySelector('input[name="spotlights-sort"]:checked')?.value === 'popularity'
        && !document.querySelector('#spotlights-results')?.textContent.includes('Loading the catalog')
      ));
      t.check('ordinary shelf navigation preserves Complete guides and popularity sort',
        await page.$eval('input[name="spotlights-kind"]:checked', (input) => input.value) === 'complete-guide'
        && await page.$eval('input[name="spotlights-sort"]:checked', (input) => input.value) === 'popularity'
        && (await page.evaluate(() => location.hash)).includes('sort=popularity'));

      await openBrowseCategory(page, 'storylines');
      await page.waitForSelector('#lines-results .catalog-card', { timeout: 15000 });
      await page.evaluate(() => {
        const card = [...document.querySelectorAll('#lines-results .catalog-card')]
          .find((node) => node.querySelector('.catalog-card-title')?.textContent.trim() === 'Across the Line');
        const link = [...card.querySelectorAll('.path-step a')]
          .find((node) => node.textContent.trim() === 'Essential Avengers');
        link.click();
      });
      await page.waitForFunction(() => (
        !document.querySelector('#view-spotlights').hidden
        && document.querySelector('input[name="spotlights-kind"]:checked')?.value === 'all'
        && document.querySelector('input[name="spotlights-sort"]:checked')?.value === 'popularity'
        && [...document.querySelectorAll('#spotlights-results .catalog-card-title')]
          .some((node) => node.textContent.trim() === 'Essential Avengers')
        && location.hash.includes('sort=popularity')
      ));
      t.check('path arrival resets All but keeps the popularity sort', true);

      await page.setViewport({ width: 360, height: 800 });
      await page.waitForFunction(() => matchMedia('(max-width: 620px)').matches);
      const narrow = await page.evaluate(() => {
        const heading = document.querySelector('#spotlights-h').getBoundingClientRect();
        const controls = document.querySelector('.spotlight-controls').getBoundingClientRect();
        const labels = [...document.querySelectorAll('.spotlight-controls label')]
          .map((label) => label.getBoundingClientRect());
        return {
          viewport: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          controlsTop: Math.round(controls.top),
          headingBottom: Math.round(heading.bottom),
          labelsVisible: labels.every((rect) => rect.left >= 0 && rect.right <= innerWidth),
        };
      });
      t.check('the spotlight controls wrap below the heading at 360 by 800 without horizontal overflow',
        narrow.scrollWidth <= narrow.viewport
        && narrow.controlsTop >= narrow.headingBottom
        && narrow.labelsVisible,
        JSON.stringify(narrow));
    },
  },
  {
    id: 'breadcrumb-navigation',
    title: 'routed pages show one truthful, usable breadcrumb trail',
    async run(page, t) {
      const trail = () => page.evaluate(() => {
        const visible = [...document.querySelectorAll('.view')].filter((node) => !node.hidden);
        const breadcrumbs = visible.flatMap((node) => [...node.querySelectorAll(':scope > .breadcrumb')]);
        const breadcrumb = breadcrumbs[0] ?? null;
        return {
          visible: visible.map((node) => node.id),
          count: breadcrumbs.length,
          labels: breadcrumb
            ? [...breadcrumb.querySelectorAll('li')].map((node) => node.textContent.trim())
            : [],
          ancestors: breadcrumb
            ? [...breadcrumb.querySelectorAll('li:not(:last-child) > *')].map((node) => ({
              tag: node.tagName,
              href: node.getAttribute('href'),
            }))
            : [],
          current: breadcrumb?.querySelector('li:last-child > *')
            ? {
              tag: breadcrumb.querySelector('li:last-child > *').tagName,
              ariaCurrent: breadcrumb.querySelector('li:last-child > *').getAttribute('aria-current'),
              href: breadcrumb.querySelector('li:last-child > *').getAttribute('href'),
            }
            : null,
          dialogBreadcrumbs: document.querySelectorAll('dialog .breadcrumb').length,
        };
      });
      const visit = async (route, labels) => {
        await page.evaluate((hash) => { location.hash = hash; }, `#/${route}`);
        await page.waitForFunction(
          (view, expected) => {
            const panel = document.querySelector(`#view-${view}`);
            const actual = [...(panel?.querySelectorAll(':scope > .breadcrumb li') ?? [])]
              .map((node) => node.textContent.trim());
            return panel?.hidden === false && JSON.stringify(actual) === JSON.stringify(expected);
          },
          {},
          route,
          labels,
        );
        const actual = await trail();
        const semantic = actual.count === 1
          && actual.labels.join('/') === labels.join('/')
          && actual.ancestors.every(({ tag, href }) => tag === 'A' && href?.startsWith('#/'))
          && actual.current?.tag === 'SPAN'
          && actual.current.ariaCurrent === 'page'
          && actual.current.href === null
          && actual.dialogBreadcrumbs === 0;
        t.check(`${route} has its intended semantic hierarchy`, semantic, JSON.stringify(actual));
      };

      await open(page, '/');
      await page.waitForSelector('#view-home:not([hidden])', { timeout: 15000 });
      const home = await trail();
      t.check('Home has no breadcrumb trail', home.count === 0, JSON.stringify(home));

      await click(page, '#btn-rail-toggle');
      await page.focus('.ri[data-view="add"]');
      await page.waitForSelector('#rail-tip:not([hidden])');
      const addButton = await page.$('.ri[data-view="add"]');
      const addAccessible = await page.accessibility.snapshot({ root: addButton });
      const addNaming = await page.evaluate(() => ({
        label: document.querySelector('.ri[data-view="add"] .lbl')?.textContent.trim(),
        tip: document.querySelector('#rail-tip')?.textContent.trim(),
        heading: document.querySelector('#add-h')?.textContent.trim(),
      }));
      t.check('the collapsed destination, tooltip, accessible name and hub all say Add comics',
        addNaming.label === 'Add comics'
        && addNaming.tip === 'Add comics'
        && addNaming.heading === 'Add comics'
        && addAccessible?.name === 'Add comics',
        JSON.stringify({ ...addNaming, accessible: addAccessible?.name }));
      await addButton.dispose();

      const routes = [
        ['library', ['Home', 'Library']],
        ['progress', ['Home', 'Library', 'Progress by series']],
        ['library-read', ['Home', 'Library', 'Everything read']],
        ['library-manual', ['Home', 'Library', 'Added by hand']],
        ['browse', ['Home', 'Browse']],
        ['catalog', ['Home', 'Browse', 'Modern Timeline']],
        ['lines', ['Home', 'Browse', 'Storylines']],
        ['spotlights', ['Home', 'Browse', 'Character spotlights']],
        ['marvel-on-screen', ['Home', 'Browse', 'MCU Prep']],
        ['marvel-ages', ['Home', 'Browse', 'Marvel Ages']],
        ['age-golden', ['Home', 'Browse', 'Marvel Ages', 'Golden Age']],
        ['age-silver', ['Home', 'Browse', 'Marvel Ages', 'Silver Age']],
        ['age-bronze', ['Home', 'Browse', 'Marvel Ages', 'Bronze Age']],
        ['age-copper', ['Home', 'Browse', 'Marvel Ages', 'Copper Age']],
        ['age-modern', ['Home', 'Browse', 'Marvel Ages', 'Modern Age']],
        ['age-early-modern', ['Home', 'Browse', 'Marvel Ages', 'Modern Age', 'Early Modern']],
        ['age-marvel-knights-heroes-return', ['Home', 'Browse', 'Marvel Ages', 'Modern Age', 'Marvel Knights / Heroes Return']],
        ['age-event-era', ['Home', 'Browse', 'Marvel Ages', 'Modern Age', 'Event Era']],
        ['age-marvel-now', ['Home', 'Browse', 'Marvel Ages', 'Modern Age', 'Marvel NOW!']],
        ['age-all-new-all-different', ['Home', 'Browse', 'Marvel Ages', 'Modern Age', 'All-New All-Different']],
        ['age-fresh-start', ['Home', 'Browse', 'Marvel Ages', 'Modern Age', 'Fresh Start']],
        ['age-current', ['Home', 'Browse', 'Marvel Ages', 'Modern Age', 'Current era']],
        ['add', ['Home', 'Add comics']],
        ['add-series', ['Home', 'Add comics', 'Find a series']],
        ['add-creator', ['Home', 'Add comics', 'Browse a creator']],
        ['add-import', ['Home', 'Add comics', 'Paste a Reading List']],
        ['add-manual', ['Home', 'Add comics', 'Add an issue by hand']],
        ['data', ['Home', 'Backup & settings']],
        ['about', ['Home', 'About this app']],
        ['add-search', ['Home', 'Add comics', 'Search issues']],
      ];
      for (const [route, labels] of routes) await visit(route, labels);

      await page.focus('#view-add-search .breadcrumb a[href="#/add"]');
      const focusedLink = await page.$eval(
        '#view-add-search .breadcrumb a[href="#/add"]',
        (link) => ({
          active: document.activeElement === link,
          outline: getComputedStyle(link).outlineStyle,
          outlineWidth: Number.parseFloat(getComputedStyle(link).outlineWidth),
        }),
      );
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => location.hash === '#/add' && document.activeElement?.id === 'add-h');
      t.check('a focused ancestor has a visible ring and keyboard activation focuses the destination heading',
        focusedLink.active && focusedLink.outline !== 'none' && focusedLink.outlineWidth >= 3,
        JSON.stringify(focusedLink));

      await visit('data', ['Home', 'Backup & settings']);
      await visit('about', ['Home', 'About this app']);
      await page.evaluate(() => history.back());
      await page.waitForFunction(() => location.hash === '#/data' && document.activeElement?.id === 'data-h');
      const backTrail = await trail();
      await page.evaluate(() => history.forward());
      await page.waitForFunction(() => location.hash === '#/about' && document.activeElement?.id === 'about-h');
      const forwardTrail = await trail();
      t.check('Back and Forward repaint the hierarchy and destination focus',
        backTrail.labels.join('/') === 'Home/Backup & settings'
        && forwardTrail.labels.join('/') === 'Home/About this app',
        JSON.stringify({ back: backTrail.labels, forward: forwardTrail.labels }));

      await open(page, '/#/about');
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#view-about:not([hidden]) > .breadcrumb');
      const directAbout = await trail();
      await open(page, '/#/age-current');
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#view-age-current:not([hidden]) > .breadcrumb');
      const directAge = await trail();
      t.check('direct loads derive the same route hierarchy',
        directAbout.labels.join('/') === 'Home/About this app'
        && directAge.labels.join('/') === 'Home/Browse/Marvel Ages/Modern Age/Current era',
        JSON.stringify({ about: directAbout.labels, age: directAge.labels }));

      await importOrder(page);
      const dynamic = await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
        return {
          id: state.active,
          name: 'AReadingListNameWithoutSpacesThatMustWrapSafelyAcrossNarrowBreadcrumbLayouts',
        };
      });
      await click(page, '#btn-rename-list');
      await page.waitForSelector('#ask[open] #ask-input');
      await page.$eval('#ask-input', (input, name) => { input.value = name; }, dynamic.name);
      await click(page, '#ask-ok');
      await page.waitForFunction(
        (name) => document.querySelector('#view-read .breadcrumb [aria-current="page"]')?.textContent.trim() === name,
        {},
        dynamic.name,
      );
      const encodedList = encodeURIComponent(dynamic.id);
      await open(page, `/#/read/${encodedList}`);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#view-read .breadcrumb [aria-current="page"]', { timeout: 15000 });
      const savedTrail = await trail();
      t.check('a saved Reading List uses its validated current name',
        savedTrail.labels.join('/') === `Home/Library/${dynamic.name}`,
        JSON.stringify(savedTrail));

      await open(page, `/#/issue/900001?list=${encodedList}`);
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() =>
        document.querySelector('#view-issue .breadcrumb [aria-current="page"]')?.textContent.trim()
          === 'Browser Check (2026) #1');
      const listIssue = await trail();
      t.check('a saved-list issue stays under Library and its saved list',
        listIssue.labels.join('/') === `Home/Library/${dynamic.name}/Browser Check (2026) #1`,
        JSON.stringify(listIssue));

      await open(page, '/#/issue/900001?order=browser-check');
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() =>
        document.querySelector('#view-issue .breadcrumb [aria-current="page"]')?.textContent.trim()
          === 'Browser Check (2026) #1');
      const orderIssue = await trail();
      t.check('a bundled issue uses the canonical Browse shelf rather than Preview',
        orderIssue.labels.join('/') === 'Home/Browse/Modern Timeline/Browser Check (2026) #1',
        JSON.stringify(orderIssue));

      await open(page, '/#/issue/900001?list=missing');
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() =>
        location.hash === '#/issue/900001'
        && document.querySelector('#view-issue .breadcrumb [aria-current="page"]')?.textContent.trim()
          === 'Browser Check (2026) #1');
      const staleIssue = await trail();
      await open(page, '/#/issue/900001');
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() =>
        document.querySelector('#view-issue .breadcrumb [aria-current="page"]')?.textContent.trim()
          === 'Browser Check (2026) #1');
      const unscopedIssue = await trail();
      t.check('stale and unscoped issue routes fall back to truthful issue-only trails',
        staleIssue.labels.join('/') === 'Home/Browser Check (2026) #1'
        && unscopedIssue.labels.join('/') === 'Home/Browser Check (2026) #1',
        JSON.stringify({ stale: staleIssue.labels, unscoped: unscopedIssue.labels }));

      await open(page, '/#/catalog');
      await page.waitForSelector('#catalog-results [data-act="preview"]', { timeout: 15000 });
      await click(page, '#catalog-results [data-act="preview"]');
      await page.waitForSelector('#preview[open]');
      const previewCrumbs = await page.$$eval('#preview .breadcrumb', (nodes) => nodes.length);
      t.check('Preview remains a modal dialog with no breadcrumb trail', previewCrumbs === 0, previewCrumbs);
      await click(page, '#preview-close');

      await open(page, '/#/library');
      await click(page, '#btn-new-list');
      await page.waitForSelector('#ask[open]');
      const askCrumbs = await page.$$eval('#ask .breadcrumb', (nodes) => nodes.length);
      t.check('Ask remains a modal dialog with no breadcrumb trail', askCrumbs === 0, askCrumbs);
      await click(page, '#ask-cancel');

      const responsive = async (width) => {
        await page.setViewport({ width, height: 900 });
        await open(page, `/#/read/${encodedList}`);
        await page.waitForSelector('#view-read .breadcrumb [aria-current="page"]', { timeout: 15000 });
        await page.evaluate(() => {
          document.querySelector('#full').open = false;
          return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        return page.$eval('#view-read .breadcrumb', (breadcrumb) => ({
          viewport: innerWidth,
          pageScroll: document.documentElement.scrollWidth,
          pageClient: document.documentElement.clientWidth,
          breadcrumbScroll: breadcrumb.scrollWidth,
          breadcrumbClient: breadcrumb.clientWidth,
          currentScroll: breadcrumb.querySelector('[aria-current="page"]').scrollWidth,
          currentClient: breadcrumb.querySelector('[aria-current="page"]').clientWidth,
        }));
      };
      const width390 = await responsive(390);
      const width320 = await responsive(320);
      t.check('long trails wrap at 390 and 320 CSS pixels without page-level overflow',
        [width390, width320].every((size) =>
          size.pageScroll <= size.pageClient
          && size.breadcrumbScroll <= size.breadcrumbClient
          && size.currentScroll <= size.currentClient),
        JSON.stringify({ width390, width320 }));

      const client = await page.createCDPSession();
      await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
      const zoom = await page.$eval('#view-read .breadcrumb', (breadcrumb) => ({
        scale: visualViewport.scale,
        pageScroll: document.documentElement.scrollWidth,
        pageClient: document.documentElement.clientWidth,
        breadcrumbScroll: breadcrumb.scrollWidth,
        breadcrumbClient: breadcrumb.clientWidth,
      }));
      t.check('the wrapped trail has no horizontal overflow at 200 percent zoom',
        zoom.scale === 2
        && zoom.pageScroll <= zoom.pageClient
        && zoom.breadcrumbScroll <= zoom.breadcrumbClient,
        JSON.stringify(zoom));
      await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });

      await client.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'forced-colors', value: 'active' }],
      });
      const forced = await page.$eval('#view-read .breadcrumb', (breadcrumb) => {
        const link = getComputedStyle(breadcrumb.querySelector('a'));
        const current = getComputedStyle(breadcrumb.querySelector('[aria-current="page"]'));
        return {
          active: matchMedia('(forced-colors: active)').matches,
          linkColor: link.color,
          currentColor: current.color,
          linkDecoration: link.textDecorationLine,
          currentDecoration: current.textDecorationLine,
          currentWeight: current.fontWeight,
        };
      });
      t.check('forced colors keeps ancestor links distinct from the current item',
        forced.active
        && forced.linkColor !== forced.currentColor
        && forced.linkDecoration.includes('underline')
        && !forced.currentDecoration.includes('underline'),
        JSON.stringify(forced));
      await client.send('Emulation.setEmulatedMedia', { features: [] });
    },
  },
  {
    id: 'home-category-gateway',
    title: 'Home offers concise reading paths that scale to more categories',
    async run(page, t) {
      await open(page, '/');
      await page.waitForSelector('#home-primary-paths .home-path', { timeout: 15000 });
      const settleLayout = () => page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));

      await page.setViewport({ width: 1280, height: 900 });
      await settleLayout();
      const context = await page.evaluate(() => {
        const paths = [...document.querySelectorAll('#home-primary-paths .home-path')];
        const secondary = [...document.querySelectorAll('#home-secondary-paths .home-path')];
        const boxes = paths.map((path) => path.getBoundingClientRect());
        return {
          heading: document.querySelector('#home-h')?.textContent.trim() ?? null,
          sectionHeadings: [
            document.querySelector('#home-cat-h')?.textContent.trim() ?? null,
            document.querySelector('#home-more-h')?.textContent.trim() ?? null,
          ],
          explanatoryLines: document.querySelectorAll('#view-home > .head .sub').length,
          paths: paths.map((path) => ({
            key: path.dataset.category,
            label: path.querySelector('.home-path-label')?.textContent.trim(),
            title: path.querySelector('.home-path-title')?.textContent.trim(),
            count: path.querySelector('.home-path-count')?.textContent.trim(),
          })),
          secondary: secondary.map((path) => ({
            key: path.dataset.category,
            label: path.querySelector('.home-path-label')?.textContent.trim(),
            title: path.querySelector('.home-path-title')?.textContent.trim(),
            count: path.querySelector('.home-path-count')?.textContent.trim(),
          })),
          tops: boxes.map((box) => Math.round(box.top)),
          heights: boxes.map((box) => Math.round(box.height)),
          secondaryHeights: secondary.map((path) => Math.round(path.getBoundingClientRect().height)),
          paragraphs: document.querySelectorAll('.home-path p').length,
          retired: document.querySelectorAll('#home-featured, #home-grid, #home-chips, #form-home-q').length,
          moreHidden: document.querySelector('#home-more-paths')?.hidden,
          statuses: [...document.querySelectorAll('[data-paths-status]')].map((status) => ({
            role: status.getAttribute('role'),
            hidden: status.hidden,
            visuallyHidden: status.classList.contains('visually-hidden'),
            text: status.textContent.trim(),
          })),
        };
      });
      t.check('the first-run heading is the stable app masthead without an explanatory line',
        context.heading === 'RECAP PAGE!' && context.explanatoryLines === 0,
        JSON.stringify(context));
      t.check('the discovery tiers use concise action headings',
        JSON.stringify(context.sectionHeadings) === JSON.stringify(['Explore', 'Discover More']),
        JSON.stringify(context.sectionHeadings));
      t.check('the three current paths carry compact labels and content counts',
        JSON.stringify(context.paths) === JSON.stringify([
          { key: 'timeline', label: 'Browse by year', title: 'Modern Timeline', count: '14 Reading Lists' },
          { key: 'storylines', label: 'Browse complete arcs', title: 'Storylines', count: '8 Reading Lists' },
          { key: 'character-spotlights', label: 'Browse heroes and teams', title: 'Character spotlights', count: '14 Reading Lists' },
        ]),
        JSON.stringify(context.paths));
      t.check('the shared Marvel Ages gateway replaces peer age tiles',
        JSON.stringify(context.secondary) === JSON.stringify([
          {
            key: 'marvel-on-screen',
            label: 'Movies and streaming',
            title: 'MCU Prep',
            count: '5 Reading Lists',
          },
          {
            key: 'marvel-ages',
            label: 'Publication history',
            title: 'Marvel Ages',
            count: '16 Reading Lists',
          },
        ]),
        JSON.stringify(context.secondary));
      t.check('the primary paths remain equal choices on one desktop row',
        context.tops.length === 3
        && new Set(context.tops).size === 1
        && Math.max(...context.heights) - Math.min(...context.heights) <= 1,
        JSON.stringify({ tops: context.tops, heights: context.heights }));
      t.check('the secondary paths remain equal height when labels wrap',
        context.secondaryHeights.length > 1
        && Math.max(...context.secondaryHeights) - Math.min(...context.secondaryHeights) <= 1,
        JSON.stringify(context.secondaryHeights));
      t.check('the gateway has no standing tile paragraphs or retired catalog wall',
        context.paragraphs === 0 && context.retired === 0 && context.moreHidden === false,
        JSON.stringify(context));
      t.check('dynamic Home and Browse categories publish one concise polite completion status each',
        context.statuses.length === 2
        && context.statuses.every(({ role, hidden, visuallyHidden, text }) =>
          role === 'status' && !hidden && visuallyHidden
          && text === '5 ways to read available.'),
        JSON.stringify(context.statuses));

      for (const [category, view] of [
        ['timeline', 'catalog'],
        ['storylines', 'lines'],
        ['character-spotlights', 'spotlights'],
      ]) {
        await click(page, `[data-category="${category}"]`);
        await page.waitForFunction((id) => document.querySelector(`#view-${id}`)?.hidden === false, {}, view);
        const destination = await page.evaluate(() => location.hash);
        t.check(`${category} opens its browse screen`, destination === `#/${view}`, destination);
        await open(page, '/');
        await page.waitForSelector('#home-primary-paths .home-path', { timeout: 15000 });
      }

      await click(page, '[data-category="marvel-on-screen"]');
      await page.waitForSelector('#marvel-on-screen-results .catalog-card', { timeout: 15000 });
      const screen = await page.evaluate(() => ({
        hash: location.hash,
        focus: document.activeElement?.id ?? null,
        rail: document.querySelector('.ri[aria-current="page"]')?.dataset.view ?? null,
        count: document.querySelector('#marvel-on-screen-count')?.textContent.trim() ?? null,
        timeline: Boolean(document.querySelector('#marvel-on-screen-results .timeline-flow')),
        titles: [...document.querySelectorAll('#marvel-on-screen-results .catalog-card-title')]
          .map((title) => title.textContent.trim()),
      }));
      t.check('MCU Prep opens its own browse page with five companions in source order',
        screen.hash === '#/marvel-on-screen'
        && screen.focus === 'marvel-on-screen-h'
        && screen.rail === 'browse'
        && screen.count === '5 Reading Lists'
        && screen.titles.join('/') === [
          'Doctor Strange: Multiverse of Madness',
          'Spider-Man: No Way Home',
          'Marvel Multiverse',
          'Marvel What If?',
          'Spider-Man: Far From Home',
        ].join('/'),
        JSON.stringify(screen));
      t.check('MCU Prep stays outside publication-age chronology',
        screen.timeline === false, JSON.stringify(screen));

      await page.setViewport({ width: 390, height: 844 });
      await settleLayout();
      const screenNarrow = await page.$eval('#marvel-on-screen-results', (results) => {
        const cards = [...results.querySelectorAll('.catalog-card')];
        return {
          viewport: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          cards: cards.length,
          columns: new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left))).size,
        };
      });
      t.check('the narrow MCU Prep page keeps five cards in one column without overflow',
        screenNarrow.cards === 5
        && screenNarrow.columns === 1
        && screenNarrow.scrollWidth <= screenNarrow.viewport,
        JSON.stringify(screenNarrow));

      await open(page, '/');
      await page.waitForSelector('#home-primary-paths .home-path', { timeout: 15000 });
      await page.setViewport({ width: 620, height: 900 });
      await settleLayout();
      const narrow = await page.$$eval('#home-primary-paths .home-path', (paths) => paths.map((path) => {
        const box = path.getBoundingClientRect();
        return { top: Math.round(box.top), width: Math.round(box.width) };
      }));
      t.check('a narrow window stacks full-width paths without horizontal clipping',
        narrow.length === 3
        && new Set(narrow.map(({ top }) => top)).size === 3
        && narrow.every(({ width }) => width > 400 && width < 620),
        JSON.stringify(narrow));
    },
  },
  {
    id: 'home-first-run-wayfinding',
    title: 'empty Home makes the first useful reading path obvious',
    async run(page, t) {
      await open(page, '/');
      await page.waitForSelector('#home-first-run:not([hidden]) #btn-home-recommended', { timeout: 15000 });
      const initial = await page.evaluate(() => ({
        question: document.querySelector('#home-first-run-h')?.textContent.trim() ?? null,
        distinction: document.querySelector('.home-first-run-copy')?.textContent.trim() ?? null,
        recommendation: document.querySelector('#home-recommended-h')?.textContent.trim() ?? null,
        recommendationHidden: document.querySelector('#home-recommended')?.hidden ?? null,
      }));
      t.check('clean Home asks one visible question and distinguishes curated Browse from Add',
        initial.question === 'Where do you want to start?'
        && initial.distinction === 'Browse curated Reading Lists. Add individual issues or your own list.'
        && initial.recommendation === 'Recommended start: Setup to Modern Timeline'
        && initial.recommendationHidden === false,
        JSON.stringify(initial));

      await page.setViewport({ width: 320, height: 900 });
      const narrow = await page.evaluate(() => {
        const region = document.querySelector('#home-first-run');
        const regionRect = region.getBoundingClientRect();
        const controls = [...document.querySelectorAll('#home-first-run button')].map(
          (button) => button.getBoundingClientRect(),
        );
        return {
          viewport: innerWidth,
          regionLeft: Math.round(regionRect.left),
          regionRight: Math.round(regionRect.right),
          regionWidth: region.clientWidth,
          regionScrollWidth: region.scrollWidth,
          visible: controls.every((rect) => rect.left >= 0 && rect.right <= innerWidth && rect.height >= 44),
        };
      });
      t.check('first-run guidance reflows at 320 pixels without clipping its controls',
        narrow.regionLeft >= 0 && narrow.regionRight <= narrow.viewport
        && narrow.regionScrollWidth <= narrow.regionWidth && narrow.visible,
        JSON.stringify(narrow));

      await page.setViewport({ width: 1280, height: 900 });
      await click(page, '.ri[data-view="browse"]');
      await page.waitForSelector('#view-browse:not([hidden])');
      t.check('first-run guidance exists only on Home',
        await page.$eval('#view-browse', (browse) => !browse.querySelector('#home-first-run')));

      await open(page, '/');
      await page.waitForSelector('#home-primary-paths [data-category="timeline"]', { timeout: 15000 });
      await click(page, '#home-primary-paths [data-category="timeline"]');
      await page.waitForFunction(() => location.hash === '#/catalog'
        && document.activeElement?.id === 'catalog-h');
      await click(page, '#catalog-results [data-act="preview"]');
      await page.waitForSelector('#preview[open]');
      await click(page, '#preview-close');
      await page.waitForFunction(() => !document.querySelector('#preview')?.open);
      await page.evaluate(() => history.back());
      await page.waitForFunction(() => location.hash === '#/home'
        && document.activeElement?.id === 'home-h');
      t.check('a primary category uses real history and Back returns focus to Home', true);

      const before = await page.evaluate(() => ({
        hash: location.hash,
        state: localStorage.getItem('mrt.state.v2'),
      }));
      await page.evaluate(() => {
        const button = document.querySelector('#btn-home-recommended');
        button.focus();
        button.click();
      });
      await page.waitForFunction(() => document.querySelector('#preview')?.open
        && document.querySelector('#preview-h')?.textContent.trim() === 'Setup to Modern Timeline');
      await click(page, '#preview-close');
      await page.waitForFunction(() => !document.querySelector('#preview')?.open);
      const after = await page.evaluate(() => ({
        hash: location.hash,
        state: localStorage.getItem('mrt.state.v2'),
        focus: document.activeElement?.id ?? null,
      }));
      t.check('recommended Preview opens and closes without changing state, history, or focus',
        after.hash === before.hash && after.state === before.state
        && after.focus === 'btn-home-recommended',
        JSON.stringify({ before, after }));

      await click(page, '#btn-home-recommended');
      await page.waitForSelector('#preview[open]');
      await click(page, '#preview-add [data-act="main"]');
      await page.waitForFunction(() => {
        const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
        return state.listOrder.length === 1;
      });
      await click(page, '#preview-close');
      await page.waitForFunction(() => !document.querySelector('#preview')?.open);
      const populated = await page.evaluate(() => {
        const firstRun = document.querySelector('#home-first-run');
        const continued = document.querySelector('#home-continue');
        const yours = document.querySelector('#home-yours');
        const categories = document.querySelector('#home-categories');
        return {
          firstRunHidden: firstRun.hidden,
          continueHidden: continued.hidden,
          yoursHidden: yours.hidden,
          order: [continued, yours, categories].map((node) => Math.round(node.getBoundingClientRect().top)),
        };
      });
      t.check('adding from Home restores returning-reader priority',
        populated.firstRunHidden && !populated.continueHidden && !populated.yoursHidden
        && populated.order[0] < populated.order[1] && populated.order[1] < populated.order[2],
        JSON.stringify(populated));
    },
  },
  {
    id: 'modern-timeline-actual-data',
    title: 'the chosen 1998 timeline and setup guide stay distinct on actual data',
    async run(page, t) {
      const externalRequests = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol.startsWith('http') && url.origin !== page.__origin) {
          externalRequests.push(request.url());
        }
      });
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
        window.__mrtBlockExternal = true;
      });
      await open(page, '/?catalog=actual#/home');
      await page.waitForSelector('#home-first-run:not([hidden]) #btn-home-recommended', { timeout: 15000 });
      const home = await page.evaluate(() => ({
        recommendation: document.querySelector('#home-recommended-h')?.textContent.trim() ?? '',
        homeCount: document.querySelector(
          '#home-primary-paths [data-category="timeline"] .home-path-count',
        )?.textContent.trim() ?? '',
      }));
      await click(page, '.ri[data-view="browse"]');
      await page.waitForSelector('#view-browse:not([hidden])');
      const browseCount = await page.$eval(
        '#view-browse [data-primary-paths] [data-category="timeline"] .home-path-count',
        (node) => node.textContent.trim(),
      );
      t.check('Home recommends the setup guide and both gateways count 148 normal Reading Lists',
        home.recommendation === 'Recommended start: Setup to Modern Timeline'
        && home.homeCount === '148 Reading Lists'
        && browseCount === '148 Reading Lists',
        JSON.stringify({ ...home, browseCount }));
      await open(page, '/?catalog=actual#/home');
      await page.waitForSelector('#home-first-run:not([hidden]) #btn-home-recommended', { timeout: 15000 });

      const beforeHomePreview = await page.evaluate(() => ({
        href: location.href,
        history: history.length,
        state: localStorage.getItem('mrt.state.v2'),
      }));
      await page.focus('#btn-home-recommended');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#preview')?.open
        && document.querySelector('#preview-h')?.textContent.trim() === 'Setup to Modern Timeline');
      await click(page, '#preview-close');
      await page.waitForFunction(() => !document.querySelector('#preview')?.open
        && document.activeElement?.id === 'btn-home-recommended');
      const afterHomePreview = await page.evaluate(() => ({
        href: location.href,
        history: history.length,
        state: localStorage.getItem('mrt.state.v2'),
        focus: document.activeElement?.id ?? '',
      }));
      t.check('the Home setup action uses Preview without changing history, state, or return focus',
        afterHomePreview.href === beforeHomePreview.href
        && afterHomePreview.history === beforeHomePreview.history
        && afterHomePreview.state === beforeHomePreview.state
        && afterHomePreview.focus === 'btn-home-recommended',
        JSON.stringify({ beforeHomePreview, afterHomePreview }));

      await click(page, '#btn-home-recommended');
      await page.waitForSelector('#preview[open]');
      await click(page, '#preview-add [data-act="main"]');
      await page.waitForFunction(() => {
        const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
        return Object.values(state.lists)
          .some((list) => list.catalogId === 'setup-to-modern-timeline');
      });
      await click(page, '#preview-close');
      await page.waitForFunction(() => !document.querySelector('#preview')?.open);
      const trackedSetup = await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
        const list = Object.values(state.lists)
          .find((candidate) => candidate.catalogId === 'setup-to-modern-timeline');
        return {
          catalogId: list?.catalogId ?? '',
          issueCount: list?.itemIds.length ?? 0,
          listCount: state.listOrder.length,
        };
      });
      t.check('the featured setup remains one normal trackable 21-issue Reading List',
        trackedSetup.catalogId === 'setup-to-modern-timeline'
        && trackedSetup.issueCount === 21
        && trackedSetup.listCount === 1,
        JSON.stringify(trackedSetup));

      await click(page, '.ri[data-view="browse"]');
      await page.waitForSelector('#view-browse:not([hidden])');
      await click(page, '#view-browse [data-primary-paths] [data-category="timeline"]');
      await page.waitForSelector('#modern-timeline-feature:not([hidden])', { timeout: 15000 });
      await page.waitForSelector('#catalog-results .catalog-card');
      const timeline = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('#catalog-results .catalog-card')];
        const chapterCards = cards.filter((card) => (
          /^list:marvel-knights-to-planet-x-\d{2}$/.test(card.dataset.story)
        ));
        const spine = [...document.querySelectorAll('#catalog-results .timeline-year-marker')]
          .map((marker) => ({
            year: Number(
              marker.querySelector('.timeline-year-label')?.textContent
              ?? marker.querySelector('[aria-hidden="true"]')?.textContent,
            ),
            empty: marker.classList.contains('is-empty'),
          }));
        return {
          featureHeading: document.querySelector('#modern-timeline-feature-h')?.textContent.trim() ?? '',
          featureCopy: document.querySelector('#modern-timeline-feature p')?.textContent.trim() ?? '',
          cards: cards.length,
          firstCards: cards.slice(0, 3).map((card) => ({
            title: card.querySelector('.catalog-card-title')?.textContent.trim() ?? '',
            year: Number(card.dataset.year),
          })),
          cardYears: cards.map((card) => Number(card.dataset.year)),
          chapterCards: chapterCards.length,
          chapterYears: Object.fromEntries(
            [1998, 1999, 2000, 2001, 2002, 2003, 2004].map((year) => [
              year,
              chapterCards.filter((card) => Number(card.dataset.year) === year).length,
            ]),
          ),
          eras: [...document.querySelectorAll('#catalog-results .timeline-era-head')].slice(0, 2)
            .map((head) => ({
              heading: head.querySelector('.shelf-section-title')?.textContent.trim() ?? '',
              copy: head.querySelector('.shelf-section-blurb')?.textContent.trim() ?? '',
            })),
          spine,
          setupCards: cards.filter((card) => card.dataset.story === 'list:setup-to-modern-timeline').length,
          operationCards: cards.filter((card) => card.dataset.story === 'list:operation-zero-tolerance').length,
          avengersCards: cards.filter((card) => card.dataset.story === 'list:avengers-disassembled').length,
        };
      });
      t.check('the feature names the product boundary without becoming a normal card',
        timeline.featureHeading === 'Start with Setup to Modern Timeline'
        && timeline.featureCopy.includes('This app chooses 1998 as the start of its Modern Timeline.')
        && timeline.featureCopy.includes('It is not an official Marvel editorial-era boundary.')
        && timeline.setupCards === 0,
        JSON.stringify(timeline));
      t.check('148 selected lists render as 144 cards beginning with the owner chapters',
        timeline.cards === 144
        && timeline.chapterCards === 78
        && JSON.stringify(timeline.firstCards) === JSON.stringify([
          { title: 'Daredevil & Black Widow Opening Sequence', year: 1998 },
          { title: 'Punisher: Welcome Back Frank', year: 2000 },
          { title: 'Marvel Boy to Early X-Men Setup', year: 2000 },
        ]),
        JSON.stringify({ cards: timeline.cards, firstCards: timeline.firstCards }));
      t.check('the chapter years are derived exactly and only 1999 remains empty before 2004',
        timeline.spine[0]?.year === 1998
        && timeline.spine.every(({ year }) => year >= 1998)
        && JSON.stringify(timeline.chapterYears) === JSON.stringify({
          1998: 1, 1999: 0, 2000: 2, 2001: 16, 2002: 24, 2003: 32, 2004: 3,
        })
        && timeline.spine
          .filter(({ empty }) => empty)
          .map(({ year }) => year)
          .filter((year) => year <= 2003)
          .join('/') === '1999',
        JSON.stringify(timeline.spine));
      t.check('the first era names Marvel Knights and the 2004 era explains the Avengers handoff',
        timeline.eras[0]?.heading === 'Marvel Knights to Planet X'
        && timeline.eras[0]?.copy.includes('Dated 1998 to 2003.')
        && timeline.eras[1]?.heading === 'Avengers Disassembled to Civil War'
        && timeline.eras[1]?.copy.includes('final three Planet X bridge chapters share 2004')
        && timeline.operationCards === 0 && timeline.avengersCards === 1,
        JSON.stringify(timeline));

      const beforeFeaturePreview = await page.evaluate(() => ({
        href: location.href,
        history: history.length,
        state: localStorage.getItem('mrt.state.v2'),
      }));
      await page.focus('#btn-modern-timeline-feature');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#preview')?.open
        && document.querySelector('#preview-h')?.textContent.trim() === 'Setup to Modern Timeline');
      await click(page, '#preview-close');
      await page.waitForFunction(() => !document.querySelector('#preview')?.open
        && document.activeElement?.id === 'btn-modern-timeline-feature');
      const afterFeaturePreview = await page.evaluate(() => ({
        href: location.href,
        history: history.length,
        state: localStorage.getItem('mrt.state.v2'),
        focus: document.activeElement?.id ?? '',
      }));
      t.check('the featured action uses the same Preview flow without a second tracked guide',
        afterFeaturePreview.href === beforeFeaturePreview.href
        && afterFeaturePreview.history === beforeFeaturePreview.history
        && afterFeaturePreview.state === beforeFeaturePreview.state
        && afterFeaturePreview.focus === 'btn-modern-timeline-feature',
        JSON.stringify({ beforeFeaturePreview, afterFeaturePreview }));

      await page.$eval('#catalog-q', (input) => {
        input.value = 'Avengers Disassembled';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForFunction(() => document.querySelectorAll('#catalog-results .catalog-card').length === 1);
      const searched = await page.evaluate(() => ({
        featureVisible: !document.querySelector('#modern-timeline-feature')?.hidden,
        title: document.querySelector('#catalog-results .catalog-card-title')?.textContent.trim() ?? '',
        setupCard: Boolean(document.querySelector(
          '#catalog-results [data-story="list:setup-to-modern-timeline"]',
        )),
        emptyMarkers: document.querySelectorAll('#catalog-results .timeline-year-marker.is-empty').length,
      }));
      await click(page, '#catalog-clear');
      await page.waitForFunction(() => document.querySelectorAll('#catalog-results .catalog-card').length >= 144);
      await page.$eval('#catalog-filters input:not([value="all"])', (input) => input.click());
      const filtered = await page.evaluate(() => ({
        featureVisible: !document.querySelector('#modern-timeline-feature')?.hidden,
        checked: document.querySelector('#catalog-filters input:checked')?.value ?? '',
        setupCard: Boolean(document.querySelector(
          '#catalog-results [data-story="list:setup-to-modern-timeline"]',
        )),
        emptyMarkers: document.querySelectorAll('#catalog-results .timeline-year-marker.is-empty').length,
      }));
      t.check('search and facets rerender normal cards without removing or duplicating the feature',
        searched.featureVisible && searched.title === 'Avengers Disassembled' && !searched.setupCard
        && searched.emptyMarkers === 0
        && filtered.featureVisible && filtered.checked !== 'all' && !filtered.setupCard
        && filtered.emptyMarkers === 0,
        JSON.stringify({ searched, filtered }));
      await page.$eval('#catalog-filters input[value="all"]', (input) => input.click());
      await page.waitForFunction(() => document.querySelectorAll('#catalog-results .catalog-card').length >= 144);

      await page.setViewport({ width: 320, height: 900 });
      const denseYear = await page.evaluate(() => {
        const heading = document.querySelector('#timeline-year-2003');
        const row = heading?.closest('.timeline-year-row');
        const grid = row?.querySelector('.timeline-year-cards');
        return {
          cards: grid?.querySelectorAll('.catalog-card').length ?? 0,
          columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
          overflow: document.documentElement.scrollWidth - innerWidth,
          markerAboveCards: heading && grid
            ? heading.getBoundingClientRect().bottom <= grid.getBoundingClientRect().top
            : false,
        };
      });
      t.check('the 32-card 2003 row stays one-column and unclipped at 320 pixels',
        denseYear.cards === 32
          && denseYear.columns === 1
          && denseYear.overflow <= 1
          && denseYear.markerAboveCards,
        JSON.stringify(denseYear));
      await page.setViewport({ width: 1280, height: 900 });

      const representatives = [
        {
          id: 'marvel-knights-to-planet-x-01',
          name: 'Daredevil & Black Widow Opening Sequence',
          description: 'This chapter resets Daredevil with sharper emotional stakes and a grounded tone. Black Widow’s stories expand the street-level world and set up the character-driven focus of the era.',
          count: 21,
          first: 'Daredevil (1998) #1',
        },
        {
          id: 'marvel-knights-to-planet-x-37',
          name: 'X-Treme X-Men: X-Pose + Schism',
          description: 'The team deals with media pressure and internal conflict. The arc explores perception and division.',
          count: 7,
          first: 'X-Treme X-Men (2001) #19',
        },
        {
          id: 'marvel-knights-to-planet-x-78',
          name: 'Planet X Crossover Cluster',
          description: 'The mutant line converges in a major turning point. The arc reshapes relationships, leadership, and the future of the X-Men.',
          count: 25,
          first: 'New X-Men (2001) #146',
        },
      ];
      const representativeResults = [];
      for (const representative of representatives) {
        await page.$eval('#catalog-q', (input, name) => {
          input.value = name;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, representative.name);
        await page.waitForFunction(
          (name) => document.querySelectorAll('#catalog-results .catalog-card').length === 1
              && document.querySelector('#catalog-results .catalog-card-title')?.textContent.trim() === name,
          { timeout: 15000 },
          representative.name,
        );
        const preview = '#catalog-results .catalog-card [data-act="preview"]';
        await page.focus(preview);
        await page.keyboard.press('Enter');
        await page.waitForFunction(
          (name) => document.querySelector('#preview')?.open
              && document.querySelector('#preview-h')?.textContent.trim() === name,
          {},
          representative.name,
        );
        await page.waitForFunction(
          (count) => document.querySelectorAll('#preview-body .preview-issue-link').length === count,
          { timeout: 15000 },
          representative.count,
        );
        const shown = await page.evaluate(() => ({
          count: document.querySelectorAll('#preview-body .preview-issue-link').length,
          first: document.querySelector('#preview-body .preview-issue-link')?.textContent.trim() ?? '',
          description: document.querySelector('#preview-desc')?.textContent.trim() ?? '',
          add: document.querySelector('#preview-add [data-act="main"]')?.textContent.trim() ?? '',
        }));
        await click(page, '#preview-add [data-act="main"]');
        await page.waitForFunction(
          (id) => Object.values(JSON.parse(localStorage.getItem('mrt.state.v2')).lists)
            .some((list) => list.catalogId === id),
          {},
          representative.id,
        );
        const savedCount = await page.evaluate((id) => {
          const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
          return Object.values(state.lists).find((list) => list.catalogId === id)?.itemIds.length ?? 0;
        }, representative.id);
        await click(page, '#preview-close');
        await page.waitForFunction(() => !document.querySelector('#preview')?.open);
        representativeResults.push({ ...shown, savedCount });
      }
      t.check('representative first, corrected middle, and final chapters preview and save normally',
        representativeResults.every((result, index) => (
          result.count === representatives[index].count
            && result.first === representatives[index].first
            && result.description === representatives[index].description
            && result.add === '+ Add to library'
            && result.savedCount === representatives[index].count
        )),
        JSON.stringify(representativeResults));
      await click(page, '#catalog-clear');
      await page.waitForFunction(() => document.querySelectorAll('#catalog-results .catalog-card').length >= 144);

      const excluded = [
        ['spider-man-identity-crisis', 'Spider-Man: Identity Crisis'],
        ['hunt-for-xavier', 'The Hunt for Xavier'],
        ['eighth-day', 'Eighth Day'],
        ['magneto-war', 'Magneto War'],
        ['maximum-security', 'Maximum Security'],
      ];
      await open(page, '/?catalog=actual#/age-marvel-knights-heroes-return');
      await page.waitForSelector('#age-marvel-knights-heroes-return-results .catalog-card', { timeout: 15000 });
      const excludedOnPeriod = [];
      for (const [id, title] of excluded) {
        const selector = `#age-marvel-knights-heroes-return-results [data-story="list:${id}"] [data-act="preview"]`;
        const available = Boolean(await page.$(selector));
        if (available) {
          await click(page, selector);
          await page.waitForSelector('#preview[open]');
          const previewTitle = await page.$eval('#preview-h', (heading) => heading.textContent.trim());
          await click(page, '#preview-close');
          excludedOnPeriod.push({ id, available, title: previewTitle, expected: title });
          continue;
        }
        excludedOnPeriod.push({ id, available });
      }
      t.check('every excluded 1998 to 2000 event remains on its direct Marvel Ages route and previews',
        excludedOnPeriod.every(({ available, title, expected }) => available && title === expected),
        JSON.stringify(excludedOnPeriod));
      const periodChapters = await page.$$eval(
        '#age-marvel-knights-heroes-return-results [data-story]',
        (cards) => cards.filter((card) => (
          /^list:marvel-knights-to-planet-x-\d{2}$/.test(card.dataset.story)
        )).length,
      );
      const firstPeriodChapter =
        '#age-marvel-knights-heroes-return-results [data-story="list:marvel-knights-to-planet-x-01"] [data-act="preview"]';
      await click(page, firstPeriodChapter);
      await page.waitForFunction(() => document.querySelector('#preview')?.open
        && document.querySelector('#preview-h')?.textContent.trim() === 'Daredevil & Black Widow Opening Sequence');
      await click(page, '#preview-close');
      t.check('Marvel Knights / Heroes Return carries and previews all 75 pre-2004 chapters',
        periodChapters === 75, `${periodChapters} chapters`);

      await open(page, '/?catalog=actual#/age-event-era');
      await page.waitForSelector('#age-event-era-results .catalog-card', { timeout: 15000 });
      const eventEraChapters = await page.$$eval(
        '#age-event-era-results [data-story]',
        (cards) => cards.filter((card) => (
          /^list:marvel-knights-to-planet-x-\d{2}$/.test(card.dataset.story)
        )).map((card) => card.querySelector('.catalog-card-title')?.textContent.trim()),
      );
      await click(
        page,
        '#age-event-era-results [data-story="list:marvel-knights-to-planet-x-71"] [data-act="preview"]',
      );
      await page.waitForFunction(() => document.querySelector('#preview')?.open
        && document.querySelector('#preview-h')?.textContent.trim() === 'New Mutants: The Ties That Bind');
      await click(page, '#preview-close');
      t.check('Event Era carries the three 2004 chapters in owner tie order and previews them',
        JSON.stringify(eventEraChapters) === JSON.stringify([
          'New Mutants: The Ties That Bind',
          'Spider-Man: The Book of Ezekiel',
          'X-Treme X-Men: Storm: The Arena',
        ]),
        JSON.stringify(eventEraChapters));

      await open(page, '/?catalog=actual#/age-early-modern');
      await page.waitForSelector('#age-early-modern-results .catalog-card', { timeout: 15000 });
      const olderPreviewSelector =
        '#age-early-modern-results [data-story="list:operation-zero-tolerance"] [data-act="preview"]';
      const olderPreviewAvailable = Boolean(await page.$(olderPreviewSelector));
      if (olderPreviewAvailable) {
        await click(page, olderPreviewSelector);
        await page.waitForFunction(() => document.querySelector('#preview')?.open
          && document.querySelector('#preview-h')?.textContent.trim() === 'Operation: Zero Tolerance');
        await click(page, '#preview-close');
      }
      await open(page, '/?catalog=actual#/marvel-ages');
      await page.waitForSelector(
        '#marvel-ages-modern-list [data-category="early-modern"]',
        { timeout: 15000 },
      );
      const olderDiscovery = await page.evaluate(() => ({
        ageTile: document.querySelector(
          '#marvel-ages-modern-list [data-category="early-modern"]',
        )?.textContent.replace(/\s+/g, ' ').trim() ?? '',
        trackedLists: JSON.parse(localStorage.getItem('mrt.state.v2')).listOrder.length,
        blockedExternal: window.__mrtBlockedExternal ?? [],
      }));
      t.check('a pre-1998 event still previews directly and remains discoverable through Marvel Ages',
        olderPreviewAvailable
        && olderDiscovery.ageTile.includes('Early Modern')
        && olderDiscovery.ageTile.includes('1991 to 1997')
        && olderDiscovery.trackedLists === 4,
        JSON.stringify(olderDiscovery));
      t.check('actual-data browsing sends no cross-origin request when covers are off',
        externalRequests.length === 0
        && olderDiscovery.blockedExternal.every(
          (url) => url === 'https://marvel.emreparker.com/v1/health',
        ),
        JSON.stringify({ externalRequests, blockedExternal: olderDiscovery.blockedExternal }));
    },
  },
  {
    id: 'marvel-knights-legacy-actual-data',
    title: 'a saved 487-issue umbrella remains intact and shares progress with an added chapter',
    async run(page, t) {
      const legacy = legacyMarvelKnightsState();
      await page.evaluateOnNewDocument((state) => {
        localStorage.setItem('mrt.state.v2', JSON.stringify(state));
        localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
        window.__mrtBlockExternal = true;
      }, legacy);
      await open(page, '/?catalog=actual#/read');
      await page.waitForFunction(() => document.querySelector('#order-name')?.textContent.trim()
        === 'Marvel Knights to Planet X');

      const loaded = await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
        const list = state.lists.legacy;
        return {
          schemaVersion: state.schemaVersion,
          name: list.name,
          catalogId: list.catalogId,
          note: list.note,
          items: list.itemIds.length,
          first: list.itemIds[0],
          last: list.itemIds.at(-1),
          read: Object.keys(state.read),
          override: state.overrides[list.itemIds[1]],
          issueNote: state.notes[list.itemIds[2]],
          ring: document.querySelector('#ring-sub')?.textContent.trim() ?? '',
        };
      });
      t.check('schema load preserves the complete legacy list and its local/global fields',
        loaded.schemaVersion === 2
        && loaded.name === 'Marvel Knights to Planet X'
        && loaded.catalogId === 'marvel-knights-to-planet-x'
        && loaded.note === 'Legacy list note'
        && loaded.items === 487
        && loaded.first === 15609
        && loaded.last === 486
        && loaded.read.join('/') === '15609'
        && loaded.override === 'available'
        && loaded.issueNote === 'Legacy issue note'
        && loaded.ring === '1 of 487 read',
        JSON.stringify(loaded));

      await openFullOrder(page);
      const rows = await page.evaluate(() => ({
        count: document.querySelectorAll('#rows .row').length,
        first: document.querySelector('#rows .row .rt')?.textContent.trim() ?? '',
        last: [...document.querySelectorAll('#rows .row .rt')].at(-1)?.textContent.trim() ?? '',
      }));
      t.check('the legacy Full Reading List still renders every issue in order',
        rows.count === 487
        && rows.first === 'Daredevil (1998) #1'
        && rows.last === 'New X-Men (2001) #156',
        JSON.stringify(rows));

      await open(page, '/?catalog=actual#/catalog');
      await page.waitForSelector('#catalog-results .catalog-card', { timeout: 15000 });
      await page.$eval('#catalog-q', (input) => {
        input.value = 'Daredevil & Black Widow Opening Sequence';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForFunction(() => document.querySelectorAll('#catalog-results .catalog-card').length === 1);
      await click(page, '#catalog-results .catalog-card [data-act="preview"]');
      await page.waitForFunction(() => document.querySelector('#preview')?.open
        && document.querySelector('#preview-h')?.textContent.trim()
          === 'Daredevil & Black Widow Opening Sequence');
      await click(page, '#preview-add [data-act="main"]');
      await page.waitForFunction(() => document.querySelector('#preview-add [data-act="main"]')
        ?.textContent.includes('In library'));
      await click(page, '#preview-add [data-act="main"]');
      await page.waitForFunction(() => !document.querySelector('#view-read')?.hidden
        && document.querySelector('#order-name')?.textContent.trim()
          === 'Daredevil & Black Widow Opening Sequence');

      const shared = await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
        const legacyList = state.lists.legacy;
        const chapter = Object.values(state.lists)
          .find((list) => list.catalogId === 'marvel-knights-to-planet-x-01');
        return {
          schemaVersion: state.schemaVersion,
          listCount: state.listOrder.length,
          legacyItems: legacyList.itemIds.length,
          legacyCatalogId: legacyList.catalogId,
          legacyNote: legacyList.note,
          chapterItems: chapter?.itemIds.length ?? 0,
          chapterRead: chapter?.itemIds.filter((id) => Object.hasOwn(state.read, id)).length ?? 0,
          override: state.overrides[legacyList.itemIds[1]],
          issueNote: state.notes[legacyList.itemIds[2]],
          ring: document.querySelector('#ring-sub')?.textContent.trim() ?? '',
        };
      });
      t.check('an individually added chapter shares progress without splitting or changing the umbrella',
        shared.schemaVersion === 2
        && shared.listCount === 2
        && shared.legacyItems === 487
        && shared.legacyCatalogId === 'marvel-knights-to-planet-x'
        && shared.legacyNote === 'Legacy list note'
        && shared.chapterItems === 21
        && shared.chapterRead === 1
        && shared.override === 'available'
        && shared.issueNote === 'Legacy issue note'
        && shared.ring === '1 of 21 read',
        JSON.stringify(shared));
    },
  },
  {
    id: 'modern-timeline-layout',
    title: 'Modern Timeline era copy uses its box and remains readable under constrained display',
    async run(page, t) {
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('mrt.settings', JSON.stringify({ covers: false }));
        window.__mrtBlockExternal = true;
      });
      await open(page, '/?catalog=actual#/catalog');
      await page.waitForSelector('#catalog-results .shelf-section-blurb', { timeout: 15000 });
      const wide = await page.$eval(
        '#catalog-results .timeline-era-head',
        (head) => {
          const blurb = head.querySelector('.shelf-section-blurb');
          const headRect = head.getBoundingClientRect();
          const blurbRect = blurb.getBoundingClientRect();
          const style = getComputedStyle(head);
          const contentLeft = headRect.left
            + Number.parseFloat(style.borderLeftWidth)
            + Number.parseFloat(style.paddingLeft);
          const contentRight = headRect.right
            - Number.parseFloat(style.borderRightWidth)
            - Number.parseFloat(style.paddingRight);
          return {
            maxWidth: getComputedStyle(blurb).maxWidth,
            leftGap: Math.round(blurbRect.left - contentLeft),
            rightGap: Math.round(contentRight - blurbRect.right),
            blurbWidth: Math.round(blurbRect.width),
          };
        },
      );
      t.check('an era description uses the full content width inside its section box',
        wide.maxWidth === 'none' && Math.abs(wide.leftGap) <= 1
        && Math.abs(wide.rightGap) <= 1 && wide.blurbWidth > 700,
        JSON.stringify(wide));

      await page.setViewport({ width: 320, height: 900 });
      await page.waitForFunction(() => matchMedia('(max-width: 700px)').matches);
      const narrow = await page.$eval(
        '#catalog-results .timeline-era-head',
        (head) => {
          const blurb = head.querySelector('.shelf-section-blurb');
          const headRect = head.getBoundingClientRect();
          const blurbRect = blurb.getBoundingClientRect();
          return {
            viewport: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            headLeft: Math.round(headRect.left),
            headRight: Math.round(headRect.right),
            blurbLeft: Math.round(blurbRect.left),
            blurbRight: Math.round(blurbRect.right),
            blurbScroll: blurb.scrollWidth,
            blurbClient: blurb.clientWidth,
          };
        },
      );
      t.check('the era box and its copy reflow without horizontal clipping at 320 pixels',
        narrow.documentWidth <= narrow.viewport
        && narrow.headLeft >= 0 && narrow.headRight <= narrow.viewport
        && narrow.blurbLeft >= narrow.headLeft && narrow.blurbRight <= narrow.headRight
        && narrow.blurbScroll <= narrow.blurbClient,
        JSON.stringify(narrow));

      await page.setViewport({ width: 1280, height: 900 });
      await page.evaluate(() => {
        document.querySelector('#catalog-h').focus();
      });
      for (let press = 0; press < 20; press += 1) {
        if (await page.evaluate(() => document.activeElement?.id === 'btn-modern-timeline-feature')) break;
        await page.keyboard.press('Tab');
      }
      const keyboardFocus = await page.$eval('#btn-modern-timeline-feature', (button) => ({
        active: document.activeElement === button,
        outlineStyle: getComputedStyle(button).outlineStyle,
        outlineWidth: Number.parseFloat(getComputedStyle(button).outlineWidth),
      }));
      t.check('keyboard traversal reaches the featured setup action with a visible focus ring',
        keyboardFocus.active && keyboardFocus.outlineStyle !== 'none' && keyboardFocus.outlineWidth >= 3,
        JSON.stringify(keyboardFocus));

      const client = await page.createCDPSession();
      await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
      await page.$eval('#btn-modern-timeline-feature', (button) => {
        button.scrollIntoView({ block: 'center', inline: 'center' });
      });
      const zoom = await page.$eval('#modern-timeline-feature', (feature) => {
        const button = feature.querySelector('#btn-modern-timeline-feature');
        const buttonRect = button.getBoundingClientRect();
        const copy = feature.querySelector('p');
        return {
          scale: visualViewport.scale,
          active: document.activeElement === button,
          buttonLeft: buttonRect.left,
          buttonRight: buttonRect.right,
          viewportLeft: visualViewport.offsetLeft,
          viewportRight: visualViewport.offsetLeft + visualViewport.width,
          copyScroll: copy.scrollWidth,
          copyClient: copy.clientWidth,
        };
      });
      t.check('the focused feature remains operable and its copy remains unclipped at 200 percent zoom',
        zoom.scale === 2 && zoom.active
        && zoom.buttonLeft >= zoom.viewportLeft && zoom.buttonRight <= zoom.viewportRight
        && zoom.copyScroll <= zoom.copyClient,
        JSON.stringify(zoom));
      await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });

      await client.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'forced-colors', value: 'active' }],
      });
      const forced = await page.$eval(
        '#catalog-results .timeline-era-head',
        (head) => {
          const systemColor = (value) => {
            const probe = document.createElement('span');
            probe.style.color = value;
            document.body.append(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
          };
          const blurb = head.querySelector('.shelf-section-blurb');
          const feature = document.querySelector('#modern-timeline-feature');
          const style = getComputedStyle(head);
          return {
            active: matchMedia('(forced-colors: active)').matches,
            canvasText: systemColor('CanvasText'),
            highlight: systemColor('Highlight'),
            headBorder: style.borderTopColor,
            accentBorder: style.borderLeftColor,
            blurbColor: getComputedStyle(blurb).color,
            featureBorder: getComputedStyle(feature).borderTopColor,
          };
        },
      );
      t.check('forced colors preserves system-colored era and featured-region boundaries and copy',
        forced.active && forced.headBorder === forced.canvasText
        && forced.accentBorder === forced.highlight
        && forced.blurbColor === forced.canvasText
        && forced.featureBorder === forced.canvasText,
        JSON.stringify(forced));
      await client.send('Emulation.setEmulatedMedia', { features: [] });
    },
  },
  {
    id: 'publishing-ages',
    title: 'publishing ages provide direct compact category pages',
    async run(page, t) {
      await open(page, '/');
      await page.evaluate(() => localStorage.setItem('mrt.catalog.fixture', 'publishing'));
      await open(page, '/');
      await page.waitForSelector('#home-secondary-paths [data-category="marvel-ages"]', {
        timeout: 15000,
      });
      await click(page, '#home-secondary-paths [data-category="marvel-ages"]');
      await page.waitForSelector('#marvel-ages-modern-list .home-path', { timeout: 15000 });

      const ages = await page.evaluate(() => ({
        hash: location.hash,
        focus: document.activeElement?.id ?? null,
        rail: document.querySelector('.ri[aria-current="page"]')?.dataset.view ?? null,
        count: document.querySelector('#marvel-ages-count')?.textContent.trim() ?? '',
        earlier: [...document.querySelectorAll('#marvel-ages-earlier-list .home-path')]
          .map((path) => path.dataset.category),
        modern: [...document.querySelectorAll('#marvel-ages-modern-list .home-path')]
          .map((path) => path.dataset.category),
        aggregateName: document.querySelector('#marvel-ages-modern-all')
          ?.getAttribute('aria-label') ?? '',
        cards: document.querySelectorAll('#marvel-ages-results .catalog-card').length,
      }));
      t.check('Home opens one chronological Marvel Ages gateway',
        ages.hash === '#/marvel-ages'
        && ages.focus === 'marvel-ages-h'
        && ages.rail === 'browse'
        && ages.count === `${FIXTURE_PUBLISHING_GROUPS.count} Reading Lists`
        && ages.earlier.join('/') === 'silver/bronze/copper'
        && ages.modern.join('/') === FIXTURE_MODERN_PERIODS.map(({ key }) => key).join('/')
        && ages.aggregateName === 'Browse all Modern Age Reading Lists: 1991 to present, 16 Reading Lists'
        && ages.cards === 0,
        JSON.stringify(ages));

      await click(page, '#marvel-ages-earlier-list [data-category="silver"]');
      await page.waitForFunction(() => location.hash === '#/age-silver'
        && document.activeElement?.id === 'age-silver-h');
      await page.evaluate(() => history.back());
      await page.waitForFunction(() => location.hash === '#/marvel-ages'
        && document.activeElement?.id === 'marvel-ages-h');
      await page.evaluate(() => history.back());
      await page.waitForFunction(() => location.hash === '#/home'
        && document.activeElement?.id === 'home-h');
      await page.evaluate(() => history.forward());
      await page.waitForFunction(() => location.hash === '#/marvel-ages');
      await page.evaluate(() => history.forward());
      await page.waitForFunction(() => location.hash === '#/age-silver');
      t.check('Home history traverses gateway and Silver in both directions',
        await page.evaluate(() => location.hash === '#/age-silver'
          && document.activeElement?.id === 'age-silver-h'));

      await open(page, '/#/browse');
      await page.waitForSelector('#view-browse [data-secondary-paths] [data-category="marvel-ages"]', {
        timeout: 15000,
      });
      await click(page, '#view-browse [data-secondary-paths] [data-category="marvel-ages"]');
      await page.waitForSelector('#marvel-ages-earlier-list [data-category="silver"]');
      await click(page, '#marvel-ages-earlier-list [data-category="silver"]');
      await page.waitForFunction(() => location.hash === '#/age-silver');
      await page.evaluate(() => history.back());
      await page.waitForFunction(() => location.hash === '#/marvel-ages');
      await page.evaluate(() => history.back());
      await page.waitForFunction(() => location.hash === '#/browse');
      t.check('Browse history returns through the same gateway',
        await page.evaluate(() => document.querySelector('.view:not([hidden])')?.id === 'view-browse'
          && document.activeElement?.id === 'browse-h'));

      await open(page, '/');
      await click(page, '#home-secondary-paths [data-category="marvel-ages"]');
      await page.waitForSelector('#marvel-ages-modern-list [data-category="marvel-now"]');
      await click(page, '#marvel-ages-modern-list [data-category="marvel-now"]');
      await page.waitForFunction(() => location.hash === '#/age-marvel-now');
      t.check('Marvel NOW! is a direct gateway child rather than a required Modern detour',
        await page.evaluate(() => document.activeElement?.id === 'age-marvel-now-h'));

      await open(page, '/');
      await click(page, '#home-secondary-paths [data-category="marvel-ages"]');
      await click(page, '#marvel-ages-modern-all');
      await page.waitForSelector('#age-modern-category-list .home-path', { timeout: 15000 });

      const modernGateway = await page.evaluate(() => ({
        hash: location.hash,
        focus: document.activeElement?.id ?? null,
        rail: document.querySelector('.ri[aria-current="page"]')?.dataset.view ?? null,
        periods: [...document.querySelectorAll('#age-modern-category-list .home-path')].map((path) => ({
          key: path.dataset.category,
          count: path.querySelector('.home-path-count')?.textContent.trim() ?? '',
        })),
        timeline: Boolean(document.querySelector('#age-modern-results .timeline-flow')),
      }));
      t.check('Modern Age has its own route and receives navigation focus',
        modernGateway.hash === '#/age-modern' && modernGateway.focus === 'age-modern-h'
        && modernGateway.rail === 'browse', JSON.stringify(modernGateway));
      const modernCountStatus = await page.$eval('#age-modern-count', (count) => ({
        role: count.getAttribute('role'),
        text: count.textContent.trim(),
      }));
      t.check('the publishing result count is a polite live status',
        modernCountStatus.role === 'status'
        && modernCountStatus.text === '16 Reading Lists',
        JSON.stringify(modernCountStatus));
      const panelBeforeFooter = await page.$eval('#view-age-modern', (panel) =>
        Boolean(panel.compareDocumentPosition(document.querySelector('.app-footer'))
          & Node.DOCUMENT_POSITION_FOLLOWING));
      t.check('the persistent footer follows the generated age page', panelBeforeFooter);
      t.check('Modern Age shows only populated fixture periods with derived counts',
        JSON.stringify(modernGateway.periods) === JSON.stringify(
          FIXTURE_MODERN_PERIODS.map(({ key, count }) => ({
            key,
            count: `${count} ${count === 1 ? 'Reading List' : 'Reading Lists'}`,
          })),
        ), JSON.stringify(modernGateway.periods));
      t.check('Modern Age remains a gateway without an aggregate chronology',
        modernGateway.timeline === false, JSON.stringify(modernGateway));

      await openBrowseCategory(page, 'timeline');
      await page.waitForSelector('#catalog-results .timeline-year-row:not(.is-empty)', { timeout: 15000 });
      const canonicalHeadings = await page.$eval('#view-catalog', (panel) => ({
        view: panel.querySelector('#catalog-h')?.tagName ?? null,
        era: panel.querySelector('.timeline-era-head .shelf-section-title')?.tagName ?? null,
        year: panel.querySelector('.timeline-year-label')?.tagName ?? null,
        card: panel.querySelector('.timeline-year-cards .catalog-card-title')?.tagName ?? null,
      }));
      t.check('the shared renderer preserves the canonical h1 h2 h3 h4 hierarchy',
        JSON.stringify(canonicalHeadings) === JSON.stringify({
          view: 'H1', era: 'H2', year: 'H3', card: 'H4',
        }), JSON.stringify(canonicalHeadings));

      await open(page, '/#/age-modern');
      await page.waitForSelector('#age-modern-category-list .home-path', { timeout: 15000 });
      await click(page, '#age-modern-category-list [data-category="event-era"]');
      await page.waitForSelector('#age-event-era-results .catalog-card', { timeout: 15000 });
      const leaf = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('#age-event-era-results .catalog-card')];
        const byTitle = (title) => cards.find(
          (card) => card.querySelector('.catalog-card-title')?.textContent.trim() === title,
        );
        const local = byTitle('Browser Check Order');
        const crossing = byTitle('Across Two Periods');
        return {
          hash: location.hash,
          focus: document.activeElement?.id ?? null,
          rail: document.querySelector('.ri[aria-current="page"]')?.dataset.view ?? null,
          count: document.querySelector('#age-event-era-count')?.textContent.trim() ?? null,
          timeline: Boolean(document.querySelector('#age-event-era-results .timeline-flow')),
          years: cards.map((card) => Number(card.dataset.year)),
          titles: cards.map((card) => card.querySelector('.catalog-card-title')?.textContent.trim()),
          localLinks: local?.querySelectorAll('.path-step a').length ?? -1,
          crossingHref: crossing?.querySelector('.path-step a')?.getAttribute('href') ?? null,
          groups: [...document.querySelectorAll('#age-event-era-results .timeline-year-row')].map((row) => ({
            year: Number(
              row.querySelector('.timeline-year-label')?.textContent
              ?? row.querySelector('.timeline-year-marker > [aria-hidden="true"]')?.textContent,
            ),
            empty: row.classList.contains('is-empty'),
            cards: [...row.querySelectorAll('.catalog-card')].map((card) => Number(card.dataset.year)),
          })),
          headings: {
            view: document.querySelector('#age-event-era-h')?.tagName ?? null,
            age: document.querySelector('#age-event-era-results .timeline-era-head .shelf-section-title')?.tagName ?? null,
            year: document.querySelector('#age-event-era-results .timeline-year-label')?.tagName ?? null,
            card: document.querySelector('#age-event-era-results .catalog-card-title')?.tagName ?? null,
          },
        };
      });
      t.check('a leaf route draws only stories inside its effective years',
        leaf.hash === '#/age-event-era'
        && leaf.focus === 'age-event-era-h'
        && leaf.rail === 'browse'
        && leaf.years.length > 0
        && leaf.years.every((year) => year >= 2004 && year <= 2011),
        JSON.stringify(leaf));
      t.check('Event Era keeps its Reading List count while the spine groups story cards',
        leaf.count === '14 Reading Lists', JSON.stringify(leaf.count));
      t.check('the age spine uses content bounds and preserves only its internal empty year',
        leaf.timeline
        && leaf.groups.map(({ year }) => year).join('/') === '2004/2005/2006/2007/2008'
        && leaf.groups.filter(({ empty }) => empty).map(({ year }) => year).join('/') === '2007'
        && leaf.groups.every((group) => group.empty
          ? group.cards.length === 0
          : group.cards.length > 0 && group.cards.every((year) => year === group.year)),
        JSON.stringify(leaf.groups));
      t.check('the generated chronology uses the route h1 and h2 h3 h4 content hierarchy',
        JSON.stringify(leaf.headings) === JSON.stringify({
          view: 'H1', age: 'H2', year: 'H3', card: 'H4',
        }), JSON.stringify(leaf.headings));
      t.check('one age leaf can cross canonical shelves',
        leaf.titles.includes('Browser Check Order') && leaf.titles.includes('Across Two Periods'),
        JSON.stringify(leaf.titles));
      t.check('path stops already on the age leaf stay local while an outside stop links canonically',
        leaf.localLinks === 0 && leaf.crossingHref === '#/catalog',
        JSON.stringify({ localLinks: leaf.localLinks, crossingHref: leaf.crossingHref }));

      const timelineIdentity = await page.evaluate(() => {
        const ids = [...document.querySelectorAll('.timeline-flow [id]')].map(({ id }) => id);
        const sections = [...document.querySelectorAll(
          '.timeline-era[aria-labelledby], .timeline-year-row[aria-labelledby]',
        )];
        return {
          duplicates: ids.filter((id, index) => ids.indexOf(id) !== index),
          brokenOwners: sections.filter((section) => {
            const target = document.getElementById(section.getAttribute('aria-labelledby'));
            return !target || !section.contains(target);
          }).map((section) => section.getAttribute('aria-labelledby')),
        };
      });
      t.check('canonical and generated chronologies keep global ids and local heading ownership',
        timelineIdentity.duplicates.length === 0 && timelineIdentity.brokenOwners.length === 0,
        JSON.stringify(timelineIdentity));

      const ageVertical = await page.$eval('#age-event-era-results', (results) => {
        const rows = [...results.querySelectorAll('.timeline-year-row:not(.is-empty)')];
        const clearance = (row) => {
          const marker = row.querySelector('.timeline-year-marker');
          const label = row.querySelector('.timeline-year-label');
          const node = getComputedStyle(marker, '::after');
          const border = parseFloat(node.borderLeftWidth) + parseFloat(node.borderRightWidth);
          const width = parseFloat(node.width) + (node.boxSizing === 'border-box' ? 0 : border);
          const nodeLeft = marker.getBoundingClientRect().right - parseFloat(node.right) - width;
          return Math.round((nodeLeft - label.getBoundingClientRect().right) * 10) / 10;
        };
        return {
          sticky: rows.map((row) => getComputedStyle(row.querySelector('.timeline-year-marker')).position),
          clearances: rows.map(clearance),
          equalHeights: rows.every((row) => {
            const heights = [...row.querySelectorAll('.catalog-card')]
              .map((card) => Math.round(card.getBoundingClientRect().height));
            return Math.max(...heights) - Math.min(...heights) <= 1;
          }),
        };
      });
      t.check('the age spine keeps sticky labels clear of its nodes and equal-height year cards',
        ageVertical.equalHeights
        && ageVertical.sticky.every((position) => position === 'sticky')
        && ageVertical.clearances.every((gap) => gap >= 4),
        JSON.stringify(ageVertical));

      await page.evaluate(() => { window.__mrtMutation = 'import-fail'; });
      await click(page, '#age-event-era-results [data-story="bc-third"] [data-act="import"]');
      await page.waitForFunction(
        () => (document.querySelector('#age-event-era-report')?.textContent ?? '').trim().length > 0,
        { timeout: 15000 },
      );
      const ageImportFailure = await page.evaluate(() => ({
        age: document.querySelector('#age-event-era-report')?.textContent.trim() ?? '',
        catalog: document.querySelector('#catalog-report')?.textContent.trim() ?? '',
      }));
      t.check('an age-card import failure is reported on the age route',
        ageImportFailure.age.length > 0 && ageImportFailure.catalog.length === 0,
        JSON.stringify(ageImportFailure));
      await page.evaluate(() => { window.__mrtMutation = null; });

      await page.setViewport({ width: 620, height: 900 });
      await page.waitForFunction(() => matchMedia('(max-width: 700px)').matches);
      const narrowAge = await page.$eval(
        '#age-event-era-results .timeline-year-row:not(.is-empty)',
        (row) => {
          const marker = row.querySelector('.timeline-year-marker').getBoundingClientRect();
          const cards = row.querySelector('.timeline-year-cards').getBoundingClientRect();
          return {
            viewport: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            markerPosition: getComputedStyle(row.querySelector('.timeline-year-marker')).position,
            markerBottom: Math.round(marker.bottom),
            cardsTop: Math.round(cards.top),
            columns: new Set([...row.querySelectorAll('.catalog-card')]
              .map((card) => Math.round(card.getBoundingClientRect().left))).size,
          };
        },
      );
      t.check('a narrow age spine puts its year above one-column cards without overflow',
        narrowAge.markerPosition === 'relative'
        && narrowAge.markerBottom <= narrowAge.cardsTop
        && narrowAge.columns === 1
        && narrowAge.scrollWidth <= narrowAge.viewport,
        JSON.stringify(narrowAge));
      await page.setViewport({ width: 1280, height: 900 });

      await click(page, '#age-event-era-results [data-story="bc-third"] [data-act="preview"]');
      await page.waitForSelector('#preview[open] input[data-key="browser-check-three-short"]');
      await click(page, '#preview input[data-key="browser-check-three-short"]');
      await click(page, '#preview-close');
      await page.waitForFunction(() => !document.querySelector('#preview')?.open);
      const repainted = await page.$eval(
        '#age-event-era-results [data-story="bc-third"] [data-act="import"]',
        (button) => button.getAttribute('aria-label'),
      );
      t.check('closing Preview repaints the chosen reading option on the age leaf',
        repainted?.includes('Third Stop: The Short Way'), repainted);

      await click(page, '#age-event-era-results [data-story="bc-third"] [data-act="import"]');
      await page.waitForFunction(() => document.querySelector('#view-read')?.hidden === false);
      const imported = await page.$eval('#order-name', (heading) => heading.textContent.trim());
      t.check('Add from an age leaf imports through the existing catalog flow',
        imported === 'Browser Check Order', imported);

      await open(page, '/#/age-event-era');
      await page.waitForSelector('#age-event-era-results .catalog-card', { timeout: 15000 });
      await click(page, '#age-event-era-results [data-story="bc-third"] [data-act="preview"]');
      await page.waitForSelector('#preview[open]');
      await click(page, '#preview-add [data-act="main"]');
      await page.waitForFunction(() =>
        document.querySelector('#view-read')?.hidden === false
        && !document.querySelector('#preview')?.open);
      const openedFromPreview = await page.evaluate(() => ({
        dialogOpen: document.querySelector('#preview')?.open ?? null,
        readHidden: document.querySelector('#view-read')?.hidden ?? null,
        heading: document.querySelector('#order-name')?.textContent.trim() ?? '',
      }));
      t.check('Preview Open closes the dialog and leaves the saved Reading List usable',
        openedFromPreview.dialogOpen === false
        && openedFromPreview.readHidden === false
        && openedFromPreview.heading === 'Browser Check Order',
        JSON.stringify(openedFromPreview));

      await open(page, '/#/age-golden');
      await page.waitForSelector('#age-golden-results .publishing-empty', { timeout: 15000 });
      const empty = await page.evaluate(() => {
        const visible = [...document.querySelectorAll('.view')].filter((panel) => !panel.hidden);
        return {
          visible: visible.map((panel) => panel.id),
          heading: document.querySelector('#age-golden-h')?.textContent.trim(),
          range: document.querySelector('#view-age-golden .publishing-range')?.textContent.trim(),
          count: document.querySelector('#age-golden-count')?.textContent.trim(),
          message: document.querySelector('#age-golden-results .publishing-empty')?.textContent.trim(),
          timeline: Boolean(document.querySelector('#age-golden-results .timeline-flow')),
        };
      });
      t.check('a hidden empty category remains a complete honest direct page',
        JSON.stringify(empty) === JSON.stringify({
          visible: ['view-age-golden'],
          heading: 'Browse Golden Age',
          range: '1939 to 1955',
          count: '0 Reading Lists',
          message: 'No Reading Lists are published for this period yet.',
          timeline: false,
        }), JSON.stringify(empty));

      await page.setViewport({ width: 390, height: 844 });
      await open(page, '/#/age-modern');
      await page.waitForSelector('#age-modern-category-list .home-path', { timeout: 15000 });
      const narrow = await page.$$eval('#age-modern-category-list .home-path', (paths) => paths.map((path) => {
        const box = path.getBoundingClientRect();
        return { top: Math.round(box.top), width: Math.round(box.width) };
      }));
      t.check('Modern periods stack without horizontal clipping at the narrow viewport',
        narrow.length === FIXTURE_MODERN_PERIODS.length
        && new Set(narrow.map(({ top }) => top)).size === narrow.length
        && narrow.every(({ width }) => width > 280 && width < 390),
        JSON.stringify(narrow));

      await open(page, '/#/marvel-ages');
      await page.waitForSelector('#marvel-ages-modern-list .home-path', { timeout: 15000 });
      const narrowGateway = await page.evaluate(() => {
        const paths = [...document.querySelectorAll('#marvel-ages-results .home-path')];
        const aggregate = document.querySelector('#marvel-ages-modern-all')?.getBoundingClientRect();
        return {
          columns: new Set(paths.map((path) => Math.round(path.getBoundingClientRect().left))).size,
          targets: paths.map((path) => Math.round(path.getBoundingClientRect().height)),
          aggregateHeight: Math.round(aggregate?.height ?? 0),
          viewport: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      t.check('the narrow Marvel Ages gateway keeps one column and usable targets',
        narrowGateway.columns === 1
        && narrowGateway.targets.every((height) => height >= 44)
        && narrowGateway.aggregateHeight >= 44
        && narrowGateway.scrollWidth <= narrowGateway.viewport,
        JSON.stringify(narrowGateway));

      await page.evaluate(() => localStorage.setItem('mrt.catalog.fixture', 'empty'));
      await open(page, '/?catalog=empty#/home');
      await page.waitForFunction(() => !document.querySelector('#home-paths-status')
        ?.textContent.includes('Loading'), { timeout: 15000 });
      const emptyHomeHasGateway = await page.$(
        '#home-secondary-paths [data-category="marvel-ages"]',
      );
      t.check('an empty catalog hides Marvel Ages from Home', emptyHomeHasGateway === null);
      await open(page, '/?catalog=empty#/marvel-ages');
      await page.waitForSelector('#marvel-ages-results .publishing-empty', { timeout: 15000 });
      const emptyGateway = await page.evaluate(() => ({
        count: document.querySelector('#marvel-ages-count')?.textContent.trim() ?? '',
        message: document.querySelector('#marvel-ages-results .publishing-empty')
          ?.textContent.trim() ?? '',
        groups: document.querySelectorAll('#marvel-ages-results .marvel-ages-group').length,
      }));
      t.check('the direct empty gateway stays honest without empty groups',
        JSON.stringify(emptyGateway) === JSON.stringify({
          count: '0 Reading Lists',
          message: 'No Reading Lists are published by age yet.',
          groups: 0,
        }), JSON.stringify(emptyGateway));

      await page.evaluate(() => localStorage.setItem('mrt.catalog.fixture', 'sparse'));
      await open(page, '/?catalog=sparse#/age-silver');
      await page.waitForSelector('#age-silver-results .catalog-card', { timeout: 15000 });
      const sparseSilver = await page.evaluate(() => ({
        count: document.querySelector('#age-silver-count')?.textContent.trim() ?? '',
        cards: document.querySelectorAll('#age-silver-results .catalog-card').length,
        timeline: Boolean(document.querySelector('#age-silver-results .timeline-flow')),
      }));
      await open(page, '/?catalog=sparse#/age-bronze');
      await page.waitForSelector('#age-bronze-results .catalog-card', { timeout: 15000 });
      const sparseBronze = await page.evaluate(() => ({
        count: document.querySelector('#age-bronze-count')?.textContent.trim() ?? '',
        cards: document.querySelectorAll('#age-bronze-results .catalog-card').length,
        timeline: Boolean(document.querySelector('#age-bronze-results .timeline-flow')),
      }));
      t.check('one-list and two-list ages keep the ordinary leaf timeline',
        JSON.stringify(sparseSilver) === JSON.stringify({
          count: '1 Reading List', cards: 1, timeline: true,
        })
        && JSON.stringify(sparseBronze) === JSON.stringify({
          count: '2 Reading Lists', cards: 2, timeline: true,
        }),
        JSON.stringify({ sparseSilver, sparseBronze }));

      t.check('the publishing fixture exposes all current populated top-level age shapes',
        FIXTURE_PUBLISHING_AGES.map(({ key }) => key).join('/') === 'silver/bronze/copper/modern',
        JSON.stringify(FIXTURE_PUBLISHING_AGES));
    },
  },
  {
    id: 'copy-density',
    title: 'standing explanations yield to compact labels and disclosures',
    async run(page, t) {
      await open(page, '/');

      const browse = [];
      for (const [view, category] of [
        ['catalog', 'timeline'],
        ['lines', 'storylines'],
        ['spotlights', 'character-spotlights'],
      ]) {
        await openBrowseCategory(page, category);
        await page.waitForSelector(`#${view}-results .catalog-card`, { timeout: 15000 });
        browse.push(await page.$eval(`#view-${view}`, (section) => ({
          view: section.id,
          subtitle: section.querySelector('.head .sub')?.textContent.trim() ?? null,
          blurbs: [...section.querySelectorAll('.shelf-section-blurb')]
            .map((node) => node.textContent.trim()),
        })));
      }
      t.check('browse headings carry no sentence that repeats the screen structure',
        browse.every((screen) => screen.subtitle === null), JSON.stringify(browse));
      t.check('Timeline keeps era context while Storylines drops decade explanations',
        browse[0].blurbs.length > 0 && browse[0].blurbs.every((text) => text.length > 40)
        && browse[1].blurbs.length === 0,
        JSON.stringify(browse));

      const destinations = [];
      for (const view of ['add-search', 'add-series', 'add-creator', 'add-import', 'add-manual']) {
        await click(page, `[data-view="${view}"]`);
        destinations.push(await page.$eval(`#view-${view}`, (section) => ({
          view: section.id,
          header: section.querySelector('.head .add-target')?.textContent.trim() ?? null,
          card: section.querySelector('.add-page > .add-destination')?.textContent.trim() ?? null,
        })));
      }
      t.check('each Add page names its destination once inside the working card',
        destinations.every((entry) => entry.header === null && entry.card?.startsWith('Adding to:')),
        JSON.stringify(destinations));
      const manual = await page.$eval('#view-add-manual', (section) => ({
        action: section.querySelector('#btn-manual-lookup')?.textContent.trim(),
        summaries: [...section.querySelectorAll('details > summary')].map((summary) => summary.textContent.trim()),
        open: [...section.querySelectorAll('details')]
          .find((details) => details.querySelector(':scope > summary')?.textContent.trim() === 'What lookup sends')?.open,
      }));
      t.check('manual lookup names its destination and starts with privacy detail collapsed',
        manual.action === 'Look up on Marvel Fandom'
        && manual.summaries.includes('What lookup sends') && manual.open === false,
        JSON.stringify(manual));

      await openBrowseCategory(page, 'timeline');
      await click(page, IMPORT_BUTTON);
      await page.waitForFunction(() => document.querySelector('#shelf-note')?.textContent.trim() === '2 issues');
      const shelfNote = await page.$eval('#shelf-note', (node) => node.textContent.trim());
      t.check('the reading shelf reports only its issue count', shelfNote === '2 issues', shelfNote);

      await click(page, '[data-view="progress"]');
      await page.waitForFunction(() => !document.querySelector('#progress-method')?.hidden);
      const progress = await page.$eval('#view-progress', (section) => ({
        directNotes: [...section.children].filter((node) => node.matches('.rail-hint')).length,
        oldNote: Boolean(section.querySelector('#progress-note, #progress-sub')),
        methodOpen: section.querySelector('#progress-method')?.open,
        methodLabel: section.querySelector('#progress-method > summary')?.textContent.trim(),
      }));
      t.check('Progress keeps methodology in one collapsed disclosure',
        progress.directNotes === 0 && !progress.oldNote
        && progress.methodOpen === false && progress.methodLabel === 'How counts work',
        JSON.stringify(progress));

      await click(page, '[data-view="data"]');
      const settings = await page.$$eval('#view-data .setting', (cards) => cards.map((card) => ({
        heading: card.querySelector('h3')?.textContent.trim(),
        standing: card.querySelector('.setting-desc')?.textContent.trim() ?? null,
        control: card.querySelector('.setting-ctl')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      })));
      const theme = settings.find((card) => card.heading === 'Theme');
      const updates = settings.find((card) => card.heading === 'Update checks');
      t.check('Settings controls no longer repeat themselves in adjacent descriptions',
        theme?.standing === null && updates?.standing === null && updates?.control === 'Check once a day',
        JSON.stringify({ theme, updates }));

      const libraryHeads = await page.$$eval(
        '#view-library-read .head, #view-library-manual .head',
        (heads) => heads.map((head) => Boolean(head.querySelector('.sub'))),
      );
      t.check('Library headings leave sorting to compact labels beside populated results',
        libraryHeads.every((hasSub) => !hasSub), JSON.stringify(libraryHeads));
    },
  },
  {
    id: 'hub-navigation',
    title: 'fixed rail delegates growing choices to Library, Browse, and Add',
    async run(page, t) {
      await open(page, '/');
      await page.waitForSelector('#home-primary-paths .home-path', { timeout: 15000 });
      await page.setViewport({ width: 1280, height: 900 });

      await click(page, '.ri[data-view="browse"]');
      await page.waitForSelector('#view-browse [data-primary-paths] .home-path', { timeout: 15000 });
      const gateway = await page.evaluate(() => {
        const read = (root) => [...document.querySelectorAll(`${root} [data-primary-paths] .home-path`)]
          .map((path) => ({
            category: path.dataset.category,
            title: path.querySelector('.home-path-title')?.textContent.trim(),
            count: path.querySelector('.home-path-count')?.textContent.trim(),
          }));
        return {
          home: read('#view-home'),
          browse: read('#view-browse'),
          hash: location.hash,
          current: document.querySelector('.ri[aria-current="page"]')?.dataset.view,
        };
      });
      t.check('Browse renders the same available categories and counts as Home',
        JSON.stringify(gateway.home) === JSON.stringify(gateway.browse),
        JSON.stringify(gateway));
      t.check('the Browse hub owns its address and selected rail state',
        gateway.hash === '#/browse' && gateway.current === 'browse',
        JSON.stringify(gateway));

      await click(page, '#view-browse [data-category="storylines"]');
      await page.waitForFunction(() => document.querySelector('#view-lines')?.hidden === false);
      const browseChild = await page.evaluate(() => ({
        hash: location.hash,
        current: document.querySelector('.ri[aria-current="page"]')?.dataset.view,
      }));
      t.check('a category child keeps Browse selected',
        browseChild.hash === '#/lines' && browseChild.current === 'browse',
        JSON.stringify(browseChild));

      await click(page, '.ri[data-view="add"]');
      await page.waitForFunction(() => document.querySelector('#view-add')?.hidden === false);
      const addChoices = await page.$$eval('#view-add .search-hub-card', (buttons) => (
        buttons.map((button) => button.dataset.view)
      ));
      t.check('Add groups the five add methods on one hub',
        JSON.stringify(addChoices) === JSON.stringify([
          'add-search', 'add-series', 'add-creator', 'add-import', 'add-manual',
        ]),
        JSON.stringify(addChoices));
      await click(page, '#view-add [data-view="add-manual"]');
      const addChild = await page.evaluate(() => ({
        hash: location.hash,
        current: document.querySelector('.ri[aria-current="page"]')?.dataset.view,
      }));
      t.check('an Add child keeps Add selected',
        addChild.hash === '#/add-manual' && addChild.current === 'add',
        JSON.stringify(addChild));

      await click(page, '.ri[data-view="library"]');
      await page.waitForFunction(() => document.querySelector('#view-library')?.hidden === false);
      const libraryChoices = await page.$$eval('#view-library .library-tools [data-view]', (buttons) => (
        buttons.map((button) => button.dataset.view)
      ));
      t.check('Library groups its three library-wide destinations',
        JSON.stringify(libraryChoices) === JSON.stringify(['library-read', 'progress', 'library-manual']),
        JSON.stringify(libraryChoices));
      await click(page, '#view-library [data-view="progress"]');
      const libraryChild = await page.evaluate(() => ({
        hash: location.hash,
        current: document.querySelector('.ri[aria-current="page"]')?.dataset.view,
      }));
      t.check('a Library child keeps Library selected',
        libraryChild.hash === '#/progress' && libraryChild.current === 'library',
        JSON.stringify(libraryChild));

      const rail = await page.evaluate(() => {
        const scroll = document.querySelector('.nav-scroll');
        return {
          rows: [...document.querySelectorAll('#sidebar .ri')].map((button) => button.dataset.view ?? 'continue'),
          childRows: document.querySelectorAll(
            '#sidebar .ri[data-view="catalog"], #sidebar .ri[data-view="lines"], '
              + '#sidebar .ri[data-view="spotlights"], #sidebar .ri[data-view^="add-"], '
              + '#sidebar .ri[data-view="progress"], #sidebar .ri[data-view^="library-"]',
          ).length,
          scrollHeight: scroll.scrollHeight,
          clientHeight: scroll.clientHeight,
        };
      });
      t.check('the rail has no category, Add method, saved-list collection, or Library report rows',
        rail.childRows === 0 && rail.rows.length <= 6,
        JSON.stringify(rail));
      t.check('the fixed rail fits without vertical scrolling at the reference viewport',
        rail.scrollHeight <= rail.clientHeight,
        JSON.stringify(rail));
    },
  },
  {
    id: 'reading-path',
    title: 'the shelf says where a story sits in a reading order',
    async run(page, t) {
      await open(page, '/');
      await openBrowseCategory(page, 'timeline');
      await page.waitForSelector('#catalog-results .catalog-card', { timeout: 15000 });

      const rows = await page.$$eval('#catalog-results .catalog-card', (els) => els.map((e) => ({
        title: e.querySelector('.catalog-card-title')?.textContent.trim() ?? '',
        meta: e.querySelector('.catalog-card-meta')?.textContent.trim() ?? '',
        source: e.querySelector('.result-source')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
        step: e.querySelector('.path-step')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
        pathSummary: e.querySelector('.result-path summary')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
        year: e.dataset.year ?? '',
      })));

      const row = (name) => rows.find((r) => r.title === name);
      const first = row('Browser Check Order');
      const middle = row('Second Stop');
      const last = row('Third Stop');

      t.check('the shelf draws one card per event story, not one per reading',
        rows.length === FIXTURE_SHELVES.get('catalog').length,
        `${rows.length} cards: ${rows.map((r) => r.title).join(' / ')}`);
      t.check('a story read two ways is on the shelf under its own name', Boolean(last), rows.map((r) => r.title).join(' / '));

      t.check('the first stop is badged so a reader can find it at a glance', first?.pathSummary === 'Start · 1/3', JSON.stringify(first));
      t.check('and still says how long the path is', first?.step?.includes('Step 1 of 3') === true, JSON.stringify(first));
      t.check('and names the path it belongs to', first?.step?.includes('The Fixture Path') === true, JSON.stringify(first?.step));
      t.check('and names the exact source section without changing its link', first?.source?.includes('Section: Fixture section') === true, JSON.stringify(first?.source));

      t.check('a middle stop is numbered', middle?.pathSummary === 'Step 2/3', JSON.stringify(middle));
      // Deliberately absent. The shelf is sorted by year, so the previous stop is the row above,
      // and printing it made the longest thing on the line a copy of the line before it.
      t.check('and does not restate the stop above it', middle?.step?.includes('Browser Check Order') === false, JSON.stringify(middle?.step));
      // The step named the short reading; the shelf row is the story. If the app echoed the step
      // this would read "Next: Third Stop: The Short Way" and point at a row nobody can see.
      t.check('and names the next stop by its story, not by one reading of it', middle?.step?.includes('Next: Third Stop') === true && !middle.step.includes('Short Way'), JSON.stringify(middle?.step));

      t.check('the last stop says the path ends there', last?.step?.includes('Last stop') === true, JSON.stringify(last?.step));
      t.check('and is numbered last', last?.pathSummary === 'Step 3/3', JSON.stringify(last));
      t.check('and offers no next stop to go to', last?.step?.includes('Next:') === false, JSON.stringify(last?.step));

      await page.$$eval('#catalog-results .catalog-card', (cards) => {
        const card = cards.find((row) => row.querySelector('.catalog-card-title')?.textContent.trim() === 'Second Stop');
        card?.querySelector('.result-path summary')?.click();
      });
      const expandedPath = await page.$$eval('#catalog-results .catalog-card', (cards) => {
        const card = cards.find((row) => row.querySelector('.catalog-card-title')?.textContent.trim() === 'Second Stop');
        const details = card?.querySelector('.result-path');
        return {
          open: details?.open ?? false,
          text: details?.querySelector('.path-step')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
        };
      });
      t.check('opening the compact marker reveals the full path and next-stop wording',
        expandedPath.open
        && expandedPath.text.includes('The Fixture Path')
        && expandedPath.text.includes('Next: Third Stop'),
        JSON.stringify(expandedPath));

      t.check('the compact card keeps the issue count', first?.meta === '3 issues', JSON.stringify(first?.meta));
      t.check('a dated order carries its year as the Timeline destination', first?.year === '2004', JSON.stringify(first?.year));

      await openBrowseCategory(page, 'character-spotlights');
      await page.waitForSelector('#spotlights-results .catalog-card', { timeout: 15000 });
      const off = await page.$eval('#spotlights-results .catalog-card', (e) => ({
        title: e.querySelector('.catalog-card-title')?.textContent.trim() ?? '',
        step: e.querySelector('.path-step')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
        year: e.dataset.year ?? '',
      }));
      t.check('a story on no path says nothing about one', off.title === 'Off The Path' && off.step === null, JSON.stringify(off));
      t.check('and an undated spotlight claims no Timeline destination', off.year === '', JSON.stringify(off.year));
    },
  },
  {
    id: 'rail-collapse',
    title: 'collapsing the sidebar does not reach into the shelf',
    async run(page, t) {
      await open(page, '/');
      await openBrowseCategory(page, 'timeline');
      await page.waitForSelector('#catalog-results .result-path > summary', { timeout: 15000 });

      const read = () => page.evaluate(() => {
        const box = (e) => {
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), colour: getComputedStyle(e).color };
        };
        return {
          badge: box(document.querySelector('#catalog-results .result-path > summary')),
          status: box(document.querySelector('#api-status')),
          nav: (() => {
            const rail = document.querySelector('#sidebar').getBoundingClientRect();
            const scroll = document.querySelector('.nav-scroll');
            const icon = document.querySelector('.ri[data-view="browse"] .gi').getBoundingClientRect();
            const button = document.querySelector('.ri[data-view="browse"]').getBoundingClientRect();
            const style = getComputedStyle(scroll);
            return {
              railLeft: Math.round(rail.left),
              railRight: Math.round(rail.right),
              iconLeft: Math.round(icon.left),
              iconRight: Math.round(icon.right),
              buttonWidth: Math.round(button.width),
              overflowY: style.overflowY,
              scrollbarWidth: style.scrollbarWidth,
            };
          })(),
        };
      });

      const before = await read();
      // Set directly rather than through the toggle: what is under test is the stylesheet, and
      // the toggle also persists a preference this check has no business writing.
      await page.evaluate(() => document.querySelector('#shell').classList.add('railed'));
      await page.waitForFunction(() => document.querySelector('#sidebar').getBoundingClientRect().width <= 50);
      const after = await read();

      const invisible = (c) => /rgba\(\d+, \d+, \d+, 0\)/.test(c ?? '');
      t.check('the path marker has a usable target to begin with',
        (before.badge?.w ?? 0) > 50 && (before.badge?.h ?? 0) >= 24,
        JSON.stringify(before.badge));
      t.check('and is still that size once the sidebar is collapsed', after.badge?.w === before.badge?.w, `${before.badge?.w} then ${after.badge?.w}`);
      t.check('and its text is still painted', !invisible(after.badge?.colour), JSON.stringify(after.badge?.colour));
      t.check('and compact navigation keeps its icons visible while remaining scrollable',
        after.nav.scrollbarWidth === 'none'
        && after.nav.overflowY === 'auto'
        && after.nav.buttonWidth >= 44
        && after.nav.iconLeft >= after.nav.railLeft
        && after.nav.iconRight <= after.nav.railRight,
        JSON.stringify(after.nav));
      // The other half of the same claim. A fix that scoped the rule away entirely would pass the
      // three above and quietly cost the rail the dot it is supposed to collapse to.
      t.check('while the rail status pill still collapses to a dot', (after.status?.w ?? 99) <= 12, JSON.stringify(after.status));
    },
  },
  {
    id: 'import',
    title: 'a curated order can be imported from the catalog',
    async run(page, t) {
      await open(page, '/');
      await openBrowseCategory(page, 'timeline');
      await page.waitForSelector(IMPORT_BUTTON, { timeout: 15000 });
      t.check('the catalog offers the order', true);

      await click(page, IMPORT_BUTTON);
      await page.waitForSelector('#view-read:not([hidden])', { timeout: 15000 });
      await openFullOrder(page);

      const rows = await page.$$eval('#rows .row', (els) => els.length);
      t.check('every issue in the order is on screen', rows === ORDER_COUNT, `${rows} rows, expected ${ORDER_COUNT}`);

      const titles = await page.$$eval('#rows .rt', (els) => els.map((e) => e.textContent.trim()));
      t.check('the issues are the ones the order names', titles.join('|') === EXPECTED_TITLES.join('|'), titles.join(' / '));

      const saved = await readState(page);
      const lists = Object.values(saved?.lists ?? {});
      t.check('the import was written to storage', lists.length === 1, `${lists.length} list(s) saved`);
      t.check('the saved list carries the order', (lists[0]?.itemIds?.length ?? 0) === ORDER_COUNT, `${lists[0]?.itemIds?.length ?? 0} item(s) saved`);
    },
  },
  {
    id: 'navigation',
    title: 'the address bar tracks the view, and back returns to it',
    async run(page, t) {
      await importOrder(page);

      const readHash = await page.evaluate(() => location.hash);
      t.check('the reading view has an address of its own', readHash.length > 1, JSON.stringify(readHash));

      await click(page, '.brand[data-view="home"]');
      await page.waitForFunction('location.hash !== ' + JSON.stringify(readHash), { timeout: 15000 });
      const homeHash = await page.evaluate(() => location.hash);
      t.check('home has a different address', homeHash !== readHash, `${JSON.stringify(homeHash)} vs ${JSON.stringify(readHash)}`);
      t.check('home is the visible view', await visibleView(page) === 'view-home', await visibleView(page));

      await page.goBack({ waitUntil: 'load' }).catch(() => {});
      await page.waitForFunction('location.hash === ' + JSON.stringify(readHash), { timeout: 15000 }).catch(() => {});
      t.check('back returns to the reading view', await page.evaluate(() => location.hash) === readHash, await page.evaluate(() => location.hash));
      t.check('and the reading view is what is shown', await visibleView(page) === 'view-read', await visibleView(page));
    },
  },
  {
    id: 'persistence',
    title: 'progress survives a reload',
    async run(page, t) {
      await importOrder(page);

      await click(page, 'button.cb[data-act="read"][data-key="900001"]');
      await page.waitForFunction(
        'document.querySelector(\'button.cb[data-act="read"][data-key="900001"]\')?.getAttribute("aria-pressed") === "true"',
        { timeout: 15000 },
      );
      t.check('an issue can be marked read', true);

      const before = await readState(page);
      // Not a substring search over the serialised state: createList already writes the issue id
      // into the list's itemIds, so `includes('900001')` is true the moment the order imports and
      // says nothing about the mark. Read marks live in their own map, keyed by issue id.
      const marked = Object.prototype.hasOwnProperty.call(before?.read ?? {}, '900001');
      t.check('the mark reached storage', marked, `read keys: ${JSON.stringify(Object.keys(before?.read ?? {}))}`);

      await page.reload({ waitUntil: 'load' });
      await openFullOrder(page);

      const pressed = await page.$eval('button.cb[data-act="read"][data-key="900001"]', (el) => el.getAttribute('aria-pressed'));
      t.check('the mark is still there after a reload', pressed === 'true', `aria-pressed=${pressed}`);

      const others = await page.$$eval('button.cb[data-act="read"]', (els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').length);
      t.check('and only the issue that was marked is marked', others === 1, `${others} marked read`);
    },
  },
  {
    id: 'recovery',
    title: 'unreadable saved data is met with an offer rather than a wipe',
    async run(page, t) {
      await importOrder(page);
      const real = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
      t.check('there is real progress to lose', typeof real === 'string' && real.length > 0);

      // A schema from the future is the shape the store was built for: valid JSON that migrate()
      // refuses, which is what a downgrade after using a newer build actually looks like.
      const corrupt = JSON.stringify({ schemaVersion: 99, lists: {}, note: 'from a newer build' });
      await page.evaluate((bytes) => {
        localStorage.setItem('mrt.state.v2', bytes);
      }, corrupt);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#blocked-banner:not([hidden])', { timeout: 15000 });
      t.check('the reader is told, rather than finding an empty tracker', true);

      const why = await page.$eval('#blocked-why', (el) => el.textContent.trim());
      t.check('the banner says why', why.length > 0, JSON.stringify(why));

      // Presence is not the claim. Both buttons are static markup inside the banner, so
      // querySelector finds them on a perfectly healthy app with the banner hidden. What the
      // shipped copy promises is that the reader can act on them, so the query is scoped to the
      // banner only while it is showing, and asks whether each button is reachable and enabled.
      //
      // checkVisibility() with no argument answers a narrower question than it looks like it does:
      // it defaults every option off and so returns true for both `visibility: hidden` and
      // `opacity: 0`. The second is not hypothetical here. `src/styles.css:841` hides the row
      // actions with exactly `opacity: 0`, so it is this stylesheet's established way of putting a
      // control out of reach, and the defaults are blind to it. Measured in the same Edge this
      // drives: with the two buttons faded that way both rows passed while nothing sat under the
      // pointer at either button's centre.
      const offers = await page.evaluate(() => {
        const banner = document.querySelector('#blocked-banner:not([hidden])');
        const usable = (sel) => {
          const el = banner?.querySelector(sel);
          if (!el) return { found: false, visible: false, enabled: false };
          const visible = el.checkVisibility({
            visibilityProperty: true,
            opacityProperty: true,
            contentVisibilityAuto: true,
          });
          return { found: true, visible, enabled: !el.disabled };
        };
        return { download: usable('#btn-download-salvage'), fresh: usable('#btn-start-fresh') };
      });
      t.check(
        'a copy of the unreadable data can be downloaded',
        offers.download.found && offers.download.visible && offers.download.enabled,
        JSON.stringify(offers.download),
      );
      t.check(
        'and starting fresh is offered as a separate, second choice',
        offers.fresh.found && offers.fresh.visible && offers.fresh.enabled,
        JSON.stringify(offers.fresh),
      );

      const salvaged = await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('mrt.state.salvage')));
      t.check('the unreadable bytes were copied aside before anything else', salvaged);

      // The other half of "rather than a wipe", and the half a salvage copy alone cannot show.
      // The banner promises the original has not been changed or deleted, so compare it byte for
      // byte with what was written, not merely for presence.
      const kept = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
      t.check(
        'and the unreadable original is still there, byte for byte',
        kept === corrupt,
        kept === null ? 'the key is gone' : `${kept.length} bytes vs ${corrupt.length}`,
      );
    },
  },
  {
    id: 'handoff',
    title: 'the reader tab opens synchronously, inside the gesture',
    async run(page, t) {
      await importOrder(page);

      // The proof that no await intervenes is that the call is recorded during the click's own
      // dispatch. A handler that opened the tab after any await would record it afterwards, and
      // that is the shape constraint 7 says the browser blocks. The recorder itself was installed
      // before the app loaded, in preparePage.
      await page.evaluate(() => { window.__opened = []; });

      await page.evaluate(() => {
        const btn = document.querySelector('button.mini[data-act="open"][data-key="900001"]');
        window.__dispatching = true;
        btn.click();
        window.__dispatching = false;
      });

      const opened = await page.evaluate(() => window.__opened);
      t.check('clicking Read opens exactly one tab', opened.length === 1, `${opened.length} call(s)`);
      t.check('and it opens during the click itself, with no await in between', opened[0]?.dispatching === true);

      const url = opened[0]?.url ?? '';
      t.check('the tab goes to our own launcher, not straight to Marvel', url.includes('/open.html?'), url);
      t.check('carrying the reference we already hold', url.includes('d=700001'), url);
      t.check('and opened without handing over a window reference', (opened[0]?.features ?? '').includes('noopener'), opened[0]?.features);

      // The second issue has no digitalId, so the launcher has to resolve one. It must still open
      // synchronously: waiting for the lookup is what loses the user activation.
      await page.evaluate(() => {
        window.__opened = [];
        const btn = document.querySelector('button.mini[data-act="open"][data-key="900002"]');
        window.__dispatching = true;
        btn.click();
        window.__dispatching = false;
      });
      const second = await page.evaluate(() => window.__opened);
      t.check('an issue with no reference still opens a tab at once', second.length === 1 && second[0].dispatching === true, JSON.stringify(second));
      // Require the record before reading it. A bare negated substring reports this as satisfied
      // when nothing was opened at all, which is the one case it is meant to catch, and it reads
      // the parameter rather than the string so a title containing "d=" cannot decide it.
      const asks = second.length === 1
        && !new URL(second[0].url, page.__origin).searchParams.has('d');
      t.check('and asks the launcher to resolve it', asks, JSON.stringify(second.map((o) => o.url)));
    },
  },
  {
    id: 'synopsis',
    title: 'a synopsis run counts what it was told, not what it asked',
    async run(page, t) {
      // Registered before the first navigation, because the stub in preparePage is installed the
      // same way and a flag set after load is one the app has already gone past. Read at fetch
      // time rather than at install time so the two orderings cannot matter.
      await page.evaluateOnNewDocument(() => { window.__mrtSynopsis = 'refuse'; });
      await importOrder(page);

      await click(page, '#btn-synopsis');
      await page.waitForFunction(() => document.querySelector('#ask')?.open === true, { timeout: 15000 });
      await click(page, '#ask-ok');

      // Waiting on the harness's own count of refusals rather than on the status line, and rather
      // than on a clock. The line is what is under test, so waiting for it to name a refusal makes
      // a broken build starve the wait and report a timeout instead of the claim that failed; and
      // the run is three issues at 400ms each, so a fixed sleep is either too early to have lost
      // anything or late enough that the queue has emptied.
      await page.waitForFunction(() => (window.__mrtRefused ?? 0) >= 1, { timeout: 20000 });

      // Read and stopped inside one evaluation on purpose. Reading the line, returning it, and
      // then sending a second call to click stop leaves a gap in which the run can finish, and a
      // finished run makes the claim untestable rather than false.
      const at = await page.evaluate(() => {
        const line = document.querySelector('#synopsis-status')?.textContent ?? '';
        const stop = document.querySelector('#btn-cancel-synopsis');
        const going = stop?.hidden === false;
        stop?.click();
        return { line, going };
      });
      t.check('the run against a refusing service was still going when it was stopped', at.going, JSON.stringify(at));

      const running = /^Fetching synopses (\d+) of (\d+)/.exec(at.line);
      t.check('a running line counts none of the refusals as fetched',
        !!running && Number(running[1]) === 0 && Number(running[2]) === ORDER_COUNT, JSON.stringify(at.line));
      t.check('a running line names what it could not reach',
        / \d+ could not be reached\.$/.test(at.line), JSON.stringify(at.line));

      await page.waitForFunction(
        () => /^Stopped after /.test(document.querySelector('#synopsis-status')?.textContent ?? ''),
        { timeout: 15000 },
      );
      const after = await page.evaluate(() => ({
        line: document.querySelector('#synopsis-status')?.textContent ?? '',
        fetchHidden: document.querySelector('#btn-synopsis')?.hidden ?? null,
      }));

      const stopped = /^Stopped after (\d+) of (\d+)\./.exec(after.line);
      t.check('a stopped run counts none of the refused requests as fetched',
        !!stopped && Number(stopped[1]) === 0 && Number(stopped[2]) === ORDER_COUNT, JSON.stringify(after.line));
      // Asserted apart from the count, because the two are separate promises made by separate
      // fixes. Deleting the failure clause from the stopped line leaves every other assertion here
      // green, so without this the first fix of this series would be the one part of it that
      // nothing watched.
      t.check('a stopped run names what it could not reach',
        /^Stopped after \d+ of \d+\. \d+ could not be reached\.$/.test(after.line), JSON.stringify(after.line));
      // The one that matters most. Both lines read the same counter, and while only some of the
      // readers subtracted the failures the number moved backwards in front of the reader at the
      // moment they pressed stop: a run showing three fetched became a run that had stopped after
      // none.
      t.check('and the count a stop leaves behind is the one that was already on screen',
        !!running && !!stopped && running[1] === stopped[1], `${JSON.stringify(at.line)} then ${JSON.stringify(after.line)}`);
      t.check('the fetch button comes back once the run is stopped', after.fetchHidden === false, JSON.stringify(after));
    },
  },
  {
    id: 'wiki-lookup',
    title: 'a hand entry can take facts and an issue id from the wiki, and refuses one it already holds',
    async run(page, t) {
      // Set before the first navigation, so the stub is in place before any code reads it.
      await page.evaluateOnNewDocument(() => { window.__mrtWiki = 'ok'; });
      await open(page, '/');
      await click(page, '[data-view="add-manual"]');
      await page.waitForSelector('#btn-manual-lookup', { visible: true, timeout: 15000 });

      await page.evaluate(() => { document.querySelector('#manual-title').value = 'Fixture Vol 7 26'; });
      await click(page, '#btn-manual-lookup');
      await page.waitForFunction(
        () => document.querySelectorAll('#manual-candidates .result').length > 0,
        { timeout: 15000 },
      );

      const offered = await page.evaluate(() => Array.from(
        document.querySelectorAll('#manual-candidates .result'),
        (row) => ({
          title: row.querySelector('.result-title')?.textContent ?? '',
          meta: row.querySelector('.result-meta')?.textContent ?? '',
        }),
      ));
      // The series page is in the search results and must not be in the chooser. The search is
      // fuzzy enough to return one for almost any issue query, and a series page carries no
      // release date, so a chooser that offered it would offer a row that fills nothing.
      t.check('the chooser drops the series page and keeps the issue',
        offered.length === 1 && offered[0].title === 'Fixture Vol 7 26', JSON.stringify(offered));
      t.check('and shows the facts it would fill in',
        /2026-03-04/.test(offered[0]?.meta ?? '') && /32 pages/.test(offered[0]?.meta ?? ''), JSON.stringify(offered));
      // The allowlist is the whole of the licence position, so it is checked where a reader would
      // see it break rather than only in a unit test.
      t.check('and no prose from the page reaches the form',
        !/must never reach/i.test(JSON.stringify(offered)), JSON.stringify(offered));

      await click(page, '#manual-candidates .result .btn');
      await page.waitForFunction(
        () => document.querySelector('#manual-title')?.value === 'Fixture Vol 7 26',
        { timeout: 15000 },
      );

      await click(page, '#form-manual button[type="submit"]');
      await page.waitForFunction(
        () => (document.querySelector('#manual-report')?.textContent ?? '').includes('Added'),
        { timeout: 15000 },
      );

      const stored = await readState(page);
      const kept = stored?.issues?.['129648'] ?? null;
      t.check("the entry is stored under Marvel's own issue id", !!kept, JSON.stringify(Object.keys(stored?.issues ?? {})));
      t.check('carrying the release date, the page count and the credits',
        kept?.onSale === '2026-03-04' && kept?.pageCount === 32 && (kept?.creators ?? []).length === 2,
        JSON.stringify(kept));

      // The point of taking the id at all. A hand entry on a synthetic negative id has no link to
      // the comic's own page, because the launcher refuses to build one for an id Marvel does not
      // use. This is that absence being filled, and it is checked through the same helper the
      // Read button uses rather than by matching a string this scenario made up.
      const link = await page.evaluate(async () => {
        const mod = await import('/js/reader.js');
        const state = JSON.parse(localStorage.getItem('mrt.state.v2'));
        return mod.detailUrl(state.issues['129648']);
      });
      t.check('so the launcher can build the official page for it',
        link === 'https://www.marvel.com/comics/issue/129648/', JSON.stringify(link));

      // Same id, second time. addIssuesToList merges into state.issues before it decides whether
      // the list already held the id, so an unguarded collision would rewrite the entry above
      // while reporting that nothing was added.
      await page.evaluate(() => {
        window.__mrtWikiAlt = true;
        document.querySelector('#manual-title').value = 'Fixture Vol 7 26 again';
        document.querySelector('#manual-report').replaceChildren();
      });
      await click(page, '#btn-manual-lookup');
      await page.waitForFunction(
        () => document.querySelectorAll('#manual-candidates .result').length > 0,
        { timeout: 15000 },
      );
      await click(page, '#manual-candidates .result .btn');
      await click(page, '#form-manual button[type="submit"]');
      await page.waitForFunction(
        () => (document.querySelector('#manual-report')?.textContent ?? '').length > 0,
        { timeout: 15000 },
      );

      const after2 = await page.evaluate(() => document.querySelector('#manual-report')?.textContent ?? '');
      t.check('a second entry for an issue already held is refused, and says so',
        /nothing was added and nothing was changed/.test(after2), JSON.stringify(after2));

      const end = await readState(page);
      // The second answer carries a different date, a different page count and a different writer
      // for the same id. Without the guard the merge lands before the list membership check, so
      // these three would already have been replaced by the time the reader was told that nothing
      // was added.
      t.check('and the entry it would have overwritten is untouched',
        end?.issues?.['129648']?.onSale === '2026-03-04'
        && end?.issues?.['129648']?.pageCount === 32
        && (end?.issues?.['129648']?.creators ?? []).some((c) => c.name === 'Fixture Writer')
        && Object.keys(end?.issues ?? {}).length === Object.keys(stored?.issues ?? {}).length,
        JSON.stringify(end?.issues?.['129648']));

      // The same collision reached by the other door. A guard keyed on the wiki's id does not close
      // this one, because a pasted address outranks that id while the accepted match's facts are
      // written regardless, so the facts land on an issue the guard never examined. Measured on the
      // unguarded build: seven fields of a held issue replaced while the call reported added=0 and
      // skipped=1, so the reader was told nothing was added at the moment it stopped being true.
      const beforeCross = JSON.stringify(end?.issues?.['129648'] ?? null);
      await page.evaluate(() => {
        window.__mrtWikiId = 777001;
        document.querySelector('#manual-title').value = 'Fixture Vol 7 26 elsewhere';
        document.querySelector('#manual-url').value = '';
        document.querySelector('#manual-report').replaceChildren();
      });
      await click(page, '#btn-manual-lookup');
      await page.waitForFunction(
        () => document.querySelectorAll('#manual-candidates .result').length > 0,
        { timeout: 15000 },
      );
      await click(page, '#manual-candidates .result .btn');
      // Filled after the match is accepted, which is the whole of why this is reachable: what
      // withdraws an accepted match is the title box changing, so the address box can be pointed at
      // a different comic with the first comic's facts still held and ready to be written.
      await page.evaluate(() => {
        document.querySelector('#manual-url').value = 'https://www.marvel.com/comics/issue/129648/';
      });
      await click(page, '#form-manual button[type="submit"]');
      await page.waitForFunction(
        () => (document.querySelector('#manual-report')?.textContent ?? '').length > 0,
        { timeout: 15000 },
      );

      const cross = await page.evaluate(() => document.querySelector('#manual-report')?.textContent ?? '');
      t.check('facts steered onto a held issue by a pasted address are refused as well',
        /nothing was added and nothing was changed/.test(cross), JSON.stringify(cross));

      const endCross = await readState(page);
      t.check('and that issue is byte for byte what it was, with nothing new stored',
        JSON.stringify(endCross?.issues?.['129648'] ?? null) === beforeCross
        && Object.keys(endCross?.issues ?? {}).length === Object.keys(end?.issues ?? {}).length,
        JSON.stringify(endCross?.issues?.['129648']));
    },
  },
  {
    id: 'manual-book-id',
    title: 'a pasted reader address becomes a working Read button, and a marvel.com address says so',
    async run(page, t) {
      await open(page, '/');
      await click(page, '[data-view="add-manual"]');
      await page.evaluate(() => {
        const d = document.querySelector('#manual-url')?.closest('details');
        if (d && !d.open) d.open = true;
      });
      await page.waitForSelector('#manual-url', { timeout: 15000 });

      // The hint is the only place that says which of the two addresses gets you a working Read
      // button, and the field points at it, so a screen reader reaches that from the field rather
      // than only by reading past it. This is the first aria-describedby in the page.
      const hint = await page.evaluate(() => {
        const input = document.querySelector('#manual-url');
        const id = input?.getAttribute('aria-describedby') ?? null;
        const p = id ? document.getElementById(id) : null;
        return { id, text: (p?.textContent ?? '').replace(/\s+/g, ' ').trim() };
      });
      t.check('the address field names its own explanation', hint.id === 'manual-url-hint', JSON.stringify(hint.id));
      t.check('and that explanation says where to get the address',
        /paste.*Marvel Unlimited.*Read/i.test(hint.text), hint.text.slice(0, 100));

      await addByHand(page, 'All-New Spider-Gwen: The Ghost-Spider (2026) #9', 'https://read.marvel.com/#/book/129648');
      const readerSaid = await manualReport(page);
      t.check('a reader address is reported as reaching Marvel Unlimited',
        readerSaid.includes('Read opens it in Marvel Unlimited'), readerSaid);

      const afterReader = await readState(page);
      const byReader = Object.values(afterReader?.issues ?? {}).find((i) => i.digitalId === 129648) ?? null;
      t.check('the book id was read off the address and saved', Boolean(byReader),
        JSON.stringify(Object.values(afterReader?.issues ?? {}).map((i) => i.digitalId)));
      // A reader address kept as the issue url would light up Info, which says marvel.com and
      // would open the reader the Read button already opens. Nothing offers it, so nothing to see.
      t.check('and the reader address was not kept as a detail page',
        (byReader?.url ?? null) === null, JSON.stringify(byReader?.url));

      await addByHand(page, 'Secret Wars (2015) #1', 'https://www.marvel.com/comics/issue/52447/secret_wars');
      const detailSaid = await manualReport(page);
      t.check('a marvel.com address is reported without promising the reader',
        detailSaid.includes('Availability shows as unknown') && !detailSaid.includes('Read opens it'), detailSaid);

      const afterDetail = await readState(page);
      const byDetail = afterDetail?.issues?.['52447'] ?? null;
      t.check('that one keeps the marvel.com address it was given',
        String(byDetail?.url ?? '').includes('/comics/issue/52447'), JSON.stringify(byDetail?.url));
      t.check('and carries no book id, because none was stated',
        (byDetail?.digitalId ?? null) === null, JSON.stringify(byDetail?.digitalId));
    },
  },
  {
    id: 'undo-delete-dismiss',
    // The reported defect was that this message never went away. It is held for the session on
    // purpose, because a timer would take the way back while the reader was still deciding, so
    // what is checked here is that holding it and being able to close it are both true at once.
    title: 'the message left by a delete follows the reader, and closes when they say so',
    async run(page, t) {
      await importOrder(page);
      const listName = CATALOG.lists[0].name;

      await deleteActiveList(page);
      await page.waitForSelector('#app-report .notice', { timeout: 15000 });

      const readNotice = () => page.evaluate(() => {
        const n = document.querySelector('#app-report .notice');
        if (!n) return null;
        return {
          msg: n.querySelector('.grow')?.textContent.trim() ?? '',
          buttons: [...n.querySelectorAll('button')].map((b) => b.textContent.trim()),
        };
      });

      const offered = await readNotice();
      t.check('the delete is reported with the progress promise', offered.msg === `Deleted ${listName}. Reading progress was kept.`, JSON.stringify(offered.msg));
      t.check('the way back is offered first', offered.buttons[0] === 'Undo delete', JSON.stringify(offered.buttons));
      t.check('and a way to close the message beside it', offered.buttons[1] === 'Dismiss', JSON.stringify(offered.buttons));
      t.check('the message offers exactly those two', offered.buttons.length === 2, JSON.stringify(offered.buttons));

      // The behaviour the reader complained about, pinned rather than removed: the offer outlives
      // the screen it was made on, because that is the only thing keeping the undo reachable.
      await openBrowseCategory(page, 'timeline');
      await page.waitForSelector('#catalog-results .catalog-card', { timeout: 15000 });
      const elsewhere = await readNotice();
      t.check('it is still there after the reader changes screen', elsewhere?.buttons.join('/') === 'Undo delete/Dismiss', JSON.stringify(elsewhere));

      await clickNoticeButton(page, 'Dismiss');
      await page.waitForFunction(() => !document.querySelector('#app-report .notice'), { timeout: 15000 });
      t.check('dismissing takes the message away', (await readNotice()) === null, 'a notice is still on screen');

      // Removing the pressed button drops focus to <body>, which is the silent landing BL-054 was
      // filed for. Dismissing has to leave the reader somewhere they can navigate from.
      const landed = await page.evaluate(() => ({
        tag: document.activeElement?.tagName ?? null,
        id: document.activeElement?.id ?? null,
        outline: getComputedStyle(document.activeElement).outline,
      }));
      t.check('focus lands visibly on the heading of the screen being read, not on the body',
        landed.tag !== 'BODY' && landed.id === 'catalog-h'
        && landed.outline.includes('solid') && !landed.outline.startsWith('0px'),
        JSON.stringify(landed));

      const afterDismiss = await readState(page);
      t.check('dismissing does not put the list back', Object.keys(afterDismiss?.lists ?? {}).length === 0, JSON.stringify(Object.keys(afterDismiss?.lists ?? {})));

      // Dismissing spends the undo rather than hiding it, so the offer must not come back on its
      // own. A live buffer behind a closed message would raise a fresh notice from somewhere else.
      await click(page, '.brand[data-view="home"]');
      t.check('and the offer does not reappear on the next screen', (await readNotice()) === null, 'the dismissed notice came back');

      // The way back still works for a reader who takes it, which is what dismissing must not cost.
      await importOrder(page);
      await deleteActiveList(page);
      await page.waitForSelector('#app-report .notice', { timeout: 15000 });
      await clickNoticeButton(page, 'Undo delete');
      await page.waitForFunction(() => !document.querySelector('#app-report .notice'), { timeout: 15000 });

      const afterUndo = await readState(page);
      const names = Object.values(afterUndo?.lists ?? {}).map((l) => l.name);
      t.check('undo still puts the list back', names.includes(listName), JSON.stringify(names));
    },
  },
  {
    id: 'updates',
    title: 'a release notice offers the zip without blocking startup',
    async run(page, t) {
      await open(page, '/');
      const currentAsked = await page.waitForFunction(() => (window.__mrtUpdateRequests ?? 0) >= 1, { timeout: 15000 })
        .then(() => true, () => false);
      const current = await readUpdateNotice(page);
      t.check('the running version makes one local stub request and paints no update notice',
        currentAsked && current.notice === null, JSON.stringify(current));

      await click(page, '[data-view="about"]');
      await click(page, '#btn-check-updates');
      const currentReportReady = await page.waitForFunction(
        () => /This is the latest version/.test(document.querySelector('#update-check-report')?.textContent ?? ''),
        { timeout: 15000 },
      ).then(() => true, () => false);
      const currentReport = await readUpdateReport(page);
      t.check('the explicit check says the running version is current',
        currentReportReady && currentReport.text.includes(`You have ${APP_VERSION}`), JSON.stringify(currentReport));

      await setUpdateMode(page, 'newer');
      await open(page, '/');
      const appeared = await page.waitForSelector('#app-report .notice', { timeout: 15000 })
        .then(() => true, () => false);
      const newer = await readUpdateNotice(page);
      t.check('a newer release paints the update notice', appeared && newer.notice !== null, JSON.stringify(newer));
      t.check('the update notice names both versions',
        newer.text.includes('Version 9.9.9 is available') && newer.text.includes(`You have ${APP_VERSION}`),
        JSON.stringify(newer.text));
      t.check('the update notice download uses the stable zip link',
        newer.download === UPDATE_DOWNLOAD_URL, JSON.stringify(newer.links));
      t.check('the release notes link is present',
        newer.notes === UPDATE_RELEASE_NOTES_URL, JSON.stringify(newer.links));
      t.check('the copy says reading progress stays in the browser',
        /reading progress is saved by your browser/.test(newer.text), JSON.stringify(newer.text));
      t.check('the copy says the old folder can be deleted',
        /delete the old folder/.test(newer.text), JSON.stringify(newer.text));

      await setUpdateMode(page, 'newer', { updateChecks: false });
      await open(page, '/');
      const off = await readUpdateNotice(page);
      t.check('switching automatic checks off prevents the boot request',
        off.requests === 0 && off.updateChecked === false && off.notice === null, JSON.stringify(off));

      await click(page, '[data-view="about"]');
      await click(page, '#btn-check-updates');
      const manualReady = await page.waitForFunction(
        () => /Version 9\.9\.9 is available/.test(document.querySelector('#update-check-report')?.textContent ?? ''),
        { timeout: 15000 },
      ).then(() => true, () => false);
      const manual = await readUpdateReport(page);
      t.check('the explicit check still works when automatic checks are off',
        manualReady && manual.download === UPDATE_DOWNLOAD_URL && manual.notes === UPDATE_RELEASE_NOTES_URL,
        JSON.stringify(manual));

      await setUpdateMode(page, 'hang');
      await open(page, '/');
      const rendered = await page.waitForSelector('#view-home:not([hidden])', { timeout: 4000 })
        .then(() => true, () => false);
      t.check('a hanging update check still lets the app render', rendered, await visibleView(page));

      let navigated = false;
      if (rendered) {
        await click(page, '[data-view="about"]');
        navigated = await visibleView(page) === 'view-about';
      }
      t.check('and the rendered app remains usable while the request is unsettled', navigated, await visibleView(page));
    },
  },
  {
    id: 'issue-focus',
    title: 'issue details stay separate from reading progress and return focus to their source',
    async run(page, t) {
      const browserErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text());
      });
      page.on('pageerror', (error) => browserErrors.push(error.message));

      await open(page, '/');
      await openBrowseCategory(page, 'timeline');
      await click(page, IMPORT_BUTTON);
      await page.waitForSelector('#view-read:not([hidden])', { timeout: 15000 });

      const coming = await page.evaluate(() => {
        const tile = document.querySelector('#shelf .tile');
        const inspect = tile?.querySelector('.tile-focus');
        const read = tile?.querySelector('.tile-read');
        return {
          inspect: !!inspect,
          read: !!read,
          nested: !!inspect?.contains(read) || !!read?.contains(inspect),
          rows: document.querySelectorAll('#rows .row').length,
          state: localStorage.getItem('mrt.state.v2'),
        };
      });
      t.check('Coming up exposes separate non-nested Inspect and Read actions',
        coming.inspect && coming.read && !coming.nested, JSON.stringify(coming));
      t.check('opening no full-order rows is part of the issue-focus starting state',
        coming.rows === 0, `${coming.rows} row(s)`);

      await page.evaluate(() => {
        const link = document.querySelector('#shelf .tile .tile-focus');
        link.focus();
        link.click();
      });
      await page.waitForSelector('#view-issue:not([hidden]) #issue-focus-card:not([hidden])');
      const focused = await page.evaluate(() => ({
        hash: location.hash,
        title: document.querySelector('#issue-focus-h')?.textContent.trim(),
        state: localStorage.getItem('mrt.state.v2'),
        requests: window.__mrtIssueRequests ?? 0,
        rows: document.querySelectorAll('#rows .row').length,
        read: !document.querySelector('#btn-issue-read')?.hidden,
        info: !document.querySelector('#btn-issue-info')?.hidden,
      }));
      t.check('Coming up inspection opens the canonical saved-list route',
        /^#\/issue\/900002\?list=/.test(focused.hash), focused.hash);
      t.check('the dedicated view renders the selected issue with distinct external actions',
        focused.title === ORDER.items[1].title && focused.read && focused.info, JSON.stringify(focused));
      t.check('saved issue focus makes no detail request and does not render the closed full order',
        focused.requests === 0 && focused.rows === 0, JSON.stringify(focused));
      t.check('opening and rendering issue focus leave saved state byte for byte unchanged',
        focused.state === coming.state, 'saved state changed');

      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#view-issue:not([hidden]) #issue-focus-card:not([hidden])');
      const reloaded = await page.evaluate(() => ({
        hash: location.hash,
        title: document.querySelector('#issue-focus-h')?.textContent.trim(),
        active: document.activeElement?.id ?? null,
        state: localStorage.getItem('mrt.state.v2'),
      }));
      t.check('reload keeps the issue route without stealing initial focus',
        reloaded.hash === focused.hash && reloaded.title === focused.title && reloaded.active !== 'issue-focus-h',
        JSON.stringify(reloaded));
      t.check('reload still leaves saved state byte for byte unchanged',
        reloaded.state === coming.state, 'saved state changed');

      await page.evaluate(() => history.back());
      await page.waitForSelector('#view-read:not([hidden])');
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
      const returned = await page.evaluate((savedState) => ({
        issueId: document.activeElement?.dataset.issueId ?? null,
        active: document.activeElement?.outerHTML?.slice(0, 300) ?? null,
        historyState: history.state,
        stateSame: localStorage.getItem('mrt.state.v2') === savedState,
      }), coming.state);
      t.check('Back restores focus to the Coming up inspect link',
        returned.issueId === '900002' && returned.stateSame, JSON.stringify(returned));

      await page.evaluate(() => history.forward());
      await page.waitForSelector('#view-issue:not([hidden]) #issue-focus-card:not([hidden])');
      await page.waitForFunction(() => document.activeElement?.id === 'issue-focus-h');
      t.check('Forward returns to issue focus and names the destination through its heading', true);

      await page.evaluate(() => {
        sessionStorage.setItem('mrt.issue-focus.negative', '1');
        location.hash = '#/issue/-900004?order=browser-check';
      });
      await page.waitForFunction(
        () => document.querySelector('#issue-focus-h')?.textContent.trim() === 'Local Browser Check Issue',
      );
      const negative = await page.evaluate((savedState) => ({
        hash: location.hash,
        requests: window.__mrtIssueRequests ?? 0,
        context: document.querySelector('#issue-focus-context')?.textContent.trim(),
        synopsisHidden: document.querySelector('#btn-issue-synopsis')?.hidden,
        stateSame: localStorage.getItem('mrt.state.v2') === savedState,
      }), coming.state);
      t.check('a direct negative bundled issue resolves only through validated order membership',
        negative.hash === '#/issue/-900004?order=browser-check'
          && negative.context.includes(CATALOG.lists[0].name)
          && negative.requests === 0,
        JSON.stringify(negative));
      t.check('a negative bundled issue offers no upstream synopsis and writes no state',
        negative.synopsisHidden && negative.stateSame, JSON.stringify(negative));

      await open(page, '/');
      await openBrowseCategory(page, 'timeline');
      await click(page, '#catalog-results [data-act="preview"]');
      await page.waitForSelector('#preview[open] .preview-issue-link');
      const previewState = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
      await page.evaluate(() => {
        const link = document.querySelector('#preview .preview-issue-link');
        link.focus();
        link.click();
      });
      await page.waitForSelector('#view-issue:not([hidden]) #issue-focus-card:not([hidden])');
      const preview = await page.evaluate((savedState) => ({
        hash: location.hash,
        dialog: document.querySelector('#preview')?.open ?? null,
        requests: window.__mrtIssueRequests ?? 0,
        stateSame: localStorage.getItem('mrt.state.v2') === savedState,
      }), previewState);
      t.check('an unsaved Preview issue closes the dialog and carries catalog context',
        preview.hash === '#/issue/900001?order=browser-check' && preview.dialog === false,
        JSON.stringify(preview));
      t.check('bundled Preview focus makes no detail request and writes no state',
        preview.requests === 0 && preview.stateSame, JSON.stringify(preview));

      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#view-issue:not([hidden]) #issue-focus-card:not([hidden])');
      await page.evaluate(() => history.back());
      await page.waitForSelector('#preview[open] .preview-issue-link');
      await page.waitForFunction(() => document.activeElement?.classList.contains('preview-issue-link'));
      const previewReturn = await page.evaluate((savedState) => ({
        issueId: document.activeElement?.dataset.issueId ?? null,
        stateSame: localStorage.getItem('mrt.state.v2') === savedState,
      }), previewState);
      t.check('Back from a reloaded Preview issue reopens the dialog and restores its link',
        previewReturn.issueId === '900001' && previewReturn.stateSame,
        JSON.stringify(previewReturn));

      await click(page, '#preview-close');
      await page.waitForFunction(() => !document.querySelector('#preview')?.open);
      await click(page, '#list-nav .ri[data-act="open"]');
      await openFullOrder(page);
      await page.evaluate(() => {
        const link = document.querySelector('#rows .row-focus-title');
        link.focus();
        link.click();
      });
      await page.waitForSelector('#view-issue:not([hidden]) #issue-focus-card:not([hidden])');
      await page.evaluate(() => history.back());
      await page.waitForSelector('#view-read:not([hidden]) #rows .row-focus-title');
      await page.waitForFunction(() => document.activeElement?.classList.contains('row-focus-title'));
      t.check('Back restores the exact full-order link that opened issue focus', true);

      await openFullOrder(page);
      for (let guard = 0; guard < ORDER_COUNT; guard += 1) {
        const unread = await page.$('#rows [data-act="read"][aria-pressed="false"]');
        if (!unread) break;
        await page.evaluate((node) => node.click(), unread);
      }
      await click(page, '.ri[data-view="library"]');
      await click(page, '#view-library [data-view="library-read"]');
      await page.waitForSelector('#view-library-read .result-focus');
      const readState = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
      await page.evaluate(() => {
        const link = document.querySelector('#view-library-read .result-focus');
        link.focus();
        link.click();
      });
      await page.waitForSelector('#view-issue:not([hidden]) #issue-focus-card:not([hidden])');
      const everything = await page.evaluate((savedState) => ({
        hash: location.hash,
        stateSame: localStorage.getItem('mrt.state.v2') === savedState,
      }), readState);
      t.check('Everything read opens issue-only focus without inventing list context',
        /^#\/issue\/90000[1-3]$/.test(everything.hash), everything.hash);
      t.check('Everything read inspection leaves its completed progress unchanged',
        everything.stateSame, 'saved state changed');

      await page.evaluate(() => history.back());
      await page.waitForSelector('#view-library-read:not([hidden]) .result-focus');
      await page.waitForFunction(() => document.activeElement?.classList.contains('result-focus'));
      t.check('Back restores focus to the Everything read issue link', true);

      await click(page, '.brand[data-view="home"]');
      await page.evaluate(() => history.back());
      await page.waitForSelector('#view-library-read:not([hidden]) .result-focus');
      await page.waitForFunction(() => document.activeElement?.id === 'library-read-h');
      const reusedSource = await page.evaluate(() => ({
        active: document.activeElement?.id ?? null,
        opener: history.state?.issueFocusOpener ?? null,
      }));
      t.check('a later navigation consumes the old opener before that source entry is reused',
        reusedSource.active === 'library-read-h' && reusedSource.opener === null,
        JSON.stringify(reusedSource));

      await page.setViewport({ width: 320, height: 800 });
      await page.evaluate(() => document.querySelector('#view-library-read .result-focus').click());
      await page.waitForSelector('#view-issue:not([hidden]) #issue-focus-card:not([hidden])');
      const narrow = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        targets: [...document.querySelectorAll('#view-issue .cta > :not([hidden])')]
          .every((node) => node.getBoundingClientRect().height >= 40),
      }));
      t.check('issue focus stays usable at 320 pixels without horizontal clipping',
        narrow.overflow <= 1 && narrow.targets, JSON.stringify(narrow));
      t.check('the issue-focus journeys produce no console or page errors',
        browserErrors.length === 0, browserErrors.join(' / '));
    },
  },
  {
    id: 'reading-screen',
    title: 'the reading screen uses the desktop it is given and states progress in words',
    async run(page, t) {
      await importOrder(page);
      await openFullOrder(page);

      await page.setViewport({ width: 1280, height: 900 });
      await page.$eval('#shelf .tile .lab b', (label) => {
        label.textContent = 'Browser Check with a Deliberately Long Title #2';
      });
      const measure = () => page.evaluate(() => {
        const px = (el) => (el ? Math.round(el.getBoundingClientRect().width) : 0);
        const shelf = document.querySelector('#shelf');
        const tiles = [...document.querySelectorAll('#shelf .tile')];
        const size = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
        return {
          view: px(document.querySelector('#view-read')),
          art: px(document.querySelector('.hero .art')),
          shelfOverflow: shelf ? shelf.scrollWidth - shelf.clientWidth : 999,
          tiles: tiles.length,
          rows: new Set(tiles.map((el) => Math.round(el.getBoundingClientRect().top))).size,
          shelfBeforeFull: document.querySelector('#shelf-sec')?.getBoundingClientRect().top
            < document.querySelector('#full')?.getBoundingClientRect().top,
          buttonBottomSpread: (() => {
            const rows = new Map();
            for (const tile of tiles) {
              const row = Math.round(tile.getBoundingClientRect().top);
              const bottom = Math.round(tile.querySelector('.tile-read').getBoundingClientRect().bottom);
              rows.set(row, [...(rows.get(row) ?? []), bottom]);
            }
            return Math.max(0, ...[...rows.values()].map((bottoms) => Math.max(...bottoms) - Math.min(...bottoms)));
          })(),
          // The widest gap between two tiles sharing a row. It is the figure that catches a shelf
          // whose empty space went into the tracks instead of to the end of the row.
          widestGap: (() => {
            const r = tiles.map((el) => el.getBoundingClientRect());
            let worst = 0;
            for (let i = 1; i < r.length; i += 1) {
              if (Math.round(r[i].top) !== Math.round(r[i - 1].top)) continue;
              worst = Math.max(worst, Math.round(r[i].left - r[i - 1].right));
            }
            return worst;
          })(),
          label: document.querySelector('#ring-label')?.textContent ?? '',
          sub: document.querySelector('#ring-sub')?.textContent ?? '',
          ringTitle: document.querySelector('#ring-wrap')?.getAttribute('title'),
          primary: size(document.querySelector('#btn-hero-read')),
          secondary: size(document.querySelector('#btn-hero-done')),
          linkFill: getComputedStyle(document.querySelector('#btn-hero-info')).backgroundColor,
          strip: getComputedStyle(document.querySelector('.list-tools')).borderTopWidth,
          toolNames: [...document.querySelectorAll('.list-tools .quiet')]
            .filter((el) => !el.hidden).map((el) => el.textContent.trim()),
          reachable: [...document.querySelectorAll('.list-tools .quiet')]
            .every((el) => el.tabIndex >= 0 && !el.disabled),
        };
      });

      const narrow = await measure();
      // The prose measure is 876. A reading view still sitting on it is one the wrapper's extra
      // width never reached, which is the state this change was opened against.
      t.check('the reading view is wider than the prose measure', narrow.view > 876, `${narrow.view}px`);
      t.check('the hero cover is the largest thing on the screen', narrow.art >= 200, `${narrow.art}px`);
      t.check('no upcoming issue is clipped off the shelf', narrow.shelfOverflow <= 1, `${narrow.shelfOverflow}px of overflow`);
      t.check('Coming up appears before the full Reading List', narrow.shelfBeforeFull, JSON.stringify(narrow));
      t.check('Read actions share a baseline despite different title lengths',
        narrow.buttonBottomSpread <= 1, `${narrow.buttonBottomSpread}px spread`);
      t.check('the progress percentage is readable text', /^\d+%$/.test(narrow.label), JSON.stringify(narrow.label));
      t.check('and the issue count is said beside it', /^\d+ of \d+ read$|All read|Nothing in this list/.test(narrow.sub), JSON.stringify(narrow.sub));
      t.check('the percentage is no longer hidden in a tooltip', narrow.ringTitle === null, JSON.stringify(narrow.ringTitle));
      t.check('one call to action is larger than the rest', narrow.primary > narrow.secondary, `${narrow.primary} vs ${narrow.secondary}`);
      t.check('the way out of the app is drawn as a link, not a button', /, 0\)$/.test(narrow.linkFill), narrow.linkFill);
      t.check('the demoted tools keep a bounding edge', parseFloat(narrow.strip) > 0, narrow.strip);
      t.check('and every one of them is still there and still reachable',
        narrow.toolNames.length >= 5 && narrow.reachable, narrow.toolNames.join(' / '));

      await page.setViewport({ width: 2560, height: 1080 });
      const wide = await measure();
      t.check('a wider display gives the reading view more room', wide.view > narrow.view, `${narrow.view}px then ${wide.view}px`);
      t.check('and the whole shelf lands on one row', wide.tiles > 0 && wide.rows === 1, `${wide.tiles} tiles over ${wide.rows} row(s)`);
      t.check('with nothing clipped there either', wide.shelfOverflow <= 1, `${wide.shelfOverflow}px of overflow`);

      // A nearly finished order is the ordinary end state, and it is the one an auto-fit grid got
      // wrong: the collapsed tracks handed their width to the survivors, so the last tiles sat a
      // measured 487px apart on a declared 14.4px gap. Read down to a short shelf and measure it.
      // The declared gap is .9rem, so anything past about 20px is space that went into a track.
      const GAP = 20;
      t.check('a full shelf sits at its declared gap', wide.widestGap <= GAP, `${wide.widestGap}px`);

      // The row separator and the current row's accent outline compete for one top edge, and they
      // only meet when the current row directly follows another row. An untouched order puts the
      // current row first, and this order renders a list per series, so the current row starts a
      // list every time it crosses into a new one. Mark issues read until it is mid-list, which is
      // the state a reader is in for most of an order, then read all four edges.
      const currentRowEdges = () => page.evaluate(() => {
        const el = document.querySelector('.rows .row.now');
        if (!el) return null;
        const s = getComputedStyle(el);
        const prev = el.previousElementSibling;
        return {
          afterRow: !!prev && prev.classList.contains('row'),
          colors: [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor],
        };
      });
      const markRead = async () => {
        const was = await page.$eval('#hero-title', (el) => el.textContent);
        await page.evaluate(() => document.querySelector('#btn-hero-done')?.click());
        await page.waitForFunction(
          (t) => document.querySelector('#hero-title')?.textContent !== t, { timeout: 15000 }, was,
        );
      };
      let edges = await currentRowEdges();
      for (let guard = 0; guard < 10 && edges && !edges.afterRow; guard += 1) {
        await markRead();
        edges = await currentRowEdges();
      }
      t.check('the current issue keeps a whole outline once there are read issues above it',
        edges !== null && edges.afterRow && new Set(edges.colors).size === 1,
        edges ? `after a row: ${edges.afterRow}, edges ${edges.colors.join(' / ')}` : 'no current row');

      for (let guard = 0; guard < 100; guard += 1) {
        const left = await page.$$eval('#shelf .tile', (els) => els.length);
        if (left <= 3) break;
        await markRead();
      }
      const few = await measure();
      t.check('and so does a nearly finished one, rather than stranding its last covers',
        few.tiles > 0 && few.tiles <= 3 && few.widestGap <= GAP,
        `${few.tiles} tiles, widest gap ${few.widestGap}px`);
    },
  },
  {
    id: 'full-order-performance',
    title: 'the 219-row Reading List stays absent while closed and reuses rows after one change',
    async run(page, t) {
      await importLongOrder(page);
      const closed = await page.$$eval('#rows .row', (rows) => rows.length);
      t.check('an ordinary closed arrival creates zero issue rows', closed === 0, `${closed} row(s)`);

      await page.evaluate(() => document.querySelector('#full > summary').click());
      await page.waitForSelector('#rows .row', { timeout: 15000 });
      const measured = await page.evaluate(() => {
        const before = [...document.querySelectorAll('#rows .row')];
        document.querySelector('#rows [data-act="read"][aria-pressed="false"]')?.click();
        const after = [...document.querySelectorAll('#rows .row')];
        const reused = after.filter((node) => before.includes(node)).length;
        return { total: after.length, reused, rebuilt: after.length - reused };
      });
      t.check('opening creates all 219 rows',
        measured.total === 219, JSON.stringify(measured));
      t.check('one read toggle reuses at least 217 rows and rebuilds no more than two',
        measured.reused >= 217 && measured.rebuilt <= 2, JSON.stringify(measured));
    },
  },
  {
    id: 'full-order-discoverability',
    title: 'the full Reading List is prominent, explicit, lazy, searchable and stable at 219 rows',
    async run(page, t) {
      const browserErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text());
      });
      page.on('pageerror', (error) => browserErrors.push(error.message));

      await importLongOrder(page);
      const starting = await page.evaluate(() => {
        const full = document.querySelector('#full');
        const shelf = document.querySelector('#shelf-sec');
        const summary = full?.querySelector('summary');
        return {
          hash: location.hash,
          open: full?.open ?? null,
          rows: document.querySelectorAll('#rows .row').length,
          order: full && shelf ? full.compareDocumentPosition(shelf) : 0,
          action: document.querySelector('#full-action')?.textContent.trim(),
          state: document.querySelector('#full-count')?.textContent.trim(),
          summaryHeight: summary?.getBoundingClientRect().height ?? 0,
          active: document.activeElement?.id ?? '',
          focusInRows: document.querySelector('#rows')?.contains(document.activeElement) ?? false,
        };
      });
      t.check('an ordinary 219-issue route stays closed with zero row DOM',
        starting.open === false && starting.rows === 0, JSON.stringify(starting));
      t.check('Coming up precedes the full Reading List and states total and unread counts',
        !!(starting.order & 2)
          && starting.action === 'View all 219 issues'
          && starting.state === '219 unread',
        JSON.stringify(starting));
      t.check('the native summary has a 44 pixel target without taking focus into the unopened rows',
        starting.summaryHeight >= 44 && !starting.focusInRows, JSON.stringify(starting));

      await page.evaluate(() => {
        window.__mrtHistoryWrites = { push: 0, replace: 0 };
        const push = history.pushState.bind(history);
        const replace = history.replaceState.bind(history);
        history.pushState = (...args) => {
          window.__mrtHistoryWrites.push += 1;
          return push(...args);
        };
        history.replaceState = (...args) => {
          window.__mrtHistoryWrites.replace += 1;
          return replace(...args);
        };
      });
      const opened = await page.evaluate(async () => {
        const summary = document.querySelector('#full > summary');
        summary.focus();
        summary.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        window.__mrtLongRows = [...document.querySelectorAll('#rows .row')];
        return {
          hash: location.hash,
          rows: window.__mrtLongRows.length,
          active: document.activeElement === summary,
          action: document.querySelector('#full-action')?.textContent.trim(),
          writes: window.__mrtHistoryWrites,
          found: window.find('Browser Check Long Order #219'),
        };
      });
      t.check('manual opening renders all rows by the first frame and retains summary focus',
        opened.rows === 219 && opened.active, JSON.stringify(opened));
      await page.waitForFunction(() => location.hash.endsWith('?full=1'));
      const manualRoute = await page.evaluate(() => ({
        hash: location.hash,
        action: document.querySelector('#full-action')?.textContent.trim(),
        writes: window.__mrtHistoryWrites,
      }));
      t.check('manual opening replaces once with full intent and changes the action copy',
        manualRoute.hash.endsWith('?full=1')
          && manualRoute.writes.push === 0
          && manualRoute.writes.replace === 1
          && manualRoute.action === 'Hide full Reading List',
        JSON.stringify(manualRoute));
      t.check('browser Find reaches an exact late title after rows exist', opened.found, JSON.stringify(opened));

      await page.evaluate(() => {
        document.querySelector('#rows [data-act="read"][aria-pressed="false"]')?.click();
      });

      const listId = await page.evaluate(() => JSON.parse(localStorage.getItem('mrt.state.v2')).active);
      await open(page, `/?long=1&boot=filter#/read/${encodeURIComponent(listId)}?filter=unread`);
      await page.waitForSelector('#rows .row', { timeout: 15000 });
      const filterIntent = await page.evaluate(() => ({
        hash: location.hash,
        open: document.querySelector('#full')?.open,
        rows: document.querySelectorAll('#rows .row').length,
        active: document.activeElement?.id ?? '',
        focusInRows: document.querySelector('#rows')?.contains(document.activeElement) ?? false,
      }));
      t.check('an explicit filter opens once without adding full intent or moving boot focus',
        filterIntent.hash.endsWith('?filter=unread')
          && filterIntent.open
          && filterIntent.rows === 218
          && !filterIntent.focusInRows,
        JSON.stringify(filterIntent));

      await open(page, `/?long=1&boot=plain#/read/${encodeURIComponent(listId)}`);
      const restored = await page.evaluate(() => ({
        hash: location.hash,
        open: document.querySelector('#full')?.open,
        rows: document.querySelectorAll('#rows .row').length,
        checked: document.querySelector('input[name="filter"]:checked')?.value,
      }));
      t.check('a plain boot with a restored non-default filter stays closed and builds zero rows',
        restored.open === false && restored.rows === 0 && restored.checked === 'unread',
        JSON.stringify(restored));

      await page.evaluate(() => document.querySelector('#btn-hero-done')?.click());
      const passiveStoredFilter = await page.evaluate(() => ({
        hash: location.hash,
        open: document.querySelector('#full')?.open,
        rows: document.querySelectorAll('#rows .row').length,
      }));
      t.check('a progress render cannot turn a restored filter into explicit opening intent',
        !passiveStoredFilter.hash.includes('filter=')
          && passiveStoredFilter.open === false
          && passiveStoredFilter.rows === 0,
        JSON.stringify(passiveStoredFilter));

      const explicitFrame = await page.evaluate(async (id) => {
        const routeApplied = new Promise((resolve) => {
          window.addEventListener('hashchange', resolve, { once: true });
        });
        location.hash = `#/read/${encodeURIComponent(id)}?full=1`;
        await routeApplied;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return {
          open: document.querySelector('#full')?.open,
          rows: document.querySelectorAll('#rows .row').length,
        };
      }, listId);
      t.check('explicit route opening has all rows by the first animation frame',
        explicitFrame.open && explicitFrame.rows === 219, JSON.stringify(explicitFrame));

      await open(page, '/?long=1&boot=about#/about?filter=unread&full=1');
      const nonReading = await page.evaluate(() => ({
        view: document.querySelector('.view:not([hidden])')?.id,
        open: document.querySelector('#full')?.open,
        rows: document.querySelectorAll('#rows .row').length,
      }));
      t.check('a non-reading route does not open or build the hidden reading order',
        nonReading.view === 'view-about' && nonReading.open === false && nonReading.rows === 0,
        JSON.stringify(nonReading));

      await open(page, `/?long=1&boot=full#/read/${encodeURIComponent(listId)}?full=1`);
      await page.waitForSelector('#rows .row', { timeout: 15000 });
      const explicitFull = await page.evaluate(() => ({
        hash: location.hash,
        open: document.querySelector('#full')?.open,
        rows: document.querySelectorAll('#rows .row').length,
      }));
      t.check('a direct full=1 route opens all rows without rewriting its address',
        explicitFull.hash.endsWith('?full=1') && explicitFull.open && explicitFull.rows === 217,
        JSON.stringify(explicitFull));

      await page.focus('#full > summary');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => (
        document.querySelector('#full')?.open === false && !location.hash.includes('full=1')
      ));
      const afterEnter = await page.evaluate(() => ({
        focus: document.activeElement === document.querySelector('#full > summary'),
        hash: location.hash,
      }));
      await page.keyboard.press('Space');
      await page.waitForFunction(() => document.querySelector('#full')?.open === true);
      const afterSpace = await page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return {
          focus: document.activeElement === document.querySelector('#full > summary'),
          rows: document.querySelectorAll('#rows .row').length,
          unique: new Set([...document.querySelectorAll('#rows .row-focus-title')]
            .map((link) => link.getAttribute('href'))).size,
        };
      });
      t.check('Enter closes and Space reopens the native disclosure without moving focus',
        afterEnter.focus && !afterEnter.hash.includes('full=1')
          && afterSpace.focus && afterSpace.rows === 217,
        JSON.stringify({ afterEnter, afterSpace }));
      t.check('reopening never duplicates an issue row',
        afterSpace.unique === 217, JSON.stringify(afterSpace));

      await page.evaluate(() => {
        const link = document.querySelector('#rows .row-focus-title');
        link.focus();
        link.click();
      });
      await page.waitForSelector('#view-issue:not([hidden]) #issue-focus-card:not([hidden])');
      await page.evaluate(() => history.back());
      await page.waitForFunction(() => document.activeElement?.classList.contains('row-focus-title'));
      t.check('Back restores the exact full-order issue link', true);

      await page.evaluate(() => {
        const replace = history.replaceState.bind(history);
        window.__mrtRestoreReplace = replace;
        history.replaceState = (state, title, url) => {
          const opener = state?.issueFocusOpener;
          return replace(opener
            ? { ...state, issueFocusOpener: { ...opener, control: 'missing' } }
            : state, title, url);
        };
        document.querySelector('#rows .row-focus-title').click();
      });
      await page.waitForSelector('#view-issue:not([hidden]) #issue-focus-card:not([hidden])');
      await page.evaluate(() => history.back());
      await page.waitForFunction(() => document.activeElement?.matches('input[name="filter"]:checked'));
      const fallback = await page.evaluate(() => {
        history.replaceState = window.__mrtRestoreReplace;
        return {
          checked: document.activeElement?.value,
          view: document.querySelector('.view:not([hidden])')?.id,
        };
      });
      t.check('Back falls back to the checked filter when the exact opener no longer exists',
        fallback.view === 'view-read' && fallback.checked === 'all', JSON.stringify(fallback));

      await page.setViewport({ width: 320, height: 800 });
      const narrow = await page.evaluate(() => {
        const summary = document.querySelector('#full > summary');
        summary.focus();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          summaryHeight: summary.getBoundingClientRect().height,
          focusVisible: document.activeElement === summary,
          summaryText: summary.textContent.replace(/\s+/g, ' ').trim(),
        };
      });
      t.check('the open disclosure reflows at 320 pixels without horizontal clipping or lost focus',
        narrow.overflow <= 1 && narrow.summaryHeight >= 44 && narrow.focusVisible,
        JSON.stringify(narrow));

      await page.setViewport({ width: 1280, height: 900 });
      const zoomBefore = await page.evaluate(() => ({
        width: innerWidth,
        scale: visualViewport.scale,
      }));
      const client = await page.createCDPSession();
      await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
      const zoomed = await page.evaluate(() => ({
        width: innerWidth,
        scale: visualViewport.scale,
        visualWidth: visualViewport.width,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        focus: document.activeElement === document.querySelector('#full > summary'),
      }));
      t.check('DevTools 200 percent page zoom keeps the summary visible without page clipping',
        zoomed.scale === 2
          && zoomed.visualWidth >= 620 && zoomed.visualWidth <= 660
          && zoomed.overflow <= 1
          && zoomed.focus,
        JSON.stringify({ zoomBefore, zoomed }));
      await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      await client.detach();

      const snapshot = await page.accessibility.snapshot({
        root: await page.$('#full > summary'),
        interestingOnly: false,
      });
      t.check('the native summary exposes its complete name and expanded state',
        /Full Reading List/.test(snapshot?.name ?? '')
          && /Hide full Reading List/.test(snapshot?.name ?? '')
          && /217 unread/.test(snapshot?.name ?? '')
          && snapshot?.expanded === true,
        JSON.stringify(snapshot));
      const forcedColors = await page.evaluate(() => {
        const full = getComputedStyle(document.querySelector('#full'));
        const summary = getComputedStyle(document.querySelector('#full > summary'));
        return {
          active: matchMedia('(forced-colors: active)').matches,
          border: full.borderTopColor,
          background: summary.backgroundColor,
        };
      });
      const forcedColorsRequested = process.argv.includes('--forced-colors');
      t.check('the forced-colors launch preserves a system border and summary surface',
        !forcedColorsRequested || (
          forcedColors.active
            && forcedColors.border !== 'rgba(0, 0, 0, 0)'
            && forcedColors.background !== 'rgba(0, 0, 0, 0)'
        ),
        JSON.stringify(forcedColors));
      t.check('the full-order journeys produce no console or page errors',
        browserErrors.length === 0, browserErrors.join(' / '));
    },
  },
];

// ------------------------------------------------------------------ page helpers

async function open(page, path) {
  await page.goto(`${page.__origin}${path}`, { waitUntil: 'load' });
}

// page.click is unreliable here: an element the app has just rendered is frequently reported as
// not clickable while it is perfectly present and wired. Dispatching the click from inside the
// page is what the app's own handlers see anyway.
async function click(page, selector) {
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.evaluate((s) => document.querySelector(s).click(), selector);
}

async function openBrowseCategory(page, category) {
  await click(page, '.ri[data-view="browse"]');
  const selector = `#view-browse [data-category="${category}"]`;
  await page.waitForSelector(selector, { timeout: 15000 });
  await click(page, selector);
}

async function visibleView(page) {
  return page.evaluate(() => document.querySelector('.view:not([hidden])')?.id ?? null);
}

async function readState(page) {
  const raw = await page.evaluate(() => localStorage.getItem('mrt.state.v2'));
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function importOrder(page) {
  await open(page, '/');
  await openBrowseCategory(page, 'timeline');
  await click(page, IMPORT_BUTTON);
  await page.waitForSelector('#view-read:not([hidden])', { timeout: 15000 });
  await openFullOrder(page);
}

async function importLongOrder(page) {
  await open(page, '/?long=1');
  await openBrowseCategory(page, 'timeline');
  await click(page, IMPORT_BUTTON);
  await page.waitForSelector('#view-read:not([hidden])', { timeout: 15000 });
}

// The delete is guarded by the app's own dialog rather than confirm(), which matters here: a
// native one is auto-dismissed by the driver and the deletion would never happen at all.
async function deleteActiveList(page) {
  await click(page, '#btn-delete-list');
  await page.waitForFunction(() => document.querySelector('#ask')?.open === true, { timeout: 15000 });
  await click(page, '#ask-ok');
  await page.waitForFunction(() => document.querySelector('#ask')?.open !== true, { timeout: 15000 });
}

// Found by its label rather than by position, so a check that the buttons are in a given order
// cannot be the same assertion as a check that pressing one of them works.
//
// Focused before it is pressed, because a synthetic click does not focus its target and the focus
// move being checked here only exists for what happens to a *focused* node when it leaves the
// document. Without this the pressed button never holds focus, removing it cannot drop focus to
// <body>, and the assertion about where focus lands is satisfied by whatever the view switch left
// behind whether the app moves focus or not: green against a tree with the move deleted.
async function clickNoticeButton(page, label) {
  await page.waitForFunction((want) => [...document.querySelectorAll('#app-report .notice button')]
    .some((b) => b.textContent.trim() === want), { timeout: 15000 }, label);
  await page.evaluate((want) => {
    const btn = [...document.querySelectorAll('#app-report .notice button')]
      .find((b) => b.textContent.trim() === want);
    btn.focus();
    btn.click();
  }, label);
}

// The full order lives inside a <details> that starts closed, and main.js deliberately builds no
// rows while it is: opening it is what asks for them. A check that waited for `#rows .row` without
// opening it would wait forever against a perfectly working app.
async function openFullOrder(page) {
  await page.evaluate(() => {
    const d = document.querySelector('#full');
    if (d && !d.open) d.open = true;
  });
  await page.waitForSelector('#rows .row', { timeout: 15000 });
}

// The report line is cleared before submitting rather than after, because the second hand entry
// would otherwise read the first one's answer: waiting for the line to be non-empty is satisfied
// the moment it is asked, and the check would pass against a form that did nothing at all.
async function addByHand(page, title, url) {
  await page.evaluate(() => {
    const report = document.querySelector('#manual-report');
    if (report) report.textContent = '';
  });
  await page.evaluate((t, u) => {
    document.querySelector('#manual-title').value = t;
    document.querySelector('#manual-url').value = u;
  }, title, url);
  await page.evaluate(() => document.querySelector('#form-manual').requestSubmit());
  await page.waitForFunction(
    () => (document.querySelector('#manual-report')?.textContent ?? '').trim().length > 0,
    { timeout: 15000 },
  );
}

async function manualReport(page) {
  return page.evaluate(
    () => (document.querySelector('#manual-report')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

async function setUpdateMode(page, mode, settings = { updateChecks: true, updateCheckedAt: 0 }) {
  await page.evaluate((nextMode, nextSettings) => {
    sessionStorage.setItem('mrt.update.stub', nextMode);
    localStorage.setItem('mrt.settings', JSON.stringify(nextSettings));
  }, mode, settings);
}

async function readUpdateNotice(page) {
  return page.evaluate(() => {
    const notice = document.querySelector('#app-report .notice');
    const links = [...document.querySelectorAll('#app-report .notice a')].map((a) => ({
      label: a.textContent.trim(),
      href: a.href,
    }));
    return {
      requests: window.__mrtUpdateRequests ?? 0,
      updateChecked: document.querySelector('#opt-update-checks')?.checked ?? null,
      notice: notice ? notice.textContent.replace(/\s+/g, ' ').trim() : null,
      text: notice?.querySelector('.grow')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
      links,
      download: links.find((a) => /^Download version /.test(a.label))?.href ?? null,
      notes: links.find((a) => a.label === 'What changed')?.href ?? null,
    };
  });
}

async function readUpdateReport(page) {
  return page.evaluate(() => {
    const report = document.querySelector('#update-check-report');
    const links = [...document.querySelectorAll('#update-check-report a')].map((a) => ({
      label: a.textContent.trim(),
      href: a.href,
    }));
    return {
      text: report?.textContent.replace(/\s+/g, ' ').trim() ?? '',
      links,
      download: links.find((a) => /^Download version /.test(a.label))?.href ?? null,
      notes: links.find((a) => a.label === 'What changed')?.href ?? null,
    };
  });
}

// The stub is installed with evaluateOnNewDocument rather than after load, because the catalog is
// memoized on first read: a stub installed afterwards is a stub the app has already gone past.
async function preparePage(page, origin, mutation) {
  page.__origin = origin;
  await page.setCacheEnabled(false);
  await page.setBypassServiceWorker(true);
  const rewrites = new Map();
  for (const [path, rewrite] of [
    ['/js/main.js', mutation?.rewriteMain],
    ['/js/lib/catalog.js', mutation?.rewriteCatalog],
    ['/js/lib/route.js', mutation?.rewriteRoute],
  ]) {
    if (!rewrite) continue;
    const source = readFileSync(new URL(`../src${path}`, import.meta.url), 'utf8');
    const rewritten = rewrite(source);
    if (rewritten === source) throw new Error(`Mutation ${mutation.id} did not change ${path}`);
    rewrites.set(`${origin}${path}`, rewritten);
  }
  if (rewrites.size > 0) {
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const rewritten = rewrites.get(request.url());
      if (rewritten) {
        await request.respond({
          status: 200,
          contentType: 'application/javascript; charset=utf-8',
          headers: { 'cache-control': 'no-store' },
          body: rewritten,
        });
        return;
      }
      await request.continue();
    });
  }
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(
    (
      catalog, catalogFixtures, order, longOrder, negativeOrderItem, orderFile,
      appVersion, updateApiUrl, defaultApiBase,
    ) => {
      const real = window.fetch.bind(window);
      const json = (body, status = 200) => new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (url.endsWith('data/catalog.json')) {
          const fixture = new URL(location.href).searchParams.get('catalog')
            ?? localStorage.getItem('mrt.catalog.fixture');
          const selectedCatalog = catalogFixtures[fixture] ?? catalog;
          // Two mutations aimed at the reading path, both applied to the catalog rather than to
          // the app, because the app resolves the path from this payload and nothing else.
          if (window.__mrtMutation === 'path-strip') {
            return Promise.resolve(json({ ...selectedCatalog, paths: [] }));
          }
          if (window.__mrtMutation === 'group-strip') {
            return Promise.resolve(json({
              ...selectedCatalog,
              lists: selectedCatalog.lists.map((l) => ({ ...l, groupName: null })),
            }));
          }
          // Aimed at the section rule through its input rather than at the function, which the page
          // cannot reach. One type everywhere puts every story on one side, so the empty section is
          // dropped and the shelf paints a single heading.
          if (window.__mrtMutation === 'type-flatten') {
            return Promise.resolve(json({
              ...selectedCatalog,
              lists: selectedCatalog.lists.map((l) => ({ ...l, type: 'era' })),
            }));
          }
          return Promise.resolve(json(selectedCatalog));
        }
        if (url.endsWith(`data/${orderFile}`)) {
          window.__mrtOrderRequests = (window.__mrtOrderRequests ?? 0) + 1;
          if (window.__mrtMutation === 'import-fail') return Promise.resolve(json({ error: 'mutation' }, 500));
          if (sessionStorage.getItem('mrt.issue-focus.negative') === '1') {
            return Promise.resolve(json({ ...order, items: [...order.items, negativeOrderItem] }));
          }
          return Promise.resolve(json(new URL(location.href).searchParams.get('long') === '1' ? longOrder : order));
        }
        if (url === `${defaultApiBase}/health`) {
          return Promise.resolve(json({ issue_count: 1 }));
        }
        if (url === updateApiUrl) {
          window.__mrtUpdateRequests = (window.__mrtUpdateRequests ?? 0) + 1;
          const mode = window.__mrtUpdate ?? sessionStorage.getItem('mrt.update.stub') ?? 'current';
          if (mode === 'hang') return new Promise(() => {});
          if (mode === 'newer') return Promise.resolve(json({ tag_name: 'v9.9.9' }));
          if (mode === 'older') return Promise.resolve(json({ tag_name: 'v1.0.0' }));
          return Promise.resolve(json({ tag_name: `v${appVersion}` }));
        }
        // Guarded by a flag for the same reason as the synopsis stub below: only the wiki
        // scenario sets it, so every other scenario sees the stub it saw before this existed. The
        // wikitext is written here rather than copied from a page, because Fandom prose is
        // share-alike licensed and a fixture is the one place a copy would become permanent.
        if (window.__mrtWiki && url.includes('marvel.fandom.com/api.php')) {
          if (window.__mrtWiki === 'refuse') return Promise.reject(new TypeError('Failed to fetch'));
          const q = new URL(url).searchParams;
          if (q.get('list') === 'search') {
            return Promise.resolve(json({
              query: { search: [{ title: 'Fixture Vol 7' }, { title: 'Fixture Vol 7 26' }] },
            }));
          }
          const id = window.__mrtWikiId ?? 129648;
          // The second lookup in the scenario asks for the same page and gets different facts,
          // which is what makes an overwrite visible. Answering identically both times would let
          // a missing collision guard rewrite the entry with the same values and pass.
          const alt = window.__mrtWikiAlt === true;
          const comic = [
            '{{Marvel Database:Comic Template',
            `| ReleaseDate = ${alt ? '[[July 1]], [[2026]]' : '[[March 4]], [[2026]]'}`,
            `| Pages = ${alt ? 99 : 32}`,
            `| MarvelUnlimitedID = ${id}`,
            `| Writer1_1 = [[${alt ? 'Replacement Writer' : 'Fixture Writer'}]]`,
            '| Penciler1_1 = [[Fixture Penciler]]',
            '| Quotation = A line of prose that must never reach the form.',
            '}}',
          ].join('\n');
          return Promise.resolve(json({
            query: {
              pages: {
                11: { title: 'Fixture Vol 7', revisions: [{ slots: { main: { '*': '{{Marvel Database:Volume Template\n| Publisher = Marvel\n}}' } } }] },
                12: { title: 'Fixture Vol 7 26', revisions: [{ slots: { main: { '*': comic } } }] },
              },
            },
          }));
        }

        // Only the synopsis scenario sets the flag, and it sets it before the first navigation.
        // Left unset this line is reached by no request any other scenario makes, so what they
        // see is the stub they saw before it was added.
        const issuePath = /\/issues\/(-?\d+)(?:\?|$)/.exec(url);
        if (issuePath) window.__mrtIssueRequests = (window.__mrtIssueRequests ?? 0) + 1;
        const issue = window.__mrtSynopsis ? issuePath : null;
        if (issue) {
          const answers = window.__mrtSynopsis === 'answer';
          // Delayed on purpose, and this is the whole reason the scenario can make its claim. An
          // immediate refusal empties a three issue queue before a click on stop can land, and
          // what is under test is the line a run shows while it is still running.
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              if (answers) resolve(json({ id: Number(issue[1]), description: `Fixture synopsis for ${issue[1]}.` }));
              // A network refusal rather than a 404: a 404 is the service answering, and the app
              // counts that as an answer on purpose. Only a request that got nothing at all is
              // what the running line is meant to hold back from its count.
              else {
                // Counted here rather than read off the status line, because the status line is
                // the thing under test. A scenario that waited for the line to mention a refusal
                // could only ever be satisfied by the behaviour it is meant to be able to find
                // missing, so on a broken build it would starve and report a timeout instead of
                // reporting the claim that failed.
                window.__mrtRefused = (window.__mrtRefused ?? 0) + 1;
                reject(new TypeError('Failed to fetch'));
              }
            }, 400);
          });
        }
        if (window.__mrtBlockExternal) {
          const requestUrl = new URL(url, location.href);
          if (requestUrl.protocol.startsWith('http') && requestUrl.origin !== location.origin) {
            window.__mrtBlockedExternal = [
              ...(window.__mrtBlockedExternal ?? []),
              requestUrl.href,
            ];
            return Promise.reject(new TypeError('Blocked by actual-data browser check'));
          }
        }
        return real(input, init);
      };

      // Installed here, before a single line of the app has run, and deliberately not from the
      // handoff scenario after load. Both the instrument and a mutation replace window.open by
      // wrapping what they find, so whichever is installed last is the one the app reaches first.
      // Recording after load put the instrument outermost, which erased the mutation aimed at it
      // and made the handoff scenario the one scenario that could not be shown to fail.
      window.__opened = [];
      const realOpen = window.open.bind(window);
      window.open = (url, target, features) => {
        window.__opened.push({ url, target, features, dispatching: window.__dispatching === true });
        // The real open is never called: a check that spawned a Marvel tab per assertion would be
        // both slow and a request to a third party this repository has no business making.
        void realOpen;
        return null;
      };
    },
    CATALOG,
    {
      publishing: PUBLISHING_CATALOG,
      empty: EMPTY_CATALOG,
      sparse: SPARSE_PUBLISHING_CATALOG,
      actual: ACTUAL_CATALOG,
    },
    ORDER,
    LONG_ORDER,
    NEGATIVE_ORDER_ITEM,
    ORDER_FILE,
    APP_VERSION,
    LATEST_RELEASE_API_URL,
    DEFAULT_BASE,
  );
  // Handed to puppeteer as a function rather than stringified and passed to `new Function`, which
  // the app's own CSP refuses: server.mjs sends `script-src 'self'` with no 'unsafe-eval'. A
  // debugger-injected script is not subject to that, so this is both simpler and the only form
  // that runs. The first shape written here failed on every mutation for exactly that reason.
  if (mutation?.script) await page.evaluateOnNewDocument(mutation.script);
}

// ------------------------------------------------------------------ running

function tally() {
  const rows = [];
  return {
    rows,
    check(name, ok, detail) {
      rows.push({ name, ok: !!ok, detail: ok ? null : (detail ?? null) });
    },
  };
}

async function runScenario(browser, origin, scenario, mutation) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const t = tally();
  let error = null;
  let prepared = false;
  try {
    await preparePage(page, origin, mutation);
    prepared = true;
    await scenario.run(page, t);
  } catch (err) {
    error = err?.message ?? String(err);
    t.check(`${scenario.id} ran to the end`, false, error);
  } finally {
    await context.close().catch(() => {});
  }
  return {
    id: scenario.id, title: scenario.title, rows: t.rows, error, prepared,
  };
}

function report(results, { quiet = false } = {}) {
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (!quiet) console.log(`\n${r.title}`);
    for (const row of r.rows) {
      if (row.ok) passed += 1;
      else failed += 1;
      if (quiet) continue;
      console.log(`  ${row.ok ? 'ok  ' : 'FAIL'} ${row.name}${row.detail ? `\n         ${row.detail}` : ''}`);
    }
  }
  return { passed, failed };
}

async function withStack(fn) {
  const driver = resolveDriver();
  if (!driver) {
    prerequisiteFailure('puppeteer-core was not found.', [
      'It is deliberately not a dependency of this repository. Install it outside the tree:',
      '',
      '  mkdir ~/.mrt-scratch && cd ~/.mrt-scratch',
      '  npm init -y && npm i puppeteer-core',
      '',
      'or point MRT_PUPPETEER at an existing install:',
      '',
      '  MRT_PUPPETEER=/path/to/dir/containing/node_modules npm run browser',
    ]);
  }

  const edge = resolveEdge();
  if (!edge) {
    prerequisiteFailure('Microsoft Edge was not found.', [
      'The check drives the browser the app is actually used in. Set MRT_EDGE to its executable:',
      '',
      '  MRT_EDGE="C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" npm run browser',
    ]);
  }

  // existsSync is not enough for either. A scratch install that is partial or built for another
  // Node, and an Edge path that exists but will not execute, are both "the driver is not here"
  // answers wearing the costume of "the app is broken". Routing them to the same exit code as an
  // absent one is the whole point of keeping EXIT_PREREQ distinct from a failing assertion.
  let puppeteer;
  try {
    ({ default: puppeteer } = await import(pathToFileURL(driver).href));
  } catch (err) {
    prerequisiteFailure(`puppeteer-core was found at ${driver} but could not be loaded.`, [
      String(err?.message ?? err),
      '',
      'Reinstall it outside the tree, or point MRT_PUPPETEER at a working install.',
    ]);
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: edge,
      headless: !process.env.MRT_HEADED,
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        ...(process.argv.includes('--forced-colors') ? ['--force-high-contrast'] : []),
      ],
    });
  } catch (err) {
    prerequisiteFailure(`Microsoft Edge was found at ${edge} but could not be launched.`, [
      String(err?.message ?? err),
      '',
      'Check that MRT_EDGE names the executable itself, not the directory holding it.',
    ]);
  }

  // Created only once the browser is up, so no exit path above can leave a listening socket
  // behind. Everything from here is covered by the finally.
  const server = createStaticServer();
  try {
    await new Promise((resolve) => server.listen(0, HOST, resolve));
    const origin = `http://${HOST}:${server.address().port}`;
    return await fn({ browser, origin, driver, edge });
  } finally {
    await browser.close().catch(() => {});
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const prove = process.argv.includes('--prove');
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null;

  const code = await withStack(async ({ browser, origin, driver, edge }) => {
    console.log(`driver  ${driver}`);
    console.log(`browser ${edge}`);
    console.log(`origin  ${origin}  (an ephemeral port, so the reading progress saved at :8787 is untouched)`);

    const scenarios = only ? SCENARIOS.filter((s) => s.id === only) : SCENARIOS;
    if (scenarios.length === 0) {
      console.error(`No scenario named ${only}. Known: ${SCENARIOS.map((s) => s.id).join(', ')}`);
      return 1;
    }

    const results = [];
    for (const scenario of scenarios) results.push(await runScenario(browser, origin, scenario, null));
    const { passed, failed } = report(results);
    console.log(`\n${passed} assertion(s) passed, ${failed} failed, across ${results.length} scenario(s)`);
    if (failed > 0) return 1;

    if (!prove) return 0;

    // The point of this pass is not that the mutations break something, it is that each one breaks
    // the scenario it is aimed at, on the assertion that carries the claim. A mutation that turns
    // nothing red means the scenario it was written for is not asserting what it claims to.
    //
    // Some mutations redden more than the scenario they name, and that is not loose aim. Every
    // scenario but the wiki lookup imports the fixture order first, so a
    // mutation of that import is upstream of all of those by construction, and a mutation of the
    // write the app performs is upstream of the wiki lookup as well. What distinguishes aim is the
    // named assertion that fails in the aimed-at scenario, which is why it is printed rather than
    // a bare scenario id.
    console.log('\nproving each scenario can fail:');
    let unproved = 0;
    const mutations = only
      ? MUTATIONS.filter((mutation) => scenarios.some((scenario) => scenario.id === mutation.breaks))
      : MUTATIONS;
    for (const mutation of mutations) {
      const runs = [];
      for (const scenario of scenarios) runs.push(await runScenario(browser, origin, scenario, mutation));
      report(runs, { quiet: true });
      const red = runs.filter((r) => r.rows.some((row) => !row.ok)).map((r) => r.id);
      const aimed = runs.find((r) => r.id === mutation.breaks);
      // The detail matters here and not in the ordinary report. Three of these mutations fail a
      // scenario by starving a wait rather than by failing a named claim, so the row name alone
      // reads as "it broke somehow". The detail says which wait went unanswered, which is the
      // difference between evidence and a green tick.
      const broke = (aimed?.rows ?? []).filter((row) => !row.ok)
        .map((row) => (row.detail ? `${row.name} (${row.detail})` : row.name));
      const caught = aimed?.prepared === true && broke.length > 0;
      if (!caught) unproved += 1;
      console.log(`  ${caught ? 'ok  ' : 'FAIL'} ${mutation.id}: ${mutation.why}`);
      console.log(`         aimed at ${mutation.breaks}, where it breaks: ${broke.join('; ') || 'nothing'}`);
      console.log(`         also turns red: ${red.filter((id) => id !== mutation.breaks).join(', ') || 'nothing else'}`);
    }
    console.log(`\n${mutations.length - unproved}/${mutations.length} mutation(s) caught by the scenario they were aimed at`);
    return unproved === 0 ? 0 : 1;
  });

  process.exit(code);
}

// Without this an unexpected throw leaves an unhandled rejection, which Node reports as a bare
// stack and exits 1 on. Exit 1 is this check's word for "an assertion failed", so an internal
// fault would be read as a finding about the app.
main().catch((err) => {
  console.error(`\nThe check itself failed before it could report on the app:\n${err?.stack ?? err}`);
  process.exit(1);
});
