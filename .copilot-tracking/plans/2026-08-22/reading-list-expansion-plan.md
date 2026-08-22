<!-- markdownlint-disable-file -->
# RPI Plan: Reading list expansion

## Task Metadata

* Task ID: MRT-002
* Task slug: reading-list-expansion
* Planning status: Ready
* Plan date: 2026-08-22
* Phase details: .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-22/reading-list-expansion-plan-critique.md

## Executive Summary

Reuse the Comic Book Herald source inventory and build-time order pipeline that already exist, then
remove the packet-specific hard-coding that makes each new batch expensive to prepare. A lower-cost
model receives exactly one frozen reading-list packet and produces only its issue mapping. Central
tasks freeze source boundaries, adjudicate overlap, and combine no more than three passing lists into
one product delivery chunk.

The app's live catalog is the gate, not a remembered list count. Before worker dispatch, every
candidate is checked for catalog and source identity. After issue resolution, every candidate is
checked for exact issue-sequence duplication and issue overlap against every list currently shipped
and every peer in its chunk. Exact duplicates stop, unapproved subsets stop, and partial overlap
requires explicit stronger-model or human adjudication.

### User Decisions and Requirements Highlights

* Add more reading lists from Comic Book Herald's complete Marvel guide.
* Divide the work into bounded list chunks that lower-cost models can implement.
* Check every candidate against the current library in the app.

### What You May Not Know

* The app already has 66 lists, 52 derived from Comic Book Herald.
* A maintained modern Earth-616 inventory already has 22 pending candidates. Finishing that queue is
  more efficient than starting a new character-guide inventory immediately.
* Current authoring tools compare against the full library, but packet membership, insertion anchors,
  and source rows are still hard-coded in large central scripts. The overlap library also rejects an
  exact sequence before its report can classify it.
* The current library intentionally contains overlapping full, essential, and alternate-presentation
  lists, so any shared issue is not by itself proof that a candidate is invalid.

### Unresolved Decisions or Blockers

* No blocker. Three source-complex or metadata-horizon candidates are isolated as one-list chunks.
  Every candidate remains conditional on source freeze, exact resolution, and current-library overlap
  results.

For current user input, see [User Decisions and Requirements](#user-decisions-and-requirements).

## User Decisions and Requirements

* Find the most efficient way to add more reading lists from
  https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/.
* Plan the work in reading-list chunks that can be implemented by more lower-cost models.
* Ensure every candidate is checked against the app's current library.
* Preserve the repository's existing local-first, dependency-free runtime and source-credit rules.
* Continue the approved work automatically through implementation, Review, pull-request creation, and
  merge.

## Goals

* Make future Comic Book Herald list work start from a small data packet rather than edits across a
  multi-thousand-line preparation script.
* Give each lower-cost worker one list, explicit inputs, deterministic commands, objective pass
  conditions, and stop-and-route rules.
* Process the 22 pending modern Earth-616 candidates in reviewable chunks of no more than three
  passing lists.
* Prevent duplicate catalog entries and surface exact, subset, and partial issue overlap before
  authoring.
* Preserve exact source credit, source links, issue order, and generated-data integrity.

## Scope and Non-Goals

### In Scope

* A generic build-time source-packet and chunk contract layered over the existing resolver, overlap,
  authoring, and vendoring tools.
* A staged current-library gate that checks identity before worker dispatch and resolved issue
  relationships before authoring.
* The 22 pending modern Earth-616 inventory candidates.
* One lower-cost worker task per reading list, one central overlap-review task, and one central
  integration task per delivery chunk.
* Tests, contributor guidance, backlog, changelog, and provenance updates directly required by the
  delivered workflow and lists.

### Non-Goals

* Browser runtime changes, catalog redesign, persistence changes, or new runtime dependencies.
* Scraping Marvel properties, storing comic images, or copying Comic Book Herald commentary,
  advertisements, or images.
* Letting a lower-cost model decide ambiguous issue identity, source boundaries, chronology,
  grouping, metadata exceptions, or overlap disposition.
* Resolving the 12 currently blocked modern candidates in this task.
* Building a new inventory for the master page's character and team guide index in parallel with the
  pending modern queue.

## Functional Requirements

* A maintainer can prepare one candidate by stable inventory id from a bounded source packet.
  * Observable acceptance criteria: no new candidate requires editing a packet-id constant, a
    hard-coded insertion map, or an unrelated candidate's source rows.
* A staged gate checks a candidate against the library present at execution time.
  * Observable acceptance criteria: identity checks run before dispatch; after resolution, the
    relationship report covers every shipped list and every passing peer in the integration chunk
    and names exact, candidate-subset, existing-subset, partial, and none outcomes.
* A lower-cost worker owns exactly one list packet.
  * Observable acceptance criteria: its declared write is limited to one candidate mapping file,
    with no source packet, overlap report, approval, manifest, or product-document edit.
* A central reviewer evaluates resolved candidates.
  * Observable acceptance criteria: it regenerates complete current-library and peer comparisons,
    rejects exact matches and unapproved subsets, and records the authority and rationale for every
    approved partial relationship.
* A central integrator authors and vendors no more than three passing candidates.
  * Observable acceptance criteria: the approved issue sequence is preserved in Markdown, generated
    JSON, and catalog data, and shared records are updated once.
* A candidate stops before authoring when its source boundary is unclear, any row is unresolved, an
  exact duplicate or unapproved subset exists, or partial overlap lacks an approved disposition.
  * Observable acceptance criteria: the failure names the candidate, reason, compared order, and
    smallest next decision.

## Non-Functional Requirements

* Runtime dependency count remains zero.
  * Objective threshold or evaluation condition: package runtime dependencies remain absent.
  * Observable acceptance criteria: the app loads only committed catalog data and none of the
    inventory, packet, or overlap machinery reaches the browser.
* Worker context remains bounded.
  * Objective threshold or evaluation condition: one candidate per worker, one explicit source-order
    section by default, and no editorial choice delegated to the worker.
  * Observable acceptance criteria: a worker can complete or stop from its packet and command output
    without reading other candidates or the full source program.
* Delivery chunks remain reviewable.
  * Objective threshold or evaluation condition: no more than three passing lists per integration
    chunk; source-complex and metadata-horizon candidates use one-list chunks.
  * Observable acceptance criteria: no integration chunk exceeds three catalog additions.
* Current-library coverage is complete and deterministic.
  * Objective threshold or evaluation condition: comparison count equals every current shipped order
    other than the candidate plus every peer candidate.
  * Observable acceptance criteria: deleting any comparison or changing a classified relationship
    makes the focused check fail.
* Source and generated data remain reproducible.
  * Objective threshold or evaluation condition: every included source reference resolves to one
    reviewed issue id, expected counts match, and placeholders and unresolved rows are zero.
  * Observable acceptance criteria: rebuilding a passing list preserves its reviewed issue-id
    sequence and catalog provenance.

## Acceptance Criteria

* Generic packet preparation and authoring accept named ids without packet-specific code edits.
* The staged current-library gate rejects duplicate ids, source identities, exact issue sequences, and
  unapproved subset relationships.
* Partial overlap produces a review-required result and cannot be approved by a lower-cost worker.
* The pilot chunk may ship Generations, X-Men Extermination, or both, but only candidates that pass
  source, resolution, overlap, provenance, and generated-data gates.
* Each later chunk contains no more than three passing lists and may ship fewer when a candidate is
  routed to `blocked` with evidence and an owner.
* All 22 pending inventory candidates are either shipped or left `blocked` with a specific reason,
  evidence pointer, and route owner by the end of the active queue.
* Required repository gates and live metadata contract checks pass for every chunk that adds issue
  ids.
* Catalog cards credit Comic Book Herald and link to the exact page or visible section followed.

## Implementation Context Record

| Context item                     | Current artifact or record |
|----------------------------------|----------------------------|
| Plan                             | .copilot-tracking/plans/2026-08-22/reading-list-expansion-plan.md |
| Phase details                    | .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md |
| Latest critique                  | .copilot-tracking/reviews/plans/2026-08-22/reading-list-expansion-plan-critique.md, Complete with Revise verdict; PC-001 through PC-008 resolved directly |
| Relevant research                | .copilot-tracking/research/2026-08-22/reading-list-expansion-research.md |
| Changes-record role              | .copilot-tracking/changes/2026-08-22/reading-list-expansion-changes.md is created by implementation as its evidence record |
| Planning execution and readiness | Complete and implementation-ready after direct disposition of the one final-candidate critique |
| Continuation context             | Manual RPI Agent remains in Plan until the user explicitly invokes `/rpi-implement` |

## Sources

* .copilot-tracking/research/2026-08-22/reading-list-expansion-research.md: current library,
  maintained queue, source samples, worker boundary, and selected workflow.
* .copilot-tracking/plans/2026-08-20/modern-marvel-continuity-guides-plan.md: existing inventory,
  source mapping, overlap, and lower-capability contracts.
* docs/MAINTAINING.md: current source-packet, resolution, authoring, vendoring, and validation workflow.
* docs/DATA_PROVENANCE.md: Comic Book Herald permission, credit, source-link, and reuse boundaries.

## Active Boundaries

* Full-plan implementation is active, beginning with P01-T01.
* Current app data, not a frozen count, remains the duplicate and overlap baseline.
* One list per lower-cost worker; no more than three passing lists per integration chunk.
* No new character/team guide inventory in the active task.

## Locked Change and Validation Boundaries

| Boundary | Locked candidate value |
|----------|------------------------|
| Exact removals | None |
| New runtime dependencies | 0 |
| New scripts | 0; extend existing Comic Book Herald entry points and libraries |
| New logical data schemas | At most 1 frozen candidate-packet schema |
| New test files | 0; extend the existing Comic Book Herald and overlap suites |
| New semantic test cases | At most 12: at most 11 in P01 and exactly 1 queue-terminal assertion in P12 |
| Maximum catalog additions | 22, restricted to the original pending inventory-id set named in the phase-details dispatch table |
| Canonical inputs | `scripts/data/cbh-modern-inventory.json`, frozen candidate packets, approved candidate mappings, approved overlap dispositions, curated order Markdown, and `src/data/curated-lists.json` |
| Generated outputs | `src/data/orders/*.json` and the catalog data produced from the canonical order and manifest inputs |
| Regression coverage | Existing resolver, inventory, batch, overlap, model, count, API, anchor, lint, and browser behavior |
| Per-chunk validation evidence | Focused semantic checks; `npm run lint`; `npm test`; `npm run anchors`; `npm run contract` when issue ids are added; browser checks of cards and first, middle, and final issue sequence |

## Phase Checklist

<!-- rpi:phase id=P01 -->
### [ ] P01: Generic candidate workflow

* Intent: make one frozen data packet sufficient for preparation, resolution, relationship review,
  and authoring without candidate-specific code edits.
* Dependencies: completed MRT-002 research.

<!-- rpi:task id=P01-T01 -->
#### [ ] P01-T01: Define and validate the frozen packet contract

* Requirement and evidence: hard-coded source rows and source identity guards in the current inventory
  and preparation code.
* Expected result: one bounded schema covers immutable source boundary, exclusions, ordered rows,
  expected count, proposed manifest fields, insertion anchor, approval identity, and packet digest.
* Detail section: P01-T01 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P01-T02 -->
#### [ ] P01-T02: Data-drive preparation by inventory id

* Requirement and evidence: future packet membership and source rows are embedded in a shared script.
* Expected result: `npm run cbh:prepare -- --only=<id>` reads the frozen packet and requires no
  candidate-specific code branch.
* Detail section: P01-T02 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P01-T03 -->
#### [ ] P01-T03: Correct and enforce relationship policy

* Requirement and evidence: exact sequences are rejected before classification and authoring currently
  rejects every nonzero overlap.
* Expected result: complete reports classify exact, both subset directions, partial, and none; policy
  rejects exact, requires approval for subsets, and requires stronger-model or human disposition for
  partial overlap.
* Detail section: P01-T03 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P01-T04 -->
#### [ ] P01-T04: Data-drive authoring and stale-report checks

* Requirement and evidence: packet ids and insertion anchors are hard-coded in the authoring script.
* Expected result: approved named candidates can be authored without shared constants, and authoring
  stops when the library or approved mapping has changed since review.
* Detail section: P01-T04 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P01-T05 -->
#### [ ] P01-T05: Prove the workflow and document it

* Requirement and evidence: the new worker boundary and staged gate need semantic failure coverage.
* Expected result: no more than 11 focused tests cover the P01 boundary, contributor instructions
  describe central and worker ownership, and all repository gates pass.
* Detail section: P01-T05 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:phase id=P02 -->
### [ ] P02: Pilot delivery chunk

* Intent: prove the model with Generations and X-Men Extermination.
* Dependencies: P01.

<!-- rpi:task id=P02-T01 -->
#### [ ] P02-T01: Freeze pilot packets

* Requirement and evidence: source boundaries are editorial inputs and cannot be chosen by workers.
* Expected result: centrally reviewed packets for both pilot candidates pass identity and digest checks.
* Detail section: P02-T01 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P02-T02 -->
#### [ ] P02-T02: Map Generations

* Requirement and evidence: one frozen candidate per lower-cost worker.
* Expected result: one exact, count-matched mapping or a specific stop reason.
* Detail section: P02-T02 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P02-T03 -->
#### [ ] P02-T03: Map X-Men Extermination

* Requirement and evidence: one frozen candidate per lower-cost worker.
* Expected result: one exact, count-matched mapping or a specific stop reason.
* Detail section: P02-T03 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P02-T04 -->
#### [ ] P02-T04: Review pilot relationships

* Requirement and evidence: issue relationships exist only after mapping.
* Expected result: complete current-library and peer reports with explicit dispositions.
* Detail section: P02-T04 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P02-T05 -->
#### [ ] P02-T05: Integrate passing pilot lists

* Requirement and evidence: shared product records belong to one central owner.
* Expected result: every passing pilot list is authored, vendored, credited, recorded, and validated;
  a failed peer is routed without blocking a passing candidate.
* Detail section: P02-T05 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:phase id=P03 -->
### [ ] P03: 2018 to 2020 routine chunk

* Intent: process Spider-Geddon, Age of X-Man, and Iron Man 2020.
* Dependencies: P02 integrates and fully validates at least one pilot list.

<!-- rpi:task id=P03-T01 -->
#### [ ] P03-T01: Freeze P03 packets
* Requirement and evidence: central source-boundary ownership.
* Expected result: three identity-safe frozen packets.
* Detail section: P03-T01 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P03-T02 -->
#### [ ] P03-T02: Map Spider-Geddon
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P03-T02 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P03-T03 -->
#### [ ] P03-T03: Map Age of X-Man
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P03-T03 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P03-T04 -->
#### [ ] P03-T04: Map Iron Man 2020
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P03-T04 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P03-T05 -->
#### [ ] P03-T05: Review P03 relationships
* Requirement and evidence: central full-library and peer adjudication.
* Expected result: complete reports and dispositions for every passing mapping.
* Detail section: P03-T05 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P03-T06 -->
#### [ ] P03-T06: Integrate passing P03 lists
* Requirement and evidence: central ownership of shared records and validation.
* Expected result: up to three passing lists ship with complete evidence.
* Detail section: P03-T06 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:phase id=P04 -->
### [ ] P04: 2019 event chunk

* Intent: process The War of the Realms and Absolute Carnage.
* Dependencies: P02 integrates and fully validates at least one pilot list.

<!-- rpi:task id=P04-T01 -->
#### [ ] P04-T01: Freeze P04 packets
* Requirement and evidence: central source-boundary ownership.
* Expected result: two identity-safe frozen packets.
* Detail section: P04-T01 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P04-T02 -->
#### [ ] P04-T02: Map The War of the Realms
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P04-T02 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P04-T03 -->
#### [ ] P04-T03: Map Absolute Carnage
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P04-T03 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P04-T04 -->
#### [ ] P04-T04: Review P04 relationships
* Requirement and evidence: central full-library and peer adjudication.
* Expected result: complete reports and dispositions for every passing mapping.
* Detail section: P04-T04 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P04-T05 -->
#### [ ] P04-T05: Integrate passing P04 lists
* Requirement and evidence: central ownership of shared records and validation.
* Expected result: up to two passing lists ship with complete evidence.
* Detail section: P04-T05 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:phase id=P05 -->
### [ ] P05: 2020 to 2021 event chunk

* Intent: process Empyre, X-Men: X of Swords, and Heroes Reborn.
* Dependencies: P02 integrates and fully validates at least one pilot list.

<!-- rpi:task id=P05-T01 -->
#### [ ] P05-T01: Freeze P05 packets
* Requirement and evidence: central source-boundary ownership.
* Expected result: three identity-safe frozen packets.
* Detail section: P05-T01 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P05-T02 -->
#### [ ] P05-T02: Map Empyre
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P05-T02 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P05-T03 -->
#### [ ] P05-T03: Map X-Men: X of Swords
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P05-T03 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P05-T04 -->
#### [ ] P05-T04: Map Heroes Reborn
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P05-T04 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P05-T05 -->
#### [ ] P05-T05: Review P05 relationships
* Requirement and evidence: central full-library and peer adjudication.
* Expected result: complete reports and dispositions for every passing mapping.
* Detail section: P05-T05 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P05-T06 -->
#### [ ] P05-T06: Integrate passing P05 lists
* Requirement and evidence: central ownership of shared records and validation.
* Expected result: up to three passing lists ship with complete evidence.
* Detail section: P05-T06 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:phase id=P06 -->
### [ ] P06: 2021 event chunk

* Intent: process Infinite Destinies, The Last Annihilation, and X-Men Inferno.
* Dependencies: P02 integrates and fully validates at least one pilot list.

<!-- rpi:task id=P06-T01 -->
#### [ ] P06-T01: Freeze P06 packets
* Requirement and evidence: central source-boundary ownership.
* Expected result: three identity-safe frozen packets.
* Detail section: P06-T01 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P06-T02 -->
#### [ ] P06-T02: Map Infinite Destinies
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P06-T02 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P06-T03 -->
#### [ ] P06-T03: Map The Last Annihilation
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P06-T03 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P06-T04 -->
#### [ ] P06-T04: Map X-Men Inferno
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P06-T04 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P06-T05 -->
#### [ ] P06-T05: Review P06 relationships
* Requirement and evidence: central full-library and peer adjudication.
* Expected result: complete reports and dispositions for every passing mapping.
* Detail section: P06-T05 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P06-T06 -->
#### [ ] P06-T06: Integrate passing P06 lists
* Requirement and evidence: central ownership of shared records and validation.
* Expected result: up to three passing lists ship with complete evidence.
* Detail section: P06-T06 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:phase id=P07 -->
### [ ] P07: Late 2021 to 2022 event chunk

* Intent: process The Death of Doctor Strange, Devil's Reign, and Reckoning War.
* Dependencies: P02 integrates and fully validates at least one pilot list.

<!-- rpi:task id=P07-T01 -->
#### [ ] P07-T01: Freeze P07 packets
* Requirement and evidence: central source-boundary ownership.
* Expected result: three identity-safe frozen packets.
* Detail section: P07-T01 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P07-T02 -->
#### [ ] P07-T02: Map The Death of Doctor Strange
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P07-T02 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P07-T03 -->
#### [ ] P07-T03: Map Devil's Reign
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P07-T03 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P07-T04 -->
#### [ ] P07-T04: Map Reckoning War
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P07-T04 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P07-T05 -->
#### [ ] P07-T05: Review P07 relationships
* Requirement and evidence: central full-library and peer adjudication.
* Expected result: complete reports and dispositions for every passing mapping.
* Detail section: P07-T05 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P07-T06 -->
#### [ ] P07-T06: Integrate passing P07 lists
* Requirement and evidence: central ownership of shared records and validation.
* Expected result: up to three passing lists ship with complete evidence.
* Detail section: P07-T06 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:phase id=P08 -->
### [ ] P08: 2022 to 2023 event chunk

* Intent: process Judgment Day, Dark Web, and Sins of Sinister.
* Dependencies: P02 integrates and fully validates at least one pilot list.

<!-- rpi:task id=P08-T01 -->
#### [ ] P08-T01: Freeze P08 packets
* Requirement and evidence: central source-boundary ownership.
* Expected result: three identity-safe frozen packets.
* Detail section: P08-T01 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P08-T02 -->
#### [ ] P08-T02: Map Judgment Day
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P08-T02 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P08-T03 -->
#### [ ] P08-T03: Map Dark Web
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P08-T03 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P08-T04 -->
#### [ ] P08-T04: Map Sins of Sinister
* Requirement and evidence: one candidate per worker.
* Expected result: exact mapping or stop evidence.
* Detail section: P08-T04 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P08-T05 -->
#### [ ] P08-T05: Review P08 relationships
* Requirement and evidence: central full-library and peer adjudication.
* Expected result: complete reports and dispositions for every passing mapping.
* Detail section: P08-T05 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P08-T06 -->
#### [ ] P08-T06: Integrate passing P08 lists
* Requirement and evidence: central ownership of shared records and validation.
* Expected result: up to three passing lists ship with complete evidence.
* Detail section: P08-T06 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:phase id=P09 -->
### [ ] P09: Secret Empire strong-review chunk

* Intent: isolate a source-complex candidate so no lower-cost worker chooses its reading boundary.
* Dependencies: P02 integrates and fully validates at least one pilot list.

<!-- rpi:task id=P09-T01 -->
#### [ ] P09-T01: Freeze Secret Empire with strong review
* Requirement and evidence: the guide presents a complex source boundary.
* Expected result: one explicit packet or an immediate `blocked` inventory outcome with reason,
  evidence, and route owner.
* Detail section: P09-T01 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P09-T02 -->
#### [ ] P09-T02: Map Secret Empire
* Requirement and evidence: worker starts only after strong source freeze.
* Expected result: exact mapping or stop evidence.
* Detail section: P09-T02 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P09-T03 -->
#### [ ] P09-T03: Review Secret Empire relationships
* Requirement and evidence: central full-library adjudication.
* Expected result: complete report and explicit disposition.
* Detail section: P09-T03 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P09-T04 -->
#### [ ] P09-T04: Integrate or route Secret Empire
* Requirement and evidence: one-list isolation contains editorial risk.
* Expected result: after all earlier task outcomes are recorded, the list ships with complete evidence
  or has `deliveryStatus: blocked` with a specific reason, evidence, and route owner; skipped downstream
  tasks are recorded not applicable.
* Detail section: P09-T04 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:phase id=P10 -->
### [ ] P10: Hunt for Wolverine strong-review chunk

* Intent: isolate a source-complex candidate so no lower-cost worker chooses its reading boundary.
* Dependencies: P02 integrates and fully validates at least one pilot list.

<!-- rpi:task id=P10-T01 -->
#### [ ] P10-T01: Freeze Hunt for Wolverine with strong review
* Requirement and evidence: the guide presents a complex source boundary.
* Expected result: one explicit packet or an immediate `blocked` inventory outcome with reason,
  evidence, and route owner.
* Detail section: P10-T01 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P10-T02 -->
#### [ ] P10-T02: Map Hunt for Wolverine
* Requirement and evidence: worker starts only after strong source freeze.
* Expected result: exact mapping or stop evidence.
* Detail section: P10-T02 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P10-T03 -->
#### [ ] P10-T03: Review Hunt for Wolverine relationships
* Requirement and evidence: central full-library adjudication.
* Expected result: complete report and explicit disposition.
* Detail section: P10-T03 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P10-T04 -->
#### [ ] P10-T04: Integrate or route Hunt for Wolverine
* Requirement and evidence: one-list isolation contains editorial risk.
* Expected result: after all earlier task outcomes are recorded, the list ships with complete evidence
  or has `deliveryStatus: blocked` with a specific reason, evidence, and route owner; skipped downstream
  tasks are recorded not applicable.
* Detail section: P10-T04 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:phase id=P11 -->
### [ ] P11: Fall and Rise of X metadata-horizon chunk

* Intent: isolate the candidate closest to the finished metadata boundary.
* Dependencies: P02 integrates and fully validates at least one pilot list.

<!-- rpi:task id=P11-T01 -->
#### [ ] P11-T01: Freeze the Fall and Rise of X packet
* Requirement and evidence: metadata ending in 2025 is a documented boundary.
* Expected result: one explicit packet whose rows are all representable in the current snapshot, or an
  immediate `blocked` inventory outcome with reason, evidence, and route owner.
* Detail section: P11-T01 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P11-T02 -->
#### [ ] P11-T02: Map Fall and Rise of X
* Requirement and evidence: one candidate per worker after central admission.
* Expected result: exact mapping or stop evidence with no invented metadata.
* Detail section: P11-T02 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P11-T03 -->
#### [ ] P11-T03: Review Fall and Rise of X relationships
* Requirement and evidence: central full-library adjudication.
* Expected result: complete report and explicit disposition.
* Detail section: P11-T03 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P11-T04 -->
#### [ ] P11-T04: Integrate or route Fall and Rise of X
* Requirement and evidence: one-list isolation contains metadata risk.
* Expected result: after all earlier task outcomes are recorded, the list ships with complete evidence
  or has `deliveryStatus: blocked` with a specific reason, evidence, and route owner; skipped downstream
  tasks are recorded not applicable.
* Detail section: P11-T04 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:phase id=P12 -->
### [ ] P12: Queue reconciliation

* Intent: leave the maintained inventory and product records in a truthful terminal state.
* Dependencies: P02 through P11.

<!-- rpi:task id=P12-T01 -->
#### [ ] P12-T01: Reconcile all 22 candidate records
* Requirement and evidence: queue completion means shipped or `blocked` with a specific evidence-backed
  reason and route owner.
* Expected result: every original pending id has evidence-backed terminal status.
* Detail section: P12-T01 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P12-T02 -->
#### [ ] P12-T02: Prove zero candidates remain pending
* Requirement and evidence: the maintained inventory is the source of queue truth.
* Expected result: an inventory assertion reports zero of the 22 original candidates as `pending`.
* Detail section: P12-T02 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

<!-- rpi:task id=P12-T03 -->
#### [ ] P12-T03: Close delivery records
* Requirement and evidence: shipped workflow and list changes require aligned maintainer, provenance,
  backlog, and changelog records.
* Expected result: records match the final queue and all repository gates pass.
* Detail section: P12-T03 in .copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md

## Dependencies

* Completed research: supplies the current-library baseline, queue, tool contracts, and chunking
  recommendation.
* Existing Comic Book Herald permission record: requires exact card credit and source linking.
* Finished metadata snapshot: candidates with absent issue identities stop rather than inventing data.
* P01 is the only foundation dependency for P02; P03 through P11 may proceed after the pilot proves
  the contract and may run as independent delivery chunks.
* P12 waits for every delivery chunk to record its final candidate outcomes.

## Critique Disposition

| Critique run and finding | Disposition | Plan response or residual risk |
|--------------------------|-------------|--------------------------------|
| Final-candidate critique | Complete; Revise | One complete finding set was received and resolved without a second critique. |
| PC-001 | Resolved | P09-T04, P10-T04, and P11-T04 consume recorded outcomes, including early stops and not-applicable downstream tasks. |
| PC-002 | Resolved | Phase details now lock disposition storage, canonical digest domains, and freeze-to-author operation order. |
| PC-003 | Resolved | The 22-row dispatch table gives every worker an exact id, packet path, mapping path, and command pair. |
| PC-004 | Resolved | P03 through P11 require at least one fully integrated and validated P02 pilot list; zero-pass results return to planning. |
| PC-005 | Resolved | Implementation-time escalation uses the existing `blocked` status with a reason, evidence pointer, and route owner. |
| PC-006 | Resolved | P01 owns at most 11 semantic cases and P12 owns exactly one failure-proven terminal-queue assertion. |
| PC-007 | Resolved | Aggregate additions are capped at the original 22 pending inventory ids. |
| PC-008 | Resolved | The curated-list manifest is consistently canonical and central-integrator owned. |

## Follow-Up Items

* Build a maintained character/team guide inventory after the modern queue is completed or explicitly
  paused; owner: a later research and planning task.
* Revisit the 12 blocked modern candidates with a stronger editorial and overlap-adjudication model;
  owner: a separate follow-up task.

## Handoff

* Implementation artifact: .copilot-tracking/changes/2026-08-22/reading-list-expansion-changes.md
* Ready phase or task: P01-T01.
* Remaining provisional question or blocker: None.
