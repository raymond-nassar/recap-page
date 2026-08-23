<!-- markdownlint-disable-file -->
# RPI Phase Details: Groot complete guide

## Metadata

* Task ID: MRT-002-C07
* Task slug: groot-complete-guide
* Related plan: .copilot-tracking/plans/2026-08-23/groot-complete-guide-plan.md
* Evidence sources: .copilot-tracking/research/2026-08-23/groot-complete-guide-research.md

## Phase Index

| Phase ID | Name | Status | Detail sections |
|---|---|---|---|
| P01 | Freeze and map Groot | ready | P01, P01-T01, P01-T02 |
| P02 | Approve and publish Groot | waiting | P02, P02-T01, P02-T02 |
| P03 | Prove and document the release | waiting | P03, P03-T01, P03-T02 |
| P04 | Review and deliver the release | waiting | P04, P04-T01, P04-T02 |

## Task-Level Context

### Context

Research independently reproduced the stable nine-block Groot source boundary, 76 unique issues in
first-source order, exact metadata, and three partial relationships. The 41 shared Rocket issues remain
required in both distinct guides. Current `main` is merged pull request 174 at `3f03c53`.

### Intent

Publish Groot as a separate Complete Character Spotlight guide without changing Rocket or weakening the
guarded evidence workflow.

### Boundaries

* Included: candidate evidence, one card and payload, inventory, taxonomy counts, semantic proof, directly
  affected documents, gates, browser checks, one Review, PR, CI, reconciliation, merge, and completion state.
* Excluded: Rocket edits, combined or shortened guides, parsers, heuristic or inferred metadata, exception
  rows, unrelated events, second critique, and second Review.

### Initial Evidence and Readiness

* Research status: Complete and Ready.
* Candidate: Groot, 76 unique exact source-defined issues.
* Relationships: Annihilation: Conquest partial 4, Rocket partial 41, War of Kings partial 7.
* Expected final counts: 91 readings; 13 Character Spotlight readings; 12 stories; All 13/12, Best of 5/5,
  Complete guides 4/4.
* Planning blockers: none.

### Unresolved Items

* None.

<!-- rpi:phase id=P01 -->
## P01: Freeze and map Groot

### Context

The phase begins from a stable accepted issue-bearing digest and an independently reconstructed 76-row
sequence. Detailed task ownership and locked targets are pending final plan drafting.

### Intent

Create fresh source and exact mapping evidence without parsing or inference.

### Boundaries

* Included: source-boundary freshness, packet rows, exact mapping, inventory eligibility, digests.
* Excluded: relationship approval and publication.

### Likely Targets

* scripts/data/cbh-packets/groot-reading-order.json
* scripts/data/cbh-mappings/groot-reading-order.json
* scripts/data/cbh-character-inventory.json
* scripts/lib/cbh-inventory.mjs

### Dependencies

* Completed Research.

### Validation Expectations

* Exactly 76 unique packet and mapping rows with fresh evidence.

### Completion Evidence

* Packet and mapping validators plus focused semantic tests.

### Unresolved Items

* None.

<!-- rpi:task id=P01-T01 -->
### P01-T01: Freeze the source boundary and exact sequence

#### Context

The accepted WordPress post has nine issue-bearing blocks. They contain 84 mentions, but the later
Annihilators and Earthfall blocks repeat eight issues already named in the opening collection. First-source
deduplication yields 76 unique issues. Fresh source responses preserve the exact issue-bearing digest while
their full rendered HTML varies.

#### Intent

Create one immutable packet that binds the stable issue-bearing boundary and every unique source issue in
first-source order.

#### Boundaries

* Included: retrieval date, lowercase SHA-256 `sourceIssueBearingBlocksSha256`, source review, repeat
  treatment, exact source and range references, normalized series identities, manual context note, Complete
  guide proposal, insertion anchor, and packet digest.
* Excluded: parser output, full rendered-page hash equality, inferred `I Am Groot` rows whose link names no
  issue range, repeated selected rows, metadata approval, and relationship decisions.

#### Likely Targets

* scripts/data/cbh-packets/groot-reading-order.json
* scripts/lib/cbh-inventory.mjs
* test/cbh-character-spotlight.test.js

#### Dependencies

* Research W1 and exact 76-row reconstruction.

#### Validation Expectations

* Packet row 1 is Tales to Astonish #13, row 40 is Guardians of the Galaxy #25, row 41 is Groot (2015) #1,
  row 68 is Annihilation: Conquest - Starlord #1, row 72 is Shuri #3, and row 76 is Groot (2023) #4.
* `sourceIssueBearingBlocksSha256` equals
  `2f73854ba172a902a511cb2ae45ee4236bf81367166126667370c482c26478e3`, validates as lowercase SHA-256, and is
  included in packet digest calculation.
* The packet has 76 unique rows and records the eight second mentions as excluded because they are already
  represented, not because they are optional.

#### Completion Evidence

* Packet validator and exact source-sequence test pass. A malformed digest fails schema validation, while a
  different well-formed boundary digest with a recomputed packet digest fails the Groot semantic trust-root
  assertion.

#### Unresolved Items

* None.

<!-- rpi:task id=P01-T02 -->
### P01-T02: Generate and approve the exact mapping

#### Context

The existing preparation path resolves named packet rows through explicit series metadata. Research
independently validated each required series. The source's second Rocket Raccoon range is under two Rocket
Raccoon & Groot volumes and maps centrally to the exact 2016 ten-issue series.

#### Intent

Produce one exact 76-row mapping from the frozen packet and bind its approved manifest.

#### Boundaries

* Included: temporary inventory eligibility if required by current validation, exact candidate metadata,
  explicit series selection notes, selected issue IDs, Marvel issue URLs, packet review, approved manifest,
  and mapping digest.
* Excluded: score selection, approved exceptions, direct generated-payload edits, relationship approval, and
  any metadata outside the explicit source rows.

#### Likely Targets

* scripts/data/cbh-mappings/groot-reading-order.json
* scripts/data/cbh-character-inventory.json
* scripts/prepare-cbh-batch.mjs only if the existing exact-row contract cannot represent the packet unchanged.

#### Dependencies

* P01-T01.

#### Validation Expectations

* 76 exact rows, 76 unique selected IDs, zero unmatched, zero ambiguous, and zero exceptions.
* Mapping source references equal packet source references in order.
* Mapping digest and approved manifest validate.

#### Completion Evidence

* Named preparation summary and semantic mapping validation.

#### Unresolved Items

* None.

<!-- rpi:phase id=P02 -->
## P02: Approve and publish Groot

### Context

Pending final task detail.

### Intent

Approve all relationships and author one distinct guide.

### Boundaries

* Included: report, approval, order, payload, manifest, catalog, inventory.
* Excluded: any Rocket modification.

### Likely Targets

* scripts/data/cbh-overlaps/groot-reading-order.json
* src/data/orders/groot-reading-order.md
* src/data/groot_reading_order.json
* src/data/curated-lists.json
* src/data/catalog.json

### Dependencies

* P01.

### Validation Expectations

* Three partials and complete central disposition coverage.

### Completion Evidence

* Fresh report and approval digests plus exact authored output.

### Unresolved Items

* None.

<!-- rpi:task id=P02-T01 -->
### P02-T01: Regenerate and centrally approve every relationship

#### Context

The pre-publication catalog has 90 readings, including Rocket. Groot must compare against every reading
exactly once. Rocket is a named peer so its mapping digest is bound and it is excluded from the factual
current-library digest. Research found only three partials and no exact or subset relationship.

#### Intent

Generate one 90-comparison report and centrally approve every observed relationship with fresh digests.

#### Boundaries

* Included: current library excluding Groot and the named Rocket peer, Rocket peer mapping, all 90 comparison
  rows, policy authority for `none`, stronger-model authority for all three partials, and packet, mapping,
  library, peer, report, and approval digests.
* Excluded: changing an observed relationship, merging cards, treating a partial as exact or subset, omitting
  Rocket from peer evidence, and editing Rocket mapping.

#### Likely Targets

* scripts/data/cbh-overlaps/groot-reading-order.json
* scripts/data/cbh-mappings/groot-reading-order.json
* scripts/report-order-overlap.mjs
* scripts/author-cbh-packet.mjs
* test/cbh-character-spotlight.test.js
* test/cbh-batch.test.js for the reusable shipped-peer authoring guard.

#### Dependencies

* P01-T02 and current `main` reconciliation.

#### Validation Expectations

* 90 comparisons and 90 dispositions.
* Partials are exactly Annihilation: Conquest 4, Rocket Raccoon 41, and War of Kings 7.
* `peerDigests` contains only Rocket's fresh mapping digest.
* Stale library, peer, report, or approval evidence fails.

#### Completion Evidence

* Regenerated report equality, central approval validation, and negative peer-freshness test.

#### Unresolved Items

* None.

<!-- rpi:task id=P02-T02 -->
### P02-T02: Author and vendor the separate guide

#### Context

One-candidate authoring must accept the shipped Rocket mapping as reviewed peer evidence while preserving
Rocket in the manifest. The candidate remains ungrouped and is inserted before the existing X-Men entries,
matching the recent Character Spotlight chronology pattern.

#### Intent

Author one distinct Complete guide and vendor its exact payload without touching Rocket.

#### Boundaries

* Included: mandatory external named-peer authoring option, source order markdown, manifest entry, payload
  vendoring, generated catalog, inventory lifecycle, counts, and exact source identity.
* Excluded: packet-level cross-candidate merge, Rocket writes, manual payload editing, grouping, and Best of
  taxonomy.

#### Likely Targets

* scripts/author-cbh-packet.mjs
* scripts/data/cbh-character-inventory.json
* src/data/orders/groot-reading-order.md
* src/data/curated-lists.json
* src/data/groot_reading_order.json
* src/data/catalog.json

#### Dependencies

* P02-T01.

#### Validation Expectations

* Authoring reports one guide, 76 rows, and 91 manifest entries.
* The external Rocket peer is excluded from the reviewed library digest and ordinary existing-order set,
  added exactly once to expected comparisons and peer mappings, validated through its mapping digest, and
  retained unchanged in the manifest.
* Manifest, catalog, order, and payload sequences agree.
* Groot uses `character-run`, `complete-guide`, `group: null`, and count 76.
* Rocket packet, mapping, report, order, payload, manifest entry, and catalog entry do not change.

#### Completion Evidence

* Authoring and vendoring summaries plus byte-level or diff-backed Rocket non-change evidence.

#### Unresolved Items

* None.

<!-- rpi:phase id=P03 -->
## P03: Prove and document the release

### Context

Pending final task detail.

### Intent

Prove semantics, update product records, and pass release gates.

### Boundaries

* Included: existing test owners, direct documents, anchors, local and browser checks.
* Excluded: unrelated documentation cleanup.

### Likely Targets

* test/cbh-character-spotlight.test.js
* test/catalog-shelves.test.js
* CHANGELOG.md
* PRODUCT_BACKLOG.md
* docs/DATA_PROVENANCE.md
* docs/MAINTAINING.md
* docs/PUBLICATION_RUNBOOK.md
* docs/UX_STUDY.md

### Dependencies

* P02.

### Validation Expectations

* New focused tests fail without implementation and all requested gates pass with it.

### Completion Evidence

* Exact gate counts and browser observations in the changes record.

### Unresolved Items

* None.

<!-- rpi:task id=P03-T01 -->
### P03-T01: Add semantic and filter proof

#### Context

The existing Character Spotlight semantic test owns packet, mapping, report, order, payload, inventory, and
stale-evidence assertions. The shelf test owns explicit taxonomy counts and visibility.

#### Intent

Prove every caller-required semantic without creating a parallel test owner.

#### Boundaries

* Included: exact 76-row sequence, stable source-boundary freshness, exact mapping, 41-issue Rocket partial,
  all three relationship counts, peer digest, authoring freshness, final data equality, card taxonomy, All
  and Complete inclusion, Best of exclusion, and stale evidence rejection.
* Excluded: duplicate broad regression tests, network-dependent unit tests, and a new test file.

#### Likely Targets

* test/cbh-character-spotlight.test.js
* test/catalog-shelves.test.js
* test/cbh-batch.test.js for reusable external peer authoring coverage.
* test/cbh-batch-four.test.js only if an existing fourth-batch invariant is affected.

#### Dependencies

* P02-T02.

#### Validation Expectations

* Focused tests pass on the implementation.
* The source-freshness negative changes `sourceIssueBearingBlocksSha256`, recomputes `packetDigest`, and still
  fails the accepted Groot boundary assertion; malformed format and ordinary packet tampering fail for
  distinct reasons.
* The reusable authoring guard proves a shipped peer is excluded from the library digest, compared once,
  preserved in the manifest, and rejected when its mapping or peer digest is stale.
* Stashing only the production implementation files makes the completed Groot semantic test fail.
* Restoring the files returns the focused tests to green.

#### Completion Evidence

* Failure output from the no-fix proof and passing focused-test counts in the changes record.

#### Unresolved Items

* None.

<!-- rpi:task id=P03-T02 -->
### P03-T02: Update records and pass release gates

#### Context

The release changes product inventory and visible catalog counts. Direct documents already explain Character
Spotlight provenance, maintenance, publication, and UX taxonomy, so their affected counts and statements
must advance with the card.

#### Intent

Make product records agree with the release and complete all requested local and browser verification.

#### Boundaries

* Included: backlog status and detail, changelog, provenance, maintenance, publication runbook, UX study,
  count and size claims in touched sections, anchors, temporary browser script, and all requested gates.
* Excluded: unrelated document cleanup, historical artifact rewrites, unrequested count claims, and committed
  browser dependencies.

#### Likely Targets

* CHANGELOG.md
* PRODUCT_BACKLOG.md
* docs/DATA_PROVENANCE.md
* docs/MAINTAINING.md
* docs/PUBLICATION_RUNBOOK.md
* docs/UX_STUDY.md
* docs/anchors.lock.json
* .copilot-tracking/changes/2026-08-23/groot-complete-guide-changes.md

#### Dependencies

* P03-T01.

#### Validation Expectations

* Lint, full tests, counts, anchors, sizes, palette, publication, release checks, dash scan, diff inspection,
  live contract, and all repository-specific gates pass.
* Anchors are re-aimed from final diff arithmetic and head search, every bless pairing is read, and final
  report is zero drifted, zero new, zero removed.
* Installed Edge at 1280x900 and 390x844 observes All 13/12, Best of 5/5, Complete 4/4, Groot in All and
  Complete only, and no horizontal overflow.
* Temporary browser verification files are removed.

#### Completion Evidence

* Exact gate, contract, dash, diff, and browser results in the changes record.

#### Unresolved Items

* None.

<!-- rpi:phase id=P04 -->
## P04: Review and deliver the release

### Context

Pending final task detail.

### Intent

Run one Review and deliver the merged release.

### Boundaries

* Included: one Review, in-scope blocker fixes, PR, hosted CI, reconciliation, merge, durable result.
* Excluded: repeated Review or unrelated findings.

### Likely Targets

* .copilot-tracking/changes/2026-08-23/groot-complete-guide-changes.md
* .copilot-tracking/reviews/logs/2026-08-23/groot-complete-guide-review.md
* .copilot-tracking/rpi-sessions/2026-08-23/groot-complete-guide-state.json

### Dependencies

* P03.

### Validation Expectations

* Required hosted jobs pass and merged main contains the release.

### Completion Evidence

* Merged PR identity and final state.

### Unresolved Items

* None.

<!-- rpi:task id=P04-T01 -->
### P04-T01: Run the one independent Review and route findings

#### Context

Review occurs only after implementation and local verification are complete. Recovery-like evidence paths
receive the hardest inspection: changed source freshness, peer digest handling, and stale approval rejection.

#### Intent

Obtain one independent release verdict and resolve only material in-scope blockers.

#### Boundaries

* Included: source, sequence, mapping, peer relationship, stale evidence, taxonomy, data, documentation,
  release proof, and diff review; one review artifact; in-scope blocker fixes; routed unrelated items.
* Excluded: source edits by the reviewer, a second Review, and review loops for non-blocking follow-ups.

#### Likely Targets

* .copilot-tracking/reviews/logs/2026-08-23/groot-complete-guide-review.md
* .copilot-tracking/changes/2026-08-23/groot-complete-guide-changes.md

#### Dependencies

* P03-T02.

#### Validation Expectations

* One Review records readiness, findings, dispositions, and follow-ups.
* Any material in-scope blocker is fixed and affected gates rerun without repeating Review.

#### Completion Evidence

* Review verdict and routed finding record.

#### Unresolved Items

* None.

<!-- rpi:task id=P04-T02 -->
### P04-T02: Deliver, reconcile, and merge

#### Context

Concurrent event work can move `main`, so the release must reconcile again immediately before delivery. The
PR body begins with plain English, names no code identifier in that section, and records exact verification
counts in technical sections.

#### Intent

Deliver the reviewed release through hosted CI and merge it into current `main`.

#### Boundaries

* Included: final `origin/main` fetch, merge or rebase reconciliation without destructive commands, affected
  gate reruns, commit with required co-author trailer, plain-English-first PR, Node 20, Node 24 and lint job
  conclusions, merge, merged-tree confirmation, and durable state.
* Excluded: widening the PR, suppressing failed command output, dismissing real job failures as run-level
  noise, and leaving completion only in chat.

#### Likely Targets

* .copilot-tracking/rpi-sessions/2026-08-23/groot-complete-guide-state.json
* .copilot-tracking/changes/2026-08-23/groot-complete-guide-changes.md
* Git commit, pull request, hosted CI, and merge records.

#### Dependencies

* P04-T01.

#### Validation Expectations

* Final branch includes current `origin/main`.
* Any reconciled current-library, peer, or catalog change causes report and approval regeneration before the
  affected gates rerun.
* Required hosted jobs conclude success.
* PR merges and merged `main` contains the Groot release.
* Durable artifacts record commit, PR, CI, merge, and final lifecycle status.

#### Completion Evidence

* Commit SHA, PR number, job conclusions, merge commit, and final state.

#### Unresolved Items

* None.
