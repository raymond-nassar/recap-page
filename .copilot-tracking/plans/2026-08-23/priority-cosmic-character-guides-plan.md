<!-- markdownlint-disable-file -->
# RPI Plan: Priority cosmic character guides

## Task Metadata

* Task ID: MRT-002-C05
* Task slug: priority-cosmic-character-guides
* Planning status: Implementation ready after one critique
* Implementation status: P04-T02 in progress
* Plan date: 2026-08-23
* Mode: automatic
* Baseline: merged PR #173 at `086cc5b`
* Phase details: .copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-23/priority-cosmic-character-guides-plan-critique.md

## Executive Summary

This plan publishes Rocket Raccoon as the next Complete guide on Character Spotlight. Research accepted
all four requested frozen source boundaries, but only Rocket is release-ready in this packet. Its seven
issue-bearing source blocks expand to 75 unique whole issues, every issue is present in the metadata
snapshot, and it is the highest-ranked candidate in the user's popularity list.

Groot and Star-Lord remain exact accepted boundaries, not rejected guides. They are deferred because each
shares at least 25 source-required issue ids with Rocket, while the unchanged guarded authoring path rejects
any duplicate issue id across one selected packet. Thanos remains deferred because source-required Spidey
Super Stories #39 is absent from the metadata snapshot. No guide will be shortened to increase the batch.

### User Decisions and Requirements Highlights

* Preserve the exact candidate order: Rocket Raccoon rank 7, Groot rank 9, Star-Lord / Peter Quill rank 15,
  then gated Thanos rank 17.
* Use only the existing guarded packet, mapping, complete-library overlap, approval, and authoring workflow.
* Publish accepted cards as `character-run` with explicit `spotlightKind: complete-guide`; leave every
  existing Best of card unchanged.
* Continue automatically through one critique, implementation, one independent Review, PR, required hosted
  CI, reconciliation if needed, and merge.

### What You May Not Know

* Rocket has three expected current-library partial relationships: 10 issues with Marvel Fresh Start
  Avengers, 10 with Scarlet Witch Best Of, and 7 with War of Kings. Each must receive an explicit central
  disposition before authoring.
* The post-publication Character Spotlight counts should be 12 readings and 11 grouped stories under All,
  5 readings and stories under Best of, and 3 readings and stories under Complete guides.

### Unresolved Decisions or Blockers

* None for Rocket. Groot, Star-Lord, and Thanos are explicit non-blocking release deferrals.

For current user input, see [User Decisions and Requirements](#user-decisions-and-requirements).

## User Decisions and Requirements

* Implement MRT-002-C05 from current main after merged PR #173.
* Use the user's durable popularity order: Rocket Raccoon at rank 7, Groot at 9, Star-Lord / Peter Quill at
  15, and Thanos at 17. Reserve higher-ranked large guides for later dedicated lanes.
* Research and centrally accept every committed frozen source boundary before mapping.
* Use only the guarded packet, exact mapping, complete-library overlap, central approval, and authoring
  workflow. Do not create heuristic page parsers, choose an ambiguous series by score, infer missing issues,
  or silently shorten a source guide.
* Resolve every source-defined whole issue exactly. Defer a candidate whose unavailable or ambiguous issue
  prevents its claimed complete boundary, and continue safely with the others.
* Keep Thanos as an explicitly gated fourth candidate and reduce the batch if its boundary or overlap risk
  is not release-ready.
* Regenerate complete-library and selected-peer reports, centrally disposition every exact, subset, and
  partial relationship, and bind fresh packet, mapping, report, library, peer, and approval digests.
* Publish accepted cards as `character-run` plus `spotlightKind: complete-guide`. Keep existing Best of
  cards separate and unchanged.
* Preserve source order, chronology, availability semantics, zero runtime dependencies, the fixed origin,
  no image-byte storage, and no em dashes.
* Update catalog, data, orders, explicit taxonomy validation, counts, backlog, changelog, maintenance,
  provenance, runbook, UX documentation, and anchors where directly affected.
* Add semantic tests for exact source rows and freshness, complete relationship dispositions, final sequence,
  card and filter classification, and rejection of omitted or stale source-defined rows. Prove the new
  checks fail without the implementation.
* Run lint, full tests, counts, anchors through re-aim and read-before-bless, publication and release checks,
  dash scan, diff check, live metadata contract, and installed Edge browser verification at 1280x900 and a
  narrow viewport. Browser coverage must verify All, Best of, and Complete guides counts and visibility.
* Run exactly one plan critique and exactly one independent post-implementation Review. Fix only in-scope
  release blockers without another Review and route unrelated work.
* Open a PR whose first section is `## In plain English`, include exact verification counts and the required
  co-author trailer, monitor Node 20, Node 24, and lint job conclusions, reconcile main if needed, merge, and
  persist the merged result.

## Goals

* Publish the exact 75-issue Rocket Raccoon Complete guide through the existing guarded workflow.
* Preserve all four centrally accepted source decisions and the exact deferral reasons for the other three
  popularity candidates.
* Make the new card, explicit taxonomy, filter counts, generated data, and documentation agree.
* Prove the complete-boundary and freshness guards fail on omissions and stale evidence before release.
* Deliver one reviewable feature through one critique, one Review, hosted CI, and merge.

## Scope and Non-Goals

### In Scope

* One centrally reviewed Rocket frozen packet, exact mapping, 89-list factual report, central relationship
  approval, source order, generated payload, catalog record, shipped inventory lifecycle, and reason-only
  research disposition updates for the three deferred candidates.
* Three central Rocket partial dispositions and maintained policy dispositions for every `none` relationship.
* Explicit `character-run` and `complete-guide` classification in canonical and generated catalog surfaces.
* Focused semantic and regression coverage in existing test owners.
* Directly affected maintenance, provenance, runbook, UX, backlog, changelog, tracking, count, and anchor
  records.
* Wide and narrow installed Edge verification of All, Best of, and Complete guides counts and visibility.
* One independent Review, PR, hosted CI, reconciliation when needed, merge, and durable merged state.

### Non-Goals

* Publishing Groot, Star-Lord, or Thanos in this packet.
* Altering or shortening their accepted source boundaries.
* Relaxing the guarded cross-candidate duplicate-issue rule.
* Creating a source-page parser, scoring ambiguous metadata, adding inferred issues, or approving an
  exception row.
* Changing existing Best of cards, storage, availability, reader launch behavior, fixed origin, image
  handling, runtime dependencies, or build tooling.
* A second critique or a second independent Review.

## Functional Requirements

* A frozen Rocket packet records exactly the 75 unique whole issues from all seven committed issue-bearing
  blocks in source order.
  * Observable acceptance criteria: the packet includes the opening collection, Guardians 2008 #1-25,
    Rocket Raccoon 2016 #1-5, Rocket 2017 #1-6, Shuri #3, Avengers: No Road Home #1-10, Guardians 2019
    #1-12, and its annual, with no omission, duplicate, inferred issue, or prose-only collection.
* Named preparation resolves every packet row against the metadata snapshot.
  * Observable acceptance criteria: all 75 rows are `exact`, selected issue ids are unique, the latest
    on-sale date remains inside the 2025-10-29 horizon, and packet and mapping digests validate.
* Factual overlap and central approval cover the complete pre-publication library.
  * Observable acceptance criteria: the report contains 89 comparisons and no peer digest, records exactly
    three partials with shared counts 10, 10, and 7, has no exact or subset relationship, and every comparison
    has one approved disposition bound to current packet, mapping, library, and report digests.
* Guarded authoring creates one complete Character Spotlight guide.
  * Observable acceptance criteria: the manifest and catalog entries use `type: character-run` and
    `spotlightKind: complete-guide`, the source order and generated payload contain the exact mapping
    sequence, and the inventory records Rocket as shipped with its three overlap ids.
* Existing filter categories remain distinct.
  * Observable acceptance criteria: All reports 12 readings and 11 stories, Best of reports 5 and 5,
    Complete guides reports 3 and 3, Rocket appears under All and Complete guides only, and every existing
    Best of card remains unchanged and visible under All and Best of.
* Semantic guards reject incomplete or stale publication evidence.
  * Observable acceptance criteria: a removed source row, changed packet row without a digest refresh,
    stale mapping, stale report, stale library, omitted disposition, stale approval, wrong final sequence,
    or wrong spotlight taxonomy fails focused tests.

## Non-Functional Requirements

* Runtime dependencies remain zero.
  * Objective threshold or evaluation condition: package runtime dependency count stays zero.
  * Operating condition or verification approach: no package manifest change is needed.
  * Observable acceptance criteria: the browser still loads only local ES modules and vendored data.
* Source and relationship decisions remain central and reproducible.
  * Objective threshold or evaluation condition: packet, mapping, report, library, and approval validators
    all pass from the final tree.
  * Observable acceptance criteria: no worker authority, parser output, heuristic choice, exception row, or
    hand-edited generated payload enters the release.
* Existing product behavior remains stable.
  * Objective threshold or evaluation condition: no storage, origin, availability, navigation, popup, or
    Best of card behavior changes.
  * Observable acceptance criteria: full tests, browser checks, and direct diff inspection show only the
    new complete-guide data and directly related validation or documentation behavior.
* The release remains bounded and reviewable.
  * Objective threshold or evaluation condition: exactly one new guide with 75 issues, no new production
    test file, no runtime dependency, one critique, and one Review.
  * Observable acceptance criteria: the PR and durable records report one selected guide and three explicit
    deferrals.
* Writing and release conventions remain intact.
  * Objective threshold or evaluation condition: added shipped prose contains no em dash and all required
    evidence anchors are current.
  * Observable acceptance criteria: dash scan reports zero added lines, anchors finish at zero drifted,
    zero new, and zero removed after read-before-bless.

## Acceptance Criteria

* Rocket publishes with exactly 75 source-ordered unique issues, all exact and inside the metadata horizon.
* No source-defined whole issue is omitted, inferred, scored, duplicated, or replaced by an exception.
* The report covers all 89 pre-publication readings, with only the three expected current-library partials.
* Every report relationship has one central disposition and all freshness digests validate.
* The post-publication catalog contains 90 readings, 12 `character-run` entries, and 11 Character Spotlight
  stories.
* Character Spotlight filter counts are All 12 readings / 11 stories, Best of 5 / 5, and Complete guides
  3 / 3. Rocket appears only under All and Complete guides.
* Existing Best of cards and their data remain unchanged.
* The maintained character inventory retains 128 identities, marks only Rocket newly shipped, and keeps
  Groot, Star-Lord, and Thanos deferred with exact research-backed reasons.
* Focused negative tests are observed failing on the pre-implementation production tree, then pass with the
  complete implementation.
* Targeted tests, full tests, lint, counts, anchors, publication checks, release checks, live contract, dash
  scan, diff inspection, and wide plus narrow installed Edge checks all pass with exact results recorded.
* Exactly one independent Review runs after implementation; all in-scope blockers are fixed or explicitly
  routed without a second Review.
* A plain-English-first PR records exact validation counts, Node 20, Node 24, and lint jobs pass, any main
  reconciliation is revalidated, the PR merges, and the merged result is persisted.

## Initial Planning Readiness

* Evidence status: Research complete after one focused Wider, Deeper, and Contrarian cycle.
* Selected scope: Rocket only, 75 exact source-defined unique issues.
* Active boundaries: unchanged guarded workflow, one Complete guide, three candidate deferrals, no source
  shortening, one critique, one Review.
* Planning gap: none demonstrated.
* Current blocker: none.

## Locked Change and Test Boundaries

* Exact removals: none.
* Maximum new committed files: five, consisting of one packet, one mapping, one overlap report, one source
  order, and one generated payload.
* Maximum new production test files: zero.
* Canonical targets: `scripts/data/cbh-packets/rocket-raccoon-reading-order.json`,
  `scripts/data/cbh-mappings/rocket-raccoon-reading-order.json`,
  `scripts/data/cbh-overlaps/rocket-raccoon-reading-order.json`,
  `src/data/orders/rocket-raccoon-reading-order.md`, `scripts/data/cbh-character-inventory.json`, and
  `src/data/curated-lists.json`.
* Generated targets: `src/data/rocket_raccoon_reading_order.json` and `src/data/catalog.json`.
* Semantic test owner: `test/cbh-character-spotlight.test.js`.
* Taxonomy and filter regression owners: `test/catalog-shelves.test.js`, `test/catalog.test.js`, and
  `test/curated.test.js`.
* Guard regression owner: `test/cbh-batch.test.js`.
* Browser verification owners: unchanged fixture regression in `scripts/browser-check.mjs` plus a temporary,
  non-committed `scripts/verify-priority-cosmic-character-guides-browser.mjs` that loads the real app through
  the repository server with externally installed `puppeteer-core`, runs at 1280x900 and 390x844, records
  exact observations in the changes artifact, and is removed before final diff inspection.
* Proof requirement: run the new focused assertions against the pre-production implementation state and
  observe a failure before restoring the implementation.

## Implementation Context Record

| Context item | Current artifact or record |
|---|---|
| Plan | .copilot-tracking/plans/2026-08-23/priority-cosmic-character-guides-plan.md |
| Phase details | .copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md |
| Latest critique | .copilot-tracking/reviews/plans/2026-08-23/priority-cosmic-character-guides-plan-critique.md completed once; three direct corrections applied |
| Relevant research | .copilot-tracking/research/2026-08-23/priority-cosmic-character-guides-research.md |
| Changes-record role | .copilot-tracking/changes/2026-08-23/priority-cosmic-character-guides-changes.md is created by implementation |
| Planning execution and readiness | complete and implementation ready after one critique |
| Continuation context | Automatic RPI coordinator continues to P01 |

## Sources

* .copilot-tracking/research/2026-08-23/priority-cosmic-character-guides-research.md: controlling source
  acceptance, candidate selection, relationship evidence, and Planning Readiness.
* scripts/data/cbh-character-inventory.json: maintained source identity and lifecycle root.
* .copilot-tracking/research/2026-08-22/character-spotlight-boundaries.json: committed exact page and
  issue-bearing-block boundaries.
* scripts/lib/cbh-inventory.mjs: packet, mapping, report, approval, library, and inventory contracts.
* scripts/prepare-cbh-batch.mjs: named metadata preparation and mapping generation.
* scripts/report-order-overlap.mjs: complete-library and peer report generation.
* scripts/author-cbh-packet.mjs: central relationship approval and guarded authoring.
* src/js/lib/catalog.js and src/js/lib/curated.js: explicit Character Spotlight taxonomy and validation.

## Phase Checklist

<!-- rpi:phase id=P01 -->
### [x] P01: Freeze and map Rocket

* Intent: Convert the centrally accepted seven-block Rocket boundary into one immutable 75-row packet and
  exact digest-bound mapping.
* Dependencies: Completed MRT-002-C05 Research.

<!-- rpi:task id=P01-T01 -->
#### [x] P01-T01: Author the exact frozen packet

* Requirement and evidence: Research accepted 75 unique whole issues from seven committed issue-bearing
  blocks and rejected every parser, heuristic, and omission path.
* Expected result: one centrally reviewed packet preserves source order, explicit metadata identities, an
  exact `character-run` plus `complete-guide` manifest proposal, and a fresh packet digest. The inventory
  records exact reason text for all three deferred candidates without changing their lifecycle fields.
* Detail section: P01-T01 in .copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md

<!-- rpi:task id=P01-T02 -->
#### [x] P01-T02: Generate and approve the exact mapping

* Requirement and evidence: Named preparation must resolve all packet rows and reject missing or ambiguous
  metadata.
* Expected result: one 75-row exact mapping binds the packet, contains unique selected issue ids and current
  metadata, and has a fresh mapping digest.
* Detail section: P01-T02 in .copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md

<!-- rpi:phase id=P02 -->
### [x] P02: Approve and publish Rocket

* Intent: Bind Rocket to the complete current library, centrally approve every relationship, and author the
  new guide through the unchanged guard.
* Dependencies: P01.

<!-- rpi:task id=P02-T01 -->
#### [x] P02-T01: Regenerate and approve all relationships

* Requirement and evidence: Rocket has three expected partials and every one of 89 comparisons requires a
  fresh central disposition.
* Expected result: one current report and one approval cover the full library with no exact or subset
  relationship and fresh packet, mapping, library, report, and approval digests.
* Detail section: P02-T01 in .copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md

<!-- rpi:task id=P02-T02 -->
#### [x] P02-T02: Author, vendor, and classify the guide

* Requirement and evidence: Guarded authoring owns the source order and canonical manifest; vendoring owns
  generated payload and catalog.
* Expected result: Rocket is shipped as one ungrouped Complete guide card, exact generated sequences match
  the mapping, and the inventory advances only Rocket.
* Detail section: P02-T02 in .copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md

<!-- rpi:phase id=P03 -->
### [x] P03: Prove and document the release

* Intent: Lock semantic failure behavior, reconcile directly affected records, and verify repository and
  browser release evidence before Review.
* Dependencies: P02.

<!-- rpi:task id=P03-T01 -->
#### [x] P03-T01: Extend semantic and filter coverage

* Requirement and evidence: The user requires exact freshness, disposition, sequence, taxonomy, filter, and
  omitted-row failure coverage with proof the checks detect the missing implementation.
* Expected result: existing test owners fail on the pre-implementation production state and pass with the
  75-row guide, three partials, exact catalog sequence, and All / Best of / Complete guides classification.
* Detail section: P03-T01 in .copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md

<!-- rpi:task id=P03-T02 -->
#### [x] P03-T02: Reconcile records and run release gates

* Requirement and evidence: Directly affected maintenance, provenance, runbook, UX, backlog, changelog,
  counts, anchors, publication, contract, writing, and browser evidence must agree.
* Expected result: a review-ready diff passes every required gate and installed Edge checks at 1280x900 and
  a narrow viewport with exact filter counts and visibility.
* Detail section: P03-T02 in .copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md

<!-- rpi:phase id=P04 -->
### [ ] P04: Review and deliver the release

* Intent: Run the one independent Review, resolve only in-scope blockers, and carry the validated feature
  through PR, hosted CI, reconciliation if needed, and merge.
* Dependencies: P03.

<!-- rpi:task id=P04-T01 -->
#### [x] P04-T01: Run and resolve the one independent Review

* Requirement and evidence: The caller permits exactly one post-implementation Review and forbids review
  loops.
* Expected result: one durable independent Review record has no unresolved in-scope release blocker after
  fixes or explicit routing.
* Detail section: P04-T01 in .copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md

<!-- rpi:task id=P04-T02 -->
#### [ ] P04-T02: Open the PR, verify hosted CI, reconcile, and merge

* Requirement and evidence: Release authority stays central through PR wording, exact validation counts,
  Node 20, Node 24, lint, final-main reconciliation, merge, and durable merged state.
* Expected result: a plain-English-first PR passes all required hosted jobs, any reconciliation is
  revalidated, the PR merges, and MRT-002-C05 records the merged commit and result.
* Detail section: P04-T02 in .copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md
* Implementation status: In progress. Hosted run 32666642248 passed all three required jobs on
  feature head `082c28ba8eeed7fbd9bad6b605f00fb90941b943`; no `main` reconciliation is needed. The final
  evidence commit must pass the same jobs before merge.

## Dependencies

* Completed MRT-002-C05 Research with Ready disposition and Rocket-only selection.
* Existing guarded Character Spotlight workflow merged before PR #173.
* Exact Comic Book Herald source and credit records already maintained by the project.
* Frozen Marvel metadata mirror for preparation and live contract validation.
* Installed Edge and the repository's external Puppeteer pattern.
* GitHub availability for PR, hosted CI, reconciliation, and merge.

## Critique Disposition

| Critique run and finding | Disposition | Plan response or residual risk |
|---|---|---|
| One critique, PC-001 | applied | P01-T01 now owns reason-text-only updates for Groot's 41-issue Rocket overlap, Star-Lord's 25-issue Rocket overlap, and Thanos's missing Spidey Super Stories #39 while every deferred lifecycle field remains unchanged. |
| One critique, PC-002 | applied | P03-T02 now names the temporary real-catalog Edge script, exact viewports, unchanged fixture regression, evidence location, and required cleanup. |
| One critique, PC-003 | applied | Follow-up guidance now states that the existing partial-disposition path supports separate later Groot and Star-Lord authoring; only same-packet publication conflicts with the duplicate-id guard. |

## Follow-Up Items

* Groot and Star-Lord retain accepted exact source boundaries and can each use the existing partial
  relationship disposition path in a separate later authoring call after Rocket. Only placing them in the
  same selected packet conflicts with the duplicate-id guard.
* Thanos can re-enter only if the frozen metadata evidence can resolve source-required Spidey Super Stories
  #39 and the complete boundary is revalidated.

## Handoff

* Implementation artifact: .copilot-tracking/changes/2026-08-23/priority-cosmic-character-guides-changes.md
* Ready phase or task: P04-T02.
* Remaining provisional question or blocker: none.
