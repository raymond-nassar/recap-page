<!-- markdownlint-disable-file -->
# Review: Character spotlight guides

## Scope and Evidence

* Task ID: MRT-002-C01
* Review date: 2026-08-23
* Review scope: full task
* Assessed boundary: recovered Research through the complete White Tiger implementation, validation,
  records, user constraints, and release readiness.
* Plan: .copilot-tracking/plans/2026-08-23/character-spotlight-guides-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-23/character-spotlight-guides-plan-critique.md
* Changes: .copilot-tracking/changes/2026-08-23/character-spotlight-guides-changes.md
* Other evidence considered: completed Research artifacts, the full staged diff against `origin/main`,
  all production and test changes, and one independent read-only code-review lens.

## Opening Review State

* Interpreted review goal: determine whether the completed full-plan implementation satisfies the exact
  single-pilot evidence, publication, safety, and validation contracts.
* Review scope: full task.
* Evidence readiness: the plan, details, critique, changes record, Research, product data, tests, and
  validation outputs are available.
* Acceptance basis: the approved P01 through P03 requirements, PC-001 disposition, recovered user
  controls, repository constraints, and complete release gates.
* First comparison boundary: complete staged diff against the pre-task `origin/main` tree.
* Active read-only boundaries: Review may write only this record; findings route to later implementation.
* Initial blockers: none.

## Execution Status

* Execution status: Complete
* Review execution evidence: one complete comparison executed on 2026-08-23 with an independent
  read-only code-review lens.

## Plan-to-Change Reconciliation

| Current plan scope | Descriptive changes-record summary | Current-state reconciliation | Gap or rationale |
|---|---|---|---|
| P01 | Maintained inventory and exact packet | Partial | Inventory exists, but its defining character evidence fields and exact cardinality are not validated by the shared validator. |
| P02 | Complete relationship approval and publication | Partial | Publication exists, but Review found that the recorded pre-publication library digest must be recomputed rather than echoed by the focused test. |
| P03 | Semantic coverage, records, and release gates | Partial | Gates ran, but the staged lifecycle record, one live provenance count, and external-text boundary need correction. |
| Follow-Up Items | Another guide remains separate | Reconciled | No second pilot entered active scope. |

## Completed Work Assessment

| Related marker | Files | What changed and why | Completion evidence | Validation | Assessment |
|---|---|---|---|---|---|
| P01 | scripts/data/cbh-character-inventory.json; scripts/lib/cbh-inventory.mjs | Added the maintained character source program and shared lookup | 128 records and one selected packet | Focused tests pass | Defect in schema enforcement, RV-004 |
| P02 | White Tiger packet, mapping, report, order, manifest, payload, and catalog | Published the one approved 82-issue reading | Exact generated surfaces and Edge result | Targeted and browser checks pass | Digest evidence gap, RV-001 |
| P03 | Tests and release records | Added semantic coverage and ran release gates | Full repository and Edge validation | Deterministic gates pass | Record and evidence-boundary gaps, RV-002, RV-003, RV-005 |

## Implementation-Time Plan and Detail Update Assessment

| Affected area or marker | What changed and why | Triggering evidence and user decision | Reconciliation performed | Planning and critique state | Assessment |
|---|---|---|---|---|---|
| P01-T01 and P02-T02 | White Tiger remains ready until publication, then becomes shipped | Approved lifecycle order; no new user decision | Plan and details agree | PC-001 remains applied | Reconciled |
| P01 dependency | Existing parent foundation was already present despite an empty cherry-pick | Parent commit evidence | Changes record explains the outcome | No new critique required | Reconciled |
| P03 records | Final completion and validation edits were made after the initial staged snapshot | Gate results | Current working artifacts are complete | No plan change | Must be staged, RV-003 |

## Critique and Material Revision Assessment

* Latest critique dispositions: PC-001 is applied by moving the exact shipped-order assertion from 86
  to 87.
* Material revisions: no user-owned scope or architecture decision changed. Multi-inventory lookup,
  current-state research reconciliation, and historical-test narrowing preserve approved intent.
* Dependent-work pause assessment: no affected dependency resumed before its evidence existed.
* Justification assessment: implementation direction remains supported; findings fit later
  implementation without reopening planning.

## Plan Follow-Up Assessment

| Follow-up item | Why outside immediate scope | Owner or next action | Assessment and route |
|---|---|---|---|
| Resolve another deferred character or team guide | One major feature and one evidence-approved pilot | Distinct later MRT-002 child task | Open follow-up, not a defect |

Unresolved plan follow-up items remain distinct follow-up work. Do not treat them as defects or add them
to active implementation or acceptance scope.

## Findings

<!-- rpi:review id=RV-001 -->
### RV-001 [High]: Recompute the pre-publication library digest

* Related scope: P02-T01, P03-T01
* Evidence: scripts/data/cbh-overlaps/white-tiger-ava-ayala.json and test/cbh-character-spotlight.test.js
* Impact: the approval may not be bound to the actual 86-list pre-publication library, while the focused
  test can pass by feeding the report's own digest back as current evidence.
* Destination: rpi-implement
* Smallest useful next action: independently derive the 86-list library digest, regenerate approval
  evidence if needed, and make the focused test compute rather than echo it.

<!-- rpi:review id=RV-002 -->
### RV-002 [High]: Remove copied external editorial prose from committed Research evidence

* Related scope: Research evidence boundary, P03-T02
* Evidence: .copilot-tracking/research/2026-08-22/character-spotlight-boundaries.json
* Impact: large source blocks reproduce third-party editorial prose beyond the credit-and-link evidence
  needed for this task and include prohibited dash characters.
* Destination: rpi-implement
* Smallest useful next action: retain exact URLs, headings, issue references, decisions, and digests while
  removing full editorial blocks and proving the production boundary remains reproducible.

<!-- rpi:review id=RV-003 -->
### RV-003 [High]: Reconcile and stage the final release state

* Related scope: P03-T02
* Evidence: plan, phase details, changes record, and docs/anchors.lock.json
* Impact: the staged candidate seen by Review still reported partial implementation and unchecked P03
  markers even though the working artifacts had been closed.
* Destination: rpi-implement
* Smallest useful next action: reconcile and stage the final marker, validation, review, and anchor state
  before commit.

<!-- rpi:review id=RV-004 -->
### RV-004 [Medium]: Enforce character inventory invariants

* Related scope: P01-T01, P03-T01
* Evidence: scripts/lib/cbh-inventory.mjs, scripts/data/cbh-character-inventory.json, and
  test/cbh-character-spotlight.test.js
* Impact: missing aliases, source positions, central dispositions, evidence digests, lifecycle reasons,
  or one complete source identity can escape shared validation.
* Destination: rpi-implement
* Smallest useful next action: add character-specific schema and exact-cardinality checks plus negative
  tests for missing, duplicate, and ineligible multi-inventory records.

<!-- rpi:review id=RV-005 -->
### RV-005 [Medium]: Reconcile the remaining live provenance count

* Related scope: P03-T02
* Evidence: docs/DATA_PROVENANCE.md
* Impact: one current-tense section still reports 72 of 86 Comic Book Herald-derived lists while the
  shipped manifest has 73 of 87.
* Destination: rpi-implement
* Smallest useful next action: update the live count and re-run documentation, anchor, and full gates.

## Defects

* RV-001, RV-002, RV-003, RV-004, and RV-005 route to `rpi-implement`.

## Routed Findings

| Finding | Destination | Owner or next action | Reason for route |
|---|---|---|---|
| RV-001 | rpi-implement | Recompute and bind the library digest | Implementation evidence defect |
| RV-002 | rpi-implement | Minimize committed source evidence | Implementation evidence-boundary defect |
| RV-003 | rpi-implement | Stage reconciled final state | Release-record defect |
| RV-004 | rpi-implement | Strengthen validator and negative coverage | Implementation contract defect |
| RV-005 | rpi-implement | Correct the live provenance count | Documentation defect |

Later implementation of a routed finding does not require another Review.

## Routed Finding Resolution

| Finding | Implementation disposition | Evidence |
|---|---|---|
| RV-001 | Resolved | The overlap report and central approval now bind the candidate-excluding 86-list digest. The focused test independently reconstructs that digest and fails against the prior full-library behavior. |
| RV-002 | Resolved | The 128-record boundary artifact now retains URLs, source metadata, headings, counts, content hashes, and aggregate issue-block hashes without copied editorial blocks. |
| RV-003 | Resolved | Plan markers, Review state, changes evidence, and the anchor cycle are reconciled in the final release commit. |
| RV-004 | Resolved | Character inventory validation now enforces all evidence fields, disposition state, unique labels and positions, exact 128-record cardinality, and maintained-inventory ambiguity checks without weakening the modern baseline contract. |
| RV-005 | Resolved | The live provenance statement now reports 73 credited orders among 87 shipped lists. |

These are ordinary implementation resolutions of the one completed Review. No second Review or
critique is required.

## Residual Work

* The plan follow-up for another guide remains a distinct later task.

## Blockers and Remaining Work

* Blockers: none.
* Remaining active work: final gates, release commit, pull request, required CI, and merge.

## Validation Evidence

| Command | Scope | Status | Summary |
|---|---|---|---|
| Targeted Node tests | Character packet and regressions | Passed | 156 tests passed |
| `npm test` | Full repository | Passed | 1,384 tests passed |
| Seven deterministic gates | Full repository | Passed before Review | Lint, tests, counts, sizes, anchors, palette, and publication completed |
| `npm run contract` | Live metadata service | Passed on bounded retry | 33 assumptions held across 17 requests |
| `npm run browser` | Installed Edge | Passed | 126 assertions across 14 scenarios |
| Focused Edge check | Actual White Tiger catalog and reading | Passed | One Character spotlights card, 82 issues, exact source and first, middle, final rows |

## Outcome

* Outcome: Defects found
* Outcome rationale: execution completed, but five substantive evidence, validation, and release-record
  defects need implementation before the result is acceptable.

## Closeout Routing Record

| Finding class | Destination | Owner or next action |
|---|---|---|
| Implementation defect | rpi-implement | Implement RV-001 through RV-005 |
| Decision gap or invalid assumption | none | none |
| Material evidence gap | none | none |
| Non-blocking residual work | distinct follow-up | Another guide remains a later child task |

* Execution status: Complete
* Outcome: Defects found
* Validation coverage: complete pre-Review gate set plus independent review comparison.
* Blockers: none.

| Artifact | Description |
|---|---|
| [.copilot-tracking/plans/2026-08-23/character-spotlight-guides-plan.md](.copilot-tracking/plans/2026-08-23/character-spotlight-guides-plan.md) | Approved implementation plan |
| [.copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md](.copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md) | Phase and task contracts |
| [.copilot-tracking/reviews/plans/2026-08-23/character-spotlight-guides-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-23/character-spotlight-guides-plan-critique.md) | Single plan critique |
| [.copilot-tracking/changes/2026-08-23/character-spotlight-guides-changes.md](.copilot-tracking/changes/2026-08-23/character-spotlight-guides-changes.md) | Implementation evidence |
| [.copilot-tracking/research/2026-08-22/character-spotlight-guides-research.md](.copilot-tracking/research/2026-08-22/character-spotlight-guides-research.md) | Completed Research |

## Next Steps

The automatic RPI parent should implement RV-001 through RV-005 and continue to commit, PR, CI, and
merge without running a second Review.
