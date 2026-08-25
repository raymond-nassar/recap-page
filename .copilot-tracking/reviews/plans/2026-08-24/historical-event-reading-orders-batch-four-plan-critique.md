<!-- markdownlint-disable-file -->
# RPI Plan Critique: Historical event reading orders batch four

## Metadata

* Task ID: MRT-003-C02-B05
* Critique date: 2026-08-24
* Plan: .copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-four-plan.md
* Phase details: .copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md
* Critique execution status: Complete
* Critique count for task: One

## Inputs and Criterion Boundary

* Caller requirements: Continue at source position 17; publish the smallest eligible four-to-six
  guide batch; preserve every source identity, position, retrieval value, digest, inclusion,
  exclusion, relationship, and reader-facing fact; invent no metadata; inherit no B04 exclusion;
  complete one critique, one Review, publication, and the authorized Agent Merge readiness loop.
* Research:
  .copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-four-research.md;
  .copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-four-scan.json; and
  .copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-four-resolution.json.
* Candidate boundary: Four selected guides containing 71 exact rows; one blocked 70-row Acts of
  Vengeance guide with two unresolved rows; one cleared Days of Future Present blocker; position 22
  retained as the next cursor; zero new exclusions; no supplemental essential-trades work.
* Locked test boundary: `test/cbro-historical-events.test.js`, no removals, at most four cases.
* Assessment boundary: This is the sole final-candidate critique. It does not re-query live sources
  or critique implementation that does not yet exist.

## Coverage Assessment

| Requirement or area | Coverage | Evidence or concern |
|---|---|---|
| Four selected guides and 71 rows | Covered | Plan and details name exact guide and row counts. |
| Acts of Vengeance whole-guide blocker | Partial | The blocker names both gaps but the first candidate does not make the 70-row research resolution a locked canonical target or test all 70 positions. See PC-001. |
| Days blocker clearance | Covered | Exact issue 12360 and the approved series alias are required. |
| Position-22 cursor and supplemental boundary | Covered | Both are repeated across scope, acceptance, Review, and follow-up. |
| Source and relationship freshness | Covered | Execution-time regeneration and stale rejection are required. |
| B04 exclusion non-precedent | Covered | Structured exclusions are prohibited for B05. |
| Release-shape error handling | Partial | The implementation still states that every known release has five guides, while B03, B04, and the planned B05 do not. See PC-002. |
| Canonical and generated targets | Covered except PC-001 | Production scripts, evidence, product data, tests, and records are named. |
| Test ownership and maximum additions | Covered | One semantic owner, no removal, and four-case maximum are locked. |
| Validation before Review | Covered | Complete deterministic, live-contract, and browser gates are named. |
| Validation after Review and readiness edits | Partial | Review fixes and Agent Merge conflict or review edits can invalidate the pre-Review green tree without an explicit rerun gate. See PC-003. |
| One critique, one Review, and Agent Merge | Covered | Lifecycle counts and merge-command boundary are explicit. |

## Verdict

* Verdict: Revise
* Rationale: The candidate accurately selects and bounds the release, but three direct planner
  corrections are required. The blocked guide needs complete durable row conservation, the release
  selector must stop encoding an obsolete five-guide invariant, and every post-validation edit must
  be revalidated before readiness. No user decision or more research is required, and no second
  critique is warranted.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [High]: The blocked guide lacks locked 70-row conservation evidence

* Related IDs: Goals, Functional Requirements, Acceptance Criteria, canonical targets, P01-T02,
  P05-T01
* Evidence: The resolution research records all 70 Acts of Vengeance source rows in displayed order
  and marks only positions 63 and 64 unresolved. The first candidate requires a durable blocker reason
  but does not lock that resolution as implementation evidence or require a semantic assertion over
  positions 1 through 70.
* Concern: A future edit could retain the two named blockers while silently losing or changing one of
  the other 68 rows. Product absence alone cannot prove exact source conservation.
* Impact: The task could satisfy the apparent blocker contract while violating the caller's explicit
  no-silent-drop requirement.
* Smallest useful change: Lock the current resolution JSON as canonical source-row evidence and make
  the P01 semantic case assert all 70 source positions, exact labels, the two unresolved identities,
  and no product artifact for the guide.
* Action owner: Planning parent
* Exact resolving evidence: Revised canonical targets, P01-T02 details, acceptance criteria, and test
  ownership name the resolution artifact and the complete 70-row assertion.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-002 -->
### PC-002 [Medium]: Release rejection text encodes a false five-guide invariant

* Related IDs: Functional Requirements, canonical targets, P01-T01, semantic regression
* Evidence: `scripts/lib/cbro-evidence.mjs` rejects unknown release shapes as requiring one complete
  five-guide release, while committed B03 and B04 releases each contain three guides and B05 contains
  four.
* Concern: Adding another non-five-guide release while preserving the message makes error behavior
  factually false and leaves existing tests asserting obsolete wording.
* Impact: Operators receive misleading failure guidance, and a future implementation could wrongly
  restore a length assumption from the message.
* Smallest useful change: Change the shared rejection wording to `complete known release` and update
  every semantic assertion that owns that message without weakening exact known-release matching.
* Action owner: Planning parent
* Exact resolving evidence: Revised P01-T01 and target inventory explicitly include the shared helper
  and all affected assertions.
* Decision route: Direct planner correction

<!-- rpi:critique id=PC-003 -->
### PC-003 [High]: Post-Review and readiness-loop edits lack a final validation gate

* Related IDs: Dependencies, P04-T02, P05-T01, P05-T02, Acceptance Criteria
* Evidence: P04 completes validation before Review. P05 permits one in-scope Review fix pass and Agent
  Merge review or conflict work, but the first candidate does not require affected local gates and
  hosted checks to rerun after those edits.
* Concern: The delivered tree can differ from the fully validated tree while still inheriting its
  recorded green results.
* Impact: Review fixes or conflict resolution can introduce broken product data, stale anchors,
  invalid counts, or browser regressions after the last local proof.
* Smallest useful change: Require affected focused and repository gates after every Review fix, and
  require the full final local gate set plus hosted checks after any readiness-loop tree change before
  merge readiness is accepted. Do not run another Review.
* Action owner: Planning parent
* Exact resolving evidence: Revised P05 completion criteria and acceptance criteria make a zero-edit
  final validated tree the input to readiness.
* Decision route: Direct planner correction

## Strengths and Residual Risk

* The four selected guides are the earliest eligible source-order set and form the smallest permitted
  batch.
* The selected arithmetic is exact and the blocked and deferred guides are prohibited from every
  product artifact class.
* Current source and relationship evidence is treated as regenerable authority rather than a timeless
  snapshot.
* Existing release compatibility, B04 exclusions, atomic writes, local-first behavior, and runtime
  dependency boundaries are preserved.
* Residual live-source risk is handled by stopping and regenerating instead of shortening or guessing.

## Questions or Blocking Evidence Gaps

None. PC-001 through PC-003 are direct planner corrections supported by current repository evidence.

## Recommended Next Action

Apply PC-001 through PC-003 in one planning revision, record all dispositions, finalize without a
second critique, and continue automatically to implementation.
