import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = ['src', 'js', 'lib', 'homeUpdatesContent.js'];
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function releaseId(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Unsupported product version: ${version}`);
  }
  const parts = version.split('.').map(Number);
  if (parts.some((part) => part > 99999)) throw new Error(`Product version out of range: ${version}`);
  return (parts[0] * 100000 + parts[1]) * 100000 + parts[2] + 1;
}

function records(text) {
  const headings = [...text.matchAll(/^## (.+)\r?$/gm)];
  return headings.map((match, index) => ({
    version: match[1].trim(),
    body: text.slice(match.index + match[0].length, headings[index + 1]?.index ?? text.length),
  })).filter(({ version }) => /^\d+\.\d+\.\d+$/.test(version));
}

function selectRecord(text, version) {
  const all = records(text);
  const matches = all.filter((record) => record.version === version);
  if (matches.length !== 1) throw new Error(`Expected one finalized release record for ${version}`);
  const index = all.indexOf(matches[0]);
  const previous = all[index + 1]?.version;
  if (!previous || releaseId(previous) >= releaseId(version)) {
    throw new Error(`Missing or unordered predecessor for ${version}`);
  }
  return { ...matches[0], previous };
}

export function readerFeatures(body) {
  const headings = [...body.matchAll(/^### .+\r?$/gm)];
  if (!headings.length || body.slice(0, headings[0].index).trim()) {
    throw new Error('Release needs a first reader-summary section');
  }
  const lines = body.slice(headings[0].index + headings[0][0].length, headings[1]?.index ?? body.length).split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  if (!lines.length) return [];
  const features = [];
  for (const [index, line] of lines.entries()) {
    const bullet = /^[-*+] (.+)$/.exec(line);
    if (bullet) {
      if (!bullet[1].trim()) throw new Error('Reader summary contains an empty bullet');
      features.push(bullet[1].trim());
    }
    else if (/^ {2,}\S/.test(line) && features.length && !/^\s+([-*+] |\d+[.)] )/.test(line)) {
      features[features.length - 1] += ` ${line.trim()}`;
    } else if (!line.trim() && features.length) {
      const next = lines.slice(index + 1).find((value) => value.trim());
      if (next && /^\s*(?:[-*+](?:\s|$)|\d+[.)](?:\s|$))/.test(next) && !/^[-*+] .+/.test(next)) {
        throw new Error('Reader summary contains a malformed bullet');
      }
      if (!next || !/^[-*+] .+/.test(next)) break;
    }
    else throw new Error('Reader summary must start with a top-level bullet block');
  }
  if (!features.length || features.some((text) => /[\u2013\u2014]/.test(text))) {
    throw new Error('Reader summary is empty or contains unsupported dash copy');
  }
  return features;
}

function catalogTuples(text) {
  const catalog = JSON.parse(text);
  if (!Array.isArray(catalog.lists)) throw new Error('Catalog must contain lists');
  const seen = new Set();
  return catalog.lists.map(({ id, name, file }) => {
    if (typeof id !== 'string' || !id.trim() || seen.has(id)
      || typeof name !== 'string' || !name.trim()
      || typeof file !== 'string' || !/^[\w-]+\.json$/.test(file)) {
      throw new Error(`Invalid or duplicate catalog identity: ${id}`);
    }
    seen.add(id);
    return [id, name, file];
  });
}

function repository(root) {
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const show = (ref, path) => git('show', `${ref}:${path}`);
  const versionAt = (ref) => JSON.parse(show(ref, 'package.json')).version;
  const snapshot = (ref) => {
    const version = versionAt(ref);
    releaseId(version);
    const constant = /export const APP_VERSION = '([^']+)';/.exec(show(ref, 'src/js/lib/version.js'));
    if (constant?.[1] !== version) throw new Error(`Version constant disagrees at ${ref}`);
    const changelog = show(ref, 'CHANGELOG.md');
    if (records(changelog).filter((record) => record.version === version).length !== 1) {
      throw new Error(`Missing finalized record at ${ref}`);
    }
    return { ref, version, changelog, tuples: catalogTuples(show(ref, 'src/data/catalog.json')) };
  };
  const tag = (version) => {
    const result = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/v${version}`], { cwd: root });
    if (result.error) throw result.error;
    if (result.status === 1) return null;
    if (result.status !== 0) throw new Error(`Cannot inspect tag v${version}`);
    return git('rev-parse', `refs/tags/v${version}^{commit}`);
  };
  let history;
  const introduction = (version) => {
    history ??= git('log', '--first-parent', '--format=%H', '--', 'package.json')
      .split(/\r?\n/).reverse().map((ref) => ({ ref, version: versionAt(ref) }));
    const starts = history.filter((entry, index) => entry.version === version
      && history[index - 1]?.version !== version);
    if (starts.length > 1) throw new Error(`Ambiguous or reverted product version: ${version}`);
    return starts[0]?.ref ?? null;
  };
  const endpoint = (version) => {
    const introduced = introduction(version);
    const ref = tag(version) ?? introduced;
    if (!ref) throw new Error(`Unavailable exact product endpoint: ${version}`);
    const value = snapshot(ref);
    if (value.version !== version) throw new Error(`Wrong product endpoint for ${version}`);
    return value;
  };
  const ancestor = (before, after) => {
    git('merge-base', '--is-ancestor', before, after);
  };
  return { git, snapshot, tag, introduction, endpoint, ancestor };
}

function render(data) {
  const json = JSON.stringify(data).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return '// Generated by scripts/generate-home-updates.mjs. Regenerate rather than editing.\n'
    + 'const freeze = (value) => {\n'
    + "  if (value && typeof value === 'object') {\n"
    + '    Object.values(value).forEach(freeze);\n'
    + '    Object.freeze(value);\n'
    + '  }\n'
    + '  return value;\n'
    + '};\n'
    + `export const homeUpdatesContent = freeze(JSON.parse('${json}'));\n`;
}

function recorded(source) {
  const match = /^export const homeUpdatesContent = freeze\(JSON\.parse\('((?:\\.|[^'\\])*)'\)\);$/m.exec(source);
  if (!match) throw new Error('Malformed generated highlights; restore or bootstrap the asset');
  const value = JSON.parse(match[1].replace(/\\(['\\])/g, '$1'));
  if (render(value) !== source || value.schema !== 1
    || !['candidate', 'bootstrap'].includes(value.sourceMode)
    || !/^[a-f0-9]{64}$/.test(value.catalogs?.target)
    || !/^[a-f0-9]{64}$/.test(value.catalogs?.previous)) {
    throw new Error('Invalid recorded highlights provenance');
  }
  releaseId(value.version);
  releaseId(value.previousVersion);
  return value;
}

export function generateHomeUpdates({ root = ROOT, mode, version: requested, check = false } = {}) {
  if (!['candidate', 'bootstrap', 'recorded'].includes(mode)) throw new Error('Choose an explicit source mode');
  const repo = repository(root);
  if (repo.git('rev-parse', '--is-shallow-repository') !== 'false') throw new Error('Full Git history is required');
  const workingVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  releaseId(workingVersion);
  const output = join(root, ...OUTPUT);
  const oldSource = existsSync(output) ? readFileSync(output, 'utf8') : null;
  const workingNotes = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  let old;
  let target;
  let record;
  let sourceMode = mode;
  const version = mode === 'bootstrap' ? requested?.replace(/^v/, '') : workingVersion;
  if (version !== workingVersion) throw new Error('Highlights must describe the canonical running product version');
  releaseId(version);
  if (mode === 'bootstrap') {
    target = repo.endpoint(version);
    record = selectRecord(target.changelog, version);
  } else {
    record = selectRecord(workingNotes, version);
    if (mode === 'recorded') {
      if (!oldSource) throw new Error('No recorded highlights; bootstrap first');
      old = recorded(oldSource);
      if (old.version !== version || old.previousVersion !== record.previous) throw new Error('Recorded version mismatch');
      sourceMode = old.sourceMode;
    } else {
      if (repo.tag(version)) throw new Error('Already tagged version; use recorded copy regeneration');
      if (oldSource) {
        const prior = recorded(oldSource);
        if (prior.version === version) old = prior;
      }
    }
    const introduction = repo.introduction(version);
    const introduced = repo.tag(version) ?? introduction;
    if (introduced) {
      if (!old) throw new Error('Same-version candidate requires validated recorded highlights');
      target = repo.endpoint(version);
    } else {
      target = repo.snapshot('HEAD');
      if (target.version !== record.previous || releaseId(version) <= releaseId(target.version)) {
        throw new Error('Candidate must advance the canonical predecessor');
      }
      const workingTuples = catalogTuples(readFileSync(join(root, 'src', 'data', 'catalog.json'), 'utf8'));
      if (hash(workingTuples) !== hash(target.tuples)) throw new Error('Commit functional catalog changes before preparation');
    }
    if (mode === 'candidate' && hash(catalogTuples(readFileSync(join(root, 'src', 'data', 'catalog.json'), 'utf8')))
      !== hash(target.tuples)) throw new Error('Candidate cannot recapture later Unreleased catalog changes');
  }
  const previous = repo.endpoint(record.previous);
  repo.ancestor(previous.ref, target.ref);
  repo.ancestor(target.ref, 'HEAD');
  const catalogs = { target: hash(target.tuples), previous: hash(previous.tuples) };
  if (old && (old.previousVersion !== record.previous || JSON.stringify(old.catalogs) !== JSON.stringify(catalogs))) {
    throw new Error('Recorded catalog snapshot disagrees with exact product boundaries');
  }
  const features = readerFeatures(record.body);
  const before = new Set(previous.tuples.map(([id]) => id));
  const listIds = target.tuples.map(([id]) => id).filter((id) => !before.has(id));
  const data = {
    schema: 1, version, previousVersion: record.previous, sourceMode, catalogs,
    digest: hash({ version, previousVersion: record.previous, catalogs, features, listIds }),
    batch: features.length || listIds.length ? { id: releaseId(version), features, listIds } : null,
  };
  const source = render(data);
  if (check) {
    if (source !== oldSource) throw new Error('Generated highlights are stale; regenerate from the selected source');
    return { data, changed: false };
  }
  if (source === oldSource) return { data, changed: false };
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporary, source, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { data, changed: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const sources = args.filter((arg) => ['--candidate', '--recorded'].includes(arg) || arg.startsWith('--bootstrap='));
    if (sources.length !== 1 || args.some((arg) => arg !== '--check' && !sources.includes(arg))
      || args.filter((arg) => arg === '--check').length > 1) throw new Error('Invalid generator arguments');
    const source = sources[0];
    const result = generateHomeUpdates({
      mode: source.startsWith('--bootstrap=') ? 'bootstrap' : source.slice(2),
      version: source.startsWith('--bootstrap=') ? source.slice('--bootstrap='.length) : undefined,
      check: args.includes('--check'),
    });
    console.log(`home-updates: ${result.data.version}, ${result.changed ? 'generated' : 'current'}`);
  } catch (error) {
    console.error(`home-updates: ${error.message}`);
    process.exitCode = 1;
  }
}
