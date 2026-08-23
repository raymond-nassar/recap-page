<!-- markdownlint-disable-file -->
# Review: Character Spotlight filter

## Scope and Evidence

* Task ID: MRT-002-C04
* Review date: 2026-08-23
* Review scope: Full task through P03-T01; delivery remains in P04.
* Assessed boundary: Explicit taxonomy, generated-data parity, shelf-local native controls,
  filtering composition, accessibility and responsive behavior, direct records, versioning,
  fail-before-fix proof, local gates, anchors, and readiness for delivery.
* Plan: .copilot-tracking/plans/2026-08-23/character-spotlight-filter-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/character-spotlight-filter-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-23/character-spotlight-filter-plan-critique.md
* Changes: .copilot-tracking/changes/2026-08-23/character-spotlight-filter-changes.md
* Other evidence considered: .copilot-tracking/research/2026-08-23/character-spotlight-filter-research.md,
  the complete branch diff from baseline 08c0558, and recorded local validation output.

## Opening Review State

* Interpreted review goal: Independently determine whether the complete implemented feature preserves
  the confirmed user direction and is ready for PR, hosted CI, and merge.
* Review scope: Full implemented task boundary through P03-T01.
* Evidence readiness: Research, plan, one critique, phase details, changes record, final diff,
  fail-before-fix evidence, full local gates, installed Edge evidence, and anchor closeout are present
  and reconciled.
* Acceptance basis: The exact user direction, plan requirements and acceptance criteria, PC-001
  through PC-004 dispositions, and the locked test and browser boundaries.
* First comparison boundary: Requirements and data contract against the final branch diff, followed
  by interaction, accessibility, regression, evidence, and lifecycle readiness.
* Active read-only boundaries: The Review may update only this canonical review record. Product,
  planning, Research, critique, and changes artifacts are read-only during this stage.
* Initial blockers: None.

## Execution Status

* Execution status: Complete.
* Review execution evidence: One independent read-only review assessed the complete post-P03-T01
  branch diff and returned one substantive finding. No second Review is planned or required.

## Plan-to-Change Reconciliation

| Current plan scope | Descriptive changes-record summary | Current-state reconciliation | Gap or rationale |
|---|---|---|---|
| P01 and P01-T01 | Establish the explicit taxonomy | Partial | Manifest validation is strict, but its normalized non-character entries carry a null taxonomy property into generation. |
| P01-T02 | Classify all current records and rebuild generated data | Partial | All 11 character assignments and counts are correct; generated non-character records incorrectly receive the property with a null value. |
| P02 | Add the shelf-local accessible filter | Reconciled | Native controls, state placement, path reset, search composition, grouping, forced colors, focus, and narrow layout match the plan. |
| P03-T01 | Add proof, records, version, and release validation | Reconciled with one coverage gap | Required gates and proofs ran, but parity tests compared null to null rather than asserting property absence for non-character records. |
| Follow-Up Items | None | Reconciled | No unrelated work was added to active scope. |

## Completed Work Assessment

| Related marker | Files | What changed and why | Completion evidence | Validation | Assessment |
|---|---|---|---|---|---|
| P01-T01 | src/js/lib/curated.js, src/js/lib/catalog.js, scripts/vendor-orders.mjs | Added a three-value taxonomy and validation so classification is explicit rather than inferred. | Schema and runtime tests, catalog-only generation, normalization mutation proof. | Focused tests passed. | One Medium defect: the generator-visible normalized shape does not omit the field outside character runs. |
| P01-T02 | src/data/curated-lists.json, src/data/catalog.json | Classified five Best of, two complete-guide, and four other readings. | Eleven readings across ten stories with grouped X-Men agreement. | Count and parity tests passed. | Character classifications conform; non-character generated shape needs correction. |
| P02-T01 | src/index.html, src/styles.css | Added native header radios using existing focus, checked, wrap, and forced-color behavior. | Installed Edge exercised checked state, keyboard focus, forced colors, and 360x800 layout. | Thirteen focused and 158 full browser assertions passed. | Reconciled. |
| P02-T02 | src/js/main.js, src/js/lib/catalog.js | Applied the subset after shelf selection and before generic facets, search, and grouping; path arrival resets narrowing. | Unit, shelf, and browser checks cover subset composition, preservation, and reset. | Unit and browser mutation proofs failed without behavior and passed restored. | Reconciled. |
| P03-T01 | Direct docs, version files, browser harness, tests, evidence anchors | Recorded the contract, proof, counts, version, and release evidence. | Full validation and anchor closeout are durable in the changes record. | All recorded local gates passed. | Reconciled except for RV-001, which the existing parity assertion did not detect. |

## Implementation-Time Plan and Detail Update Assessment

| Affected area or marker | What changed and why | Triggering evidence and user decision | Reconciliation performed | Planning and critique state | Assessment |
|---|---|---|---|---|---|
| P02-T02 | Path arrivals reset spotlight narrowing to All so a linked story cannot remain hidden. | PC-001; no new user decision because the change preserves requested navigation. | Plan, details, state, tests, and browser proof agree. | PC-001 resolved in the single critique. | Reconciled. |
| P03-T01 | Anchors use prior-head search and hunk arithmetic, apply one mapping once, and read collision notices. | PC-002 and repository anchor rules. | Changes evidence records derivation, application, bless reading, and zero final drift. | PC-002 resolved in the single critique. | Reconciled. |
| Browser boundary | Forced colors is actively emulated and restored; test ownership stays in existing semantic, shelf, and browser files. | PC-003 and PC-004. | Plan, details, harness, and tests agree. | PC-003 and PC-004 resolved in the single critique. | Reconciled. |
| Frozen issue-library evidence | spotlightKind is excluded from the historical issue-library digest because it changes no issue identity or overlap. | Full-suite failure and a fail-before-fix guard; no user decision required. | The digest helper and focused evidence test preserve frozen reports while other manifest changes still alter the digest. | Immediately relevant current-state correction within approved taxonomy scope. | Reconciled and justified. |

## Critique and Material Revision Assessment

* Latest critique dispositions: PC-001 through PC-004 are all reflected in the current plan and
  implementation. Exactly one critique ran.
* Material revisions: No significant or divergent revision changed the confirmed product direction.
  The issue-library digest correction preserves historical evidence without weakening taxonomy
  validation.
* Dependent-work pause assessment: Planning gaps were resolved before dependent implementation.
  P04 is now paused for RV-001.
* Justification assessment: Supported, except the generated non-character property shape in RV-001
  contradicts the plan's forbidden-outside-character contract.

## Plan Follow-Up Assessment

| Follow-up item | Why outside immediate scope | Owner or next action | Assessment and route |
|---|---|---|---|
| None | No unrelated work was discovered. | None. | Reconciled. |

## Findings

<!-- rpi:review id=RV-001 -->
### RV-001 [Medium]: Generated non-character records carry the forbidden taxonomy property

* Related scope: P01-T01 and P01-T02.
* Evidence: scripts/vendor-orders.mjs catalogEntry copies order.spotlightKind unconditionally;
  src/js/lib/curated.js checkEntry normalizes it to null for non-character records; generated
  src/data/catalog.json therefore contains spotlightKind with a null value on 78 non-character
  records while src/data/curated-lists.json contains it on none of them.
* Impact: The generated schema and parity claim disagree with the accepted contract that the
  taxonomy belongs only to character runs. Future consumers cannot distinguish an intentionally
  absent property from a nullable cross-type field, and the current parity test masks the drift by
  comparing null to null.
* Destination: rpi-implement.
* Smallest useful next action: Omit spotlightKind from normalized and generated non-character
  entries, regenerate the catalog, and tighten parity tests to assert property absence.

## Defects

* RV-001 is an in-scope implementation defect routed to rpi-implement.

## Routed Findings

| Finding | Destination | Owner or next action | Reason for route |
|---|---|---|---|
| RV-001 | rpi-implement | Automatic RPI parent: omit the field outside character runs, regenerate, test absence, and rerun affected gates. | The accepted taxonomy contract is sound; its generated implementation is incomplete. |

Later implementation of RV-001 does not require another Review.

## Residual Work

* None. RV-001 is a current-scope defect, not follow-up work.

## Blockers and Remaining Work

* Blockers: P04 cannot begin while RV-001 remains open.
* Remaining active work: Implement RV-001 through the existing P01 and P03 evidence boundary, rerun
  affected and full validation, then resume P04 without another Review.

## Validation Evidence

| Command or evidence | Scope | Status | Summary |
|---|---|---|---|
| Focused Node tests | Taxonomy, runtime, shelf, and frozen evidence | Passed | 128 feature tests passed; five character evidence tests passed after the digest correction. |
| Fail-before-fix proofs | Runtime taxonomy, browser subset, frozen digest | Passed | Each targeted guard was observed failing without its protected behavior. |
| npm test | Full repository | Passed | 1,397 tests passed, 0 failed. |
| npm run browser | Installed Edge | Passed | 158 assertions passed across 17 scenarios. |
| npm run lint, counts, sizes, palette | Full repository | Passed | Zero lint findings; 178 ranked rows; 183 detail blocks; seven size claims; 88 palette pairs with zero new exceptions. |
| npm run anchors | Tracked evidence corpus | Passed | 1,135 unchanged, 0 drifted, 0 new, 0 removed across 32 documents. |
| npm run publication and publication:surface | History and published branch surface | Passed | Both scans reported zero findings. |
| Diff scans | Complete branch diff | Passed | Zero long-dash additions, zero malformed citations, and no whitespace errors. |
| Live metadata contract | Third-party API | Skipped | No API assumption changed. |
| Independent static review | Complete branch diff | Failed | One Medium schema-shape defect, RV-001. |

## Outcome

* Outcome: Defects found.
* Outcome rationale: The interaction, accessibility, classification, proof, and release evidence are
  otherwise conformant, but generated data violates the accepted character-only taxonomy contract.
  The defect is bounded and implementation-ready, but it must close before P04.

## Closeout Routing Record

| Finding class | Destination | Owner or next action |
|---|---|---|
| Implementation defect | rpi-implement | Automatic RPI parent implements RV-001 and revalidates without another Review. |
| Decision gap or invalid assumption | None | No user or planning decision is needed. |
| Material evidence gap | None | Existing evidence is sufficient to define and verify the fix. |
| Non-blocking residual work | None | No follow-up item is warranted. |

* Execution status: Complete.
* Outcome: Defects found.
* Validation coverage: Full local tests, installed Edge, lint, derived gates, anchors, publication,
  diff hygiene, and one independent complete-diff review.
* Blockers: RV-001 blocks P04 until implementation and revalidation complete.
