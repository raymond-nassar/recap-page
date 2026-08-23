<!-- markdownlint-disable-file -->
# RPI Plan Critique: Priority cosmic character guides

## Metadata

* Task ID: MRT-002-C05
* Critique date: 2026-08-23
* Plan: .copilot-tracking/plans/2026-08-23/priority-cosmic-character-guides-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: Automatically deliver the next Character Spotlight batch (MRT-002-C05) from PR #173 baseline through Implement, one independent Review, PR, hosted Node 20/24/lint CI, and merge. Candidate order Rocket 7, Groot 9, Star-Lord 15, gated Thanos 17. Guarded packet/mapping/overlap/approval/authoring workflow only; no parsers, score selection, inference, source shortening, or unavailable rows. `character-run` + `complete-guide` taxonomy. Existing Best of cards unchanged. Preserve source order, availability semantics, zero runtime dependencies, fixed origin, no image bytes, no em dashes. Add negative-proof tests. Run every listed gate. Exactly one critique and one Review.
* Research and evidence considered: `.copilot-tracking/research/2026-08-23/priority-cosmic-character-guides-research.md` (full, C1-C13, W1-W9, Parent Synthesis, Findings, Decisions); `.copilot-tracking/rpi-sessions/2026-08-23/priority-cosmic-character-guides-state.json`; `scripts/lib/cbh-inventory.mjs`; `scripts/author-cbh-packet.mjs`; `scripts/report-order-overlap.mjs`; `scripts/lib/cbh-overlap.mjs`; `scripts/prepare-cbh-batch.mjs` (existence only, not fully read); `scripts/browser-check.mjs` (header and fixture sections); `src/js/lib/catalog.js` (taxonomy section); `test/cbh-character-spotlight.test.js`; `test/cbh-batch.test.js`; `test/catalog-shelves.test.js`; `test/catalog.test.js` (excerpt); `test/curated.test.js` (excerpt); `scripts/data/cbh-character-inventory.json` (Rocket and Thanos records); `package.json`.
* Decisions, dependencies, and acceptance criteria considered: the plan's Locked Change and Test Boundaries, Acceptance Criteria, Non-Functional Requirements, Phase Checklist P01-P04, and the phase-details Task-Level Context, Locked Test and Change Boundary, and per-task Validation Expectations.
* Assessment boundary: This critique verifies the plan and phase details against the supplied research, the caller's locked boundary, and the cited contract source files as they exist on disk today. It does not re-derive the source-page issue counts (75/76/99), does not fetch live Comic Book Herald or Marvel metadata, and does not execute any code. Findings about contract behavior are based on direct reading of `scripts/lib/cbh-inventory.mjs`, `scripts/author-cbh-packet.mjs`, `scripts/lib/cbh-overlap.mjs`, and `scripts/browser-check.mjs` as committed at the PR #173 baseline.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|---|---|---|
| Candidate order and Rocket-only release-batch selection | Covered | Plan Executive Summary and Research Parent Synthesis agree; `scripts/author-cbh-packet.mjs:239-245` and `scripts/author-cbh-packet.mjs:452` confirm the duplicate-issue guard is a same-call check, consistent with authoring Rocket alone. |
| Guarded workflow only (no parser/score/inference) | Covered | P01-T01 Boundaries exclude inferred issues; `scripts/prepare-cbh-batch.mjs` exists as the named preparation path the details reference. |
| Taxonomy `character-run` / `complete-guide` | Covered | `src/js/lib/catalog.js:11-19` defines `SPOTLIGHT_KINDS` including `complete-guide`; P01-T01/P02-T02 bind it in the manifest proposal and manifest entry. |
| Existing Best of cards unchanged | Covered | Non-Goals and P02-T02 Boundaries exclude Best of record changes; `authorPacket` only touches entries for the supplied `packetIds`. |
| 89→90 / 11→12 / 10→11 / Best of 5-5 / Complete guides 2/2→3/3 | Covered | Baseline commit `086cc5b`, in `test/cbh-character-spotlight.test.js` and `test/catalog-shelves.test.js`, pins the starting counts exactly as Research states; plan's expected final counts are arithmetically consistent (deferred moves from 116 to 115, pilot-approved from 3 to 4 in the character inventory disposition tally). |
| Three Rocket current-library partials, central disposition | Covered | `scripts/author-cbh-packet.mjs:298-375` requires one disposition per comparison with `human`/`stronger-model`/`policy` authority depending on relationship; P02-T01 Validation Expectations match this contract. |
| No new production test files; locked canonical/generated targets | Covered | Plan's Locked Change and Test Boundaries and the phase-details' Locked Test and Change Boundary match the caller's locked candidate boundary verbatim. |
| Groot/Star-Lord/Thanos deferred "with exact research-backed reasons" (plan Acceptance Criteria) | Partial | See PC-001. No phase or task names the character-inventory `reason` text for these three records as a write target, and baseline commit `086cc5b` still carries the generic pre-research placeholder text in `scripts/data/cbh-character-inventory.json`. |
| Installed Edge wide/narrow verification of real post-publication counts | Partial | See PC-002. `scripts/browser-check.mjs:1-26` is deliberately fixture-isolated from the real catalog by design; the plan's fallback ("task-specific external Puppeteer run") has no named artifact, task, or evidence-recording location. |
| Follow-Up Items characterization of why Groot/Star-Lord are blocked | Partial | See PC-003. `scripts/lib/cbh-overlap.mjs:29-56` classifies a 41-of-76 or 25-of-99 overlap as `partial`, which `assertApprovedRelationshipReview` already allows with human/stronger-model disposition; a "separately researched guarded-workflow change" is not actually required to ship them in a later, separate authoring call. |
| Zero runtime dependencies / no Puppeteer install | Covered | `package.json` devDependencies contain no Puppeteer package; `scripts/browser-check.mjs:9-14` documents that `puppeteer-core` must never become a dependency, which the plan and details respect. |
| Exactly one critique, one Review | Covered | `priority-cosmic-character-guides-state.json` records `maximum_critiques: 1`, `critique_runs: 0`, `review.maximum_runs: 1`. |

## Verdict

* Verdict: Revise
* Rationale: The plan is substantively sound, is grounded in a thorough and internally consistent research artifact, and its Rocket-only scope, guarded-workflow usage, taxonomy, and counts are all verified against the live contract files and existing test baselines. However, one plan-stated Acceptance Criterion (exact research-backed deferral reasons for Groot/Star-Lord/Thanos) has no task-level owner and no target file, and the plan's real-catalog browser-verification path relies on a script that is deliberately built to never see the real catalog, with no concrete replacement named. Both are decision-critical for a caller who explicitly required wide/narrow installed-Edge verification of the real card set and research-backed reasons in the same breath as "implementation-ready." Neither finding invalidates the Rocket-only selection or the guarded-workflow mechanics, so a small, targeted revision (not a re-plan) resolves both.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [High]: No task owns the "exact research-backed reasons" acceptance criterion for Groot, Star-Lord, and Thanos

* Related IDs: Plan Acceptance Criteria ("keeps Groot, Star-Lord, and Thanos deferred with exact research-backed reasons"); Research Key Discoveries and Current Decisions; P01, P02-T02 Boundaries ("Excluded: Groot, Star-Lord, Thanos ... another inventory lifecycle change").
* Evidence: In baseline commit `086cc5b`, the Rocket and Thanos records in
  `scripts/data/cbh-character-inventory.json` both still carry the identical generic placeholder reason, `"The source boundary is exact, but issue rows have not been frozen and resolved against the metadata snapshot, so a complete-library relationship cannot be asserted safely."` This is pre-research boilerplate, not a research-backed reason, and it is presently identical for a candidate that will ship (Rocket) and one that is now confirmed blocked by a specific missing issue (Thanos). No phase or task in `.copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md` lists `scripts/data/cbh-character-inventory.json` as a write target for Groot's, Star-Lord's, or Thanos's `reason` field; P01 and P02-T02 explicitly exclude "Groot, Star-Lord, Thanos" and "another inventory lifecycle change" respectively.
* Impact: The plan's own Acceptance Criteria line will not be observably satisfied unless some task writes it, yet every task boundary that mentions these three candidates excludes touching their records. An implementer following the phase details literally will leave the generic placeholder text in place for all three, which contradicts the plan's stated acceptance bar and would read, at Review or in a future audit, as though research was never done for the deferred candidates. Separately, `validateCharacterInventoryRecord` in `scripts/lib/cbh-inventory.mjs:639-679` only permits a `blocked` `centralDisposition` when `metadataHorizonStatus` is exactly `blocked-confirmed-post-horizon`, a status name that means "confirmed to be dated after the metadata horizon," not "absent from an older snapshot." Thanos's actual blocker (`W9`: "the metadata snapshot returns no issue for the exact Spidey Super Stories #39 query") is an absence, not a confirmed future on-sale date. If a future task (or a scope-creeping implementer) tries to move Thanos's `centralDisposition` to `blocked` to reflect the finding, the only available status value would misdescribe the reason.
* Smallest useful change: Add one explicit, narrowly scoped step (in P01 or a new P01-T03/handoff note) that updates only the `reason` text of the Groot, Star-Lord, and Thanos character-inventory records to the exact research findings (e.g., citing the 41/25 shared-issue counts and the missing Spidey Super Stories #39 issue), while leaving `disposition`, `deliveryStatus`, `centralDisposition`, and `metadataHorizonStatus` unchanged at `deferred` / `not-applicable` / `deferred` / `blocked-exact-resolution-not-run` (which the schema already permits together per the `expectedState.deferred` mapping). Explicitly state in the boundary that this is a reason-text-only edit, not a lifecycle change, so it does not conflict with the "no inventory lifecycle change" exclusion. If the plan intends "exact research-backed reasons" to be satisfied by the durable Research artifact alone rather than by the inventory record, revise the Acceptance Criteria wording to say so explicitly instead of naming "the maintained character inventory."
* Action owner: Planning parent (direct correction); no user decision needed, this is a wording/task-ownership gap, not a scope trade-off.
* Exact resolving evidence: The phase details name `scripts/data/cbh-character-inventory.json` reason-field updates for the three deferred ids as an explicit, boundary-scoped step, and/or the plan's Acceptance Criteria wording is adjusted to match whichever artifact is intended to carry "exact research-backed reasons."
* Decision route: Direct planner correction.

<!-- rpi:critique id=PC-002 -->
### PC-002 [High]: The named browser-verification owner cannot observe the real post-publication catalog, and its replacement is unspecified

* Related IDs: Plan Locked Change and Test Boundaries ("Browser verification owner: `scripts/browser-check.mjs` plus a task-specific external Puppeteer run when the maintained script cannot observe the real post-publication card set"); P03, P03-T02 Likely Targets and Validation Expectations (Edge at 1280x900 and a narrow viewport, All 12/11, Best of 5/5, Complete guides 3/3).
* Evidence: `scripts/browser-check.mjs:1-26` states in its own header, verbatim: "The data is fixtures, not the catalog... Stubbing `fetch` for the two data files keeps this check fast, deterministic and immune to a catalog edit that has nothing to do with it," and its `CATALOG` fixture (lines ~205-253) hardcodes "the shipped five Best of and two complete-guide counts" as literal fixture data, independent of `src/data/catalog.json`. This script is therefore structurally incapable of showing the real Rocket card or the real 12/11, 5/5, 3/3 counts; the plan already anticipates this ("plus a task-specific external Puppeteer run when the maintained script cannot observe the real post-publication card set") but the phase details never name that fallback script's path, which task owns writing and running it, or where its evidence is recorded. P03-T02's Likely Targets list only `scripts/browser-check.mjs` itself alongside documentation files, not a new task-specific verification script.
* Impact: The caller explicitly requires wide and narrow installed-Edge verification of the real post-publication card set and counts as a release gate. As written, an implementer has three equally plausible and materially different readings: (a) run the existing fixture-only `browser-check.mjs` and wrongly treat its fixture assertions as satisfying the real-catalog requirement, (b) modify `scripts/browser-check.mjs` itself to read the real catalog, which directly violates that file's documented fixture-isolation invariant and could silently couple an unrelated regression check to future catalog edits, or (c) write an ad hoc, uncommitted verification script whose existence, location, and evidence trail are not planned for and so may not be captured in the changes record. None of these is named as the intended path.
* Smallest useful change: Add one explicit sentence to P03-T02 (or a new sub-bullet in its Likely Targets) naming the task-specific verification mechanism precisely: e.g., "a temporary, non-committed script under `scripts/` that reuses the `server.mjs` static server and the same externally resolved `puppeteer-core` driver pattern as `scripts/browser-check.mjs` (without modifying that file), pointed at the real `src/data/catalog.json`, run once at 1280x900 and once at a narrow viewport, with its exact observed counts and visibility recorded in the changes artifact." This keeps the zero-new-dependency and no-fixture-file-edit constraints explicit and gives the implementer one unambiguous target.
* Action owner: Planning parent (direct correction); no user decision needed, this is a missing implementation detail, not a scope or requirement trade-off.
* Exact resolving evidence: P03-T02 (or a new task) names the exact script path or ad hoc mechanism, confirms it does not modify `scripts/browser-check.mjs`'s fixture, and states where its wide/narrow Edge evidence is recorded.
* Decision route: Direct planner correction.

<!-- rpi:critique id=PC-003 -->
### PC-003 [Low]: Follow-Up Items overstates the barrier to a later Groot/Star-Lord release

* Related IDs: Plan Follow-Up Items ("need distinct later release lanes or a separately researched guarded-workflow change"); Research Alternatives ("Publish Rocket, Groot, and Star-Lord together" rejection rationale); `scripts/author-cbh-packet.mjs:239-245`, `scripts/author-cbh-packet.mjs:394-456`; `scripts/lib/cbh-overlap.mjs:29-56`.
* Evidence: `assertNoDuplicates(issueIds, 'packet issue id')` in `authorPacket` (line 452) only checks uniqueness across the `issueIds` accumulated within one call's `packetIds` array; it does not compare against issues already shipped by a prior, separate `authorPacket` invocation. A later, separate authoring run for Groot (or Star-Lord) against the post-Rocket library would classify its Rocket overlap (41-of-76, or 25-of-99) as `relationship: 'partial'` via `compareIssueSets` (never `exact` or a duplicate-id violation, since 41 < 76 and 25 < 99 and the sets are not equal or strictly nested), and `assertApprovedRelationshipReview` already permits a `partial` relationship with a `human` or `stronger-model` disposition (`scripts/author-cbh-packet.mjs:357-372`), the same mechanism this very plan uses for Rocket's own three current-library partials.
* Impact: This does not change anything about the current Rocket-only plan, which is correctly scoped and does not attempt to ship Groot or Star-Lord. It only affects the accuracy of forward-looking guidance the plan hands to whichever future task re-enters Groot or Star-Lord: as written, that guidance implies a workflow change is a prerequisite, which could cause unnecessary scope (a new research cycle into "workflow change") in a later task when in fact a same-mechanism separate authoring run with a central partial disposition would suffice.
* Smallest useful change: Reword the Follow-Up Items bullet (and the Research Alternative's "Rejection rationale," if it is also carried forward as durable guidance) to state that Groot and Star-Lord can each ship in their own later, separate authoring call once the library includes Rocket, using the existing partial-relationship disposition path, with no guarded-workflow change required. Only the same-batch duplicate-issue rule prevents shipping them together with Rocket in this packet.
* Action owner: Planning parent (direct correction); no user decision needed.
* Exact resolving evidence: The Follow-Up Items wording (and, if retained verbatim, the Research Alternative rationale) is corrected to distinguish "cannot ship in this one packet" from "cannot ever ship without a workflow change."
* Decision route: Direct planner correction.

## Strengths and Residual Risk

* The Rocket-only selection is well-evidenced: the 75-row boundary, the three current-library partials (10/10/7), and the peer-overlap incompatibility with Groot and Star-Lord in one packet are all independently confirmed against `scripts/author-cbh-packet.mjs` and `scripts/lib/cbh-overlap.mjs`, not merely asserted in prose.
* The Locked Change and Test Boundaries in both the plan and phase details match the caller's locked candidate boundary exactly (removals, new-file counts, semantic/filter/guard owners, canonical/generated targets).
* Expected count arithmetic (89→90, 11→12, 10→11, Best of 5/5 unchanged, Complete guides 2/2→3/3) is verified directly against the current values pinned in `test/cbh-character-spotlight.test.js` and `test/catalog-shelves.test.js`, not merely restated from Research.
* Residual, accepted risk: source-count claims (75/76/99, the 41 and 25 shared-issue counts) rest on Research's direct Marvel-metadata and Comic Book Herald evidence (C5-C11, W1-W9), which this critique did not independently re-fetch; this is a normal and appropriate division of labor between Research and Plan Critique.

## Questions or Blocking Evidence Gaps

* None. Both PC-001 and PC-002 are resolvable by the planning parent adding or rewording task-level detail; neither requires a new research cycle or a user decision.

## Limitations

* This critique did not read `scripts/prepare-cbh-batch.mjs`, `scripts/data/cbh-mappings/*`, `scripts/data/cbh-overlaps/*`, `docs/DATA_PROVENANCE.md`, `docs/MAINTENANCE.md`, `.copilot-tracking/anchors.lock.json`, or `.copilot-tracking/research/2026-08-22/character-spotlight-boundaries.json` in full; these are consistent by citation with the plan and were not flagged as risks by anything encountered in the files that were read.
* This critique did not execute `npm test`, `npm run lint`, `npm run counts`, `npm run anchors`, `npm run publication`, `npm run browser`, or any live-metadata contract check, and does not claim the current tree passes them; it only assesses whether the plan's described path through those gates is coherent with the contract source as written.

## Recommended Next Action

* Highest-impact finding: PC-001
* Action owner: planning parent
* Smallest next action: Add an explicit, narrowly scoped reason-text-only update step for the Groot/Star-Lord/Thanos character-inventory records (or reword the Acceptance Criteria to name a different artifact) and name the exact real-catalog Edge-verification mechanism in P03-T02, then finalize without another critique.
* User response required: no

## Related Files

| Path | Description |
|---|---|
| [.copilot-tracking/plans/2026-08-23/priority-cosmic-character-guides-plan.md](.copilot-tracking/plans/2026-08-23/priority-cosmic-character-guides-plan.md) | Critiqued plan |
| [.copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md](.copilot-tracking/details/2026-08-23/priority-cosmic-character-guides-phase-details.md) | Critiqued phase details |
| [.copilot-tracking/research/2026-08-23/priority-cosmic-character-guides-research.md](.copilot-tracking/research/2026-08-23/priority-cosmic-character-guides-research.md) | Controlling research evidence |
| [.copilot-tracking/rpi-sessions/2026-08-23/priority-cosmic-character-guides-state.json](.copilot-tracking/rpi-sessions/2026-08-23/priority-cosmic-character-guides-state.json) | Durable RPI session state |
| [scripts/lib/cbh-inventory.mjs](scripts/lib/cbh-inventory.mjs) | Packet/mapping/report/approval/inventory validation contract |
| [scripts/author-cbh-packet.mjs](scripts/author-cbh-packet.mjs) | Guarded authoring, duplicate-issue guard, relationship approval |
| [scripts/report-order-overlap.mjs](scripts/report-order-overlap.mjs) | Library snapshot and factual overlap report generation |
| [scripts/lib/cbh-overlap.mjs](scripts/lib/cbh-overlap.mjs) | Relationship classification (exact/subset/partial/none) |
| [scripts/browser-check.mjs](scripts/browser-check.mjs) | Fixture-isolated installed-Edge regression check |
| [test/cbh-character-spotlight.test.js](test/cbh-character-spotlight.test.js) | Semantic owner; current baseline counts and disposition tallies |
| [test/cbh-batch.test.js](test/cbh-batch.test.js) | Guard owner; duplicate/freshness/disposition regression coverage |
| [test/catalog-shelves.test.js](test/catalog-shelves.test.js) | Filter owner; current Character Spotlight shelf counts |
| [scripts/data/cbh-character-inventory.json](scripts/data/cbh-character-inventory.json) | Maintained character inventory; Rocket and Thanos records inspected |

## Next Steps

* No user action is required. The planning parent should apply the direct corrections in PC-001, PC-002, and PC-003 to the plan and phase details, then proceed to P01 without invoking another critique.
