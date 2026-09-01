// Drives the upgrade that the in-app update notice tells a reader to perform, against two real
// installs of the app served by the real server.
//
// The notice says, in the app's own words, that reading progress is saved by the browser rather
// than in the folder, so it survives replacing the folder and the old one can be deleted. That
// sentence is the only thing standing between a reader and deleting a directory they believe is
// disposable. Nothing exercised it, and the failure it would hide is the loss of somebody's entire
// reading history, so it is driven here rather than reasoned about.
//
// Two directories rather than one rewritten in place, because a rewrite in place is not the
// instruction under test. The old install writes the progress, the old install stops, a different
// directory takes the same address, and the reader's order has to still be there and still be
// painted.
//
// Deliberately not in CI, for the same reason the browser check is not: it needs Microsoft Edge and
// a puppeteer-core installed outside this tree. Run it by hand before trusting a release that moves
// the update notice or anything it says.

import {
  cp, mkdir, mkdtemp, readFile, writeFile, rm,
} from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const REPO = process.cwd();
const OLD_REF = 'v1.4.0';
const OLD_VERSION = OLD_REF.slice(1);
const NEW_VERSION = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8')).version;
const STATE_KEY = 'mrt.state.v2';
const OLD_ORDER_ADD = 'button[aria-label="Add to library: House of M: main series"]';
const execFileAsync = promisify(execFile);
const HISTORICAL_GIT_ENV = Object.freeze({ ...process.env, GIT_NO_LAZY_FETCH: '1' });

export function upgradeVersionProblem(oldVersion, newVersion) {
  if (oldVersion !== newVersion) return null;
  return `The candidate still reports ${newVersion}, the same version as ${OLD_REF}. `
    + 'Bump the candidate version before running this check so the folder swap can be proved.';
}

// ------------------------------------------------------------------ mutations

// A check that has never been seen to fail is not evidence. Each entry below breaks one thing an
// assertion claims, and --prove runs them and records which assertion each one turns red.
//
// Unlike the browser check's mutations these edit files, because what is under test here is which
// directory is being served. They only ever touch the throwaway copies under the system temporary
// directory, never the tree, so a killed run still cannot leave the repository modified.
const MUTATIONS = [
  {
    id: 'version-frozen',
    breaks: 'new-build',
    why: 'the new directory reports the old version, which is what a check that never actually reloaded the page would also report',
    patchNew: (source) => source.replace(`'${NEW_VERSION}'`, `'${OLD_VERSION}'`),
    patchNewPath: join('src', 'js', 'lib', 'version.js'),
  },
  {
    id: 'storage-key-rename',
    breaks: 'new-paints',
    why: 'the new build reads a differently named key, so the reader opens the upgraded app to an empty shelf while their data sits untouched under the old name',
    patchNew: (source) => source.replace(`'${STATE_KEY}'`, `'${STATE_KEY}.renamed'`),
    patchNewPath: join('src', 'js', 'storage.js'),
  },
  {
    id: 'read-state-lost',
    breaks: 'new-paints',
    why: 'the new build discards every read marker while loading, so the order survives but its progress returns to zero',
    patchNew: (source) => source.replace(
      / {4}read,(\r?\n) {4}overrides,/,
      '    read: {},$1    overrides,',
    ),
    patchNewPath: join('src', 'js', 'lib', 'model.js'),
  },
  {
    id: 'origin-hop',
    breaks: 'order-survives',
    why: 'the upgraded copy is started on a different port, which is the one way a reader following this advice really can lose everything',
    upgradeOnOtherPort: true,
  },
  {
    id: 'control-shares-origin',
    breaks: 'origin-isolated',
    why: 'the control is pointed at the origin it is supposed to differ from, so a control that still reports isolation is reporting nothing',
    controlSharesOrigin: true,
  },
];

// ------------------------------------------------------------------ plumbing

function findDriver() {
  const suffix = join('node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js');
  const roots = [process.env.MRT_PUPPETEER, join(homedir(), '.mrt-scratch'), join(homedir(), 'mrt-scratch')];
  for (const root of roots) {
    if (!root) continue;
    const candidate = join(root, suffix);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function findEdge() {
  const candidates = [
    process.env.MRT_EDGE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((path) => path && existsSync(path)) ?? null;
}

function freePort() {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// A copy of the whole app, which is what unzipping the candidate produces.
export async function installCurrent(dest) {
  await cp(join(REPO, 'src'), join(dest, 'src'), { recursive: true });
  await cp(join(REPO, 'server.mjs'), join(dest, 'server.mjs'));
}

export async function installHistorical({ repo, ref, dest }) {
  await execFileAsync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: repo,
    encoding: 'utf8',
    env: HISTORICAL_GIT_ENV,
  });
  const { stdout } = await execFileAsync(
    'git',
    ['ls-tree', '-r', '-z', '--name-only', ref, '--', 'src', 'server.mjs'],
    {
      cwd: repo,
      encoding: 'utf8',
      env: HISTORICAL_GIT_ENV,
      maxBuffer: 100 * 1024 * 1024,
    },
  );
  const paths = stdout.split('\0').filter(Boolean);
  if (!paths.includes('server.mjs') || !paths.some((path) => path.startsWith('src/'))) {
    throw new Error(`${ref} does not contain the complete app tree`);
  }

  for (const path of paths) {
    const parts = path.split('/');
    const allowed = path === 'server.mjs' || path.startsWith('src/');
    if (!allowed || parts.some((part) => part === '' || part === '.' || part === '..')) {
      throw new Error(`${ref} contains an unsafe app path: ${path}`);
    }
    const target = join(dest, ...parts);
    await mkdir(dirname(target), { recursive: true });
    const { stdout: bytes } = await execFileAsync('git', ['show', `${ref}:${path}`], {
      cwd: repo,
      encoding: 'buffer',
      env: HISTORICAL_GIT_ENV,
      maxBuffer: 100 * 1024 * 1024,
    });
    await writeFile(target, bytes);
  }
}

async function applyMutation(dir, mutation) {
  if (!mutation?.patchNew) return;
  const path = join(dir, mutation.patchNewPath);
  const before = await readFile(path, 'utf8');
  const after = mutation.patchNew(before);
  // A mutation that silently matched nothing would report the check as unable to fail when in
  // fact it was never mutated, which is the one result this pass must not be able to produce.
  if (after === before) throw new Error(`mutation ${mutation.id} changed nothing in ${mutation.patchNewPath}`);
  await writeFile(path, after);
}

// The real server.mjs from the install being tested, not a stand-in, because the thing under test
// is what a reader gets when they run the thing in the folder.
function startServer(dir, port) {
  const child = spawn(process.execPath, [join(dir, 'server.mjs')], {
    env: { ...process.env, MRT_PORT: String(port), MRT_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 20000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('running at')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}: ${out}`));
    });
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill();
  });
}

// Same-origin traffic stays real, so the bundled catalog loads from disk exactly as it does for a
// reader. Everything off-origin is refused, so neither the metadata service nor the release
// endpoint can decide whether this check passes. Resolved against the document rather than matched
// as a string, because the catalog is fetched by a relative path and a string match on a leading
// slash rejects it.
const OFFLINE_STUB = () => {
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input?.url ?? '';
    let sameOrigin;
    try {
      sameOrigin = new URL(raw, location.href).origin === location.origin;
    } catch {
      // A URL this check cannot parse is one the page is entitled to try for itself.
      sameOrigin = true;
    }
    return sameOrigin ? real(input, init) : Promise.reject(new TypeError('offline in this check'));
  };
};

const summarise = (page, key) => page.evaluate((stateKey) => {
  const raw = localStorage.getItem(stateKey);
  if (!raw) {
    return {
      present: false, listCount: 0, listId: null, listName: null, itemIds: [], readIds: [],
    };
  }
  const state = JSON.parse(raw);
  const ids = Object.keys(state.lists ?? {});
  const first = ids.length ? state.lists[ids[0]] : null;
  return {
    present: true,
    listCount: ids.length,
    listId: first?.id ?? null,
    listName: first?.name ?? null,
    itemIds: first?.itemIds ?? [],
    readIds: Object.keys(state.read ?? {}).sort(),
  };
}, key);

const painted = (page) => page.evaluate(() => document.querySelector('main')?.innerText ?? '');
const progressPainted = (text, read, total) =>
  new RegExp(`${read} of ${total}(?: issues?)? read`).test(text)
  || new RegExp(`${total - read} unread`).test(text);
const readLines = (text) =>
  text.split('\n').map((line) => line.trim()).filter((line) => /read/i.test(line)).slice(0, 8).join(' | ');

async function boot(page, origin, hash = '') {
  // Cleared to about:blank first, and the reason is the whole check. Navigating to a URL that
  // differs from the current one only in its fragment is a same-document navigation: the browser
  // moves the hash and re-runs nothing. Measured while writing this file, the first version of it
  // swapped the served directory and then navigated by hash, so the modules still in memory were
  // the old build's. It reported the old version after the upgrade while every storage assertion
  // passed, which reads as a serious finding and was in fact a check that had never once loaded the
  // new install. A full document load is the honest simulation in any case: it is what a reader
  // gets when they open the app again.
  await page.goto('about:blank');
  await page.goto(`${origin}/${hash}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.brand[data-view="home"]', { timeout: 20000 });
}

// ------------------------------------------------------------------ the check

async function runUpgrade({ puppeteer, edge, mutation }) {
  const rows = [];
  const check = (id, name, ok, detail = '') => {
    rows.push({ id, name, ok: Boolean(ok), detail });
  };

  const base = await mkdtemp(join(tmpdir(), 'mrt-upgrade-'));
  const oldDir = join(base, 'MarvelReadingTracker-old');
  const newDir = join(base, 'MarvelReadingTracker-new');
  await installHistorical({
    repo: REPO, ref: OLD_REF, dest: oldDir,
  });
  await installCurrent(newDir);
  await applyMutation(newDir, mutation);

  const port = await freePort();
  const otherPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const otherOrigin = `http://127.0.0.1:${otherPort}`;
  const upgradePort = mutation?.upgradeOnOtherPort ? otherPort : port;
  const upgradeOrigin = mutation?.upgradeOnOtherPort ? otherOrigin : origin;

  let server = null;
  let browser = null;
  try {
    server = await startServer(oldDir, port);
    browser = await puppeteer.launch({
      executablePath: edge,
      headless: !process.env.MRT_HEADED,
      args: ['--no-first-run', '--no-default-browser-check'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(OFFLINE_STUB);

    await boot(page, origin);
    const versionBefore = await page.evaluate(() => document.querySelector('#about-version')?.textContent ?? null);
    check('old-build', 'the old install reports its own version', versionBefore === OLD_VERSION, `reported ${versionBefore}`);

    // Navigation is by hash throughout. Nothing here may alter the origin, the port included.
    await boot(page, origin, '#/catalog');
    await page.waitForSelector(OLD_ORDER_ADD, { timeout: 20000 });
    await page.evaluate((selector) => document.querySelector(selector).click(), OLD_ORDER_ADD);
    await page.waitForFunction((stateKey) => {
      const raw = localStorage.getItem(stateKey);
      return raw && Object.keys(JSON.parse(raw).lists ?? {}).length > 0;
    }, { timeout: 20000 }, STATE_KEY);

    const imported = await summarise(page, STATE_KEY);
    check('old-saved', 'the old install saved a reading order', imported.listCount === 1, `${imported.listCount} list(s)`);
    check('old-items', 'the saved order carries its issues', imported.itemIds.length === 8, `${imported.itemIds.length} issue(s)`);

    // Catalog cards no longer repeat progress after the landing redesign. Open the saved order so
    // both sides prove the reading surface a returning reader actually relies on.
    await boot(page, origin, `#/read/${imported.listId}`);
    await page.waitForSelector('#btn-hero-done', { timeout: 20000 });
    await page.evaluate(() => document.querySelector('#btn-hero-done').click());
    await page.waitForFunction(
      (stateKey) => {
        const raw = localStorage.getItem(stateKey);
        return raw && Object.keys(JSON.parse(raw).read ?? {}).length === 1;
      },
      { timeout: 20000 },
      STATE_KEY,
    );

    const before = await summarise(page, STATE_KEY);
    const readId = before.readIds[0] ?? null;
    check(
      'old-read',
      'the old install saved one read marker',
      before.readIds.length === 1 && before.itemIds.map(String).includes(readId),
      `read ids ${JSON.stringify(before.readIds)}`,
    );
    const paintedBefore = await painted(page);
    check(
      'old-paints',
      'the old install paints the order and its progress',
      paintedBefore.includes(before.listName) && progressPainted(paintedBefore, 1, before.itemIds.length),
      `named ${paintedBefore.includes(before.listName)}, progress ${progressPainted(paintedBefore, 1, before.itemIds.length)}; read lines: ${readLines(paintedBefore)}`,
    );

    // The upgrade itself. The old install stops serving and a different directory takes the same
    // address, which is what a reader does when they unzip a release elsewhere and start that copy.
    await stopServer(server);
    server = await startServer(newDir, upgradePort);

    await boot(page, upgradeOrigin, '#/catalog');
    const versionAfter = await page.evaluate(() => document.querySelector('#about-version')?.textContent ?? null);
    check('new-build', 'the new install is the one now being served', versionAfter === NEW_VERSION, `reported ${versionAfter}`);

    const after = await summarise(page, STATE_KEY);
    check('order-survives', 'the saved reading order survived the folder swap', after.listCount === 1, `${after.listCount} list(s)`);
    check('same-order', 'it is the same order, not a fresh one', after.listId === before.listId, `${before.listId} then ${after.listId}`);
    check(
      'items-survive',
      'every issue in it survived, in the same order',
      after.itemIds.length > 0 && after.itemIds.join(',') === before.itemIds.join(','),
      `${before.itemIds.length} then ${after.itemIds.length}`,
    );
    check(
      'read-survives',
      'the issue marked read by the old install survived',
      after.readIds.join(',') === before.readIds.join(','),
      `${JSON.stringify(before.readIds)} then ${JSON.stringify(after.readIds)}`,
    );

    // Storage agreeing is not the same as a reader seeing their progress. A build that parsed the
    // saved state and then failed to paint it would satisfy every assertion above and still read
    // as total data loss to the person it happened to.
    await boot(page, upgradeOrigin, `#/read/${before.listId}`);
    const paintedAfter = await painted(page);
    check(
      'new-paints',
      'the new install paints the order a reader saved on the old one',
      paintedAfter.includes(before.listName) && progressPainted(paintedAfter, 1, after.itemIds.length),
      `named ${paintedAfter.includes(before.listName)}, progress ${progressPainted(paintedAfter, 1, after.itemIds.length)}; read lines: ${readLines(paintedAfter)}`,
    );

    // The control, and without it none of the above means what it says. The same new install is
    // served at a second address and the progress has to be absent there. If it is present, the
    // progress is not following the origin at all and every assertion above is passing for a
    // reason other than the one claimed.
    const controlOrigin = mutation?.controlSharesOrigin ? upgradeOrigin : otherOrigin;
    const control = mutation?.controlSharesOrigin || mutation?.upgradeOnOtherPort
      ? null
      : await startServer(newDir, otherPort);
    try {
      const stray = await browser.newPage();
      await stray.setViewport({ width: 1280, height: 900 });
      await stray.evaluateOnNewDocument(OFFLINE_STUB);
      await boot(stray, controlOrigin);
      const strayState = await summarise(stray, STATE_KEY);
      check(
        'origin-isolated',
        'a second address shows none of the reading progress',
        strayState.listCount === 0,
        strayState.present ? `${strayState.listCount} list(s) reachable from the other address` : 'no saved state at all',
      );
      await stray.close();
    } finally {
      await stopServer(control);
    }
  } finally {
    await browser?.close().catch(() => {});
    await stopServer(server);
    await rm(base, { recursive: true, force: true }).catch(() => {});
  }

  return rows;
}

function report(rows, { quiet = false } = {}) {
  if (!quiet) {
    for (const row of rows) {
      console.log(`  ${row.ok ? 'ok  ' : 'FAIL'} ${row.name}`);
      if (row.detail) console.log(`         ${row.detail}`);
    }
  }
  const failed = rows.filter((row) => !row.ok).length;
  return { passed: rows.length - failed, failed };
}

async function main() {
  const prove = process.argv.includes('--prove');
  const versionProblem = upgradeVersionProblem(OLD_VERSION, NEW_VERSION);
  if (versionProblem) {
    console.error(versionProblem);
    return 2;
  }

  const driver = findDriver();
  if (!driver) {
    console.error('puppeteer-core was not found. It is deliberately not a dependency of this');
    console.error('repository. Install it outside the tree, or point MRT_PUPPETEER at the');
    console.error('directory that contains its node_modules.');
    process.exit(2);
  }
  const edge = findEdge();
  if (!edge) {
    console.error('Microsoft Edge was not found. Set MRT_EDGE to its executable.');
    process.exit(2);
  }

  const { default: puppeteer } = await import(pathToFileURL(driver).href);
  console.log(`driver  ${driver}`);
  console.log(`browser ${edge}`);
  console.log('ports   ephemeral, so the reading progress saved at 127.0.0.1:8787 is untouched\n');

  console.log('upgrading a real install in place');
  const rows = await runUpgrade({ puppeteer, edge, mutation: null });
  const { passed, failed } = report(rows);
  console.log(`\n${passed} assertion(s) passed, ${failed} failed`);
  if (failed > 0) return 1;
  if (!prove) return 0;

  // As with the browser check, the point is not that a mutation breaks something. It is that each
  // one breaks the assertion it was aimed at. A mutation that turns nothing red means the
  // assertion it was written for is not asserting what it claims to.
  console.log('\nproving each claim can fail:');
  let unproved = 0;
  for (const mutation of MUTATIONS) {
    const mutated = await runUpgrade({ puppeteer, edge, mutation });
    const aimed = mutated.find((row) => row.id === mutation.breaks);
    const red = mutated.filter((row) => !row.ok).map((row) => row.id);
    const caught = aimed !== undefined && !aimed.ok;
    if (!caught) unproved += 1;
    console.log(`  ${caught ? 'ok  ' : 'FAIL'} ${mutation.id}: ${mutation.why}`);
    console.log(`         aimed at ${mutation.breaks}, which reports: ${aimed ? aimed.detail || (aimed.ok ? 'still passing' : 'failed') : 'never ran'}`);
    console.log(`         also turns red: ${red.filter((id) => id !== mutation.breaks).join(', ') || 'nothing else'}`);
  }
  console.log(`\n${MUTATIONS.length - unproved}/${MUTATIONS.length} mutation(s) caught by the assertion they were aimed at`);
  return unproved === 0 ? 0 : 1;
}

// Without this an unexpected throw leaves an unhandled rejection, which Node reports as a bare
// stack and exits 1 on. Exit 1 is this check's word for "an assertion failed", so an internal fault
// would otherwise be read as a finding about the app.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(`\nThe check itself failed before it could report on the app:\n${err?.stack ?? err}`);
    process.exit(2);
  });
}
