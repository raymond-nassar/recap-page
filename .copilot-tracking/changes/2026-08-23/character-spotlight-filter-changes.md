<!-- markdownlint-disable-file -->
# RPI Changes: Character Spotlight filter

## Metadata

* Task ID: MRT-002-C04
* Related plan: .copilot-tracking/plans/2026-08-23/character-spotlight-filter-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md
* Implementation date: 2026-08-23

## Execution Status

* Status: In progress
* Declared invocation scope: full plan
* Completed scope markers: P01, P01-T01, P01-T02, P02, P02-T01, P02-T02, P03, P03-T01, P03-T02
* All remaining active-plan markers: P04, P04-T01, P04-T02
* Status basis: The single independent Review is complete and RV-001 is resolved. P04-T01 is active.

## Execution Summary

The feature, all validation, and the one routed Review finding are complete. Delivery through P04 is
active without another Review.

## Completed Work

### Establish the explicit taxonomy

* Related phase or task: P01, P01-T01, P01-T02
* Files changed: `src/js/lib/catalog.js`, `src/js/lib/curated.js`,
  `scripts/vendor-orders.mjs`, `scripts/author-cbh-packet.mjs`,
  `src/data/curated-lists.json`, `src/data/catalog.json`, `test/curated.test.js`,
  `test/catalog.test.js`, `test/catalog-shelves.test.js`
* Outcome: Character runs require exactly `best-of`, `complete-guide`, or `other`; other types
  forbid the field; grouped records must agree; runtime parsing rejects unknown values; and
  catalog-only vendoring preserves the value.
* Classification evidence: 11 readings across 10 stories; five Best of readings and stories; two
  complete-guide readings and stories; four other readings across three stories. Both grouped
  X-Men readings remain together under other.

### Add the shelf-local accessible filter

* Related phase or task: P02, P02-T01, P02-T02
* Files changed: `src/index.html`, `src/styles.css`, `src/js/main.js`,
  `src/js/lib/catalog.js`, `test/catalog.test.js`, `test/catalog-shelves.test.js`,
  `scripts/browser-check.mjs`
* Outcome: The Character Spotlight header always exposes native All, Best of, and Complete guides
  radios. Selection runs after shelf slicing and before generic facets, search, and grouping.
  Ordinary navigation preserves selection, while a path arrival resets every narrowing control so
  Essential Avengers is visible.

### Close the generated-schema gap from the single Review

* Related phase or task: RV-001 against P01-T01 and P01-T02
* Files changed: `src/js/lib/curated.js`, `scripts/vendor-orders.mjs`,
  `src/data/catalog.json`, `test/curated.test.js`
* Outcome: Normalized and generated non-character entries now omit `spotlightKind`; all 11 character
  entries retain exact values. The tightened assertions failed twice before the fix and passed after
  catalog-only regeneration.

## Active Work

### Deliver through PR, CI, and merge

* Related phase or task: P04-T01
* Intended files: Git history, PR, lifecycle state, and changes evidence.
* Intended outcome: Commit the reviewed and corrected feature, open the required PR, and start hosted
  validation.

## Implementation-Time Plan and Detail Updates

### Single critique corrections

* Affected plan area or markers: P02-T02, P03-T01, locked browser and test boundaries.
* What changed: Path arrivals reset the spotlight subset to All; anchor work derives twice and
  applies once; forced colors are observed in Edge; taxonomy and shelf tests remain in locked owners.
* Why: PC-001 through PC-004 identified concrete navigation, anchor, accessibility-proof, and test
  ownership gaps.
* Triggering evidence: The single critique artifact.
* User answer or decision: None required; all corrections preserve explicit caller requirements.
* Reconciliation performed: Plan, phase details, lifecycle state, and implementation handoff agree.
* Planning and critique state: Implementation ready; one critique run, Revise resolved.

### Single Review route

* Affected plan area or markers: P01-T01, P01-T02, P03-T02.
* What changed: Exactly one independent Review ran and routed RV-001 to implementation.
* Why: Normalized non-character entries used `spotlightKind: null`, and unconditional catalog
  generation copied that property into 78 generated records even though the accepted contract
  forbids the field outside character runs.
* Triggering evidence: .copilot-tracking/reviews/logs/2026-08-23/character-spotlight-filter-review.md
* User answer or decision: None required; omitting the field is the already approved contract.
* Reconciliation performed: Review outcome, active implementation item, P04 blocker, and validation
  boundary are current.
* Planning and critique state: No replanning or second critique; the single Review is complete.

## Validation Record

| Check | Scope | Status | Evidence or reason |
|---|---|---|---|
| Planning gate | MRT-002-C04 | Passed | One critique ran; PC-001 through PC-004 are resolved. |
| Focused Node tests | P01 | Passed | 128 passed, 0 failed across the three locked semantic owners. |
| Catalog-only vendor | P01-T02 | Passed | Rebuilt generated editorial metadata without issue fetches. |
| Mutation proof | P01-T01 | Passed | Removing the runtime normalization line failed the focused taxonomy test with four missing values; restoration passed. |
| Focused Edge scenario | P02 | Passed | 13 assertions, 0 failed in installed Edge at 1280x900, forced colors, and 360x800. |
| Edge mutation proof | P02 | Passed | Bypassing spotlight subset filtering produced five named failures; restoration passed all 13 focused assertions. |
| Frozen evidence guard | P03-T01 | Passed | The new digest test failed before `spotlightKind` was excluded from issue-library evidence, then all five character evidence tests passed without rewriting frozen reports. |
| Focused ESLint | P01-P02 | Passed | Changed JavaScript reports zero findings after declared dev dependencies were restored. |
| Full Node tests | P03-T01 | Passed | 1,397 passed, 0 failed. |
| Full Edge browser run | P03-T01 | Passed | 158 assertions passed across 17 scenarios in installed Edge. |
| Lint and derived gates | P03-T01 | Passed | ESLint reported zero findings; counts reported 178 ranked rows and 183 detail blocks; seven size claims agreed; palette measured 88 pairs with five recorded exceptions and zero new. |
| Publication gates | P03-T01 | Passed | History scan covered 3,076 blobs and 387 commit messages; publication surface covered six branches, 3,108 blobs, and 391 commit messages; both reported zero findings. |
| Evidence anchors | P03-T01 | Passed | Head search and hunk arithmetic found zero disagreements. One mapping applied 330 replacements once. All 370 changed pairings and 25 collision notices were read; the final run reported 1,135 unchanged, 0 drifted, 0 new, and 0 removed across 32 documents. |
| Diff hygiene | P03-T01 | Passed | Added lines contained zero en or em dashes and zero malformed backticked citations; `git diff --check` passed. |
| Live metadata contract | P03-T01 | Skipped | No metadata API assumption changed. |
| Independent Review | P03-T02 | Complete, defects found | Exactly one read-only complete-diff Review found RV-001 at Medium severity and routed it to implementation. |
| RV-001 fail-before-fix proof | RV-001 | Passed | Two tightened assertions failed before the fix because normalized and generated non-character entries owned the forbidden property. |
| RV-001 focused tests | RV-001 | Passed | Catalog-only generation completed without issue fetches; 133 taxonomy, catalog, shelf, and frozen-evidence tests passed. |
| Post-Review full validation | RV-001 | Passed | 1,397 Node tests, 158 Edge assertions across 17 scenarios, lint, counts, sizes, palette, anchors, publication, and publication surface all passed. |

## Pre-Review Reconciliation

* Plan markers and phase details: P01 through P03 are complete; RV-001 is resolved; P04-T01 is active.
* Completed-work evidence and handoff prose: Current.
* Validation, blockers, remaining work, and follow-up items: All post-Review validation is complete;
  no blocker or unrelated follow-up exists.
* Review readiness: The single Review is complete and must not run again.

## Blockers

* None.

## Pull request delivery

* P04-T01 is complete.
* The pre-implementation evidence commit is
  `57acfba8fbbeecfc866c49118d970ed8c8cb5b3a`.
* The reviewed feature commit is `0198f8e12a7c32c8a24edbc1333dae0e8ff8cc00`.
* PR #173 is open against `main` at
  https://github.com/raymond-nassar/recap-page/pull/173.
* The PR opens with `## In plain English`, reports the exact local verification counts, records the
  single Review and RV-001 resolution, and both commits carry the required co-author trailer.

## Remaining Work

* P04-T02: hosted CI, merge, and merged-result persistence.

## Follow-Up Items

* Canonical plan list: .copilot-tracking/plans/2026-08-23/character-spotlight-filter-plan.md,
  `## Follow-Up Items`
* None.

## Return-to-Caller State

* Implementation execution status: In progress
* Declared scope and markers: Full plan; P01-P03 and P04-T01 complete, RV-001 resolved, P04-T02
  active.
* Validation coverage: Catalog-only rebuild, 133 focused tests, three fail-before-fix proofs,
  1,397 full tests, 13 focused and 158 full Edge assertions, all local gates, anchors, and diff scans.
* Blockers: None.
* Current plan and detail updates: Critique corrections reconciled.
* Planning and critique state: Ready; exactly one critique completed.
* Follow-up items: None.
* Review readiness or no-handoff reason: Review and its routed finding are complete; no second Review
  is permitted or required.
* Continuation owner: Confirmed automatic RPI Agent.
