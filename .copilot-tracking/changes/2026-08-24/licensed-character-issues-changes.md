<!-- markdownlint-disable-file -->
# RPI Changes: Licensed tie-in exclusion batch

## Metadata

* Task ID: MRT-003-C02-B04
* Parent task: MRT-003-C02
* Related plan: .copilot-tracking/plans/2026-08-24/licensed-character-issues-plan.md
* Phase details: .copilot-tracking/details/2026-08-24/licensed-character-issues-phase-details.md
* Implementation date: 2026-08-24

## Execution Status

* Status: Delivery-ready after routed Review fix
* Declared invocation scope: Full plan
* Completed scope markers: P01, P01-T01, P01-T02, P02, P02-T01 through P02-T03, P03,
  P03-T01 through P03-T03, P04, P04-T01, P04-T02, and P05-T01
* All remaining active-plan markers: P05 and P05-T02
* Status basis: Exact evidence, validation, and the sole post-implementation Review are complete.
  The Review's one material finding has a demonstrated fix; commit and pull-request delivery remain.

## Execution Summary

Implementation started from current project-default main with the exact 31-row exclusion decision,
58 retained rows, one resolved critique, and no active blocker.

## Completed Work

### Exact source conservation primitives

* Related phase or task: P01-T01
* Files: scripts/lib/cbh-inventory.mjs, scripts/prepare-cbro-event.mjs,
  test/cbh-batch.test.js
* What changed and why: Added optional structured excluded-source rows, complete source-position
  reconstruction, digest and mapping propagation, and strict rejection of malformed or
  nonconserving ledgers while preserving legacy packet behavior.
* Completion evidence: The shared packet contract reconstructs retained positions as the complement
  of exact exclusions and rejects missing fields, extra fields, duplicate positions, unordered
  positions, count mismatches, and mapping drift.
* Validation: Passed 42 focused shared and historical tests with zero failures.

### Exact B03 blocked-outcome guard

* Related phase or task: P01-T02
* Files: scripts/lib/cbro-evidence.mjs, test/cbro-historical-events.test.js
* What changed and why: Added an immutable digest for the three exact B03 blocked outcomes so B04 can
  normalize its selected records back to the committed predecessor state without changing the B03
  nonselected constant or filter.
* Completion evidence: Current B03 outcomes match the new digest and all prior release tests pass.
* Validation: Partial for P01-T02; the B04 untouched invariant is added after the three exact
  inventory transitions exist.

### Exclusion-aware release authority and evidence

* Related phase or task: P01-T02 and P02-T01 through P02-T03
* Files: continuation resolution and packet scripts, three packets, three mappings, three overlap
  reports, historical inventory authority, and shared CBRO release authority
* What changed and why: Conserved all 89 source rows as 58 exact retained rows and 31 exact
  guide-scoped exclusions, resolved every retained row against configured metadata, derived author
  chronology, and approved eight exact non-none relationship tuples.
* Completion evidence: Wraith War resolves 7 of 35 rows, Secret Wars II 40 of 42, and Mutant
  Massacre 11 of 12. The release reports 116 comparisons per guide and no unapproved relationship.
* Validation: All 45 focused shared and historical tests pass.

### Three truthful non-complete guides

* Related phase or task: P03-T01 through P03-T03
* Files: three checklists, three payloads, manifest, catalog, inventory, changelog, backlog, and
  data provenance
* What changed and why: Published Wraith War at essential depth and the other two guides at selected
  depth, with reader-facing disclosure naming every omitted tie-in and linking the full source
  order.
* Completion evidence: The catalog has 117 lists. All 58 retained payload rows have exact metadata,
  covers, and reader links with zero placeholders and zero unresolved rows.
* Validation: Focused authoring tests verify depth, disclosure, sequence, payloads, and chronology.

### Conservation mutation proof

* Related phase or task: P04-T01
* Files: shared exclusion validator, preparation propagation, and focused tests
* What changed and why: Added semantic ownership for exact ledgers, retained-position complements,
  mapping propagation, predecessor compatibility, and generated product surfaces.
* Completion evidence: Stashing only the conservation implementation made the new focused test fail
  on the unsupported exclusion ledger. Restoring it returned all 45 focused tests to green.
* Validation: 12 passed and 1 failed under the mutation; 45 passed and zero failed after restoration.

### Complete repository and browser validation

* Related phase or task: P04-T02
* Files: Final staged product, evidence, tests, and direct delivery records
* What changed and why: Reconciled historical catalog expectations to the three-guide addition,
  corrected the generated singular exclusion disclosure, and exercised the shipped catalog in
  installed Edge without adding a browser dependency.
* Completion evidence: The bare test suite passed 1,449 tests. The general installed-Edge suite
  passed 186 assertions across 19 scenarios. A focused 1280 by 900 Edge pass added 21 assertions
  covering all three cards, exact counts, non-complete framing, reader disclosure, preview order,
  and persisted import order.
* Validation: Lint, counts, sizes, palette, anchors, publication, and the 33-assumption live
  metadata contract passed. Anchors ended at 1,186 unchanged with zero drift, additions, or removals.

### Sole Review and exact exclusion authority

* Related phase or task: P05-T01
* Files: Canonical Review record, scripts/lib/cbro-evidence.mjs, and
  test/cbro-historical-events.test.js
* What changed and why: The sole Review found that generic conservation accepted an invented
  exclusion after self-derived packet digests were recomputed. Added immutable release-scoped
  digests for each complete B04 exclusion ledger, so exact positions, issue references, reasons,
  decision scope, and counts are bound independently of packet-controlled data.
* Completion evidence: A new Secret Wars II mutation changes 40 retained plus 2 approved exclusions
  into 39 retained plus 3 exclusions and recomputes the packet digest. It now fails against the
  approved ledger, as does changing only the decision scope.
* Validation: The new focused test first failed with a missing expected exception, then passed after
  the release authority was added. This resolves RV-001 without a second Review.

## Implementation-Time Plan and Detail Updates

The generated single-exclusion sentence used plural agreement. It was corrected in the authoring
path and the Mutant Massacre checklist before Review. This preserved approved behavior and required
no scope, dependency, acceptance, or user-decision change.

## Validation Record

| Check | Scope | Status | Evidence or reason |
|---|---|---|---|
| Starting tree | Current branch | Passed | Clean before RPI artifact creation |
| Focused shared and historical tests | P01 contracts | Passed | 42 passed, zero failed |
| Exact metadata resolution | P02 | Passed | 89 source rows equal 58 retained plus 31 excluded; all retained rows exact |
| Relationship review | P02 | Passed | 348 complete comparisons and eight approved non-none tuples |
| Vendor output | P03 | Passed | 58 items, zero placeholders, zero unresolved |
| Conservation mutation proof | P04-T01 | Passed | One targeted failure without implementation, 45 focused tests green after restoration |
| Lint | Complete tree | Passed | Zero findings |
| Bare test suite | Complete tree | Passed | 1,449 passed, zero failed |
| Counts, sizes, and palette | Product data | Passed | All direct repository gates accepted the three-guide catalog |
| Evidence anchors | Complete tracked tree | Passed | 1,186 unchanged, zero drifted, zero new, zero removed |
| Publication history | Product delivery | Passed | Publication gate accepted the current delivery history |
| Live metadata contract | Configured upstream assumptions | Passed | 33 of 33 assumptions |
| General installed Edge | Runtime regression | Passed | 186 assertions across 19 scenarios |
| Focused installed Edge at 1280 by 900 | B04 runtime behavior | Passed | 21 assertions across three catalog previews and imports |
| Review authority mutation before fix | Exact approved-ledger authority | Failed as intended | Invented 39 plus 3 packet remained accepted, producing one missing-exception failure |
| Review authority mutation after fix | Exact approved-ledger authority | Passed | One targeted test rejects an invented exclusion and a changed decision scope after digest recomputation |
| Post-Review bare test suite | Complete tree with RV-001 fix | Passed | 1,450 passed, zero failed |
| Post-Review lint, anchors, counts, sizes, and palette | Complete tree with RV-001 fix | Passed | Zero lint findings; 1,186 unchanged anchors; all direct data gates passed |

## Pre-Review Reconciliation

* Plan markers and phase details: Current through completed P04.
* Completed-work evidence and handoff prose: Current for all implementation and validation work.
* Validation, blockers, remaining work, and follow-up items: Reconciled for the sole Review.
* Review readiness: Ready; all P01 through P04 completion evidence exists.

## Blockers

* None.

## Remaining Work

* P05-T02.

## Follow-Up Items

* Canonical plan list: .copilot-tracking/plans/2026-08-24/licensed-character-issues-plan.md,
  `## Follow-Up Items`
* Supplemental essential-trade candidates and position-17 Evolutionary War remain future work.

## Return-to-Caller State

* Implementation execution status: Delivery-ready after routed Review fix
* Declared scope and markers: Full plan; P01 through P04 and P05-T01 are complete, with P05-T02 active.
* Validation coverage: Two mutation proofs, all repository gates, live contract, and installed Edge.
* Blockers: None.
* Current plan and detail updates: None.
* Planning and critique state: Ready after PC-001 through PC-003 corrections.
* Follow-up items: Supplemental source candidates and position 17 remain outside scope.
* Review readiness or no-handoff reason: Sole Review complete; RV-001 resolved without another Review.
* Continuation owner: Automatic RPI parent.
