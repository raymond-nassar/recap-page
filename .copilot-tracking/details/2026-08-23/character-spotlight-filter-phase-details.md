<!-- markdownlint-disable-file -->
# RPI Phase Details: Character Spotlight filter

## Metadata

* Task ID: MRT-002-C04
* Task slug: character-spotlight-filter
* Related plan: .copilot-tracking/plans/2026-08-23/character-spotlight-filter-plan.md
* Evidence sources: .copilot-tracking/research/2026-08-23/character-spotlight-filter-research.md

## Phase Index

| Phase ID | Name | Status | Detail sections |
|---|---|---|---|
| P01 | Establish the explicit taxonomy | complete | P01, P01-T01, P01-T02 |
| P02 | Add the shelf-local accessible filter | complete | P02, P02-T01, P02-T02 |
| P03 | Prove, record, and independently review | complete | P03, P03-T01, P03-T02 |
| P04 | Deliver through PR, CI, and merge | in progress | P04, P04-T01, P04-T02 |

## Task-Level Context

### Context

Character Spotlight has 11 readings across 10 stories. Research found five explicit Best of readings,
two complete guides, and four readings that fit neither requested subset. Existing depth, count, names,
and source URLs cannot classify them accurately. The current generic facet controls are hidden at this
shelf size, but their native radio semantics and styles are reusable.

### Intent

Plan one shelf-local feature from explicit data through accessible UI, proof, records, Review, PR, CI,
and merge.

### Boundaries

* Included: taxonomy, schema hops, generated catalog, header controls, shelf-local filtering, focused
  styles, existing test harnesses, direct docs, version, anchors, gates, one Review, PR, CI, merge.
* Excluded: card replacement, inferred categories, fourth visible choice, other shelves, storage,
  routes, reader launch, availability, runtime dependencies, unrelated backlog work.

### Initial Evidence and Readiness

* Research status: complete and Ready.
* Current counts: 11 character readings, 10 stories.
* Selected taxonomy: `best-of`, `complete-guide`, `other`.
* Selected control: native radio group in the Character Spotlight header.
* Selected renderer point: after shelf slice, before search and grouping.
* Planning blockers: none; the single critique is complete, all four findings are resolved, and
  P03-T01 has closed every pre-Review gate.

### Locked Test and Change Boundary

* Exact production removals: none.
* Maximum new production files: zero.
* Maximum new test files: zero.
* Canonical data: `src/data/curated-lists.json`.
* Generated data: `src/data/catalog.json`.
* Semantic owners: `test/curated.test.js`, `test/catalog.test.js`.
* Shelf regression owner: `test/catalog-shelves.test.js`.
* Browser owner: `scripts/browser-check.mjs`.
* Exact browser scope: default All, Best of, Complete guides, return to All, native keyboard and focus,
  selected state, path arrival revealing Essential Avengers, active forced colors with an observable
  Highlight border and restored normal state, and 360x800 wrapping and overflow.
* Direct docs: maintenance, provenance, backlog, changelog.
* Exact removals from existing tests or browser checks: none.

### Unresolved Items

* None.

### Current Status

* P03-T01 is complete with full local, Edge, anchor, publication, and diff evidence.
* P03-T02 is complete after exactly one independent Review.
* RV-001 is resolved against P01-T01 and P01-T02 after its tightened assertions failed before the
  fix and the complete validation boundary passed after it.
* P04-T01 is active. Review remains closed at one run.

<!-- rpi:phase id=P01 -->
## P01: Establish the explicit taxonomy

### Context

The manifest parser, vendor generator, and runtime parser each explicitly enumerate editorial fields.
Missing one hop would either reject the manifest, omit the generated value, or discard it in the
browser.

### Intent

Create one strict, reproducible taxonomy contract and classify every current character record.

### Boundaries

* Included: enum export or shared constant where current architecture supports it, manifest rules,
  group agreement, generated copy, runtime normalization, exact assignments, catalog-only rebuild.
* Excluded: changing type, depth, names, descriptions, files, counts, source links, groups, order, or
  issue payloads.

### Likely Targets

* `src/js/lib/catalog.js`: taxonomy values, runtime normalization, filter helper and labels.
* `src/js/lib/curated.js`: required character-only validation and grouped agreement.
* `scripts/vendor-orders.mjs`: generated field copy.
* `src/data/curated-lists.json`: canonical assignments.
* `src/data/catalog.json`: generated assignments.
* `test/curated.test.js`: schema and group agreement.
* `test/catalog.test.js`: parsing and filtering semantics.

### Dependencies

* Complete Research and dispositioned critique.

### Validation Expectations

* All valid current entries parse.
* Every malformed, absent, unknown, non-character, or group-inconsistent value fails in the correct
  layer.
* Generated values match canonical values for all lists.
* Character counts remain 11 readings and 10 stories.

### Completion Evidence

* Focused tests pass and catalog-only vendoring changes only editorial generated metadata.

### Unresolved Items

* None.

<!-- rpi:task id=P01-T01 -->
### P01-T01: Add and test the taxonomy contract

#### Context

Research disproved reuse of `depth` and established three editorial states. `other` must be explicit
so an intentional exclusion cannot be confused with missing or invalid data.

#### Intent

Make the contract strict at authoring and conservative at runtime.

#### Boundaries

* Included: exactly three values; required on `character-run`; forbidden elsewhere; grouped readings
  must agree; runtime malformed value normalizes to null.
* Excluded: inference, silent manifest fallback, automatic grouping repair, and visible `other` choice.

#### Likely Targets

* `src/js/lib/catalog.js`
* `src/js/lib/curated.js`
* `scripts/vendor-orders.mjs`
* `test/curated.test.js`
* `test/catalog.test.js`
* `test/catalog-shelves.test.js`

#### Dependencies

* Research C8-C10.

#### Validation Expectations

* Unit fixtures prove valid and invalid field shapes, generated parity, filter behavior, group
  preservation, and unknown runtime values.

#### Completion Evidence

* Focused Node test selectors pass and a smallest-line revert makes the new semantic test fail.

#### Unresolved Items

* None.

<!-- rpi:task id=P01-T02 -->
### P01-T02: Classify every current record and rebuild generated data

#### Context

The selected assignments are five Best of, two complete guides, and four other readings. The two
X-Men readings share one story and both remain other.

#### Intent

Persist exact assignments without touching issue payloads or other editorial claims.

#### Boundaries

* Included: `spotlightKind` on 11 manifest entries, catalog-only generated rebuild, parity and count
  assertions.
* Excluded: issue fetches, live contract calls, changed `generatedAt`, card copy, source identity, and
  any non-character entry.

#### Likely Targets

* `src/data/curated-lists.json`
* `src/data/catalog.json`
* `test/catalog.test.js`
* `test/catalog-shelves.test.js`

#### Dependencies

* P01-T01.

#### Validation Expectations

* Manifest and generated category maps are identical.
* Counts are five, two, and four readings, with five, two, and three stories respectively.
* Total remains 11 readings and 10 stories.

#### Completion Evidence

* Catalog-only generation output and focused count assertions.

#### Unresolved Items

* None.

<!-- rpi:phase id=P02 -->
## P02: Add the shelf-local accessible filter

### Context

One generic renderer owns all three catalog shelves. A feature branch inside that renderer is safe only
when the data slice and state remain shelf-local. Existing radio pills already supply semantics, focus,
wrapping, and forced-color treatment.

### Intent

Expose the requested choices at the top of Character Spotlight without changing generic shelf
behavior.

### Boundaries

* Included: one header fieldset, spotlight-only selection state, exact labels, pre-search pre-group
  filtering, accurate messages and announcements, focused layout adjustment.
* Excluded: modifying Home, other shelf headers, generic facet options, route state, URL shape, card
  rendering, or custom keyboard handlers.

### Likely Targets

* `src/index.html`
* `src/styles.css`
* `src/js/main.js`
* `src/js/lib/catalog.js`
* `test/catalog.test.js`
* `test/catalog-shelves.test.js`

### Dependencies

* P01.

### Validation Expectations

* All three labels remain visible.
* Native radio behavior preserves focus after render.
* Exact cards and counts appear for each choice.
* Search and grouping remain composed.
* Other shelf state and output remain unchanged.

### Completion Evidence

* Focused unit tests plus Edge browser scenario at 1280x900 and 360x800.

### Unresolved Items

* None.

<!-- rpi:task id=P02-T01 -->
### P02-T01: Add native header controls and responsive styling

#### Context

The existing Character Spotlight header has only an `h1`; its generic fieldset is below search and
currently hidden. The header and filter styles already wrap.

#### Intent

Place a clearly named native radio group beside or below the heading according to available width.

#### Boundaries

* Included: fieldset, visible legend or equivalent explicit group label, three labels, existing `fp`
  selected and focus styles, minimal header-specific margin and alignment.
* Excluded: ARIA button emulation, roving tabindex, JavaScript key handling, new color tokens, fixed
  widths, and horizontal scrolling.

#### Likely Targets

* `src/index.html`
* `src/styles.css`

#### Dependencies

* P01.

#### Validation Expectations

* All starts checked.
* Tab reaches the group once and arrow keys move checked state natively.
* Focus ring and checked border remain visible.
* Forced-color styles continue to apply.
* At 360px controls wrap without clipping or overflow.

#### Completion Evidence

* DOM semantics and computed-layout browser measurements.

#### Unresolved Items

* None.

<!-- rpi:task id=P02-T02 -->
### P02-T02: Filter before search and grouping

#### Context

Filtering raw lists after the shelf slice and before grouping preserves search composition and keeps
both X-Men variants together. Rebuilding the radio group would drop focus, so state updates must mirror
the existing facet pattern.

#### Intent

Add the smallest spotlight-only state and filtering path.

#### Boundaries

* Included: `kind: all` in spotlight state, reusable pure filter helper, radio wiring, checked-state
  synchronization, subset label in no-match and count announcements, and resetting the subset to All
  when Character Spotlight is a path destination.
* Excluded: persisting the choice, resetting it on ordinary shelf switching, changing generic facet
  reset for other destinations, filtering other shelves, or flattening stories.

#### Likely Targets

* `src/js/lib/catalog.js`
* `src/js/main.js`
* `test/catalog.test.js`
* `test/catalog-shelves.test.js`

#### Dependencies

* P02-T01 and P01.

#### Validation Expectations

* Exact five Best of stories and two complete-guide stories.
* Other records appear only under All.
* X-Men remains grouped under All.
* Search narrows the selected subset.
* Returning to All restores 10 stories.
* Focus stays on the changed radio.
* A Modern Avengers path arrival from a non-All selection resets to All and reveals Essential
  Avengers.

#### Completion Evidence

* Pure-helper tests, shelf regression tests, and browser DOM assertions.

#### Unresolved Items

* None.

<!-- rpi:phase id=P03 -->
## P03: Prove, record, and independently review the feature

### Context

The feature changes data, interface, and maintenance contracts without changing stored progress. It is
a minor version change. The browser harness already owns Edge and external `puppeteer-core`.

### Intent

Produce meaningful failure proof, complete direct records, close every local gate, and run one Review.

### Boundaries

* Included: existing test files, one browser scenario and mutation proof, direct docs, minor version,
  anchors, dash and diff scans, local release gates, one Review artifact and routing.
* Excluded: adding Puppeteer as a dependency, live metadata contract without API assumption changes,
  a second Review, unrelated cleanup, or a release tag.

### Likely Targets

* `scripts/browser-check.mjs`
* `docs/MAINTAINING.md`
* `docs/DATA_PROVENANCE.md`
* `PRODUCT_BACKLOG.md`
* `CHANGELOG.md`
* `package.json`
* `package-lock.json`
* `src/js/lib/version.js`
* `.anchors.json`
* `.copilot-tracking/changes/2026-08-23/character-spotlight-filter-changes.md`
* `.copilot-tracking/reviews/logs/2026-08-23/character-spotlight-filter-review.md`

### Dependencies

* P02.

### Validation Expectations

* New semantic and browser checks fail with the smallest implementation revert and pass restored.
* Exact local gate counts are recorded.
* Anchor targets are derived once from prior head search and once from diff-hunk arithmetic, the
  derivations are reconciled, one fresh mapping is applied once, citation shape and corpus count are
  checked, every claim-to-line pairing is read, the lock is blessed, and the final run reports zero
  drift, additions, and removals.
* Added diff lines contain no long dash.
* Review runs once and leaves no unresolved material in-scope finding.

### Completion Evidence

* Changes record with commands, counts, mutation failures, browser measurements, anchor pairings,
  Review outcome, and routing.

### Unresolved Items

* None.

<!-- rpi:task id=P03-T01 -->
### P03-T01: Add proof, records, version, and release validation

#### Context

The user requires both unit and real-browser evidence. The repository's feature-version rule requires
1.4.0 while the storage schema remains unchanged.

#### Intent

Finish all directly related implementation evidence before Review.

#### Boundaries

* Included: focused and full tests, `browser:prove`, production browser run, direct docs, version sync,
  counts, sizes, palette, lint, anchors, publication, publication surface, dash and diff scans.
* Excluded: live contract unless metadata API assumptions changed, unrelated docs, release creation.

#### Likely Targets

* Existing test and browser files
* Direct docs and version files listed in P03
* Anchor lock and changes artifact

#### Dependencies

* P02.

#### Validation Expectations

* Browser covers All, both subsets, return, keyboard, focus, selected state, grouping, path arrival,
  1280x900, active forced colors with a checked radio and observable Highlight border, restored
  normal media state, and 360x800.
* All direct counts are re-derived.
* Every local gate exits zero after anchors close.

#### Completion Evidence

* Exact commands, output counts, mutation names, browser measurements, forced-color activation and
  restoration evidence, and derive-twice apply-once anchor evidence in the changes record.

#### Unresolved Items

* None.

<!-- rpi:task id=P03-T02 -->
### P03-T02: Run the single independent Review and route outcomes

#### Context

Review begins only after P03-T01 produces a complete final diff. It is independent and may run once.

#### Intent

Catch material functional, accessibility, data-contract, or release defects without looping.

#### Boundaries

* Included: one full-diff Review, direct fixes for material in-scope findings, follow-up routing for
  unrelated findings, revalidation of any fix.
* Excluded: second Review, style-only churn, record-only follow-up changes, or claiming Conformant with
  a material finding open.

#### Likely Targets

* Final branch diff
* `.copilot-tracking/reviews/logs/2026-08-23/character-spotlight-filter-review.md`
* `.copilot-tracking/changes/2026-08-23/character-spotlight-filter-changes.md`

#### Dependencies

* P03-T01.

#### Validation Expectations

* Review run count equals one.
* Every finding has a disposition.
* Any in-scope fix receives the relevant targeted and full validation without another Review.

#### Completion Evidence

* Complete Review artifact and state record.

#### Unresolved Items

* None.

<!-- rpi:phase id=P04 -->
## P04: Deliver through PR, CI, and merge

### Context

Local evidence and Review are prerequisites, not completion. The task ends only after the hosted matrix
and lint jobs pass, any base drift is reconciled, and the PR merges.

### Intent

Carry the reviewed implementation through publication and persist the merged result.

### Boundaries

* Included: scoped commit, PR body, hosted job inspection, reconciliation if needed, merge, durable
  PR and merge evidence.
* Excluded: release tag, GitHub release, widening the PR, dismissing canceled jobs as pass without
  checking cause, or merging with a failed required job.

### Likely Targets

* Git history and GitHub PR
* `.copilot-tracking/rpi-sessions/2026-08-23/character-spotlight-filter-state.json`
* `.copilot-tracking/changes/2026-08-23/character-spotlight-filter-changes.md`

### Dependencies

* P03 complete and Review dispositioned.

### Validation Expectations

* PR body starts with `## In plain English` and contains exact verification counts.
* Commit has the required co-author trailer.
* Hosted `test (20)`, `test (24)`, and `lint` jobs pass by job conclusion.
* Reconciliation, if any, is followed by complete local and hosted validation.
* Merge commit and final PR state are persisted.

### Completion Evidence

* PR URL and number, workflow run and job conclusions, reconciliation record or not-needed evidence,
  merge commit, and merged timestamp.

### Unresolved Items

* None.

<!-- rpi:task id=P04-T01 -->
### P04-T01: Commit and open the pull request

#### Context

The reviewed diff must be committed without hiding command output or using unsafe PowerShell quoting.

#### Intent

Create a reviewable commit and PR with user-facing and technical evidence.

#### Boundaries

* Included: file-backed commit message with trailer, push, PR against `main`, plain-English lead,
  summary, verification counts, Review and risk notes.
* Excluded: force push after PR review unless reconciliation requires it and is recorded, unrelated
  commits, or a technical-only PR body.

#### Likely Targets

* Git commit and GitHub PR

#### Dependencies

* P03.

#### Validation Expectations

* Branch contains only scoped commits.
* PR body meets repository format and accurately reports behavior and tests.

#### Completion Evidence

* Pre-implementation evidence commit:
  `57acfba8fbbeecfc866c49118d970ed8c8cb5b3a`.
* Reviewed feature commit: `0198f8e12a7c32c8a24edbc1333dae0e8ff8cc00`.
* PR #173: https://github.com/raymond-nassar/recap-page/pull/173.
* The PR targets `main`, opens with the required plain-English section, records exact verification
  counts and the single Review disposition, and both commits carry the required co-author trailer.

#### Unresolved Items

* None.

<!-- rpi:task id=P04-T02 -->
### P04-T02: Monitor CI, reconcile, merge, and persist

#### Context

Run-level failure can represent canceled jobs, so job conclusions and logs decide the result.

#### Intent

Reach a clean merge against current `main` and leave a durable complete lifecycle state.

#### Boundaries

* Included: inspect job conclusions, inspect timeout or failure logs when needed, update from `main`
  if required, rerun complete validation, merge through GitHub, persist final result.
* Excluded: treating cancellation as pass without supersede evidence, broad destructive git commands,
  or merging around a real failure.

#### Likely Targets

* GitHub Actions run and PR
* State and changes artifacts

#### Dependencies

* P04-T01.

#### Validation Expectations

* Three required jobs pass.
* PR is current or reconciled and revalidated.
* PR merges and final state records merged commit and completed lifecycle.

#### Completion Evidence

* Hosted run evidence and merge commit in durable artifacts.

#### Unresolved Items

* None.
