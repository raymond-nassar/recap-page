<!-- markdownlint-disable-file -->
# RPI Changes: Character spotlight guides

## Metadata

* Task ID: MRT-002-C01
* Related plan: .copilot-tracking/plans/2026-08-23/character-spotlight-guides-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md
* Implementation date: 2026-08-23

## Execution Status

* Status: Complete
* Declared invocation scope: full plan
* Completed scope markers: P01, P01-T01, P01-T02, P02, P02-T01, P02-T02, P03, P03-T01, P03-T02
* All remaining active-plan markers: none
* Status basis: the complete guide, records, repository gates, live contract, and Edge evidence pass.

## Execution Summary

The approved implementation publishes only the evidence-approved White Tiger pilot. It adds one
maintained 128-identity character inventory, freezes and resolves the complete 82-row guide, binds
four centrally approved partial relationships to the 86-list pre-publication catalog, and publishes
the result through the existing Character spotlights surface.

## Completed Work

### P01: Guard the character inventory and packet

* P01-T01 adds a validated 128-identity inventory without changing the fixed 86-record modern
  baseline. It preserves 118 deferred, seven excluded, two blocked, and one shipped disposition.
* P01-T02 freezes all 82 White Tiger rows and resolves them with zero unmatched or ambiguous
  identities. The source's 2021 Community label and Marvel metadata's 2022 identity remain explicit.

### P02: Approve and publish the reading

* P02-T01 compares the candidate with all 86 pre-publication lists. The report contains four partial
  relationships, 82 none relationships, and no exact or subset relationship. Central approval binds
  the packet, mapping, report, library, and manifest digests.
* P02-T02 authors one complete ungrouped `character-run`, places it before `xmen-claremont`, vendors
  all 82 issues with complete digital IDs and covers, and advances only White Tiger to shipped.

### P03-T01: Add bounded semantic and regression coverage

* The focused semantic test was observed failing before the character inventory existed.
* The final targeted command passes 156 tests covering the maintained inventory, packet freshness,
  approved relationships, catalog placement, generated sequence, existing guarded packets, and the
  87-list licence boundary.

## Implementation-Time Plan and Detail Updates

### Keep inventory lifecycle aligned with publication order

* Affected plan area or markers: P01-T01, P02-T02
* What changed: P01-T01 expects White Tiger to be ready, while P02-T02 owns its transition to shipped.
* Why: marking the candidate shipped before its manifest and generated payload exist would make the
  maintained inventory false during implementation.
* Triggering evidence: the approved task order creates and validates the inventory before authoring.
* User answer or decision: none; this preserves the approved single-pilot lifecycle.
* Reconciliation performed: the P01-T01 detail and P02 publication boundary now agree.
* Planning and critique state: implementation ready; no new decision and no second critique.

### Reconcile the committed parent foundation

* Affected plan area or markers: Dependencies, P01
* What changed: the dependency-ready parent foundation commit is incorporated before candidate work.
* Why: this branch preserves the recovered child checkpoint but does not yet contain the parent
  implementation that the approved plan names as existing contracts.
* Triggering evidence: parent coordinator confirmed commit fa58ffa3b60ad2e74218b208ef3db22de1386002
  and that it adds no candidate or catalog-count transition.
* User answer or decision: none; this applies the approved inherited dependency.
* Reconciliation performed: the full-plan scope and first active marker remain unchanged.
* Planning and critique state: implementation ready; PC-001 remains applied.

## Validation Record

| Check | Scope | Status | Evidence or reason |
|---|---|---|---|
| Parent foundation ancestry | dependency | Passed | The confirmed commit exists and is not yet an ancestor of the recovered branch. |
| Focused test before implementation | P03-T01 | Failed as intended | Both cases failed because the maintained character inventory did not exist. |
| First vendoring pass | P02-T02 | Failed | Three issue lookups returned fetch failures; no generated payload was written and the outcomes were retained as non-evidence. |
| Bounded vendoring retry | P02-T02 | Passed | All 82 issues resolved with zero placeholders, missing digital ids, or missing covers. |
| Targeted feature and regression tests | P01-P03 | Failed | 155 of 156 passed. The historical packet test asserted that no later catalog addition may overlap its issues, which conflicts with the centrally approved White Tiger to Axis partial relationship. |
| Targeted feature and regression tests after correction | P01-P03 | Passed | 156 of 156 passed. The historical test retains its original identity, sequence, and pre-publication report guarantees without overruling a later centrally approved relationship. |
| Repository lint | P03-T02 | Passed | ESLint reported zero errors after correcting one indentation defect. |
| Backlog counts | P03-T02 | Passed | 175 ranked rows, 180 detail blocks, 152 shipped, and every derived figure agrees. |
| Full Edge regression | P03-T02 | Passed | 126 assertions passed across 14 scenarios at an explicit browser viewport. |
| White Tiger Edge check | P03-T02 | Passed | At 1280 by 900, White Tiger appears once on Character spotlights and nowhere on Timeline or Storylines. The card credits the exact source, reports 82 issues, and the reading shows Avengers Academy #21, Captain America and the Mighty Avengers #7 at row 41, and Marvel's Voices: Community #1 at row 82. |
| First live contract check | P03-T02 | Failed | The configured metadata endpoint timed out and the bounded check aborted. No response was treated as evidence. |
| Bounded live contract retry | P03-T02 | Passed | All 33 assumptions held across 17 requests. |
| Full repository tests | P03-T02 | Passed | 1,384 tests passed with zero failures. |
| Size gate | P03-T02 | Passed | All seven stated file sizes agree. |
| Palette gate | P03-T02 | Passed | 88 theme pairs measured, five recorded below the floor, and zero new regressions. |
| Evidence anchors | P03-T02 | Passed | 1,086 anchors are unchanged with zero drifted, new, or removed citations after the reviewed bless cycle. |
| Publication gate | P03-T02 | Passed | The local feature history was collapsed so recovery provenance remains in the final artifacts without publishing private project-session identifiers; the reachable committed history reports zero content findings. |
| Review-fix focused tests | RV-001 and RV-004 | Passed | 21 focused character, modern-inventory, preparation, authoring, resolver, and overlap tests passed. |
| Review-fix failure proof | RV-001 | Failed as intended | Restoring the old full-library digest behavior produced the 87-list digest and failed the focused assertion against the independently reconstructed 86-list digest. Restoring the fix returned the test to green. |
| Final repository lint | release | Passed | ESLint reported zero errors. |
| Final full repository tests | release | Passed | 1,385 tests passed with zero failures. |
| Final backlog counts | release | Passed | 175 ranked rows, 180 detail blocks, and 152 shipped items agree. |
| Final size gate | release | Passed | All seven stated file sizes agree. |
| Final palette gate | release | Passed | 88 pairs were measured, five known low-contrast pairs remain recorded, and there are zero new regressions. |
| Final evidence anchors | release | Passed | 1,086 anchors are unchanged with zero drifted, new, or removed citations. |
| Final Edge regression | release | Passed | 126 assertions passed across 14 scenarios. |
| Final live contract | release | Passed | All 33 assumptions held across 17 requests. |
| Unpublished surface scan | release | Passed | After pruning stale refs, the five branches advertised by the remote contained zero publication findings across 2,977 blobs and 370 commit messages. |
| Added-line dash scan | release | Passed | Zero en dashes or em dashes remain in added lines. |
| First hosted Node 20 job | release | Failed | The new inventory-count test used `Object.groupBy`, which is unavailable on the declared Node 20 floor. The product code and the other 1,384 tests passed. |
| Hosted Node 20 compatibility correction | release | Implemented | The test now derives the four counts with `Array.prototype.reduce`, which is supported on every declared engine. Node 24 and the hosted lint job had already passed. |

## Pre-Review Reconciliation

* Plan markers and phase details: P01 through P03 complete.
* Completed-work evidence and handoff prose: guide, inventory, packet, approval, publication, and
  semantic coverage are current.
* Validation, blockers, remaining work, and follow-up items: all implementation validation is complete.
* Review readiness: ready for the one independent Review.

## Review Finding Resolution

| Finding | Status | Implementation evidence |
|---|---|---|
| RV-001 | Resolved | Candidate and packet peers are excluded from both comparisons and the library digest. The White Tiger report, central approval, and authoring freshness check now agree on the independently reconstructed 86-list digest. The focused regression failed against the prior full-library behavior and passed after restoration. |
| RV-002 | Resolved | The external boundary artifact fell from 756,870 to 135,053 bytes by replacing copied issue-bearing prose with one aggregate digest per source while retaining 128 URLs, source metadata, page headings, counts, raw-content hashes, and horizon facts. |
| RV-003 | Resolved | Final plan markers, Review disposition, changes evidence, state, and anchors are reconciled in the release commit. |
| RV-004 | Resolved | Character records now require the full source-boundary and metadata-horizon schema, exact disposition-state agreement, and exact 128-record cardinality. The modern 86-record validator remains the maintained default for the modern inventory. Negative tests cover missing evidence, omission, duplication, and cross-inventory ambiguity. |
| RV-005 | Resolved | The remaining live provenance statement now agrees with the 73 of 87 current catalog count. |

The single Review remains complete with defects found and routed. These resolutions do not trigger a
second Review.

## Blockers

* None.

## Remaining Work

* None inside the approved implementation scope.

## Follow-Up Items

* Canonical plan list: .copilot-tracking/plans/2026-08-23/character-spotlight-guides-plan.md, `## Follow-Up Items`
* Another deferred guide remains a distinct later task.

## Return-to-Caller State

* Implementation execution status: Complete
* Declared scope and markers: full plan; P01 through P03 complete.
* Validation coverage: focused failure proof, 156 targeted tests, 1,384 full tests, all seven
  deterministic gates, 33 live contract assumptions, 126 browser assertions, and the focused Edge check.
* Blockers: none.
* Current plan and detail updates: completed markers and phase statuses are reconciled.
* Planning and critique state: ready; PC-001 applied.
* Follow-up items: another guide remains outside scope.
* Review readiness or no-handoff reason: the one independent Review is complete and all five routed findings are resolved.
* Continuation owner: automatic RPI parent.

## Release Handoff

* Pull request: #171
* Initial release commit: 68d26a3d92cbd1db2c524ba441eb4c2491fcfa93
* Required hosted checks: Node 20 and Node 24
* Release status: open and awaiting required hosted checks
