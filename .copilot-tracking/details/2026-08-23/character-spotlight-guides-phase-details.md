<!-- markdownlint-disable-file -->
# RPI Phase Details: Character spotlight guides

## Metadata

* Task ID: MRT-002-C01
* Parent: MRT-002 / reading-list-expansion
* Task slug: character-spotlight-guides
* Related plan: .copilot-tracking/plans/2026-08-23/character-spotlight-guides-plan.md
* Evidence sources: .copilot-tracking/research/2026-08-22/character-spotlight-guides-research.md,
  .copilot-tracking/research/2026-08-22/character-spotlight-dispositions.json, and
  .copilot-tracking/research/2026-08-22/character-spotlight-white-tiger-evidence.json

## Phase Index

| Phase ID | Name | Status | Detail sections |
|---|---|---|---|
| P01 | Guard the character inventory and packet | complete | P01, P01-T01, P01-T02 |
| P02 | Approve and publish the reading | complete | P02, P02-T01, P02-T02 |
| P03 | Prove the product and release record | complete | P03, P03-T01, P03-T02 |

## Task-Level Context

### Context

Research recovered and completed an exhaustive source pass before selecting one pilot. All 128 source
identities have exact digest-backed page boundaries and central dispositions. White Tiger alone has an
exact 82-row metadata mapping and complete comparison with all 86 current lists. The inherited workflow
already supplies packet, digest, overlap, approval, authoring, vendoring, and stale-input contracts.

### Intent

Plan one bounded implementation that maintains the character inventory and publishes White Tiger through
the existing Character spotlights surface without adding runtime behavior.

### Boundaries

* Included: one character inventory, one frozen pilot packet, exact mapping, complete-library report,
  central partial approval, `character-run` publication, semantic coverage, records, and release gates.
* Excluded: every other guide, new surfaces or placement metadata, runtime dependencies, image storage,
  origin or storage changes, silent shortening, and lower-cost approval authority.

### Initial Evidence and Readiness

* Research status: complete.
* Selected pilot: `white-tiger-ava-ayala`, 82 exact issues.
* Latest metadata date: 2022-09-28.
* Complete-library relationships: four partial, centrally approved.
* Planning blockers: none.

### Active Authority Boundary

* Lower-cost eligible: deterministic preparation on a frozen packet, complete-library report generation,
  named authoring, targeted validation, and Edge script execution.
* Coordinator-only: inventory disposition, source boundary, reviewed metadata identity, partial approval,
  anchor reading, PR, CI interpretation, and merge.

### Locked Test and Change Boundary

* Exact removals: none.
* Maximum new production data artifacts: six.
* Maximum new production test files: one.
* Semantic test owner: `test/cbh-character-spotlight.test.js`.
* Guard regression owner: `test/cbh-batch.test.js`.
* Existing product regression owners: catalog shelf, catalog, and curated-data tests.
* Browser evidence: Character spotlights only, 82 issues, first/middle/final order.

### Unresolved Items

* None.

<!-- rpi:phase id=P01 -->
## P01: Guard the character inventory and packet

### Context

The current preparation entry point defaults to one modern inventory. Packet validation itself needs only
the matching record, current catalog entries, and existing lifecycle eligibility. The character source
record must therefore join selection through a narrow explicit inventory contract rather than bypass the
validator or alter modern inventory totals.

### Intent

Create a maintained character inventory and make named packet preparation select its matching validated
record without changing the modern inventory contract.

### Boundaries

* Included: character inventory schema, unique source identities, lifecycle status, packet lookup, and
  focused tests.
* Excluded: merging character semantics into modern queue counts or changing existing packet behavior.

### Likely Targets

* `scripts/data/cbh-character-inventory.json`: canonical 128-identity maintained inventory.
* `scripts/lib/cbh-inventory.mjs`: shared schema validation and character-specific invariants.
* `scripts/prepare-cbh-batch.mjs`: explicit inventory selection for frozen packets.
* `test/cbh-character-spotlight.test.js`: semantic inventory and selection coverage.

### Dependencies

* Research disposition and source inventory artifacts.

### Validation Expectations

* Exactly 128 unique source URLs and stable ids.
* Duplicate index labels remain represented as aliases on one source identity.
* White Tiger alone advances to shipped; excluded and blocked identities keep their reasons.
* Existing 86-record modern inventory tests remain unchanged and green.

### Completion Evidence

* Character inventory validates independently.
* Preparation finds White Tiger once and rejects stale, missing, duplicate, or ineligible identity.

### Unresolved Items

* None.

<!-- rpi:task id=P01-T01 -->
### P01-T01: Add the maintained character inventory contract

#### Context

The research inventory has 130 labels and 128 unique URLs. Production needs one record per source identity,
with aliases preserving duplicate labels and lifecycle reasons preserving central dispositions.

#### Intent

Materialize and validate a 128-record inventory without changing the fixed modern baseline.

#### Boundaries

* Included: exact source URL, labels, stable id, central disposition, reason, retrieval date, catalog ids,
  and delivery status.
* Excluded: issue rows, product copy, and new catalog placement fields.

#### Likely Targets

* `scripts/data/cbh-character-inventory.json`
* `scripts/lib/cbh-inventory.mjs`
* `test/cbh-character-spotlight.test.js`
* `test/cbh-batch.test.js`

#### Dependencies

* C14 central disposition record.

#### Validation Expectations

* 128 unique ids and URLs.
* Seven excluded, two blocked, 118 deferred, and White Tiger ready before publication; P02-T02 changes
  only White Tiger to shipped after the catalog entry exists.
* Existing-source ids remain recorded without asserting issue-set identity.

#### Completion Evidence

* Focused test asserts exact counts, aliases, reasons, and lifecycle validity.

#### Unresolved Items

* None.

<!-- rpi:task id=P01-T02 -->
### P01-T02: Freeze and prepare the White Tiger packet

#### Context

Research resolved 82 source-defined rows, including one reviewed source-year versus metadata-year mismatch.
The source boundary uses each explicit Ava Ayala Cut and uses full collection contents only when no narrower
cut exists.

#### Intent

Create an immutable packet and exact mapping through the existing named preparation contract.

#### Boundaries

* Included: 82 rows, source boundary and exclusions, proposed `character-run` manifest, insertion before
  `xmen-claremont`, cover issue 36489, central source review, packet digest, and exact candidate metadata.
* Excluded: any added collection issue outside the source rule or later White Tiger appearance.

#### Likely Targets

* `scripts/data/cbh-packets/white-tiger-ava-ayala.json`
* `scripts/data/cbh-mappings/white-tiger-ava-ayala.json`
* `scripts/prepare-cbh-batch.mjs`

#### Dependencies

* P01-T01 and the exact research rows.

#### Validation Expectations

* 82 unique selected issue ids, zero unmatched or ambiguous rows, no placeholder, latest on-sale 2022-09-28.
* Community #1 preserves its source 2021 versus metadata 2022 note.
* Packet and mapping digests validate after no later mutation.
* Existing packet, report, approval, and stale-input rejection tests remain explicit in
  `test/cbh-batch.test.js`.

#### Completion Evidence

* Named preparation reports 82 exact rows and committed mapping digest.

#### Unresolved Items

* None.

<!-- rpi:phase id=P02 -->
## P02: Approve and publish the reading

### Context

The exact candidate shares 12 issues with four current lists. Every relationship is partial, so approval
must remain central and must bind the final packet, mapping, current library, and report digests.

### Intent

Regenerate complete-library evidence, approve the known partials, and publish only through the guarded
named authoring and vendoring flow.

### Boundaries

* Included: 86-list pre-publication report, four central partial dispositions, source order, manifest,
  generated payload, and catalog.
* Excluded: peer candidates, unapproved relationship changes, manual generated-data edits, and new UI code.

### Likely Targets

* `scripts/data/cbh-overlaps/white-tiger-ava-ayala.json`
* `scripts/data/cbh-mappings/white-tiger-ava-ayala.json`
* `src/data/orders/white-tiger-ava-ayala.md`
* `src/data/curated-lists.json`
* `src/data/white_tiger_ava_ayala.json`
* `src/data/catalog.json`

### Dependencies

* P01 complete.

### Validation Expectations

* Comparison count is 86 before the new manifest entry exists.
* Partial relationships and shared counts are exactly 6, 4, 1, and 1.
* Authoring refuses stale packet, mapping, report, library, or approval input.
* Generated data contains exactly 82 ordered issues.

### Completion Evidence

* Fresh report and approval digests.
* Reproducible source order, manifest, generated payload, and catalog.

### Unresolved Items

* None.

<!-- rpi:task id=P02-T01 -->
### P02-T01: Regenerate and approve complete-library relationships

#### Context

Research already identifies the expected partials, but release authority requires the production report
generated from the implementation packet and mapping.

#### Intent

Bind all 86 comparisons and central relationship decisions to the final immutable inputs.

#### Boundaries

* Included: deterministic report generation, exact comparison count, central partial rationales, and
  approval digest.
* Excluded: lower-cost approval or changing source scope to reduce overlap.

#### Likely Targets

* `scripts/data/cbh-overlaps/white-tiger-ava-ayala.json`
* `scripts/data/cbh-mappings/white-tiger-ava-ayala.json`

#### Dependencies

* P01-T02.

#### Validation Expectations

* No exact, candidate-subset, or existing-subset relationship.
* Four partials match Research; remaining 82 comparisons are none.
* Approval names central authority and current input digests.

#### Completion Evidence

* Report and approval validators pass.

#### Unresolved Items

* None.

<!-- rpi:task id=P02-T02 -->
### P02-T02: Author and vendor White Tiger

#### Context

The existing authoring tool accepts named ids and validates all frozen inputs before writing canonical and
generated data.

#### Intent

Publish the approved reading without adding a new surface or manually changing generated payloads.

#### Boundaries

* Included: source order, ungrouped complete `character-run`, insertion before `xmen-claremont`, generated
  payload, and catalog regeneration.
* Excluded: another guide, group variants, UI code, and runtime dependency changes.

#### Likely Targets

* `src/data/orders/white-tiger-ava-ayala.md`
* `src/data/curated-lists.json`
* `src/data/white_tiger_ava_ayala.json`
* `src/data/catalog.json`

#### Dependencies

* P02-T01.

#### Validation Expectations

* Name, description, source, count, characters, keywords, cover, timeline, and type match the packet.
* Generated sequence equals all 82 selected ids in order.
* Catalog places the reading on Character spotlights only.

#### Completion Evidence

* Named authoring and vendoring complete without unexpected writes.

#### Unresolved Items

* None.

<!-- rpi:phase id=P03 -->
## P03: Prove the product and release record

### Context

The data path is deterministic, but the final outcome includes a real user-visible card and reading. Both
semantic contracts and browser behavior must be verified before Review.

### Intent

Add focused coverage, reconcile records, run all gates, and provide one review-ready implementation.

### Boundaries

* Included: one focused semantic test file, existing regressions, product records, RPI changes, repository
  gates, live contract, and Edge verification.
* Excluded: additional product features or review loops.

### Likely Targets

* `test/cbh-character-spotlight.test.js`
* `docs/MAINTAINING.md`
* `docs/DATA_PROVENANCE.md`
* `PRODUCT_BACKLOG.md`
* `CHANGELOG.md`
* `.copilot-tracking/changes/2026-08-23/character-spotlight-guides-changes.md`

### Dependencies

* P02 complete.

### Validation Expectations

* Targeted semantic and regression tests pass.
* Lint, full tests, anchors cycle, and live contract pass.
* Edge shows one Character spotlight card, 82 issues, correct source, and correct first, middle, and final
  entries.

### Completion Evidence

* Exact command outcomes and counts in the changes record and PR body.

### Unresolved Items

* None.

<!-- rpi:task id=P03-T01 -->
### P03-T01: Add bounded semantic and regression coverage

#### Context

Existing tests protect shelf partitioning and curated data generally. One focused file should own the new
inventory, packet, relationship, metadata mismatch, and generated sequence semantics.

#### Intent

Make the feature fail loudly if its evidence or placement drifts.

#### Boundaries

* Included: one new test file and reuse of existing regression tests.
* Excluded: duplicate broad integration suites or new test tooling.

#### Likely Targets

* `test/cbh-character-spotlight.test.js`
* Existing catalog shelf, catalog, curated-data, and licence-boundary test commands.

#### Dependencies

* P02 generated artifacts.

#### Validation Expectations

* The focused check is observed failing under the smallest relevant revert before it is accepted.
* Assertions cover 128 identities, 82 rows, exact mismatch note, four partials, type, shelf, sequence,
  and the post-publication catalog total of 87.
* `test/licence-boundary.test.js` changes its exact shipped-order assertion from 86 to 87 without
  weakening its committed-byte description scan.

#### Completion Evidence

* Targeted command passes after the fix and fails under the demonstrated revert.

#### Unresolved Items

* None.

<!-- rpi:task id=P03-T02 -->
### P03-T02: Reconcile records and run release gates

#### Context

User-visible data, maintainer workflow, backlog state, changelog, anchors, external contract, and Edge
behavior must describe the same released feature.

#### Intent

Complete the release evidence without widening scope.

#### Boundaries

* Included: directly related maintenance and provenance documentation, backlog and changelog, RPI changes,
  anchor re-aiming and reading, all gates, contract, browser evidence, and review handoff.
* Excluded: unrelated backlog fixes or historical artifact cleanup.

#### Likely Targets

* `docs/MAINTAINING.md`
* `docs/DATA_PROVENANCE.md`
* `PRODUCT_BACKLOG.md`
* `CHANGELOG.md`
* `.copilot-tracking/changes/2026-08-23/character-spotlight-guides-changes.md`

#### Dependencies

* P03-T01.

#### Validation Expectations

* Counts in every touched section are re-derived.
* Anchor bless output is read claim by claim and the final run reports zero drifted, new, and removed.
* Edge uses installed Edge at 1280x900 and verifies non-vacuous Character spotlights selectors.

#### Completion Evidence

* Review-ready diff with all required validation evidence durable.

#### Unresolved Items

* None.
