<!-- markdownlint-disable-file -->
# Review: Priority cosmic character guides

## Scope and Evidence

* Task ID: MRT-002-C05
* Review date: 2026-08-23
* Review scope: Full task
* Assessed boundary: Rocket-only complete-guide publication, three explicit candidate deferrals, guarded
  evidence freshness, relationship approval, taxonomy, generated data, records, tests, release gates, and
  delivery readiness.
* Plan: .copilot-tracking/plans/2026-08-23/priority-cosmic-character-guides-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-23/priority-cosmic-character-guides-plan-critique.md
* Changes: .copilot-tracking/changes/2026-08-23/priority-cosmic-character-guides-changes.md
* Other evidence considered: .copilot-tracking/research/2026-08-23/priority-cosmic-character-guides-research.md,
  .copilot-tracking/rpi-sessions/2026-08-23/priority-cosmic-character-guides-state.json, the complete
  origin/main diff, changed source and data artifacts, tests, documentation, anchor lock, and recorded
  validation results.

## Opening Review State

* Interpreted review goal: Independently determine whether the complete implementation satisfies the accepted
  Rocket-only release boundary and is ready for pull request delivery.
* Review scope: Full task.
* Evidence readiness: Research, Plan, phase details, one critique, changes evidence, source diff, and release
  validation were available.
* Acceptance basis: User requirements, Plan acceptance criteria, the three applied critique dispositions, and
  the P01 through P03 completion evidence.
* First comparison boundary: Reconcile durable lifecycle state before accepting implementation and validation
  evidence.
* Active read-only boundaries: The independent reviewer had no source-write authority. Review created only
  this canonical record.
* Initial blockers: None prevented review execution.

## Execution Status

* Execution status: Complete
* Review execution evidence: Exactly one independent post-implementation review assessed the full artifact
  set and complete origin/main diff on 2026-08-23.

## Plan-to-Change Reconciliation

| Current plan scope | Descriptive changes-record summary | Current-state reconciliation | Gap or rationale |
|---|---|---|---|
| P01 through P03 | Frozen evidence, mapping, approval, authoring, tests, records, and release validation | Reconciled | Completion and validation evidence support the accepted product outcome. |
| P04-T01 | One independent Review | Partial | Review ran once, but stale durable lifecycle labels must be corrected before delivery. |
| Follow-Up Items | Separate Groot and Star-Lord authoring; Thanos metadata blocker | Reconciled | These remain distinct later work and are not release defects. |

## Completed Work Assessment

| Related marker | Files | What changed and why | Completion evidence | Validation | Assessment |
|---|---|---|---|---|---|
| P01 | scripts/data/cbh-packets/rocket-raccoon-reading-order.json; scripts/data/cbh-mappings/rocket-raccoon-reading-order.json | Froze and exactly resolved the accepted 75-row boundary. | 75 exact unique mappings and fresh digests. | Semantic validators pass. | Reconciled. |
| P02 | scripts/data/cbh-overlaps/rocket-raccoon-reading-order.json; src/data/curated-lists.json; src/data/rocket_raccoon_reading_order.json | Approved all current-library relationships and published one Complete guide. | 89 dispositions, three partials, exact generated sequence. | Authoring and catalog tests pass. | Reconciled. |
| P03 | test/cbh-character-spotlight.test.js; test/catalog-shelves.test.js; product and maintenance records | Added failure coverage, reconciled records, and ran release checks. | Exact counts, negative proof, browser evidence, and gates recorded. | Full recorded set passes. | Reconciled. |

## Implementation-Time Plan and Detail Update Assessment

| Affected area or marker | What changed and why | Triggering evidence and user decision | Reconciliation performed | Planning and critique state | Assessment |
|---|---|---|---|---|---|
| P01-T01 | Deferred reason text became research-specific without lifecycle changes. | PC-001; no new user decision needed. | Plan, details, inventory, state, and changes updated. | One critique applied. | Reconciled. |
| P03-T02 | Real-catalog Edge verification used a temporary external-driver script. | PC-002; preserved the fixture-only maintained check. | Evidence recorded and temporary script removed. | One critique applied. | Reconciled. |
| Follow-Up Items | Clarified that later separate authoring can use existing partial dispositions. | PC-003; no workflow change required. | Plan, Research guidance, and changes agree. | One critique applied. | Reconciled. |

## Critique and Material Revision Assessment

* Latest critique dispositions: PC-001, PC-002, and PC-003 were applied before dependent work completed.
* Material revisions: None. The Rocket-only release, accepted source boundaries, and workflow remained
  unchanged.
* Dependent-work pause assessment: No decision-critical change required a pause or new user input.
* Justification assessment: Supported.

## Plan Follow-Up Assessment

| Follow-up item | Why outside immediate scope | Owner or next action | Assessment and route |
|---|---|---|---|
| Groot and Star-Lord | Their accepted complete guides overlap Rocket and were excluded from this packet. | Later separate guarded authoring tasks. | Open distinct follow-up, not a defect. |
| Thanos | Source-required Spidey Super Stories #39 is absent from the metadata snapshot. | Re-enter only when exact metadata becomes available and the boundary is revalidated. | Blocked distinct follow-up, not a defect. |

Unresolved plan follow-up items remain distinct follow-up work. They are not part of the current active
implementation or acceptance scope.

## Findings

<!-- rpi:review id=RV-001 -->
### RV-001 [Medium]: Durable lifecycle markers remain stale

* Related scope: P04-T01
* Evidence: In .copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md,
  the Phase Index still labels P01 ready and P02 planned after both completed. In
  .copilot-tracking/plans/2026-08-23/priority-cosmic-character-guides-plan.md, the Handoff still directs
  continuation to P01 while current status is P04-T01. The changes record claims both are current.
* Impact: Durable state can direct continuation back to completed work and contradicts the required RPI
  coherence.
* Destination: rpi-implement
* Smallest useful next action: Mark P01 and P02 complete in the Phase Index, update the Plan Handoff to
  P04-T01, and reconcile the changes and state records before delivery.

## Defects

* RV-001, routed to rpi-implement as an in-scope release blocker.

## Routed Findings

| Finding | Destination | Owner or next action | Reason for route |
|---|---|---|---|
| RV-001 | rpi-implement | Automatic parent corrects durable lifecycle labels before PR delivery. | In-scope implementation-record defect. |

Later implementation of this routed finding does not require another Review.

## Residual Work

* None beyond the Plan Follow-Up Items, which remain distinct later work.

## Blockers and Remaining Work

* Blockers: RV-001 blocks P04 delivery until durable lifecycle state is coherent.
* Remaining active work: Correct RV-001, then continue P04-T02 delivery without another Review.

## Validation Evidence

| Command | Scope | Status | Summary |
|---|---|---|---|
| npm test | Project | Passed | 1,398 passed and 0 failed. |
| npm run lint | Project | Passed | 0 errors and 0 warnings after temporary-script cleanup. |
| npm run counts | Backlog and prose | Passed | 179 ranked rows, 184 detail blocks, and no stated drift. |
| npm run sizes | Stated size claims | Passed | 7 claims agree. |
| npm run palette | Theme contrast | Passed | 88 pairs, 5 accepted exceptions, and 0 new. |
| npm run anchors | Tracked citations | Passed | 1,152 unchanged, 0 drifted, 0 new, and 0 removed. |
| npm run browser | Installed Edge fixture regression | Passed | 158 assertions across 17 scenarios. |
| Temporary real-catalog Edge check | 1280x900 and 390x844 | Passed | Exact 12/11, 5/5, and 3/3 counts with correct Rocket visibility and no overflow. |
| npm run contract | Live metadata API | Passed | 33 of 33 assumptions across 17 requests. |
| npm run upgrade | Installed Edge upgrade path | Passed | 12 assertions. |
| npm run pack | Windows package | Passed | Checksum-verified 35,603,583-byte archive; output removed. |
| Added-line dash scan and diff check | Complete origin/main diff | Passed | 0 dash lines after correction and 0 whitespace errors. |

## Outcome

* Outcome: Defects found
* Outcome rationale: The product implementation and validation are conformant, but RV-001 leaves the durable
  execution state internally contradictory and must be fixed before PR delivery.

## Closeout Routing Record

| Finding class | Destination | Owner or next action |
|---|---|---|
| Implementation defect | rpi-implement | Correct RV-001, then continue P04-T02. |
| Decision gap or invalid assumption | none | None. |
| Material evidence gap | none | None. |
| Non-blocking residual work | distinct follow-up | Preserve the existing Groot, Star-Lord, and Thanos follow-ups. |

* Execution status: Complete
* Outcome: Defects found
* Validation coverage: Full deterministic, release, contract, package, and installed Edge evidence is
  available.
* Blockers: RV-001 only.
