<!-- markdownlint-disable-file -->
# RPI Plan Critique: Character spotlight guides

## Metadata

* Task ID: MRT-002-C01
* Critique date: 2026-08-23
* Plan: .copilot-tracking/plans/2026-08-23/character-spotlight-guides-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: One White Tiger pilot on the existing Character Spotlight screen using `character-run`, with no new browse surface, no silent shortening, no runtime dependencies, no image byte storage, no fixed-origin change, and no em or en dashes. Lower-cost workers may only do bounded deterministic tasks from frozen inputs. Source freeze, ambiguous identity decisions, partial or subset overlap disposition, anchor reading, final release authority, CI interpretation, and merge remain coordinator-only.
* Research and evidence considered: .copilot-tracking/plans/2026-08-23/character-spotlight-guides-plan.md, .copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md, .copilot-tracking/research/2026-08-22/character-spotlight-guides-research.md, .copilot-tracking/research/2026-08-22/character-spotlight-source-inventory.json, .copilot-tracking/research/2026-08-22/character-spotlight-dispositions.json, .copilot-tracking/research/2026-08-22/character-spotlight-current-library.json, .copilot-tracking/research/2026-08-22/character-spotlight-white-tiger-evidence.json, .copilot-tracking/research/2026-08-22/character-spotlight-page-scan.json, .copilot-tracking/rpi-sessions/2026-08-22/character-spotlight-guides-state.json, scripts/vendor-orders.mjs, scripts/prepare-cbh-batch.mjs, scripts/lib/cbh-inventory.mjs, src/js/lib/curated.js, test/curated.test.js, test/catalog.test.js, test/catalog-shelves.test.js, and test/licence-boundary.test.js.
* Decisions, dependencies, and acceptance criteria considered: the single White Tiger pilot, 82 source-defined rows, the 86-list current-library comparison, four centrally approved partial overlaps, the 128-identity source inventory, the locked change and test boundary, the canonical and generated file roles, and the coordinator-only release authority.
* Assessment boundary: This critique is read-only and stays within the supplied and matching repository artifacts. It does not re-run the implementation or perform open-ended research. The caller-named files that were absent in this checkout were substituted with the matching repository artifacts listed above.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|------------------------------------------|----------|---------------------|
| Caller requirements and scope | Covered | The plan keeps the work to one White Tiger pilot, the existing `character-run` surface, and the no-new-runtime, no-new-surface, no-silent-shortening boundary. |
| Research evidence C1-C15 and W1-W7 | Covered | The research set consistently supports the 128-source inventory, the 82-row White Tiger packet, the 86-list comparison, and the four partial overlaps. |
| P01 and P01-T01/T02 | Covered | Inventory, packet, mapping, and preparation remain centralized and bounded. |
| P02 and P02-T01/T02 | Covered | The complete-library report, central partial approval, manifest insertion, generated payload, and catalog regeneration are all scoped. |
| P03 and P03-T01/T02 | Partial | The release gate list does not name the existing catalog-length regression that will fail after White Tiger is added. See PC-001. |
| Locked test boundary | Partial | The plan names the new focused test file and the catalog, shelf, and curated-data regressions, but not the existing catalog-length test that still hardcodes 86 shipped orders. |
| Canonical and generated boundary | Covered | The canonical manifest, local source order, generated payload, and regenerated catalog are assigned the expected roles. |
| Authority boundary | Covered | Source freeze, disposition, anchor reading, PR, CI interpretation, and merge stay with the coordinator, while lower-cost work stays deterministic. |

## Verdict

* Verdict: Revise
* Rationale: The White Tiger evidence and central approval model are credible, but the plan misses one existing regression test that will fail once the catalog gains a ninth Character Spotlight entry. That leaves the final candidate not yet implementation-safe.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [High]: Missing existing catalog-length regression

* Related IDs: P03, P03-T01, P03-T02, locked test boundary, test/licence-boundary.test.js
* Evidence: test/licence-boundary.test.js:27-43 hardcodes `assert.equal(orders.length, 86)` for the shipped catalog. The plan's P03 test ownership and validation set names the new focused file plus the catalog shelf, catalog, and curated-data tests, but it does not reserve this existing regression or account for the catalog length moving to 87 when White Tiger is added.
* Concern: The plan will fail its own `npm test` gate after publication because the catalog-length assertion still expects the pre-change total.
* Impact: A correct implementation can be blocked by an unchanged regression test even if the White Tiger data, manifest, and catalog are otherwise right.
* Smallest useful change: Add test/licence-boundary.test.js to the P03 existing-regression ownership list and revise its 86-count assertion to derive the expected shipped-order total from the updated manifest, or update the literal to the post-change count if that is the intended invariant.
* Action owner: Planning parent
* Exact resolving evidence: The plan explicitly names the test set that must pass, and the revised test file asserts the new shipped catalog total instead of 86.
* Decision route: Direct planner correction

## Strengths and Residual Risk

* The White Tiger evidence is internally consistent: 82 rows, 86 comparisons, four partial relationships, latest resolved date 2022-09-28, and 128 source identities all line up.

## Questions or Blocking Evidence Gaps

* None that block a decision.

## Limitations

* The caller-named files character-spotlight-current-character-runs.json, character-spotlight-source-order.json, build-character-guide-packet.mjs, build-catalog.mjs, manifest-completeness.test.mjs, schema-and-links.test.mjs, catalog-order.test.mjs, and reading-list-content.test.mjs were not present in this checkout. Assessment used the matching repository artifacts: character-spotlight-current-library.json, character-spotlight-source-inventory.json, scripts/vendor-orders.mjs, test/catalog.test.js, test/catalog-shelves.test.js, test/curated.test.js, and test/licence-boundary.test.js.

## Recommended Next Action

* Highest-impact finding: PC-001
* Action owner: Planning parent
* Smallest next action: Revise P03 test ownership and the shipped-catalog count assertion so the existing catalog-length regression cannot fail the White Tiger release.
* User response required: no

| Artifact | Description |
|---|---|
| [.copilot-tracking/plans/2026-08-23/character-spotlight-guides-plan.md](.copilot-tracking/plans/2026-08-23/character-spotlight-guides-plan.md) | Final-candidate plan under critique |
| [.copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md](.copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md) | Phase details and task-level boundary |
| [.copilot-tracking/research/2026-08-22/character-spotlight-guides-research.md](.copilot-tracking/research/2026-08-22/character-spotlight-guides-research.md) | Research synthesis and evidence map |
| [.copilot-tracking/research/2026-08-22/character-spotlight-source-inventory.json](.copilot-tracking/research/2026-08-22/character-spotlight-source-inventory.json) | 130-entry source inventory with 128 unique identities |
| [.copilot-tracking/research/2026-08-22/character-spotlight-dispositions.json](.copilot-tracking/research/2026-08-22/character-spotlight-dispositions.json) | Central disposition matrix |
| [.copilot-tracking/research/2026-08-22/character-spotlight-current-library.json](.copilot-tracking/research/2026-08-22/character-spotlight-current-library.json) | Current-library comparison set |
| [.copilot-tracking/research/2026-08-22/character-spotlight-white-tiger-evidence.json](.copilot-tracking/research/2026-08-22/character-spotlight-white-tiger-evidence.json) | White Tiger packet and overlap evidence |
| [.copilot-tracking/research/2026-08-22/character-spotlight-page-scan.json](.copilot-tracking/research/2026-08-22/character-spotlight-page-scan.json) | Source page scan evidence |
| [.copilot-tracking/rpi-sessions/2026-08-22/character-spotlight-guides-state.json](.copilot-tracking/rpi-sessions/2026-08-22/character-spotlight-guides-state.json) | Session state and recovery provenance |
| [test/licence-boundary.test.js](test/licence-boundary.test.js) | Existing regression that hardcodes the current catalog size |

## Next Steps

No user action is required. The planning parent should revise the plan and continue from there.
