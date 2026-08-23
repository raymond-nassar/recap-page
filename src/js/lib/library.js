// The two Library sub-views the adopted design specified, defined once.
//
// Each entry carries the value the rail button and the section id are both built from, the label
// they both show, the subtitle under the heading, what to say when there is nothing, and the
// selector that produces the rows. One entry is therefore one view, and a view that exists in the
// markup but not here cannot be rendered, because the renderer reads this list and nothing else.
//
// This is the shape READING_FILTERS uses, for the same reason and one difference. The reason is
// that a list of view names living in two places drifts silently: `showView` hides every section
// by name and then focuses the heading of the one it just showed, so a rail button naming a view
// with no section blanks the page and throws, and a section with no route is simply unreachable.
// The difference is that the sections stay in `src/index.html` beside every other view rather than
// being built from this list at boot, because a view is a page of content and belongs where the
// rest of the pages are. They are empty shells: heading, subtitle and empty text are rendered from
// here, so the only copy that exists twice is the rail button's label, which the markup has to
// carry to be a button at all. `test/library.test.js` reads both files off disk and fails on any
// disagreement between them, so READING_FILTERS makes its drift impossible to express and this
// makes its drift impossible to ship.
//
// Both selectors read state the app already holds, so no constraint is engaged. Neither view
// writes anything.

import { readIssues, manualIssues } from './model.js';
import { readSummary, manualSummary, readGroups, titleGroups } from './librarySummary.js';

export const DEFAULT_LIST_NAME = 'My Reading List';

// Display order is the order the adopted direction lists them in, with the existing Progress by
// series between them, which is why the two are not adjacent in the rail.
export const LIBRARY_VIEWS = [
  {
    value: 'library-read',
    label: 'Everything read',
    // Says "wherever it came from" because that is the part no other view can show. Read state
    // survives the deletion of the list that introduced it, deliberately, so this is the only
    // place an issue you read inside an order you have since deleted still appears.
    sub: 'Every issue you have marked read, newest first, wherever it came from.',
    empty: 'Nothing is marked read yet.',
    // The empty state offers the thing to do rather than describing it. It used to end with
    // "Open a reading order and tick issues off as you go", which is an instruction a reader has
    // to carry to a different screen and act on from memory.
    emptyAction: { label: 'Browse Reading Lists', view: 'catalog' },
    // A hand-added issue is otherwise indistinguishable from a curated one here, and it is the
    // one row on this page whose details will never arrive from anywhere.
    markHandAdded: true,
    // The band reads as three sentences with their figures, "128 issues read", "31 series",
    // "4 in no list", so the labels are lower case and are not headings. The last count is the
    // one nothing else can show: an issue read inside a since-deleted order belongs to no list.
    summarise: (rows) => {
      const { issues, series, orphans } = readSummary(rows);
      return [
        { figure: issues, label: 'issues read' },
        { figure: series, label: 'series' },
        { figure: orphans, label: 'in no list' },
      ];
    },
    // Read date decides the section, so the same issue drifts from "Today" downwards as time
    // passes, which is why the grouper is given the clock rather than reading it itself.
    group: readGroups,
    select: readIssues,
  },
  {
    value: 'library-manual',
    label: 'Added by hand',
    sub: 'Every issue you typed in yourself, sorted by title.',
    empty: 'Nothing has been added by hand yet.',
    // Named the rail button in prose before, which asked the reader to find a control by its
    // label rather than handing it to them.
    emptyAction: { label: 'Add an issue by hand', view: 'add-manual' },
    // Every row here is hand-added, so the badge would mark nothing out and would repeat itself
    // down the whole page.
    markHandAdded: false,
    summarise: (rows) => {
      const { issues, read, orphans } = manualSummary(rows);
      return [
        { figure: issues, label: 'added by hand' },
        { figure: read, label: 'read' },
        { figure: orphans, label: 'in no list' },
      ];
    },
    // Grouped by first letter, which has no time in it, so the clock the renderer passes both
    // views is taken and dropped here rather than reaching a grouper that has no use for it.
    group: (rows) => titleGroups(rows),
    select: manualIssues,
  },
];

export function libraryView(value) {
  return LIBRARY_VIEWS.find((v) => v.value === value) ?? null;
}

export function isLibraryView(value) {
  return libraryView(value) !== null;
}

// The ways the list can be self-inconsistent, reported rather than thrown so the caller chooses
// when to fail, which is what lets this be exercised against a list built to be wrong. The
// `view-` prefix check is not cosmetic: the section id is derived from the value, so a value
// carrying a space or a quote would produce markup no selector could address.
export function libraryViewProblems(views) {
  const problems = [];
  if (!Array.isArray(views) || views.length === 0) return ['The Library view list is empty.'];
  const seen = new Set();
  for (const [i, v] of views.entries()) {
    const where = `Library view ${i}`;
    if (!v || typeof v.value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(v.value)) {
      problems.push(`${where} has no value usable as a section id.`);
    } else if (seen.has(v.value)) problems.push(`${where} repeats the value ${JSON.stringify(v.value)}.`);
    else seen.add(v.value);
    for (const field of ['label', 'sub', 'empty']) {
      if (!v || typeof v[field] !== 'string' || v[field] === '') problems.push(`${where} has no ${field}.`);
    }
    // Checked for presence rather than truth, because false is a meaningful answer and an entry
    // that simply forgot to answer would otherwise be read as having said no.
    if (!v || typeof v.markHandAdded !== 'boolean') problems.push(`${where} does not say whether to mark hand-added rows.`);
    if (!v || typeof v.select !== 'function') problems.push(`${where} has no select function.`);
    // A view now carries its own summary and grouping, so a section that forgot either would
    // render its heading and then throw the moment the renderer reached for the missing one.
    if (!v || typeof v.summarise !== 'function') problems.push(`${where} has no summarise function.`);
    if (!v || typeof v.group !== 'function') problems.push(`${where} has no group function.`);
    // Optional, because an empty state that genuinely has nothing to offer is a real answer. If
    // one is declared it has to be usable, so a typo in the destination fails here rather than
    // painting a button that navigates nowhere.
    if (v && v.emptyAction !== undefined) {
      const a = v.emptyAction;
      if (!a || typeof a.label !== 'string' || a.label === '' || typeof a.view !== 'string' || a.view === '') {
        problems.push(`${where} has an empty-state action with no label or no destination.`);
      }
    }
  }
  return problems;
}

// Checked at load so a malformed entry stops the app on the boot after the edit that made it,
// rather than at whichever later moment a reader happens to press that rail button.
const problems = libraryViewProblems(LIBRARY_VIEWS);
if (problems.length) throw new Error(`Library views are inconsistent: ${problems.join(' ')}`);
