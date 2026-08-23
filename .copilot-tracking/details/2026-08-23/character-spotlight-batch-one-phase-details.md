<!-- markdownlint-disable-file -->
# RPI Phase Details: Character spotlight batch one

## Metadata

* Task ID: MRT-002-C02
* Parent: MRT-002-C01 / character-spotlight-guides
* Task slug: character-spotlight-batch-one
* Related plan: .copilot-tracking/plans/2026-08-23/character-spotlight-batch-one-plan.md
* Evidence sources: .copilot-tracking/research/2026-08-23/character-spotlight-batch-one-research.md
  and worker commit f2d5dda64ad388b5c00af027acb3f8f2d7e9a0a8

## Phase Index

| Phase ID | Name | Status | Detail sections |
|---|---|---|---|
| P01 | Centralize selected evidence | complete | P01, P01-T01, P01-T02 |
| P02 | Approve and publish both readings | complete | P02, P02-T01, P02-T02 |
| P03 | Prove and release the batch | in progress | P03, P03-T01, P03-T02 |
| P04 | Review and deliver the release | ready after P03 | P04, P04-T01, P04-T02 |

## Task-Level Context

### Context

Research closed all three worker lanes. Phalanx and Phoenix are the only admissible candidates. Their
81 selected issue ids are exact, unique, inside the metadata horizon, and peer-disjoint. Worker
authority and dependent digests remain provisional, and Phalanx copy names source sections that were
excluded because they contain no issue rows.

### Intent

Plan one bounded two-guide implementation that reproduces central evidence, publishes through the
existing Character spotlights surface, and reaches merge after one critique and one Review.

### Boundaries

* Included: two selected packets and mappings, final reports and approvals, source orders, shared data,
  focused coverage, records, release gates, PR, CI, reconciliation, and merge.
* Excluded: every rejected or deferred candidate, worker approval authority, new runtime behavior,
  silent source shortening, and repeated critique or Review.

### Initial Evidence and Readiness

* Research status: complete and Ready.
* Selected candidates: Phalanx, 28 rows; Phoenix, 53 rows.
* Latest metadata dates: 2023-02-01 and 2023-11-22.
* Peer overlap: zero.
* Existing-list relationships: Phalanx has two eight-issue partials; Phoenix has none.
* Planning blockers: none.

### Active Authority Boundary

* Deterministic reuse: candidate-specific packet rows and exact mapping evidence from the verified
  shard 3 commit.
* Coordinator-only: source review, copy correction, horizon acceptance, every relationship
  disposition, approval digests, shared edits, anchors, release, Review, PR, CI interpretation,
  reconciliation, and merge.

### Locked Test and Change Boundary

* Exact removals: none.
* Maximum new production data artifacts: ten.
* Maximum new production test files: zero.
* Semantic test owner: `test/cbh-character-spotlight.test.js`.
* Guard regression owner: `test/cbh-batch.test.js`.
* Existing product regression owners: catalog shelf, catalog, curated-data, and licence-boundary tests.
* Browser evidence: both Character Spotlight cards, exact counts, source links, and first/middle/final
  order at 1280x900.

### Unresolved Items

* None.

<!-- rpi:phase id=P01 -->
## P01: Centralize selected evidence

### Context

The verified shard 3 commit contains two candidate-specific packets and mappings whose rows and provisional
digests validate. Research independently accepted both source boundaries and metadata horizons. Worker
`stronger-model` reviews are not central authority, and Phalanx copy names Annihilation: Conquest and
Powers of X even though those sections provide no retained issue numbers.

### Intent

Import only accepted candidate evidence, replace worker judgment with central review, correct Phalanx copy,
and regenerate exact mappings from immutable final packets.

### Boundaries

* Included: two packet rows and manifest proposals, central source reviews, Phalanx copy correction,
  packet digests, exact candidate metadata, and mapping digests.
* Excluded: the shard 3 worker evidence artifact as approval, all shard 2 files, shard 1 scratch files,
  source-boundary expansion, and shared product writes.

### Likely Targets

* `scripts/data/cbh-packets/phalanx-reading-order.json`
* `scripts/data/cbh-packets/marvels-best-phoenix-comics.json`
* `scripts/data/cbh-mappings/phalanx-reading-order.json`
* `scripts/data/cbh-mappings/marvels-best-phoenix-comics.json`
* `scripts/data/cbh-character-inventory.json`
* `scripts/prepare-cbh-batch.mjs`

### Dependencies

* Completed Research and verified shard 3 commit.

### Validation Expectations

* Packet validation succeeds after central review and copy correction.
* Phalanx retains 28 rows; Phoenix retains 53.
* All 81 mapping rows are exact and unique, and the mappings share no selected issue id.
* Latest on-sale dates remain 2023-02-01 and 2023-11-22.

### Completion Evidence

* Fresh packet and mapping digests plus deterministic preparation output for both ids.

### Unresolved Items

* None.

<!-- rpi:task id=P01-T01 -->
### P01-T01: Import and correct the selected packets

#### Context

Research accepted the issue-bearing passages, exclusions, and order while rejecting worker authority.
Phalanx's description and keywords overstate the retained boundary.

#### Intent

Create two central frozen packets without changing accepted row sequences.

#### Boundaries

* Included: exact packet fields, central review rationale, corrected Phalanx description and keywords,
  and fresh packet digests.
* Excluded: adding issues from prose-only sections or changing Phoenix's exact-issue-only boundary.

#### Likely Targets

* `scripts/data/cbh-packets/phalanx-reading-order.json`
* `scripts/data/cbh-packets/marvels-best-phoenix-comics.json`

#### Dependencies

* Research C13-C14 and W1-W2.

#### Validation Expectations

* No worker authority identity survives.
* Phalanx copy names only Technarch-linked origins, the Phalanx Covenant, later Uncanny X-Men, and
  Legion of X material represented by rows.
* Packet row counts remain 28 and 53 and digests validate.

#### Completion Evidence

* Central packet review and digest validation pass.

#### Unresolved Items

* None.

<!-- rpi:task id=P01-T02 -->
### P01-T02: Regenerate exact mappings

#### Context

Changing either packet review or manifest proposal invalidates its mapping digest even when rows stay fixed.
The named preparation path rejects deferred character records, so the two selected records must receive
their exact validator-backed terminal tuple before preparation and remain consistent through authoring.

#### Intent

Reproduce both mappings through the named preparation path from final packets.

#### Boundaries

* Included: exact inventory terminal state, exact metadata, selected issue ids, source notes, packet
  binding, and mapping digest.
* Excluded: manual row substitutions, approved exceptions, ambiguous selections, or peer decisions.

#### Likely Targets

* `scripts/data/cbh-mappings/phalanx-reading-order.json`
* `scripts/data/cbh-mappings/marvels-best-phoenix-comics.json`
* `scripts/data/cbh-character-inventory.json`
* `scripts/prepare-cbh-batch.mjs`

#### Dependencies

* P01-T01.

#### Validation Expectations

* 81 exact rows, zero unmatched or ambiguous rows, no duplicates within or across mappings.
* Only inventory positions 89 and 90 change to the exact shipped tuple required by the validator.
* Mapping digests bind the final packet digests.

#### Completion Evidence

* Named preparation reports 28 and 53 exact rows with fresh mapping digests.

#### Unresolved Items

* None.

<!-- rpi:phase id=P02 -->
## P02: Approve and publish both readings

### Context

The final candidate pair must be compared against every one of the 87 pre-change readings and each other.
Phalanx has two eight-issue partials with existing X-Men variants; Phoenix has no non-none relationship.
The guarded authoring path validates reciprocal peer digests and rejects duplicate peer issue ids before
shared writes.

### Intent

Regenerate all relationship evidence, centrally approve every comparison, and publish both guides through
one guarded named batch.

### Boundaries

* Included: two 88-comparison reports, reciprocal peer digests, central approval, source orders, manifest
  entries, generated payloads, catalog, and selected inventory lifecycle.
* Excluded: stale worker reports, manual generated-data edits, another guide, new UI code, and relationship
  changes achieved by altering source scope.

### Likely Targets

* `scripts/data/cbh-overlaps/phalanx-reading-order.json`
* `scripts/data/cbh-overlaps/marvels-best-phoenix-comics.json`
* `scripts/data/cbh-mappings/phalanx-reading-order.json`
* `scripts/data/cbh-mappings/marvels-best-phoenix-comics.json`
* `scripts/data/cbh-character-inventory.json`
* `src/data/orders/phalanx-reading-order.md`
* `src/data/orders/marvels-best-phoenix-comics.md`
* `src/data/curated-lists.json`
* `src/data/phalanx_reading_order.json`
* `src/data/marvels_best_phoenix_comics.json`
* `src/data/catalog.json`

### Dependencies

* P01 complete.

### Validation Expectations

* Each report contains 88 comparisons and the reciprocal peer mapping digest.
* Phalanx has exactly two partials of eight shared issues; Phoenix has 88 `none`.
* One guarded authoring call validates the full peer set before writing.
* Generated data contains exact 28- and 53-issue sequences.

### Completion Evidence

* Fresh report and approval digests plus reproducible shared and generated outputs.

### Unresolved Items

* None.

<!-- rpi:task id=P02-T01 -->
### P02-T01: Regenerate and approve all relationships

#### Context

Worker reports are factually consistent but stale after central packet and mapping regeneration. All
relationships require a final disposition bound to the new digests.

#### Intent

Create two current reports and central approvals covering the complete library and reciprocal peer.

#### Boundaries

* Included: 87 existing lists, one peer, deterministic relationship taxonomy, central partial rationales,
  maintained `none` policy, and approval digests.
* Excluded: exact duplicates, subsets, unreviewed partials, or worker approval authority.

#### Likely Targets

* `scripts/data/cbh-overlaps/phalanx-reading-order.json`
* `scripts/data/cbh-overlaps/marvels-best-phoenix-comics.json`
* `scripts/data/cbh-mappings/phalanx-reading-order.json`
* `scripts/data/cbh-mappings/marvels-best-phoenix-comics.json`

#### Dependencies

* P01-T02.

#### Validation Expectations

* No exact, candidate-subset, existing-subset, or peer relationship.
* Phalanx partials are limited to `xmen-claremont` and `xmen-claremont-complete`, eight each.
* Every one of the 176 total comparison records has exactly one disposition.

#### Completion Evidence

* Report and approval validators pass for both candidates.

#### Unresolved Items

* None.

<!-- rpi:task id=P02-T02 -->
### P02-T02: Author and vendor the two-guide batch

#### Context

Named multi-guide authoring prevents one candidate from being written before the peer set validates.

#### Intent

Publish both selected guides atomically through existing authoring and vendoring tools.

#### Boundaries

* Included: two source orders, two ungrouped complete manifest entries, two generated payloads,
  regenerated catalog, and verification of the two inventory lifecycle updates established in P01.
* Excluded: group variants, another guide, UI code, manual payload editing, and any shard 2 artifact.

#### Likely Targets

* `scripts/data/cbh-character-inventory.json`
* `src/data/orders/phalanx-reading-order.md`
* `src/data/orders/marvels-best-phoenix-comics.md`
* `src/data/curated-lists.json`
* `src/data/phalanx_reading_order.json`
* `src/data/marvels_best_phoenix_comics.json`
* `src/data/catalog.json`

#### Dependencies

* P02-T01.

#### Validation Expectations

* Phalanx and Phoenix insert before `xmen-claremont` in selected order.
* Catalog totals become 89 readings, 11 `character-run` entries, and 10 spotlight stories.
* Inventory totals remain 128 and only positions 89 and 90 change.
* Both records become disposition `new-order`, delivery `shipped`, central disposition `pilot-approved`,
  and metadata horizon `approved`, with their own ids in `catalogIds`.
* Phalanx records `xmen-claremont` and `xmen-claremont-complete` in `overlapIds`; Phoenix records none.

#### Completion Evidence

* Named authoring and vendoring complete with only expected writes.

#### Unresolved Items

* None.

<!-- rpi:phase id=P04 -->
## P04: Review and deliver the release

### Context

The caller requires the coordinator to own exactly one independent Review and the complete delivery path.
Local release gates are necessary but not sufficient: the PR must also pass hosted Node 20, Node 24, and
lint jobs, and any main conflict must be reconciled without trusting pre-reconciliation validation.

### Intent

Run and resolve one Review, then carry the validated change through PR, hosted CI, reconciliation when
needed, and merge.

### Boundaries

* Included: one independent Review artifact, material finding fixes or explicit routing, final local
  revalidation after any fix or reconciliation, PR creation, hosted CI interpretation, and merge.
* Excluded: a second Review, unrelated finding fixes, auto-dismissal of failed CI, or merge before all
  required jobs pass.

### Likely Targets

* `.copilot-tracking/reviews/logs/2026-08-23/character-spotlight-batch-one-review.md`
* `.copilot-tracking/changes/2026-08-23/character-spotlight-batch-one-changes.md`
* GitHub pull request and hosted CI records.

### Dependencies

* P03 complete with a review-ready implementation.

### Validation Expectations

* Exactly one independent Review runs.
* No material Review finding remains open at PR creation.
* PR body begins with `## In plain English` and records exact local evidence.
* Hosted `test (20)`, `test (24)`, and `lint` jobs pass.
* Any reconciliation against current main is followed by all affected local gates and hosted jobs.

### Completion Evidence

* One Review record, merged PR URL and number, required hosted job conclusions, and final merge commit are
  durable in the state and changes records.

### Unresolved Items

* None.

<!-- rpi:task id=P04-T01 -->
### P04-T01: Run and resolve the one independent Review

#### Context

Review findings are routed once. Material issues in this change are fixed before release; unrelated issues
become follow-up backlog work rather than triggering another Review.

#### Intent

Obtain one independent assessment and reach a release-safe finding disposition.

#### Boundaries

* Included: one full diff Review, durable findings, coordinator-owned fixes, and explicit dispositions.
* Excluded: a second Review pass or unrelated cleanup.

#### Likely Targets

* `.copilot-tracking/reviews/logs/2026-08-23/character-spotlight-batch-one-review.md`
* Affected implementation files for any material direct fix.
* `.copilot-tracking/changes/2026-08-23/character-spotlight-batch-one-changes.md`

#### Dependencies

* P03-T02.

#### Validation Expectations

* Review count is exactly one.
* Every finding records resolution, rejection with rationale, or explicit follow-up route.
* Material fixes rerun the smallest affected checks and all final release gates.

#### Completion Evidence

* Review record has no unresolved material finding.

#### Unresolved Items

* None.

<!-- rpi:task id=P04-T02 -->
### P04-T02: Open the PR, verify hosted CI, reconcile, and merge

#### Context

The user-required endpoint is a merged pull request, not a review-ready worktree. Hosted CI and final-main
state can differ from local pre-Review evidence.

#### Intent

Deliver the approved two-guide release through the repository's complete hosted path.

#### Boundaries

* Included: commit with required trailer, push, plain-English-first PR, required hosted jobs, job-level
  CI interpretation, main reconciliation when needed, revalidation, and merge.
* Excluded: bypassing failed jobs, dismissing a real timeout as supersession, or merging stale evidence.

#### Likely Targets

* Git commit and pull request.
* Hosted CI jobs `test (20)`, `test (24)`, and `lint`.
* Plan, details, state, changes, and Review records for final completion status.

#### Dependencies

* P04-T01 with no unresolved material finding.

#### Validation Expectations

* PR contains exact local validation numbers and the required plain-English opening.
* All three hosted jobs conclude success; cancelled runs are interpreted from job conclusions and logs.
* Reconciliation, if required, preserves all selected evidence and reruns affected gates.

#### Completion Evidence

* Merged PR and merge commit recorded with required hosted job results.

#### Unresolved Items

* None.

<!-- rpi:phase id=P03 -->
## P03: Prove and release the batch

### Context

The implementation is data-centered but user-visible. Existing semantic tests and real Edge behavior must
prove both cards, while product and workflow records must reflect the risk-reduced two-guide outcome.

### Intent

Extend focused coverage, reconcile all directly related records, run release gates, and prepare the one
independent Review.

### Boundaries

* Included: existing focused and regression tests, maintenance and provenance documentation, backlog,
  changelog, changes record, anchors, live contract, browser evidence, and Review handoff.
* Excluded: a new test file, unrelated backlog fixes, historical artifact cleanup, or review loops.

### Likely Targets

* `test/cbh-character-spotlight.test.js`
* `test/licence-boundary.test.js`
* `docs/MAINTAINING.md`
* `docs/DATA_PROVENANCE.md`
* `PRODUCT_BACKLOG.md`
* `CHANGELOG.md`
* `.copilot-tracking/changes/2026-08-23/character-spotlight-batch-one-changes.md`

### Dependencies

* P02 complete.

### Validation Expectations

* Targeted semantic and regression tests pass and demonstrate failure under the smallest relevant revert.
* Lint, full tests, anchors cycle, and live contract pass.
* Edge at 1280x900 shows both cards only on Character spotlights and verifies each exact count, source,
  and first/middle/final entry.

### Completion Evidence

* Exact command outcomes and observed product behavior are durable in the changes record and PR body.

### Unresolved Items

* None.

<!-- rpi:task id=P03-T01 -->
### P03-T01: Extend semantic and regression coverage

#### Context

The existing Character Spotlight test already owns the maintained inventory and White Tiger evidence. It
should expand to the two new guides rather than introducing another test file.

#### Intent

Make source, digest, relationship, lifecycle, placement, and sequence drift fail loudly for both guides.

#### Boundaries

* Included: existing focused file and existing catalog, shelf, curated-data, batch, overlap, and licence
  regressions.
* Excluded: duplicate suites or new test tooling.

#### Likely Targets

* `test/cbh-character-spotlight.test.js`
* `test/licence-boundary.test.js`
* Existing catalog shelf, catalog, curated-data, batch, and overlap test commands.

#### Dependencies

* P02 generated artifacts.

#### Validation Expectations

* The focused check is observed failing under the smallest relevant revert before acceptance.
* Assertions cover 128 inventory identities, three shipped Character Spotlight records, both packet and
  mapping counts, exact peer relationship shape, both generated sequences, and catalog total 89.
* `test/licence-boundary.test.js` moves its exact shipped-order assertion from 87 to 89 without weakening
  the committed-byte scan.

#### Completion Evidence

* Targeted commands pass after the implementation and fail under the demonstrated revert.

#### Unresolved Items

* None.

<!-- rpi:task id=P03-T02 -->
### P03-T02: Reconcile records and run release gates

#### Context

User-visible data, maintainer workflow, provenance, backlog status, changelog, anchors, external contract,
and browser behavior must describe the same two-guide release.

#### Intent

Complete the release evidence without widening scope.

#### Boundaries

* Included: directly related documentation and records, changes record, anchor re-aiming and reading,
  all gates, contract, Edge evidence, and one Review handoff.
* Excluded: unrelated cleanup, another guide, or a second Review.

#### Likely Targets

* `docs/MAINTAINING.md`
* `docs/DATA_PROVENANCE.md`
* `PRODUCT_BACKLOG.md`
* `CHANGELOG.md`
* `.copilot-tracking/changes/2026-08-23/character-spotlight-batch-one-changes.md`

#### Dependencies

* P03-T01.

#### Validation Expectations

* Counts in every touched section are re-derived.
* Anchor bless output is read claim by claim and the final run reports zero drifted, new, and removed.
* The live contract succeeds before release trust.
* Edge uses installed Edge at 1280x900 and non-vacuous Character spotlights selectors.

#### Completion Evidence

* Review-ready diff with complete validation evidence and no open material finding.

#### Unresolved Items

* None.
