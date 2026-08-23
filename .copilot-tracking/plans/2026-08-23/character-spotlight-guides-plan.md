<!-- markdownlint-disable-file -->
# RPI Plan: Character spotlight guides

## Task Metadata

* Task ID: MRT-002-C01
* Parent: MRT-002 / reading-list-expansion
* Task slug: character-spotlight-guides
* Planning status: Implementation ready after one critique
* Plan date: 2026-08-23
* Mode: automatic
* Phase details: .copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-23/character-spotlight-guides-plan-critique.md

## Executive Summary

This plan adds one evidence-approved Character Spotlight reading for Ava Ayala as White Tiger. It also
makes the exhaustive character and team source inventory a maintained input to the guarded workflow,
so later spotlight guides can start from durable evidence instead of rebuilding the source list.

The reading contains 82 source-defined issues. It starts with Avengers Academy #21 and ends with
Marvel's Voices: Community #1. The source's explicit "Ava Ayala Cut" controls broad collections, so
unrelated collection issues are not added. All 82 rows resolve inside the metadata snapshot and the
four partial relationships with current readings are approved centrally.

### User Decisions and Requirements Highlights

* Reuse the existing frozen packet, mapping, complete-library report, approval, authoring, and
  publication contracts.
* Publish through the existing `character-run` model and Character spotlights screen only.
* Keep source freeze, ambiguous identity choices, partial-overlap approval, anchor reading, and final
  release authority central.
* Add no runtime dependency, new browse surface, image storage, origin change, silent shortening, or
  em dash.

### What You May Not Know

* The source index has 130 visible entries but only 128 source identities because two URL pairs are
  duplicates.
* Only White Tiger is approved for this change. The other 127 identities remain durably deferred,
  excluded, or blocked.
* The source calls the final Community one-shot 2021, while Marvel metadata groups the exact resolved
  issue under 2022. The packet must preserve that reviewed mismatch.

### Unresolved Decisions or Blockers

* None.

For current user input, see [User Decisions and Requirements](#user-decisions-and-requirements).

## User Decisions and Requirements

* Recover MRT-002-C01 from the committed checkpoint without repeating completed Wider or inventory
  work, and preserve the stalled-session provenance.
* Continue automatically through one critique, implementation, one review, PR, required CI, and
  merge unless a concrete blocker or repository safety rule stops the work.
* Select no pilot until exhaustive source inventory, source-boundary evidence, metadata-horizon
  evidence, complete-current-library relationships, and central approval support it.
* Reuse the frozen packet, digest, mapping, complete-library overlap, central approval, authoring,
  catalog placement, and validation contracts inherited from MRT-002.
* Place guides under the existing Character spotlights screen with `type: character-run`; add no
  browse surface or speculative placement field.
* Do not shorten source guides silently, add runtime dependencies, store image bytes, alter the fixed
  origin, or introduce em dashes.
* Use bounded lower-cost work only on frozen inputs. Source boundaries, ambiguous identity choices,
  subset or partial dispositions, anchor reading, and final release authority remain central.
* Ship one major feature in the pull request and update directly related product records.

## Goals

* Publish the approved 82-issue White Tiger reading on Character spotlights.
* Maintain the 128-identity character and team source inventory under the existing guarded workflow.
* Preserve exact source, metadata, overlap, approval, and publication evidence from Research through
  release.
* Demonstrate the recovered lower-cost handoff contract without delegating protected decisions.

## Scope and Non-Goals

### In Scope

* One maintained 128-identity character and team guide inventory.
* One frozen White Tiger packet, exact mapping, complete-library report, and central approval.
* One `character-run` manifest entry, source order, generated payload, and catalog regeneration.
* Narrow preparation support for selecting the correct maintained inventory.
* Semantic tests, existing repository gates, live contract validation, and Edge verification.
* Directly related maintenance, provenance, backlog, changelog, RPI, PR, and release records.

### Non-Goals

* Any second character or team guide.
* A new screen, shelf, route, placement field, or runtime behavior.
* Reworking the existing modern inventory lifecycle.
* Resolving any of the 118 deferred, seven excluded, or two post-horizon source identities.
* Copying Comic Book Herald commentary or storing Marvel image bytes.
* Changing storage, origin, popup, availability, or reader behavior.

## Functional Requirements

* The guarded preparation path accepts the character inventory for a packet whose inventory id is
  maintained there.
  * Observable acceptance criteria: named preparation finds exactly one White Tiger inventory record
    and rejects missing, duplicate, ineligible, or stale packet identity.
* The White Tiger packet retains exactly 82 ordered rows and the source-defined cut rule.
  * Observable acceptance criteria: first, middle, and final rows match the approved research
    evidence, candidate issue ids are unique, and placeholders are zero.
* Complete-library evidence covers all 86 pre-change readings and records the four approved partial
  relationships.
  * Observable acceptance criteria: comparison count is 86 before publication, relationship ids and
    shared counts match Research, and approval digests are fresh.
* Publication creates one ungrouped complete `character-run`.
  * Observable acceptance criteria: the card appears on Character spotlights only and opens an
    82-issue reading whose source link and endpoint are correct.
* The maintained inventory accounts for every source identity.
  * Observable acceptance criteria: it contains 128 unique URLs, retains both duplicate-label facts,
    and marks only White Tiger shipped in this task.

## Non-Functional Requirements

* Runtime dependencies remain zero.
  * Objective threshold or evaluation condition: package runtime dependency count remains zero.
  * Observable acceptance criteria: no browser dependency or build step is added.
* Protected decisions remain central.
  * Objective threshold or evaluation condition: no lower-cost output can mint source or relationship
    approval.
  * Observable acceptance criteria: packet source review and partial dispositions name central
    authority and stale input rejection remains active.
* Existing user data and fixed-origin behavior remain unchanged.
  * Objective threshold or evaluation condition: no storage, origin, or application-state code changes.
  * Observable acceptance criteria: the diff contains no such production edits.
* Evidence and generated data remain reproducible.
  * Objective threshold or evaluation condition: digests validate and generators reproduce committed
    outputs without drift.
  * Observable acceptance criteria: targeted semantic tests and all repository gates pass.

## Acceptance Criteria

* A maintained character inventory contains all 128 source identities with one approved shipped pilot.
* White Tiger publishes with exactly 82 unique issues, no placeholder, and no post-horizon metadata.
* The packet preserves the 2021 source label versus 2022 metadata identity note for Community #1.
* The overlap report compares all 86 pre-change lists and records partial counts of 6, 4, 1, and 1
  for the four approved relationships.
* The generated card is visible only on Character spotlights and its first, middle, and final entries
  match the approved order.
* No new runtime dependency, browse surface, placement field, image byte, origin change, or em dash is
  introduced.
* `npm run lint`, `npm test`, `npm run anchors`, `npm run contract`, targeted semantic tests, and the
  required Edge check pass with their expected counts recorded.

## Initial Planning Readiness

* Evidence status: Research complete after one three-wave cycle.
* Selected scope: `white-tiger-ava-ayala` only.
* Active boundaries: one major feature; existing `character-run` surface; protected authority remains
  central; no silent shortening.
* Planning gap: none demonstrated.
* Current blocker: none.

## Implementation Context Record

| Context item | Current artifact or record |
|---|---|
| Plan | .copilot-tracking/plans/2026-08-23/character-spotlight-guides-plan.md |
| Phase details | .copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md |
| Latest critique | .copilot-tracking/reviews/plans/2026-08-23/character-spotlight-guides-plan-critique.md complete; Revise resolved by PC-001 disposition |
| Relevant research | .copilot-tracking/research/2026-08-22/character-spotlight-guides-research.md |
| Changes-record role | .copilot-tracking/changes/2026-08-23/character-spotlight-guides-changes.md is created by implementation as its evidence record |
| Planning execution and readiness | Complete; the one critique finding is resolved in the implementation boundary |
| Continuation context | Automatic RPI parent continues when the planning gate passes |

## Sources

* .copilot-tracking/research/2026-08-22/character-spotlight-guides-research.md: controlling
  research synthesis and delegation matrix.
* .copilot-tracking/research/2026-08-22/character-spotlight-dispositions.json: all 128 central
  dispositions.
* .copilot-tracking/research/2026-08-22/character-spotlight-white-tiger-evidence.json: exact 82-row
  source, metadata, horizon, and 86-list relationship evidence.
* .copilot-tracking/plans/2026-08-22/reading-list-expansion-plan.md: inherited guarded workflow.
* .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md: inherited worker and
  central authority contracts.

## Phase Checklist

<!-- rpi:phase id=P01 -->
### [x] P01: Guard the character inventory and packet

* Intent: Connect the maintained source inventory and frozen White Tiger packet to the existing guarded
  preparation path without weakening modern inventory contracts.
* Dependencies: Completed Research and approved 82-row source evidence.

<!-- rpi:task id=P01-T01 -->
#### [x] P01-T01: Add the maintained character inventory contract

* Requirement and evidence: The 128 central dispositions must become a validated production input.
* Expected result: one unique, validated inventory records all source identities and lifecycle states.
* Detail section: P01-T01 in .copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md

<!-- rpi:task id=P01-T02 -->
#### [x] P01-T02: Freeze and prepare the White Tiger packet

* Requirement and evidence: C13 and W7 approve an exact 82-row boundary and one reviewed metadata
  mismatch.
* Expected result: packet and mapping digests are fresh; all 82 rows resolve exactly.
* Detail section: P01-T02 in .copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md

<!-- rpi:phase id=P02 -->
### [x] P02: Approve and publish the reading

* Intent: Produce complete-library evidence, central relationship approval, source order, manifest
  entry, and generated data through existing named tools.
* Dependencies: P01.

<!-- rpi:task id=P02-T01 -->
#### [x] P02-T01: Regenerate and approve complete-library relationships

* Requirement and evidence: Research found four partial relationships across all 86 current lists.
* Expected result: a fresh report and central approval preserve those exact relationships.
* Detail section: P02-T01 in .copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md

<!-- rpi:task id=P02-T02 -->
#### [x] P02-T02: Author and vendor White Tiger

* Requirement and evidence: The existing named authoring contract validates every frozen input before
  writing.
* Expected result: one 82-issue ungrouped complete `character-run` is generated before
  `xmen-claremont`.
* Detail section: P02-T02 in .copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md

<!-- rpi:phase id=P03 -->
### [x] P03: Prove the product and release record

* Intent: Lock semantic behavior, verify the real browser surface, and reconcile user-visible records.
* Dependencies: P02.

<!-- rpi:task id=P03-T01 -->
#### [x] P03-T01: Add bounded semantic and regression coverage

* Requirement and evidence: Test ownership must cover inventory identity, packet count, metadata
  mismatch, relationships, placement, and generated sequence.
* Expected result: one new focused test file plus existing shelf, curated-data, and licence-boundary
  coverage protect the feature and assert the 87-list post-publication catalog.
* Detail section: P03-T01 in .copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md

<!-- rpi:task id=P03-T02 -->
#### [x] P03-T02: Reconcile records and run release gates

* Requirement and evidence: Product, backlog, changelog, changes record, repository gates, contract
  check, and Edge behavior must agree before Review.
* Expected result: all evidence is current and the implementation is ready for one independent Review.
* Detail section: P03-T02 in .copilot-tracking/details/2026-08-23/character-spotlight-guides-phase-details.md

## Dependencies

* Completed MRT-002-C01 Research and its exact White Tiger evidence.
* Existing packet, digest, overlap, approval, authoring, vendoring, shelf, and validation contracts.
* Comic Book Herald credit-and-link permission recorded in product provenance.
* Marvel metadata mirror for preparation and the live contract check.
* Installed Edge and external scratch Puppeteer setup for final browser verification.

## Locked Change and Test Boundaries

* Exact removals: none.
* Maximum new production data artifacts: six, consisting of one inventory, one packet, one mapping,
  one overlap report, one source order, and one generated payload.
* Maximum new production test files: one.
* Canonical targets: character inventory, frozen packet, source order, curated manifest, and central
  relationship approval.
* Generated targets: mapping candidate metadata, overlap report, list payload, and catalog.
* Semantic coverage owner: new `test/cbh-character-spotlight.test.js`.
* Guard regression owner: existing `test/cbh-batch.test.js` for frozen packet, report, approval, and
  stale-input behavior.
* Product regression owners: existing `test/catalog-shelves.test.js`, `test/catalog.test.js`,
  `test/curated.test.js`, and `test/licence-boundary.test.js`; the last updates its exact catalog
  assertion from 86 to 87 while retaining the committed-byte licence scan.
* Validation evidence: targeted tests, lint, full tests, anchors cycle, live contract, and Edge
  first/middle/final plus single-screen assertions.

## Canonical and Generated Targets

| Role | Target | Change boundary |
|---|---|---|
| Canonical inventory | `scripts/data/cbh-character-inventory.json` | Add one 128-identity file |
| Canonical packet | `scripts/data/cbh-packets/white-tiger-ava-ayala.json` | Add one 82-row file |
| Generated mapping and approval | `scripts/data/cbh-mappings/white-tiger-ava-ayala.json` | Add one file from the frozen packet, then record central approval |
| Generated relationship report | `scripts/data/cbh-overlaps/white-tiger-ava-ayala.json` | Add one 86-comparison pre-publication file |
| Canonical source order | `src/data/orders/white-tiger-ava-ayala.md` | Add one 82-row order |
| Canonical manifest | `src/data/curated-lists.json` | Insert one `character-run` before `xmen-claremont`; remove, retype, or move none |
| Generated reading payload | `src/data/white_tiger_ava_ayala.json` | Add one 82-item file |
| Generated catalog | `src/data/catalog.json` | Regenerate from the one manifest insertion |

The inventory supports future work but does not approve or publish another guide. Pilot selection closes
with this plan and does not reopen during implementation.

## Critique Disposition

| Critique run and finding | Disposition | Plan response or residual risk |
|---|---|---|
| PC-001: Missing existing catalog-length regression | Applied | P03 now owns `test/licence-boundary.test.js` and requires its exact shipped-catalog assertion to move from 86 to 87. This is a direct planner correction with no user decision. |

## Follow-Up Items

* Resolve another deferred character or team guide in a distinct task using the maintained inventory
  and the same exact evidence gates.

## Handoff

* Implementation artifact: .copilot-tracking/changes/2026-08-23/character-spotlight-guides-changes.md
* Ready phase or task: none; implementation complete and ready for Review
* Remaining provisional question or blocker: none
