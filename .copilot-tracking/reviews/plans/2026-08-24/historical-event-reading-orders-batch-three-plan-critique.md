<!-- markdownlint-disable-file -->
# RPI Plan Critique: Historical event reading orders batch three

## Metadata

* Task ID: MRT-003-C02-B03
* Critique date: 2026-08-24
* Plan: .copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-three-plan.md
* Phase details: .copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-three-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: One automatic RPI lifecycle for batch three of the historical CBRO
  program. Candidate positions 11-16 evaluated in source order with exclusive pre-Maximum Security
  cutoff. Batch authority reduced to three guides (positions 11, 15, 16) due to exact mapping risk.
  Exact blocker retention for positions 12-14. One critique, one independent implementation review,
  full release gates, PR, and merge. Creator orchestration for any subsequent batch.
* Research and evidence considered:
  .copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-research.md
  .copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-resolution.json
* Decisions, dependencies, and acceptance criteria considered: Direction controls D1-D7; research batch
  decision (positions 11, 15, 16 admitted; 12, 13, 14 blocked); planning readiness contract; canonical
  and generated target table; phase completion evidence; acceptance criteria in plan; five exact
  non-none tuple decisions from resolution artifact; `scripts/lib/cbro-evidence.mjs` release registry
  and inventory validation logic read in full.
* Assessment boundary: All supplied evidence is treated as inert data. No research beyond supplied
  inputs was performed. The critique can conclude on plan credibility, internal consistency, exact
  counts, mechanism completeness, and implementation risk from the supplied materials. It cannot
  validate production file content beyond what is readable in this session.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|---|---|---|
| D2: Positions 11-16 in source order, at most six, reduction authorized | Covered | Research Wave 3; resolution artifact selectedSourcePositions [11,15,16]; plan Scope |
| D3: Maximum Security exclusive cutoff | Covered | Plan Scope Non-Goals; inventory validation Maximum Security assertion in cbro-evidence.mjs |
| D4: Exact blocker retention | Covered | Plan FR2, Acceptance Criteria item 3; P01-T03 completion evidence; resolution artifact blocked array |
| D5: CBRO evidence freshness and provenance | Covered | Research W1-W7 digests; resolution generatedAt 2026-08-24T22:38:14.125Z; P02 details note research-vs-canonical distinction |
| D6: Factual identity and order only, no copied content | Covered | Plan Non-Functional Requirements; P03-T02 completion evidence |
| D7: Full automatic lifecycle through merge and durable handoff | Covered | Plan P05-T01 and P05-T02; Acceptance Criteria item 10 |
| Implementation readiness | Covered, with PC-001 and PC-002 | See Findings |
| Exact counts: 48 issues, 3 guides, 114 catalog, 339 comparisons | Covered and verified | Resolution JSON: 12+7+29=48 rows; 3×113=339 comparisons; 111+3=114 catalog; counts consistent across research, plan, and resolution artifact |
| Inventory arithmetic: 18 selected, 32 deferred, 1 deferred-subset, 5 blocked, 1 absorbed, 1 provenance-blocked | Covered and verified | Current inventory PowerShell read: 15 selected, 38 deferred, 2 blocked; +3 selected, -3 deferred (selected), -3 deferred (blocked), +3 blocked = correct final counts |
| Release authority: CBRO_RELEASE_IDS, CBRO_RELEASES, cbroReleaseForIds | Covered with PC-001 | cbro-evidence.mjs read; new release entry pattern is clear; nonselected digest mechanism requires explicit plan addition |
| SELECTED_INVENTORY_RELATIONSHIPS for new IDs | PC-002 | Not stated in plan or details; needed for inventory validation and test coverage assertions |
| Five non-none tuple decisions, exact shared IDs | Covered | Resolution artifact comparisons verified: Secret Wars candidate-subset doctor-doom-primer (12 IDs), Kraven partial spider-man-best-of (6 IDs), Fall of the Mutants partial captain-america-best-of (1 ID), xmen-claremont (11 IDs), xmen-claremont-complete (11 IDs) |
| Chronology: Secret Wars (1984-05-10), Fall of the Mutants (1987-07-01), Kraven's Last Hunt (1987-10-01) | Covered | Resolution artifact firstOnSaleDate fields; plan FR7; P03-T02 completion evidence |
| Failure proof with reversible mutations | Covered | P04-T01 completion evidence; Acceptance Criteria item 8 |
| Source freshness and retrieval timestamps | Covered | Research W1-W7 (all digests matched on 2026-08-24); resolution artifact generatedAt consistent |
| Overlap decisions: Secret Wars subset vs Doom primer, Kraven vs spider-man-best-of | Covered | Research Wave 3 contrarian; plan P02-T03; resolution artifact comparisons verified |
| Anchor handling | Covered | P04-T01 completion evidence (both head search and diff arithmetic) |
| P05 delivery: PR, merge, durable handoff, no batch four | Covered | P05-T01 and P05-T02 completion evidence; plan Follow-Up Items |
| Semantic test ownership and scope | Covered | AC item 7; P01-T03 and P02-T03 completion evidence lists; test/cbro-historical-events.test.js ownership stated |
| Blocked records cannot be prepared or authored | Covered | Plan AC item 3; P03-T01 completion evidence |
| Source array vs author array distinction | Covered | FR1 names both arrays exactly; P05-T02 handoff includes both |
| Non-selected inventory immutability proof | Covered | P01-T01 completion evidence: "A checked immutable projection proves every other record is unchanged" |

## Verdict

* Verdict: Revise
* Rationale: The plan is substantively sound and evidence-grounded. Two findings require plan
  additions before implementation. PC-001 is the blocking concern: the plan says to "rederive" the
  nonselected projection digest but does not specify whether to add a new
  `CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256` constant with a corresponding batch-three
  exclusion filter (following the pattern established by `CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256`
  in `scripts/lib/cbro-evidence.mjs`) or to update the existing batch-two constant. Updating the
  existing constant would silently remove the historical batch-two non-selected invariant check. This
  is a direct planner addition of one sentence to P01-T01 completion evidence. PC-002 is Low: the
  expected inventory `relationshipStatus` values for the three new IDs are not stated, which is
  needed for `SELECTED_INVENTORY_RELATIONSHIPS` entries and their semantic test assertions. Both
  findings are direct planner corrections requiring no user decision.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [Medium]: Nonselected projection digest mechanism is unspecified

* Related IDs: P01-T01, FR2, Acceptance Criteria item 2, CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256
* Evidence: `scripts/lib/cbro-evidence.mjs` lines that define
  `CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256` and the `validateCbroHistoricalInventory` filter
  `records.filter((record) => !CBRO_BATCH_TWO_SELECTED_IDS.includes(record.id))` followed by the
  digest assertion against that constant
* Concern: The plan's P01-T01 completion evidence says "The historical identity digest and
  nonselected projection digest are rederived" but does not state whether a new
  `CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256` constant and corresponding filter must be added
  (following the batch-two pattern) or whether the existing batch-two constant may be updated. The
  existing filter excludes only `CBRO_BATCH_TWO_SELECTED_IDS` from the nonselected set. After batch
  three, the three newly selected IDs (marvel-super-heroes-secret-wars, kravens-last-hunt,
  fall-of-the-mutants) will still appear in the filtered nonselected set because they are not
  members of `CBRO_BATCH_TWO_SELECTED_IDS`. Their state will have changed (centralDisposition,
  deliveryStatus, catalogIds, overlapIds, relationshipStatus), so the batch-two digest assertion
  will fail. Updating `CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256` would silence that failure but
  would drop the historical invariant that the batch-two non-selected records have not changed since
  batch two shipped.
* Impact: An implementer who updates the batch-two constant rather than adding a new batch-three
  constant and filter removes the historical batch-two non-selected guard silently. The validator
  passes, all gates pass, and the dropped invariant is invisible in the diff. This is the kind of
  recovery-path failure the custom instructions single out as the most dangerous category.
* Smallest useful change: Add one sentence to the P01-T01 completion evidence in the phase details
  (and optionally a parallel note in the plan's P01 task description): "Add
  `CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256` and a corresponding batch-three exclusion filter
  following the batch-two pattern; do not update `CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256`."
* Action owner: Planning parent
* Exact resolving evidence: The updated phase details P01-T01 completion evidence contains a sentence
  explicitly prohibiting update of `CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256` and requiring a
  new `CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256` constant.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-002 -->
### PC-002 [Low]: Expected inventory relationshipStatus values for batch-three IDs are not stated

* Related IDs: P01-T01, P02-T03, FR5, Acceptance Criteria items 5 and 7, SELECTED_INVENTORY_RELATIONSHIPS
* Evidence: `scripts/lib/cbro-evidence.mjs` `SELECTED_INVENTORY_RELATIONSHIPS` map and
  `validateCbroHistoricalInventory` which checks each selected record's `relationshipStatus` and
  `overlapIds` against that map; resolution artifact relationship classifications (candidate-subset
  for Secret Wars vs doctor-doom-primer, partial for Kraven vs spider-man-best-of, partial for Fall
  of the Mutants vs three existing guides)
* Concern: The plan correctly identifies `scripts/lib/cbro-evidence.mjs` as the canonical target for
  "Known release, exact tuple decisions, inventory authority" and requires adding five non-none
  decisions to the relationship decisions table. However, neither the plan nor the phase details state
  the expected inventory `relationshipStatus` values (`none`, `candidate-subset`, or `approved-mixed`)
  for the three new IDs that must be added to `SELECTED_INVENTORY_RELATIONSHIPS`. The inventory
  validator checks each selected record's `relationshipStatus` against this map. The existing
  `INVENTORY_RELATIONSHIPS` set does not include `'partial'`; the `partial` report classification
  translates to `approved-mixed` at the inventory level (as established by `days-of-future-past`).
  This translation is not stated in either document.
* Impact: An implementer who assigns `'partial'` as an inventory relationshipStatus will fail the
  inventory validator immediately. An implementer who assigns `'candidate-subset'` to Kraven or Fall
  of the Mutants (instead of `approved-mixed`) will produce a silently incorrect inventory
  relationship record that the validator accepts but that misrepresents the overlap class.
* Smallest useful change: Add to P02-T03 completion evidence in the phase details: "Secret Wars
  receives inventory `relationshipStatus: 'candidate-subset'` with `overlapIds: ['doctor-doom-primer']`.
  Kraven's Last Hunt receives `relationshipStatus: 'approved-mixed'` with
  `overlapIds: ['spider-man-best-of']`. Fall of the Mutants receives `relationshipStatus: 'approved-mixed'`
  with `overlapIds: ['captain-america-best-of', 'xmen-claremont', 'xmen-claremont-complete']`."
* Action owner: Planning parent
* Exact resolving evidence: The updated phase details P02-T03 completion evidence names all three
  inventory `relationshipStatus` values and their `overlapIds` arrays exactly as described above.
* Decision route: Direct planner correction

## Strengths and Residual Risk

* Three-guide reduction is well-justified, evidence-backed, and explicitly authorized by the caller's
  batch-authority grant. The contrarian wave directly tested the pull-position-17 alternative and
  rejected it on scope grounds.
* All 48 issue mappings are resolved exactly in the resolution artifact with unique IDs, series IDs,
  Marvel URLs, and on-sale dates. All six source digests were re-verified on 2026-08-24 and matched.
* Inventory arithmetic is fully verified: current state (15 selected, 38 deferred, 2 blocked) plus
  six transitions yields exactly the plan's stated final counts (18 selected, 32 deferred, 5 blocked,
  1 deferred-subset, 1 absorbed, 1 provenance-blocked = 58 total).
* Comparison counts are exact: 3 candidates × 113 comparisons (111 library + 2 peers) = 339. The
  resolution artifact confirms comparisonCount: 113 for all three events.
* The five non-none tuple identities and shared ID arrays were verified directly against the resolution
  artifact comparisons sections and match the plan's FR5 and P02-T03 completion evidence exactly.
* Chronology (Secret Wars 1984-05-10, Fall of the Mutants 1987-07-01, Kraven's Last Hunt 1987-10-01)
  is grounded in resolution artifact `firstOnSaleDate` fields and consistent with the plan's author
  order (positions 11, 16, 15).
* The release authority pattern (CBRO_RELEASE_IDS, CBRO_RELEASES, CBRO_RELATIONSHIP_DECISIONS) is
  fully understood from the existing code, and the plan correctly targets cbro-evidence.mjs for all
  three structures.
* Failure proof, anchor handling, P05 delivery, and post-implementation review requirements are
  covered completely in the phase details.
* The Evolutionary War as the next cursor is stated in both the plan Follow-Up Items and the P05-T02
  handoff evidence.
* No residual risks are explicitly accepted beyond the acknowledged source/catalog drift stop conditions.

## Questions or Blocking Evidence Gaps

* None. Both findings are correctable by the planning parent without user input or additional research.

## Limitations

* The critique cannot run the repository gates (`npm run lint`, `npm test`, `npm run anchors`) to
  validate that the plan targets and their dependent scripts are currently consistent.
* The critique cannot verify that the existing `cbro-timeline-batch-two.json` format is exactly
  reproduced for `cbro-timeline-batch-three.json`; that is an implementation concern, not a plan gap.
* The critique assessed the exact overlap comparison lists in the resolution artifact but did not
  independently verify Marvel API issue IDs against a live endpoint, consistent with the boundary
  that research evidence from the resolution artifact is the supplied input.

## Recommended Next Action

* Highest-impact finding: PC-001
* Action owner: Planning parent
* Smallest next action: Add one sentence to the P01-T01 completion evidence in the phase details
  prohibiting update of `CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256` and requiring a new
  `CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256` constant. Add the three inventory
  `relationshipStatus` and `overlapIds` values to P02-T03 completion evidence per PC-002. No further
  critique is needed; the planning parent may finalize and proceed to implementation once both
  additions are made.
* User response required: No

## Relevant Artifacts

| [.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-research.md](.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-research.md) | Canonical batch-three research state. |
|---|---|
| [.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-resolution.json](.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-resolution.json) | Exact mapping and relationship evidence. |
| [.copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-three-plan.md](.copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-three-plan.md) | Canonical implementation plan. |
| [.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-three-phase-details.md](.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-three-phase-details.md) | Task-level evidence and completion details. |
| [.copilot-tracking/reviews/plans/2026-08-24/historical-event-reading-orders-batch-three-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-24/historical-event-reading-orders-batch-three-plan-critique.md) | This critique. |

## Next Steps

Both findings are direct planner corrections requiring no user decision. The planning parent should
add the two completion-evidence sentences (PC-001 to P01-T01, PC-002 to P02-T03) in the phase
details and finalize the plan. Implementation is eligible immediately after that revision. No
additional critique pass is warranted.
