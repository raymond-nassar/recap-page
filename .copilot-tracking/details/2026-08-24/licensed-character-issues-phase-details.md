<!-- markdownlint-disable-file -->
# RPI Phase Details: Licensed tie-in exclusion batch

## Metadata

* Task ID: MRT-003-C02-B04
* Parent task: MRT-003-C02
* Task slug: licensed-character-issues
* Related plan: .copilot-tracking/plans/2026-08-24/licensed-character-issues-plan.md
* Evidence sources: .copilot-tracking/research/2026-08-24/licensed-character-issues-research.md and
  committed MRT-003-C02-B03 artifacts

## Initial Direction

The change extends the current CBRO evidence pipeline with a narrow structured exclusion contract,
then releases exactly Wraith War, Secret Wars II, and Mutant Massacre. The implementation must reuse
existing packet, mapping, report, approval, authoring, inventory, and generated-data patterns.

The active boundary is exact: 89 frozen source rows become 58 retained rows plus the 31 approved
guide-scoped exclusions. Availability states, placeholders, later inventory positions, unrelated
curation sources, and any additional omission remain outside the task.

## Initial Readiness

Research is complete and reconciled against current main. No decision blocker remains. Detailed
phase tasks, targets, validation ownership, and completion evidence are drafted next, then one
independent critique determines implementation readiness.

## Phase Index

| Phase ID | Name | Status | Detail sections |
|---|---|---|---|
| P01 | Establish exclusion-aware source and compatibility contracts | Complete | P01, P01-T01, P01-T02 |
| P02 | Resolve chronology, finalize authority, compare, and approve | Complete | P02, P02-T01 to P02-T03 |
| P03 | Author and integrate three truthful guides | Complete | P03, P03-T01 to P03-T03 |
| P04 | Prove the final implementation | Complete | P04, P04-T01, P04-T02 |
| P05 | Review and prepare the merge-ready pull request | Complete | P05, P05-T01, P05-T02 |

## Locked Change Boundary

* Exact removals: None.
* Maximum additions: Three packets, three mappings, three overlap reports, three checklists, three
  payloads, and three catalog entries. Planning and RPI artifacts are added as required by the task.
* Canonical targets: scripts/lib/cbh-inventory.mjs, scripts/lib/cbro-evidence.mjs,
  scripts/prepare-cbro-event.mjs, scripts/author-cbro-packet.mjs,
  scripts/data/cbro-historical-inventory.json, scripts/data/cbro-packets,
  scripts/data/cbro-mappings, scripts/data/cbro-overlaps, src/data/curated-lists.json,
  test/cbro-historical-events.test.js, test/cbh-batch.test.js, CHANGELOG.md,
  PRODUCT_BACKLOG.md, docs/DATA_PROVENANCE.md, and continuation resolution evidence under
  .copilot-tracking/research/2026-08-24.
* Generated targets: src/data/orders, three root src/data payloads, and src/data/catalog.json.
* Semantic test owner: test/cbro-historical-events.test.js.
* Shared regression owner: test/cbh-batch.test.js for packets with repeated rows or no exclusions.
* Validation evidence: Focused historical tests, one reversible mutation, full lint and bare tests,
  counts, sizes, palette, anchors, publication, live contract, dash scan, and installed Edge at
  1280x900.

<!-- rpi:phase id=P01 -->
## P01: Establish exclusion-aware source and compatibility contracts

### Context

The existing packet model can account for repeated source occurrences but not intentional omission of
named source rows. The historical inventory still treats the three guides as blocked. This phase
creates the smallest evidence extension and locks exact compatibility invariants before any
chronology-dependent release authority is finalized.

### Intent

Make structured exclusions and exact source conservation mandatory, preserve the B03 guard without
re-blessing it, and define the new untouched boundary before metadata or product output is generated.

### Boundaries

* Included: Optional exclusion fields, position reconstruction, digest binding, exact predecessor
  normalization, a B04 untouched boundary, and backward compatibility.
* Excluded: Global availability states, broad packet redesign, and changes to earlier packet files.

### Likely Targets

* scripts/lib/cbh-inventory.mjs: Shared packet and mapping validation primitives.
* scripts/lib/cbro-evidence.mjs: B03 and B04 compatibility authority.
* test/cbh-batch.test.js and test/cbro-historical-events.test.js: Semantic and compatibility coverage.

### Dependencies

* The approved 31-row ledger and 58 retained rows in the canonical research artifact.

### Validation Expectations

* Old packets without exclusions retain their existing source-position and occurrence behavior.
* Every exclusion mutation and every uncovered source position is rejected.

### Completion Evidence

* A validator reconstructs complete ranges 1 to 35, 1 to 42, and 1 to 12 from retained and excluded
  positions.
* Earlier release selectors and packet tests remain green.

### Unresolved Items

* None.

<!-- rpi:task id=P01-T01 -->
### P01-T01: Add exact source conservation primitives

#### Context

Structured exclusions need fields that cannot be confused with existing prose-only
excludedSourceReferences. The digest and mapping contracts must carry them intact.

#### Intent

Add one optional excluded-source-row array whose entries have an exact source position, source issue
reference, bounded reason, and decision scope. Reconstruct retained positions as the complement of
excluded and repeated positions and reject every nonconserving shape.

#### Boundaries

* Included: Schema field allowlists, validation, source counts, source position calculation, mapping
  propagation, and digest fields.
* Excluded: Changes to the meaning of existing excludedSourceReferences strings.

#### Likely Targets

* scripts/lib/cbh-inventory.mjs
* scripts/prepare-cbro-event.mjs
* test/cbh-batch.test.js
* test/cbro-historical-events.test.js

#### Dependencies

* None beyond the frozen source ledger.

#### Validation Expectations

* Reject duplicate, unordered, zero, out-of-range, unsupported, unapproved, or overlapping exclusions.
* Reject a mapping whose copied ledger or retained positions differ from its packet.

#### Completion Evidence

* Focused tests cover valid legacy, repeated, excluded, and mixed position reconstruction.

#### Unresolved Items

* None.

<!-- rpi:task id=P01-T02 -->
### P01-T02: Lock predecessor and B04 inventory invariants

#### Context

The three affected records are B03 blocked outcomes. The existing
CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256 and its filter must remain unchanged rather than being
rederived against B04.

#### Intent

Add a distinct normalized B03 outcome invariant that reconstructs positions 12 through 14 to their
committed blocked records, and add a B04 untouched-inventory projection for every record outside this
batch. Do not finalize B04 author order here.

#### Boundaries

* Included: Exact B03 blocked projections, unchanged B03 nonselected filter and constant, B04 touched
  IDs, and B04 untouched digest.
* Excluded: Final B04 author order, relationship state, position 17, and all unrelated record changes.

#### Likely Targets

* scripts/lib/cbro-evidence.mjs
* test/cbro-historical-events.test.js

#### Dependencies

* The current committed B03 blocked records are the normalization source.

#### Validation Expectations

* A changed B03 constant or filter, an inexact normalized blocked projection, or an unexpected B04
  untouched-record change fails.

#### Completion Evidence

* The existing B03 nonselected constant and filter are unchanged, the normalized B03 outcome digest
  is exact, the B04 untouched digest is exact, and a semantic test fails if any is weakened.

#### Unresolved Items

* None.

<!-- rpi:phase id=P02 -->
## P02: Resolve chronology, finalize authority, compare, and approve

### Context

The source rows and exclusion decisions are exact, but final release author order is intentionally
unknown until retained metadata provides first-on-sale chronology.

### Intent

Produce exact resolution evidence first, derive chronology, then finalize deterministic packets,
mappings, release authority, inventory transitions, reports, and approvals.

### Boundaries

* Included: Continuation resolution evidence, three additions per canonical evidence directory, exact
  inventory transitions, one known release, and exact release-scoped decisions.
* Excluded: Placeholder rows, metadata for excluded issues, or a fourth guide.

### Likely Targets

* scripts/data/cbro-packets
* scripts/data/cbro-mappings
* scripts/data/cbro-overlaps
* scripts/lib/cbro-evidence.mjs
* .copilot-tracking/research/2026-08-24 licensed continuation evidence

### Dependencies

* P01 validators and compatibility contracts. Final release authority is not a prerequisite for
  P02-T01 or P02-T02.

### Validation Expectations

* All retained rows have exact issue number, series, positive ID, Marvel URL, and chronology.
* Reports cover the current library excluding selected candidates plus both peers.

### Completion Evidence

* Three valid packet digests, mapping digests, report digests, and approval digests.

### Unresolved Items

* Exact non-none relationship tuples are evidence outputs and may update the plan directly if they do
  not change scope.

<!-- rpi:task id=P02-T01 -->
### P02-T01: Assemble three exclusion-aware packet candidates

#### Context

The exact source lists are already frozen. Packet creation must retain the original source positions
rather than renumbering the selected subset.

#### Intent

Assemble Wraith War, Secret Wars II, and Mutant Massacre packet candidates with exact retained rows,
31 structured exclusions, essential or selected manifests, and B04 source review. Candidate evidence
does not claim final known-release author order.

#### Boundaries

* Included: Exact source and manifest fields.
* Excluded: Any legal conclusion beyond the observable curation rationale.

#### Likely Targets

* .copilot-tracking/research/2026-08-24/licensed-character-issues-resolution.mjs
* .copilot-tracking/research/2026-08-24/licensed-character-issues-resolution.json

#### Dependencies

* Exact metadata candidate IDs must come from observed configured endpoint records.

#### Validation Expectations

* Packet counts are 35, 42, and 12 source rows while expected retained counts are 7, 40, and 11.

#### Completion Evidence

* Every source position occurs exactly once across rows and exclusions.

#### Unresolved Items

* None.

<!-- rpi:task id=P02-T02 -->
### P02-T02: Resolve 58 exact retained rows and derive author chronology

#### Context

Mappings fetch only retained candidate IDs. Excluded rows have no metadata identity and remain bound
through the copied ledger.

#### Intent

Resolve and digest all retained rows without renumbering their source positions, then derive the
three-guide author order from exact first-on-sale dates.

#### Boundaries

* Included: Exact configured endpoint metadata and explicit manual series-selection notes where needed.
* Excluded: IDs, URLs, or availability values for excluded rows.

#### Likely Targets

* .copilot-tracking/research/2026-08-24/licensed-character-issues-resolution.mjs
* .copilot-tracking/research/2026-08-24/licensed-character-issues-resolution.json

#### Dependencies

* Successful configured metadata responses for all 58 retained candidate IDs.

#### Validation Expectations

* Resolution rows preserve source positions and exact issue numbers; every retained row has exact
  metadata and each guide has an evidence-derived first-on-sale date.

#### Completion Evidence

* 58 unique exact retained resolutions, zero unresolved or placeholder entries, and one supported
  author-order array.

#### Unresolved Items

* Stop the release if any retained row cannot be resolved exactly.

<!-- rpi:task id=P02-T03 -->
### P02-T03: Finalize release authority, reports, and narrow decisions

#### Context

With chronology known, one final B04 release can be registered before canonical preparation,
comparison, approval, or authoring.

#### Intent

Register exact source and author arrays, promote only positions 12 through 14, generate canonical
packets and mappings from the resolution evidence, generate all required comparisons, then add only
exact observed non-none decisions under B04 authority.

#### Boundaries

* Included: Current catalog, two selected peers per candidate, exact tuples and rationales.
* Excluded: Blanket overlap approval or copied decisions from earlier blocked scans.

#### Likely Targets

* scripts/data/cbro-packets
* scripts/data/cbro-mappings
* scripts/data/cbro-overlaps
* scripts/data/cbro-historical-inventory.json
* scripts/lib/cbro-evidence.mjs
* scripts/prepare-cbro-event.mjs
* scripts/author-cbro-packet.mjs

#### Dependencies

* P02-T02 exact mappings and evidence-derived author chronology.

#### Validation Expectations

* Every expected order ID occurs once and every unlisted non-none tuple fails.

#### Completion Evidence

* One exact known release, three selected inventory outcomes, three approved canonical mappings, and
  complete relationship reviews with current digests.

#### Unresolved Items

* None after chronology, reports, and exact tuples are recorded.

<!-- rpi:phase id=P03 -->
## P03: Author and integrate three truthful guides

### Context

Approved evidence can now become product data. Reader copy must distinguish these selected routes from
the full source chronologies.

### Intent

Add three product guides and update only direct records that describe the shipped result.

### Boundaries

* Included: Checklists, payloads, catalog, inventory shipped state, CHANGELOG.md,
  PRODUCT_BACKLOG.md, and docs/DATA_PROVENANCE.md.
* Excluded: Availability UI, unrelated documentation cleanup, and supplemental-source expansion.

### Likely Targets

* scripts/author-cbro-packet.mjs
* src/data/curated-lists.json
* src/data/orders
* src/data/catalog.json and three payloads
* CHANGELOG.md
* PRODUCT_BACKLOG.md
* docs/DATA_PROVENANCE.md

### Dependencies

* P02 approvals.

### Validation Expectations

* Three non-complete cards, 58 exact items, explicit disclosure, and no placeholder.

### Completion Evidence

* Canonical and generated counts agree and inventory records become shipped.

### Unresolved Items

* None.

<!-- rpi:task id=P03-T01 -->
### P03-T01: Author exclusion-aware checklists and catalog definitions

#### Context

The current generic checklist trail claims factual source order but does not disclose selected-out
source rows.

#### Intent

Add a deterministic disclosure derived from the reviewed ledger, state the included and source counts,
and link the full source without reproducing source commentary.

#### Boundaries

* Included: Project-authored scope wording and exact issue links.
* Excluded: Listing all 31 omitted rows in the reader checklist when the exact ledger already remains
  in build-time evidence; disclosure must still name the affected series and counts.

#### Likely Targets

* scripts/author-cbro-packet.mjs
* src/data/orders/wraith-war.md
* src/data/orders/secret-wars-ii.md
* src/data/orders/mutant-massacre.md
* src/data/curated-lists.json

#### Dependencies

* Approved mappings and exact source counts.

#### Validation Expectations

* Generated wording is stable, bounded, and absent from guides with no structured exclusions.

#### Completion Evidence

* All three checklists disclose retained and omitted counts and preserve 58 retained links.

#### Unresolved Items

* None.

<!-- rpi:task id=P03-T02 -->
### P03-T02: Vendor payloads and regenerate catalog state

#### Context

Authoring writes canonical checklist and manifest data; vendoring creates the runtime payloads and
catalog.

#### Intent

Vendor exactly the authored three and verify chronology ordering by first retained on-sale evidence.

#### Boundaries

* Included: Three payloads and catalog regeneration.
* Excluded: Full-catalog re-vendoring beyond deterministic generated changes.

#### Likely Targets

* src/data/wraith_war.json
* src/data/secret_wars_ii.json
* src/data/mutant_massacre.json
* src/data/catalog.json

#### Dependencies

* P03-T01 canonical files.

#### Validation Expectations

* No placeholders, no unresolved entries, correct first/last sequence, and exact issue counts.

#### Completion Evidence

* Generated catalog and payload checks pass with three new IDs.

#### Unresolved Items

* None.

<!-- rpi:task id=P03-T03 -->
### P03-T03: Reconcile direct delivery and provenance records

#### Context

The prior backlog entry says blocked guides must not be shortened. This new user decision supersedes
that active blocker only for exact auditable exclusions and needs a new continuation record.

#### Intent

Record what changed, why the earlier blocker is now resolved, exact counts, source attribution, and
the unchanged future cursor.

#### Boundaries

* Included: One new backlog item or explicit continuation block in PRODUCT_BACKLOG.md, one Unreleased
  entry in CHANGELOG.md, provenance counts and the supplemental future-evidence note in
  docs/DATA_PROVENANCE.md.
* Excluded: Rewriting historical B03 records as though the earlier decision had already existed.

#### Likely Targets

* CHANGELOG.md
* PRODUCT_BACKLOG.md
* docs/DATA_PROVENANCE.md

#### Dependencies

* Final authored catalog counts and actual relationship output.

#### Validation Expectations

* Every changed count in touched sections is rederived.

#### Completion Evidence

* Records agree on guide counts, issue counts, exclusions, and next cursor.

#### Unresolved Items

* None.

<!-- rpi:phase id=P04 -->
## P04: Prove the final implementation

### Context

This task changes a safety contract around omission. A passing test is not evidence until a precise
revert demonstrates the guard fails.

### Intent

Prove the new contract, then run every repository and runtime gate.

### Boundaries

* Included: Focused mutation, targeted and full validation, anchor reconciliation, dash scan, live
  metadata contract, and real Edge.
* Excluded: New testing tools.

### Likely Targets

* test/cbro-historical-events.test.js
* test/cbh-batch.test.js
* Existing package scripts and scripts/browser-check.mjs

### Dependencies

* Final P03 tree.

### Validation Expectations

* One smallest reversible conservation mutation fails a named focused test.
* Final clean tree passes every listed gate.

### Completion Evidence

* Exact command results and assertion counts recorded in the changes and Review artifacts.

### Unresolved Items

* None.

<!-- rpi:task id=P04-T01 -->
### P04-T01: Add focused semantic and regression coverage

#### Context

Coverage must distinguish exact exclusions from generic omitted prose and protect every source row.

#### Intent

Test valid and invalid structured exclusion shapes, B04 packets, mappings, reports, approvals,
inventory, authoring disclosure, and old packet behavior.

#### Boundaries

* Included: Semantic assertions and directly related regression assertions.
* Excluded: Snapshot-only tests that can pass while conservation is broken.

#### Likely Targets

* test/cbro-historical-events.test.js
* test/cbh-batch.test.js

#### Dependencies

* Final contract and generated evidence.

#### Validation Expectations

* Precise mutations for a missing exclusion, wrong position, wrong title, extra omission, stale digest,
  and complete-depth regression fail.

#### Completion Evidence

* Focused tests pass after observed failure without the critical guard.

#### Unresolved Items

* None.

<!-- rpi:task id=P04-T02 -->
### P04-T02: Run repository, contract, and browser gates

#### Context

CI covers lint, tests, and anchors. Product delivery also needs the direct repository scripts, live
contract, and installed Edge behavior.

#### Intent

Run and record the complete final validation set after the last edit and anchor re-aim.

#### Boundaries

* Included: Existing scripts only.
* Excluded: Adding dependencies or trusting a sandboxed webview.

#### Likely Targets

* package.json scripts
* scripts/browser-check.mjs

#### Dependencies

* P04-T01 clean focused result.

#### Validation Expectations

* Zero lint findings, zero test failures, zero anchor drift/new/removed after bless if needed, and
  browser success at 1280x900.

#### Completion Evidence

* Final validation table in the changes record.

#### Unresolved Items

* None.

<!-- rpi:phase id=P05 -->
## P05: Review and prepare the merge-ready pull request

### Context

Review runs once after complete implementation. It may route material findings back for one fix pass
without causing another Review.

### Intent

Produce one reviewed, committed, hosted-check-ready pull request.

### Boundaries

* Included: One Review, in-scope fixes, final reruns affected by fixes, commit, push, pull request, and
  hosted readiness.
* Excluded: A second Review or automatic work on routed future items.

### Likely Targets

* .copilot-tracking/reviews/logs/2026-08-24/licensed-character-issues-review.md
* .copilot-tracking/changes/2026-08-24/licensed-character-issues-changes.md
* Git commit and pull request metadata

### Dependencies

* P04 final validation.

### Validation Expectations

* Review has one complete outcome and every material finding is resolved or blocks publication.

### Completion Evidence

* Required commit trailer, plain-English-first PR body, and hosted job conclusions.

### Unresolved Items

* None.

<!-- rpi:task id=P05-T01 -->
### P05-T01: Run exactly one post-implementation Review

#### Context

The highest risk is accidental omission or stale evidence in a path intended to prevent false data.

#### Intent

Assess the full diff against research, plan, critique, exact ledger, generated evidence, user copy,
and validation results.

#### Boundaries

* Included: One read-only review artifact and one routed implementation fix pass when required.
* Excluded: Repeated review rounds.

#### Likely Targets

* Complete working diff and all RPI artifacts.

#### Dependencies

* P04 complete.

#### Validation Expectations

* Review explicitly checks failure paths, duplicate offers, stale evidence, exact conservation, and
  non-precedent scope.

#### Completion Evidence

* Review outcome is Ready or material blockers remain explicit.

#### Unresolved Items

* None.

<!-- rpi:task id=P05-T02 -->
### P05-T02: Commit, open the pull request, and assess hosted readiness

#### Context

Repository convention requires one commit trailer, a plain-English opening, technical validation
numbers, and honest reading of hosted job conclusions.

#### Intent

Publish the reviewed final tree and stop at merge readiness unless merge is clearly permitted.

#### Boundaries

* Included: Fetch/reconcile without destructive commands, commit, push, PR creation, and hosted checks.
* Excluded: Starting the position-17 batch.

#### Likely Targets

* Git branch and GitHub pull request.

#### Dependencies

* P05-T01 Ready outcome and final green local gates.

#### Validation Expectations

* Hosted Node 20, Node 24, and lint jobs pass or an actual blocker is surfaced.

#### Completion Evidence

* Commit SHA, PR URL, and merge-readiness state are recorded durably.

#### Unresolved Items

* None.
