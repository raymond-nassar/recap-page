<!-- markdownlint-disable-file -->
# Review: Historical event reading orders

## Scope and Evidence

* Task ID: MRT-003
* Review date: 2026-08-23
* Review scope: Full task implementation boundary through P05
* Assessed boundary: Exclusive pre-Maximum Security inventory, five fixed guides, provider separation,
  source and metadata identity, complete-library and peer overlap, central approvals, chronology,
  generated product data, records, failure proof, local and browser gates, and current-main
  reconciliation.
* Plan: .copilot-tracking/plans/2026-08-23/historical-event-reading-orders-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-23/historical-event-reading-orders-plan-critique.md
* Changes: .copilot-tracking/changes/2026-08-23/historical-event-reading-orders-changes.md
* Other evidence considered: Research artifact set, final committed diff from `origin/main` through
  `c80a86409eb79ae61d6b457be424b030bb8f9178`, validation output, source digests, reports, approvals,
  generated data, and one independent code-review result.

## Opening Review State

* Interpreted review goal: Independently determine once whether the completed five-guide release
  conforms to confirmed scope, source safety, freshness, authority, chronology, generated-data, and
  release-readiness requirements.
* Review scope: Full implemented P01 through P05 boundary.
* Evidence readiness: Plan, details, single critique, changes, research, committed implementation,
  final current-main reconciliation, and all required validation are available.
* Acceptance basis: Current plan requirements and acceptance criteria, PC-001 through PC-005
  dispositions, exact five-guide and 23-issue boundary, 58-entry inventory, and final validation
  record.
* First comparison boundary: Inspect the complete diff against current main, then reconcile any
  substantive finding with source and validation evidence. Do not review unrelated repository history.
* Active read-only boundaries: Review may write only this record. It may not change source, plan,
  details, critique, research, or changes.
* Initial blockers: None.

## Execution Status

* Execution status: Complete.
* Review execution evidence: One independent code review completed against commit `c80a864` and the
  full `origin/main...HEAD` task boundary. No second Review is planned or permitted.

## Plan-to-Change Reconciliation

| Current plan scope | Descriptive changes-record summary | Current-state reconciliation | Gap or rationale |
|---|---|---|---|
| P01 through P05 | Provider, inventory, packets, mappings, reports, authoring, product records, validation, and current-main refresh | Reconciled | Five implementation defects remain despite completed execution. |
| PC-001 through PC-005 | Single critique corrections incorporated | Reconciled | Critique findings were applied once before implementation. |
| Follow-Up Items | Ranked later historical chunks | Reconciled | Correctly outside the five-guide release. |

## Completed Work Assessment

| Related marker | Files | What changed and why | Completion evidence | Validation | Assessment |
|---|---|---|---|---|---|
| P01-P02 | Provider and CBRO evidence files | Added separate provider and guarded evidence chain | Packets, mappings, reports, approvals | Focused and full tests passed | Gaps RV-001 through RV-003 |
| P03 | Product data and authoring | Added five cards and 23 exact rows | Markdown, payload, manifest, catalog | Edge and generated-data tests passed | Gap RV-005 |
| P04-P05 | Product records and validation | Reconciled counts, anchors, current main, reports, and gates | Final recorded gate results | All named checks passed | Conformant apart from routed defects |

## Implementation-Time Plan and Detail Update Assessment

| Affected area or marker | What changed and why | Triggering evidence and user decision | Reconciliation performed | Planning and critique state | Assessment |
|---|---|---|---|---|---|
| P03 authoring prevalidation | Moved inventory validation before writes after a partial first run | Implementation failure; no new user decision | Code, generated data, tests, and changes record updated | Ready, critique unchanged | Incomplete atomicity, RV-005 |
| P05 current-main refresh | Merged Rocket Raccoon and regenerated all five reports and approvals | Confirmed caller freshness rule | Catalog, reports, approvals, counts, tests, and anchors updated | Ready, critique unchanged | Reconciled |
| Backlog identity | Renamed this feature from BL-205 to BL-206 after main used BL-205 first | Merge evidence; no product decision change | Backlog, provenance, counts, anchors updated | Ready, critique unchanged | Reconciled |

## Critique and Material Revision Assessment

* Latest critique dispositions: PC-001 through PC-005 are recorded as resolved in the plan.
* Material revisions: Current-main merge and BL-205 to BL-206 backlog identity reconciliation are
  recorded as implementation-time current-state updates.
* Dependent-work pause assessment: Authoring evidence was regenerated after current main changed and
  before Review.
* Justification assessment: The merge and backlog identity changes preserve confirmed user intent.
  Review defects are implementation gaps, not planning or research gaps.

## Plan Follow-Up Assessment

| Follow-up item | Why outside immediate scope | Owner or next action | Assessment and route |
|---|---|---|---|
| Ranked later historical chunks | First release is fixed to five guides and later candidates need exact mapping and current-library review | Distinct later RPI task | Open and correctly separate |

## Findings

<!-- rpi:review id=RV-001 -->
### RV-001 [High]: Partial approval and authoring can omit mandatory peers

* Related scope: P02-T04, P03-T01, P05-T03
* Evidence: `scripts/author-cbro-packet.mjs` accepts any `--only` subset for approval and authoring;
  a single-candidate approval succeeds without the other four peer digests.
* Impact: A release refresh can silently violate the indivisible five-guide and four-peer evidence
  contract.
* Destination: rpi-implement
* Smallest useful next action: Require the complete five-id set for approval and authoring while
  retaining single-id preparation.
* Resolution: Closed after Review. Approval and authoring now require the complete five ids in verified
  chronology order; focused tests refuse a partial or reordered set.

<!-- rpi:review id=RV-002 -->
### RV-002 [High]: Historical inventory and selected source evidence are not bound

* Related scope: P02-T01, P02-T02
* Evidence: `scripts/lib/cbro-evidence.mjs` validates record shape but accepts a fabricated replacement
  identity, and selected packet validation does not compare inventory provider, retrieval date,
  content SHA, section, or row count.
* Impact: Maintained inventory or selected source evidence can disagree with the reviewed packet
  without stopping.
* Destination: rpi-implement
* Smallest useful next action: Lock the canonical 58-record identity digest and compare every selected
  source field with its packet.
* Resolution: Closed after Review. The immutable inventory identity digest covers every stable record
  field, and selected packets match provider, URL, section, retrieval date, content SHA, and row count.

<!-- rpi:review id=RV-003 -->
### RV-003 [Medium]: CBRO review evidence can be relabeled without invalidation

* Related scope: P02-T04
* Evidence: `packetReview` is outside mapping and approval digests, and generic authoring checks only
  that it is nonempty.
* Impact: Provider-specific central review provenance can be changed to a CBH label while all current
  validations pass.
* Destination: rpi-implement
* Smallest useful next action: Bind provider and packet review identity into the approval and validate
  the exact CBRO review identity.
* Resolution: Closed after Review. Provider and exact packet review identity are inside the approval
  digest and validated before authoring.

<!-- rpi:review id=RV-004 -->
### RV-004 [Medium]: Alternate-universe inventory state is discarded

* Related scope: P02-T01
* Evidence: Marvel 2099 and MC2 are generic deferred records even though research identifies both as
  alternate-universe entries.
* Impact: The maintained inventory loses a required product-scope fact needed for later ranking and
  approval.
* Destination: rpi-implement
* Smallest useful next action: Add and validate explicit universe scope, with exactly those two
  identities marked alternate.
* Resolution: Closed after Review. Every inventory row now carries validated universe scope, with only
  Marvel 2099 and MC2 marked alternate.

<!-- rpi:review id=RV-005 -->
### RV-005 [Medium]: Canonical multi-file writes are not transactional

* Related scope: P02-T03, P02-T04, P03-T01
* Evidence: Preparation, approval, and authoring write outputs sequentially after validation.
* Impact: An interruption or write failure can leave mappings, reports, approvals, checklists,
  manifest, and inventory in different generations.
* Destination: rpi-implement
* Smallest useful next action: Stage all outputs and publish them with backup-backed rollback.
* Resolution: Closed after Review. Preparation, approval, and authoring use a journaled transaction
  that stages every file before publication, restores backups after a publish failure, and recovers an
  interrupted journal on the next run.

## Post-Review Implementation Status

* RV-001 through RV-005 were implemented without another Review.
* Two reversible proof runs made the new inventory, selected-source, review-identity, complete-set, and
  transaction assertions fail. The first intentionally demonstrated that partial approval can rewrite
  one candidate; the complete transactional approval was then reissued for all five.
* Restored focused tests pass 14 of 14, approval and authoring complete transactionally, and no journal,
  temporary, or backup file remains.

## Defects

* RV-001 through RV-005 were routed to `rpi-implement` and are closed.

## Routed Findings

| Finding | Destination | Owner or next action | Reason for route |
|---|---|---|---|
| RV-001 | rpi-implement | Enforce complete release ids | Current implementation defect |
| RV-002 | rpi-implement | Bind canonical inventory and selected source fields | Current implementation defect |
| RV-003 | rpi-implement | Bind and validate CBRO review identity | Current implementation defect |
| RV-004 | rpi-implement | Preserve alternate-universe scope | Current implementation defect |
| RV-005 | rpi-implement | Add transactional multi-file publication | Current implementation defect |

Later implementation of a routed finding does not require another Review.

## Residual Work

* Ranked later historical chunks remain the distinct plan follow-up.

## Blockers and Remaining Work

* Blockers: None remain after routed implementation.
* Remaining active work: P07 release only.

## Validation Evidence

| Command or evidence | Scope | Status | Summary |
|---|---|---|---|
| Focused and mutation proof | 14 new semantic cases | Passed | Every case failed under one of two reversible mutations; restored 14/14 |
| `npm test` | Full project | Passed | 1,412 tests |
| Seven deterministic gates | Final merged tree | Passed | Lint, tests, counts, sizes, palette, publication, anchors |
| Live metadata contract | Upstream API | Passed | 33/33 assumptions |
| Installed Edge harness | Existing scenarios | Passed | 158 assertions |
| Actual catalog Edge | Five shipped cards at 1280x900 | Passed | 41 assertions |
| Independent Review | Full task diff | Passed execution, defects found | 2 High and 3 Medium findings |

## Outcome

* Outcome: Defects found.
* Outcome rationale: Execution and validation are complete, but five in-scope implementation defects
  leave the evidence and write contracts weaker than the confirmed release boundary.

## Closeout Routing Record

| Finding class | Destination | Owner or next action |
|---|---|---|
| Implementation defect | rpi-implement | Close RV-001 through RV-005 without another Review |
| Decision gap or invalid assumption | none | No planning decision needed |
| Material evidence gap | none | Research remains sufficient |
| Non-blocking residual work | distinct follow-up | Ranked later historical chunks |

* Execution status: Complete
* Outcome: Defects found
* Validation coverage: Complete for the reviewed commit
* Blockers: None after routed implementation
