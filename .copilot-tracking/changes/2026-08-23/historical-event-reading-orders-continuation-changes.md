<!-- markdownlint-disable-file -->
# RPI Changes: Historical event reading orders continuation

## Metadata

* Task ID: MRT-003-C02
* Related plan: .copilot-tracking/plans/2026-08-23/historical-event-reading-orders-continuation-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/historical-event-reading-orders-continuation-phase-details.md
* Implementation date: 2026-08-23

## Execution Status

* Status: Partial
* Declared invocation scope: Full plan
* Completed scope markers: P01 through P04 and P05-T01
* All remaining active-plan markers: P05-T02 and P05-T03
* Status basis: The clean recovery removed RV-001 from reachable history, preserved the sole Review,
  regenerated continuation evidence against current main, and passed the local release gates.

## Execution Summary

The parent-supplied research, scan, resolution, plan, and phase details were copied byte-for-byte
into their canonical paths. Current HEAD matched current origin/main before critique. One independent
critique returned Revise with four direct planner corrections, all now applied without a second
critique.

## Completed Work

### Recreated supplied evidence and reconciled the sole critique

* Related phase or task: Planning handoff before P01-T01
* Files: Supplied MRT-003-C02 research, plan, phase details, critique, and this changes record
* What changed and why: Recreated the parent evidence, ran the only critique, and applied PC-001
  through PC-004 so implementation begins from an honest Ready state.
* Completion evidence: Source and destination SHA-256 values matched for all five supplied artifacts;
  the critique artifact records one Complete execution with verdict Revise and four findings.
* Validation: Current HEAD and origin/main both resolved to f3b0875c5c45ffbb5b3a0f6337ba98345b70d896.

### Established additive release authority

* Related phase or task: P01-T01 through P01-T03
* Files: `scripts/lib/cbro-evidence.mjs`, `scripts/prepare-cbro-event.mjs`,
  `scripts/author-cbro-packet.mjs`, `scripts/data/cbro-historical-inventory.json`, and
  `test/cbro-historical-events.test.js`
* What changed and why: Added a second complete known release with separate source and chronology
  arrays, preserved the original exports and defaults, selected only inventory positions 1 through
  5, and scoped `candidate-subset` authority to Kree-Skrull War.
* Completion evidence: Current HEAD equals origin/main; all three source pages retain their approved
  byte lengths and SHA-256 values; 16 focused semantic cases pass.
* Validation: Both new cases failed against their matching pre-fix authority or inventory state and
  passed after restoration.

### Froze and approved the five-event evidence set

* Related phase or task: P02-T01 through P02-T04
* Files: Five files each under `scripts/data/cbro-packets`, `scripts/data/cbro-mappings`, and
  `scripts/data/cbro-overlaps`, plus the CBRO approval helper and semantic tests
* What changed and why: Froze the current provider-bound source rows, regenerated exact mappings
  from live metadata, compared every candidate with 97 current lists and four selected peers, and
  approved only the Kree-Skrull War subset relationship through named stronger-model authority.
* Completion evidence: Five packets contain 32 unique rows; five reports contain 101 comparisons
  each and 505 total; the only non-none comparison is the nine shared Kree-Skrull War issues with
  Essential Avengers.
* Validation: The 18-case semantic suite passes. Both P02 cases failed when the matching packet or
  approval authority was removed and passed after restoration.

### Authored and integrated five historical event guides

* Related phase or task: P03-T01 through P03-T03
* Files: Five files under `src/data/orders`, five vendored payloads, `src/data/curated-lists.json`,
  `src/data/catalog.json`, inventory, catalog era configuration and tests, changelog, backlog,
  provenance, maintenance, publication, governance, and semantic tests
* What changed and why: Authored the complete approved release atomically, vendored 32 current issue
  rows, placed all five cards in first-on-sale chronology, expanded the historical era to 1965, and
  updated the directly related product and maintainer records.
* Completion evidence: The catalog now contains 102 lists. Inventory totals are ten shipped, 44
  ranked, two metadata-blocked, one absorbed, and one provenance-blocked.
* Validation: The 19-case CBRO suite and 57 focused integration checks pass. The P03 case failed when
  one payload was removed and passed after restoration.

### Performed final-candidate validation and the sole post-implementation Review

* Related phase or task: P04-T01 and P04-T02
* Files: Review log at .copilot-tracking/reviews/logs/2026-08-23/historical-event-reading-orders-continuation-review.md,
  live contract surface, installed Edge, and release gates.
* What changed and why: Ran the required release checks, directly probed the metadata health endpoint,
  inspected all five real catalog cards and their first, middle, and last reading positions in Edge,
  and completed the only independent post-implementation Review.
* Completion evidence: The health endpoint answered HTTP 200. The final live contract passed 33 of 33
  assertions. Focused Edge verification at 1280 by 900 passed for all five cards and all 32 exact
  issue sequences. The Review found RV-001, a material publication-boundary blocker.
* Validation: The first inherited contract invocation failed with `TypeError: fetch failed` against
  the live metadata service. A direct health probe then answered successfully, and the retry passed all
  33 assumptions. Lint passed. Full tests passed 1,419 of 1,419 only while an unsafe publication
  allowlist was present; the Review rejected that masking approach, it was withdrawn, and final
  publication and test results remain blocked on removal of the identifier from branch history.

### Recovered the release on current main without the private identifier

* Related phase or task: P04-T03 and P05-T01
* Files: The five continuation packets, mappings, overlap reports, approvals, orders, payloads, catalog,
  direct records, tests, anchor lock, and the sanitized continuation artifacts.
* What changed and why: Recreated the unpublished implementation as fresh history from current main,
  without copying the private identifier found by RV-001. Regenerated the dependent continuation evidence
  after main added four catalog entries.
* Completion evidence: Five reports now contain 105 comparisons each and 525 total. The five cards remain
  32 exact issues in installed Edge at 1280 by 900.
* Validation: Lint passed; 1,436 tests passed; counts, sizes, palette, anchors, and publication passed;
  the live contract passed 33 of 33 assertions.

## Implementation-Time Plan and Detail Updates

### Applied the complete sole-critique finding set

* Affected plan area or markers: Acceptance Criteria, Dependencies and Risks, P02-T01, P03-T01,
  P05-T03, Critique Disposition, and Planning Readiness
* What changed: Recorded all four actual findings, named a post-merge PR comment as the durable
  closeout sink, corrected the 53-record preservation count, and distinguished two printed ranges
  from the singleton Wedding row.
* Why: PC-001 through PC-004 identified direct evidence and control corrections.
* Triggering evidence: The sole independent critique artifact.
* User answer or decision: None required.
* Reconciliation performed: Plan disposition, readiness, acceptance criteria, risks, task details,
  dependencies, and closeout sequencing are current.
* Planning and critique state: Ready after PC-001 through PC-004; no second critique is permitted.

## Validation Record

| Check | Scope | Status | Evidence or reason |
|---|---|---|---|
| Supplied artifact SHA-256 comparison | Five parent artifacts | Passed | Every copied artifact matched its supplied source. |
| Current main reconciliation | P01-T01 baseline | Passed | HEAD equals origin/main at f3b0875c5c45ffbb5b3a0f6337ba98345b70d896. |
| Source refresh | Three canonical CBRO pages | Passed | Byte lengths and SHA-256 values remain 79993/2ce9dab7..., 655278/ee03c5a5..., and 655257/f52f54fa.... |
| Focused semantic suite | P01 | Passed | 16 tests passed, including 14 inherited and two new cases. |
| P01 failure proofs | Two new cases | Passed | Release authority and inventory authority checks each exited nonzero without the matching fix. |
| Live mapping preparation | Five continuation packets | Passed | 32 rows resolved exactly through the current metadata API. |
| Report and approval generation | Five candidates | Passed | 505 comparisons, 504 none relationships, and one centrally approved candidate-subset. |
| Focused semantic suite | P02 | Passed | 18 tests passed, including all 14 inherited cases. |
| P02 failure proofs | Two new cases | Passed | Packet identity and subset authority checks each exited nonzero without matching evidence or code. |
| Pre-author main and source refresh | P03 boundary | Passed | HEAD still equals origin/main and all three canonical source digests remain unchanged. |
| Atomic authoring | Five approved mappings | Passed | Five checklists and the shipped inventory state were written with 32 total issues. |
| Vendoring | Five authored IDs | Passed after one transient retry | Five payloads contain 32 rows, zero placeholders, zero unresolved rows, and remote cover URLs. |
| Focused product integration tests | P03 | Passed | 57 checks passed across CBRO semantics, era routing, governance, publication, and shipped copy. |
| P03 failure proof | Authored payload case | Passed | The check exited nonzero when one payload was removed. |
| P04 direct metadata reachability | `https://marvel.emreparker.com/v1/health` | Passed | HTTP 200 with the expected health payload. |
| P04 live contract, first attempt | Live metadata API | Failed externally | `TypeError: fetch failed` before any contract assertion completed. |
| P04 live contract, retry | Live metadata API | Passed | 33 of 33 assumptions held across 17 requests. |
| P04 focused Edge inspection | Five real historical cards at 1280 by 900 | Passed | All five names, descriptions, source credits and links, and exact first, middle, last, and complete sequences matched. |
| P04 generic Edge suite | Existing 19 browser scenarios | Failed outside scope | 181 assertions passed and one stale Home-copy assertion failed after current main changed; the five-guide focused inspection passed. |
| P04 sole independent Review | Complete branch and release candidate | Blocked | RV-001 requires removal of a private session identifier from unpublished continuation history. |

## Pre-Review Reconciliation

* Plan markers and phase details: Current through P04-T02.
* Completed-work evidence and handoff prose: Current through the sole Review.
* Validation, blockers, remaining work, and follow-up items: P04-T03 and P05 remain.
* Review readiness: Complete. No second Review is permitted.

## Blockers

* RV-001: The sole Review found a private session identifier in unpublished continuation history.
  The current record was corrected, but the publication gate scans all reachable commits. Rewriting
  the unpublished continuation commit is required before P04-T03 and P05 can proceed.

## Remaining Work

* Remove RV-001 from unpublished continuation history, then rerun P04-T03's full final gate set.
* Complete P05 after the corrected branch passes every required local and browser check.

## Follow-Up Items

* Canonical plan list: .copilot-tracking/plans/2026-08-23/historical-event-reading-orders-continuation-plan.md, `## Follow-Up Items`
* None outside the parent-owned automatic continuation.

## Return-to-Caller State

* Implementation execution status: Blocked
* Declared scope and markers: Full plan; P01 through P04-T02 complete; P04-T03 and P05 remain.
* Validation coverage: Parent artifact hashes, main and source freshness, 19 CBRO tests, five
  negative proofs, 57 focused integration checks, 32 exact mappings, 505 current comparisons, five
  vendored payloads, 33 live contract assertions, and focused five-card Edge verification.
* Blockers: RV-001, the retained private identifier in unpublished branch history.
* Current plan and detail updates: PC-001 through PC-004 applied.
* Planning and critique state: Ready; the sole critique is complete.
* Follow-up items: None.
* Review readiness or no-handoff reason: The sole Review is complete. No release handoff is valid
  until RV-001 is removed from branch history.
* Continuation owner: Coordinating parent.
