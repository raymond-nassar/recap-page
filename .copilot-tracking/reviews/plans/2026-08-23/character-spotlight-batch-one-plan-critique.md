<!-- markdownlint-disable-file -->
# RPI Plan Critique: Character spotlight batch one

## Metadata

* Task ID: MRT-002-C02
* Critique date: 2026-08-23
* Plan: .copilot-tracking/plans/2026-08-23/character-spotlight-batch-one-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/character-spotlight-batch-one-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: Fresh final-candidate critique only. Assess the locked two-guide Phalanx and Phoenix scope, the one-critique and one-Review limit, the candidate-only import rule from commit f2d5dda64ad388b5c00af027acb3f8f2d7e9a0a8, the central-authority boundary, the exact counts and relationship requirements, the no-widening constraints, and the required release path through targeted tests, lint, full tests, anchors with reading before bless, live contract, Edge at 1280x900, PR, hosted Node 20, hosted Node 24, hosted lint, reconciliation if needed, and merge.
* Research and evidence considered: .copilot-tracking/research/2026-08-23/character-spotlight-batch-one-research.md; .copilot-tracking/rpi-sessions/2026-08-23/character-spotlight-batch-one-state.json; scripts/lib/cbh-inventory.mjs; scripts/prepare-cbh-batch.mjs; scripts/report-order-overlap.mjs; scripts/author-cbh-packet.mjs; test/cbh-character-spotlight.test.js; test/licence-boundary.test.js; test/cbh-batch.test.js; test/order-overlap-report.test.js; scripts/data/cbh-character-inventory.json; src/data/curated-lists.json.
* Decisions, dependencies, and acceptance criteria considered: Research closes shard 1 and shard 2 for this batch, fixes final scope to Phalanx and Phoenix only, and accepts the below-floor two-guide release under the explicit risk clause. The state file locks one critique maximum, one Review maximum, and hosted checks test (20), test (24), and lint. The plan and phase details must therefore be implementation-ready without a second critique pass.
* Assessment boundary: This critique assesses only the supplied plan, phase details, state, research, and directly named executable and test contracts needed to judge implementation readiness. It does not re-run live validation, reopen research, or infer missing operational steps as already planned when they are not written in the supplied artifacts.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|---|---|---|
| User requirements: selected batch, authority boundary, no scope widening | Covered | The plan and phase details consistently lock Phalanx and Phoenix only, keep worker prose inert, and route protected decisions centrally. |
| Research C13-C14, W1-W2, P01, P01-T01, P01-T02 | Covered | Packet import, Phalanx copy correction, and mapping regeneration align with the accepted shard 3 evidence and the digest-binding preparation contract. |
| Functional requirements for 87-list plus reciprocal peer reports, P02, P02-T01 | Covered | The plan correctly carries 88-comparison reports, reciprocal peer digests, the two eight-issue Phalanx partials, and central relationship approval. |
| P02-T02, canonical inventory target, acceptance criterion for shipped identities | Partial | The plan says positions 89 and 90 advance from deferred to shipped, but the live validator requires a fuller state tuple, and Phalanx also needs explicit overlapIds coverage. |
| User requirement for PR, hosted CI, reconciliation, and merge; P03; P03-T02; state required_hosted_checks | Partial | The written execution path stops at a review-ready diff and Review handoff, without an explicit task that carries the required PR, hosted checks, CI interpretation, reconciliation, and merge work to closure. |
| Locked change and test boundary | Covered | Exact removals none, ten new production data artifacts maximum, zero new test files, and existing focused/regression owners are all consistent with the bounded two-guide change. |

## Verdict

* Verdict: Revise
* Rationale: The selected Phalanx and Phoenix scope is evidence-backed and the central digest workflow is credible, but the plan still has two execution-critical gaps: it does not spell the exact character-inventory end state the validator accepts, and it does not task the required post-Review PR, hosted-CI, reconciliation, and merge path. Both are planner-owned corrections and should be fixed before implementation starts.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [High]: The written execution path stops before the required PR, hosted CI, reconciliation, and merge work

* Related IDs: User requirements, Goals, Scope and Non-Goals, P03, P03-T02
* Evidence: .copilot-tracking/plans/2026-08-23/character-spotlight-batch-one-plan.md; .copilot-tracking/details/2026-08-23/character-spotlight-batch-one-phase-details.md; .copilot-tracking/rpi-sessions/2026-08-23/character-spotlight-batch-one-state.json
* Concern: The user-required release path includes one independent Review, PR creation, hosted checks test (20), test (24), and lint, CI interpretation, reconciliation if needed, and merge. The plan names that path in scope language, but the executable phase flow ends at "review-ready diff" and "Review handoff." No phase or task defines how the work reaches PR open, hosted CI completion, reconciliation, or merge.
* Impact: The task can be declared complete while still missing required release work, or the implementer can improvise that work after review without plan-level acceptance criteria. That creates exactly the kind of late-scope ambiguity the one-critique limit is meant to avoid.
* Smallest useful change: Add an explicit post-Review release task or phase, after the independent Review, that names PR creation, hosted checks test (20), test (24), and lint, CI conclusion reading, reconciliation if needed, and merge as required completion work with durable evidence expectations.
* Action owner: planning parent
* Exact resolving evidence: Revised plan and phase details show a dependency-ordered post-Review release task or phase whose completion evidence includes a PR, the three hosted job results, any needed reconciliation, and merge completion, so the written path reaches the user-required endpoint rather than stopping at review readiness.
* Decision route: direct planner correction

<!-- rpi:critique id=PC-002 -->
### PC-002 [Medium]: The inventory end state is under-specified against the live character-inventory validator

* Related IDs: Functional requirement for maintained inventory, Acceptance criteria, P02-T02, canonical inventory target, Research C1 and C9
* Evidence: .copilot-tracking/plans/2026-08-23/character-spotlight-batch-one-plan.md; .copilot-tracking/details/2026-08-23/character-spotlight-batch-one-phase-details.md; scripts/lib/cbh-inventory.mjs; scripts/data/cbh-character-inventory.json; test/cbh-character-spotlight.test.js
* Concern: The plan says the canonical inventory target should "advance only positions 89 and 90 from deferred to shipped." That is not the actual terminal state the validator enforces. The current character-inventory contract ties a shipped character record to disposition new-order, deliveryStatus shipped, centralDisposition pilot-approved, and metadataHorizonStatus approved. White Tiger also shows that shipped records carry catalogIds and overlapIds. The plan never states the exact tuple Phalanx and Phoenix must reach, or that Phalanx's shipped overlapIds must record xmen-claremont and xmen-claremont-complete while Phoenix remains empty.
* Impact: Implementation can satisfy the plan's prose while still failing validateInventoryState or leaving the shipped inventory record incomplete, which would force avoidable late rework in a shared canonical file.
* Smallest useful change: Replace the loose "deferred to shipped" wording with the exact final state required for both records, including disposition, deliveryStatus, centralDisposition, metadataHorizonStatus, catalogIds, and overlapIds expectations.
* Action owner: planning parent
* Exact resolving evidence: Revised plan and phase details state that only positions 89 and 90 mutate, and each final record must match the validator-backed shipped tuple in scripts/lib/cbh-inventory.mjs, with Phalanx listing the two approved overlap ids and Phoenix listing none.
* Decision route: direct planner correction

## Strengths and Residual Risk

* The core selection logic is credible. Research closes shard 1 and shard 2, proves Phalanx and Phoenix are peer-disjoint exact mappings inside the horizon, and explicitly accepts the reduced two-guide batch under the caller's risk clause.
* P01 and P02 are well-bounded. Import-only shard 3 reuse, central source review replacement, Phalanx copy correction, exact mapping regeneration, 88-comparison reports, and reciprocal peer approval all align with the existing executable contracts.
* Residual risk remains acceptable once the planner fixes the two findings above: the two known Phalanx partials are already identified, bounded, and routed to central approval rather than left implicit.

## Questions or Blocking Evidence Gaps

* None.

## Limitations

* This critique did not rerun live contract, browser, or hosted CI validation. It assessed plan credibility from the supplied artifacts and the current repository contracts only.
* Shard 1 scratch output was not inspected, per the caller boundary and research closure.

## Recommended Next Action

* Highest-impact finding: PC-001
* Action owner: planning parent
* Smallest next action: Revise the plan and phase details once to add the missing post-Review release path and the exact inventory terminal state, then proceed directly to implementation without another critique.
* User response required: no

| Artifact | Description |
|---|---|
| [.copilot-tracking/plans/2026-08-23/character-spotlight-batch-one-plan.md](.copilot-tracking/plans/2026-08-23/character-spotlight-batch-one-plan.md) | Final-candidate implementation plan under critique. |
| [.copilot-tracking/details/2026-08-23/character-spotlight-batch-one-phase-details.md](.copilot-tracking/details/2026-08-23/character-spotlight-batch-one-phase-details.md) | Phase and task detail record for the same plan. |
| [.copilot-tracking/research/2026-08-23/character-spotlight-batch-one-research.md](.copilot-tracking/research/2026-08-23/character-spotlight-batch-one-research.md) | Research boundary, candidate selection, and evidence basis for the two-guide scope. |
| [.copilot-tracking/rpi-sessions/2026-08-23/character-spotlight-batch-one-state.json](.copilot-tracking/rpi-sessions/2026-08-23/character-spotlight-batch-one-state.json) | State lock for one critique, one Review, and required hosted checks. |
| [.copilot-tracking/reviews/plans/2026-08-23/character-spotlight-batch-one-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-23/character-spotlight-batch-one-plan-critique.md) | This critique artifact. |

## Next Steps

No user action is required. The planning parent should revise the plan directly to resolve PC-001 and PC-002, then continue to implementation under the existing one-critique limit.
