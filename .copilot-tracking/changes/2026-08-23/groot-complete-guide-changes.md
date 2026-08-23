<!-- markdownlint-disable-file -->
# RPI Changes: Groot complete guide

## Metadata

* Task ID: MRT-002-C07
* Related plan: .copilot-tracking/plans/2026-08-23/groot-complete-guide-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/groot-complete-guide-phase-details.md
* Implementation date: 2026-08-23

## Execution Status

* Status: Complete
* Declared invocation scope: full plan
* Completed scope markers: P01, P01-T01, P01-T02, P02, P02-T01, P02-T02, P03, P03-T01,
  P03-T02, P04, P04-T01, P04-T02
* All remaining active-plan markers: None
* Status basis: Product implementation, current-main reconciliation, one Review, local validation, pull
  request delivery, and required hosted CI are complete. Pull request 176 is the durable merge record.

## Execution Summary

Implementation is active. P01-T01 froze the independently reproduced 76-issue Groot source boundary
and its stable issue-bearing digest. P01-T02 resolved and centrally approved all 76 exact metadata rows.
P02 regenerated and approved complete-library and Rocket-peer relationships, then authored and vendored
one separate Groot guide. P03 added permanent semantic and filter proof, demonstrated that the new tests
fail without the implementation, aligned every directly affected record, and passed all local release
gates. P04-T01 completed the one independent Review and routed RV-001 here without a review loop. P04-T02
delivered the release through pull request 176 after all required hosted jobs passed.

## Completed Work

### Frozen Groot source packet

* Related phase or task: P01-T01
* Files: scripts/data/cbh-packets/groot-reading-order.json, scripts/lib/cbh-inventory.mjs,
  scripts/data/cbh-character-inventory.json
* What changed and why: Added the exact 76-row packet, optional validated issue-bearing source digest, and
  Groot's approved release lifecycle so preparation can consume the packet without an invented intermediate
  character state.
* Completion evidence: Packet digest
  `1afbf2aa42c43cae2d69f726d27085aa335883f4512349ccde96c2afc40dbf88`; 76 unique source identities in the
  accepted first-source order; exact digest
  `2f73854ba172a902a511cb2ae45ee4236bf81367166126667370c482c26478e3`.
* Validation: Packet validator and independent exact-sequence assertion passed.

### Exact Groot metadata mapping

* Related phase or task: P01-T02
* Files: scripts/data/cbh-mappings/groot-reading-order.json
* What changed and why: Resolved every frozen source row through its explicitly selected maintained metadata
  series and centrally approved the exact sequence.
* Completion evidence: Mapping digest
  `ddaab7843590232ef978564b1e613f53159aaffbbb1efe2042d499d17849a2b5`; 76 exact rows, 76 unique selected
  issue IDs, zero unmatched, zero ambiguous, and zero exceptions.
* Validation: Live preparation and exact 76-ID assertion passed.

### Complete-library and Rocket-peer approval

* Related phase or task: P02-T01
* Files: scripts/data/cbh-overlaps/groot-reading-order.json,
  scripts/data/cbh-mappings/groot-reading-order.json
* What changed and why: Compared Groot once against every current reading, carrying Rocket as the sole named
  peer, and centrally approved every factual result.
* Completion evidence: 95 comparisons and 95 dispositions; partials are Annihilation: Conquest 4, Rocket
  Raccoon 41, and War of Kings 7; report digest
  `7272ffb7a893e64b2643749d235cd33261e0c9e1e3860f7ebbaa60fa8431b575`; approval digest
  `5c66e404b3db83e9b222c3ce351a199401f4e6ebf457a9f993699cd8a6e221b7`; current-library digest
  `8b0b2826b312a913ee631c170f41b6ffebf659a73d2f2651f5ab61d55e293602`.
* Validation: Fresh report equality and approval validation passed; a stale Rocket peer mapping failed.

### Separate Groot authoring and vendoring

* Related phase or task: P02-T02
* Files: scripts/author-cbh-packet.mjs, src/data/orders/groot-reading-order.md,
  src/data/curated-lists.json, src/data/groot_reading_order.json, src/data/catalog.json
* What changed and why: Added an explicit external shipped-peer authoring option, authored only Groot,
  retained Rocket, and vendored all 76 exact issues.
* Completion evidence: Authoring reported one guide, 76 rows, and 96 manifest entries. Vendoring reported 76
  issues, zero unresolved, zero placeholders, zero missing digital IDs, and zero missing covers.
* Validation: Order, mapping, payload, manifest, and catalog sequences agree; Rocket production evidence files
  have no diff and its manifest entry is unchanged.

### Semantic, freshness, peer, and filter proof

* Related phase or task: P03-T01
* Files: test/cbh-batch.test.js, test/cbh-character-spotlight.test.js,
  test/catalog-shelves.test.js
* What changed and why: Added reusable external-peer authoring coverage plus Groot-specific source, sequence,
  relationship, stale-evidence, surface equality, taxonomy, and filter assertions.
* Completion evidence: The focused suite passes 39 tests. With only production implementation files stashed,
  it failed seven checks, including missing peer authoring, stale counts, missing packet evidence, and absent
  catalog classification; the stash restored cleanly and the same suite returned to 39 passing tests.
* Validation: 39 passed, zero failed on the final implementation; no-fix proof exited 1 as required.

### Product records and complete local release gates

* Related phase or task: P03-T02
* Files: CHANGELOG.md, PRODUCT_BACKLOG.md, GOVERNANCE.md, docs/DATA_PROVENANCE.md,
  docs/MAINTAINING.md, docs/PUBLICATION_RUNBOOK.md, docs/UX_STUDY.md,
  docs/anchors.lock.json, and directly affected tests
* What changed and why: Recorded the rank 9 separate-release decision, 76-issue boundary, 41-issue Rocket
  partial, current taxonomy and catalog totals, provenance, shipped-peer maintenance contract, publication
  surface, and measured browser outcome.
* Completion evidence: 1,414 full-suite tests pass. The catalog contains 96 readings; Character Spotlight
  contains 13 readings across 12 stories, five Best of stories, four Complete guides, and four All-only
  readings. Groot appears under All and Complete and not Best of.
* Validation: lint zero; counts 181 ranked rows and 186 detail blocks with no disagreement or duplicate;
  sizes 7 of 7; palette 88 measured, 5 recorded below the floor, 0 new; publication and publication-surface
  gates 0 findings across 8 advertised branches; anchors 1,177 unchanged with 0 drifted, new, or removed;
  live contract 33 of 33; installed Edge 158 broad assertions plus 8 release-specific assertions at
  1280 by 900 and 390 by 844; diff check clean; added-line dash scan zero.

### Review finding routing and durable handoff reconciliation

* Related phase or task: P04-T01 and RV-001
* Files: .copilot-tracking/reviews/logs/2026-08-23/groot-complete-guide-review.md and this changes record
* What changed and why: The one independent Review found no product defect and one medium record defect:
  the opening and handoff summaries still described the earlier P01 state despite complete P03 evidence.
* Completion evidence: RV-001 is resolved by reconciling Execution Status, review reconciliation, Remaining
  Work, and Return-to-Caller State to the current P04-T02 delivery boundary.
* Validation: No second Review was run, as required. The reviewed implementation remains unchanged.

### Current-main evidence reconciliation

* Related phase or task: P04-T02
* Files: Groot mapping and overlap evidence, generated catalog and payload, affected records and tests
* What changed and why: Rebased the release onto current main after merged PR #175 added five historical
  event guides, assigned Groot the next free backlog identity, and regenerated every library-dependent
  relationship and generated surface rather than carrying forward stale 90-list evidence.
* Completion evidence: The source packet and exact 76-row mapping independently revalidated with their
  original stable digests. The fresh report contains 95 comparisons and the central approval contains 95
  dispositions. Groot remains a separate 76-issue guide in the 96-list catalog, with Rocket retained as the
  named 41-issue partial peer.
* Validation: Live metadata preparation returned 76 exact rows with zero unmatched and zero ambiguous;
  fresh authoring returned one guide and 76 rows. The full 1,414-test suite, lint, counts, sizes, palette,
  both publication gates, anchors, live contract, broad browser suite, exact release browser checks, diff
  check, and added-line dash scan all pass on the reconciled tree.

### Pull request, hosted CI, and merge delivery

* Related phase or task: P04-T02
* What changed and why: Published the complete reconciled change through pull request 176 after refreshing
  current main immediately before release.
* Completion evidence: Implementation commit `90ff0fd`; hosted run `32672432924`; Tests on Node 20, Tests
  on Node 24, and Lint all passed. Pull request 176 is the durable merged-result identity.
* Validation: The required three hosted job conclusions were read individually rather than inferred from
  the run-level conclusion.

## Implementation-Time Plan and Detail Updates

### Final critique corrections

* Affected plan area or markers: P01-T01, P02-T02, P03-T01, and P04-T02
* What changed: Source freshness now rejects a self-consistent replacement boundary; external shipped-peer
  authoring is mandatory and owned by the core authoring tests; reconciliation regenerates relationship
  evidence when library membership changes.
* Why: The single final-candidate critique identified two direct planner-owned gaps.
* Triggering evidence: PC-001 and PC-002 in the plan critique.
* User answer or decision: None required; existing user decisions resolve both findings.
* Reconciliation performed: Plan requirements, locked targets, task details, critique disposition, readiness,
  and handoff are current.
* Planning and critique state: Ready; PC-001 and PC-002 applied without another critique.

## Validation Record

| Check | Scope | Status | Evidence or reason |
|---|---|---|---|
| Planning gate | Full plan | Passed | One critique completed; both findings resolved; no blockers |
| Frozen packet | P01-T01 | Passed | 76 exact unique rows and accepted issue-bearing digest |
| Metadata preparation | P01-T02 | Passed | 76 exact, 0 unmatched, 0 ambiguous; exact ID sequence matched |
| Relationship approval | P02-T01 | Passed | 95 comparisons and dispositions; only partials 4, 41, and 7 |
| Authoring and vendoring | P02-T02 | Passed | 1 guide, 76 rows, 96 entries; Rocket unchanged |
| Focused semantic tests | P03-T01 | Passed | 39 passed, 0 failed |
| No-fix proof | P03-T01 | Passed | Production-only stash caused 7 failures; restore returned 39 passes |
| Full test suite | P03-T02 | Passed | 1,414 passed, 0 failed |
| Counts, sizes, and palette | P03-T02 | Passed | 181 rows; 186 blocks; 7 sizes; 88 palette pairs; 0 new contrast findings |
| Publication gates | P03-T02 | Passed | Reachable history and 8 advertised branches; 0 findings |
| Evidence anchors | P03-T02 | Passed | 1,177 unchanged; 0 drifted, 0 new, 0 removed |
| Live metadata contract | P03-T02 | Passed | 33 of 33 assumptions; 17 requests |
| Installed Edge | P03-T02 | Passed | 158 broad assertions; 8 release-specific assertions at 1280 by 900 and 390 by 844 |
| Diff and dash checks | P03-T02 | Passed | No whitespace errors; 0 dash-bearing added lines |
| One independent Review | P04-T01 | Defects found | No product defect; RV-001 medium stale handoff summary routed once |
| RV-001 implementation | P04-T01 | Passed | Four durable state sections reconciled; no second Review |
| Hosted CI | P04-T02 | Passed | Node 20, Node 24, and Lint passed in run 32672432924 |
| Pull request delivery | P04-T02 | Passed | Pull request 176 is the durable merge record |

## Review Reconciliation

* Plan markers and phase details: P01, P02, P03, and P04 complete.
* Completed-work evidence and handoff prose: Current through pull request delivery and hosted CI.
* Validation, blockers, remaining work, and follow-up items: All planned work is complete; no blocker or
  follow-up remains.
* Review result: Execution Complete, outcome Defects found; RV-001 was the sole finding and is resolved
  without another Review.

## Blockers

* None.

## Remaining Work

* None.

## Follow-Up Items

* Canonical plan list: .copilot-tracking/plans/2026-08-23/groot-complete-guide-plan.md,
  `## Follow-Up Items`
* None.

## Return-to-Caller State

* Implementation execution status: Complete
* Declared scope and markers: Full plan; P01 through P04 complete.
* Validation coverage: Full local suite and gates, no-fix proof, live contract, two Edge viewports, and one
  independent Review.
* Blockers: None.
* Current plan and detail updates: PC-001, PC-002, and RV-001 applied; pull request and hosted CI identities
  are persisted.
* Planning and critique state: Ready; one critique and one Review complete.
* Follow-up items: None.
* Review readiness or no-handoff reason: Review complete; P04-T02 delivery is active.
* Continuation owner: Automatic RPI parent.
