<!-- markdownlint-disable-file -->
# RPI Plan Critique: Character Spotlight filter

## Metadata

* Task ID: MRT-002-C04
* Task slug: character-spotlight-filter
* Critique date: 2026-08-23
* Plan: .copilot-tracking/plans/2026-08-23/character-spotlight-filter-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: Automatic Research, Plan, exactly one critique, Implement,
  exactly one independent Review, PR, hosted Node 20, Node 24, and lint CI, reconciliation when
  needed, and merge. Product requirements include an explicit validated Character Spotlight
  taxonomy; honest Best of, complete-guide, and other assignments; visible native All, Best of, and
  Complete guides controls; All as the default; shelf isolation; preserved search, navigation, and
  grouping; accessible keyboard, focus, forced-color, and narrow behavior; direct data, schema,
  generated catalog, documentation, test, anchor, browser, publication, PR, CI, and merge evidence.
* Research and evidence considered:
  .copilot-tracking/research/2026-08-23/character-spotlight-filter-research.md,
  .copilot-tracking/rpi-sessions/2026-08-23/character-spotlight-filter-state.json,
  .copilot-tracking/plans/2026-08-23/character-spotlight-filter-plan.md,
  .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md, and directly
  relevant current manifest, catalog, renderer, markup, styles, vendor, browser harness, and named
  test owners.
* Decisions, dependencies, and acceptance criteria considered: The three-value `spotlightKind`
  taxonomy and exact 5/2/4 reading assignments; 11 readings across 10 stories; grouped X-Men
  agreement; pre-search and pre-group shelf filtering; native header radios; zero new production or
  test files; catalog-only generation; a minor version bump; fail-without-fix proof; local and
  publication gates; exactly one Review; hosted job conclusions; reconciliation; and merged-state
  persistence.
* Assessment boundary: This critique assesses the complete supplied planning boundary once. It
  verifies only directly relevant current source and test contracts. It does not perform new
  research, evaluate implementation that does not yet exist, or change any plan source, lifecycle
  state, source, test, or other artifact.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|---|---|---|
| Caller lifecycle and delivery requirements; P03-T02, P04-T01, P04-T02 | Covered | The plan limits critique and Review runs, requires local gates, PR format, three hosted jobs by job conclusion, reconciliation, merge, and durable completion evidence. |
| Research C8-C18; P01-T01, P01-T02 | Covered | The plan carries a strict three-value taxonomy through manifest validation, grouped agreement, vendoring, runtime normalization, exact assignments, and stable counts without inference. |
| Header controls and default state; P02-T01 | Covered | The dedicated native fieldset, exact labels, All default, native keyboard model, focus ring, wrapping, and selected state are planned independently of the hidden generic facets. |
| Preserved navigation; P02-T02 | Partial | The phase details explicitly exclude resetting the new subset on path navigation, but current Essential Avengers is both `other` and the first stop of the shipped Modern Avengers path. |
| Forced-color proof; P02-T01, P03-T01 | Partial | The plan states the outcome, but the locked browser scope and detailed Edge scenario omit activating forced colors and observing the selected border. |
| Anchor workflow; P03-T01 | Partial | The phase validation says anchors are re-aimed twice, contrary to the required derive-twice, apply-once workflow. |
| Locked test boundary; P01-T02 | Partial | The plan locks semantic tests to curated.test.js and catalog.test.js and shelf regressions to catalog-shelves.test.js, while the phase details additionally name cbh-character-spotlight.test.js as a likely taxonomy/count target. |
| Documentation, generated data, version, gates, and publication; P03-T01 | Covered | Canonical and generated targets, direct docs, backlog, changelog, 1.4.0 synchronization, mutation proof, local gates, publication checks, browser harness, and conditional live contract are named. |

## Verdict

* Verdict: Revise
* Rationale: The taxonomy, UX, data flow, evidence surfaces, and delivery lifecycle are credible, but
  the final candidate contains one concrete current navigation regression, omits an executable
  forced-color browser obligation, describes an unsafe repeated anchor re-aim, and conflicts with
  its locked test-owner boundary. All four are bounded planner-owned corrections with no significant
  user decision.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [High]: Clear the spotlight subset when path navigation must reveal its target

* Related IDs: Caller preserved-navigation requirement; Research C1-C3, C16; P02-T02; Acceptance
  Criteria for path navigation
* Evidence: src/data/curated-lists.json places `essential-avengers`, classified as `other`, first in
  the shipped `modern-avengers` path. src/js/main.js `goToStop` calls `clearNarrowing`, whose contract
  clears destination narrowing so a linked row cannot remain hidden. The P02-T02 boundaries instead
  exclude resetting the new subset on path navigation, and the plan says path arrival clears only
  query and generic facet state.
* Concern: If a reader selects Best of or Complete guides and then follows a path link to Essential
  Avengers, navigation can open Character Spotlight while the linked first stop remains filtered
  out.
* Impact: This violates both the caller's preserved-navigation requirement and the current guarantee
  that a path link reveals the row it names. It affects a current shipped path, not only a future
  extension.
* Smallest useful change: Revise P02-T02 to include resetting the Character Spotlight subset to All
  inside destination narrowing clearance, while leaving ordinary shelf switching persistent. Add a
  regression that starts with a non-All subset and proves a Modern Avengers path arrival reveals
  Essential Avengers.
* Action owner: Planning parent
* Exact resolving evidence: The revised plan and phase details require `clearNarrowing` to reset the
  spotlight kind only when Character Spotlight is a path destination, and name a catalog shelf or
  browser regression proving Essential Avengers is visible after arrival from a non-All selection.
* Decision route: Direct planner correction; no significant user decision.

<!-- rpi:critique id=PC-002 -->
### PC-002 [High]: Replace repeated anchor re-aiming with derive twice and apply once

* Related IDs: Caller careful anchor workflow requirement; P03; P03-T01
* Evidence: The P03 validation expectations in
  .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md say anchor changes
  are "re-aimed twice." The required repository workflow derives each target independently from the
  prior head text and diff-hunk arithmetic, reconciles disagreement, and applies one freshly computed
  mapping once.
* Concern: Applying a re-aim mapping twice is not idempotent. An already moved citation can be moved
  again or collapsed onto another claim before blessing.
* Impact: The release could permanently bless citations onto unrelated lines while all later anchor
  checks appear clean.
* Smallest useful change: Rewrite the P03 and P03-T01 anchor steps to derive each target twice,
  reconcile both derivations, apply one mapping once, check citation shape and corpus count, inspect
  every claim-to-line pairing, bless, and rerun for zero drift, additions, and removals.
* Action owner: Planning parent
* Exact resolving evidence: Revised P03 validation and completion evidence explicitly say
  "derive twice, apply once" and record head-search reconciliation, hunk arithmetic, well-formed
  citation and count checks, per-claim bless inspection, and a clean zero-difference rerun.
* Decision route: Direct planner correction; no significant user decision.

<!-- rpi:critique id=PC-003 -->
### PC-003 [High]: Make forced-color behavior an explicit Edge observation

* Related IDs: Caller forced-color and Edge proof requirements; Research C6-C7, C20; P02-T01;
  P03-T01; Non-Functional Requirements
* Evidence: src/styles.css contains the selected filter's forced-color Highlight border, while
  scripts/browser-check.mjs has no forced-color activation or observation. The plan's high-level
  non-functional criteria mention forced-color-compatible styles, but its locked exact browser scope
  and P03-T01 scenario list selection, focus, keyboard, grouping, and narrow layout without forced
  colors.
* Concern: A source rule can exist yet fail to apply to the new header controls because of class,
  selector, markup, or cascade drift. The current detailed proof would not observe that failure.
* Impact: A critical accessibility requirement could ship without the required real-Edge evidence.
* Smallest useful change: Add forced-colors activation and restoration to the existing Edge scenario,
  assert the media query is active, and observe a checked spotlight radio's nonzero Highlight border
  while its native checked state remains true.
* Action owner: Planning parent
* Exact resolving evidence: The revised locked browser scope and P03-T01 completion evidence name an
  Edge result where forced colors are active, the selected radio remains checked, its selected border
  is observable, and normal media state is restored for subsequent scenarios.
* Decision route: Direct planner correction; no significant user decision.

<!-- rpi:critique id=PC-004 -->
### PC-004 [Medium]: Reconcile the phase targets with the locked test owners

* Related IDs: Locked Test and Change Boundary; P01-T01; P01-T02
* Evidence: The plan locks semantic taxonomy tests to test/curated.test.js and
  test/catalog.test.js and shelf regressions to test/catalog-shelves.test.js. P01-T02 in the phase
  details additionally lists test/cbh-character-spotlight.test.js as a likely target even though the
  current file owns source-batch fidelity and existing aggregate release counts rather than the new
  taxonomy contract.
* Concern: The implementation handoff does not have one authoritative test boundary, so taxonomy
  assertions may drift into an unrelated evidence suite or be duplicated.
* Impact: Mutation proof and ownership become ambiguous, and the implementation can exceed a caller
  locked boundary without necessity.
* Smallest useful change: Remove test/cbh-character-spotlight.test.js from P01-T02 and keep manifest
  assignments and generated parity in the two semantic owners, with grouping and shelf isolation in
  catalog-shelves.test.js.
* Action owner: Planning parent
* Exact resolving evidence: Revised P01-T02 likely targets and validation name only
  test/curated.test.js and test/catalog.test.js for taxonomy and count parity, plus
  test/catalog-shelves.test.js for grouping, shelf isolation, and navigation regressions.
* Decision route: Direct planner correction; no significant user decision.

## Strengths and Residual Risk

* The plan correctly rejects depth, count, title, URL, and vague prose as classifiers and preserves
  the grouped X-Men pair, Doom primer, and Essential Avengers as explicit `other` records visible
  under All.
* All manifest-to-browser schema hops are named, generated data remains derived through catalog-only
  vendoring, and malformed runtime values narrow conservatively.
* The dedicated native header control is the right architecture for a 10-story shelf whose generic
  facets are threshold-hidden.
* The one-critique and one-Review limits, fail-without-fix proof, local and publication gates, PR
  format, hosted matrix, reconciliation, merge, and durable closeout are all credible once the
  findings above are applied.
* Residual implementation risk remains in preserving focus while rerendering and measuring narrow
  layout, but the plan already gives both objective Edge acceptance conditions.

## Questions or Blocking Evidence Gaps

* None. Every finding can be resolved directly by the planning parent from supplied requirements and
  current repository evidence.

## Limitations

* The critique did not perform external research, run the not-yet-written feature, or assess unrelated
  source and documentation.
* The lifecycle state still records the pre-critique snapshot and was intentionally left unchanged
  under the caller's write-only-critique constraint.

## Recommended Next Action

* Highest-impact finding: PC-001
* Action owner: Planning parent
* Smallest next action: Revise P02-T02 so path destination clearing resets the spotlight subset to All
  and add the Essential Avengers path-arrival regression, then apply PC-002 through PC-004 in the same
  finalization pass without requesting another critique.
* User response required: No

## Relevant Artifacts

| Artifact | Description |
|---|---|
| [.copilot-tracking/research/2026-08-23/character-spotlight-filter-research.md](.copilot-tracking/research/2026-08-23/character-spotlight-filter-research.md) | Supplied requirements, evidence, classification, and planning readiness |
| [.copilot-tracking/rpi-sessions/2026-08-23/character-spotlight-filter-state.json](.copilot-tracking/rpi-sessions/2026-08-23/character-spotlight-filter-state.json) | Supplied lifecycle limits and final-candidate pointers |
| [.copilot-tracking/plans/2026-08-23/character-spotlight-filter-plan.md](.copilot-tracking/plans/2026-08-23/character-spotlight-filter-plan.md) | Final-candidate plan assessed by this critique |
| [.copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md](.copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md) | Task-level boundaries and validation assessed by this critique |
| [.copilot-tracking/reviews/plans/2026-08-23/character-spotlight-filter-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-23/character-spotlight-filter-plan-critique.md) | Complete single critique and actionable finding set |

## Next Steps

* Active automatic RPI parent should apply PC-001 through PC-004 directly, finalize the plan without a
  second critique, update lifecycle state, and continue to implementation. No user action is required.
