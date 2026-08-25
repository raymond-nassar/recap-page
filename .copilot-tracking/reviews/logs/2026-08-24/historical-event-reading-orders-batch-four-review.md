<!-- markdownlint-disable-file -->
# Review: Historical event reading orders batch four

## Scope and Evidence

* Task ID: MRT-003-C02-B05
* Review date: 2026-08-25
* Review scope: Full task
* Assessed boundary: Canonical MRT-003-C02 continuation state; source positions 17 through 22; four
  selected complete guides; the whole-guide Acts of Vengeance blocker; source, mapping,
  relationship, authoring, compatibility, reader output, validation, and delivery readiness.
* Plan: .copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-four-plan.md
* Phase details: .copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-24/historical-event-reading-orders-batch-four-plan-critique.md
* Changes: .copilot-tracking/changes/2026-08-24/historical-event-reading-orders-batch-four-changes.md
* Other evidence considered: Canonical research, scan, resolution, packets, mappings, reports,
  checklists, payloads, product records, semantic tests, gate results, and focused installed-Edge
  browser evidence.

## Opening Review State

* Interpreted review goal: Assess the completed deterministic B05 implementation exactly once for
  source conservation, metadata accuracy, compatibility, reader-facing accuracy, validation, and
  readiness for PR delivery through Agent Merge.
* Review scope: Full task.
* Evidence readiness: Research, plan, phase details, sole critique, changes record, generated
  evidence, product output, and complete pre-Review validation were available and reconciled.
* Acceptance basis: User direction, canonical program constraints, plan acceptance criteria,
  resolved PC-001 through PC-003 dispositions, and P01 through P04 completion evidence.
* First comparison boundary: Requirements and six source outcomes against the canonical resolution,
  inventory transition, generated artifacts, product absence or presence, and semantic tests.
* Active read-only boundaries: Review inspected all supplied evidence and wrote only this canonical
  review record.
* Initial blockers: None.

## Execution Status

* Execution status: Complete
* Review execution evidence: One post-implementation Review completed on 2026-08-25 against the full
  uncommitted task boundary. No second Review is planned or required after the routed correction.

## Plan-to-Change Reconciliation

| Current plan scope | Descriptive changes-record summary | Current-state reconciliation | Gap or rationale |
|---|---|---|---|
| P01 | B05 release and six-record inventory authority | Reconciled | Four selected outcomes, exact Acts blocker, cleared Days blocker, next cursor, and predecessor projections are bound |
| P02 | Packets, mappings, reports, and approval | Reconciled | 71 exact rows and 480 all-none comparisons retain source and review identity |
| P03 | Four guides and direct records | Partial | Product output is exact, but current inventory counts in the provenance record were not rederived; RV-001 |
| P04 | Mutation proof and complete validation | Reconciled | Named red-green proof, all repository gates, live contract, and browser checks are recorded |
| P05 | Review and delivery | In progress | This sole Review is complete; RV-001 correction and PR delivery remain |

## Completed Work Assessment

| Related marker | Files | What changed and why | Completion evidence | Validation | Assessment |
|---|---|---|---|---|---|
| P01 | scripts/lib/cbro-evidence.mjs; scripts/data/cbro-historical-inventory.json; canonical resolution | Bound the atomic B05 transition without weakening older releases | Six exact outcomes; all 70 Acts rows; only rows 63 and 64 unresolved; issue 12360 clears Days | Focused authority and full suite passed | Reconciled |
| P02 | Four packets, mappings, and overlap reports | Preserved all selected source rows and approved only current all-none relationships | 11, 39, 17, and 4 exact rows; 120 comparisons per guide | Historical suite and stale-evidence rejection passed | Reconciled |
| P03 | Four checklists, payloads, manifest, catalog, and product records | Published complete reader output and retained blocked/deferred boundaries | 121 catalog cards; 71 unique exact issues; no Acts or X-Tinction product artifact | Semantic, licensing, category, and browser checks passed | Product output reconciled; record-count defect RV-001 |
| P04 | Tests, anchor lock, validation record, focused browser check | Proved authority failure and final reader behavior | Named failure restored green; four previews and exact rendered sequences | All planned checks passed | Reconciled |

## Implementation-Time Plan and Detail Update Assessment

| Affected area or marker | What changed and why | Triggering evidence and user decision | Reconciliation performed | Planning and critique state | Assessment |
|---|---|---|---|---|---|
| P01 through P03 | Current source retrieval moved to 2026-08-25 while the stable task artifact date remained 2026-08-24 | Live source and metadata work crossed UTC midnight; no scope or product decision changed | Exact timestamps and digests persisted in current research; plan and changes retained stable lineage | No new planning or critique required | Reconciled |
| P03-T03 | Compatibility tests now reconstruct frozen pre-B05 libraries while current tests use 121 lists | Four new lists correctly changed current-library digests and category populations | Historical baselines exclude B05 IDs; current licensing, catalog, and publishing counts were updated | Preserves approved intent | Reconciled |
| P03-T03 | Provenance release paragraph was added without rederiving all current inventory figures in the same document | Final catalog contains a larger current population than the existing Inventory and sourcing paragraphs state | Not reconciled before Review | Ordinary in-scope correction; no plan decision required | RV-001 |

## Critique and Material Revision Assessment

* Latest critique dispositions: PC-001 through PC-003 were applied. Acts row conservation, the
  complete-known-release contract, and post-edit revalidation are explicit in current evidence.
* Material revisions: None. The four-guide batch, whole Acts blocker, cleared Days blocker, and
  position-22 cursor preserve the approved selection and user direction.
* Dependent-work pause assessment: No decision-critical discovery required a pause or fresh user
  decision.
* Justification assessment: Source timestamp rollover and frozen-library projections are supported
  current-state updates rather than divergent scope.

## Plan Follow-Up Assessment

| Follow-up item | Why outside immediate scope | Owner or next action | Assessment and route |
|---|---|---|---|
| Acts of Vengeance metadata re-entry | Two exact configured-series gaps block the whole 70-row guide | Future MRT-003-C02 continuation after issue-level evidence exists | Open distinct follow-up; not a defect |
| X-Tinction Agenda | Position 22 is the next source-order cursor beyond this PR-sized batch | Next deterministic historical-event batch | Open distinct follow-up |
| Supplemental essential trades | Research-only backlog was explicitly excluded from historical-event execution | Future sourcing work under its own task | Open distinct follow-up |

Unresolved plan follow-up items remain distinct follow-up work. They are not active defects,
completion requirements, or acceptance scope for this batch.

## Findings

<!-- rpi:review id=RV-001 -->
### RV-001 [Medium]: Current provenance inventory figures were not reconciled

* Related scope: P03-T03
* Evidence: docs/DATA_PROVENANCE.md and the current src/data/ payload population
* Impact: The maintained provenance record says there are 114 pinned payloads containing 4,425
  records over 3,628 distinct issues, with 4,356 covers and 4,272 creator-credit records. The final
  tree contains 121 payloads, 4,554 records, 3,733 distinct issues, 4,485 covers, and 4,399
  creator-credit records. Its checklist and source-credit paragraphs likewise state 115 checklists,
  99 generated checklists, and 21 Comic Book Reading Orders guides instead of 119, 103, and 25.
  These are current maintainer-facing claims in a document this change edits, so leaving them stale
  contradicts the task's product-record accuracy requirement.
* Destination: rpi-implement
* Smallest useful next action: Update every current inventory, checklist, license-null, externally
  selected, and Comic Book Reading Orders total in the provenance record from the final tree, then
  rerun affected document, count, test, and anchor gates. Do not run another Review.

## Defects

* RV-001 routes to rpi-implement.

## Routed Findings

| Finding | Destination | Owner or next action | Reason for route |
|---|---|---|---|
| RV-001 | rpi-implement | Automatic RPI parent updates current provenance counts and reruns affected gates | In-scope record-accuracy defect with deterministic values |

Later implementation of RV-001 does not require another Review.

## Residual Work

* Acts of Vengeance, X-Tinction Agenda, and supplemental essential-trades work remain the three
  distinct plan follow-ups above.

## Blockers and Remaining Work

* Blockers: RV-001 blocks delivery readiness until the deterministic record correction and affected
  validation complete.
* Remaining active work: Implement RV-001, reconcile P05 markers and changes evidence, commit, open
  the PR, and invoke Agent Merge.

## Validation Evidence

| Command | Scope | Status | Summary |
|---|---|---|---|
| Focused historical suite | B05 authority, evidence, reports, and authoring | Passed | 37 passed, zero failed |
| Reversible named mutation | B05 inventory authority | Passed | Zero pass and one fail without transition; one pass and zero fail after restoration |
| npm run lint | Repository | Passed | Zero findings |
| npm test | Repository | Passed | 1,454 passed, zero failed |
| npm run counts | Product records | Passed | 191 ranked rows, five parked, 196 detail blocks; all gated figures agree |
| npm run sizes | Stated file sizes | Passed | Six of six agree |
| npm run palette | Theme pairs | Passed | 90 measured, five recorded below the floor, zero new |
| npm run publication | Reachable history | Passed | 3,980 blobs scanned, zero findings |
| npm run anchors | Evidence corpus | Passed | 1,186 unchanged, zero drifted, zero new, zero removed |
| npm run contract | Live metadata API | Passed | 33 of 33 assumptions across 17 requests |
| npm run browser | General installed Edge | Passed | 186 assertions, zero failed, 19 scenarios |
| Focused installed Edge | Four real catalog guides at 1280 by 900 | Passed | Four cards, source links, previews, imports, 71 exact rendered rows, and no overflow |
| Added-line diff scan | Final pre-Review diff | Passed | Zero en or em dashes; four citation suspects inspected as valid code or prose |
| Direct provenance derivation | Current manifest and payload population | Failed | Current figures disagree with docs/DATA_PROVENANCE.md; RV-001 |

## Outcome

* Outcome: Defects found
* Outcome rationale: Source conservation, metadata, compatibility, product output, and runtime
  behavior conform, but one deterministic in-scope provenance-record defect remains before PR
  delivery.

## Closeout Routing Record

| Finding class | Destination | Owner or next action |
|---|---|---|
| Implementation defect | rpi-implement | Correct RV-001 and rerun affected gates without another Review |
| Decision gap or invalid assumption | None | No action |
| Material evidence gap | None | No action |
| Non-blocking residual work | Distinct follow-ups | Preserve Acts, X-Tinction, and supplemental sourcing boundaries |

* Execution status: Complete
* Outcome: Defects found
* Validation coverage: Complete planned pre-Review suite plus direct final-tree provenance
  derivation.
* Blockers: RV-001 blocks delivery readiness.

| Artifact | Description |
|---|---|
| [.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-four-research.md](.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-four-research.md) | Canonical source, selection, blocker, and merge-direction research |
| [.copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-four-plan.md](.copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-four-plan.md) | Approved full-task plan and markers |
| [.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md](.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md) | Phase and task execution contract |
| [.copilot-tracking/reviews/plans/2026-08-24/historical-event-reading-orders-batch-four-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-24/historical-event-reading-orders-batch-four-plan-critique.md) | Sole final-candidate critique and dispositions |
| [.copilot-tracking/changes/2026-08-24/historical-event-reading-orders-batch-four-changes.md](.copilot-tracking/changes/2026-08-24/historical-event-reading-orders-batch-four-changes.md) | Implementation and validation record |
| [.copilot-tracking/reviews/logs/2026-08-24/historical-event-reading-orders-batch-four-review.md](.copilot-tracking/reviews/logs/2026-08-24/historical-event-reading-orders-batch-four-review.md) | Sole post-implementation Review |

## Next Steps

The automatic RPI parent should implement RV-001, rerun affected gates, and continue P05-T02 without
running another Review.
