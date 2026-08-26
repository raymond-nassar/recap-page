import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

// These six documents are almost entirely claims about the rest of the repository: which checks
// run, which scripts exist, where to read about something, and which record owns a decision.
// Every one of those goes stale silently. A link to a heading that has been renamed still
// renders as a link, a gate added to CI does not announce itself in the guide that lists the
// gates, and a count copied forward from a previous edit is the defect this repository has
// already shipped twice. So the expectations below are computed from the repository and the
// documents are checked against them, rather than the other way round.

const root = new URL('../', import.meta.url);
const read = (relative) => readFileSync(new URL(relative, root), 'utf8');
const exists = (relative) => existsSync(fileURLToPath(new URL(relative, root)));

const documents = [
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SUPPORT.md',
  'GOVERNANCE.md',
  'docs/RUNNING.md',
  'docs/MAINTAINING.md',
];
const text = Object.fromEntries(documents.map((name) => [name, read(name)]));
// Collapsed copies, for the assertions on whole sentences. These documents are hard wrapped, so
// matching the raw text passes only for phrases that happen not to wrap, which is a check whose
// result depends on where the paragraph was last reflowed.
const flat = Object.fromEntries(
  documents.map((name) => [name, text[name].replace(/\s+/g, ' ')]),
);
const pkg = JSON.parse(read('package.json'));
const workflow = read('.github/workflows/ci.yml');
const browserRunner = read('scripts/browser-check.mjs');
const upgradeRunner = read('scripts/upgrade-check.mjs');
const copilotInstructions = read('.github/copilot-instructions.md').replace(/\s+/g, ' ');
const paletteRunner = read('scripts/check-palette.mjs').replace(/\s+/g, ' ');

// Every check the workflow actually runs, read out of its run steps rather than out of its prose,
// which mentions checks it deliberately does not run.
function checksInCi() {
  const found = new Set();
  for (const match of workflow.matchAll(/^\s*run:\s*npm (test|run ([\w:-]+))\s*$/gm)) {
    found.add(match[2] ?? 'test');
  }
  return found;
}

// GitHub's heading anchors, reduced to the part these documents use: lower case, punctuation
// dropped, spaces hyphenated.
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');

function headings(markdown) {
  return new Set(
    [...markdown.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((match) => slug(match[1])),
  );
}

const links = [];
for (const name of documents) {
  for (const match of text[name].matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    links.push({ from: name, target: match[1] });
  }
}

test('every document link points at something that is still there', () => {
  assert.ok(links.length > 20, `only ${links.length} links found, so this would barely check`);
  for (const { from, target } of links) {
    if (/^(https?|mailto):/.test(target)) continue;
    const [path, fragment] = target.split('#');
    const file = path === ''
      ? from
      : posix.normalize(posix.join(posix.dirname(from), path));
    assert.ok(exists(file), `${from} links to ${target}, and ${file} does not exist`);
    if (!fragment) continue;
    assert.ok(file.endsWith('.md'), `${from} links to a fragment of a non-document, ${target}`);
    assert.ok(
      headings(read(file)).has(fragment),
      `${from} links to ${target}, and ${file} has no such heading`,
    );
  }
});

test('every command the guides tell you to run is a script this repository has', () => {
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  let checked = 0;
  for (const name of documents) {
    for (const match of text[name].matchAll(/`?npm run ([\w:-]+)`?/g)) {
      checked += 1;
      assert.ok(scripts.has(match[1]), `${name} says to run npm run ${match[1]}, which is not a script`);
    }
  }
  assert.ok(checked > 0, 'no commands found, so this check would pass vacuously');
});

test('the maintainer browser instructions match the runner interface', () => {
  const section = /## Run the browser check([\s\S]*?)## Run the upgrade check/.exec(text['docs/MAINTAINING.md'])?.[1] ?? '';
  const supported = new Set(
    [...browserRunner.matchAll(/process\.env\.(MRT_[A-Z_]+)/g)].map((match) => match[1]),
  );
  const documented = new Set([...section.matchAll(/MRT_[A-Z_]+/g)].map((match) => match[0]));

  assert.ok(section, 'the maintainer guide has no browser-check section');
  assert.deepEqual([...documented].sort(), ['MRT_EDGE', 'MRT_PUPPETEER']);
  for (const name of documented) assert.ok(supported.has(name), `${name} is not read by the browser runner`);
  assert.match(section, /--only=<scenario-name>/);
  assert.doesNotMatch(section, /--scenario|127\.0\.0\.1:8787/);
  assert.match(section, /ephemeral port/);
  assert.doesNotMatch(flat['docs/MAINTAINING.md'], /pull request also runs the browser journeys/);
});

test('the maintainer upgrade instructions match the historical runner contract', () => {
  const section = /## Run the upgrade check([\s\S]*?)## Review pinned GitHub Actions/.exec(text['docs/MAINTAINING.md'])?.[1] ?? '';

  assert.ok(section, 'the maintainer guide has no upgrade-check section');
  assert.match(upgradeRunner, /OLD_REF\s*=\s*'v1\.2\.0'/);
  assert.match(section, /v1\.2\.0/);
  assert.match(section, /local Git history/);
  assert.doesNotMatch(section, /fixture|--scenario|single scenario/i);
});

test('every document that lists the checks lists exactly the ones CI runs, and counts them', () => {
  // Read the gate set out of the workflow. A gate added there and not here would leave a
  // contributor green locally and red on the pull request, with the document as the thing that
  // misled them. Both documents that state the number are checked, because the root was the one
  // that carried the wrong number: it told a contributor to run four and said four run in CI,
  // while the workflow ran six.
  const inCi = checksInCi();
  assert.ok(inCi.size >= 2, `only ${inCi.size} checks found in the workflow`);

  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  for (const name of ['CONTRIBUTING.md', 'docs/MAINTAINING.md']) {
    const doc = text[name];
    // Checked inside the fenced blocks rather than anywhere in the document, because the block is
    // what a contributor copies. Prose describing a check it no longer tells you to run reads as
    // coverage and is not.
    const runnable = [...doc.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
    for (const gate of inCi) {
      const command = gate === 'test' ? 'npm test' : `npm run ${gate}`;
      assert.ok(
        new RegExp(`^${command}\\s*$`, 'm').test(runnable),
        `no fenced block in ${name} tells you to run ${command}, which CI runs`,
      );
    }

    const stated = /All (\w+) run in CI/.exec(doc);
    assert.ok(stated, `${name} no longer states how many checks run in CI`);
    assert.equal(
      stated[1],
      words[inCi.size],
      `${name} says All ${stated[1]} run in CI, and the workflow runs ${inCi.size}`,
    );
  }
});

test('the contract check is still outside CI, which is why the guide says to run it by hand', () => {
  assert.ok(pkg.scripts?.contract, 'there is no contract script to be outside CI');
  assert.ok(!checksInCi().has('contract'), 'the contract check is in CI now');
  assert.match(flat['CONTRIBUTING.md'], /outside CI/);
});

test('the governance record gives active planning one owner for each concern', () => {
  const governance = flat['GOVERNANCE.md'];
  assert.match(governance, /The Issue owns scope, acceptance criteria, dependencies and discussion/);
  assert.match(governance, /open or closed state owns whether the work is active or completed/);
  assert.match(governance, /The Project owns readiness, priority, work type, epic and scoring fields/);
  assert.match(governance, /built-in status is the planning view rather than a second completion record/);
  assert.match(
    governance,
    /frozen \[historical backlog\]\(PRODUCT_BACKLOG\.md\) preserves the original rationale/,
  );
  assert.doesNotMatch(governance, /items with a detail block.*carry that check/);
});

test('active workflow instructions route future work through Issues, not the historical backlog', () => {
  const governance = flat['GOVERNANCE.md'];
  assert.match(copilotInstructions, /Unrelated work becomes a repository Issue/);
  assert.doesNotMatch(copilotInstructions, /follow-up entry in `PRODUCT_BACKLOG\.md`/);
  assert.match(copilotInstructions, /Reading-list publication is gap-tolerant/);
  assert.match(copilotInstructions, /Missing Marvel Unlimited or provider metadata must not block/);
  assert.match(copilotInstructions, /file a separate repository Issue assigned to `raymond-nassar`/);
  assert.match(copilotInstructions, /supersedes older stop-on-any-gap guidance/);
  assert.match(governance, /Issue timeline and linked pull request/);
  assert.doesNotMatch(governance, /backlog block for that item becomes a delivery record/);
  assert.doesNotMatch(governance, /rest becomes a backlog entry/);
  assert.match(governance, /User-visible behavior and release-relevant maintainer changes/);
  assert.match(governance, /editorial-only maintenance/);
  assert.doesNotMatch(governance, /Anything a reader or a maintainer would notice/);
  assert.match(paletteRunner, /Issue that owns the correction/);
  assert.doesNotMatch(paletteRunner, /BL-065 backlog block/);
});

test('a concern about the maintainer has a route that does not go through them', () => {
  // Both halves matter and neither implies the other. The code of conduct has to offer the route,
  // and the governance record has to say why a maintainer cannot judge a concern about
  // themselves, because a single-maintainer project is exactly where that gap opens.
  assert.match(flat['CODE_OF_CONDUCT.md'], /github\.com\/contact\/report-abuse/);
  assert.match(flat['CODE_OF_CONDUCT.md'], /about the maintainer/);
  assert.match(flat['GOVERNANCE.md'], /cannot judge a complaint about themselves/);
});

test('the support guide keeps security reports out of the issue tracker', () => {
  assert.match(flat['SUPPORT.md'], /never goes in an issue/);
  assert.match(flat['SUPPORT.md'], /SECURITY\.md/);
  // The policy has to still be saying the same thing, or the guide is routing people to a
  // document that no longer takes them.
  assert.match(read('SECURITY.md').replace(/\s+/g, ' '), /Do not open a public issue/);
});
