// #832 item 2 (UX-34): an axe-core rules pass in the browser harness. It opens each route in a fixed
// list in light, dark and forced colors and records what axe reports, by route and theme, as
// evidence. It never fails on a finding: the audit asked for results recorded as evidence, and each
// finding is mapped to the Issue that tracks it in the pull request that records it. It fails only
// when it cannot produce that evidence, because a route did not render or axe itself threw.
//
// **axe-core is not a dependency of this repository and must not become one**, for the same reason
// puppeteer-core is not. It is read at run time from outside the tree, and injected only when the
// file's SHA-256 matches the pin below, so another build of the same version, or another version,
// is refused rather than recorded as though it were this one.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addIssuesToList, createEmptyState, createList, markRead } from '../src/js/lib/model.js';
import { formatRoute, parseRoute } from '../src/js/lib/route.js';
import { SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE } from '../src/js/lib/saveEducation.js';
import { KEY } from '../src/js/storage.js';

export const AXE_VERSION = '4.14.0';
// axe.min.js from the registry's axe-core-4.14.0.tgz, whose sha512 matched the registry's published
// integrity when this was pinned on 2026-10-26. The installed file and the tarball's hashed alike.
export const AXE_SHA256 = '20c09fe157a8a34a30e241aaa1fcdade657734f08ab379ecfbeb7d45cc46e878';
export const AXE_FILE = 'axe.min.js';
// The project measures against WCAG 2.2 AA, so these are the rules axe tags for levels A and AA of
// 2.0, 2.1 and 2.2. Its best-practice rules are advice rather than conformance and are left out.
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
export const AXE_VIEWPORT = { width: 1280, height: 900 };

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8'));
// House of M is the bundled catalog's smallest real list, 20 comics with cover metadata, so the
// seeded routes show real titles, credits and covers rather than a fixture's placeholders.
const entry = catalog.lists.find((list) => list.id === 'house-of-m');
const order = JSON.parse(readFileSync(join(ROOT, 'src', 'data', entry.file), 'utf8'));
export const AXE_LIST = 'house-of-m';
const FIRST = order.items[0];

export function axeReadingState() {
  let state = createList(createEmptyState(), {
    id: AXE_LIST, name: order.name, description: order.description, catalogId: order.id,
  });
  state = addIssuesToList(state, AXE_LIST, order.items).state;
  for (const item of order.items.slice(0, 3)) state = markRead(state, item.issueId, true, 1767225600000);
  return state;
}

// One route per screen a reader uses, with the element whose content shows that screen has finished
// rendering. First-run Home is the only route without saved reading; the rest open with House of M
// saved and three of its comics read.
export const AXE_ROUTES = [
  { id: 'home-first-run', label: 'Home, first run', view: 'home', hash: formatRoute({ view: 'home' }), seeded: false, ready: '#home-primary-paths:not([hidden])' },
  { id: 'home', label: 'Home', view: 'home', hash: formatRoute({ view: 'home' }), seeded: true, ready: '#home-continue:not([hidden])' },
  { id: 'read', label: 'Reading List', view: 'read', hash: formatRoute({ view: 'read', listId: AXE_LIST }), seeded: true, ready: '#hero-title' },
  { id: 'issue', label: 'Comic', view: 'issue', hash: formatRoute({ view: 'issue', issueId: FIRST.issueId, context: { kind: 'list', id: AXE_LIST } }), seeded: true, ready: '#issue-focus-h' },
  { id: 'catalog', label: 'Modern Timeline', view: 'catalog', hash: formatRoute({ view: 'catalog' }), seeded: true, ready: '#catalog-results > *' },
  { id: 'catalog-path', label: 'Modern Timeline, following a path', view: 'catalog', hash: formatRoute({ view: 'catalog', pathId: 'modern-avengers' }), seeded: true, ready: '#catalog-results .path-stops' },
  { id: 'young-readers', label: 'Young readers', view: 'young-readers', hash: formatRoute({ view: 'young-readers' }), seeded: true, ready: '#young-readers-results > *' },
  { id: 'progress', label: 'Progress by series', view: 'progress', hash: formatRoute({ view: 'progress' }), seeded: true, ready: '#series-progress > *' },
  { id: 'library', label: 'Library', view: 'library', hash: formatRoute({ view: 'library' }), seeded: true, ready: '#library-yours-list > li' },
  { id: 'add', label: 'Search', view: 'add', hash: formatRoute({ view: 'add' }), seeded: true, ready: '#add-primary-methods' },
  { id: 'data', label: 'Backup & settings', view: 'data', hash: formatRoute({ view: 'data' }), seeded: true, ready: '#view-data .setgroup' },
  { id: 'about', label: 'About this app', view: 'about', hash: formatRoute({ view: 'about' }), seeded: true, ready: '#view-about .card' },
];

// Forced colors sits over the dark palette, as Windows' own contrast themes mostly do. Reduced
// motion holds every route still, so nothing is measured part way through a transition.
export const AXE_THEMES = [
  { id: 'light', label: 'Light', theme: 'light', media: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'forced-colors', value: 'none' }] },
  { id: 'dark', label: 'Dark', theme: 'dark', media: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'forced-colors', value: 'none' }] },
  { id: 'forced', label: 'Forced colors', theme: 'system', media: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'forced-colors', value: 'active' }] },
];

// Where axe-core may be: an explicit --axe-core path, which is then the only place looked, or the
// node_modules directory that holds the browser driver, which is where the maintainer guide says to
// install it.
export function axeCandidates({ explicit = null, driver = null } = {}) {
  if (explicit) {
    const path = resolve(explicit);
    return path.endsWith('.js') ? [path] : [join(path, AXE_FILE), join(path, 'node_modules', 'axe-core', AXE_FILE)];
  }
  if (!driver) return [];
  const parts = resolve(driver).split(sep);
  const at = parts.lastIndexOf('node_modules');
  return at < 0 ? [] : [join(parts.slice(0, at + 1).join(sep), 'axe-core', AXE_FILE)];
}

export function loadAxe(candidates, pin = AXE_SHA256) {
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) return { problem: 'missing', tried: candidates };
  const bytes = readFileSync(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== pin) return { problem: 'mismatch', path, sha256 };
  return { path, sha256, source: bytes.toString('utf8') };
}

// Evidence goes outside the tree, so a run can never leave untracked files in the checkout or be
// mistaken for something to commit. A directory that already holds a report is refused when it is
// written, never overwritten.
export function axeOutput(requested, root = ROOT) {
  const path = requested ? resolve(requested) : mkdtempSync(join(tmpdir(), 'recap-axe-'));
  const inside = relative(resolve(root), path);
  if (!inside || (!inside.startsWith('..') && !isAbsolute(inside))) return { problem: 'inside', path };
  if (['axe-report.json', 'axe-summary.md'].some((name) => existsSync(join(path, name)))) return { problem: 'exists', path };
  return { path };
}

export function axeRevision(root = ROOT) {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim() !== '';
    return { commit, dirty };
  } catch {
    return { commit: 'unknown', dirty: null };
  }
}

const count = (rules) => rules.reduce((total, rule) => total + rule.nodes.length, 0);

// A cell reads "rules (nodes)", then what axe could not decide on its own, which it calls
// incomplete and asks a person to review.
export function axeCell(run) {
  if (!run) return 'not run';
  if (run.error) return 'failed to run';
  const found = run.violations.length ? `${run.violations.length} (${count(run.violations)})` : '0';
  return run.incomplete.length ? `${found}, review ${run.incomplete.length} (${count(run.incomplete)})` : found;
}

function where(report, kind) {
  const rules = new Map();
  for (const run of report.runs) {
    for (const rule of run[kind] ?? []) {
      const entry = rules.get(rule.id) ?? { rule, places: [] };
      entry.places.push(`${run.route} ${run.theme} (${rule.nodes.length})`);
      rules.set(rule.id, entry);
    }
  }
  return [...rules.values()].sort((a, b) => a.rule.id.localeCompare(b.rule.id));
}

// Backslashes first, so a cell can never end in an escape that swallows the column bar after it.
const cell = (text) => String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function axeMarkdown(report) {
  const lines = [
    '### Accessibility rules pass',
    '',
    `Recorded, not gated. axe-core ${report.axeVersion}, \`${AXE_FILE}\` SHA-256 \`${report.axeSha256}\`, `
      + `rules tagged ${report.tags.join(', ')}, at revision \`${report.revision.commit}\``
      + `${report.revision.dirty ? ' with uncommitted changes' : ''}. ${report.viewport.width}x${report.viewport.height}, `
      + 'reduced motion, cover art on with a local stand-in image. Forced colors sits over the dark palette.',
    '',
    `| Route | ${report.themes.map((theme) => theme.label).join(' | ')} |`,
    `|---|${report.themes.map(() => '---').join('|')}|`,
  ];
  for (const route of report.routes) {
    const runs = report.themes.map((theme) => report.runs.find((run) => run.route === route.id && run.theme === theme.id));
    lines.push(`| ${cell(route.label)} (\`${route.id}\`) | ${runs.map(axeCell).join(' | ')} |`);
  }
  lines.push('', 'Each cell gives the rules violated and, in brackets, their elements; then the rules axe asked a person to review.');
  for (const [kind, title] of [['violations', 'Violations'], ['incomplete', 'For review']]) {
    const found = where(report, kind);
    lines.push('', `#### ${title}`, '');
    if (!found.length) {
      lines.push('None.');
      continue;
    }
    lines.push('| Rule | Impact | Route, theme (elements) | What it checks |', '|---|---|---|---|');
    for (const { rule, places } of found) {
      lines.push(`| \`${rule.id}\` | ${rule.impact ?? 'none'} | ${cell(places.join('; '))} | ${cell(rule.help)} |`);
    }
  }
  const failed = report.runs.filter((run) => run.error);
  if (failed.length) {
    lines.push('', '#### Runs that produced no evidence', '');
    for (const run of failed) lines.push(`- ${run.route} ${run.theme}: ${cell(run.error)}`);
  }
  return `${lines.join('\n')}\n`;
}

async function audit(page, { origin, route, theme, axe, coverPixel }) {
  await page.setViewport(AXE_VIEWPORT);
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [...theme.media, { name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  // Nothing leaves the machine. Covers are answered with a local stand-in, never publisher artwork,
  // and every other request off this origin, such as a metadata lookup, is refused.
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    const settle = url.origin === origin ? request.continue()
      : url.hostname === 'i.annihil.us'
        ? request.respond({ status: 200, contentType: 'image/png', headers: { 'cache-control': 'no-store' }, body: coverPixel })
        : request.abort();
    settle.catch(() => {});
  });
  await page.evaluateOnNewDocument((key, state, settings, educationKey, education) => {
    if (state && !localStorage.getItem(key)) localStorage.setItem(key, state);
    localStorage.setItem('mrt.settings', settings);
    if (education) localStorage.setItem(educationKey, education);
  }, KEY, route.seeded ? JSON.stringify(axeReadingState()) : null,
  JSON.stringify({ covers: true, theme: theme.theme }),
  SAVE_EDUCATION_KEY, route.seeded ? SAVE_EDUCATION_STATE.COMPLETE : null);
  await page.goto(`${origin}/${route.hash}`, { waitUntil: 'load' });
  await page.waitForFunction((view, ready) => {
    const panel = document.querySelector(`#view-${view}`);
    const target = document.querySelector(ready);
    return panel && !panel.hidden && target && target.getClientRects().length > 0
      && (target.textContent.trim() !== '' || target.children.length > 0);
  }, { timeout: 15000 }, route.view, route.ready);
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 15000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  const shown = await page.evaluate(() => ({
    hash: location.hash,
    heading: document.querySelector('.view:not([hidden]) h1')?.textContent.trim() ?? null,
    forced: matchMedia('(forced-colors: active)').matches,
    theme: document.documentElement.dataset.theme ?? null,
  }));
  // With a list saved, the app writes it into every address, so #/home reads back as
  // #/home/house-of-m. Only a different screen would mean the route was not the one audited.
  if (parseRoute(shown.hash)?.view !== route.view) throw new Error(`the app moved from ${route.hash} to ${shown.hash}`);

  // Evaluated through the debugging protocol, which the page's script policy does not govern, so
  // nothing about the app's own policy is relaxed to let it in. The trailing statement keeps the
  // bundle's completion value, the whole axe object, from being copied back.
  await page.evaluate(`${axe.source}\n;undefined;`);
  const result = await page.evaluate(async (tags) => {
    const keep = ['fgColor', 'bgColor', 'contrastRatio', 'expectedContrastRatio', 'fontSize', 'fontWeight', 'messageKey'];
    const shrink = (rule) => ({
      id: rule.id,
      impact: rule.impact,
      help: rule.help,
      helpUrl: rule.helpUrl,
      tags: rule.tags.filter((tag) => /^wcag/.test(tag)),
      nodes: rule.nodes.map((node) => {
        const data = [...node.any, ...node.all, ...node.none].map((check) => check.data)
          .find((value) => value && typeof value === 'object');
        const facts = data ? Object.fromEntries(keep.filter((name) => name in data).map((name) => [name, data[name]])) : null;
        return {
          target: node.target.map((part) => (Array.isArray(part) ? part.join(' ') : part)).join(' '),
          html: node.html.slice(0, 240),
          ...(facts && Object.keys(facts).length ? { data: facts } : {}),
        };
      }),
    });
    const run = await window.axe.run(document, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations', 'incomplete'],
    });
    return {
      engine: run.testEngine.version,
      violations: run.violations.map(shrink),
      incomplete: run.incomplete.map(shrink),
      passes: run.passes.length,
      inapplicable: run.inapplicable.length,
    };
  }, AXE_TAGS);
  if (result.engine !== AXE_VERSION) throw new Error(`axe reported version ${result.engine}`);
  return { route: route.id, theme: theme.id, url: route.hash, shown, ...result };
}

const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => {
  setTimeout(() => reject(new Error(`${what} took longer than ${ms}ms`)), ms).unref();
})]);

export async function axePass({ browser, origin, axe, out, coverPixel, log = console.log }) {
  const runs = [];
  try {
    for (const route of AXE_ROUTES) {
      for (const theme of AXE_THEMES) {
        const context = await browser.createBrowserContext();
        try {
          const run = await audit(await context.newPage(), { origin, route, theme, axe, coverPixel });
          runs.push(run);
          log(`AXE route=${route.id} theme=${theme.id} violations=${run.violations.length} violation-elements=${count(run.violations)} review=${run.incomplete.length} review-elements=${count(run.incomplete)}`);
        } catch (error) {
          const message = String(error?.message ?? error).split('\n')[0].slice(0, 300);
          runs.push({ route: route.id, theme: theme.id, url: route.hash, error: message });
          log(`FAIL AXE route=${route.id} theme=${theme.id} ${message}`);
        } finally {
          // A context that will not close stops the pass, as it stops the ordinary suite.
          await within(context.close(), 5000, 'closing the browser context');
        }
      }
    }
  } finally {
    const report = {
      tool: 'axe-core',
      axeVersion: AXE_VERSION,
      axeSha256: axe.sha256,
      tags: AXE_TAGS,
      revision: axeRevision(),
      generatedAt: new Date().toISOString(),
      viewport: AXE_VIEWPORT,
      routes: AXE_ROUTES.map(({ id, label, hash, seeded }) => ({ id, label, hash, seeded })),
      themes: AXE_THEMES.map(({ id, label, theme, media }) => ({ id, label, theme, media })),
      runs,
    };
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'axe-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    writeFileSync(join(out, 'axe-summary.md'), axeMarkdown(report), { flag: 'wx' });
    const failed = runs.filter((run) => run.error).length;
    log(`\nAXE ${runs.length - failed} of ${AXE_ROUTES.length * AXE_THEMES.length} route and theme run(s) recorded, ${failed} produced no evidence`);
    log(`AXE evidence ${join(out, 'axe-report.json')}`);
    log(`AXE summary ${join(out, 'axe-summary.md')}`);
  }
  return runs.length === AXE_ROUTES.length * AXE_THEMES.length && runs.every((run) => !run.error) ? 0 : 1;
}
