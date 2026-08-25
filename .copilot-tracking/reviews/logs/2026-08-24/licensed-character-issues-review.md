<!-- markdownlint-disable-file -->
# Review: Licensed tie-in exclusion batch

## Scope and Evidence

* Task ID: MRT-003-C02-B04
* Review date: 2026-08-25
* Review scope: Full task
* Assessed boundary: Confirmed exclusion decision, 89-row conservation requirement, plan and critique,
  P01 through P04 implementation evidence, generated packet and product surfaces, validation, delivery
  records, remaining P05 work, and distinct future items.
* Plan: .copilot-tracking/plans/2026-08-24/licensed-character-issues-plan.md
* Phase details: .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-24/licensed-character-issues-plan-critique.md
* Changes: .copilot-tracking/changes/2026-08-24/licensed-character-issues-changes.md
* Other evidence considered: .copilot-tracking/research/2026-08-24/licensed-character-issues-research.md,
  the complete staged diff, generated packets, mappings, reports, checklists, payloads, catalog state,
  direct delivery records, validation outputs, and one bounded read-only exclusion-contract lens.

## Opening Review State

* Interpreted review goal: Determine whether the completed implementation enforces the user's exact
  58-retained plus 31-approved-exclusion boundary and is ready for one merge candidate.
* Review scope: Full MRT-003-C02-B04 task through completed P04, with P05 delivery remaining.
* Evidence readiness: The plan, details, sole critique, research, changes record, generated evidence,
  product output, and validation record are available and reconciled for review.
* Acceptance basis: Confirmed user decision, plan functional and non-functional requirements,
  acceptance criteria, PC-001 through PC-003 dispositions, and repository delivery rules.
* First comparison boundary: Source conservation and exclusion authority, followed by generated
  evidence, reader output, compatibility, validation, and delivery readiness.
* Active read-only boundaries: Review may write only this canonical review record; source, plan,
  details, critique, research, and changes evidence remain read-only.
* Initial blockers: None before evidence comparison.

## Execution Status

* Execution status: Complete
* Review execution evidence: One full-task evidence comparison completed on 2026-08-25 against the
  staged P01 through P04 result, including one bounded adversarial mutation of exclusion authority.

## Plan-to-Change Reconciliation

| Current plan scope | Descriptive changes-record summary | Current-state reconciliation | Gap or rationale |
|---|---|---|---|
| P01 | Exact conservation primitives and predecessor guards | Reconciled | Generic shape, count, position, propagation, and compatibility coverage exists, but exact B04 exclusion authority has a material bypass recorded as RV-001 |
| P02 | Exclusion-aware evidence, exact metadata, chronology, reports, and approvals | Reconciled | The checked-in artifacts contain the intended 58 retained rows, 31 exact exclusions, and eight reviewed relationships |
| P03 | Three non-complete guides and delivery records | Reconciled | Three checklists, payloads, catalog entries, inventory transitions, provenance, changelog, and backlog records agree |
| P04 | Mutation proof and complete validation | Reconciled | Planned gates passed, but Review's distinct authority mutation exposed a gap not covered by the implementation mutation |
| P05 | Review and merge-ready delivery | Partial | This Review is complete; commit and pull request must wait for RV-001 implementation |
| Follow-Up Items | Supplemental essential trades and position-17 Evolutionary War | Reconciled | Both remain explicitly outside this batch |

## Completed Work Assessment

| Related marker | Files | What changed and why | Completion evidence | Validation | Assessment |
|---|---|---|---|---|---|
| P01 | scripts/lib/cbh-inventory.mjs, scripts/lib/cbro-evidence.mjs, scripts/prepare-cbro-event.mjs | Added structured exclusions, source-position conservation, mapping propagation, and predecessor invariants | Existing packets remain accepted and malformed conservation shapes fail | Focused tests and implementation mutation passed | Material authority gap, RV-001 |
| P02 | scripts/data/cbro-packets, scripts/data/cbro-mappings, scripts/data/cbro-overlaps, scripts/data/cbro-historical-inventory.json | Froze, resolved, compared, and approved the exact three-guide evidence set | 89 source rows are represented by 58 retained rows and 31 checked-in exclusions; reports contain 348 comparisons | Focused and full tests passed | Reconciled for checked-in artifacts |
| P03 | src/data/orders, src/data/curated-lists.json, src/data/catalog.json, three payloads, direct records | Published three truthful non-complete guides with bounded disclosure | Counts are 7, 40, and 11 with zero placeholders or unresolved rows | Data gates and Edge passed | Reconciled |
| P04 | Tests, anchor lock, validation record | Proved a conservation guard and exercised repository and runtime behavior | Planned mutation failed, then 1,449 tests and browser checks passed after restoration | All recorded gates passed | Reconciled, but not sufficient to cover RV-001 |

## Implementation-Time Plan and Detail Update Assessment

| Affected area or marker | What changed and why | Triggering evidence and user decision | Reconciliation performed | Planning and critique state | Assessment |
|---|---|---|---|---|---|
| P03-T01 and P04-T02 | Corrected singular agreement in the generated one-exclusion sentence | Final reader-copy inspection; no new user decision | Authoring path, generated checklist, plan status, details, and changes record were updated | Approved intent unchanged; no new critique required | Reconciled |

## Critique and Material Revision Assessment

* Latest critique dispositions: PC-001 through PC-003 are each recorded as resolved in the plan and
  reflected in implementation ordering, compatibility ownership, and target coverage.
* Material revisions: No implementation-time decision changed scope, architecture, acceptance,
  dependency order, or confirmed user intent.
* Dependent-work pause assessment: Chronology-dependent authority followed exact metadata resolution;
  no dependent work resumed across an unresolved material decision.
* Justification assessment: The one copy correction was ordinary local judgment and preserved the
  approved reader-facing disclosure.

## Plan Follow-Up Assessment

| Follow-up item | Why outside immediate scope | Owner or next action | Assessment and route |
|---|---|---|---|
| Supplemental essential-trades candidates | The confirmed batch is limited to three previously blocked guides | Future bounded MRT-003 continuation | Open distinct follow-up, not a defect |
| Position-17 Evolutionary War | The user explicitly preserved it as the next source-order cursor | Future bounded MRT-003 continuation | Open distinct follow-up, not a defect |

Unresolved plan follow-up items remain distinct follow-up work. Do not treat them as defects or add
them to active `Pxx` or `Pxx-Txx` implementation, completion, or acceptance scope.

## Findings

<!-- rpi:review id=RV-001 -->
### RV-001 [High]: Exact approved exclusions are not bound by release authority

* Related scope: P01-T01, P02-T01, and P04-T01
* Evidence: scripts/lib/cbh-inventory.mjs validates only the generic exclusion shape and
  scripts/lib/cbro-evidence.mjs does not bind B04 packet exclusions to immutable approved
  per-guide identities. A read-only mutation moved one retained Secret Wars II row into a third
  exclusion, changed the decision scope, recomputed the packet digest, and remained accepted by
  validateCbroPacket against the inventory.
* Impact: The contract proves only source rows equal included rows plus some exclusions. It does not
  enforce the user's requirement that only the exact 31 approved rows may be excluded, so a future
  packet can silently shorten one of these guides while passing packet validation.
* Destination: rpi-implement
* Smallest useful next action: Add release-scoped immutable exclusion authority for the three B04
  packets, require the exact decision scope and full per-guide ledger, and add a mutation test showing
  that a newly invented exclusion still fails after all self-derived digests are recomputed.

## Defects

* RV-001 is a material implementation defect routed to rpi-implement.

## Routed Findings

| Finding | Destination | Owner or next action | Reason for route |
|---|---|---|---|
| RV-001 | rpi-implement | Automatic RPI parent adds immutable B04 exclusion authority and a recomputed-digest mutation test | The accepted design is sound, but its exact approved ledger is not enforced |

Later implementation of a routed finding does not require another Review.

## Residual Work

* Supplemental essential-trade candidates and position-17 Evolutionary War remain the two distinct
  plan follow-ups; neither is active scope or a defect.

## Blockers and Remaining Work

* Blockers: RV-001 blocks P05-T02 commit and pull-request publication.
* Remaining active work: Implement RV-001, rerun affected and repository gates, reconcile P05
  evidence, then complete P05-T02.

## Validation Evidence

| Command | Scope | Status | Summary |
|---|---|---|---|
| Focused Node tests with conservation implementation removed | New guard | Passed as mutation evidence | 12 passed and the intended focused test failed |
| Focused shared and historical tests after restoration | Exclusion contract and B04 evidence | Passed | 45 passed, zero failed |
| npm run lint | Complete tree | Passed | Zero findings |
| npm test | Complete tree | Passed | 1,449 passed, zero failed |
| npm run counts, npm run sizes, npm run palette | Product and documentation data | Passed | All direct repository checks accepted the final staged data |
| npm run anchors | Complete tracked tree | Passed | 1,186 unchanged, zero drifted, zero new, zero removed |
| npm run publication | Delivery history | Passed | Publication boundary accepted the current history |
| npm run contract | Live configured metadata assumptions | Passed | 33 of 33 assumptions |
| npm run browser | Installed Edge regression at explicit viewport | Passed | 186 assertions across 19 scenarios |
| Focused installed-Edge B04 check | Three catalog previews and imports at 1280 by 900 | Passed | 21 assertions |
| Review exclusion-authority mutation | Exact approved-ledger rejection | Failed | A 39-retained plus 3-exclusion Secret Wars II packet with a wrong decision scope was accepted after recomputing its digest |
| Added-line dash scan | Shipped prose | Passed | Zero en dashes or em dashes |

## Outcome

* Outcome: Not accepted
* Outcome rationale: Execution and the checked-in product output are complete, but RV-001 leaves the
  core no-unapproved-omission acceptance criterion unenforced. The defect is within the accepted plan
  and can be corrected without research, replanning, a new user decision, or a second Review.

## Closeout Routing Record

| Finding class | Destination | Owner or next action |
|---|---|---|
| Implementation defect | rpi-implement | Implement and validate RV-001 before P05-T02 |
| Decision gap or invalid assumption | None | No action |
| Material evidence gap | None | No action |
| Non-blocking residual work | Distinct future MRT-003 continuations | Preserve both existing follow-up items |

* Execution status: Complete
* Outcome: Not accepted
* Validation coverage: Planned mutation, focused tests, 1,449-test suite, repository data gates,
  anchors, publication, live contract, 207 Edge assertions, and Review authority mutation.
* Blockers: RV-001 blocks commit and pull-request publication until implementation and affected
  validation complete.
