<!-- markdownlint-disable-file -->
# RPI Plan: Character Spotlight filter

## Task Metadata

* Task ID: MRT-002-C04
* Task slug: character-spotlight-filter
* Planning status: Implementation ready after one critique
* Plan date: 2026-08-23
* Mode: automatic
* Phase details: .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-23/character-spotlight-filter-plan-critique.md

## Executive Summary

This plan adds a clear, always-visible filter to the Character Spotlight header. Readers will be able
to choose All, Best of, or Complete guides without changing any other shelf. All remains the default
and keeps every current card visible.

The filter will use an explicit three-value editorial taxonomy rather than guessing from issue count,
reading depth, title, or source URL. Five current readings are Best of, two are complete guides, and
four are intentionally other. The grouped X-Men pair, the Doom primer, and Essential Avengers remain
under All rather than receiving a misleading label.

### User Decisions and Requirements Highlights

* Preserve all existing cards, search, navigation, and grouping while filtering only Character
  Spotlight.
* Use native controls with a selected state, full keyboard operation, clear focus, forced-color
  behavior, and a narrow layout that does not overflow.
* Run one critique, one independent Review, PR, hosted Node 20, Node 24, and lint jobs, reconciliation
  if needed, and merge.

### What You May Not Know

* The current generic category filters are hidden on shelves with 12 or fewer stories. Character
  Spotlight has 10 stories, so the new filter must be a separate always-visible header control.
* Phoenix is a Best of reading even though its existing depth is `complete`. The grouped X-Men
  complete variant is not a complete character guide. Those records disprove reuse of `depth`.

### Unresolved Decisions or Blockers

* None.

For current user input, see [User Decisions and Requirements](#user-decisions-and-requirements).

## User Decisions and Requirements

* Implement MRT-002-C04 from current default `main` after merged PR #172, using task slug
  `character-spotlight-filter`.
* Put visible All, Best of, and Complete guides choices in the Character Spotlight header; select All
  by default.
* Filter only Character Spotlight and preserve existing search, navigation, card grouping, and all
  current cards.
* Use accessible native controls with explicit selected state, full keyboard operation, clear focus,
  high-contrast behavior, and no narrow-viewport layout break.
* Do not infer Best of or Complete guides from row count or vague prose. Use explicit validated
  taxonomy on Character Spotlight manifest records.
* Keep the grouped X-Men variants, Doom primer, and Essential Avengers under All when they do not
  accurately fit either requested subset.
* Do not replace or merge existing Best of cards.
* Update directly related schema validation, generated data, counts, maintenance and provenance
  documentation, backlog, changelog, tests, and evidence anchors.
* Use the repository's external Edge and `puppeteer-core` pattern to verify default All, Best of,
  Complete guides, return to All, keyboard and focus semantics, and a narrow viewport.
* Prove new tests fail without the behavior. Run lint, full tests, counts, anchors with careful
  re-aim and bless, dash scan, diff review, publication checks, and the live contract only if
  relevant.
* Run exactly one plan critique and exactly one independent post-implementation Review. Route
  unrelated work rather than widening scope.
* Open a PR with `## In plain English`, verification counts, and the co-author trailer; monitor hosted
  Node 20, Node 24, and lint jobs by job conclusion; reconcile `main` if needed; merge; persist the
  merged result.

## Goals

* Let readers distinguish curated Best of readings from complete character guides at a glance.
* Make the distinction explicit and maintainable in catalog data without misclassifying current
  edge cases.
* Preserve every existing catalog, grouping, search, navigation, storage, and reader behavior outside
  the new shelf-local filter.
* Deliver the feature through complete local, browser, review, PR, CI, and merge evidence.

## Scope and Non-Goals

### In Scope

* A required `spotlightKind` taxonomy with values `best-of`, `complete-guide`, and `other` on every
  `character-run` manifest record.
* Manifest validation, grouped-record consistency, catalog generation, generated catalog data, and
  runtime normalization for the taxonomy.
* Exact classification of all 11 current character readings across 10 stories.
* A native radio group in the Character Spotlight header with visible All, Best of, and Complete
  guides choices.
* Shelf-local filter state and filtering before existing search and grouping.
* Existing CSS reuse plus only the responsive alignment needed for the header.
* Existing unit and browser test files, fail-without-fix proof, maintenance and provenance docs,
  backlog, changelog, minor version update, anchors, gates, Review, PR, CI, reconciliation, and merge.

### Non-Goals

* Filtering Timeline, Storylines, Home, library views, or stored reading progress.
* Replacing, merging, shortening, renaming, or reordering any current Character Spotlight card.
* Treating `other` as a visible fourth choice.
* Inferring taxonomy from `depth`, count, title, description, filename, keywords, or source URL.
* Changing generic category facets, search thresholds, routes, card grouping, popup behavior,
  availability, storage schema, origin, runtime dependencies, or build architecture.
* Adding another reading guide or fixing unrelated documentation or code.
* A second critique or a second independent Review.

## Functional Requirements

* Every manifest record with `type: character-run` declares one valid `spotlightKind`, and no other
  type may declare it.
  * Observable acceptance criteria: missing, unknown, mistyped, or misplaced values fail manifest
    validation; grouped readings with different values fail; valid values survive parsing.
* Vendoring carries the taxonomy into `catalog.json`, and runtime parsing retains only known values.
  * Observable acceptance criteria: all 11 generated character entries match the manifest, malformed
    runtime values normalize to null rather than widening a subset.
* Current records receive evidence-backed assignments.
  * Observable acceptance criteria: Best of contains Phoenix, Captain America, Spider-Man, Thor, and
    Scarlet Witch; Complete guides contains White Tiger and Phalanx; X-Men's two variants, Doom, and
    Essential Avengers are `other`.
* Character Spotlight displays an always-visible native radio group in its header.
  * Observable acceptance criteria: visible labels are exactly All, Best of, and Complete guides;
    All is initially checked; the group has an explicit accessible name; native Tab and arrow-key
    behavior works; focus remains on the selected control after rendering.
* Selection filters only Character Spotlight before existing search and grouping.
  * Observable acceptance criteria: All shows 11 readings across 10 stories; Best of shows five
    readings across five stories; Complete guides shows two readings across two stories; returning
    to All restores every card; X-Men remains one grouped story; search composes with the selected
    subset; other shelves and routes are unchanged.
* Empty and announcement copy accurately reflects the selected subset and current search.
  * Observable acceptance criteria: counts and no-match messages use Best of or Complete guides
    labels without claiming other cards belong to either.

## Non-Functional Requirements

* Accessibility uses native semantics and existing visual state tokens.
  * Objective threshold or evaluation condition: radio checked state, native keyboard movement,
    three-pixel focus ring, and forced-color checked border remain observable.
  * Observable acceptance criteria: Edge browser checks confirm selection, focus, keyboard operation,
    and forced-color-compatible styles without custom keyboard handlers.
* Narrow layout remains usable.
  * Objective threshold or evaluation condition: at 360x800 the header controls wrap, every label is
    visible, and document scroll width does not exceed viewport width.
  * Observable acceptance criteria: Edge measurement records no horizontal overflow and no clipped
    control.
* Existing behavior remains stable.
  * Objective threshold or evaluation condition: no storage, route, reader, availability, popup, or
    runtime dependency change.
  * Observable acceptance criteria: full tests and lint pass, generic shelf regressions stay green,
    and the package has zero runtime dependencies.
* Tests are meaningful.
  * Objective threshold or evaluation condition: at least one focused unit test and the browser
    scenario are observed failing with the implementation removed, then passing with it restored.
  * Observable acceptance criteria: fail-without-fix commands and exact failures are recorded in the
    changes artifact.
* Release evidence is complete and honest.
  * Objective threshold or evaluation condition: local gates, anchors, dash scan, publication checks,
    one Review, PR, three hosted jobs, and merge all have durable outcomes.
  * Observable acceptance criteria: no completion claim is made while any material finding or hosted
    job is unresolved.

## Acceptance Criteria

* The canonical manifest contains 11 valid `character-run` taxonomy values: five `best-of`, two
  `complete-guide`, and four `other`; its 10 story groups remain unchanged.
* Generated catalog entries preserve the same taxonomy and all prior counts, files, groups, ordering,
  descriptions, and source links.
* All is checked on first opening Character Spotlight and shows all 10 cards.
* Best of shows only Phoenix, Captain America, Spider-Man, Thor, and Scarlet Witch.
* Complete guides shows only White Tiger and Phalanx.
* Returning to All restores grouped X-Men, Doom, Essential Avengers, and every subset card.
* Search and the generic catalog facets still operate within their existing shelf-local contracts.
  A path arrival on Character Spotlight also resets the new subset to All, so the linked story cannot
  remain hidden; ordinary shelf switching preserves the reader's subset choice.
* Native keyboard selection keeps focus in the radio group, the selected state is visually and
  programmatically explicit, forced colors retain a checked border, and 360x800 has no overflow.
* No current card is replaced, merged, hidden from All, renamed, shortened, or reclassified by
  inference.
* `docs/MAINTAINING.md`, `docs/DATA_PROVENANCE.md`, `PRODUCT_BACKLOG.md`, and `CHANGELOG.md` state the
  new contract and re-derived counts; package and browser version move from 1.3.0 to 1.4.0 without
  changing the storage schema.
* Focused tests are observed failing without the behavior and passing with it restored.
* Targeted tests, `npm run lint`, `npm test`, `npm run counts`, `npm run sizes`,
  `npm run palette`, `npm run anchors`, `npm run publication`, `npm run publication:surface`, and
  Edge browser proof pass. The live metadata contract runs only if implementation touches its API
  assumptions.
* Every anchor target is derived independently from prior head text and diff-hunk arithmetic, both
  derivations are reconciled, one fresh mapping is applied once, citation shape and corpus count are
  checked, every claim-to-line pairing is read, the lock is blessed, and a final run reports zero
  drift, additions, and removals.
* Added diff lines contain no em dash or en dash, and the final diff contains only this feature.
* Exactly one independent Review runs after implementation; material findings are fixed before
  release or routed without a second Review.
* A PR opens with the required plain-English lead, verification counts, and co-author trailer;
  hosted `test (20)`, `test (24)`, and `lint` jobs pass by job conclusion; any main reconciliation is
  followed by full revalidation; the PR merges and merged state is persisted.

## Initial Planning Readiness

* Evidence status: Research complete and Ready after one focused three-wave cycle.
* Selected scope: explicit taxonomy, one shelf-local header filter, direct schema and documentation
  surfaces, existing tests and browser harness, complete release path.
* Active boundaries: one feature, no card replacement, no inference, one critique, one Review.
* Planning gap: none demonstrated.
* Current blocker: none.

## Locked Test and Change Boundary

* Exact production removals: none.
* Maximum new production files: zero.
* Maximum new test files: zero.
* Canonical data target: `src/data/curated-lists.json`.
* Generated data target: `src/data/catalog.json`, rebuilt only with `npm run vendor -- --catalog-only`.
* Schema owners: `src/js/lib/curated.js`, `scripts/vendor-orders.mjs`, and
  `src/js/lib/catalog.js`.
* Semantic test owners: `test/curated.test.js` and `test/catalog.test.js`.
* Shelf and grouping regression owner: `test/catalog-shelves.test.js`.
* Browser semantic and responsive owner: `scripts/browser-check.mjs`; its focused scenario activates
  forced colors, proves the selected radio remains checked with an observable system Highlight border,
  restores normal media state, and then completes the remaining scenarios.
* Version owner: `package.json`, `package-lock.json`, and `src/js/lib/version.js`, updated through
  `npm version minor --no-git-tag-version`.
* Documentation owners: `docs/MAINTAINING.md`, `docs/DATA_PROVENANCE.md`, `PRODUCT_BACKLOG.md`, and
  `CHANGELOG.md`.
* Browser additions: one focused scenario and its mutation proof in the existing harness.

## Implementation Context Record

| Context item | Current artifact or record |
|---|---|
| Plan | .copilot-tracking/plans/2026-08-23/character-spotlight-filter-plan.md |
| Phase details | .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md |
| Latest critique | .copilot-tracking/reviews/plans/2026-08-23/character-spotlight-filter-plan-critique.md complete; Revise resolved through PC-001 to PC-004 |
| Relevant research | .copilot-tracking/research/2026-08-23/character-spotlight-filter-research.md |
| Changes-record role | .copilot-tracking/changes/2026-08-23/character-spotlight-filter-changes.md is created by implementation as its evidence record |
| Planning execution and readiness | Complete; all four critique findings resolved and implementation ready |
| Continuation context | Automatic RPI coordinator continues to implementation |

## Sources

* .copilot-tracking/research/2026-08-23/character-spotlight-filter-research.md: controlling
  architecture, classification, accessibility, responsive, test, and Planning Readiness evidence.
* .copilot-tracking/rpi-sessions/2026-08-23/character-spotlight-filter-state.json: exact caller
  direction, lifecycle limits, selected taxonomy, and re-derived counts.
* src/data/curated-lists.json: canonical editorial data.
* src/js/lib/curated.js: manifest validation contract.
* scripts/vendor-orders.mjs: generated catalog contract.
* src/js/lib/catalog.js and src/js/main.js: runtime normalization, shelf placement, search, grouping,
  filtering, and rendering contracts.
* src/index.html and src/styles.css: header structure, native filter styles, focus, wrapping, and
  forced-color behavior.

## Phase Checklist

<!-- rpi:phase id=P01 -->
### [x] P01: Establish the explicit taxonomy

* Intent: Make every Character Spotlight subset assignment explicit, validated, generated, and
  parseable before UI behavior depends on it.
* Dependencies: Completed Research and dispositioned single final plan critique.
* Implementation status: Complete.

<!-- rpi:task id=P01-T01 -->
#### [x] P01-T01: Add and test the taxonomy contract

* Requirement and evidence: Research C8-C10 proves the manifest, vendor, and runtime parser each
  explicitly own fields.
* Expected result: `spotlightKind` validates for character runs only, grouped values agree, vendoring
  copies it, runtime parsing accepts only the three known values, and semantic tests cover failures.
* Detail section: P01-T01 in .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md
* Implementation status: Complete.

<!-- rpi:task id=P01-T02 -->
#### [x] P01-T02: Classify every current record and rebuild generated data

* Requirement and evidence: Research C11-C18 classifies all 11 readings without inference.
* Expected result: five Best of, two complete-guide, and four other values appear in both canonical
  and generated data while 11 readings and 10 stories remain stable.
* Detail section: P01-T02 in .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md

<!-- rpi:phase id=P02 -->
### [x] P02: Add the shelf-local accessible filter

* Intent: Put the three native choices in the Character Spotlight header and compose them with the
  existing shelf renderer without changing other screens.
* Dependencies: P01.
* Implementation status: Complete.

<!-- rpi:task id=P02-T01 -->
#### [x] P02-T01: Add native header controls and responsive styling

* Requirement and evidence: Research C4-C7 and C19 show the required header location and reusable
  radio, focus, wrap, and forced-color patterns.
* Expected result: an always-visible fieldset exposes All, Best of, and Complete guides, defaults to
  All, and remains usable from 360px upward.
* Detail section: P02-T01 in .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md
* Implementation status: Complete.

<!-- rpi:task id=P02-T02 -->
#### [x] P02-T02: Filter before search and grouping

* Requirement and evidence: Research C1-C3 and C14 require shelf isolation and grouped X-Men
  preservation.
* Expected result: exact subset cards, return to All, search composition, accurate announcements,
  stable focus, unchanged generic facet and grouping behavior, and path-arrival reset to All so
  Essential Avengers is revealed when the Modern Avengers path targets it.
* Detail section: P02-T02 in .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md

<!-- rpi:phase id=P03 -->
### [ ] P03: Prove, record, and independently review the feature

* Intent: Demonstrate the behavior in tests and Edge, update direct records, close anchors, and run
  exactly one independent Review on the final implementation.
* Dependencies: P02.
* Implementation status: In progress.

<!-- rpi:task id=P03-T01 -->
#### [ ] P03-T01: Add proof, records, version, and release validation

* Requirement and evidence: The caller requires fail-without-fix proof, Edge coverage, counts,
  documentation, anchors, diff and dash checks, and publication checks.
* Expected result: focused and full gates pass with exact counts; browser proof covers all requested
  states at 1280x900 and 360x800, including active forced colors and restoration; direct docs and
  version 1.4.0 are current; live contract is skipped unless API assumptions changed; anchors use
  derive twice and apply once.
* Detail section: P03-T01 in .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md
* Implementation status: In progress.

<!-- rpi:task id=P03-T02 -->
#### [ ] P03-T02: Run the single independent Review and route outcomes

* Requirement and evidence: The lifecycle permits one Review only.
* Expected result: one review artifact covers the final diff; every material in-scope finding is fixed
  before release without rerunning Review; unrelated work is routed to the backlog.
* Detail section: P03-T02 in .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md

<!-- rpi:phase id=P04 -->
### [ ] P04: Deliver through PR, hosted CI, and merge

* Intent: Publish the reviewed change, read hosted job conclusions honestly, reconcile if required,
  merge, and persist the final result.
* Dependencies: P03.

<!-- rpi:task id=P04-T01 -->
#### [ ] P04-T01: Commit and open the pull request

* Requirement and evidence: The caller requires the co-author trailer, plain-English PR lead, and
  verification counts.
* Expected result: scoped commits and a PR against current `main` describe exact behavior and evidence.
* Detail section: P04-T01 in .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md

<!-- rpi:task id=P04-T02 -->
#### [ ] P04-T02: Monitor CI, reconcile, merge, and persist

* Requirement and evidence: Hosted `test (20)`, `test (24)`, and `lint` are required completion gates.
* Expected result: all three jobs pass by job conclusion; any main reconciliation is fully revalidated;
  the PR merges; state and changes records carry PR number, merge commit, and final outcomes.
* Detail section: P04-T02 in .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md

## Dependencies

* Merged PR #172 baseline: current Character Spotlight records and counts must remain the starting point.
* External installed Edge and scratch `puppeteer-core`: required for browser evidence and must not enter
  repository dependencies.
* GitHub Actions availability: required for three hosted jobs and merge.
* Current `main` at delivery: reconcile only if the PR becomes behind or conflicted.

## Critique Disposition

| Critique run and finding | Disposition | Plan response or residual risk |
|---|---|---|
| PC-001 | resolved | P02-T02 now resets the spotlight subset to All only for path-destination narrowing and requires a regression proving Essential Avengers is revealed. |
| PC-002 | resolved | P03 now derives anchor targets from head search and hunk arithmetic, reconciles them, applies one mapping once, validates citation shape and count, reads every pairing, blesses, and reruns clean. |
| PC-003 | resolved | The locked browser scope now activates forced colors, observes the checked radio and Highlight border, and restores normal media state. |
| PC-004 | resolved | Taxonomy and count parity remain in `test/curated.test.js` and `test/catalog.test.js`; shelf, grouping, and navigation regressions remain in `test/catalog-shelves.test.js`. |

## Follow-Up Items

* None.

## Handoff

* Implementation artifact: .copilot-tracking/changes/2026-08-23/character-spotlight-filter-changes.md
* Ready phase or task: P01
* Remaining provisional question or blocker: None
