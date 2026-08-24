<!-- markdownlint-disable-file -->
# RPI Plan: MCU best-of guides

## Task Metadata

* Task ID: MRT-004
* Task slug: mcu-best-of-guides
* Planning status: Implementation ready after one critique
* Plan date: 2026-08-23
* Phase details: .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-23/mcu-best-of-guides-plan-critique.md

## Executive Summary

Plan and ship the first four user-priority Comic Book Herald movie and streaming companion guides as a guarded 43-issue release. The guides appear under the confirmed Marvel on Screen category on the existing Hub, use truthful `screen-companion` and `selected` taxonomy, and reuse the current source, mapping, overlap, approval, and authoring protections rather than creating a parallel ingestion path.

### User Decisions and Requirements Highlights

* Preserve all fourteen selected titles and their order in a durable inventory, but ship only priorities 1 to 4 in this release.
* Marvel on Screen placement is fixed. Use the existing category gateway and generated child-page contract, do not create a fourth canonical shelf, and do not use Character Spotlight.
* Retain factual issue identity and order only. Do not copy source prose, branding, layouts, movie imagery, or comic image bytes.

### What You May Not Know

* Current `main` has no runtime Marvel on Screen category. This plan must realize the already approved Hub placement without widening navigation.
* The four selected guides map to 43 exact issues. The Marvel Multiverse card is a reviewed two-issue subset of existing Claremont paths and needs transparent scope wording plus central subset approval.
* The ten unshipped guides remain fully inventoried: six are ranked mapping follow-ups and four are blocked until a source explicitly enumerates their issues.
* Existing browse screens remain three. The new type continues to use Storylines as the fallback browse destination while the Hub gives it the explicit Marvel on Screen heading; the Storylines context must be widened so it does not falsely claim every card is a whole run.
* All four cards carry `timeline: null` because their selected issues span decades rather than beginning at one story year. They also carry `beginner: false`, so the two-issue subset cannot displace the existing featured starting point.

### Unresolved Decisions or Blockers

* None for planning. Current `main`, source digests, metadata, library overlaps, and selected-peer evidence must be refreshed during implementation before authoring and release.

For current user input, see [User Decisions and Requirements](#user-decisions-and-requirements).

## User Decisions and Requirements

* Use stable task ID MRT-004 and slug `mcu-best-of-guides`.
* Preserve the exact fourteen-title selected scope, including Miles Morales and Venom, in user priority order.
* Inventory every title with one canonical source and WordPress identity where available, retrieval time, source and issue-bearing digests, exact source boundaries, source-form distinctions, chronology, overlap state, and terminal or follow-up disposition.
* Ship a bounded first release of four to six smallest coherent admissible guides; Research selected priorities 1 to 4 and 43 exact issue rows.
* Keep every guide under the existing approved Marvel on Screen category on the Hub. Do not add another shelf or browse route and do not place these cards in Character Spotlight.
* Use an explicit honest list type rather than misusing `character-run`, event, creator, or era taxonomy.
* Use a `selected` reading depth rather than calling best-of recommendations essential or complete.
* Reuse guarded Comic Book Herald packet, digest, exact mapping, complete-library and peer overlap, central approval, and authoring primitives through a narrow adapter.
* Reject exact duplicates. Require central authority for subset and partial relationships. Never silently omit unavailable, repeated, ambiguous, collection-only, or out-of-horizon source rows.
* Do not infer trade contents unless the page explicitly enumerates them or repository-approved metadata provides an exact auditable mapping.
* Write original project summaries and retain source links and attribution without copying source expression or image bytes.
* Update every directly affected product, evidence, documentation, test, count, release, and accessibility surface.
* Use one plan critique and exactly one independent post-implementation Review.
* Reconcile current `main` before authoring and before release, then open, monitor, and merge a pull request with the required plain-English section and verification counts.

## Goals

* Deliver four truthful, exact, source-attributed Marvel on Screen guides with no inferred issues.
* Preserve all fourteen user priorities in a validated inventory and ranked follow-up queue.
* Extend the catalog and Hub with the smallest type and category model that preserves existing navigation and accessibility.
* Bind source, metadata, library, peer, approval, and generated output freshness so stale or incomplete evidence fails closed.

## Scope and Non-Goals

### In Scope

* Priorities 1 to 4: Doctor Strange Multiverse of Madness, Spider-Man No Way Home, Marvel Multiverse, and Marvel What If.
* A fourteen-record MCU companion inventory and a narrow guarded adapter.
* Four source packets, exact mappings, complete-library and selected-peer reports, central approvals, source order files, payloads, manifest entries, and catalog cards.
* `screen-companion` taxonomy and a non-empty Marvel on Screen Hub category.
* `selected` reading depth and plain-language label/hint.
* Directly affected tests, counts, docs, backlog, changelog, anchors, browser checks, release checks, PR, and merge.

### Non-Goals

* Shipping priorities 5 to 14 in this pull request.
* Adding a fourth canonical shelf or a direct rail item. Marvel on Screen uses the category contract's child route under Browse.
* Changing Character Spotlight semantics or filters.
* Copying source prose, branding, layouts, movie imagery, or comic images.
* Inferring collection contents, scraping Marvel sites, altering the canonical origin, or changing persistence.

## Functional Requirements

* The app accepts `screen-companion` as a first-class list type and `selected` as a reading depth.
  * Observable acceptance criteria: all four manifest and catalog entries parse without drops; type/depth labels are visible and no entry carries `spotlightKind`.
* The Hub renders the four selected stories, in user priority order, under one `Marvel on Screen` heading after the three established Hub groups.
  * Observable acceptance criteria: all four `timeline: null` cards populate one Marvel on Screen gateway tile and its generated child page in user order at desktop and narrow widths; the tile and route are keyboard and screen-reader accessible; no fourth canonical shelf or direct rail item exists.
* Every selected guide imports the exact frozen-packet issue sequence.
  * Observable acceptance criteria: the current Research baseline is 17, 17, 2, and 7; refreshed source evidence takes precedence, and any boundary/count change pauses authoring, is recorded as a plan amendment in the changes record, and re-derives every acceptance count before work continues; source order, issue IDs, issue numbers, payloads, Markdown, manifest, and catalog agree.
* Every source row receives an explicit outcome.
  * Observable acceptance criteria: packet boundaries retain all issue-explicit picks and list every collection-only, prose-only, contextual, or non-recommended source reference as an exclusion; omitted accepted rows fail tests.
* Relationship evidence covers the complete pre-publication library and all selected peers.
  * Observable acceptance criteria: no exact duplicate can be approved; priority 1's two partials and priority 3's two candidate-subsets require stronger-model dispositions; all other comparisons are `none`.
* All fourteen selected titles remain in a validated inventory.
  * Observable acceptance criteria: positions 1 through 14, exact source URLs and WordPress identities, digests, dispositions, delivery states, follow-up rank or blocker, and selected IDs are pinned.
* Cards and order files use project-authored summaries and source attribution.
  * Observable acceptance criteria: each card links its canonical source, names Comic Book Herald in the existing attribution form, contains no source commentary or images, and imports offline.

## Non-Functional Requirements

* Evidence freshness fails closed.
  * Objective threshold or evaluation condition: packet, mapping, report, library, peer, approval, inventory identity, source content, and issue-bearing digests must all match current evidence.
  * Operating condition or verification approach, if needed: reconcile `main` and recompute evidence before authoring and again before release.
  * Observable acceptance criteria: deliberate source-row, digest, peer, library, disposition, and generated-sequence mutations fail the targeted test.
* Existing product behavior remains intact.
  * Objective threshold or evaluation condition: zero production removals, zero new runtime dependencies, zero new browse routes, zero Character Spotlight count changes, and zero placeholder or unresolved generated rows.
  * Observable acceptance criteria: full tests, lint, counts, sizes, palette, publication, anchors, and browser proof pass.
* Accessibility and responsive behavior remain measurable.
  * Objective threshold or evaluation condition: Hub headings preserve hierarchy; every card action has its existing accessible name; 1280x900 and narrow viewport checks show the Marvel on Screen group and all four cards without horizontal overflow.
  * Observable acceptance criteria: browser proof records shelf visibility, four-card count, navigation, import, sampled issue sequences, and narrow layout.
* Release evidence is complete and reproducible.
  * Objective threshold or evaluation condition: one plan critique, one independent post-implementation Review, exact verification counts in the PR, Node 20 and Node 24 jobs plus lint green, and merged `main` revalidated.
  * Observable acceptance criteria: PR is merged and the merged commit, job conclusions, and final gate results are persisted.

## Acceptance Criteria

* A fourteen-record inventory validates with priorities 1 to 4 selected and all other rows ranked or blocked exactly as Research records.
* Four frozen packets retain current canonical identities, source and issue-bearing digests, explicit boundaries, exclusions, source reviews, and insertion anchors; their current baseline totals 43 rows, and refreshed packet rows are the count authority.
* Four mappings resolve every row exactly with no duplicate selected issue inside or across the release.
* Four reports compare each candidate with every current library order and the other three peers, reject exact duplicates, and bind the current library and peer digests.
* Central approvals cover every comparison and use stronger-model authority for every non-`none` relationship.
* Generated Markdown and payloads preserve issue IDs and order exactly; counts equal the refreshed frozen packets, currently 17, 17, 2, and 7; placeholders and unresolved arrays are empty.
* Catalog and manifest contain exactly four `screen-companion` / `selected` entries in user priority order with original summaries and canonical attribution.
* Hub renders exactly four Marvel on Screen cards in priority order at 1280x900 and a narrow viewport; the group is absent when no matching content exists.
* All four manifest entries carry `timeline: null` and `beginner: false`; the type selector retains all four outside publishing-age pages and the retired featured picker is not restored.
* Timeline, Storylines, and Character Spotlights remain the only three browse screens; Character Spotlight readings and stories do not change.
* Priority 3's card and packet state that it contains the guide's only issue-numbered selection, and its subset approval remains digest-bound.
* No copied source prose, branding, movie image, comic image byte, em dash, en dash, runtime dependency, telemetry, origin change, or Marvel scraping is introduced.
* `npm run lint`, `npm test`, `npm run counts`, `npm run sizes`, `npm run palette`, `npm run anchors`, `npm run publication`, the live metadata contract, the targeted MCU contract, browser proof, and dash scan all pass.
* New semantic checks are observed failing against the smallest stashed fix before restoration.
* Exactly one independent post-implementation Review runs; in-scope blockers are fixed without repeating Review and unrelated findings are routed.
* The PR includes `## In plain English`, exact verification counts, and the required co-author trailer; Node 20, Node 24, and lint jobs pass; the branch is reconciled and merged.

## Implementation Context Record

| Context item | Current artifact or record |
|---|---|
| Plan | .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md |
| Phase details | .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md |
| Latest critique | .copilot-tracking/reviews/plans/2026-08-23/mcu-best-of-guides-plan-critique.md with Revise verdict; PC-001 to PC-009 resolved directly in this final plan |
| Relevant research | .copilot-tracking/research/2026-08-23/mcu-best-of-guides-research.md, complete and Ready |
| Changes-record role | .copilot-tracking/changes/2026-08-23/mcu-best-of-guides-changes.md is created by implementation |
| Planning execution and readiness | Complete and implementation ready after one critique |
| Continuation context | Confirmed automatic RPI Agent continues to implementation |

## Sources

* .copilot-tracking/research/2026-08-23/mcu-best-of-guides-research.md: selected release, complete inventory, source identities, mappings, overlap, type, Hub placement, risks, and follow-ups.
* .copilot-tracking/research/2026-08-23/mcu-best-of-source-boundaries.json: current WordPress identities and source digests.
* .copilot-tracking/research/2026-08-23/mcu-best-of-first-release-mapping.json: exact candidate metadata and complete-library plus peer relationships.

## Phase Checklist

<!-- rpi:phase id=P00 -->
### [x] P00: Reconcile and freeze release evidence

* Intent: Make current `main`, source snapshots, metadata, library, peers, and approval inputs agree before production authoring.
* Dependencies: Complete Research.

<!-- rpi:task id=P00-T01 -->
#### [x] P00-T01: Reconcile current main and baseline counts

* Requirement and evidence: Concurrent catalog work can change the 96-reading Research baseline.
* Expected result: `origin/main` is merged into the feature branch, with command output and exit status read before dependent work; catalog/list/story/type counts and pre-publication library digest are re-derived and recorded in CHG-xxx changes-record sections.
* Detail section: P00-T01 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:task id=P00-T02 -->
#### [x] P00-T02: Refresh all fourteen source identities and digests

* Requirement and evidence: Every selected title needs current canonical, WordPress, content, issue-bearing, boundary, and disposition evidence.
* Expected result: a complete fourteen-record inventory is frozen from current source snapshots, including priority 6's rejected podcast identity and every blocked/deferred row. Refreshed evidence outranks Research; a changed boundary or row count pauses authoring and amends packet-derived acceptance counts durably.
* Detail section: P00-T02 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:phase id=P01 -->
### [x] P01: Guard the MCU companion provider flow

* Intent: Reuse existing CBH primitives through one narrow inventory adapter and make incomplete or stale evidence unshippable.
* Dependencies: P00.

<!-- rpi:task id=P01-T01 -->
#### [x] P01-T01: Add the inventory adapter and terminal-state contract

* Requirement and evidence: Research C14 establishes the CBRO adapter precedent; the user requires all fourteen rows even when only four ship.
* Expected result: one adapter validates 14 identities, positions, digests, selected ids/order, delivery states, ranked follow-ups, blocked rows, and inventory identity digest without changing modern or character inventory validators.
* Detail section: P01-T01 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:task id=P01-T02 -->
#### [x] P01-T02: Freeze four source packets and exact mappings

* Requirement and evidence: Research selected exact counts 17, 17, 2, and 7 with two reviewed metadata aliases.
* Expected result: four packets and mappings bind source digests, every accepted row, every exclusion, exact issue metadata, original manifest proposals, explicit `timeline: null` and `beginner: false`, and no duplicate selected issue across the release.
* Detail section: P01-T02 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:task id=P01-T03 -->
#### [x] P01-T03: Bind complete-library, peer, and central approval evidence

* Requirement and evidence: Research found two priority 1 partials and two priority 3 candidate-subsets; exact duplication has no approval path.
* Expected result: four complete reports and approvals cover the current library plus exactly the other three shipped peers per candidate. The expected current count is 99, not Research's 100, because Research also included deferred priority 6 as a feasibility peer; priority 6 had no non-`none` relationship with a shipped candidate.
* Detail section: P01-T03 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:phase id=P02 -->
### [x] P02: Add Marvel on Screen product semantics

* Intent: Give the guides an honest type, depth, and confirmed Hub placement without adding navigation or altering Character Spotlight.
* Dependencies: P01.

<!-- rpi:task id=P02-T01 -->
#### [x] P02-T01: Add screen-companion and selected taxonomy

* Requirement and evidence: Existing types and depths make false claims about these best-of companion lists.
* Expected result: manifest and catalog parsing, labels, hints, filters, and tests accept `screen-companion` / `selected`, reject `spotlightKind`, and preserve all existing type/depth behavior.
* Detail section: P02-T01 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:task id=P02-T02 -->
#### [x] P02-T02: Render the non-empty Marvel on Screen Hub category

* Requirement and evidence: User placement is fixed; current Hub derives only the three browse shelf headings.
* Expected result: one table-driven secondary category selects `screen-companion` stories, appears on both Home and Browse only when populated, and opens its generated child page; all other gateway categories and canonical shelves keep current ordering and counts.
* Detail section: P02-T02 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:task id=P02-T03 -->
#### [x] P02-T03: Preserve browse, accessibility, and narrow-layout contracts

* Requirement and evidence: Every story must remain discoverable and cards already share one adaptive grid.
* Expected result: the new type remains canonically reachable through Storylines, adds one category child route but no shelf or direct rail item, keeps Character Spotlight unchanged, and renders four one-column cards on the narrow Marvel on Screen child page.
* Detail section: P02-T03 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:phase id=P03 -->
### [x] P03: Author the four-guide release

* Intent: Turn approved evidence into four offline lists, catalog cards, and maintained product records.
* Dependencies: P01 and P02.

<!-- rpi:task id=P03-T01 -->
#### [x] P03-T01: Author exact checklists, payloads, manifest, and cards

* Requirement and evidence: The four mappings are the canonical 43-row sequence authority.
* Expected result: four source order files, four generated payloads, four manifest entries, and four catalog cards preserve exact sequence, packet-derived counts, source links, original summaries, selected type/depth, user order, cover identity, `timeline: null`, and `beginner: false` with zero placeholders.
* Detail section: P03-T01 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:task id=P03-T02 -->
#### [x] P03-T02: Update maintenance, provenance, product, and UX records

* Requirement and evidence: The release changes catalog capability, guarded ingestion, source coverage, Hub categories, and visible counts.
* Expected result: backlog, changelog, README if its companion inventory changes, data provenance, maintaining, publication, UX, and count-bearing sections describe the exact release and all fourteen dispositions without copying source expression; the shipped backlog block records `Constraint gate: checked 1 to 11, none breached`.
* Detail section: P03-T02 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:phase id=P04 -->
### [ ] P04: Prove the implementation and run one Review

* Intent: Demonstrate source, data, UI, accessibility, and release behavior before a pull request.
* Dependencies: P03.

<!-- rpi:task id=P04-T01 -->
#### [x] P04-T01: Prove semantic checks fail without the fix

* Requirement and evidence: Repository policy requires every new check to be observed failing against the broken behavior.
* Expected result: smallest targeted stashes make source omission, stale evidence, taxonomy, Hub placement, and priority 3 scope checks fail; restoration returns them green.
* Detail section: P04-T01 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:task id=P04-T02 -->
#### [ ] P04-T02: Run full gates and real-browser proof

* Requirement and evidence: CI gates and browser-only behavior cover different failure classes.
* Expected result: lint, full tests, counts, sizes, palette, publication, source/card release checks, anchors re-aim/read/bless cycle, live metadata contract, dash scan, diff review, and Edge proof at 1280x900 plus narrow viewport pass with recorded counts. New files are indexed before anchors run, ignored tracking artifacts are force-added, and every moved citation is derived both from lock head text and diff hunk arithmetic before bless.
* Detail section: P04-T02 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:task id=P04-T03 -->
#### [ ] P04-T03: Run exactly one independent post-implementation Review

* Requirement and evidence: The user requires one independent Review and no review loop.
* Expected result: one Review artifact records its complete findings; in-scope release blockers are fixed once, unrelated work is routed, and no second Review is run.
* Detail section: P04-T03 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:phase id=P05 -->
### [ ] P05: Release and persist the merged result

* Intent: Reconcile concurrent work, publish a reviewable PR, monitor all required jobs honestly, merge, and record the final state.
* Dependencies: P04.

<!-- rpi:task id=P05-T01 -->
#### [ ] P05-T01: Reconcile main and rerun affected gates

* Requirement and evidence: Star-Lord and other catalog work may merge while this task runs.
* Expected result: current `main` is merged into the feature branch, never rebased; native-command exit status is read and output is not suppressed before dependent work; library, peer, catalog, count, anchor, and browser evidence are regenerated where affected; conflict-touched citations are re-derived from both head text and final diff hunks.
* Detail section: P05-T01 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

<!-- rpi:task id=P05-T02 -->
#### [ ] P05-T02: Open, monitor, and merge the pull request

* Requirement and evidence: Repository release policy requires plain-English orientation, exact verification counts, the co-author trailer, and honest job conclusions.
* Expected result: PR opens with `## In plain English`, Node 20, Node 24, and lint jobs pass, cancellations are distinguished from failures, the PR merges, and the merged commit and verification record are persisted.
* Detail section: P05-T02 in .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md

## Dependencies

* Current `main`: source, catalog, counts, and overlap evidence must be regenerated after concurrent work.
* Comic Book Herald WordPress source: current content and issue-bearing digests are required at authoring.
* Maintained Marvel metadata API: exact issue identity and live contract validation remain release gates.
* Existing CBH guard primitives: packet, mapping, report, approval, and generic authoring remain canonical and are not duplicated.
* Existing Hub and shelf model: Marvel on Screen is added only to the Hub category partition; three browse routes remain stable.

## Critique Disposition

| Critique run and finding | Disposition | Plan response or residual risk |
|---|---|---|
| PC-001 Hub publishing-age filter | Resolved, then superseded by integrated Hub | Four entries remain `timeline: null`; Marvel on Screen selects by type and publishing-age pages do not claim them. |
| PC-002 stale Hub tests | Resolved, then superseded by integrated Hub | The merged `home-categories` suite owns category availability, routing, counts, and empty-state behavior. |
| PC-003 featured pick drift | Resolved, then superseded by integrated Hub | Four entries remain `beginner: false`; the merged Hub retired the featured picker. |
| PC-004 refreshed count conflict | Resolved | Refreshed frozen packets take precedence; material boundary/count drift pauses authoring and amends plan/counts durably. |
| PC-005 comparison-count mismatch | Resolved | Release reports use current library plus three shipped peers; Research's fourth feasibility peer is explicitly excluded. |
| PC-006 reconciliation ambiguity | Resolved | Both reconciliations merge `origin/main`; rebase and force-push remain excluded; exit status and output are read. |
| PC-007 anchor preconditions | Resolved | New and ignored tracking files are indexed first; head search and hunk arithmetic are both required before bless and after conflicts. |
| PC-008 heading navigability ambiguity | Superseded by integrated category contract | Marvel on Screen is an explicit gateway button and generated child route, as the now-shipped shared category contract requires. |
| PC-009 record conventions | Resolved | Changes use CHG-xxx sections and the shipped backlog block records the eleven-constraint gate. |

## Follow-Up Items

* Priorities 5, 6, 7, 9, 10, and 14: distinct later mapping releases in user priority order.
* Priorities 8, 11, 12, and 13: re-enter Research only when explicit issue enumeration or approved exact collection mapping becomes available.

## Handoff

* Implementation artifact: .copilot-tracking/changes/2026-08-23/mcu-best-of-guides-changes.md
* Ready phase or task: P00 after critique disposition
* Remaining provisional question or blocker: None

### Candidate Lock for Critique

* Exact removals: none from this feature. The integrated Hub merge independently retired `home-grid` and `home-featured`; their replacement `home-categories` and publishing-category tests remain the current coverage owners.
* Maximum production additions: one MCU inventory adapter, one fourteen-record inventory, twelve CBH evidence JSON files, four order Markdown files, and four generated payloads. No new runtime dependency, route, rail item, shelf, or image asset.
* Canonical targets: inventory, packets, mappings, overlap reports, approvals, manifest entries, order Markdown, and source identities.
* Generated targets: four payload JSON files and the rebuilt catalog.
* Semantic test ownership: new `test/cbh-mcu-companion.test.js`; targeted additions to `test/catalog.test.js`, `test/curated.test.js`, `test/catalog-shelves.test.js`, and merged `test/home-categories.test.js`; one browser-check scenario covers gateway availability, child routing, source order, counts, and narrow layout.
* Regression ownership: all existing CBH modern/character, CBRO, catalog, path, count, size, palette, publication, anchor, privacy, copy, and browser tests.
* Validation evidence: targeted failure proof; lint; full tests; counts; sizes; palette; publication; source/card checks; anchors cycle; live metadata contract; dash scan; diff review; Edge desktop and narrow proof; one independent Review; Node 20, Node 24, and lint job conclusions; merged commit.
