<!-- markdownlint-disable-file -->
# RPI Plan: Historical event reading orders

## Task Metadata

* Task ID: MRT-003
* Task slug: historical-event-reading-orders
* Planning status: Ready
* Plan date: 2026-08-23
* Phase details: .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-23/historical-event-reading-orders-plan-critique.md

## Executive Summary

Implement five compact historical Marvel event guides from Comic Book Reading Orders without
confusing their evidence with Comic Book Herald or widening the release to all 58 pre-cutoff
events. The selected guides contain 23 exact issues and currently share no issue with any of the
89 shipped lists or one another. The release remains conditional on refreshing current main and
regenerating all complete-library, peer, digest, and approval evidence before authoring and again
before release.

### User Decisions and Requirements Highlights

* Maximum Security is excluded, as is every later timeline entry.
* The first release is Muir Island Saga, Bloodties, Midnight Massacre, Child's Play, and Eighth Day.
* CBRO evidence, storage paths, attribution, and authoring must remain distinct from CBH.
* Source boundary, ambiguous identity, metadata horizon, overlap approval, chronology, anchor
  reading, release authority, and merge remain central.
* Continue automatically through one critique, implementation, one independent Review, PR, hosted
  CI, conflict reconciliation, and merge unless evidence creates a genuine blocker.

### What You May Not Know

* Two smaller pages were not selected because their exact metadata is incomplete. They stay blocked
  rather than being shortened.
* The current 89-list and 93-comparison reports are provisional because concurrent cosmic guide work
  may change the catalog.
* Source order and shelf chronology differ: Midnight Massacre starts before Bloodties and must sit
  first on the shelf even though Bloodties appears first in the source timeline.
* Comic Book Reading Orders granted credited and linked reuse with two exclusions, but that grant
  does not cover Marvel material, so source licences stay null.

### Unresolved Decisions or Blockers

* No planning blocker. Implementation must stop if current-main reconciliation changes an exact
  mapping, introduces an exact duplicate, or invalidates an unreviewed subset or partial relationship.
  The fixed five-event release is indivisible: any unresolved selected-candidate failure blocks
  MRT-003 rather than reducing or substituting the batch.

For current user input, see [User Decisions and Requirements](#user-decisions-and-requirements).

## User Decisions and Requirements

* Create historical Marvel event reading lists from the Comic Book Reading Orders event timeline,
  ending immediately before Maximum Security.
* Preserve the complete 58-entry inventory, all canonical links, timestamps, digests, blockers,
  exclusions, and ranked later chunks. Do not silently drop a source row or candidate.
* Ship only the five research-selected events in this pull request: Muir Island Saga, Bloodties,
  Midnight Massacre, Child's Play, and Eighth Day.
* Retain only factual issue identities and order, source URL and attribution, and project-authored
  summaries. Copy no source prose, branding, images, or layout. Store no comic image bytes.
* Use normal public access only and respect published delays and controls.
* Do not label CBRO evidence as CBH. Reuse existing machinery only where its contract is
  source-neutral, through a narrow CBRO adapter or source-neutral interface.
* Preserve zero runtime dependencies and current catalog, card, filter, shelf, and chronology
  behavior.
* Keep source-boundary acceptance, ambiguous identity, metadata-horizon decisions, subset or partial
  approval, anchor reading, release authority, and merge central.
* Fetch and reconcile current main before authoring and again before PR or merge. If the concurrent
  cosmic batch changes the catalog, regenerate complete-library and selected-peer reports and reissue
  every dependent digest and approval.
* Add semantic coverage for provider identity, canonical source digest, exact sequence and metadata
  mapping, complete-library and selected-peer report binding, stale evidence rejection, approval
  authority, chronology, and current-library duplication checks.
* Prove new checks fail without the implementation. Run lint, full tests, counts, anchors with
  read-and-bless discipline, publication checks, dash scan, diff review, live metadata contract, and
  installed Edge verification at 1280x900.
* Run exactly one independent post-implementation Review, fix only in-scope release blockers, route
  unrelated findings, and do not repeat Review.
* Open a pull request with `## In plain English`, exact verification counts, and the required
  co-author trailer; monitor Node 20, Node 24, and lint; reconcile current main safely; merge; and
  persist the merged result.

## Goals

* Add five exact, attributed, chronology-correct historical event guides.
* Establish a provider-safe CBRO evidence path without duplicating generic freshness and overlap
  policy or regressing existing CBH flows.
* Bind source, mapping, library, peer, approval, authoring, and release evidence so stale inputs fail.
* Leave every later pre-cutoff event in an explicit ranked, blocked, absorbed, or deferred state.

## Scope and Non-Goals

### In Scope

* A maintained 58-entry CBRO historical inventory and five frozen event packets.
* Exact mappings, complete current-library and selected-peer reports, central dispositions, and
  approved manifests for the five selected events.
* A narrow CBRO preparation and authoring adapter over source-neutral digest, mapping, overlap,
  approval, chronology, and vendoring primitives.
* Five event checklists, five vendored payloads, catalog entries, counts, tests, backlog, changelog,
  provenance, maintenance, publication, and tracking evidence.
* Full local gates, installed Edge checks, one independent Review, PR, hosted CI, and merge.

### Non-Goals

* Maximum Security, any later event, or any additional pre-cutoff event in this pull request.
* Resolving Days of Future Present, Countdown, Legion Quest, Marvel vs DC, or later mapping-deferred
  candidates.
* A browser runtime feature, catalog redesign, persistence change, or new runtime dependency.
* Copying source prose or presentation, scraping Marvel sites, or storing image bytes.
* Renaming or generalizing the entire CBH artifact tree.

## Functional Requirements

* Provider evidence records CBRO identity and exact source-page digest.
  * Observable acceptance criteria: CBRO packets reject a CBH host or origin, CBH packets retain
    current behavior, and a content change invalidates downstream mapping or approval.
* Every selected source row resolves to one issue identity in original order.
  * Observable acceptance criteria: all 23 rows are exact, unique, metadata-backed, and preserved
    through packet, mapping, Markdown, payload, and catalog surfaces.
* Every selected candidate is compared with the complete current library and all four selected peers.
  * Observable acceptance criteria: report coverage equals the execution-time catalog plus four peers,
    exact duplicates have no path, and subset or partial relationships require central authority.
* Authoring accepts only current central evidence.
  * Observable acceptance criteria: stale source, packet, mapping, report, library, peer, approval,
    manifest, or chronology evidence stops before product files are written.
* The five event cards use current app conventions.
  * Observable acceptance criteria: type is event, source attribution and exact page link render,
    first-on-sale chronology controls shelf order, filters work, and every card imports its exact count.

## Non-Functional Requirements

* Runtime dependencies remain zero.
  * Objective threshold or evaluation condition: no `dependencies` entry and no evidence script
    reaches browser code.
  * Observable acceptance criteria: package runtime surface and app loading remain unchanged.
* Release scope remains bounded.
  * Objective threshold or evaluation condition: exactly five catalog additions and 23 unique issues;
    no removals.
  * Observable acceptance criteria: counts and semantic tests fail on a sixth new CBRO list or a
    missing selected list.
* Evidence freshness is deterministic.
  * Objective threshold or evaluation condition: canonical SHA-256 binds source, packet, mapping,
    library, peer, report, and approval inputs.
  * Observable acceptance criteria: mutating any bound input makes the focused test fail.
* Existing CBH behavior remains backward compatible.
  * Objective threshold or evaluation condition: all existing CBH tests and approved packet flows
    pass without data rewrites.
  * Observable acceptance criteria: full tests remain green and existing generated data is unchanged
    outside expected catalog regeneration.

## Acceptance Criteria

* Current main and the five source pages are refreshed before authoring; all dependent evidence is
  regenerated if either boundary changes.
* Exactly five event guides and 23 unique issue IDs ship, with original source order inside each list.
* Each selected candidate has one exact packet, mapping, complete-library and peer report, central
  approval, checklist, vendored payload, and catalog entry.
* Every selected report covers every execution-time shipped list and all four selected peers.
* No exact, candidate-subset, existing-subset, or partial relationship is shipped without the required
  central disposition; exact duplicates remain impossible to approve.
* Provider identity, canonical source digest, exact mapping, report binding, stale evidence, authority,
  chronology, and duplicate guards have semantic tests observed failing without the implementation.
* Current CBH flows remain compatible and zero runtime dependencies remain.
* Directly related counts, backlog, changelog, provenance, maintenance, publication, and anchor evidence
  agree with the shipped product.
* Full tests, lint, counts, sizes, palette, publication, anchors, dash and diff review, live contract,
  installed Edge verification, one independent Review, and hosted Node 20, Node 24, and lint jobs pass
  before merge.

## Initial Evidence and Readiness

* Research: .copilot-tracking/research/2026-08-23/historical-event-reading-orders-research.md
* External inventory lane:
  .copilot-tracking/research/subagents/2026-08-23/historical-event-reading-orders-c1-wider-external.md
* Selected exact evidence:
  .copilot-tracking/research/2026-08-23/historical-event-pilot-resolution.json
* Full inventory coverage:
  .copilot-tracking/research/2026-08-23/historical-event-library-coverage.json
* Readiness: Evidence is sufficient for implementation. The one critique is complete and all findings
  are resolved. No additional research is required.

## Active Boundaries

* Maximum catalog additions: 5.
* Selected issue count: 23 unique IDs.
* Exact removals: none.
* Runtime dependency additions: 0.
* Exactly one final-candidate plan critique and one independent post-implementation Review.
* Current-main and source freshness refreshes are blocking gates, not optional checks.
* Central decisions and release authority are not delegated.

## Implementation Context Record

| Context item | Current artifact or record |
|---|---|
| Plan | .copilot-tracking/plans/2026-08-23/historical-event-reading-orders-plan.md |
| Phase details | .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md |
| Latest critique | .copilot-tracking/reviews/plans/2026-08-23/historical-event-reading-orders-plan-critique.md, Complete with Revise verdict; PC-001 through PC-005 resolved directly |
| Relevant research | .copilot-tracking/research/2026-08-23/historical-event-reading-orders-research.md |
| Changes-record role | .copilot-tracking/changes/2026-08-23/historical-event-reading-orders-changes.md is created by implementation |
| Planning execution and readiness | Complete and implementation-ready after direct disposition of all five critique findings |
| Continuation context | Confirmed automatic RPI Agent continues automatically with P01-T01 |

## Sources

* .copilot-tracking/research/2026-08-23/historical-event-reading-orders-research.md:
  complete inventory, selected release, provider boundary, current-library evidence, and follow-ups.
* docs/MAINTAINING.md: current packet, mapping, approval, authoring, and validation contracts.
* docs/DATA_PROVENANCE.md: CBRO permission and publication boundary.
* Caller checkpoint: preserve provisional 89-list and 93-comparison evidence until current-main refresh.

## Locked Change and Validation Boundaries

| Boundary | Locked value |
|---|---|
| Exact removals | None |
| Runtime dependency additions | 0 |
| Maximum catalog additions | 5 exact ids: `muir-island-saga`, `bloodties`, `midnight-massacre`, `childs-play`, `eighth-day` |
| Selected issue total | 23 unique issue IDs: 5, 5, 5, 4, and 4 in source order |
| New implementation modules | At most 3: one CBRO evidence adapter, one preparation entry point, and one authoring entry point |
| New test files | At most 1 focused CBRO historical-event test file |
| New semantic test cases | At most 14, covering provider identity, source digest, exact mappings, library and peer binding, stale evidence, authority, chronology, duplication, and generated surfaces |
| Canonical source targets | One 58-entry CBRO historical inventory and five frozen packets |
| Canonical review targets | Five exact mappings and five complete-library plus selected-peer reports with central approvals |
| Canonical product targets | Five Markdown checklists and five curated manifest entries |
| Generated targets | Five vendored JSON payloads and regenerated catalog data |
| Existing provider boundary | No CBRO evidence under `scripts/data/cbh-*`; existing CBH packet data is not rewritten |
| Regression coverage | Full existing CBH, resolver, overlap, catalog, count, publication, anchor, lint, and browser coverage |
| Validation evidence | Focused failure proof; full tests; lint; counts; sizes; palette; publication; anchors read, bless, and clean rerun; dash scan; diff review; live contract; Edge at 1280x900; one independent Review; hosted Node 20, Node 24, and lint |

## Phase Checklist

<!-- rpi:phase id=P01 -->
### [x] P01: Refresh evidence and establish the provider seam

* Intent: bind implementation to current main and current CBRO pages, then add the smallest
  provider-aware contract that keeps existing CBH behavior unchanged.
* Dependencies: completed MRT-003 research.

<!-- rpi:task id=P01-T01 -->
#### [x] P01-T01: Reconcile current main and source snapshots

* Requirement and evidence: concurrent guide work can change the catalog and every selected report.
* Expected result: current main is fetched and integrated safely; the five source pages are re-fetched
  under normal access; unchanged digests are confirmed or source review is reissued.
* Detail section: P01-T01 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P01-T02 -->
#### [x] P01-T02: Add provider-aware evidence validation

* Requirement and evidence: current frozen validation and authoring hard-code CBH host and origin.
* Expected result: CBRO packets carry explicit provider and source-content identity, while default
  CBH validation and all existing packet digests remain backward compatible.
* Detail section: P01-T02 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P01-T03 -->
#### [x] P01-T03: Lock semantic provider and freshness checks

* Requirement and evidence: caller requires provider identity, canonical digest, stale evidence, and
  backward-compatibility proof.
* Expected result: focused tests fail on wrong provider, wrong host, changed source content, stale
  downstream evidence, and changed existing CBH behavior.
* Detail section: P01-T03 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:phase id=P02 -->
### [x] P02: Freeze, map, and centrally approve the five events

* Intent: create immutable CBRO source packets, exact one-event mappings, complete reports, and central
  relationship approvals before product authoring.
* Dependencies: P01.

<!-- rpi:task id=P02-T01 -->
#### [x] P02-T01: Persist the complete historical inventory

* Requirement and evidence: all 58 pre-cutoff candidates and every blocker must remain durable.
* Expected result: one maintained inventory preserves source position, exact URL or timeline section,
  digest, row count, selected, deferred, subset, absorbed, and blocked states without including
  Maximum Security.
* Detail section: P02-T01 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P02-T02 -->
#### [x] P02-T02: Freeze five reviewed CBRO packets

* Requirement and evidence: source boundary, exclusions, rows, manifest proposal, chronology anchor,
  provider identity, source digest, and central review must precede mapping.
* Expected result: five canonical packet files preserve exact source order and independently verified
  first-on-sale insertion anchors.
* Detail section: P02-T02 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P02-T03 -->
#### [x] P02-T03: Produce exact one-event mappings

* Requirement and evidence: lower-cost workers may map frozen rows but cannot choose boundaries,
  manifests, ambiguity, exceptions, chronology, or overlap dispositions.
* Expected result: five mapping files resolve all 23 rows exactly, preserve approved title aliases,
  contain no duplicate issue ID, and expose any mismatch as a blocker for the whole fixed release.
* Detail section: P02-T03 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P02-T04 -->
#### [x] P02-T04: Regenerate reports and central approvals

* Requirement and evidence: provisional reports have no release authority after current-main changes.
* Expected result: each report covers every current shipped list and all four peers; exact duplicates
  stop; every relationship receives the allowed central disposition; report, library, peer, packet,
  mapping, and approval digests agree. Any unresolved selected relationship blocks the whole release.
* Detail section: P02-T04 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:phase id=P03 -->
### [x] P03: Author, vendor, and integrate the event guides

* Intent: turn only approved current evidence into five normal event cards and exact offline payloads.
* Dependencies: P02.

<!-- rpi:task id=P03-T01 -->
#### [x] P03-T01: Author CBRO checklists and manifest entries

* Requirement and evidence: CBRO attribution and project prose must remain distinct from CBH output.
* Expected result: five checklists carry project-authored derivation trails, exact CBRO page links,
  no source prose or images, and exact approved issue order; five manifest entries use type `event`,
  null source licence, and original summaries.
* Detail section: P03-T01 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P03-T02 -->
#### [x] P03-T02: Vendor exact payloads and shelf chronology

* Requirement and evidence: product data must be offline and the shelf follows first on-sale dates.
* Expected result: five payloads contain 23 unique exact items with zero placeholders and zero
  unresolved rows; catalog order places Midnight Massacre before Bloodties and retains source order
  inside each event.
* Detail section: P03-T02 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P03-T03 -->
#### [x] P03-T03: Lock product and duplicate semantics

* Requirement and evidence: exact mapping must survive every generated surface and current filters.
* Expected result: focused tests bind packet, mapping, Markdown, payload, catalog, chronology, source
  attribution, exact counts, current-library and peer duplication, and event shelf behavior.
* Detail section: P03-T03 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:phase id=P04 -->
### [x] P04: Reconcile product and maintenance records

* Intent: make the product record, maintenance contract, and release boundary agree with the five
  guides and the retained later inventory.
* Dependencies: P03.

<!-- rpi:task id=P04-T01 -->
#### [x] P04-T01: Update backlog, changelog, and counts

* Requirement and evidence: shipped work and user-visible catalog changes must be recorded in the same
  change.
* Expected result: one backlog block records the five-list release and later ranked work; Unreleased
  changelog and every touched count are re-derived from the final tree.
* Detail section: P04-T01 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P04-T02 -->
#### [x] P04-T02: Update provenance, maintenance, and publication guidance

* Requirement and evidence: CBRO permission, provider paths, no-source-prose boundary, central
  approvals, and release checks must be maintainable.
* Expected result: documentation distinguishes CBRO from CBH, records five lists and 23 issues,
  preserves the source owner's exclusions, and names exact refresh and approval commands.
* Detail section: P04-T02 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P04-T03 -->
#### [x] P04-T03: Maintain changes and anchor evidence

* Requirement and evidence: implementation divergences and every moved current citation need durable,
  reviewable evidence.
* Expected result: CHG records close planned tasks or document deviations; all citations are re-aimed
  by claim and arithmetic, read during bless, and finish with zero drift, new, or removed anchors.
* Detail section: P04-T03 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:phase id=P05 -->
### [x] P05: Validate implementation and prepare Review

* Intent: prove the feature, regression safety, source boundary, and real-browser behavior before the
  one independent Review.
* Dependencies: P04.

<!-- rpi:task id=P05-T01 -->
#### [x] P05-T01: Prove focused checks detect the missing implementation

* Requirement and evidence: a new check is evidence only after it is observed failing without its fix.
* Expected result: the smallest safe stash or one-line revert produces named focused failures, then
  the restored tree passes them.
* Detail section: P05-T01 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P05-T02 -->
#### [x] P05-T02: Run all local and browser gates

* Requirement and evidence: caller and repository require complete release checks.
* Expected result: focused tests, full tests, lint, counts, sizes, palette, publication, clean anchors
  cycle, dash scan, diff review, live metadata contract, and installed Edge verification for all five
  cards and sampled first, middle, and final sequence rows pass at 1280x900.
* Detail section: P05-T02 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P05-T03 -->
#### [x] P05-T03: Reconcile main and refresh release evidence

* Requirement and evidence: concurrent work may land after authoring.
* Expected result: current main and source pages are reconciled again; changed catalog evidence causes
  complete report, digest, and approval regeneration; affected gates rerun; release state is current.
* Detail section: P05-T03 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:phase id=P06 -->
### [x] P06: Execute one independent Review

* Intent: perform exactly one post-implementation review and route its outcomes without a loop.
* Dependencies: P05.

<!-- rpi:task id=P06-T01 -->
#### [x] P06-T01: Run and persist one independent Review

* Requirement and evidence: caller requires one independent Review after implementation.
* Expected result: one review artifact evaluates the final implementation, source safety, freshness,
  overlap authority, generated data, documentation, and release readiness.
* Detail section: P06-T01 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P06-T02 -->
#### [x] P06-T02: Fix only in-scope release blockers and route the rest

* Requirement and evidence: review findings are routed, not looped.
* Expected result: material in-scope blockers are fixed and affected gates rerun without another
  Review; unrelated findings become explicit follow-ups.
* Detail section: P06-T02 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:phase id=P07 -->
### [ ] P07: Publish, monitor CI, merge, and persist final state

* Intent: deliver the reviewed release through hosted checks and record the merged outcome.
* Dependencies: P06.

<!-- rpi:task id=P07-T01 -->
#### [x] P07-T01: Commit and open the pull request

* Requirement and evidence: release history and review entry point must follow repository conventions.
* Expected result: commits carry the co-author trailer; the PR begins with `## In plain English`,
  records exact verification counts, and names no tracking path in its plain-English section.
* Detail section: P07-T01 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P07-T02 -->
#### [x] P07-T02: Monitor hosted checks and reconcile safely

* Requirement and evidence: Node 20, Node 24, and lint conclusions are release gates.
* Expected result: actual job conclusions and logs are read; current-main conflicts are resolved
  without destructive shortcuts. After the final main fetch, a relevant catalog change regenerates
  all five complete-library plus four-peer reports, reissues every affected packet, mapping, peer,
  report, approval, authoring, and release digest, records central authority, reruns all seven local
  deterministic gates plus affected contract and browser checks, and blocks on an exact duplicate or
  unresolved disposition. The one completed Review is not repeated.
* Detail section: P07-T02 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

<!-- rpi:task id=P07-T03 -->
#### [ ] P07-T03: Merge and persist the result

* Requirement and evidence: the automatic task continues through merge and durable reporting.
* Expected result: PR is merged, the merge commit and hosted conclusions are recorded, final RPI state
  is persisted, and the creator receives the merged outcome or a precise blocker.
* Detail section: P07-T03 in .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md

## Dependencies

* Current main: must be fetched and reconciled before authoring and release.
* Source pages: all five content digests must match reviewed evidence or re-enter central source review.
* Existing deterministic machinery: only source-neutral primitives may be reused.

## Critique Disposition

The single final-candidate critique returned Revise. The planner applied all five direct corrections
in one batch and will not run another critique.

| Critique run and finding | Disposition | Plan response or residual risk |
|---|---|---|
| PC-001 fixed release versus reduction paths | Resolved | Removed every reduction path; any selected-candidate failure blocks all of MRT-003. |
| PC-002 final reconciliation freshness chain | Resolved | P07-T02 repeats complete report, digest, approval, authority, and affected-gate regeneration after the final main fetch without repeating Review. |
| PC-003 sizes and palette gates | Resolved | Added sizes and palette to acceptance, local execution, and final affected-gate reruns. |
| PC-004 bounded test ownership and failure proof | Resolved | Details allocate 6 P01 and 8 P03 cases in one file and require each new case to fail for its intended contract. |
| PC-005 research artifact immutability | Resolved | Details mark all research Markdown, JSON, and scripts read-only; refreshed facts flow only to implementation-owned canonical artifacts and the changes record. |

## Follow-Up Items

* The ranked later historical-event chunks remain outside MRT-003 implementation scope. A later RPI
  task owns exact mapping and current-library adjudication from the research ranking.

## Handoff

* Implementation artifact: .copilot-tracking/changes/2026-08-23/historical-event-reading-orders-changes.md
* Ready phase or task: P01-T01
* Remaining provisional question or blocker: none for planning
