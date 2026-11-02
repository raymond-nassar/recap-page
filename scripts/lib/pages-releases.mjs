// Builds the project home's What's new page from the changelog's reader summaries, the first
// section of each release record. The in-app What's new is generated from that same section by
// readerFeatures, so the page and the app cannot say different things about a release, and the
// page needs no copy of its own that someone would have to keep in step.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readerFeatures, releaseRecords } from '../generate-home-updates.mjs';
import { REPOSITORY, escapeHtml, slugify } from './pages-documents.mjs';

export const RECENT_RELEASES = 5;

// Release notes name a platform in passing, so a whole line cannot be labelled from the names it
// contains: the 4.3.0 backup line scopes OneDrive to Windows and Android, while the complete backup
// file in the same sentence is everywhere. Each line that mentions a platform or a platform-bound
// capability therefore carries a reviewed label saying which part is limited and where. The build
// refuses an unlabelled line of that kind and a label whose line no longer exists, so a reworded or
// new release note cannot publish without someone deciding what its label should say.
export const PLATFORM_LABELS = new Map([
  [
    'Back up automatically to your own OneDrive on Windows and Android, or move your reading data with one complete backup file.',
    'OneDrive backup: Windows and Android only.',
  ],
  [
    'Use clearer phone layouts and screen reader labels, and install the app from Edge when offered.',
    'Installing from Edge: Windows only.',
  ],
  [
    'On Windows, make any curated Reading List available offline from its preview. The Android app already contains every Reading List, so it needs no offline copy.',
    'Offline Reading Lists: Windows only.',
  ],
  [
    'Use centered bottom navigation icons on narrow screens, with the larger Android More target retained from 4.0.1.',
    'Larger More button: Android only.',
  ],
  [
    'Use an Android More button with the required larger touch target.',
    'Android only.',
  ],
]);

const PLATFORM_BOUND = /\b(?:Windows|Android|iPhone|iPad|iOS|macOS|Mac|Edge|Chrome|Safari|Firefox|OneDrive|Google Drive|iCloud|Microsoft|Google Play|App Store|TestFlight|offline|install\w*|cloud)\b/i;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatReleaseDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month || Number(match[3]) < 1 || Number(match[3]) > 31) {
    throw new Error(`Unreadable release date: ${date}`);
  }
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

// A release is published here once its exact source is recorded: a version tag, or for an Android
// patch that was never tagged, such as 4.0.1, the uploaded bundle's revision in the Android version
// ledger. Either way the date is that revision's commit date, read from the local clone, so the build
// makes no network request. A clone without that history is refused rather than published undated.
export function readReleaseDates(root) {
  const git = (args) => execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const dates = new Map();
  const tags = git(['for-each-ref', '--format=%(refname:strip=2) %(*committerdate:short)%(committerdate:short)', 'refs/tags/v*']);
  for (const line of tags.split(/\r?\n/)) {
    const match = /^v(\d+\.\d+\.\d+) (\d{4}-\d{2}-\d{2})$/.exec(line.trim());
    if (match) dates.set(match[1], match[2]);
  }
  if (dates.size === 0) {
    throw new Error('No release tags found; build the Pages home from a clone with full history and tags');
  }

  const ledger = JSON.parse(readFileSync(join(root, 'packaging', 'android', 'version-codes.json'), 'utf8'));
  for (const { productVersion, sourceRevision, artifact } of ledger.reservations) {
    if (!artifact || dates.has(productVersion)) continue;
    dates.set(productVersion, git(['show', '-s', '--format=%cs', `${sourceRevision}^{commit}`]).trim());
  }
  return dates;
}

function labelled(feature) {
  const label = PLATFORM_LABELS.get(feature);
  if (label) return `<strong>${escapeHtml(label)}</strong> ${escapeHtml(feature)}`;
  if (PLATFORM_BOUND.test(feature)) {
    throw new Error(`Release note needs a reviewed platform label in scripts/lib/pages-releases.mjs: ${feature}`);
  }
  return escapeHtml(feature);
}

export function selectRecentReleases(changelog, dates, count = RECENT_RELEASES) {
  const released = releaseRecords(changelog).filter(({ version }) => dates.has(version));
  if (released.length === 0) throw new Error('No tagged release has a changelog record');
  return released.slice(0, count).map(({ version, body }) => ({
    version,
    date: dates.get(version),
    features: readerFeatures(body),
  }));
}

// Release notes are plain text, which the app shows as written, so they are escaped here rather than
// passed through the Markdown converter: a film title such as Thunderbolts* is a name, not emphasis.
export function releasesPage(changelog, dates) {
  const records = releaseRecords(changelog);
  // Release PRs run before their version is tagged. Refuse missing labels there, rather than
  // waiting until the first post-tag Pages deployment discovers them.
  for (const { body } of records.slice(0, RECENT_RELEASES)) {
    readerFeatures(body).forEach(labelled);
  }
  const releases = selectRecentReleases(changelog, dates);

  const everyFeature = new Set(records.flatMap(({ body }) => {
    try {
      return readerFeatures(body);
    } catch {
      return [];
    }
  }));
  for (const feature of PLATFORM_LABELS.keys()) {
    if (!everyFeature.has(feature)) {
      throw new Error(`Platform label names a release note the changelog no longer has: ${feature}`);
    }
  }

  const count = releases.length === 1 ? 'latest release' : `latest ${releases.length} releases`;
  const title = "What's new";
  const html = [
    `<h1 id="${slugify(title)}">${escapeHtml(title)}</h1>`,
    `<p>The ${count} of Recap Page, newest first, in the same words the app uses for its own What's new. A change that is only on some platforms says which ones. Each date is when the release was finalized, and an app store can take a few more days to offer it.</p>`,
    ...releases.flatMap(({ version, date, features }) => [
      `<h2 id="${slugify(`Version ${version}`)}">Version ${escapeHtml(version)}</h2>`,
      `<p>Finalized ${formatReleaseDate(date)}.</p>`,
      features.length
        ? ['<ul>', ...features.map((feature) => `  <li>${labelled(feature)}</li>`), '</ul>'].join('\n')
        : '<p>This release made no change a reader would notice.</p>',
    ]),
    `<p>For older releases, saved data compatibility and technical detail, see <a href="${REPOSITORY}/blob/main/CHANGELOG.md">the full changelog</a>.</p>`,
  ].join('\n');
  return { title, html };
}
