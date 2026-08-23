<!-- markdownlint-disable-file -->
# RPI Phase Details: Historical event reading orders

## Metadata

* Task ID: MRT-003
* Task slug: historical-event-reading-orders
* Related plan: .copilot-tracking/plans/2026-08-23/historical-event-reading-orders-plan.md
* Evidence sources: .copilot-tracking/research/2026-08-23/historical-event-reading-orders-research.md

## Initial Phase Direction

The first implementation phase must refresh current main and all selected source evidence before any
product authoring. The second must establish the smallest provider-safe CBRO adapter that preserves
existing CBH behavior. Later phases freeze and map exactly five events, centralize relationship and
chronology approval, author and vendor the guides, update directly related records, then execute the
full release gates.

## Task-Level Context

Research selected five dedicated event pages containing 23 exact issue rows. Each provisional report
covered 89 shipped lists and four selected peers, for 93 none relationships. Those reports are not
release authority because concurrent cosmic work can change the catalog. Source content, library,
peer, report, and approval digests must therefore be regenerated in implementation order.

## Boundaries

* Included: five selected event guides, one maintained 58-entry inventory, provider-safe evidence
  tooling, tests, directly related product records, one Review, PR, CI, and merge.
* Excluded: every additional event, runtime UI changes, source prose or images, runtime dependencies,
  broad CBH renaming, and delegated central authority.

## Initial Dependencies

* Current main and selected source pages must be current.
* Existing CBH tests define backward compatibility.
* Exact source rows and selected issue IDs are fixed by research unless refreshed evidence disproves
  them.

## Initial Validation Expectations

* Focused semantic tests prove provider identity, canonical source digest, exact mapping, library and
  peer binding, stale evidence, authority, chronology, and duplicate checks.
* New tests are observed failing without the implementation.
* Full local gates, live contract, installed Edge checks, one Review, and hosted CI pass.

## Initial Unresolved Items

* None. The one critique is complete and all findings are resolved.

## Phase Index

| Phase ID | Name | Status | Detail sections |
|---|---|---|---|
| P01 | Refresh evidence and establish provider seam | Ready after critique | P01, P01-T01 through P01-T03 |
| P02 | Freeze, map, and approve five events | Blocked by P01 | P02, P02-T01 through P02-T04 |
| P03 | Author, vendor, and integrate guides | Blocked by P02 | P03, P03-T01 through P03-T03 |
| P04 | Reconcile product and maintenance records | Blocked by P03 | P04, P04-T01 through P04-T03 |
| P05 | Validate implementation and prepare Review | Blocked by P04 | P05, P05-T01 through P05-T03 |
| P06 | Execute one independent Review | Blocked by P05 | P06, P06-T01 through P06-T02 |
| P07 | Publish, monitor CI, merge, persist | Blocked by P06 | P07, P07-T01 through P07-T03 |

<!-- rpi:phase id=P01 -->
## P01: Refresh evidence and establish the provider seam

### Context

Research evidence is complete but intentionally provisional at 89 shipped lists. Current packet
validation, manifest origin checks, authoring trail text, command names, and data paths are CBH-bound.
Canonical digest, resolver, overlap, authority, chronology, and vendoring behavior can be reused.

### Intent

Start implementation from current source and library boundaries, then create a narrow explicit CBRO
provider path without broad renaming or duplicate policy.

### Boundaries

* Included: current-main reconciliation, five page digests, provider identity, optional CBRO packet
  fields, digest binding, backward-compatible validation, focused semantic tests.
* Excluded: product authoring, broad CBH path migration, runtime changes.

### Likely Targets

* `scripts/lib/cbh-inventory.mjs`: allow provider-aware optional fields without changing legacy digest
  results.
* `scripts/author-cbh-packet.mjs`: expose source-neutral approval validation options while keeping CBH
  defaults.
* `scripts/lib/cbro-evidence.mjs`: own CBRO provider, host, origin, digest, and packet requirements.
* `test/cbro-historical-events.test.js`: focused provider and freshness behavior.

### Dependencies

* Completed research and current remote main.

### Validation Expectations

* Existing CBH packet and approval tests remain unchanged and pass.
* Wrong provider, host, source origin, or source digest fails before mapping.

### Completion Evidence

* Current main and source digests recorded in the changes record.
* Focused provider and backward-compatibility tests pass.

### Unresolved Items

* None. A changed source digest re-enters central source review inside P01 rather than weakening scope.

<!-- rpi:task id=P01-T01 -->
### P01-T01: Reconcile current main and source snapshots

#### Context

Concurrent cosmic guide work can change manifest identities, payloads, counts, and the library digest.
The source is live and must be re-fetched under its five-second delay.

#### Intent

Produce the exact implementation baseline before any canonical packet or approval is written.

#### Boundaries

* Included: fetch remote refs, integrate current main without destructive commands, recompute library
  digest and list count, re-fetch five pages and compare SHA-256.
* Excluded: accepting source changes without reading them or preserving stale relationship evidence.

#### Likely Targets

* All supplied research Markdown, JSON, and research scripts are immutable baseline inputs.
* Refreshed facts are written only to the implementation-owned CBRO inventory, packets, mappings,
  reports, approvals, and implementation changes record.
* `src/data/curated-lists.json` and current generated payloads are read-only baseline inputs until
  approved authoring begins.

#### Dependencies

* None beyond repository access and normal source access.

#### Validation Expectations

* Source rows, counts, canonical URLs, and digests are identical or explicitly re-reviewed.
* Library digest is current and later reports use it.

#### Completion Evidence

* Changes record names main commit, list count, library digest, five source digests, and any reissued
  source decision.

#### Unresolved Items

* Source or main divergence that changes selected rows is a genuine blocker until centrally resolved.

<!-- rpi:task id=P01-T02 -->
### P01-T02: Add provider-aware evidence validation

#### Context

The current validator rejects non-CBH hosts and origins, while the caller forbids relabeling CBRO
evidence as CBH.

#### Intent

Make provider identity explicit at the narrow validation boundary.

#### Boundaries

* Included: provider id, allowed host, source origin, source-content SHA-256, packet field allowance,
  mapping digest binding, default CBH behavior.
* Excluded: moving old CBH files or changing their approved digests.

#### Likely Targets

* `scripts/lib/cbh-inventory.mjs`
* `scripts/author-cbh-packet.mjs`
* `scripts/lib/cbro-evidence.mjs`

#### Dependencies

* P01-T01.

#### Validation Expectations

* Old packets validate through the unchanged default.
* CBRO packets require explicit CBRO identity and exact page digest.

#### Completion Evidence

* Provider-focused tests and all existing CBH focused tests pass.

#### Unresolved Items

* None.

<!-- rpi:task id=P01-T03 -->
### P01-T03: Lock semantic provider and freshness checks

#### Context

Source digest, mapping digest, report digest, library digest, peer digests, and approval digest form one
ordered authority chain.

#### Intent

Ensure a stale or cross-provider artifact cannot reach authoring.

#### Boundaries

* Included: direct mutations of every bound input in tests and legacy CBH compatibility.
* Excluded: broad snapshot tests that pass without proving the named contract.

#### Likely Targets

* `test/cbro-historical-events.test.js`
* Existing CBH and overlap tests only when source-neutral exports require coverage.

#### Dependencies

* P01-T02.

#### Validation Expectations

* Each named mutation fails for the intended reason.

#### Completion Evidence

* Focused test names map one-to-one to provider and freshness requirements.
* New-case allocation in the one CBRO test file:
  1. CBRO provider identity, host, and origin validation.
  2. Canonical source-content digest validation and stale-source rejection.
  3. Mapping digest binding to provider and source-content identity.
  4. Existing CBH packet and digest backward compatibility.
  5. Stale packet, mapping, report, library, peer, and approval rejection.
  6. Central approval authority for none, subset, and partial relationships.
* Existing CBH and overlap tests remain regression coverage and are not counted as new cases.

#### Unresolved Items

* None.

<!-- rpi:phase id=P02 -->
## P02: Freeze, map, and centrally approve the five events

### Context

The full source inventory and exact selected issue IDs exist in research, but implementation needs
maintained provider artifacts generated against current main and current page digests.

### Intent

Produce canonical source packets, worker-bounded exact mappings, complete reports, and central
approval for exactly five events.

### Boundaries

* Included: 58-entry inventory, five packets, mappings, reports, all current orders, four peers,
  source and relationship review.
* Excluded: authoring product files, mapping any later event, delegating approval.

### Likely Targets

* `scripts/data/cbro-historical-inventory.json`
* `scripts/data/cbro-packets/*.json`
* `scripts/data/cbro-mappings/*.json`
* `scripts/data/cbro-overlaps/*.json`
* `scripts/prepare-cbro-event.mjs`

### Dependencies

* P01.

### Validation Expectations

* Inventory count is 58 and excludes Maximum Security.
* Five packets and mappings contain 23 exact unique rows.
* Each report covers current library plus four peers.

### Completion Evidence

* Canonical digests and central approvals validate from the final files.

### Unresolved Items

* Any non-none relationship caused by refreshed main requires central disposition before P03.

<!-- rpi:task id=P02-T01 -->
### P02-T01: Persist the complete historical inventory

#### Context

Research ranked every pre-cutoff entry and recorded mapping-deferred, subset, blocked, absorbed, and
provenance states.

#### Intent

Give later work one maintained provider inventory without widening this release.

#### Boundaries

* Included: 58 positions, titles, URLs or visible timeline sections, source forms, row counts, digests,
  dispositions, blockers, selected ids, and delivery status.
* Excluded: Maximum Security, later events, invented issue rows, or converting preliminary overlap
  into final approval.

#### Likely Targets

* `scripts/data/cbro-historical-inventory.json`
* Focused inventory schema tests.

#### Dependencies

* P01-T01.

#### Validation Expectations

* Positions are exactly 1 through 58 and every state agrees with research.

#### Completion Evidence

* Inventory semantic test accounts for every record and named exception.

#### Unresolved Items

* None.

<!-- rpi:task id=P02-T02 -->
### P02-T02: Freeze five reviewed CBRO packets

#### Context

Packets are the central source authority and must bind provider, page bytes, rows, exclusions,
manifest proposal, chronology anchor, and source review.

#### Intent

Make each lower-cost mapping task immutable and one-event wide.

#### Boundaries

* Included: five exact source pages, 23 rows, approved title aliases, project summaries, exact source
  URLs, source-origin text, null licences, first-on-sale insertion anchors.
* Excluded: mapper-written manifest or source decisions.

#### Likely Targets

* `scripts/data/cbro-packets/muir-island-saga.json`
* `scripts/data/cbro-packets/bloodties.json`
* `scripts/data/cbro-packets/midnight-massacre.json`
* `scripts/data/cbro-packets/childs-play.json`
* `scripts/data/cbro-packets/eighth-day.json`

#### Dependencies

* P02-T01.

#### Validation Expectations

* Packet digests change on any source, row, manifest, chronology, or review change.

#### Completion Evidence

* Five packets pass provider and source-review validation.

#### Unresolved Items

* None unless a refreshed source digest changed.

<!-- rpi:task id=P02-T03 -->
### P02-T03: Produce exact one-event mappings

#### Context

Research identifies all 23 issue IDs. Some source titles require centrally approved aliases to Marvel
metadata titles.

#### Intent

Use one mapping output per frozen packet and stop on every ambiguity.

#### Boundaries

* Included: exact candidate metadata, source order, manual title-selection flags and notes already
  approved by the packet owner.
* Excluded: packet edits, source omissions, relationship disposition, product files.

#### Likely Targets

* Five files under `scripts/data/cbro-mappings/`.

#### Dependencies

* P02-T02.

#### Validation Expectations

* All rows resolve exact, issue numbers agree, Marvel detail URLs are canonical, and selected IDs are
  unique within and across peers.

#### Completion Evidence

* Resolver and duplicate tests pass for each mapping.

#### Unresolved Items

* A mapping mismatch blocks the whole fixed five-event MRT-003 release until centrally resolved. No
  selected list is shortened, omitted, or substituted.

<!-- rpi:task id=P02-T04 -->
### P02-T04: Regenerate reports and central approvals

#### Context

Reports must bind the complete execution-time library and all selected peers. Lower-cost workers have
no approval authority.

#### Intent

Make factual relationships and central policy explicit before authoring.

#### Boundaries

* Included: five complete reports, exact relationship classification, one disposition per comparison,
  central authority identity and rationale, approval digest.
* Excluded: approving exact duplicates or policy-only subset and partial decisions.

#### Likely Targets

* Five files under `scripts/data/cbro-overlaps/`.
* Relationship review blocks in five mapping files.

#### Dependencies

* P02-T03 and the current library baseline.

#### Validation Expectations

* Comparison count equals current shipped lists plus four peers.
* Every report, mapping, packet, library, peer, and approval digest is current.

#### Completion Evidence

* Central approval validation passes for all five. Any unresolved selected relationship blocks the
  whole release.

#### Unresolved Items

* New non-none relationships are coordinator decisions.

<!-- rpi:phase id=P03 -->
## P03: Author, vendor, and integrate the event guides

### Context

Only approved evidence may create product data. Existing vendoring already produces offline metadata,
cover URLs, catalog counts, and chronology behavior without runtime dependencies.

### Intent

Create five normal event guides and generated payloads with CBRO attribution and exact approved rows.

### Boundaries

* Included: CBRO authoring entry point, five Markdown orders, five manifest entries, vendoring, catalog
  regeneration, focused product semantics.
* Excluded: source prose, images, later events, UI code, placeholder rows.

### Likely Targets

* `scripts/author-cbro-packet.mjs`
* `src/data/orders/*.md`
* `src/data/curated-lists.json`
* `src/data/*.json`
* `src/data/catalog.json`

### Dependencies

* P02.

### Validation Expectations

* Five cards, 23 issues, zero unresolved and placeholders, exact source links and CBRO origin.
* Shelf order follows first on-sale chronology.

### Completion Evidence

* Focused generated-surface tests and count checks pass.

### Unresolved Items

* None after P02 approvals.

<!-- rpi:task id=P03-T01 -->
### P03-T01: Author CBRO checklists and manifest entries

#### Context

Current CBH authoring text and origin are provider-specific and cannot be reused as output.

#### Intent

Generate project-authored CBRO trails and approved manifest entries from current evidence.

#### Boundaries

* Included: exact source credit, exact page link, no copied commentary, five original descriptions,
  character and keyword metadata, type `event`.
* Excluded: CBH wording, source licence claims, source images, unapproved grouping.

#### Likely Targets

* `scripts/author-cbro-packet.mjs`
* Five `src/data/orders/*.md` files.
* `src/data/curated-lists.json`

#### Dependencies

* P02-T04.

#### Validation Expectations

* Authoring validates all five before writing any product file.

#### Completion Evidence

* Markdown and manifest exactly match approved mappings and proposals.

#### Unresolved Items

* None.

<!-- rpi:task id=P03-T02 -->
### P03-T02: Vendor exact payloads and shelf chronology

#### Context

The app consumes committed JSON and catalog data. Chronology is first on-sale, not source position.

#### Intent

Produce offline exact payloads and the correct event-shelf placement.

#### Boundaries

* Included: targeted vendoring, catalog regeneration, cover URLs from metadata, five expected counts.
* Excluded: re-vendoring unrelated orders or storing image bytes.

#### Likely Targets

* Five payload JSON files.
* `src/data/catalog.json`

#### Dependencies

* P03-T01.

#### Validation Expectations

* Muir Island Saga, Midnight Massacre, Bloodties, Child's Play, Eighth Day shelf in first-on-sale
  order.

#### Completion Evidence

* Payload and catalog tests verify exact ids, issue numbers, counts, first and last rows, and chronology.

#### Unresolved Items

* None.

<!-- rpi:task id=P03-T03 -->
### P03-T03: Lock product and duplicate semantics

#### Context

The release must prove provider identity and exact evidence through every generated surface.

#### Intent

Prevent drift between canonical files and what readers import.

#### Boundaries

* Included: tests for inventory, packet, mapping, report, Markdown, payload, catalog, attribution,
  filters, shelf, counts, and batch duplicate checks.
* Excluded: unrelated UI test expansion.

#### Likely Targets

* `test/cbro-historical-events.test.js`
* Existing catalog tests only if a current helper needs direct coverage.

#### Dependencies

* P03-T02.

#### Validation Expectations

* A sixth CBRO catalog id, changed sequence, stale report, wrong origin, or duplicate peer fails.

#### Completion Evidence

* Focused semantic suite passes with no unsupported snapshot assertions.
* New-case allocation in the one CBRO test file:
  7. Complete 58-entry inventory, exclusive cutoff, selected and blocked states.
  8. Five packets preserve provider, source digest, exact rows, exclusions, and packet digests.
  9. Five mappings preserve 23 exact unique metadata identities and reviewed aliases.
  10. Five reports bind the complete library, four peers, current digests, and central approvals.
  11. Five authored Markdown files preserve exact sequence and CBRO attribution without source prose.
  12. Five payload and catalog surfaces preserve exact sequence, counts, source, and event type.
  13. Source order and independently verified first-on-sale shelf chronology remain distinct.
  14. Current-library and selected-peer duplicate guards reject exact identity and sequence duplicates.
* Together P01-T03 and P03-T03 own exactly 14 new semantic cases in one new test file. Existing tests
  remain regression coverage and do not duplicate new-case ownership.

#### Unresolved Items

* None.

<!-- rpi:phase id=P04 -->
## P04: Reconcile product and maintenance records

### Context

The repository requires product-visible work, infrastructure, and directly related maintenance
contracts to be recorded in the same change.

### Intent

Make product records, source boundaries, maintainer workflow, and evidence anchors agree with the
five-guide release.

### Boundaries

* Included: backlog, changelog, counts, provenance, maintenance, publication, changes record, anchors.
* Excluded: unrelated documentation cleanup or record-only follow-up work.

### Likely Targets

* `PRODUCT_BACKLOG.md`
* `CHANGELOG.md`
* `docs/DATA_PROVENANCE.md`
* `docs/MAINTAINING.md`
* `docs/PUBLICATION_RUNBOOK.md`
* `.copilot-tracking/changes/2026-08-23/historical-event-reading-orders-changes.md`
* `docs/anchors.lock.json`

### Dependencies

* P03.

### Validation Expectations

* Every touched count is re-derived.
* Anchor cycle ends 0 drifted, 0 new, and 0 removed.

### Completion Evidence

* Product and maintenance records match final generated data and gates.

### Unresolved Items

* None.

<!-- rpi:task id=P04-T01 -->
### P04-T01: Update backlog, changelog, and counts

#### Context

Five user-visible cards and a provider workflow are product and maintainer changes.

#### Intent

Record the shipped outcome and preserve later historical work as follow-up, not active scope.

#### Boundaries

* Included: one backlog delivery block, Unreleased entry, all counts in touched sections.
* Excluded: changing unrelated backlog statuses or inventing results for later chunks.

#### Likely Targets

* `PRODUCT_BACKLOG.md`
* `CHANGELOG.md`
* Count expectations in tests or scripts that deliberately bind catalog size.

#### Dependencies

* Final P03 data.

#### Validation Expectations

* Catalog and provenance counts are recomputed, not incremented from memory.

#### Completion Evidence

* Count gate and product records agree.

#### Unresolved Items

* None.

<!-- rpi:task id=P04-T02 -->
### P04-T02: Update provenance, maintenance, and publication guidance

#### Context

CBRO has explicit permission conditions and separate evidence paths. Future maintainers need exact
refresh, mapping, report, approval, authoring, and release commands.

#### Intent

Document the new provider without weakening or mislabeling CBH.

#### Boundaries

* Included: provider identity, permission exclusions, null licence boundary, no source prose or images,
  exact page links, source delay, central authority, five-list result.
* Excluded: legal conclusions or broader source grants.

#### Likely Targets

* `docs/DATA_PROVENANCE.md`
* `docs/MAINTAINING.md`
* `docs/PUBLICATION_RUNBOOK.md`

#### Dependencies

* P04-T01 counts.

#### Validation Expectations

* Publication surface lists every source origin and keeps images as URLs only.

#### Completion Evidence

* Documentation and publication checks pass.

#### Unresolved Items

* None.

<!-- rpi:task id=P04-T03 -->
### P04-T03: Maintain changes and anchor evidence

#### Context

Tracking evidence records planned closures and deviations. Current citations move when source code or
documents change.

#### Intent

Persist implementation facts and maintain claim-to-line accuracy without rewriting historical
artifacts for cosmetic reasons.

#### Boundaries

* Included: CHG entries, re-aiming current citations, dual derivation by head and diff arithmetic,
  read-before-bless.
* Excluded: new line-number claims in dated artifacts where stable headings suffice, or blessing
  unread changes.

#### Likely Targets

* Changes record.
* Current product documents and `docs/anchors.lock.json`.

#### Dependencies

* All P04 content edits.

#### Validation Expectations

* New tracked files are staged before anchor scan.
* Bless output is read per citation and clean rerun is exact.

#### Completion Evidence

* Changes record and clean anchor report.

#### Unresolved Items

* None.

<!-- rpi:phase id=P05 -->
## P05: Validate implementation and prepare Review

### Context

The repository release gates include source-independent tests and a live metadata contract. Browser
verification must run in installed Edge with an explicit 1280x900 viewport.

### Intent

Prove both positive behavior and failure sensitivity before the one independent Review.

### Boundaries

* Included: focused failure proof, all local gates including sizes and palette, contract, dash and diff
  review, browser cards and sampled sequence, final main and source refresh.
* Excluded: repeated Review or unrelated fixes.

### Likely Targets

* Existing npm scripts and the checked-in browser harness, extended only where needed for five cards.
* Changes record validation evidence.

### Dependencies

* P04.

### Validation Expectations

* All named checks pass from the final reconciled tree.

### Completion Evidence

* Exact command and result counts for all seven deterministic local gates are persisted for PR use.

### Unresolved Items

* Hosted CI belongs to P07.

<!-- rpi:task id=P05-T01 -->
### P05-T01: Prove focused checks detect the missing implementation

#### Context

New tests must be observed failing without the behavior they claim to guard.

#### Intent

Demonstrate failure sensitivity with the smallest safe reversible change.

#### Boundaries

* Included: path-scoped stash or smallest one-line revert per new semantic case, focused test command,
  restoration.
* Excluded: destructive checkout or whole-module reversion when one field proves the contract.

#### Likely Targets

* Focused CBRO semantic test and one canonical provider or catalog field.

#### Dependencies

* P03-T03.

#### Validation Expectations

* Every one of the 14 new semantic cases is observed failing for its intended contract. Shared minimal
  reverts may prove multiple cases only when each named failure is present.

#### Completion Evidence

* Changes record captures each named new case, the minimal reversible change, intended failure, and
  restored pass.

#### Unresolved Items

* None.

<!-- rpi:task id=P05-T02 -->
### P05-T02: Run all local and browser gates

#### Context

Repository and caller gates are cumulative and must run against staged new tracking files for anchors.

#### Intent

Produce release-quality local evidence.

#### Boundaries

* Included: focused tests, full tests, lint, counts, sizes, palette, publication, anchor cycle, dash
  scan, diff review, live contract, installed Edge 1280x900 card and sequence checks.
* Excluded: adding dependencies for browser automation.

#### Likely Targets

* Existing scripts and browser harness.
* Scratch Puppeteer installation outside the repository when needed.

#### Dependencies

* P05-T01.

#### Validation Expectations

* Every shipped card imports; source attribution, counts, first, sampled middle, and final rows agree.

#### Completion Evidence

* Exact pass counts and browser observations.

#### Unresolved Items

* None.

<!-- rpi:task id=P05-T03 -->
### P05-T03: Reconcile main and refresh release evidence

#### Context

A correct authoring-time report can become stale before PR if another batch lands.

#### Intent

Rebase or merge safely onto current main and reissue all downstream evidence affected by catalog or
source changes.

#### Boundaries

* Included: fetch, conflict resolution, source digest check, report and approval regeneration, and
  affected reruns of tests, lint, counts, sizes, palette, publication, anchors, contract, and browser
  checks.
* Excluded: suppressing command failures or using destructive reset and checkout shortcuts.

#### Likely Targets

* Relationship reports, mappings, generated catalog, counts, anchors, and validation evidence.

#### Dependencies

* P05-T02.

#### Validation Expectations

* Final reports cover the final catalog plus peers and all gates remain green.

#### Completion Evidence

* Final main commit, library digest, comparison counts, and rerun results.

#### Unresolved Items

* A new exact duplicate is a release blocker and cannot be approved.

<!-- rpi:phase id=P06 -->
## P06: Execute one independent Review

### Context

The caller requires exactly one post-implementation Review. Repository guidance routes findings rather
than looping review rounds.

### Intent

Obtain one independent outcome, fix only release blockers, and route everything else.

### Boundaries

* Included: final diff review, one review artifact, in-scope blocker fixes, affected gate reruns,
  follow-up routing.
* Excluded: a second Review or unrelated cleanup.

### Likely Targets

* `.copilot-tracking/reviews/logs/2026-08-23/historical-event-reading-orders-review.md`
* In-scope source, data, tests, or documents only when Review finds a blocker.

### Dependencies

* P05 complete.

### Validation Expectations

* No material in-scope finding remains open before PR.

### Completion Evidence

* One review artifact and routed disposition.

### Unresolved Items

* None until Review returns.

<!-- rpi:task id=P06-T01 -->
### P06-T01: Run and persist one independent Review

#### Context

Review must evaluate provider identity, source safety, digests, mapping, overlap authority, chronology,
generated data, docs, and release evidence.

#### Intent

Get a single independent, actionable finding set.

#### Boundaries

* Included: current final diff and all directly related evidence.
* Excluded: historical unrelated defects and stylistic comments.

#### Likely Targets

* Review artifact only for the independent worker.

#### Dependencies

* P05-T03.

#### Validation Expectations

* Review result names material findings or a clean result with evidence.

#### Completion Evidence

* Exactly one post-implementation Review run is recorded.

#### Unresolved Items

* None before dispatch.

<!-- rpi:task id=P06-T02 -->
### P06-T02: Fix only in-scope release blockers and route the rest

#### Context

Review is not repeated after corrections.

#### Intent

Close release blockers and preserve unrelated work as follow-up.

#### Boundaries

* Included: material in-scope fixes and affected checks.
* Excluded: second Review or broad cleanup.

#### Likely Targets

* Only files named by accepted blocker findings.
* Plan follow-up items and review artifact dispositions.

#### Dependencies

* P06-T01.

#### Validation Expectations

* Accepted blocker checks pass and review artifact records the outcome.

#### Completion Evidence

* No open in-scope release blocker.

#### Unresolved Items

* Unrelated findings are follow-ups, not blockers.

<!-- rpi:phase id=P07 -->
## P07: Publish, monitor CI, merge, and persist final state

### Context

The repository requires plain-English PR framing, exact verification counts, hosted Node 20, Node 24,
and lint checks, current-main reconciliation, merge, and durable final reporting.

### Intent

Deliver the reviewed release and close MRT-003 with hosted evidence.

### Boundaries

* Included: commit, push, PR, hosted checks, conflict resolution, merge, final artifact and creator
  checkpoint.
* Excluded: bypassing failed jobs or merging with an open blocker.

### Likely Targets

* Git history and GitHub PR.
* Plan, changes, review, and final state records when release facts change.

### Dependencies

* P06.

### Validation Expectations

* Actual job conclusions pass and final merge contains reviewed files.

### Completion Evidence

* PR URL, merge commit, hosted job conclusions, and creator message.

### Unresolved Items

* None until hosted execution.

<!-- rpi:task id=P07-T01 -->
### P07-T01: Commit and open the pull request

#### Context

Commit and PR text are user-facing release records with repository-specific conventions.

#### Intent

Create a reviewable PR with plain-English and technical evidence.

#### Boundaries

* Included: scoped commits with trailer, push, PR title and body, exact local counts.
* Excluded: tracking paths or identifiers in the plain-English section.

#### Likely Targets

* Git commits and pull request.

#### Dependencies

* P06-T02.

#### Validation Expectations

* PR body opens with `## In plain English` and includes exact verification counts.

#### Completion Evidence

* PR URL and tracked PR state.

#### Unresolved Items

* None.

<!-- rpi:task id=P07-T02 -->
### P07-T02: Monitor hosted checks and reconcile safely

#### Context

Run-level failure can mean cancellation, so actual job and step conclusions and logs must be read.

#### Intent

Reach a current-main, hosted-green release without destructive conflict handling.

#### Boundaries

* Included: Node 20, Node 24, lint, final current-main fetch, conflict resolution, complete freshness
  decision, affected local reruns, safe push.
* Excluded: dismissing cancelled jobs without context or suppressing command output.

#### Likely Targets

* PR branch, hosted checks, and conflict files only when main changed.

#### Dependencies

* P07-T01.

#### Validation Expectations

* With no relevant catalog or source change, all required job conclusions pass on the final head.
* With a relevant catalog change, the central release coordinator regenerates all five complete-library
  plus four-peer reports, reissues every affected packet, mapping, peer, report, approval, authoring,
  and release digest, records central approvals, reruns all seven deterministic local gates plus
  affected contract and browser checks, and blocks on an exact duplicate or unresolved disposition.
* The single completed Review is not repeated after this final reconciliation.

#### Completion Evidence

* Hosted run and job identifiers with conclusions.
* Final main commit, library digest, per-candidate comparison count, five current report and approval
  digests, central authority, and final local results, or the precise genuine blocker.

#### Unresolved Items

* A genuine hosted failure blocks merge.

<!-- rpi:task id=P07-T03 -->
### P07-T03: Merge and persist the result

#### Context

The task is complete only when merged evidence and final state are durable.

#### Intent

Merge the reviewed PR and report the exact outcome.

#### Boundaries

* Included: merge, merge commit verification, final tracking state, creator checkpoint.
* Excluded: claiming completion from an unmerged or stale head.

#### Likely Targets

* GitHub PR and RPI state artifacts.

#### Dependencies

* P07-T02.

#### Validation Expectations

* PR is merged and the merge commit contains the five-guide release.

#### Completion Evidence

* Merge URL or commit, hosted conclusions, final counts, and creator message.

#### Unresolved Items

* None.
