<!-- markdownlint-disable-file -->
# RPI Changes: Repeated source occurrences and Iron Man

## Metadata

* Task ID: MRT-002-C09-DUP
* Related plan: .copilot-tracking/plans/2026-08-23/repeated-source-occurrences-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md
* Research: .copilot-tracking/research/2026-08-23/repeated-source-occurrences-research.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-23/repeated-source-occurrences-plan-critique.md
* Implementation date: 2026-08-23

## Execution Status

* Status: Partial
* Declared invocation scope: full plan
* Completed scope markers: P01, P01-T01, P01-T02, P01-T03, P02, P02-T01, P03,
  P03-T01, P03-T02
* Active marker: P04-T01
* All remaining active-plan markers: P04, P04-T01, P04-T02,
  P04-T03
* Status basis: The shared contract, both provider paths, strict failure matrix, exact candidate
  shapes, Groot migration, and Iron Man blocker preservation are complete. Direct release records
  are the next dependency-ready task.

## Execution Summary

P01 added the additive occurrence contract, provider propagation, approval-time derivation checks,
conditional provenance, strict mutation coverage, and Groot's 84/76 migration. P02 closed the
conditional Iron Man publication path after confirming nine unavailable source-required issues and
kept every Iron Man product artifact absent. P03 now aligns direct records and validates the shared
release.

## Approved Implementation Boundary

* Shared code: packet validation and digest ownership, CBH and CBRO preparation, CBRO inventory
  compatibility, CBH and CBRO approval and Markdown authoring.
* Existing Groot evidence: packet, mapping, overlap report, approval, and order Markdown only.
* Iron Man blocker after P01: inventory reason, exact absence checks, and durable evidence only.
* Tests: existing shared, character, historical-provider, resolver, overlap, and catalog owners; no
  new test file.
* Explicit exclusions: Old Man Logan and Planet Hulk product files, parsers, inferred issues,
  heuristic metadata, exceptions, runtime dependencies, unrelated cleanup, second critique, and
  second Review.

## Validation Intent

* P01: focused mutation matrix, current-packet compatibility scan, Groot before/after selected-id
  equality, and both provider approval/authoring tamper rejection.
* P02: exact configured-metadata gaps, inventory blocker, and complete absence of candidate artifacts.
* P03: targeted and full tests, lint, counts, anchors through read-before-bless, publication,
  release, live contract, dash and diff scans, and installed Edge at 1280x900 and 390x844.
* P04: current-main reconciliation and affected gates before one independent Review, final no-drift
  fetch, PR, Node 20/24/lint CI, merge, post-merge PR comment, and parent completion record.

## Completed Work

### Added one shared repeated-source-occurrence contract

* Related phase or task: P01-T01 and P01-T02.
* Files: `scripts/lib/cbh-inventory.mjs`, `scripts/prepare-cbh-batch.mjs`,
  `scripts/prepare-cbro-event.mjs`, `scripts/lib/cbro-evidence.mjs`,
  `scripts/author-cbh-packet.mjs`, `scripts/author-cbro-packet.mjs`.
* What changed and why: Added optional occurrence totals and repeated-reference ledgers, strict
  canonical identity and source-position validation, mapping mirrors, occurrence-aware source
  counts, approval-time re-derivation, CBRO count compatibility, and conditional Markdown
  provenance without changing unique mapping or output guards.
* Completion evidence: Current no-repeat packets remain valid; repeated mappings reconstruct full
  source positions; self-consistently re-digested position and source-count tampering fails in both
  providers.
* Validation: Focused shared and historical-provider tests pass.

### Migrated Groot and proved all supplied blocker shapes

* Related phase or task: P01-T03.
* Files: `scripts/data/cbh-packets/groot-reading-order.json`,
  `scripts/data/cbh-mappings/groot-reading-order.json`,
  `scripts/data/cbh-overlaps/groot-reading-order.json`,
  `src/data/orders/groot-reading-order.md`, `test/cbh-batch.test.js`,
  `test/cbh-character-spotlight.test.js`, `test/cbro-historical-events.test.js`.
* What changed and why: Replaced two repeat-related exclusion strings with eight exact occurrence
  records at positions 72-79 targeting canonical rows 8-15; refreshed the packet, mapping, report,
  approval, and provenance while preserving 76 selected ids and current relationships.
* Completion evidence: Packet digest
  `b9cd22d29d38539fa16d44d15db0cea8108ad414319828c0108845d0f3d267c7`;
  mapping digest `8f693cbf39f09350230965373d28a9bf3cb4fc34175ed848b751778a41d16523`;
  report digest `a83bdf4ba3b9bfcee2524abe830219d9754b82d5c637f49191a313c19052870f`;
  approval digest `b4acc491b8240f8b9343fba015e3891ad7a0dca9c996f765a93e130515f37e54`.
  Iron Man 815/813, Old Man Logan 98/96, and Planet Hulk 109/104 fixtures all reconstruct exactly.
* Validation: 34 focused tests passed. With implementation files stashed, the suite exited 1 with
  three failures; restoring the stash returned all 34 tests to passing.

### Preserved the exact Iron Man metadata blocker

* Related phase or task: P02 and P02-T01.
* Files: `scripts/data/cbh-character-inventory.json`,
  `test/cbh-character-spotlight.test.js`.
* What changed and why: Recorded that the new occurrence contract can represent the complete
  815/813 source boundary, but publication still cannot proceed because nine source-required issues
  are absent from the configured metadata contract. No source issue was omitted, inferred, or
  replaced.
* Completion evidence: Configured search returns zero Crimson Dynamo issues; Iron Man: Viva Las
  Vegas series 4850 contains only #1-2, so #3-4 are absent; Iron Man Legacy series 9347 omits #2,
  #5, and #10. The first missing source row is Crimson Dynamo #1 at source/canonical position 425.
  Packet, mapping, overlap, order, payload, and catalog artifacts for `iron-man-reading-order` remain
  absent.
* Validation: Character Spotlight owner passes 8 tests including exact inventory reason and
  candidate-file absence.

### Aligned direct product and maintainer records

* Related phase or task: P03-T01.
* Files: `PRODUCT_BACKLOG.md`, `CHANGELOG.md`, `GOVERNANCE.md`,
  `docs/DATA_PROVENANCE.md`, `docs/MAINTAINING.md`.
* What changed and why: Added the shipped shared occurrence feature, plain-English unchanged-product
  outcome, exact Groot 84/76 provenance, provider-neutral maintenance rules, Iron Man blocker, and
  re-derived backlog and governance counts.
* Completion evidence: Backlog now has 160 shipped items, 188 detail blocks, 182 constraint checks,
  and 183 ranked rows; catalog and Character Spotlight counts remain unchanged.
* Validation: 65 count, governance, link, and shipped-copy tests passed.

### Completed local and installed-Edge release proof

* Related phase or task: P03-T02.
* Files: final bounded implementation and records.
* What changed and why: Re-aimed every shifted product citation by head search and diff arithmetic,
  read all 33 bless pairings, and ran the complete local and browser release boundary.
* Completion evidence: Lint passed; 1,417 tests passed with zero failures; counts report 183 ranked
  rows, 5 parked, 188 detail blocks, 160 Shipped, 21 Ready, 6 Dropped, and 1 Proposed; sizes reports
  6 accurate claims; publication scans 3,399 blobs with zero findings; live metadata contract passes
  33/33 assumptions across 17 requests; anchors report 1,172 unchanged and zero drifted/new/removed.
  Browser runner passes 182 assertions across 19 scenarios. Real-catalog Edge checks at 1280x900 and
  390x844 each show 12 Character Spotlight stories, 4 Complete guide stories, 5 Best of stories,
  Groot in Complete guides, Iron Man absent, visible filters, and no horizontal overflow.
* Validation: Dash scan found zero added en or em dashes; `git diff --check` passed.

## Implementation-Time Plan and Detail Updates

### Corrected and dispositioned the sole plan critique

* Affected plan area or markers: Functional requirements, locked failure matrix, P01-T01, P01-T02,
  P01-T03, Critique Disposition.
* What changed: Corrected Iron Man reconstructed position to canonical row 716 at source position
  718 while row 710 stays at 710; required approval-time re-derivation of every mapping source
  position and approved source count; added strict repeated-record field mutations.
* Why: PC-001 through PC-003 identified direct evidence-backed gaps in the final candidate.
* Triggering evidence: Sole critique at
  .copilot-tracking/reviews/plans/2026-08-23/repeated-source-occurrences-plan-critique.md.
* User answer or decision: None required.
* Reconciliation performed: Executive requirements, functional requirements, locked test boundary,
  phase tasks, details, implementation context, critique disposition, and handoff are current.
* Planning and critique state: Implementation-ready; no second critique.

### Narrowed the release after the conditional Iron Man gate closed

* Affected plan area or markers: Executive Summary, goals, scope, requirements, acceptance,
  locked boundary, P02, P03, P04, follow-ups, and phase details.
* What changed: Removed obsolete active Iron Man packet, mapping, overlap, authoring, and product
  tasks. P02 now preserves the exact blocker; P03 documents and proves the shared occurrence
  contract plus Groot migration; catalog counts stay unchanged.
* Why: The user authorized Iron Man only if all 813 distinct issues mapped exactly. Nine exact
  source-required issues are unavailable.
* Triggering evidence: Configured metadata API series and search results recorded under Completed
  Work.
* User answer or decision: The existing conditional direction resolves the outcome; no new user
  choice is required.
* Reconciliation performed: Current plan, details, acceptance, dependencies, follow-ups, markers,
  changes evidence, and handoff agree.
* Planning and critique state: Implementation-ready current state; the sole critique remains
  historical and is not repeated.

## Validation Record

| Check | Scope | Status | Evidence or reason |
|---|---|---|---|
| Research scratch simulation | 815/813, 98/96, 109/104 and malformed cases | Passed | Corrected run accepted all intended shapes and rejected accidental duplicate, forward target, identity mismatch, and duplicate position. |
| Current packet identity scan | All frozen CBH and CBRO packets | Passed | Zero canonical identity collisions. |
| Focused occurrence suite | P01 | Passed | 34 tests passed, 0 failed. |
| No-fix failure proof | P01 | Passed | Stashed implementation made the focused suite exit 1 with three failures; restored implementation passed. |
| Iron Man blocker test | P02 | Passed | 8 Character Spotlight tests passed; blocker and artifact absence are exact. |
| Direct record tests | P03-T01 | Passed | 65 count, governance, link, and shipped-copy tests passed. |
| Lint | Full tree | Passed | ESLint reported zero findings. |
| Full tests | Full tree | Passed | 1,417 passed, 0 failed. |
| Counts, sizes, publication | Full tree | Passed | 183 ranked rows; 6 size claims; 3,399 blobs and 0 publication findings. |
| Live contract | Metadata API | Passed | 33/33 assumptions across 17 requests. |
| Anchors | All tracked citations | Passed | 1,172 unchanged, 0 drifted, 0 new, 0 removed. |
| Browser runner | Installed Edge | Passed | 182 assertions across 19 scenarios. |
| Real catalog viewports | Installed Edge at 1280x900 and 390x844 | Passed | 12 stories, 4 Complete, 5 Best of, Groot present, Iron Man absent, no overflow. |
| Dash and diff scans | Added lines and whitespace | Passed | 0 dash findings; diff check clean. |

## Pre-Review Reconciliation

* Plan markers and phase details: P01 through P03 complete; P04-T01 active.
* Completed-work evidence and handoff prose: Current through P03.
* Validation, blockers, remaining work, and follow-up items: Current at opening.
* Review readiness: Awaiting current-main reconciliation before the one Review.

## Blockers

* None for the shared release. Iron Man is an explicit follow-up blocker outside active publication
  scope.

## Remaining Work

* P04 as listed in Execution Status.

## Follow-Up Items

* Canonical plan list: .copilot-tracking/plans/2026-08-23/repeated-source-occurrences-plan.md,
  `## Follow-Up Items`.
* Old Man Logan later candidate release after its 98/96 test-backed occurrence shape receives exact
  metadata and relationship review.
* Planet Hulk later candidate release after its 109/104 test-backed occurrence shape receives exact
  metadata and relationship review.
* Iron Man later candidate release after all nine missing source-required issues become available
  and the complete 813-distinct-issue mapping passes.

## Return-to-Caller State

* Implementation execution status: Partial, P01 through P03 complete; P04-T01 active.
* Declared scope and markers: Full plan; P01 through P03 markers complete.
* Validation coverage: Research simulation, compatibility scan, 34 focused tests, no-fix proof,
  blocker and direct-record tests, full 1,417-test suite, lint, counts, sizes, publication, contract,
  anchors, browser, dash, and diff checks passed.
* Blockers: None for the shared release; Iron Man is a follow-up blocker.
* Current plan and detail updates: Sole critique corrections are complete and implementation state
  is active.
* Planning and critique state: Implementation-ready after one critique.
* Follow-up items: Iron Man, Old Man Logan, and Planet Hulk product work remain outside active scope.
* Review readiness or no-handoff reason: Reconcile current main before the one Review.
* Continuation owner: This automatic RPI implementation session.
