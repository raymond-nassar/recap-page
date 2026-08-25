<!-- markdownlint-disable-file -->
# RPI Plan: Historical event reading orders batch three

## Task Metadata

* Task ID: MRT-003-C02-B03
* Parent task: MRT-003-C02
* Task slug: historical-event-reading-orders-batch-three
* Date: 2026-08-24
* Planning status: Ready after one independent critique
* Research input: .copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-research.md
* Phase details: .copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-three-phase-details.md
* Changes-record target: .copilot-tracking/changes/2026-08-24/historical-event-reading-orders-batch-three-changes.md

## Executive Summary

This batch will add Marvel Super Heroes Secret Wars, Kraven's Last Hunt, and Fall of the Mutants as
the next exact historical reading guides. The usual four-to-six target is reduced to three because
Wraith War, Secret Wars II, and Mutant Massacre each contain source rows that the configured Marvel
metadata cannot resolve without omission.

The three admitted guides contain 48 exact issues. Current reports cover every one of the 111 shipped
lists plus the other two selected peers. Five non-none relationships require exact central approval:
Secret Wars is a subset of the Doom primer, Kraven's Last Hunt partially overlaps the Spider-Man
best-of guide, and Fall of the Mutants partially overlaps three existing guides.

Users will see three dated event cards and issue-by-issue checklists. No saved progress changes.
Source commentary, branding, layouts, images, and comic image bytes remain excluded.

## User Decisions and Requirements

* Continue the maintained Comic Book Reading Orders historical inventory strictly before Maximum Security, preserving MRT-003-C02 lineage and avoiding every shipped event.
* Evaluate positions 11 through 16 in source order and release no more than six, with a smaller batch when exact mapping or overlap risk requires it.
* Carry every exact blocker and existing terminal disposition durably. Re-enter only when newly exact evidence clears its named gate.
* If issue-level sourcing, chronology, identifiers, titles, or inclusion rationale cannot be established confidently, stop the affected event, persist the exact gap and needed research, and never omit or replace an uncertain issue.
* Keep CBRO identity, canonical URLs, timestamps, raw SHA-256 values, exact issue order, mappings, complete-library and peer reports, approvals, chronology, and freshness linked.
* Retain only factual issue identity and order, source URLs and attribution, and project-authored summaries. Do not copy source prose, images, layout, or branding.
* Preserve zero runtime dependencies, local-first behavior, source-neutral machinery, backward compatibility, evidence anchors, and exact release authority.
* Complete Research, one plan critique, implementation, one post-implementation Review, full local and browser gates, commit, a plain-English-first pull request, hosted Node 20, Node 24, and lint checks, merge, and durable handoff.
* Stop after this batch. Do not begin batch four.

## Goals

* Publish three complete source-backed historical guides containing 48 exact issues.
* Record Wraith War, Secret Wars II, and Mutant Massacre as metadata-blocked without losing any source identity or row.
* Extend CBRO release and relationship authority narrowly for MRT-003-C02-B03.
* Preserve complete inventory accounting, freshness, chronology, and current-library relationship evidence.

## Scope and Non-Goals

### In scope

* One known batch-three release with source order positions 11, 15, and 16 and author chronology 11, 16, and 15.
* Atomic inventory changes for exactly six records: three selected and three newly metadata-blocked.
* Three packets, mappings, complete-library and peer reports, approvals, authored definitions, checklists, payloads, catalog records, and direct product records.
* Focused semantic tests, failure proof, complete gates, one critique, one implementation review, pull request, hosted checks, merge, and handoff.

### Non-goals

* Position 17 or later, Maximum Security or later, batch four, reauthoring shipped guides, clearing inherited blockers, runtime source access, broad evidence architecture changes, runtime dependencies, or changes to saved progress.
* Silent omission of ROM, Micronauts, or Power Pack rows.

## Functional Requirements

1. Release authority accepts exactly `marvel-super-heroes-secret-wars`, `kravens-last-hunt`, and `fall-of-the-mutants` in source order, and exactly `marvel-super-heroes-secret-wars`, `fall-of-the-mutants`, and `kravens-last-hunt` in chronology order.
2. One atomic inventory transition promotes the three admitted records to selected and ready, changes positions 12 through 14 to metadata-blocked with exact missing identities, and preserves all other record projections.
3. Three frozen packets preserve provider identity, canonical URL or timeline section, retrieval date, raw digest, exact 48-row order, exclusions, metadata-series choices, and source boundary.
4. Three mappings resolve all 48 rows exactly with unique issue IDs, series IDs, issue numbers, Marvel URLs, and on-sale dates.
5. Reports compare each candidate with every current list and the other two selected peers. Every non-none tuple has one exact release-scoped decision and every unlisted tuple fails.
6. Authoring adds exactly three catalog definitions, checklists, and payloads, updates only the three selected records to shipped, and keeps the three new blockers blocked.
7. Shelf placement follows exact first-on-sale chronology while source inventory retains source position.
8. Backlog, changelog, provenance, maintenance, publication, counts, and RPI records describe the exact delivered state and no wider program claim.

## Non-Functional Requirements

* Runtime dependencies remain zero. No account, cloud service, telemetry, source proxy, cache, or comic image bytes are added.
* Source credit remains Comic Book Reading Orders and source license remains null.
* Packet, mapping, report, approval, library, peer, source, and inventory digests remain freshness-bound.
* Existing MRT-003, batch-one, and batch-two flows remain backward compatible.
* Generated outputs are deterministic and atomically written through existing machinery.
* The final tree contains no added em dash or en dash in authored prose.

## Acceptance Criteria

* Exactly three new guide IDs and 48 exact issue identities ship; the catalog count becomes 114.
* Inventory counts become 18 selected and shipped, 32 deferred, one deferred-subset, five blocked, one absorbed, and one provenance-blocked.
* Positions 12 through 14 name the exact missing ROM, Micronauts, and Power Pack evidence and cannot be prepared or authored.
* Each report contains 113 comparisons on the current 111-list baseline plus two selected peers, 339 total.
* The only non-none relationships are the one Secret Wars subset, one Kraven partial, and three Fall of the Mutants partials recorded by Research.
* Source and author arrays are exact and reordered, never treated as interchangeable.
* Focused semantic coverage proves provider and source digests, exact rows, mapping identities, blocked rows, atomic inventory preservation, known release authority, complete reports, exact tuple approvals, stale evidence rejection, chronology, and current-catalog duplicate rejection.
* At least one precise implementation mutation is observed making each new semantic protection fail before the clean tree is restored.
* Lint, bare tests, counts, sizes, palette, anchors, publication, release checks, live contract, and installed Edge checks pass on the final reconciled tree.
* Edge checks at 1280x900 cover all three cards and one complete issue sequence per guide.
* Exactly one independent post-implementation Review runs. Hosted Node 20, Node 24, and lint jobs pass before merge.

## Canonical and Generated Targets

| Target | Ownership |
|---|---|
| scripts/lib/cbro-evidence.mjs | Known release, exact tuple decisions, inventory authority |
| scripts/data/cbro-historical-inventory.json | Complete 58-record state |
| scripts/data/cbro-timeline-batch-three.json | Timeline-range specification for Secret Wars |
| scripts/data/cbro-packets | Three frozen packets, maximum three additions |
| scripts/data/cbro-mappings | Three exact mappings, maximum three additions |
| scripts/data/cbro-overlaps | Three complete reports, maximum three additions |
| src/data/curated-lists.json | Three canonical guide definitions |
| src/data/orders | Three generated checklists |
| src/data | Three generated payloads plus catalog regeneration |
| test/cbro-historical-events.test.js | Semantic and regression ownership |
| CHANGELOG.md and PRODUCT_BACKLOG.md | Direct product delivery records |
| docs/PROVENANCE.md, docs/MAINTENANCE.md, docs/PUBLICATION_CHECKLIST.md | Direct source and release records |

No production target may be added outside this table unless implementation records a directly related
current-state update in the plan, details, and changes record before the edit.

## Phase Checklist

<!-- rpi:phase id=P01 -->
## P01: Establish batch-three authority and immutable source evidence

* Status: Complete

<!-- rpi:task id=P01-T01 -->
### P01-T01: Add exact release and inventory authority

* Status: Complete

Add MRT-003-C02-B03 with fixed source and chronology arrays. Apply an atomic six-record inventory
transition, revise the historical identity digest and all-selected order, and retain every
nonselected record through a new batch-three immutable projection. Preserve the existing batch-two
projection constant and filter unchanged.

<!-- rpi:task id=P01-T02 -->
### P01-T02: Freeze the three source packets

* Status: Complete

Freeze Secret Wars from the unchanged timeline range and freeze the two exact event-page orders from
their unchanged source evidence. Preserve all 48 rows, the Kraven epilogue, exact exclusions, aliases,
candidate IDs, and source reviews.

<!-- rpi:task id=P01-T03 -->
### P01-T03: Prove source and blocker boundaries

* Status: Complete

Extend focused tests for exact release identity, provider and digest binding, packet row counts,
series selection, the three newly blocked records, inherited terminal states, and unchanged
nonselected inventory.

<!-- rpi:phase id=P02 -->
## P02: Resolve, compare, and approve current relationships

* Status: Complete

<!-- rpi:task id=P02-T01 -->
### P02-T01: Generate exact mappings

* Status: Complete

Prepare all three packets through the existing CBRO path and reject any missing, ambiguous, stale,
duplicate, reordered, or unapproved series result.

<!-- rpi:task id=P02-T02 -->
### P02-T02: Generate complete reports

* Status: Complete

Compare every exact mapping with the final current catalog and the other two selected peers. Bind
reports to packet, mapping, library, and peer digests.

<!-- rpi:task id=P02-T03 -->
### P02-T03: Record five narrow decisions

* Status: Complete

Add exactly the five researched non-none tuples with exact shared IDs and specific stronger-model
rationales. Secret Wars receives inventory relationship status `candidate-subset` with only
`doctor-doom-primer`; Kraven's Last Hunt receives `approved-mixed` with only
`spider-man-best-of`; Fall of the Mutants receives `approved-mixed` with only
`captain-america-best-of`, `xmen-claremont`, and `xmen-claremont-complete`. Reject every changed,
extra, or missing tuple.

<!-- rpi:phase id=P03 -->
## P03: Author and integrate three guides

* Status: Complete

<!-- rpi:task id=P03-T01 -->
### P03-T01: Author approved definitions

* Status: Complete

Run atomic authoring only after current source, mapping, report, approval, and inventory evidence
passes. Change the selected three records from ready to shipped and leave blocked records blocked.

<!-- rpi:task id=P03-T02 -->
### P03-T02: Vendor payloads and catalog entries

* Status: Complete

Vendor all 48 exact issues, regenerate catalog state, and place the three guides by first-on-sale
chronology before Maximum Security.

<!-- rpi:task id=P03-T03 -->
### P03-T03: Update direct product and maintenance records

* Status: Complete

Re-derive and update counts, backlog, changelog, provenance, maintenance, publication, and immutable
inventory evidence without claiming later batches are complete.

<!-- rpi:phase id=P04 -->
## P04: Prove and review the final candidate

* Status: Complete

<!-- rpi:task id=P04-T01 -->
### P04-T01: Demonstrate semantic failure and pass all gates

* Status: Complete

Observe precise reversible mutations failing the new semantic coverage, restore the clean tree,
reconcile current main, regenerate any stale evidence, run all repository and live gates, read every
anchor bless pairing if re-aiming is required, and run installed Edge at 1280x900.

<!-- rpi:task id=P04-T02 -->
### P04-T02: Run the sole independent implementation review

* Status: Complete

Review the complete reconciled implementation once. Fix only material in-scope findings without a
second review and route unrelated work to follow-up.

<!-- rpi:phase id=P05 -->
## P05: Publish, merge, and hand off

* Status: In progress

<!-- rpi:task id=P05-T01 -->
### P05-T01: Commit and publish a plain-English-first pull request

* Status: In progress

Fetch and reconcile current main, regenerate and rerun affected evidence, commit with the required
trailer, push, open a non-draft pull request, and monitor actual Node 20, Node 24, and lint jobs.

<!-- rpi:task id=P05-T02 -->
### P05-T02: Merge and persist the next cursor

Merge only green hosted validation, record PR and merge evidence, persist final inventory counts and
blockers, report The Evolutionary War as the next ordered candidate, and notify the creator. Do not
start batch four.

## Dependencies and Risks

* P02 depends on P01 packet and inventory authority.
* P03 depends on complete reports and exact central approvals.
* P04 depends on final product integration and a current source and catalog baseline.
* P05 depends on the sole Review disposition and green final validation.
* Source or catalog drift invalidates dependent evidence and blocks authoring or release until
  regeneration.
* The reduced three-guide size is intentional and evidence-backed. Increasing it would widen the
  directed candidate window.

## Critique Disposition

The one permitted final-candidate critique returned Revise with two direct planner corrections. Both
are applied and no second critique is permitted or needed.

| Finding | Disposition | Resolving evidence |
|---|---|---|
| PC-001 | Applied directly | P01-T01 and its details require a new batch-three nonselected digest and filter while preserving the batch-two invariant unchanged. |
| PC-002 | Applied directly | P02-T03 and its details name all three exact inventory relationship statuses and overlap arrays. |

## Follow-Up Items

* Batch four begins with The Evolutionary War at position 17 only after this batch merges and under
  creator orchestration.
* Re-enter Wraith War only when exact historical ROM and ROM Annual metadata exists.
* Re-enter Secret Wars II only when exact ROM #72 and Micronauts Vol. 2 #16 metadata exists.
* Re-enter Mutant Massacre only when exact Power Pack #27 metadata exists.

## Planning Readiness

The plan and phase details are implementation-ready. The sole critique is complete, PC-001 and
PC-002 are resolved directly, no user decision is open, and no second critique will run.

## Relevant Artifacts

| Artifact | Description |
|---|---|
| [.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-research.md](.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-research.md) | Completed three-wave research and batch decision. |
| [.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-resolution.json](.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-resolution.json) | Exact mapping and relationship evidence. |
| [.copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-three-plan.md](.copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-three-plan.md) | Canonical implementation plan. |
| [.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-three-phase-details.md](.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-three-phase-details.md) | Task-level evidence and completion details. |

## Next Steps

The automatic RPI parent should continue to implementation with
.copilot-tracking/changes/2026-08-24/historical-event-reading-orders-batch-three-changes.md. No user
action is required.
