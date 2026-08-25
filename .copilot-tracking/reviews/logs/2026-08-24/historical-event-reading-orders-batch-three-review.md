<!-- markdownlint-disable-file -->
# Review: Historical event reading orders batch three

## Scope and Evidence

* Task ID: MRT-003-C02-B03
* Review date: 2026-08-24
* Review scope: Full task P01 through P05
* Assessed boundary: Approved three-guide historical release, exact blocker preservation, evidence
  freshness, product integration, validation, publication readiness, and durable RPI state
* Plan: .copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-three-plan.md
* Phase details: .copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-three-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-24/historical-event-reading-orders-batch-three-plan-critique.md
* Changes: .copilot-tracking/changes/2026-08-24/historical-event-reading-orders-batch-three-changes.md
* Other evidence considered: Research and resolution evidence dated 2026-08-24, complete working-tree
  diff, generated packets, mappings, reports, payloads, catalog, validation output, and one independent
  read-only code-review lens

## Opening Review State

* Interpreted review goal: Determine once whether the complete implementation preserves the approved
  source, mapping, blocker, relationship, chronology, publication, and RPI contracts.
* Review scope: Full task P01 through P05
* Evidence readiness: Research, plan, details, critique, changes record, generated evidence, product
  outputs, and final local validation are available. Publishing and merge remain intentionally pending.
* Acceptance basis: Approved plan requirements and acceptance criteria, PC-001 and PC-002, explicit
  no-guess user direction, repository gates, and publication requirements.
* First comparison boundary: P01 through P03 implementation and P04 validation against the complete
  current diff; P05 is assessed only for readiness.
* Active read-only boundaries: Review may write only this canonical review record.
* Initial blockers: None prevented a credible review.

## Execution Status

* Execution status: Partial
* Review execution evidence: P01 through P03 are complete and P04 validation is complete. This sole
  Review completed the P04-T02 assessment, but the plan and changes record still require routed
  reconciliation and P05 publication remains pending.

## Plan-to-Change Reconciliation

| Current plan scope | Descriptive changes-record summary | Current-state reconciliation | Gap or rationale |
|---|---|---|---|
| P01 | Exact release and source authority | Reconciled | Three packets preserve 48 rows; six inventory outcomes and both compatibility invariants are explicit |
| P02 | Exact mappings and current relationships | Reconciled | 48 exact mappings, 339 comparisons, and five approved non-none tuples agree |
| P03 | Product and durable records | Partial | Product, backlog, provenance, maintenance, and publication records agree; changelog placement is defective |
| P04-T01 | Semantic and repository gates | Partial | All required checks passed, but the plan marker and changes record still say in progress |
| P04-T02 | Sole implementation review | Reconciled in this record | One complete review produced the findings below |
| P05 | Publish, merge, and hand off | Pending as planned | No publication action should start before RV-001 and RV-002 are implemented |

## Completed Work Assessment

| Related marker | Files | What changed and why | Completion evidence | Validation | Assessment |
|---|---|---|---|---|---|
| P01 | scripts/lib/cbro-evidence.mjs; scripts/data/cbro-historical-inventory.json; scripts/data/cbro-packets | Added one fixed release and preserved exact source and blocker state | 48 packet rows and six exact inventory transitions | Focused suite and digest validation pass | Reconciled |
| P02 | scripts/data/cbro-mappings; scripts/data/cbro-overlaps | Bound exact metadata and every current relationship | 48 exact mappings; 113 comparisons per guide; five non-none tuples | Approval and stale-evidence tests pass | Reconciled |
| P03 | src/data; CHANGELOG.md; PRODUCT_BACKLOG.md; docs | Added three guides and current release records | 114 catalog lists, 48 payload rows, zero placeholders | Product, count, provenance, and Edge checks pass | One changelog defect |
| P04-T01 | test; repository gates | Proved semantic rejection and final behavior | 29 focused and 1,445 full tests; all local and browser gates pass | Passed | Marker reconciliation remains |

## Implementation-Time Plan and Detail Update Assessment

| Affected area or marker | What changed and why | Triggering evidence and user decision | Reconciliation performed | Planning and critique state | Assessment |
|---|---|---|---|---|---|
| P01 inventory freshness | Six touched records use the 2026-08-24 retrieval date | Source digests were revalidated on that date; user required current reliable sourcing | Batch-two projection normalizes only those records to its historical date | Preserves approved intent; no new critique required | Reconciled |
| P01 compatibility | Earlier selected releases normalize to shipped state inside the batch-three untouched digest | Existing ready-to-shipped compatibility test must remain valid | Source, disposition, and relationship fields remain immutable | PC-001 remains satisfied | Reconciled |
| P03 documentation | Current inventory and provenance counts were rederived after vendoring | Final catalog contains 114 lists and 4,425 payload rows | Counts, backlog, provenance, and publication records updated | No material plan revision | Reconciled except RV-001 |

## Critique and Material Revision Assessment

* Latest critique dispositions: PC-001 and PC-002 were applied before implementation and remain
  satisfied by separate compatibility digests and exact relationship projections.
* Material revisions: None. Retrieval-date and selected-state normalization preserve approved intent
  and were recorded as implementation-time current-state updates.
* Dependent-work pause assessment: No decision-critical discovery required a pause or user decision.
* Justification assessment: The reduced batch and all three blockers remain supported by exact
  repository evidence. No uncertain issue was omitted, inferred, or replaced.

## Plan Follow-Up Assessment

| Follow-up item | Why outside immediate scope | Owner or next action | Assessment and route |
|---|---|---|---|
| Batch four and metadata re-entry | The approved batch stops at source position 16; three events lack exact metadata | Future historical-event research after exact ROM, Micronauts, or Power Pack evidence exists | Open distinct follow-up, not a defect |

Unresolved plan follow-up items remain distinct follow-up work. Do not treat them as defects or add
them to active implementation or acceptance scope.

## Findings

<!-- rpi:review id=RV-001 -->
### RV-001 [High]: Unreleased work is recorded under the tagged 1.4.0 release

* Related scope: P03-T03
* Evidence: CHANGELOG.md and repository tag v1.4.0
* Impact: The changelog retroactively attributes batch-three work to an already tagged release and
  leaves no Unreleased section for the next release preparation.
* Destination: rpi-implement
* Smallest useful next action: Add an Unreleased heading above 1.4.0 and keep only the batch-three
  entry under it, leaving the tagged 1.4.0 content unchanged.

<!-- rpi:review id=RV-002 -->
### RV-002 [Low]: Completed validation and Review markers are not reconciled

* Related scope: P04-T01 and P04-T02
* Evidence: Current plan and changes record
* Impact: Durable RPI state understates completed validation and would hand P05 an ambiguous starting
  point even after the product checks and sole Review finished.
* Destination: rpi-implement
* Smallest useful next action: Mark P04-T01 and P04-T02 complete, mark P04 complete, and record the
  final validation and Review outcome before starting P05.

## Defects

* RV-001 routes the changelog release-boundary defect to rpi-implement.
* RV-002 routes stale durable execution state to rpi-implement.

## Routed Findings

| Finding | Destination | Owner or next action | Reason for route |
|---|---|---|---|
| RV-001 | rpi-implement | Move the new entry under a fresh Unreleased heading | Accepted implementation direction; local correction |
| RV-002 | rpi-implement | Reconcile P04 markers and changes evidence | Durable implementation-state correction |

Later implementation of a routed finding does not require another Review.

## Residual Work

* Batch four and the three metadata re-entry investigations remain distinct future work.

## Blockers and Remaining Work

* Blockers: RV-001 and RV-002 block P05 publication until implemented.
* Remaining active work: P05-T01 and P05-T02 remain pending after the routed fixes.

## Validation Evidence

| Command | Scope | Status | Summary |
|---|---|---|---|
| Focused historical test | Historical release contracts | Passed | 29 of 29 scenarios |
| Full test suite | Repository | Passed | 1,445 passed, zero failed |
| ESLint | Repository | Passed | Zero findings |
| Counts, sizes, palette | Repository records and UI tokens | Passed | No drift or new palette debt |
| Anchors | Every tracked evidence citation | Passed | 1,180 unchanged, zero drifted, new, or removed |
| Publication | Reachable history and protected roots | Passed | Zero content findings |
| Live metadata contract | External metadata API | Passed | 33 of 33 assumptions across 17 requests |
| Browser suite | Installed Edge at 1280 by 900 | Passed | 186 assertions across 19 scenarios |
| Batch-three Edge check | Three real catalog cards and sequences | Passed | 12, 29, and 7 issues rendered in exact order |
| Added-line dash scan | Working-tree diff | Passed | Zero en dash or em dash additions |

## Outcome

* Outcome: Defects found
* Outcome rationale: Product data, source evidence, blockers, relationships, chronology, and behavior
  conform. Publication is not accepted until the tagged-release changelog placement and stale P04
  durable state are corrected.

## Closeout Routing Record

| Finding class | Destination | Owner or next action |
|---|---|---|
| Implementation defect | rpi-implement | Implement RV-001 and RV-002 before P05 |
| Decision gap or invalid assumption | none | No decision gap found |
| Material evidence gap | none | Exact issue and blocker evidence is complete |
| Non-blocking residual work | Future historical-event research | Re-enter blocked events only with exact missing metadata |

* Execution status: Partial
* Outcome: Defects found
* Validation coverage: Complete local, external contract, publication, and installed Edge coverage
* Blockers: RV-001 and RV-002
