<!-- markdownlint-disable-file -->
# RPI Plan: Historical event reading orders batch four

## Task Metadata

* Task ID: MRT-003-C02-B05
* Parent task: MRT-003-C02
* Task slug: historical-event-reading-orders-batch-four
* Planning status: Implementation ready
* Plan date: 2026-08-24
* Research input: .copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-four-research.md
* Phase details: .copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-24/historical-event-reading-orders-batch-four-plan-critique.md

## Executive Summary

This continuation will publish The Evolutionary War, Inferno, Atlantis Attacks, and Days of Future
Present as four complete Comic Book Reading Orders guides containing 71 exact issues. It begins at
the committed position-17 cursor, skips no eligible source identity, and uses the smallest permitted
four-guide batch.

Acts of Vengeance will not ship. Its 70-row source order is preserved, but Web of Spider-Man #62 and
#63 are absent from the configured metadata series. Days of Future Present will move from blocked to
selected because its formerly missing annual now resolves exactly. X-Tinction Agenda remains the
next cursor at position 22.

### User-visible result

Timeline gains four historical event guides from 1988 through 1990. Every card credits Comic Book
Reading Orders, links to the exact source page, and preserves the complete displayed issue order.
Existing saved progress and the 21 shipped historical guides remain unchanged.

### What may not be obvious

* This is task child B05 because B04 delivered the licensed tie-in exclusion decision, even though
  this is the fourth ordinary source-order batch.
* All six evaluated source-page digests changed while all 150 displayed issue rows stayed identical.
  Current digests must replace stale evidence before release.
* The exact 70-row Acts of Vengeance resolution is a locked canonical input, not only narrative
  research. A semantic check must preserve positions 1 through 70 and both exact gaps.
* The search endpoint could not find several rows that the configured series endpoints resolved
  exactly. Only full-series resolution is release authority.
* Agent Merge is explicitly authorized after the pull request exists and the sole Review is complete.

### Unresolved decisions or blockers

None for the selected four. Any source, catalog, metadata, or relationship change before authoring
requires regeneration. Any newly unresolved selected row blocks the release rather than shortening
it.

## User Decisions and Requirements

* Continue the canonical MRT-003-C02 lineage from merged PR 187 as child MRT-003-C02-B05.
* Start at The Evolutionary War, source position 17, and select the next eligible four-to-six guide
  batch without repeating shipped guides.
* Publish positions 17, 18, 19, and 21 as the earliest four eligible guides, containing 71 exact
  unique issues.
* Block all of Acts of Vengeance on exact source positions 63 and 64, Web of Spider-Man #62 and #63.
  Never omit those rows or invent metadata.
* Treat Days of Future Present's exact issue 12360 resolution as new gate-clearing evidence.
* Keep X-Tinction Agenda deferred as the next source cursor at position 22.
* Do not apply the B04 ROM, Micronauts, or Power Pack exclusions to any other guide.
* Keep the supplemental Comic Book Herald essential-trades candidates as future evidence only.
* Preserve source URLs, displayed positions, retrieval timestamps, current SHA-256 values, factual
  issue order, complete-library and selected-peer reports, chronology, central authority, and
  stale-evidence rejection.
* Run Research, Plan with exactly one final-candidate critique, Implement, exactly one Review, all
  repository and browser gates, commit, and pull-request publication.
* Invoke Agent Merge after the PR exists. It may resolve authorized review, CI, and conflict work but
  never runs a merge command; the app performs the merge once ready.

## Goals

* Publish four complete historical-event guides with exactly 71 unique exact issues.
* Preserve one blocked 70-row guide with both exact missing issue identities and no shipped subset.
* Clear one stale blocker only through exact current metadata and retain position 22 as the next cursor.
* Extend release and inventory authority without changing earlier release meaning or B04 exclusions.
* Deliver one reviewed pull request through the authorized Agent Merge readiness loop.

## Scope and Non-Goals

### In Scope

* Current source evidence for positions 17 through 22 and exact state transitions for all six records.
* Four packets, mappings, complete-library and peer reports, approvals, checklists, payloads, catalog
  cards, and chronology.
* One exact Acts of Vengeance blocker with all 70 source rows preserved in durable evidence.
* Tests, direct product and maintenance records, release gates, one Review, pull request, and Agent
  Merge readiness.

### Non-Goals

* Shipping Acts of Vengeance, X-Tinction Agenda, position 23 or later, or any supplemental
  essential-trades candidate.
* Adding a new exclusion, placeholder, availability state, metadata fallback, or inferred issue.
* Reauthoring the 21 shipped historical guides or changing saved progress.
* Copying source prose, branding, layout, images, or comic image bytes.
* Adding runtime dependencies or changing local-first, origin, launch, or persistence behavior.

## Functional Requirements

* Add one known B05 release with source and author IDs `evolutionary-war`, `inferno`,
  `atlantis-attacks`, and `days-of-future-present`.
* Update positions 17 through 22 atomically with current retrieval dates and digests. Promote 17, 18,
  19, and 21; block 20 with both exact missing rows; leave 22 deferred.
* Preserve all 70 Acts of Vengeance source rows from the canonical resolution in displayed positions
  1 through 70 and assert that only positions 63 and 64 remain unresolved.
* Preserve predecessor releases through a normalized B04 outcome invariant and add a distinct B05
  untouched-inventory invariant for all records outside positions 17 through 22.
* Freeze exactly four complete packets containing 71 rows and no structured source exclusions.
* Resolve all 71 rows to positive configured issue IDs, canonical Marvel URLs, reviewed series
  identities, and on-sale dates in source order.
* Generate four reports against all 117 current lists and the other three selected peers. The
  research baseline is 120 comparisons per guide and 480 total, all `none`.
* Author four complete guides in verified first-on-sale chronology and insert them before Maximum
  Security without moving earlier historical cards.
* Generate four exact payloads with zero placeholders and zero unresolved rows.
* Leave Acts of Vengeance without packet, mapping, report, checklist, payload, or catalog card.
* Keep X-Tinction Agenda without product artifacts and as the next deferred cursor.
* Replace the obsolete shared `complete 5-guide release` rejection with `complete known release` while
  retaining exact known-release matching for every batch.

## Non-Functional Requirements

* Runtime dependencies remain zero.
* Existing MRT-003 through MRT-003-C02-B04 packets, releases, exclusions, relationships, inventory
  meaning, and generated product outputs remain compatible.
* Packet, mapping, library, peer, report, approval, chronology, inventory, and release digests remain
  deterministic and stale evidence fails.
* Build-time writes remain atomic and retain the existing recovery behavior.
* Product prose contains no em dash or en dash.
* Source access remains normal public access with the established five-second page delay.
* Agent Merge receives no authority to execute a merge command.

## Acceptance Criteria

* Four cards and 71 unique exact issues ship with zero placeholder or unresolved rows.
* Source positions 17, 18, 19, and 21 preserve 11, 39, 17, and 4 rows respectively in displayed order.
* Acts of Vengeance remains wholly blocked and names source positions 63 and 64, Web of Spider-Man #62
  and #63, as its only unresolved rows. Its canonical evidence retains all 70 source positions and
  exact labels, and no production artifact represents a partial guide.
* Days of Future Present records exact issue 12360 and reviewed source-to-series alias evidence.
* X-Tinction Agenda remains deferred at position 22 and has no packet or product output.
* Final inventory counts are 25 selected, 28 deferred, one deferred subset, two blocked, one absorbed,
  and one provenance-blocked; delivery counts are 25 shipped, 29 deferred, three blocked, and one
  not-applicable.
* Final reports cover the complete execution-time library plus three selected peers and contain no
  non-none relationship. Research baseline counts are rederived after the last catalog reconciliation.
* The selected author order is The Evolutionary War, Inferno, Atlantis Attacks, and Days of Future
  Present.
* Existing releases and the exact 31-row B04 exclusion authority remain accepted unchanged.
* `test/cbro-historical-events.test.js` owns the new semantic contract with at most four added test
  cases and no removed test.
* One smallest reversible implementation mutation makes a new focused test fail, then restoration
  returns the focused suite to green.
* Lint, bare tests, counts, sizes, palette, anchors, publication, added-line dash scan, live metadata
  contract, installed Edge at 1280 by 900, and a focused four-guide sequence check pass.
* Any post-Review or Agent Merge tree edit reruns the affected focused gates. Any readiness-loop tree
  change also reruns the complete final local gate set and hosted checks before readiness is accepted.
* Exactly one final-candidate plan critique and one post-implementation Review are recorded.
* One commit carries the required trailer, one non-draft PR opens with `## In plain English`, and
  Agent Merge completes its readiness loop without the agent running a merge command.

## Canonical and Generated Targets

### Canonical inputs and authority

* `scripts/lib/cbro-evidence.mjs`
* `scripts/data/cbro-historical-inventory.json`
* `scripts/prepare-cbro-event.mjs`
* `scripts/author-cbro-packet.mjs`
* Four new `scripts/data/cbro-packets/<id>.json` files
* `.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-four-scan.json`
* `.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-four-resolution.json`

### Generated or derived outputs

* Four new `scripts/data/cbro-mappings/<id>.json` files
* Four new `scripts/data/cbro-overlaps/<id>.json` files
* Four new `src/data/orders/<id>.md` files
* Four new `src/data/<id-with-underscores>.json` payloads
* `src/data/curated-lists.json`
* `src/data/catalog.json`

### Directly related records

* `test/cbro-historical-events.test.js`
* `CHANGELOG.md`
* `PRODUCT_BACKLOG.md`
* `docs/DATA_PROVENANCE.md`
* `docs/MAINTAINING.md`
* `docs/PUBLICATION_RUNBOOK.md`
* `docs/anchors.lock.json`
* Canonical MRT-003-C02-B05 research, plan, critique, details, changes, and Review artifacts

## Test Ownership and Validation Evidence

| Owner | Target | Maximum additions | Purpose |
|---|---|---:|---|
| P01-T02 | `test/cbro-historical-events.test.js` | 1 case | B05 release, six exact inventory transitions, all 70 Acts rows, predecessor compatibility, next cursor, and blocker authority |
| P02-T03 | Same file | 2 cases | Four packets and mappings with 71 exact rows; 480 complete all-none comparisons and stale rejection |
| P03-T03 | Same file | 1 case | Four chronological cards, payloads, catalog counts, provenance, and final inventory totals |

No semantic test is removed. Shared packet, catalog, generated-data, publication, and browser suites
remain regression coverage. Focused browser evidence is recorded outside the repository and does not
add a browser dependency.

## Dependencies and Risks

* P02 depends on current source digests and P01 release and inventory authority.
* P03 depends on all four exact mappings, current reports, and all-none approval.
* P04 depends on complete product and record integration.
* P05 depends on P04 validation and the sole Review disposition.
* A source or catalog change invalidates dependent packet, mapping, report, approval, authoring, and
  release evidence.
* The Days of Future Present alias must be explicit. Treating an empty search result as a blocker
  would restore a stale false negative.
* Acts of Vengeance has 68 resolvable rows, which makes accidental partial publication especially
  plausible. Tests must prove the whole guide remains absent.
* Current source digests changed without displayed-row changes. Digest refresh and row conservation
  must both be checked rather than treating either as a substitute for the other.
* Pre-Review green results are stale after any Review or readiness-loop edit. Final readiness depends
  on rerunning the gates that own every changed surface.

## Phase Checklist

<!-- rpi:phase id=P01 -->
### [x] P01: Establish B05 source, release, inventory, and compatibility authority

* Status: Complete
* Intent: Bind the selected four, the exact Acts blocker, the cleared Days blocker, the refreshed
  six-page evidence, and predecessor compatibility before generated evidence exists.
* Dependencies: Completed batch-four research and current merged PR 187 baseline.

<!-- rpi:task id=P01-T01 -->
#### [x] P01-T01: Add the known B05 release and atomic six-record transition

* Status: Complete
* Requirement and evidence: The release uses four IDs while positions 17 through 22 require exact
  selected, blocked, or deferred outcomes with current source evidence.
* Expected result: One release, one packet-review identity, exact source and author order, truthful
  complete-known-release rejection, four selected records, one blocked record, one deferred cursor,
  and no changed unrelated record.
* Detail section: P01-T01 in `.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md`

<!-- rpi:task id=P01-T02 -->
#### [x] P01-T02: Lock predecessor, blocker, and untouched inventory invariants

* Status: Complete
* Requirement and evidence: B04 meaning must remain measurable after six current records change.
* Expected result: A normalized B04 outcome guard, exact B05 blocker and cursor authority, a B05
  untouched digest, all 70 preserved Acts source positions, and one focused semantic test.
* Detail section: P01-T02 in `.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md`

<!-- rpi:phase id=P02 -->
### [x] P02: Freeze, map, compare, and approve four guides

* Status: Complete
* Intent: Turn the current research evidence into production packet, mapping, report, and approval
  contracts without creating any artifact for the blocked guide.
* Dependencies: P01 complete.

<!-- rpi:task id=P02-T01 -->
#### [x] P02-T01: Freeze four complete current-source packets

* Status: Complete
* Requirement and evidence: All 71 selected rows and current source digests are exact.
* Expected result: Four packets with no source-row exclusions, reviewed series aliases, complete
  manifests, and deterministic packet digests.
* Detail section: P02-T01 in `.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md`

<!-- rpi:task id=P02-T02 -->
#### [x] P02-T02: Resolve exact metadata and regenerate complete relationships

* Status: Complete
* Requirement and evidence: Every selected row must resolve and every execution-time current and peer
  relationship must be present.
* Expected result: Four exact mappings, four complete reports, 71 unique issue IDs, and no
  unauthorized non-none relationship.
* Detail section: P02-T02 in `.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md`

<!-- rpi:task id=P02-T03 -->
#### [x] P02-T03: Approve the all-none release and test stale rejection

* Status: Complete
* Requirement and evidence: Approval must bind current packet, mapping, library, peer, and report
  digests and the B05 review identity.
* Expected result: Four approved mappings and reports, two focused semantic cases, and rejection of
  stale or incomplete evidence.
* Detail section: P02-T03 in `.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md`

<!-- rpi:phase id=P03 -->
### [x] P03: Author and integrate four complete guides

* Status: Complete
* Intent: Publish exact source-backed checklists and generated payloads while retaining the blocked
  and deferred boundaries.
* Dependencies: P02 complete.

<!-- rpi:task id=P03-T01 -->
#### [x] P03-T01: Author four checklists and catalog definitions

* Status: Complete
* Requirement and evidence: The reviewed source order and first-on-sale chronology are complete.
* Expected result: Four complete checklists and manifest entries in verified chronology with exact
  source links and attribution.
* Detail section: P03-T01 in `.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md`

<!-- rpi:task id=P03-T02 -->
#### [x] P03-T02: Vendor payloads and regenerate catalog state

* Status: Complete
* Requirement and evidence: Generated product data must contain all 71 exact issues and no blocked row.
* Expected result: Four payloads, a 121-list catalog, zero placeholders, zero unresolved rows, and no
  Acts or X-Tinction Agenda product identity.
* Detail section: P03-T02 in `.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md`

<!-- rpi:task id=P03-T03 -->
#### [x] P03-T03: Reconcile tests and direct product records

* Status: Complete
* Requirement and evidence: Product, maintenance, backlog, changelog, provenance, and publication
  records must agree with final generated counts and the next cursor.
* Expected result: One authored-output semantic case and current records with rederived counts.
* Detail section: P03-T03 in `.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md`

<!-- rpi:phase id=P04 -->
### [x] P04: Prove the final implementation

* Status: Complete
* Intent: Demonstrate semantic failure without the matching authority and run the complete gate set.
* Dependencies: P03 complete.

<!-- rpi:task id=P04-T01 -->
#### [x] P04-T01: Prove focused semantic failure and restoration

* Status: Complete
* Requirement and evidence: At least one new test must be observed failing under the smallest matching
  reversible implementation mutation.
* Expected result: A targeted failure without B05 authority and a green focused suite after restoration.
* Detail section: P04-T01 in `.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md`

<!-- rpi:task id=P04-T02 -->
#### [x] P04-T02: Run repository, live contract, and installed Edge gates

* Status: Complete
* Requirement and evidence: All deterministic, external-contract, and real-browser checks must assess
  the final reconciled tree.
* Expected result: All required gates pass, including four cards and exact rendered sequences at
  1280 by 900.
* Detail section: P04-T02 in `.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md`

<!-- rpi:phase id=P05 -->
### [ ] P05: Review and deliver through Agent Merge

* Status: In progress
* Intent: Run the sole Review, resolve its routed in-scope findings once, publish the PR, and use the
  authorized readiness loop.
* Dependencies: P04 complete.

<!-- rpi:task id=P05-T01 -->
#### [x] P05-T01: Run exactly one post-implementation Review

* Status: Complete
* Requirement and evidence: Review must assess source conservation, the Acts blocker, the cleared Days
  blocker, generated evidence, reader output, compatibility, recovery behavior, and delivery readiness.
* Expected result: One canonical Review, material in-scope findings fixed without another Review,
  affected gates rerun after every fix, and unrelated work routed.
* Detail section: P05-T01 in `.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md`

<!-- rpi:task id=P05-T02 -->
#### [ ] P05-T02: Commit, open the PR, and invoke Agent Merge

* Status: In progress
* Requirement and evidence: Delivery requires the co-author trailer, plain-English lead, exact
  validation evidence, and explicit Agent Merge readiness ownership.
* Expected result: One initial commit, one non-draft PR, hosted checks and review addressed through
  Agent Merge, every readiness-loop edit revalidated, and app-performed merge when ready.
* Detail section: P05-T02 in `.copilot-tracking/details/2026-08-24/historical-event-reading-orders-batch-four-phase-details.md`

## Critique Disposition

Exactly one final-candidate critique completed with a Revise verdict. All three findings are
planner-owned and resolved below. No second critique will run.

| Finding | Disposition | Resolving evidence |
|---|---|---|
| PC-001 | Applied | Canonical targets now lock the resolution JSON; P01-T02 and its one semantic case require all 70 Acts positions, exact labels, two gaps, and product absence. |
| PC-002 | Applied | P01-T01 now changes the false five-guide rejection to complete known release and updates every owning assertion without weakening release matching. |
| PC-003 | Applied | Acceptance, P05-T01, and P05-T02 now require revalidation after Review and readiness-loop edits before readiness. |

## Follow-Up Items

* Acts of Vengeance remains metadata-blocked until exact configured metadata exists for Web of
  Spider-Man #62 and #63. The B04 exclusion decision is not a clearing path.
* X-Tinction Agenda at source position 22 is the next historical source-order cursor after this batch.
* Supplemental essential-trades candidates remain separate future evidence.

## Handoff

* Implementation artifact: `.copilot-tracking/changes/2026-08-24/historical-event-reading-orders-batch-four-changes.md`
* Ready phase or task: P01-T01
* Remaining provisional question or blocker: None
