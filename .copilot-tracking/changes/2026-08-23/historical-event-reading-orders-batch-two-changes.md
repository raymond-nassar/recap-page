<!-- markdownlint-disable-file -->
# RPI Changes: Historical event reading orders batch two

## Metadata

* Task ID: MRT-003-C02-B02
* Task slug: historical-event-reading-orders-batch-two
* Related research: .copilot-tracking/research/2026-08-23/historical-event-reading-orders-batch-two-research.md
* Related plan: .copilot-tracking/plans/2026-08-23/historical-event-reading-orders-batch-two-plan.md
* Related phase details: .copilot-tracking/details/2026-08-23/historical-event-reading-orders-batch-two-phase-details.md
* Related critique: .copilot-tracking/reviews/plans/2026-08-23/historical-event-reading-orders-batch-two-plan-critique.md
* Implementation date: 2026-08-23
* Execution status: Release-ready

## Completed Work

### CHG-001: Established the guarded second continuation release

* Related plan task: P01-T01 through P01-T03
* What changed: Added the exact five-ID batch-two release, an immutable digest projection for all
  53 nonselected inventory records, and source-neutral release-scoped relationship authority.
* Why: Positions 6 through 10 can now enter the same evidence-bound release flow without changing
  the original or first-continuation behavior.
* Evidence: The full inventory identity digest is
  d61fd0780570c15c19bd27d7b9ab80c82c26c46445861bf0c11274d05bfea003. The immutable nonselected
  projection digest is 0fb172f493fff2d6001a9c8c3bf2efaf756c40566056df00373a3f18e58c7316.

### CHG-002: Froze and resolved the reviewed timeline ranges

* Related plan task: P01-T02 and P02-T01
* What changed: Added a configuration-driven timeline packet freezer and froze five visible source
  ranges with the approved shared timeline digest
  2ce9dab79ef1f71bc2c4bdbb366f56e29b9f18dccb5c073613192dd7f2be54eb.
* Why: Exact visible source labels, inclusive rows, provider identity, and manual metadata aliases
  remain reviewable build-time evidence rather than runtime behavior.
* Evidence: All 35 rows resolve exactly. Original Clone Saga has 13 rows, Phoenix Saga has 8, Dark
  Phoenix Saga has 9, Days of Future Past has 2, and Contest of Champions has 3.

### CHG-003: Bound current overlap decisions and authored the release

* Related plan task: P02-T02 through P03-T02
* What changed: Generated current complete-library and four-peer reports, approved only the seven
  named non-none relationships, authored five checklists, vendored five payloads, and published five
  chronological catalog cards.
* Why: Candidate subsets and the one partial overlap retain their distinct-reader rationale without
  opening a broad exception to duplicate protection.
* Evidence: Each report covers 110 comparisons: 106 current non-batch-two library orders and four
  selected peers. The five reports contain 550 comparisons in total, with seven approved non-none
  decisions and all other relationships none. The catalog now has 111 lists.

### CHG-004: Recorded the shipped product and maintainer state

* Related plan task: P03-T03
* What changed: Updated public provenance, maintainer and publication records, the changelog, and
  the product backlog for the five-guide release.
* Why: Published claims and continuation handoff now identify 15 shipped historical guides and the
  fixed third release.
* Evidence: The 58-entry inventory now has 15 shipped entries, 39 later ranked entries, one deferred
  subset, two metadata-blocked entries, one absorbed entry, and one provenance-blocked entry.

## Validation Record

| Check | Scope | Status | Evidence |
|---|---|---|---|
| Focused CBRO semantic suite | Release, source, aliases, mapping, overlaps, authoring | Passed | 25 tests passed after all five guides were authored. |
| Lint | Whole workspace | Passed | ESLint reported no findings. |
| Evidence anchors | Whole workspace | Passed | 1,181 anchors reported 0 drifted, 0 new, and 0 removed after reviewed re-aiming. |
| Derived counts | Product backlog | Passed | 188 ranked rows, 165 shipped items, and 193 detail blocks agree. |
| Complete Node suite | Whole workspace | Passed | 1,440 tests passed. |
| Publication gates | Reachable history and remote surface | Passed | No protected-root, credential, or private-path finding. |
| Live contract | Metadata API | Passed | All 33 assertions passed. |
| Edge verification | Five released cards at 1280 by 900 | Passed | Every card rendered; all 35 payload positions matched frozen mappings. |
| Independent review | Current release candidate | Clean | No material finding. |

## Remaining Work

* Open the pull request, wait for the hosted Node 20, Node 24, and lint jobs, then merge only when
  all required jobs are green and report the merged result to the creator.
* Do not begin batch three.
