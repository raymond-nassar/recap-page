<!-- markdownlint-disable-file -->
# RPI Plan Critique: Historical event reading orders continuation

## Metadata

* Task ID: MRT-003-C02
* Critique date: 2026-08-23
* Plan: .copilot-tracking/plans/2026-08-23/historical-event-reading-orders-continuation-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/historical-event-reading-orders-continuation-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: Assess exactly one continuation batch at inventory positions
  1 through 5, with 32 exact unique issues and shelf chronology Wedding, Kree-Skrull War, Thanos War,
  The Night Gwen Stacy Died, Avengers/Defenders War. Kree-Skrull War requires central subset approval.
  The 58-entry inventory, original five shipped guides, all stated gates, one post-implementation
  Review, one PR, hosted CI, merge, and automatic continuation remain binding.
* Research and evidence considered:
  .copilot-tracking/research/2026-08-23/historical-event-reading-orders-continuation-research.md,
  .copilot-tracking/research/2026-08-23/historical-event-reading-orders-continuation-scan.json,
  .copilot-tracking/research/2026-08-23/historical-event-reading-orders-continuation-resolution.json,
  the supplied plan and phase details, and the current CBRO source and semantic test surfaces needed
  to assess implementability.
* Decisions, dependencies, and acceptance criteria considered: The fixed batch and chronology,
  current-source and current-main freshness, complete-library plus four-peer coverage, exact duplicate
  refusal, named Kree-Skrull War subset authority, additive release selection, atomic authoring,
  inventory preservation, all local and hosted gates, one Review, merge, durable closeout, and
  automatic next-batch handoff.
* Assessment boundary: This critique assessed the full supplied planning boundary once. It did not
  repeat candidate research, retrieve external sources, inspect sibling worktrees, or infer evidence
  absent from the supplied artifacts. Current source and tests were inspected only to verify that the
  proposed release, inventory, approval, and authoring changes are implementable against current main.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|---|---|---|
| Caller fixed batch and chronology | Covered | Resolution evidence contains the five required IDs, 32 unique issues, and the required first-on-sale order. |
| D1 through D8 | Covered | The plan carries the cutoff, retained dispositions, evidence refresh, gates, merge, and automatic continuation controls. |
| Q1 through Q6 and R1 through R6 | Covered | The supplied three-wave research closes the selection questions and identifies source, catalog, subset, range, chronology, and compatibility risks. |
| Functional requirements 1 through 10 | Covered | P01 through P03 define additive release selection, exact packets and mappings, scoped subset authority, authoring, inventory state, and release records. |
| Non-functional requirements | Covered | The plan retains zero runtime dependencies, CBH compatibility, atomic writes, stale rejection, central authority, and dash constraints. |
| Acceptance criteria | Partial | Product, evidence, test, browser, Review, CI, and merge outcomes are explicit, but post-merge evidence has no named durable sink. See PC-002. |
| P01-T01 through P02-T04 | Covered | Current main equals current origin/main, the inherited 14-case suite passes, and the named implementation surfaces can support release-keyed validation and the scoped subset decision. |
| P03-T01 through P03-T03 | Partial | The authoring sequence is credible, but P03-T01 miscounts the records that must remain unchanged. See PC-003. |
| P04-T01 through P04-T03 | Covered | The plan defines the full final gate set, exactly one independent Review, blocker routing, and no review loop. |
| P05-T01 through P05-T03 | Partial | Reconciliation, PR, hosted CI, merge, reporting, and continuation are present, but durable post-merge closeout is underspecified. See PC-002. |
| Critique Disposition and Planning Readiness | Missing | The plan and details record a specific completed critique outcome before this sole critique existed. See PC-001. |
| Range preservation risk | Partial | Packet tasks preserve printed ranges, but the risk statement incorrectly attributes range notation to all three timeline candidates. See PC-004. |

## Verdict

* Verdict: Revise
* Rationale: The batch selection and implementation path are credible, and the current 14-case CBRO
  baseline passes. Four direct planner corrections remain. The most important is replacing the
  pre-recorded critique outcome with this independent result. The plan must also name a durable
  post-merge evidence sink and correct two bounded evidence-preservation statements. None requires a
  new user decision or a second critique.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [High]: The sole critique outcome is recorded before the critique exists

* Related IDs: Caller sole-critique requirement; Critique Disposition; Planning Readiness; phase-details Initial Unresolved Items
* Evidence: .copilot-tracking/plans/2026-08-23/historical-event-reading-orders-continuation-plan.md states that exactly one critique already completed with verdict Revise and finding PC-001. .copilot-tracking/details/2026-08-23/historical-event-reading-orders-continuation-phase-details.md likewise claims the sole critique correction is already applied. The declared critique artifact was absent at critique start.
* Concern: The planning sources preselect the verdict, finding count, identifier, and resolution of the only independent critique. Those claims are not evidence of an executed independent assessment and do not match this complete four-finding set.
* Impact: Implementation could be handed off as Ready under a false control record, while the no-second-critique rule would make the actual unresolved findings easy to omit.
* Smallest useful change: After this critique, replace the predicted critique disposition and readiness text with this artifact's actual Revise verdict, PC-001 through PC-004, and their planner-owned resolutions. Do not run another critique.
* Action owner: Planning parent
* Exact resolving evidence: The plan's Critique Disposition lists PC-001 through PC-004 with their actual dispositions, the phase details no longer claim a prior sole-critique result, and Planning Readiness becomes Ready only after all four direct corrections are applied.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-002 -->
### PC-002 [Medium]: Post-merge completion has no named durable evidence sink

* Related IDs: D8; acceptance criterion for persisted merge completion; P05-T03
* Evidence: P05-T03 requires the PR number, merge commit, final digests, counts, Review outcome, hosted conclusions, and remaining inventory to be persisted before the next batch starts. The merge commit does not exist until after the feature branch is merged, and neither the plan nor phase details names a post-merge artifact or other durable write target.
* Concern: A pre-merge changes record cannot contain the actual merge commit. Session reports satisfy notification but not the requirement to persist completion before automatic continuation.
* Impact: The next batch can start without durable evidence that the preceding batch merged under the final CI and inventory state, weakening the cross-batch stale-evidence and exhaustion controls.
* Smallest useful change: Name one writable post-merge sink, such as an update to the merged PR body or a PR comment, and require it to record the merge commit, final source and library digests, issue and comparison counts, 58-entry inventory totals, Review outcome, and hosted job conclusions before the next session is created.
* Action owner: Planning parent
* Exact resolving evidence: P05-T03 names the durable post-merge sink and orders a successful write containing every listed closeout field before parent reporting and next-session kickoff.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-003 -->
### PC-003 [Low]: The authoring preservation count omits the original five

* Related IDs: Functional requirement 2; P03-T01; 58-entry acceptance criterion
* Evidence: P03-T01 says to ship the five continuation entries while leaving all 48 other records unchanged. The supplied and current inventory contains 58 records, so 53 records are outside this continuation batch. Those 53 include the original five shipped records plus 48 ranked or terminal records.
* Concern: The task-level count excludes the original five from the explicit unchanged set even though preserving them is a fixed caller requirement.
* Impact: An implementation following the task literally could treat the original five as outside the preservation assertion, despite broader plan text requiring backward compatibility.
* Smallest useful change: Replace 48 with 53 and explicitly state that the unchanged set includes the original five shipped records and the 48 ranked or terminal records.
* Action owner: Planning parent
* Exact resolving evidence: P03-T01 requires all 53 non-continuation records to remain unchanged and names the original five within that set; the 58-entry acceptance total remains 10 shipped, 44 ranked, and four terminal.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-004 -->
### PC-004 [Low]: The range risk overstates the supplied source evidence

* Related IDs: R4; P02-T01; P02-T04; Dependencies and Risks
* Evidence: The supplied research identifies two expanded multi-issue ranges, Avengers 89 through 97 and Amazing Spider-Man 121 through 122. The scan records the Wedding candidate as the singleton Fantastic Four Annual 3. The plan instead says the timeline source uses range notation for three candidates.
* Concern: The plan conflates three timeline-sourced candidates with three range-based candidates.
* Impact: Packet authoring or tests could invent a range reference for the singleton Wedding row, contrary to the exact-source requirement.
* Smallest useful change: State that three candidates come from the timeline, but only Kree-Skrull War and The Night Gwen Stacy Died expand printed ranges; the Wedding row remains a singleton with no invented range.
* Action owner: Planning parent
* Exact resolving evidence: The risk and P02 packet expectations distinguish the two expanded ranges from the singleton row, and P02-T04 tests range references only where the source printed a range.
* Decision route: Direct planner correction

## Strengths and Residual Risk

* The supplied resolution independently rechecked here contains five mappings, 32 issue rows, 32
  unique issue IDs, five reports, 505 comparisons, and exactly one non-none relationship: the
  nine-issue Kree-Skrull War candidate-subset of Essential Avengers.
* The required shelf chronology is derived from the supplied first-on-sale dates and is kept distinct
  from source positions 1 through 5.
* Current HEAD and origin/main are the same commit. The inherited CBRO semantic suite passes all 14
  cases, confirming the fixed-five baseline that the additive release contract must preserve.
* P01-T02 and P02-T03 correctly constrain the Kree-Skrull War exception across inventory validation,
  CBRO approval, disposition generation, and inventory identity digest recomputation without weakening
  the shared exact-duplicate refusal.
* Residual concurrency risk remains explicitly accepted by the caller: a relevant source or catalog
  change requires regeneration and full affected validation without a second Review.

## Questions or Blocking Evidence Gaps

* None. All findings are direct planner corrections. The caller already fixed the batch, chronology,
  subset approval, gates, Review count, PR, CI, merge, and continuation behavior.

## Limitations

* No candidate research or external retrieval was performed.
* No sibling worktree was inspected.
* The critique did not validate future generated packets, mappings, reports, product files, browser
  observations, live contract results, hosted CI, or merge evidence because those do not yet exist.
* The focused baseline test establishes current implementability, not the correctness of the future
  implementation.

## Recommended Next Action

* Highest-impact finding: PC-001
* Action owner: Planning parent
* Smallest next action: Revise the plan and phase details once to replace the predicted critique record
  with this actual four-finding result, apply PC-002 through PC-004, and then finalize the implementation
  handoff without another critique.
* User response required: No

## Relevant Artifacts

| Artifact | Description |
|---|---|
| [.copilot-tracking/plans/2026-08-23/historical-event-reading-orders-continuation-plan.md](.copilot-tracking/plans/2026-08-23/historical-event-reading-orders-continuation-plan.md) | Supplied MRT-003-C02 continuation plan |
| [.copilot-tracking/details/2026-08-23/historical-event-reading-orders-continuation-phase-details.md](.copilot-tracking/details/2026-08-23/historical-event-reading-orders-continuation-phase-details.md) | Supplied task-level phase details |
| [.copilot-tracking/research/2026-08-23/historical-event-reading-orders-continuation-research.md](.copilot-tracking/research/2026-08-23/historical-event-reading-orders-continuation-research.md) | Supplied three-wave research and fixed batch decision |
| [.copilot-tracking/research/2026-08-23/historical-event-reading-orders-continuation-scan.json](.copilot-tracking/research/2026-08-23/historical-event-reading-orders-continuation-scan.json) | Supplied source and metadata scan evidence |
| [.copilot-tracking/research/2026-08-23/historical-event-reading-orders-continuation-resolution.json](.copilot-tracking/research/2026-08-23/historical-event-reading-orders-continuation-resolution.json) | Supplied exact mappings, relationships, chronology, and remainder |
| [.copilot-tracking/reviews/plans/2026-08-23/historical-event-reading-orders-continuation-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-23/historical-event-reading-orders-continuation-plan-critique.md) | This sole independent plan critique |

## Next Steps

The active planning parent should apply PC-001 through PC-004 directly, finalize the revised plan and
phase details, and continue to implementation without another critique. No user action is required.
