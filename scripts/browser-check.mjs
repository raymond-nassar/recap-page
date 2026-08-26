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
// check fast, deterministic and immune to a catalog edit that has nothing to do with it.

import { createStaticServer, HOST } from '../server.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { APP_VERSION } from '../src/js/lib/version.js';
import {
  LATEST_RELEASE_API_URL, UPDATE_DOWNLOAD_URL, UPDATE_RELEASE_NOTES_URL,
} from '../src/js/lib/updateCheck.js';
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
    ...Array.from({ length: 10 }, (_, index) => shelfEntry(
      `browser-check-extra-${index + 1}`,
      `Fixture Event ${index + 1}`,
      { timeline: index === 0 ? 2012 : 2008 },
    )),
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
          { key: 'storylines', label: 'Browse complete arcs', title: 'Storylines', count: '7 Reading Lists' },
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
      // `opacity: 0`. The second is not hypothetical here. `src/styles.css:795` hides the row
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
    id: 'reading-screen',
    title: 'the reading screen uses the desktop it is given and states progress in words',
    async run(page, t) {
      await importOrder(page);
      await openFullOrder(page);

      await page.setViewport({ width: 1280, height: 900 });
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
  if (mutation?.rewriteMain) {
    const source = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
    const rewritten = mutation.rewriteMain(source);
    if (rewritten === source) throw new Error(`Mutation ${mutation.id} did not change main.js`);
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      if (request.url() === `${origin}/js/main.js`) {
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
    (catalog, catalogFixtures, order, orderFile, appVersion, updateApiUrl) => {
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
          if (window.__mrtMutation === 'import-fail') return Promise.resolve(json({ error: 'mutation' }, 500));
          return Promise.resolve(json(order));
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
        const issue = window.__mrtSynopsis ? /\/issues\/(\d+)(?:\?|$)/.exec(url) : null;
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
    },
    ORDER,
    ORDER_FILE,
    APP_VERSION,
    LATEST_RELEASE_API_URL,
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
      args: ['--no-first-run', '--no-default-browser-check'],
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
