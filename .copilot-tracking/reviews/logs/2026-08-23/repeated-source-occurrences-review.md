<!-- markdownlint-disable-file -->
# Review: Repeated source occurrences and Iron Man

## Scope and Evidence

* Task ID: MRT-002-C09-DUP
* Review date: 2026-08-23
* Review scope: Full task, one independent post-implementation Review.
* Assessed boundary: Final reconciled feature diff from origin/main at
  ff92fd0875e90b12dcbf41bdaed1cfed84d99a41 to the current working tree, excluding files identical
  to origin/main; requirements, acceptance criteria, plan and detail updates, critique dispositions,
  changes evidence, validation, blockers, and follow-up routing.
* Plan: .copilot-tracking/plans/2026-08-23/repeated-source-occurrences-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-23/repeated-source-occurrences-plan-critique.md
* Changes: .copilot-tracking/changes/2026-08-23/repeated-source-occurrences-changes.md
* Other evidence considered:
  .copilot-tracking/research/2026-08-23/repeated-source-occurrences-research.md; implementation,
  test, product-record, and validation evidence in the supplied diff boundary.

## Opening Review State

* Interpreted review goal: Assess once whether the reconciled repeated-source-occurrence contract,
  Groot migration, conditional Iron Man non-publication, records, and validation satisfy the
  confirmed task without weakening unique downstream output or provider compatibility.
* Review scope: Full MRT-002-C09-DUP task at the supplied final reconciled boundary.
* Evidence readiness: The complete research, current plan, phase details, sole critique, changes
  record, staged candidate diff, and stated validation record are available. P04-T02 is the active
  Review task.
* Acceptance basis: Confirmed occurrence and provenance contract; unique canonical output and
  selected ids; approval-time re-derivation; backward-compatible absent-field digests; provider
  compatibility; Groot 84/76 migration; conditional Iron Man gate; critique dispositions; plan
  acceptance criteria and failure-proof matrix.
* First comparison boundary: Reconcile the complete supplied artifact set with the actual feature
  diff, then inspect the highest-risk validation, digest, derivation, compatibility, migration,
  blocker, merge-reconciliation, count, and silent-deduplication seams.
* Active read-only boundaries: Review may write only this canonical review record. Source, tests,
  research, plan, details, critique, changes record, lock, and all other files are evidence only.
* Initial blockers: None.

## Execution Status

* Execution status: Complete.
* Review execution evidence: The one authorized independent Review assessed the complete artifact
  set and final reconciled feature diff on 2026-08-23. P04-T03 delivery work remains outside this
  Review execution status.

## Plan-to-Change Reconciliation

| Current plan scope | Descriptive changes-record summary | Current-state reconciliation | Gap or rationale |
|---|---|---|---|
| P01, P01-T01 | Added paired optional occurrence fields, strict repeated-record validation, always-on canonical uniqueness, source-position reconstruction, and digest fields. | Reconciled | Implementation follows the selected flat-ledger design and keeps canonical rows unique. |
| P01-T02 | Propagated occurrence totals, ledger mirrors, source positions, approval re-derivation, CBRO inventory compatibility, and conditional provenance through both providers. | Reconciled | Shared approval logic rejects self-consistently re-digested derived-value tampering. |
| P01-T03 | Migrated Groot from 84 source occurrences to 76 canonical rows, refreshed the digest chain, and retained exact deferred-candidate fixtures. | Partial | Product behavior and freshness reconcile, but the locked negative-test matrix is incomplete. See RV-001. |
| P02, P02-T01 | Recorded the 815/813 Iron Man boundary and nine configured-metadata gaps while keeping all candidate product artifacts absent. | Reconciled | The conditional publication requirement failed honestly; no source issue was omitted or inferred. |
| P03, P03-T01, P03-T02 | Updated direct records and completed local, release, live-contract, anchor, and browser evidence. | Reconciled | Counts, product records, source contract, and unchanged UI outcome agree. |
| P04-T01 | Reconciled current main, BL-210 identity, Groot and Star-Lord reciprocal evidence, counts, anchors, and gates before Review. | Reconciled | The supplied diff is based on ff92fd0875e90b12dcbf41bdaed1cfed84d99a41 and the reciprocal reports regenerate exactly. |
| P04-T02 | Ran this one independent Review. | Reconciled | This record is the sole post-implementation Review. RV-001 is routed without requesting another Review. |
| P04-T03 | PR, hosted CI, merge, and durable merged identity. | Pending | Correctly sequenced after Review and after disposition of material findings. |
| Follow-Up Items | Iron Man, Old Man Logan, and Planet Hulk remain separate candidate-specific work. | Reconciled | They are residual product work, not defects in the shared release. |

## Completed Work Assessment

| Related marker | Files | What changed and why | Completion evidence | Validation | Assessment |
|---|---|---|---|---|---|
| P01-T01 | scripts/lib/cbh-inventory.mjs; test/cbh-batch.test.js | Added additive occurrence evidence and fail-closed canonical validation without relaxing selected-id uniqueness. | Optional fields are paired; repeated records are strict; canonical positions reconstruct from the complete occurrence sequence; packet and mapping digests bind the ledger. | Focused tests passed 36/36 during Review; source inspection confirms canonical uniqueness runs before the no-ledger return. | Functional implementation reconciled; negative proof gap is RV-001. |
| P01-T02 | scripts/prepare-cbh-batch.mjs; scripts/prepare-cbro-event.mjs; scripts/lib/cbro-evidence.mjs; scripts/author-cbh-packet.mjs; scripts/author-cbro-packet.mjs | Propagated source occurrence totals and mirrors through preparation, approval, authoring, and Markdown for CBH and CBRO. | Mapping positions and approved source counts are re-derived from the validated packet; packet mirrors are compared exactly; no-repeat optional fields remain absent from digest selection. | Focused provider tests passed; shared assertion call sites exist in CBH authoring and both CBRO approval and authoring. | Reconciled. |
| P01-T03 | Groot packet, mapping, overlap report, order Markdown, and existing semantic test owners | Replaced exclusion prose with eight exact later-source records while preserving one canonical row and selected id per comic. | 84 occurrences, 76 mapping rows, positions 72-79 target rows 8-15, row 72 maps to source position 80, 96 comparisons, and four factual partials including 25 with Star-Lord. | Frozen Groot and reciprocal Star-Lord tests pass and regenerate both reports exactly. | Product and freshness behavior reconciled; locked matrix gap remains RV-001. |
| P02-T01 | scripts/data/cbh-character-inventory.json; test/cbh-character-spotlight.test.js | Preserved the complete Iron Man boundary and the genuine metadata stop instead of shortening the guide. | Inventory names 815/813 and all nine gaps; packet, mapping, report, order, payload, and catalog artifacts are absent. | Character test verifies blocker text and every candidate-file absence. | Reconciled. |
| P03 | PRODUCT_BACKLOG.md; CHANGELOG.md; GOVERNANCE.md; docs/DATA_PROVENANCE.md; docs/MAINTAINING.md; docs/PUBLICATION_RUNBOOK.md; direct test and gate owners | Aligned maintainer records and proved the reconciled release. | Backlog identity and counts, source rules, blocker state, anchor lock, and release evidence agree with the tree. | Full tests, lint, counts, sizes, publication, anchors, browser runner, diff check, and recorded real-Edge checks pass. | Reconciled. |

## Implementation-Time Plan and Detail Update Assessment

| Affected area or marker | What changed and why | Triggering evidence and user decision | Reconciliation performed | Planning and critique state | Assessment |
|---|---|---|---|---|---|
| Functional requirements; failure matrix; P01-T01 to P01-T03 | Corrected Iron Man row-position arithmetic, required approval-time re-derivation, and expanded strict record-shape mutations. | PC-001 through PC-003; direct corrections required no new user decision. | Plan, details, acceptance, dependencies, critique disposition, and handoff all carry the corrected direction. | Sole critique dispositioned; no second critique. | Planning reconciliation is complete; implementation proof still misses cases in RV-001. |
| Executive scope; P02; P03; Follow-Up Items | Narrowed publication to the shared contract and Groot migration because nine exact Iron Man issues are unavailable. | Existing conditional user direction required all 813 distinct mappings or no publication. | Active Iron Man product tasks were removed; exact blocker, absence criteria, and distinct follow-up were added throughout current artifacts. | Justified implementation-time narrowing; no new decision required. | Reconciled and preserves user intent. |
| Baseline; P04-T01; relationship evidence; counts | Reconciled Star-Lord from current main, renamed the backlog item to BL-210, and refreshed reciprocal Groot and Star-Lord freshness evidence. | Current main at ff92fd0875e90b12dcbf41bdaed1cfed84d99a41 changed catalog and peer relationships. | Reports, mappings, approvals, tests, counts, browser evidence, direct records, and anchors were refreshed before Review. | Required current-state reconciliation; critique rerun not needed. | Reconciled. |

## Critique and Material Revision Assessment

* Latest critique dispositions: PC-001, PC-002, and PC-003 are all explicitly resolved in the
  current plan and phase details. Source and focused tests implement the corrected row-716 position,
  shared derived-value re-derivation, and strict repeated-record shape.
* Material revisions: The failed conditional Iron Man gate and current-main Star-Lord merge were
  reflected across plan, details, acceptance, follow-ups, changes, records, tests, counts, and
  freshness artifacts before this Review.
* Dependent-work pause assessment: Iron Man publication stopped before candidate artifacts; Review
  began only after current-main reconciliation and affected gate refresh.
* Justification assessment: The narrowed shared release preserves confirmed conditional user intent.
  RV-001 concerns incomplete implementation proof, not an unaccepted design decision.

## Plan Follow-Up Assessment

| Follow-up item | Why outside immediate scope | Owner or next action | Assessment and route |
|---|---|---|---|
| Iron Man | Publication condition failed because nine source-required issues are unavailable from configured metadata. | Future candidate work must wait for all nine issues, preserve 815/813, then rerun complete mapping and relationship review. | Open distinct follow-up; not a defect. |
| Old Man Logan | Only the exact 98/96 architecture fixture is in current scope. | Future candidate work must obtain exact metadata and candidate-specific overlap review. | Open distinct follow-up; not a defect. |
| Planet Hulk | Only the exact 109/104 architecture fixture is in current scope. | Future candidate work must obtain exact metadata and candidate-specific overlap review. | Open distinct follow-up; not a defect. |

Unresolved plan follow-up items remain distinct follow-up work. They are not active implementation,
completion, or acceptance scope for this shared release.

## Findings

<!-- rpi:review id=RV-001 -->
### RV-001 [Medium]: The locked occurrence failure matrix is not fully proved

* Related scope: P01-T01, P01-T02, P01-T03, and the Locked Change and Test Boundaries.
* Evidence: The required matrix in
  .copilot-tracking/plans/2026-08-23/repeated-source-occurrences-plan.md names both half-present
  field directions, duplicate and out-of-range source positions, invalid canonical targets,
  divergent packet-to-mapping mirrors, and both provider approval and authoring paths.
  test/cbh-batch.test.js covers only the occurrence-count-without-ledger half, one forward target,
  and direct shared-assertion derived-value tampering; test/cbro-historical-events.test.js likewise
  calls the shared assertion directly. Repository-wide test search found no negative cases for the
  inverse half, duplicate or out-of-range positions, out-of-range canonical rows, or divergent
  occurrence mirrors. The changes record nevertheless describes the strict matrix as complete.
* Impact: The implementation currently contains the intended guards, but the task's explicit
  acceptance proof is incomplete. Those fail-closed branches and entry-point wiring can regress
  without the required test detecting it, and the no-fix proof's three test failures do not
  establish that every named semantic guard can fail.
* Destination: rpi-implement.
* Smallest useful next action: Add the missing mutations to the existing shared and CBRO test
  owners, exercise the shared check through the relevant public approval and authoring paths where
  the plan requires that distinction, prove each new case fails under the smallest corresponding
  guard removal, restore it, and rerun focused tests plus all affected gates. Update the existing
  changes record during implementation; do not run another Review.

## Defects

* RV-001: In-scope acceptance and regression-proof defect; route to rpi-implement.

## Routed Findings

| Finding | Destination | Owner or next action | Reason for route |
|---|---|---|---|
| RV-001 | rpi-implement | Complete the locked negative matrix in existing tests and rerun affected gates. | Accepted design and implementation direction are sound; implementation proof is incomplete. |

Later implementation of RV-001 does not require another Review.

## Residual Work

* Iron Man remains blocked on nine exact metadata records under its 815/813 boundary.
* Old Man Logan remains a later 98/96 candidate-specific release.
* Planet Hulk remains a later 109/104 candidate-specific release.

## Blockers and Remaining Work

* Blockers: RV-001 blocks PR readiness for this release because an explicit locked acceptance
  boundary is incomplete. Iron Man's metadata blocker affects only its distinct follow-up.
* Remaining active work: Disposition RV-001 through implementation, then continue P04-T03 for final
  fetch, commit, PR, hosted CI, merge, and durable merged identity.

## Validation Evidence

| Command or evidence | Scope | Status | Summary |
|---|---|---|---|
| node --test test/cbh-batch.test.js test/cbh-character-spotlight.test.js test/cbro-historical-events.test.js | Focused occurrence, character, and provider behavior | Passed | 36 passed, 0 failed during Review. |
| npm test | Full tree | Passed | Exit 0 during Review; concise rerun emitted 1,418 passing dots, matching the recorded 1,418 passed and 0 failed. |
| npm run lint | Full tree | Passed | ESLint exited 0 with no findings during Review. |
| npm run counts | Backlog and prose counts | Passed | 184 ranked, 5 parked, 189 detail blocks: 161 Shipped, 21 Ready, 6 Dropped, 1 Proposed. |
| npm run sizes | Stated size claims | Passed | 6 claims agree. |
| npm run publication | Reachable history | Passed | 3,428 blobs scanned, 0 findings. |
| npm run anchors | All tracked citations | Passed | 1,181 unchanged, 0 drifted, 0 new, 0 removed. |
| npm run browser | Installed Edge runner | Passed | 182 assertions, 0 failed, across 19 scenarios. |
| Real-catalog Edge evidence in changes record | Installed Edge at 1280x900 and 390x844 | Passed before Review | Both viewports recorded 13 Character Spotlight stories, 5 Complete, 5 Best of, Groot and Star-Lord present, Iron Man absent, and no horizontal overflow. |
| npm run contract | Live metadata API | Passed before Review; review rerun externally rate-limited | Changes evidence records 33/33 across 17 requests. The first Review rerun reached 32/33 and returned HTTP 429 for the oversized-limit probe; a direct cooldown probe returned the expected 422. Further reruns exhausted the external request budget and supplied no contradictory contract evidence. |
| No-fix proof | New semantic tests without implementation | Partial | Changes evidence records three focused failures before restoration and all focused tests passing after restoration, but RV-001 identifies named guards without their required negative proof. |
| git diff --check and dash evidence | Reconciled candidate | Passed | Diff check exited 0 during opening inspection; changes evidence records 0 added en or em dashes. |

## Outcome

* Outcome: Not accepted.
* Outcome rationale: The functional design, implementation, provider compatibility, digest chain,
  mapping derivation, Groot and Star-Lord freshness, Iron Man stop, records, and release gates are
  otherwise conformant with the justified conditional-publication divergence. RV-001 leaves a
  material locked acceptance boundary unproved, so the candidate is not PR-ready until that
  implementation finding is dispositioned. No second Review is required.

## Closeout Routing Record

| Finding class | Destination | Owner or next action |
|---|---|---|
| Implementation defect | rpi-implement | Complete RV-001 in existing tests and rerun affected gates. |
| Decision gap or invalid assumption | none | No unresolved planning decision. |
| Material evidence gap | none | No new research is required; the missing proof is implementation-owned. |
| Non-blocking residual work | Distinct Iron Man, Old Man Logan, and Planet Hulk follow-ups | Clear each candidate's own metadata and relationship gates in later work. |

* Execution status: Complete.
* Outcome: Not accepted.
* Validation coverage: Static diff and artifact reconciliation; focused and full tests; lint; counts;
  sizes; publication; anchors; browser runner; recorded real Edge; live-contract evidence and
  rate-limit qualification; diff and dash checks.
* Blockers: RV-001 only for the shared release.

## Relevant Artifacts

| Artifact | Description |
|---|---|
| [.copilot-tracking/research/2026-08-23/repeated-source-occurrences-research.md](.copilot-tracking/research/2026-08-23/repeated-source-occurrences-research.md) | Selected architecture, exact candidate shapes, simulations, alternatives, and risks |
| [.copilot-tracking/plans/2026-08-23/repeated-source-occurrences-plan.md](.copilot-tracking/plans/2026-08-23/repeated-source-occurrences-plan.md) | Current requirements, locked boundaries, phase state, critique dispositions, and follow-ups |
| [.copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md](.copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md) | Current phase and task execution details |
| [.copilot-tracking/reviews/plans/2026-08-23/repeated-source-occurrences-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-23/repeated-source-occurrences-plan-critique.md) | Sole critique and PC-001 through PC-003 finding set |
| [.copilot-tracking/changes/2026-08-23/repeated-source-occurrences-changes.md](.copilot-tracking/changes/2026-08-23/repeated-source-occurrences-changes.md) | Implementation, reconciliation, validation, blocker, and handoff evidence |
| [.copilot-tracking/reviews/logs/2026-08-23/repeated-source-occurrences-review.md](.copilot-tracking/reviews/logs/2026-08-23/repeated-source-occurrences-review.md) | This sole independent post-implementation Review |

## Next Steps

The active parent should route RV-001 to rpi-implement, complete its existing-test and failure-proof
work, rerun affected gates, and then continue P04-T03 without another Review.
