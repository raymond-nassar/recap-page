import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Dependabot fails open. A config that omits an ecosystem is not rejected and reports nothing,
// so the repository looks monitored while a whole class of dependency goes unwatched, and the
// only visible symptom is an absence of pull requests, which is also what a healthy week looks
// like. That is why the expectations below are derived from the repository rather than read out
// of the config: the check has to know what ought to be covered without being told by the file
// it is checking.

const root = new URL('../', import.meta.url);
const config = readFileSync(new URL('.github/dependabot.yml', root), 'utf8');

// Enough of a reader for a file of this shape, and deliberately no more: adding a YAML parser
// would mean adding a dependency, and Repository Constraint 4 puts runtime dependencies at zero
// while the dev graph is the thing this very config exists to watch.
function parseUpdates(text) {
  const lines = text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line));
  const unquote = (value) => value.trim().replace(/^["']|["']$/g, '');
  const entries = [];
  let group = null;
  for (const line of lines) {
    const start = /^\s*-\s*package-ecosystem:\s*(\S+)\s*$/.exec(line);
    if (start) {
      entries.push({ ecosystem: unquote(start[1]), directory: null, interval: null, groups: [] });
      group = null;
      continue;
    }
    if (entries.length === 0) continue;
    const current = entries[entries.length - 1];

    const directory = /^\s*directory:\s*(\S+)\s*$/.exec(line);
    if (directory) current.directory = unquote(directory[1]);
    const interval = /^\s*interval:\s*(\S+)\s*$/.exec(line);
    if (interval) current.interval = unquote(interval[1]);

    // A group identifier is recognised by its indentation rather than by its name, because the
    // config chooses the names and a check that knew them would be reading its own answer back.
    const identifier = /^ {6}([A-Za-z][\w|-]*):\s*$/.exec(line);
    if (identifier) {
      group = { name: identifier[1], appliesTo: 'version-updates', patterns: [] };
      current.groups.push(group);
      continue;
    }
    if (!group) continue;
    const appliesTo = /^\s*applies-to:\s*(\S+)\s*$/.exec(line);
    if (appliesTo) group.appliesTo = unquote(appliesTo[1]);
    const pattern = /^\s*-\s*(\S+)\s*$/.exec(line);
    if (pattern) group.patterns.push(unquote(pattern[1]));
  }
  return entries;
}

// Keyed on the files that make an ecosystem present rather than on a list of the ecosystems this
// repository happens to have. The difference is the whole point: a list of what is here can only
// confirm what someone already knew, while this fails the day a manifest arrives that nothing is
// watching. It is still a list, and the residual risk is a manifest missing from it, so add the
// row in the same change that adds the manifest.
const MANIFESTS = [
  [/(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/, 'npm'],
  [/(^|\/)bun\.lockb?$/, 'bun'],
  [/(^|\/)(requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.py|setup\.cfg)$/, 'pip'],
  [/(^|\/)uv\.lock$/, 'uv'],
  [/(^|\/)Gemfile$/, 'bundler'],
  [/(^|\/)go\.mod$/, 'gomod'],
  [/(^|\/)Cargo\.toml$/, 'cargo'],
  [/(^|\/)composer\.json$/, 'composer'],
  [/(^|\/)Dockerfile(\.[^/]+)?$/, 'docker'],
  [/(^|\/)(docker-)?compose\.ya?ml$/, 'docker-compose'],
  [/(^|\/)\.gitmodules$/, 'gitsubmodule'],
  [/(^|\/)([^/]+\.(csproj|vbproj|fsproj|sln)|packages\.config)$/, 'nuget'],
  [/(^|\/)pubspec\.yaml$/, 'pub'],
  [/(^|\/)mix\.exs$/, 'hex'],
  [/(^|\/)build\.gradle(\.kts)?$/, 'gradle'],
  [/(^|\/)pom\.xml$/, 'maven'],
  [/(^|\/)[^/]+\.tf$/, 'terraform'],
  [/(^|\/)Chart\.ya?ml$/, 'helm'],
  [/(^|\/)elm\.json$/, 'elm'],
  [/(^|\/)deno\.jsonc?$/, 'deno'],
  [/(^|\/)Package\.swift$/, 'swift'],
  [/(^|\/)devcontainer\.json$/, 'devcontainers'],
  [/(^|\/)vcpkg\.json$/, 'vcpkg'],
];

// Listed by git rather than walked, so the population is the tracked tree and an untracked
// scratch file cannot invent an ecosystem. This throws if git is unavailable, which is the right
// direction to fail in: a check that cannot see the repository must not report on it.
function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: fileURLToPath(root), encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
}

function expectedEcosystems(files) {
  const expected = new Set();
  for (const file of files) {
    for (const [pattern, ecosystem] of MANIFESTS) {
      if (pattern.test(file)) expected.add(ecosystem);
    }
    // `uses:` rather than the presence of a workflow file, because a workflow that calls no
    // action has nothing for this ecosystem to update and would make the entry the stale kind.
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)
      && /^\s*(-\s*)?uses:\s*\S/m.test(readFileSync(new URL(file, root), 'utf8'))) {
      expected.add('github-actions');
    }
  }
  return expected;
}

// The set Dependabot accepts. An interval outside it is not ignored: the file is invalid, so
// every ecosystem stops being watched at once, which presents exactly as the quiet week this
// config exists to tell apart from real coverage.
const INTERVALS = new Set(['daily', 'weekly', 'monthly', 'quarterly', 'semiannually', 'yearly', 'cron']);

test('every dependency ecosystem in this repository is one Dependabot is configured to watch', () => {
  const configured = new Set(parseUpdates(config).map((entry) => entry.ecosystem));
  const expected = expectedEcosystems(trackedFiles());

  const missing = [...expected].filter((name) => !configured.has(name));
  assert.deepEqual(missing, [], `ecosystems present but unwatched: ${missing.join(', ')}`);

  // The other direction matters as much and is quieter: an entry for something the repository no
  // longer contains never opens a pull request, so it reads as coverage forever.
  const stale = [...configured].filter((name) => !expected.has(name));
  assert.deepEqual(stale, [], `ecosystems watched but absent: ${stale.join(', ')}`);
});

test('each watched ecosystem names a directory and an interval Dependabot accepts', () => {
  const entries = parseUpdates(config);
  assert.ok(entries.length > 0, 'no update entries parsed out of the config');
  for (const entry of entries) {
    assert.ok(entry.directory?.startsWith('/') && !entry.directory.includes('..'),
      `${entry.ecosystem} must watch a repository-relative directory`);
    if (entry.ecosystem === 'github-actions') {
      assert.equal(entry.directory, '/', 'GitHub Actions must watch the repository root');
    } else {
      const prefix = entry.directory === '/' ? '' : `${entry.directory.slice(1)}/`;
      assert.ok(trackedFiles().some((file) => file.startsWith(prefix)
        && MANIFESTS.some(([pattern, ecosystem]) => ecosystem === entry.ecosystem && pattern.test(file))),
      `${entry.ecosystem} has no dependency manifest under ${entry.directory}`);
    }
    assert.ok(INTERVALS.has(entry.interval),
      `${entry.ecosystem} schedules on "${entry.interval}", which Dependabot rejects`);
  }
});

test('both kinds of update are grouped, so neither arrives one pull request per package', () => {
  // The low-noise promise is made in this config's own comments, in the backlog and in the
  // changelog, and until this test nothing checked it. The security half is the half that gets
  // missed, because a group covers version updates unless it says otherwise, and the case it
  // covers is the one where several packages are hit at once.
  for (const entry of parseUpdates(config)) {
    for (const kind of ['version-updates', 'security-updates']) {
      const covering = entry.groups.filter((g) => g.appliesTo === kind && g.patterns.includes('*'));
      assert.equal(covering.length, 1,
        `${entry.ecosystem} has ${covering.length} group(s) matching * for ${kind}, expected 1`);
    }
  }
});
