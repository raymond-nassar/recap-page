<!-- markdownlint-disable-file -->
# RPI Plan: Licensed tie-in exclusion batch

## Task Metadata

* Task ID: MRT-003-C02-B04
* Parent task: MRT-003-C02
* Task slug: licensed-character-issues
* Planning status: Ready after one independent critique
* Plan date: 2026-08-24
* Research input: .copilot-tracking/research/2026-08-24/licensed-character-issues-research.md
* Phase details: .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-24/licensed-character-issues-plan-critique.md

## Executive Summary

This continuation will publish Wraith War, Secret Wars II, and Mutant Massacre as intentionally
curated historical-event guides. It will preserve the full external source record while omitting
only 31 user-approved, nonessential tie-ins that readers cannot discover through Marvel Unlimited.
Readers will see 58 retained issues, explicit scope disclosure, and a link to each full source order.

The implementation will extend the existing historical evidence contract rather than treating the
omissions as failed lookups or availability records. Each source row must be conserved as either one
included row or one exact approved exclusion, and every other omission must fail.

### User Decisions and Requirements Highlights

* Omit exactly the named ROM, ROM Annual, Micronauts, and Power Pack rows from these three guides.
* Wraith War must use selected or essential framing because it retains only 7 of 35 source rows.
* The decision is guide-scoped and creates no precedent for later events or other guides.

### What You May Not Know

* The app's unavailable override says the reader made the decision, so using it here would be false.
* The earlier Wraith War blocker says 30 rows are unresolved, but the source contains exactly 28
  excluded ROM and ROM Annual rows.
* The Evolutionary War remains the position-17 continuation cursor and is not part of this batch.

### Unresolved Decisions or Blockers

* None. Exact metadata must still pass resolution, but any unexpected missing retained row is an
  implementation blocker rather than permission to shorten a guide.

## User Decisions and Requirements

* Continue the committed MRT-003-C02 lineage from current project-default main as bounded child
  MRT-003-C02-B04.
* Omit only ROM #40-66, ROM Annual #3, ROM #72, Micronauts Vol. 2 #16, and Power Pack #27 from the
  three named guides.
* Treat those rows as auditable product-scope exclusions based on confirmed nonessentiality and
  Marvel Unlimited undiscoverability, not silent resolver drops or availability entries.
* Preserve conservation: source rows equal included rows plus exact approved exclusions; reject every
  other omission.
* Retain 7 of 35 Wraith War rows, 40 of 42 Secret Wars II rows, and 11 of 12 Mutant Massacre rows.
* Correct the stale Wraith War unresolved count from 30 to 28.
* Require exact exclusion ledgers, retained-row remapping, complete relationship reports,
  reader-facing disclosure, and truthful non-complete depth where necessary.
* Never invent Marvel IDs, URLs, availability values, issue identities, or exclusion reasons.
* Preserve the supplemental Comic Book Herald essential-trades source as future evidence only. It
  does not replace the position-17 Evolutionary War cursor.
* Complete one critique, implementation, one Review, all repository gates, commit, pull request, and
  merge-readiness assessment without widening this batch.

## Goals

* Publish three truthful historical-event guides containing exactly 58 retained issues.
* Make every approved exclusion exact, reviewable, digest-bound, and reader-visible.
* Preserve existing CBRO releases while adding one bounded MRT-003-C02-B04 release.
* Keep availability semantics, local-first behavior, and the future inventory cursor unchanged.

## Scope and Non-Goals

### In Scope

* Structured guide-scoped exclusion evidence for the exact 31 approved source rows.
* Three packets, exact mappings, complete-library and peer relationship reports, approvals, authored
  checklists, payloads, catalog entries, inventory transitions, tests, and direct delivery records.
* Essential or selected framing and explicit exclusion disclosure for all three guides, with Wraith
  War never labelled complete.

### Non-Goals

* Availability-state changes, placeholder shipping, metadata fabrication, or resolver fallbacks.
* The Evolutionary War, later inventory positions, supplemental essential-trade candidates, or any
  other guide's exclusions.
* Reauthoring the 18 shipped historical guides or changing saved progress.

## Functional Requirements

* The frozen evidence must represent all 89 source rows as 58 retained rows plus 31 exact exclusions.
* Exclusion evidence must bind guide ID, source position, exact source issue reference, bounded reason,
  and the MRT-003-C02-B04 decision scope.
* Mapping preparation must preserve retained source positions and reject missing, extra, reordered,
  duplicated, or unapproved exclusions.
* Complete reports must compare all three exact retained mappings against the current catalog and
  the other two selected peers before relationship approval.
* Authoring must add exactly three non-complete catalog guides and disclose that named
  Marvel-Unlimited-undiscoverable tie-ins were omitted, while linking the full source order.
* Inventory authority must promote only positions 12 through 14, correct the Wraith count, preserve
  every other record, and leave position 17 deferred.

## Non-Functional Requirements

* Runtime dependencies remain zero and no runtime network, account, cloud, telemetry, or image-byte
  behavior is added.
* Existing frozen packets without structured exclusions remain byte-for-byte semantically compatible.
* Packet, mapping, report, approval, inventory, library, and peer digests remain deterministic and
  stale evidence must fail.
* Public copy states the observable discoverability boundary and user-selected curation scope without
  presenting the legal cause as independently verified fact.
* Added shipped prose contains no em dash or en dash.

## Acceptance Criteria

* Wraith War ships 7 retained rows and exactly 28 exclusions; Secret Wars II ships 40 and exactly 2;
  Mutant Massacre ships 11 and exactly 1.
* Source positions across retained rows and exclusion ledgers form each exact integer range with no
  gap or overlap: 1 through 35, 1 through 42, and 1 through 12.
* The three ledgers contain only the 31 approved issue references and positions, and every mutation
  that removes, adds, renames, reorders, or reassigns one is rejected.
* All 58 retained rows resolve exactly with positive configured metadata IDs and canonical Marvel
  URLs; zero placeholders or unresolved rows ship.
* All three catalog entries use truthful non-complete depth and reader-facing scope disclosure.
* Relationship reports are complete for the final catalog baseline and every non-none tuple has an
  exact release-scoped decision.
* Existing MRT-003 through MRT-003-C02-B03 releases remain accepted without changed packet meaning.
* Inventory and documentation record the corrected 28-row Wraith exclusion and unchanged
  Evolutionary War cursor.
* Focused mutation proof fails without the new conservation guard, then the final focused suite,
  lint, full tests, counts, sizes, palette, anchors, publication, live contract, and installed Edge
  checks pass.
* Exactly one plan critique and one post-implementation Review are recorded.

## Implementation Context Record

| Context item | Current artifact or record |
|---|---|
| Plan | .copilot-tracking/plans/2026-08-24/licensed-character-issues-plan.md |
| Phase details | .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md |
| Latest critique | .copilot-tracking/reviews/plans/2026-08-24/licensed-character-issues-plan-critique.md with Revise disposition and three resolved direct corrections |
| Relevant research | .copilot-tracking/research/2026-08-24/licensed-character-issues-research.md |
| Changes-record role | .copilot-tracking/changes/2026-08-24/licensed-character-issues-changes.md is created by implementation |
| Planning execution and readiness | Complete and implementation-ready after resolving PC-001 through PC-003 |
| Continuation context | Automatic RPI parent continues to implementation |

## Sources

* .copilot-tracking/research/2026-08-24/licensed-character-issues-research.md: Confirmed decisions,
  exact exclusion ledger, retained counts, availability assessment, and supplemental source boundary.
* .copilot-tracking/research/2026-08-23/historical-event-source-pages.json: Frozen 89-row source
  identity and position evidence.
* .copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-research.md:
  Parent blocker state, release lineage, and current cursor.

## Phase Checklist

<!-- rpi:phase id=P01 -->
### [x] P01: Establish exclusion-aware source and compatibility contracts

* Status: Complete
* Intent: Extend frozen evidence so exact approved exclusions are first-class source records and lock
  predecessor compatibility before chronology-dependent release authority is finalized.
* Dependencies: Completed licensed-character research and current merged B03 baseline.

<!-- rpi:task id=P01-T01 -->
#### [x] P01-T01: Add exact source conservation primitives

* Status: Complete
* Requirement and evidence: The 89 source rows must reconstruct from 58 retained rows and 31 exact
  exclusion records while every packet without exclusions remains compatible.
* Expected result: Shared validators and digests accept only ordered, unique, gap-free structured
  exclusions with exact retained positions.
* Detail section: P01-T01 in .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md

<!-- rpi:task id=P01-T02 -->
#### [x] P01-T02: Lock predecessor and B04 inventory invariants

* Status: Complete
* Requirement and evidence: B03 compatibility must remain measurable even though B04 changes the three
  records that B03 left blocked.
* Expected result: The existing B03 nonselected constant and filter remain unchanged, a distinct
  normalized B03 outcome invariant reconstructs positions 12 through 14 exactly as committed by B03,
  and a new B04 untouched-inventory invariant protects every record outside the three-guide batch.
* Detail section: P01-T02 in .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md

<!-- rpi:phase id=P02 -->
### [x] P02: Resolve chronology, finalize authority, compare, and approve

* Intent: Produce exact retained metadata first, derive chronology from it, then finalize one known
  release and complete relationship evidence without guessing author order.
* Dependencies: P01 conservation and compatibility contracts.

<!-- rpi:task id=P02-T01 -->
#### [x] P02-T01: Assemble three exclusion-aware packet candidates

* Requirement and evidence: Exact source positions and issue references come from the committed source
  snapshot and the approved 31-row ledger.
* Expected result: Three candidate packet records with 58 retained rows, 31 structured exclusions,
  non-complete manifests, and exact digests, ready for endpoint resolution without claiming final
  release authority.
* Detail section: P02-T01 in .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md

<!-- rpi:task id=P02-T02 -->
#### [x] P02-T02: Resolve 58 exact retained rows and derive author chronology

* Requirement and evidence: No omitted row receives a fabricated identity and no retained row may be
  missing or ambiguous.
* Expected result: Exact resolution evidence preserving original source positions and configured
  metadata for 7, 40, and 11 retained rows, plus evidence-derived first-on-sale author order.
* Detail section: P02-T02 in .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md

<!-- rpi:task id=P02-T03 -->
#### [x] P02-T03: Finalize release authority, reports, and narrow decisions

* Requirement and evidence: Final release authority must use the known source order and the exact
  chronology from P02-T02 before reports or approval run.
* Expected result: One known B04 release, exact inventory transitions, three canonical packet and
  mapping additions, three report additions, complete comparison sets, exact release-scoped
  relationship decisions, and stale-evidence rejection.
* Detail section: P02-T03 in .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md

<!-- rpi:phase id=P03 -->
### [x] P03: Author and integrate three truthful guides

* Intent: Publish three non-complete guides with explicit scope disclosure and exact retained issues.
* Dependencies: P02 approved current evidence.

<!-- rpi:task id=P03-T01 -->
#### [x] P03-T01: Author exclusion-aware checklists and catalog definitions

* Requirement and evidence: Readers must be told what was omitted and where the full external order
  remains available.
* Expected result: Exactly three checklist additions and three canonical manifest entries using
  essential or selected depth, 58 issue links, and bounded disclosure.
* Detail section: P03-T01 in .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md

<!-- rpi:task id=P03-T02 -->
#### [x] P03-T02: Vendor payloads and regenerate catalog state

* Requirement and evidence: Generated data must contain only exact retained metadata and no placeholder
  or omitted issue.
* Expected result: Exactly three payload additions, three generated catalog entries, 58 exact items,
  and chronology-aware shelf placement before Maximum Security.
* Detail section: P03-T02 in .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md

<!-- rpi:task id=P03-T03 -->
#### [x] P03-T03: Reconcile direct delivery and provenance records

* Requirement and evidence: Maintainers and readers need the bounded curation rationale, exact counts,
  corrected Wraith number, and unchanged next cursor.
* Expected result: Changelog, backlog, provenance, and applicable maintenance records agree with the
  final catalog and preserve the supplemental source as future evidence only.
* Detail section: P03-T03 in .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md

<!-- rpi:phase id=P04 -->
### [x] P04: Prove the final implementation

* Intent: Demonstrate the conservation guard fails without the fix and that the complete tree passes.
* Dependencies: P03 final product state.

<!-- rpi:task id=P04-T01 -->
#### [x] P04-T01: Add focused semantic and regression coverage

* Requirement and evidence: Tests must own the 31-row ledger, 58-row mapping, release authority,
  reports, depth, disclosure, compatibility, and all rejection paths.
* Expected result: Targeted tests fail under one precise reversible conservation mutation and pass
  after restoration.
* Detail section: P04-T01 in .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md

<!-- rpi:task id=P04-T02 -->
#### [x] P04-T02: Run repository, contract, and browser gates

* Requirement and evidence: The repository requires lint, bare tests, anchors, and real Edge, with
  direct records requiring their own count, size, palette, publication, and contract checks.
* Expected result: All local gates pass on the final reconciled tree, including 1280x900 Edge coverage
  for all three cards and one exact retained sequence per guide.
* Detail section: P04-T02 in .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md

<!-- rpi:phase id=P05 -->
### [ ] P05: Review and prepare the merge-ready pull request

* Intent: Run the sole implementation Review, route its outcome, and publish only a clean candidate.
* Dependencies: P04 complete validation.

<!-- rpi:task id=P05-T01 -->
#### [x] P05-T01: Run exactly one post-implementation Review

* Requirement and evidence: Review must assess source conservation, recovery and failure paths,
  generated evidence, reader copy, regressions, and delivery readiness.
* Expected result: One canonical Review records findings, fixes material in-scope defects once, and
  routes unrelated work without a review loop.
* Detail section: P05-T01 in .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md

<!-- rpi:task id=P05-T02 -->
#### [ ] P05-T02: Commit, open the pull request, and assess hosted readiness

* Requirement and evidence: The pull request must lead with plain English, record validation numbers,
  and preserve the required commit trailer.
* Expected result: One commit and non-draft pull request with hosted Node and lint jobs assessed for
  merge readiness; no merge is performed unless the repository state and permissions permit it.
* Detail section: P05-T02 in .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md

## Dependencies

* Exact configured metadata for all 58 retained rows is required before final release authority,
  reports, approval, or authoring.
* Final relationship decisions depend on reports generated from the final current catalog and all
  three peer mappings.
* Authoring depends on conservation, freshness, mapping, report, and approval gates.

## Critique Disposition

| Critique run and finding | Disposition | Plan response or residual risk |
|---|---|---|
| Sole critique, PC-001 | Resolved | P02-T02 now derives chronology before P02-T03 finalizes release authority; reports, approval, and authoring depend on that final authority |
| Sole critique, PC-002 | Resolved | P01-T02 preserves the B03 nonselected constant and filter unchanged, adds an exact normalized B03 outcome invariant, and adds a separate B04 untouched invariant |
| Sole critique, PC-003 | Resolved | The locked target inventory now names both propagation scripts, both test owners, exact direct records, and continuation resolution evidence |

## Follow-Up Items

* The supplemental essential-trades coverage candidates remain future evidence because this batch is
  limited to three previously blocked guides.
* The Evolutionary War remains the next source-order cursor at position 17 after this batch.

## Handoff

* Implementation artifact: .copilot-tracking/changes/2026-08-24/licensed-character-issues-changes.md
* Ready phase or task: P05-T02
* Remaining provisional question or blocker: None
