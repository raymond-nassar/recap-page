import { searchCatalog } from './catalog.js';

const identifier = (value) => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const text = (value) => typeof value === 'string' && Boolean(value.trim());

function requireValue(condition, message) {
  if (!condition) throw new Error(`MCU release metadata: ${message}`);
}

function dayDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function httpsSource(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function parseMcuPrep(raw) {
  requireValue(raw?.schemaVersion === 1 && raw.region === 'US' && raw.seriesDateKind === 'premiere',
    'expected version 1, U.S. releases and series premiere dates.');
  requireValue(Array.isArray(raw.sources) && Array.isArray(raw.releases) && Array.isArray(raw.guides),
    'sources, releases and guides must be arrays.');
  const sources = new Map();
  for (const source of raw.sources) {
    requireValue(identifier(source?.id) && !sources.has(source.id), 'source IDs must be unique.');
    requireValue(httpsSource(source.url) && dayDate(source.retrievedAt),
      `${source.id} needs an HTTPS source and a valid retrieval date.`);
    sources.set(source.id, { ...source });
  }
  const releases = new Map();
  for (const release of raw.releases) {
    requireValue(identifier(release?.id) && !releases.has(release.id), 'release IDs must be unique.');
    requireValue(text(release.title) && Number.isSafeInteger(release.phase) && release.phase > 0,
      `${release.id} needs a title and a positive whole phase.`);
    requireValue(['movie', 'series'].includes(release.format), `${release.id} has an invalid format.`);
    requireValue(['released', 'scheduled'].includes(release.status), `${release.id} has an invalid status.`);
    requireValue(typeof release.date === 'string'
      && (dayDate(release.date) || /^\d{4}$/.test(release.date))
      && Number(release.date.slice(0, 4)) >= 2008,
    `${release.id} needs a real calendar date or a year, without invented precision.`);
    requireValue(Array.isArray(release.sources) && release.sources.length > 0
      && new Set(release.sources).size === release.sources.length
      && release.sources.every((id) => sources.has(id)), `${release.id} has missing or invalid sources.`);
    releases.set(release.id, { ...release, title: release.title.trim(), sources: [...release.sources] });
  }
  const guides = new Map();
  for (const guide of raw.guides) {
    requireValue(identifier(guide?.id) && !guides.has(guide.id), 'guide IDs must be unique.');
    requireValue(Array.isArray(guide.releases)
      && new Set(guide.releases).size === guide.releases.length
      && guide.releases.every((id) => releases.has(id)), `${guide.id} has missing or duplicate releases.`);
    requireValue(guide.releases.length > 0 || text(guide.note), `${guide.id} needs an unassigned reason.`);
    guides.set(guide.id, guide.releases.map((id) => releases.get(id)).sort(compareReleases));
  }
  return { sources, releases, guides };
}

function compareReleases(a, b) {
  const year = Number(a.date.slice(0, 4)) - Number(b.date.slice(0, 4));
  if (year) return year;
  // Year-only entries follow known days in that year without pretending to have a calendar day.
  if (a.date.length !== b.date.length) return b.date.length - a.date.length;
  return a.date.localeCompare(b.date);
}

export function releaseDateLabel(release, locale = 'en-US') {
  const date = release.date.length === 4
    ? `${release.date} (year only)`
    : new Date(`${release.date}T00:00:00Z`).toLocaleDateString(locale, {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  return release.status === 'scheduled' ? `Scheduled: ${date}` : date;
}

export function mcuPrepSections(lists, metadata, { query = '', sort = 'oldest' } = {}) {
  requireValue(['oldest', 'newest'].includes(sort), 'release order must be oldest or newest.');
  const entries = lists.filter((list) => list.type === 'screen-companion').map((list) => {
    const releases = metadata?.guides.get(list.id) ?? [];
    return { list, releases, primary: releases[0] ?? null };
  });
  const matches = new Set(searchCatalog(entries.map(({ list, releases }) => ({
    ...list,
    characters: list.characters ?? [],
    keywords: [...(list.keywords ?? []), ...releases.map((release) => release.title)],
  })), query).map((list) => list.id));
  const phases = new Map();
  const unassigned = [];
  for (const entry of entries) {
    if (!matches.has(entry.list.id)) continue;
    if (!entry.primary) {
      unassigned.push(entry);
      continue;
    }
    const phase = entry.primary.phase;
    if (!phases.has(phase)) phases.set(phase, []);
    phases.get(phase).push(entry);
  }
  const direction = sort === 'newest' ? -1 : 1;
  const sections = [...phases.keys()].sort((a, b) => direction * (a - b)).map((phase) => ({
    key: `phase-${phase}`,
    heading: `Phase ${phase}`,
    entries: phases.get(phase).sort((a, b) => direction * compareReleases(a.primary, b.primary)),
  }));
  if (unassigned.length) sections.push({
    key: 'unassigned',
    heading: metadata ? 'More MCU reading' : 'MCU Prep reading lists',
    entries: unassigned,
  });
  return sections;
}
