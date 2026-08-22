<!-- markdownlint-disable-file -->
# RPI Plan Critique: Reading list expansion

## Metadata

* Task ID: MRT-002
* Critique date: 2026-08-22
* Plan: .copilot-tracking/plans/2026-08-22/reading-list-expansion-plan.md
* Phase details: .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: Find the most efficient repeatable way to add Comic Book
  Herald reading lists, divide implementation into one-list lower-cost worker assignments and
  integration chunks, and check every candidate against the current app library.
* Confirmed decisions considered:
  * CD-01: one frozen candidate packet and one mapping output per lower-cost worker.
  * CD-02: a central source owner freezes boundaries and chronology.
  * CD-03: a central reviewer owns current-library and peer overlap dispositions.
  * CD-04: exact duplicates stop, unapproved subsets stop, and partial overlap requires explicit
    stronger-model or human disposition.
  * CD-05: integration chunks add no more than three passing lists and may add fewer.
  * CD-06: all 22 pending modern Earth-616 candidates are completed or specifically routed before
    character or team inventory work.
  * CD-07: planning only, with zero runtime dependencies.
* Research and evidence considered: the supplied research, modern inventory, preparation, authoring,
  overlap and inventory modules, maintainer and provenance documentation, and the existing Comic Book
  Herald, inventory, resolver, and order-overlap tests named by the plan.
* Decisions, dependencies, and acceptance criteria considered: all functional and non-functional
  requirements, all acceptance criteria, P01 through P12 and their 60 tasks, shared pass and stop
  conditions, dependency gates, change limits, canonical and generated target ownership, test
  ownership, and per-chunk validation evidence.
* Assessment boundary: This critique assesses implementation credibility only from the supplied
  repository evidence. It does not re-evaluate Comic Book Herald pages, perform external research,
  or decide candidate source boundaries and overlap dispositions that the plan correctly reserves
  for implementation-time central review.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|------------------------------------------|----------|---------------------|
| Caller efficiency requirement; Q1-Q6 | Covered | The plan reuses the maintained inventory and existing preparation, resolution, overlap, authoring, and vendoring flow rather than creating a second ingestion system. |
| CD-01; worker context requirement | Partial | The one-packet and one-mapping boundary is present, but most mapping tasks do not state the exact inventory id, packet path, mapping path, and command needed by a lower-cost worker. See PC-003. |
| CD-02 | Covered | Packet boundary, exclusions, count, manifest proposal, chronology anchor, review identity, and digest are centrally owned before dispatch. |
| CD-03 and CD-04; P01-T03 and P01-T04 | Partial | Relationship ownership and outcomes are stated, but disposition storage, digest domains, and approval write order are not closed. See PC-002. |
| CD-05; P02-P11 | Covered | Every integration chunk is capped at three passing lists, and isolated risk candidates use one-list chunks. |
| CD-06; P09-P12 | Partial | All 22 candidates are named across the phase details, but three isolated stop paths cannot currently reach their terminal routing tasks and the inventory has no separate escalated status. See PC-001 and PC-005. |
| CD-07; runtime boundary | Covered | Runtime additions are excluded and the dependency maximum is zero. |
| Functional requirements | Partial | Preparation, review, authoring, stop behavior, and source fidelity are covered; deterministic worker addressing and closed freshness evidence need revision. |
| Non-functional requirements | Partial | Bounded context, chunk size, current-library completeness, and reproducibility are covered; the pilot success gate and evidence digest contract need revision. |
| Acceptance criteria | Partial | The candidate and relationship gates are credible, but the plan does not lock the aggregate addition maximum and cannot yet prove all terminal queue outcomes. |
| P01 | Partial | The intended generic workflow is credible, but approval and freshness artifacts need an exact contract and test ownership needs a consistent allocation. See PC-002 and PC-006. |
| P02 | Partial | The pilot is well selected, but its exit evidence does not require one successful end-to-end delivery before later chunks start. See PC-004. |
| P03-P08 | Covered | Routine chunks have central freeze, isolated mapping, complete available-peer review, conditional integration, and explicit validation ownership. |
| P09-P11 | Partial | Source, metadata, mapping, and overlap stop rules are sound, but their strict task dependencies bypass the final escalation writer when an earlier task stops. See PC-001. |
| P12 | Partial | Reconciliation intent is correct; terminal status encoding and the queue assertion's test ownership are unresolved. See PC-005 and PC-006. |
| Dependency graph | Partial | P01 precedes P02 and P12 waits for all chunks, but isolated failure outcomes and the pilot exit gate are not executable as written. |
| Locked change limits | Partial | Exact removals and per-chunk limits are locked; the aggregate maximum additions are not. See PC-007. |
| Canonical and generated ownership | Partial | Phase details correctly treat the curated-list manifest as canonical, while the plan's locked table omits it. See PC-008. |
| Test ownership and validation evidence | Partial | Commands and per-chunk owners are stated, but the all-P01 semantic test allocation conflicts with P12-T02. See PC-006. |

## Verdict

* Verdict: Revise
* Rationale: The selected architecture is evidence-backed and honors the confirmed decisions, but
  the final candidate is not yet implementation-safe. Three isolated candidates can stop before
  their terminal routing task becomes eligible, and the approval and freshness contract leaves
  central review evidence open to either immediate self-invalidation or stale acceptance. Six
  bounded planner corrections also remain in worker addressing, pilot admission, queue status,
  test allocation, aggregate scope, and canonical ownership. None requires a new user decision.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [High]: Isolated stop paths cannot reach terminal routing

* Related IDs: CD-06, P09-T01 through P09-T04, P10-T01 through P10-T04, P11-T01 through P11-T04,
  P12-T01, P12-T02
* Evidence: The P09-P11 task matrix in
  .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md makes each mapping task
  depend on a successful packet task, each relationship task depend on mapping, and each final
  integration-or-escalation task depend on relationship review. The same packet tasks explicitly
  stop when a boundary remains ambiguous or metadata is unavailable.
* Concern: If Secret Empire, Hunt for Wolverine, or Fall and Rise of X stops at admission, the
  later task that is supposed to persist its specific escalation is not eligible. A mapping stop
  creates the same dead end before relationship review.
* Impact: One of the original 22 candidates can remain `pending`, so P12 cannot truthfully prove
  queue completion even though every individual task followed its stop rule.
* Smallest useful change: Make each P09-T04, P10-T04, and P11-T04 depend on the recorded outcomes of
  all earlier phase tasks rather than their successful artifacts. Define how non-applicable mapping
  and relationship tasks are closed when an earlier stop occurs, or assign terminal inventory
  routing directly to the task that records the stop.
* Action owner: Planning parent
* Exact resolving evidence: Revised P09-P11 dependency rows show a complete success route and every
  early-stop route ending in a persisted candidate outcome that P12-T01 consumes; P12-T02 can reach
  zero pending candidates without inventing a packet, mapping, or report.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-002 -->
### PC-002 [High]: Approval and freshness evidence lack a closed artifact contract

* Related IDs: CD-03, CD-04, P01-T01, P01-T03, P01-T04, P01-T05
* Evidence: The research artifact leaves disposition location unresolved. The phase details say the
  reviewer writes overlap reports and approval fields in the mapping, while reports record input
  digests and the integrator rechecks mapping, report, and library digests. Existing
  scripts/report-order-overlap.mjs reports only relationship results, and
  scripts/author-cbh-packet.mjs accepts only zero-overlap reports and does not bind them to mapping
  or library content.
* Concern: The plan does not define where each per-comparison disposition lives, which exact fields
  each packet, mapping, library, and report digest covers, the canonical serialization, or whether
  reviewer-added approval fields are written before or after the mapping digest is captured.
* Impact: A correct implementation could invalidate its report merely by recording approval, while
  another plausible implementation could miss a changed source row, mapping sequence, manifest
  proposal, or shipped order payload. Either outcome breaks the central review gate.
* Smallest useful change: Add one artifact-contract table that selects the canonical location for
  each per-comparison disposition and authority, defines the fields and serialization covered by
  every digest, and states the freeze, map, report, approve, and author write order. State whether
  these are extensions to existing mapping and overlap formats under the one-new-schema limit.
* Action owner: Planning parent
* Exact resolving evidence: P01-T03 and P01-T04 name the disposition fields, digest inputs, and
  operation order; their owned tests prove exact rejection, approved subset and partial behavior,
  approval without self-staleness, and rejection after source, mapping-sequence, library, or
  disposition drift.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-003 -->
### PC-003 [Medium]: Lower-cost mapping tasks lack deterministic candidate addresses

* Related IDs: CD-01, worker context requirement, P02-T02 through P11-T02 and the corresponding
  routine mapping tasks
* Evidence: scripts/data/cbh-modern-inventory.json contains stable ids such as `x-of-swords`,
  `heroes-reborn-2021`, `last-annihilation`, `devils-reign`, and
  `fall-house-x-rise-powers-x`. Most phase task rows name only display titles and say "mapping only."
  The worker contract otherwise requires selection by stable inventory id.
* Concern: Several output names cannot be derived safely from their titles. The plan does not give
  every lower-cost worker the exact packet path, mapping path, and preparation command.
* Impact: A worker can select an unknown id, write a wrongly named mapping, or read broader context
  to discover the address, defeating the bounded low-cost handoff.
* Smallest useful change: Add a candidate dispatch table for all 22 records with task id, exact
  inventory id, frozen packet path, sole mapping output path, and deterministic command. Reference
  that row from every mapping task.
* Action owner: Planning parent
* Exact resolving evidence: Every lower-cost task can be executed using only its dispatch row and
  frozen packet, including the five non-obvious ids above, with exactly one declared writable path.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-004 -->
### PC-004 [Medium]: The pilot does not define the evidence that unlocks later chunks

* Related IDs: P02, P02-T05, P03-P11 dependencies
* Evidence: The plan calls P02 a proof of the model and says P03-P11 may proceed after "P02
  evidence," while every pilot candidate remains conditional and failed candidates may be routed
  without blocking peers.
* Concern: If both pilot mappings or dispositions stop, P02 can record valid outcomes without
  exercising authoring, vendoring, generated sequence checks, live contract validation, or browser
  validation. "P02 evidence" does not say whether that result unlocks nine later chunks.
* Impact: Large-scale dispatch can begin before the passing end-to-end path has been proven, which
  removes the risk-control purpose of the pilot.
* Smallest useful change: Define the P02 exit gate as at least one successfully integrated and fully
  validated pilot list. If neither candidate passes, keep routine chunks blocked and route a
  planner-owned choice of a replacement pilot or a P01/P02 correction.
* Action owner: Planning parent
* Exact resolving evidence: P03-P11 dependency text names the successful pilot evidence required;
  P02 has an explicit zero-pass branch that does not silently unlock routine delivery.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-005 -->
### PC-005 [Medium]: Specific escalation has no defined inventory representation

* Related IDs: CD-06, P09-T04, P10-T04, P11-T04, P12-T01, P12-T02
* Evidence: scripts/lib/cbh-inventory.mjs and test/cbh-modern-inventory.test.js permit pending,
  ready, shipped, and blocked for new-order records. The plan repeatedly treats "specifically
  escalated" as a third terminal outcome alongside shipped and blocked, while locking new logical
  schemas to the packet schema.
* Concern: The implementer must either invent an `escalated` lifecycle state, leave the record
  pending, or silently encode escalation as blocked without a stated evidence contract.
* Impact: Queue reconciliation and its zero-pending assertion can disagree about whether an
  escalated candidate is terminal, and an unplanned status extension would breach the locked
  boundary.
* Smallest useful change: Define every implementation-time escalation as the existing `blocked`
  delivery status with a specific reason that names the unresolved decision and route owner, unless
  the planner intentionally amends the lifecycle and change limits.
* Action owner: Planning parent
* Exact resolving evidence: P12 contains a state-transition table mapping every stop reason to
  shipped or blocked, with the required reason content and route owner; no candidate can satisfy
  reconciliation through an unknown status.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-006 -->
### PC-006 [Medium]: Semantic test ownership contradicts queue reconciliation

* Related IDs: P01-T05, P12-T02, locked test maximum, test ownership
* Evidence: The phase details lock at most 12 new semantic tests and assign all of them to P01.
  P12-T02 separately requires a new automated assertion that the original 22 ids have zero pending
  records. The existing test/cbh-modern-inventory.test.js validates allowed lifecycle values but
  does not assert that those 22 ids are terminal.
* Concern: Adding the real queue assertion during P01 makes P01 fail until all delivery phases are
  complete; adding it during P12 violates the statement that all new semantic tests belong to P01.
* Impact: The plan cannot satisfy its phase completion and test-ownership rules at the same time.
* Smallest useful change: Reserve one of the 12 semantic cases for P12-T02 in the existing inventory
  test file and cap P01 at the remaining cases. Keep the total maximum and zero-new-test-file lock.
* Action owner: Planning parent
* Exact resolving evidence: The test ownership table allocates an exact maximum to P01 and one
  queue-terminal assertion to P12-T02, and P12 requires proof that this assertion fails against the
  pre-reconciliation inventory before it passes.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-007 -->
### PC-007 [Medium]: The aggregate catalog addition maximum is not locked

* Related IDs: locked change boundary, CD-05, CD-06, P02-P11
* Evidence: The plan locks exact removals to none and each integration chunk to no more than three
  additions. It names 22 pending candidates but does not state an aggregate maximum additions value
  in the locked boundary.
* Concern: The acceptance boundary requires locked maximum additions and exact removals. Per-chunk
  limits alone do not prevent an extra candidate or replacement candidate from expanding aggregate
  scope across ten chunks.
* Impact: Scope validation cannot mechanically distinguish the intended queue from an implementation
  that adds more than the original 22 catalog lists.
* Smallest useful change: Lock maximum catalog additions to 22, restricted to the original pending
  inventory ids, while retaining the per-chunk maximum of three and allowing fewer additions.
* Action owner: Planning parent
* Exact resolving evidence: The locked boundary contains "maximum catalog additions: 22 from the
  original pending id set" and "exact removals: none," and P12 reconciles that same fixed id set.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-008 -->
### PC-008 [Medium]: Canonical manifest ownership is inconsistent

* Related IDs: canonical and generated target ownership, P01-T04, integration tasks
* Evidence: The plan's locked table lists canonical inputs but omits
  src/data/curated-lists.json, then describes catalog output as generated from canonical order and
  manifest inputs. The phase details correctly list the curated-list manifest as canonical and
  browser order JSON and catalog payloads as generated.
* Concern: The two implementation records disagree on whether the manifest is an authored canonical
  input or a generated output.
* Impact: A central integrator or later automation can update the wrong surface or fail to verify
  the manifest-to-catalog generation boundary.
* Smallest useful change: Add src/data/curated-lists.json to the plan's canonical inputs and state
  that the central integrator owns it once per chunk; keep catalog payloads and browser order JSON
  under generated outputs.
* Action owner: Planning parent
* Exact resolving evidence: The plan and phase details contain the same canonical and generated
  target list and assign each shared canonical edit to the central integrator.
* Decision route: Direct planner correction

## Strengths and Residual Risk

* The recommendation reuses a mature build-time workflow and keeps runtime dependencies at zero.
* The current app library, not a frozen count, is correctly the comparison baseline.
* The staged identity-before-dispatch and relationship-after-resolution model is credible.
* Central source, relationship, and integration ownership prevents lower-cost workers from making
  editorial or shared-file decisions.
* The 22-item queue is complete across P02-P11, and the chunk cap is consistently no more than three
  passing additions.
* Exact duplicate, subset, partial, and no-overlap outcomes are grounded in existing comparison
  behavior rather than a blanket zero-overlap rule.
* Residual per-candidate source and metadata uncertainty is appropriately deferred to explicit
  admission and stop gates rather than asserted away during planning.

## Questions or Blocking Evidence Gaps

* None. The findings can be resolved from the supplied evidence and confirmed decisions without a
  significant or divergent user choice.

## Limitations

* No external source page was re-fetched, so this critique does not validate the proposed editorial
  boundary or issue count of any candidate.
* No implementation command or repository gate was run because the requested work is a read-only
  plan critique.
* Candidate admission remains conditional on implementation-time packet freeze, exact resolution,
  metadata coverage, and current-library comparison.

## Recommended Next Action

* Highest-impact finding: PC-001
* Action owner: Planning parent
* Smallest next action: Revise the P09-P11 outcome dependencies first so every early stop reaches a
  persisted terminal route, then apply PC-002 through PC-008 in the same finalization pass.
* User response required: No

| Artifact | Description |
|----------|-------------|
| [.copilot-tracking/plans/2026-08-22/reading-list-expansion-plan.md](.copilot-tracking/plans/2026-08-22/reading-list-expansion-plan.md) | Final-candidate plan assessed across P01-P12. |
| [.copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md](.copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md) | Task ownership, dependencies, pass and stop rules, limits, and queue details. |
| [.copilot-tracking/research/2026-08-22/reading-list-expansion-research.md](.copilot-tracking/research/2026-08-22/reading-list-expansion-research.md) | Evidence, selected workflow, alternatives, and residual uncertainty. |
| [scripts/data/cbh-modern-inventory.json](scripts/data/cbh-modern-inventory.json) | Maintained 86-record inventory containing the 22 pending ids. |
| [scripts/prepare-cbh-batch.mjs](scripts/prepare-cbh-batch.mjs) | Current hard-coded preparation and mapping writer. |
| [scripts/author-cbh-packet.mjs](scripts/author-cbh-packet.mjs) | Current packet author and overlap gate. |
| [scripts/report-order-overlap.mjs](scripts/report-order-overlap.mjs) | Current full-library and peer report entry point. |
| [scripts/lib/cbh-overlap.mjs](scripts/lib/cbh-overlap.mjs) | Relationship classification and report construction. |
| [scripts/lib/cbh-inventory.mjs](scripts/lib/cbh-inventory.mjs) | Identity, duplicate, and inventory lifecycle validation. |
| [docs/MAINTAINING.md](docs/MAINTAINING.md) | Existing source-to-catalog maintenance workflow. |
| [docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md) | Permission, credit, source-link, and reuse boundary. |
| [test/cbh-batch.test.js](test/cbh-batch.test.js) | Existing packet fidelity and author gate tests. |
| [test/cbh-batch-two.test.js](test/cbh-batch-two.test.js) | Existing second-batch integration and overlap tests. |
| [test/cbh-batch-three.test.js](test/cbh-batch-three.test.js) | Existing third-batch chronology, fidelity, and overlap tests. |
| [test/cbh-batch-four.test.js](test/cbh-batch-four.test.js) | Existing fourth-batch chronology, fidelity, and overlap tests. |
| [test/cbh-modern-inventory.test.js](test/cbh-modern-inventory.test.js) | Existing inventory and lifecycle tests. |
| [test/cbh-resolver.test.js](test/cbh-resolver.test.js) | Existing mapping resolution and approval-preservation tests. |
| [test/order-overlap-report.test.js](test/order-overlap-report.test.js) | Existing relationship and full-library report tests. |
| [.copilot-tracking/reviews/plans/2026-08-22/reading-list-expansion-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-22/reading-list-expansion-plan-critique.md) | Complete final-candidate critique and actionable finding set. |

## Next Steps

Run `/rpi-plan` to apply PC-001 through PC-008 and finalize the plan. No user decision is required.
