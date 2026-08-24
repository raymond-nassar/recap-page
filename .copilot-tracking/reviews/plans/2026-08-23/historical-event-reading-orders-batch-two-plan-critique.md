<!-- markdownlint-disable-file -->
# RPI Plan Critique: Historical event reading orders batch two

## Metadata

* Task ID: MRT-003-C02-B02
* Critique date: 2026-08-23
* Plan: .copilot-tracking/plans/2026-08-23/historical-event-reading-orders-batch-two-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/historical-event-reading-orders-batch-two-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: Release exactly the next five maintained pre-Maximum Security source entries in the supplied order, retain inherited blockers, use one critique and one postimplementation review, bind fresh complete-library and four-peer reports, and stop before batch three.
* Research and evidence considered: The supplied batch-two research, plan, phase details, CBRO release, preparation, authoring, overlap, inventory, and focused-test sources only.
* Decisions, dependencies, and acceptance criteria considered: The five-ID release, 35 exact rows, seven named non-none comparisons, unchanged nonselected inventory, digest-bound reports, atomic authoring, final validation, one review, and no batch-three continuation.
* Assessment boundary: This critique assesses the candidate's credibility against the supplied current workspace only. It does not fetch sources, resolve live metadata, inspect unlisted files, or treat supplied evidence as instructions.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|---|---|---|
| User five-item source order and cutoff | Covered | The plan names positions 6 through 10 only and excludes Maximum Security and later entries. |
| Inherited blockers and no batch three | Covered | The plan and phase details retain the four dispositions and explicitly stop after merge. |
| P01-T01, P01-T03, FR 1, FR 6 | Partial | Current release and inventory validation accept only the ten already selected IDs; the planned five remain deferred and unresolved. |
| P02-T02, P02-T03, FR 4, AC relationship decisions | Partial | Current central approval code permits only the existing Kree-Skrull War subset and uses its fixed rationale. |
| P01-T03, P03-T03, AC nonselected inventory protection | Partial | Current identity protection must be rebaselined for selected-record changes, without a dedicated assertion that all other records remain byte-for-byte equivalent. |
| P04-T01, P04-T02, P05 | Covered | The plan requires fresh digest-bound evidence, local and browser gates, one review, green hosted jobs, and no review loop. |

## Verdict

* Verdict: Revise
* Rationale: The required five-item source boundary, freshness model, review limit, and release stop are credible. Two current enforcement contracts cannot admit the proposed inventory state or seven relationship decisions, and the plan does not allocate an explicit migration plus targeted regression proofs for them.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [High]: The release cannot enter the current inventory contract in its planned state

* Related IDs: FR 1, FR 6, AC inventory counts, P01-T01, P01-T03, P03-T01.
* Evidence: scripts/lib/cbro-evidence.mjs; scripts/prepare-cbro-event.mjs; scripts/author-cbro-packet.mjs; scripts/data/cbro-historical-inventory.json; test/cbro-historical-events.test.js.
* Concern: The current selected-ID authority lists only the two shipped releases. Inventory validation requires every selected record to match that list and allows only the existing Kree-Skrull War subset. Positions 6 through 10 are presently deferred with unresolved relationships. Preparation validates this inventory before packet loading, while authoring validates it before changing only catalog IDs and delivery status. Adding a release entry alone therefore leaves the candidate records invalid before preparation, and authoring cannot promote them to the stated selected state.
* Impact: The batch cannot traverse the prescribed preparation and authoring path without an unplanned contract change. A late change risks accepting the wrong selected order, losing the four retained blockers, or publishing inventory records that do not represent the approved relationships.
* Smallest useful change: Expand P01 with an explicit, atomic inventory-authority migration before packet preparation. Define the batch-two source and author ID arrays, the all-selected source order, the five ready selected records, their exact permitted relationship representation and overlap IDs, the revised identity digest, and the invariant that every other record is unchanged. Make P03 consume that ready state and transition only its five records to shipped.
* Action owner: Planning parent.
* Exact resolving evidence: A focused test constructs the current inventory with the five specified records promoted to the documented ready state and proves validation passes only with the exact three release arrays, exact five positions, exact allowed relationship data, unchanged terminal blockers, and revised identity digest. A companion negative test fails when any batch-two ID is removed, reordered, substituted, left unresolved, or a nonselected record changes.
* Decision route: Direct planner correction.

<!-- rpi:critique id=PC-002 -->
### PC-002 [High]: The named relationship decisions have no planned replacement for the one-existing-exception authorizer

* Related IDs: FR 4, AC relationship decisions, P02-T02, P02-T03, P03-T01.
* Evidence: scripts/author-cbro-packet.mjs; scripts/report-order-overlap.mjs; scripts/lib/cbro-evidence.mjs; test/cbro-historical-events.test.js.
* Concern: The current central relationship function authorizes only Kree-Skrull War as a candidate subset of Essential Avengers. Approval rejects every other non-none comparison and generates a Kree-Skrull-specific rationale. The candidate needs seven distinct non-none dispositions: two each for Phoenix and Dark Phoenix, plus two candidate subsets and one Marvel Multiverse partial for Days of Future Past. P02 says to record them, but does not assign an implementation task to replace the incompatible allow-list, bind each exact candidate, peer, relationship, shared IDs, and rationale, or prove no broader exception was introduced.
* Impact: Fresh complete-library reports will correctly surface the seven relationships but cannot be approved or authored through the current path. A generic exception would violate the plan's narrow-decision requirement and could authorize future accidental overlaps.
* Smallest useful change: Make P02-T03 explicitly own a release-scoped decision table and the central-authorizer change. Require an exact tuple for each permitted candidate, order ID, relationship, shared IDs, stronger-model authority identity, and non-generic rationale; retain the Kree-Skrull rule unchanged; reject every unlisted non-none tuple.
* Action owner: Planning parent.
* Exact resolving evidence: Focused tests generate digest-valid reports for all five mappings and prove approval succeeds for exactly the seven listed tuples, fails for each tuple with a changed candidate, peer, relationship, or shared-ID set, fails for an extra non-none comparison, and preserves the existing Kree-Skrull approval and its rejection for other candidates. The persisted five reports and approvals contain matching packet, mapping, report, library, and four-peer digests.
* Decision route: Direct planner correction.

<!-- rpi:critique id=PC-003 -->
### PC-003 [Medium]: The plan lacks a regression proof that the required inventory rebaseline did not rewrite deferred and blocked evidence

* Related IDs: FR 6, AC inventory counts, P01-T03, P03-T03, P04-T01.
* Evidence: scripts/lib/cbro-evidence.mjs; scripts/data/cbro-historical-inventory.json; test/cbro-historical-events.test.js.
* Concern: The current inventory identity digest deliberately covers every record except catalog IDs and delivery status. Batch two must legitimately alter selected-record central state, relationship data, reasons, and the digest. Once that digest is updated, the existing fabricated-record test no longer demonstrates that the remaining 53 records, including the four inherited terminal dispositions, were retained verbatim. The plan requires this outcome but does not assign an immutable-baseline test or release check.
* Impact: A mistaken edit to a deferred, absorbed, provenance-blocked, or metadata-blocked record can be normalized into the new digest and pass the generic inventory validator, contradicting the retained-blocker and nonselected-record requirements.
* Smallest useful change: Assign P01-T03 ownership of a focused baseline comparison that permits changes only to the five named IDs and permits only their documented fields. Re-run it after authoring and after final main reconciliation.
* Action owner: Planning parent.
* Exact resolving evidence: A test compares a checked-in preauthor inventory fixture or a purpose-built immutable projection with the candidate inventory, passes for the five documented records only, and fails for one changed field on each of a deferred record, Days of Future Present, Countdown, Legion Quest, and Marvel vs DC. Final validation records the passing comparison after the release reconciliation.
* Decision route: Direct planner correction.

## Strengths and Residual Risk

* The plan correctly treats source changes and catalog changes as invalidating downstream artifacts, requires full-library plus four-peer coverage, preserves source wording through packet evidence, and limits review to one critique and one postimplementation review.
* The source evidence supports the requested five-item boundary and 35-row count, but it cannot itself prove release-time freshness. The existing digest and release gates remain the appropriate control once the two contract migrations are planned.

## Questions or Blocking Evidence Gaps

* None. The supplied evidence identifies planner-owned contract and test changes; no significant or divergent user decision is needed.

## Limitations

* No external page, live metadata endpoint, hosted job, browser surface, unlisted source, or future generated artifact was inspected.
* This is the sole independent final-candidate critique requested for this plan. It does not perform the required postimplementation review.

## Relevant Artifacts

| Artifact | Description |
|---|---|
| [.copilot-tracking/research/2026-08-23/historical-event-reading-orders-batch-two-research.md](.copilot-tracking/research/2026-08-23/historical-event-reading-orders-batch-two-research.md) | Supplied source-order, metadata, and relationship research. |
| [.copilot-tracking/plans/2026-08-23/historical-event-reading-orders-batch-two-plan.md](.copilot-tracking/plans/2026-08-23/historical-event-reading-orders-batch-two-plan.md) | Candidate plan assessed by this critique. |
| [.copilot-tracking/details/2026-08-23/historical-event-reading-orders-batch-two-phase-details.md](.copilot-tracking/details/2026-08-23/historical-event-reading-orders-batch-two-phase-details.md) | Supplied phase execution detail. |

## Next Steps

* Planning parent: revise P01 through P03 to resolve PC-001 through PC-003, then finalize the plan without another critique. User response required: no.
