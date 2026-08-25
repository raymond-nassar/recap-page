<!-- markdownlint-disable-file -->
# RPI Plan Critique: Licensed tie-in exclusion batch

## Metadata

* Task ID: MRT-003-C02-B04
* Critique date: 2026-08-24
* Plan: .copilot-tracking/plans/2026-08-24/licensed-character-issues-plan.md
* Phase details: .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: Exactly Wraith War, Secret Wars II, and Mutant Massacre;
  exact exclusions ROM #40-66, ROM Annual #3, ROM #72, Micronauts Vol. 2 #16, and Power Pack #27;
  conservation of each source row as included or approved excluded; rejection of every other omission;
  retained counts 7, 40, and 11; correction of the Wraith count from 30 to 28; exact exclusion ledgers
  and retained positions; complete relationship reports; reader disclosure; non-complete depth where
  needed; no invented IDs, URLs, availability, or precedent; unchanged position-17 Evolutionary War
  cursor; supplemental Comic Book Herald evidence held for future work only; no removals; no more than
  three packets, mappings, reports, checklists, payloads, or catalog entries; the named semantic and
  shared regression test owners; and existing tools and gates only.
* Research and evidence considered:
  .copilot-tracking/research/2026-08-24/licensed-character-issues-research.md;
  .copilot-tracking/research/2026-08-23/historical-event-source-pages.json;
  .copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-research.md;
  .copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-three-plan.md;
  .copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-three-phase-details.md;
  .copilot-tracking/reviews/plans/2026-08-24/historical-event-reading-orders-batch-three-plan-critique.md;
  .copilot-tracking/reviews/logs/2026-08-24/historical-event-reading-orders-batch-three-review.md; and
  .copilot-tracking/changes/2026-08-24/historical-event-reading-orders-batch-three-changes.md.
* Decisions, dependencies, and acceptance criteria considered: All requirements, goals, scope,
  functional and non-functional requirements, acceptance criteria, P01 through P05 phases, P01-T01
  through P05-T02 tasks, task and phase dependencies, risk and stop conditions, canonical and
  generated targets, validation ownership, critique and Review limits, and delivery handoff.
* Assessment boundary: This is the one final-candidate critique for the supplied boundary. It assesses
  credibility and completeness from the supplied inputs and committed predecessor artifacts only. It
  does not independently re-query source pages or metadata endpoints, invent unresolved release
  values, or validate implementation that does not yet exist.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|---|---|---|
| Exact three-guide scope | Covered | The plan and details name only Wraith War, Secret Wars II, and Mutant Massacre and prohibit a fourth guide. |
| Exact 31-row exclusion boundary | Covered | The named ROM, ROM Annual, Micronauts, and Power Pack exclusions agree with the supplied source snapshot and research. |
| Conservation and rejection of every other omission | Covered | FR1 through FR3, P01-T01, P02-T01, and AC1 through AC3 require complete position ranges, exact ledgers, retained positions, and mutation rejection. |
| Retained counts 7, 40, and 11 | Covered | The counts agree across plan, details, research, and the 89-row source evidence. |
| Wraith correction 30 to 28 | Covered | The plan and P03-T03 require the correction; research identifies the 28 exact Wraith exclusions. |
| Reader disclosure and non-complete depth | Covered | P03-T01 requires stable disclosure, retained and omitted counts, affected series, the full source link, and non-complete depth for all three guides. |
| No invented IDs, URLs, availability, or reasons | Covered | P02-T02 excludes metadata for omitted rows and stops the release if any retained row cannot resolve exactly. |
| Guide-scoped decision with no precedent | Covered | Requirements, P01-T01 decision scope, P02 boundaries, and P05-T01 review expectations keep approval release-scoped and reject unsupported exclusions. |
| Complete relationship reports | Covered | P02-T03 requires the current pre-author catalog baseline, both selected peers, every expected order exactly once, exact non-none decisions, and stale-evidence rejection. |
| Evolutionary War position 17 unchanged | Covered | Scope, inventory authority, acceptance criteria, direct records, review, and handoff all preserve the deferred cursor. |
| Supplemental Comic Book Herald source future-only | Covered | Scope and P03-T03 record it as future evidence without replacing the CBRO cursor. |
| Locked addition and removal boundary | Covered | The details state no removals and maxima of three for every bounded evidence and product artifact class. |
| P01-T01 conservation primitives | Covered | Optional structured exclusions, legacy compatibility, digest binding, source-position reconstruction, and rejection cases are specified. |
| P01-T02 release and inventory authority | Partial | Its author order depends on P02 mappings while P02 is declared dependent on completed P01 release identity. See PC-001. |
| B03 compatibility preservation | Partial | Earlier compatibility projections must remain, but the exact preservation mechanism for the B03 nonselected digest is not stated. See PC-002. |
| P02-T01 and P02-T02 packet and mapping evidence | Covered | Exact source positions, retained counts, positive configured identities, canonical URLs, zero placeholders, and stop conditions are explicit. |
| P02-T03 reports and approvals | Covered | Complete baseline and peer coverage, exact tuples, release-scoped decisions, and freshness are required. |
| P03-T01 and P03-T02 canonical and generated product state | Covered | Exactly three checklists, payloads, and cards with 58 retained rows, deterministic disclosure, and chronology-aware placement are required. |
| P03-T03 delivery records | Covered | Changelog, backlog, provenance, exact rederived counts, corrected blocker history, and future cursor are included. |
| P04-T01 validation ownership | Covered | test/cbro-historical-events.test.js owns B04 semantics; test/cbh-batch.test.js owns legacy and repeated-row shared regression. |
| P04-T02 existing gates only | Covered | Existing focused tests, lint, bare tests, counts, sizes, palette, anchors, publication, live contract, dash scan, and installed Edge are named; no new tool or dependency is allowed. |
| Failure proof | Covered | A smallest reversible conservation mutation must produce a named failure before restoration and final validation. |
| P05 single Review and delivery | Covered | Exactly one post-implementation Review, one routed fix pass, final reruns, commit, plain-English-first pull request, and hosted readiness are specified. |
| Canonical and generated target inventory | Partial | The locked canonical list omits required propagation and authoring scripts, and omits the declared shared regression owner even though later tasks target all three. See PC-003. |
| Acceptance criteria and stop conditions | Covered | Counts, conservation, metadata exactness, report completeness, compatibility, inventory, final validation, and one-critique and one-Review limits are testable once the three findings are corrected. |

## Verdict

* Verdict: Revise
* Rationale: The plan faithfully represents the caller's product and evidence requirements, exact
  arithmetic, scope limits, validation owners, and delivery gates. Three direct planner corrections
  are required before implementation. The phase graph currently contains a dependency cycle, the
  predecessor's nonselected inventory invariant can be accidentally re-blessed instead of preserved,
  and the locked target list conflicts with tasks that must propagate and render structured
  exclusions. None requires a new user decision or more research, and no second critique is warranted.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [High]: Release authority and mapping preparation form a dependency cycle

* Related IDs: P01, P01-T02, P02, P02-T01, P02-T02, Dependencies
* Evidence: .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md states
  that P01-T02 author order is derived from exact first-on-sale dates in P02 and must be recorded
  before approval. The same artifact makes P02 depend on P01 validators and release identity. The
  plan likewise makes P02 depend on P01 release authority.
* Concern: P01-T02 cannot be completed until P02 produces exact mappings, while P02 cannot start
  under its stated dependency until P01-T02 has completed release identity. The research intentionally
  does not freeze or invite guessing of the final author order.
* Impact: Implementation either stalls, bypasses its declared gate, or records a guessed chronology
  merely to unlock canonical mapping. Any of those outcomes weakens the no-invention and exact release
  requirements.
* Smallest useful change: Split or reorder the dependency so exclusion validation and exact source
  identity unlock packet and mapping preparation first, then finalize author order and complete B04
  release authority from the exact P02 mappings before reports, approval, or authoring. Update the
  affected phase and task dependency statements together.
* Action owner: Planning parent
* Exact resolving evidence: The revised plan and phase details present an acyclic task graph in which
  P02-T02 exact mappings precede final author-order authority, while P02-T03 approval and all P03 work
  remain dependent on the finalized known release.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-002 -->
### PC-002 [High]: The B03 nonselected inventory invariant lacks an exact preservation mechanism

* Related IDs: P01-T02, NFR3, AC6, inventory compatibility risk
* Evidence: The committed B03 plan and critique require a distinct
  `CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256` and preserve earlier compatibility constants.
  The B03 changes record explains that historical projections are preserved by normalization rather
  than by updating their constants. B04 changes positions 12 through 14, which belonged to the B03
  nonselected projection. The B04 details say only to preserve earlier projections and add a B04
  untouched projection.
* Concern: The plan does not explicitly prohibit updating the B03 digest or state how positions 12
  through 14 are reconstructed to their exact B03 blocked projections when the B03 invariant is
  checked.
* Impact: An implementation can make the new tree green by rederiving the B03 constant against the
  changed records, silently deleting the historical guard that proves B03's nonselected inventory
  stayed unchanged. This is especially risky because the same work corrects Wraith's stale count and
  changes all three delivery states.
* Smallest useful change: Require a new B04 nonselected or untouched digest and filter, preserve the
  B03 constant and filter unchanged, and define exact normalization of positions 12 through 14 back
  to their committed B03 blocked projections solely when validating the B03 compatibility invariant.
* Action owner: Planning parent
* Exact resolving evidence: P01-T02 completion evidence names the new B04 invariant, explicitly says
  not to update `CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256` or its filter, and requires a semantic
  test that fails if the B03 constant is changed or any normalized B03 projection differs.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-003 -->
### PC-003 [Medium]: The locked canonical target list conflicts with required task targets

* Related IDs: Locked Change Boundary, P01-T01, P02-T02, P02-T03, P03-T01, P04-T01
* Evidence: .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md lists
  scripts/prepare-cbro-event.mjs, scripts/author-cbro-packet.mjs, and test/cbh-batch.test.js as required
  task or validation targets, but the same artifact's locked canonical target list omits all three.
* Concern: The implementation cannot propagate the exclusion ledger through mappings or render
  deterministic reader disclosure without the two production scripts, while the shared regression
  requirement cannot be durably owned without its named test file.
* Impact: Following the locked list leaves the exclusion contract incomplete. Following the tasks
  violates the declared change boundary and makes final scope reconciliation ambiguous.
* Smallest useful change: Add scripts/prepare-cbro-event.mjs, scripts/author-cbro-packet.mjs, and
  test/cbh-batch.test.js to the locked canonical target inventory. Replace the open-ended
  "applicable maintenance record" wording with the exact direct record targets or name any additional
  justified target before implementation.
* Action owner: Planning parent
* Exact resolving evidence: The revised locked target inventory contains every production, test,
  canonical data, generated data, and direct record target named by P01 through P04, with no unnamed
  maintenance target left open.
* Decision route: Direct planner correction

## Strengths and Residual Risk

* The exclusion arithmetic is exact: 35 plus 42 plus 12 source rows equals 89; 28 plus 2 plus 1
  approved exclusions equals 31; and 7 plus 40 plus 11 retained rows equals 58.
* The supplied source positions support complete conservation ranges and the exact approved exclusion
  set. No other source row is authorized for omission.
* Reader truthfulness is strong: the plan avoids reader-owned availability overrides, requires
  non-complete depth, identifies observable discoverability rather than asserting an unverified legal
  cause, and links the full source chronology.
* The plan preserves current catalog and peer comparison completeness, digest freshness, exact
  relationship decisions, backward compatibility for packets without exclusions, and rejection of
  stale evidence.
* The locked three-guide boundary, unchanged position-17 cursor, and future-only supplemental source
  treatment are repeated across implementation, validation, Review, and handoff.
* Residual implementation risk remains in live metadata and catalog drift, but the plan explicitly
  stops and regenerates rather than inventing or shortening when either occurs.

## Questions or Blocking Evidence Gaps

* None. All three findings are direct planner corrections supported by the supplied evidence.

## Limitations

* This critique does not validate live metadata or predict the final chronology and non-none
  relationship tuples. The plan correctly treats those as evidence outputs and stop conditions.
* No implementation gates were run because the task is a read-only final-candidate plan critique.

## Recommended Next Action

* Highest-impact finding: PC-001
* Action owner: Planning parent
* Smallest next action: Make the phase graph acyclic, then apply the exact B03 compatibility guard and
  locked-target corrections in the same final planning revision.
* User response required: No

## Relevant Artifacts

| Artifact | Description |
|---|---|
| [.copilot-tracking/plans/2026-08-24/licensed-character-issues-plan.md](.copilot-tracking/plans/2026-08-24/licensed-character-issues-plan.md) | Final-candidate implementation plan assessed by this critique. |
| [.copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md](.copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md) | Task dependencies, targets, ownership, and completion evidence assessed by this critique. |
| [.copilot-tracking/research/2026-08-24/licensed-character-issues-research.md](.copilot-tracking/research/2026-08-24/licensed-character-issues-research.md) | Confirmed exclusion decision, counts, retained metadata state, and future-source boundary. |
| [.copilot-tracking/research/2026-08-23/historical-event-source-pages.json](.copilot-tracking/research/2026-08-23/historical-event-source-pages.json) | Frozen source rows, positions, URLs, and source digests for the three guides. |
| [.copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-three-plan.md](.copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-three-plan.md) | Committed predecessor release and compatibility contract. |
| [.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-research.md](.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-research.md) | Committed predecessor blocker, catalog, relationship, and cursor evidence. |
| [.copilot-tracking/reviews/plans/2026-08-24/historical-event-reading-orders-batch-three-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-24/historical-event-reading-orders-batch-three-plan-critique.md) | Predecessor compatibility and inventory-authority critique. |
| [.copilot-tracking/reviews/logs/2026-08-24/historical-event-reading-orders-batch-three-review.md](.copilot-tracking/reviews/logs/2026-08-24/historical-event-reading-orders-batch-three-review.md) | Committed predecessor implementation Review and routed findings. |
| [.copilot-tracking/reviews/plans/2026-08-24/licensed-character-issues-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-24/licensed-character-issues-plan-critique.md) | This sole final-candidate critique. |

## Next Steps

The active planning parent should apply PC-001 through PC-003 directly, finalize the plan without a
second critique, and continue to implementation only after the revised dependency graph,
compatibility invariant, and locked target inventory agree. No user action is required.
