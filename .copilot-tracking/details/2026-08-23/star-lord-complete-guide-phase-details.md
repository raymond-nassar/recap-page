<!-- markdownlint-disable-file -->
# RPI Phase Details: Star-Lord complete guide

## Metadata

* Task ID: MRT-002-C08
* Task slug: star-lord-complete-guide
* Related plan: .copilot-tracking/plans/2026-08-23/star-lord-complete-guide-plan.md
* Evidence sources: .copilot-tracking/research/2026-08-23/star-lord-complete-guide-research.md

## Phase Index

| Phase ID | Name | Status | Detail sections |
|---|---|---|---|
| P01 | Freeze and map Star-Lord | complete | P01, P01-T01, P01-T02 |
| P02 | Approve and publish Star-Lord | complete | P02, P02-T01, P02-T02 |
| P03 | Prove and document the release | complete | P03, P03-T01, P03-T02 |
| P04 | Review and deliver the release | active | P04, P04-T01, P04-T02 |

## Task-Level Context

### Context

Research independently reproduced the stable twelve-block Star-Lord source boundary and all 99 issues
in displayed order. The current workflow supports fresh exact mapping plus Rocket and Groot peer
digests. Current `main` is merged pull request 176 at `233c463`.

### Intent

Publish Star-Lord as a separate Complete Character Spotlight guide without altering any existing guide
or weakening the freshness-bound evidence workflow.

### Boundaries

* Included: candidate evidence, one card and payload, inventory, taxonomy counts, semantic proof,
  directly affected documents, gates, browser checks, one Review, PR, CI, reconciliation, merge,
  and completion state.
* Excluded: Rocket or Groot edits, combined or shortened guides, parsers, heuristic or inferred
  metadata, exception rows, unrelated events, second critique, and second Review.

### Initial Evidence and Readiness

* Research status: Complete and Ready.
* Candidate: Star-Lord, 99 exact source-defined issues pending fresh named metadata regeneration.
* Selected peers: Rocket Raccoon and Groot.
* Expected final counts: 97 readings; 14 Character Spotlight readings; 13 stories; All 14/13,
  Best of 5/5, Complete 5/5.
* Planning blockers: none before the fail-closed metadata gate.

### Unresolved Items

* None.

<!-- rpi:phase id=P01 -->
## P01: Freeze and map Star-Lord

### Context

The phase starts from the independently reproduced 99-row order and current source response. It
binds that order to a literal 99-entry test sequence, a literal source-blocks digest, and the
independently derived ordered-sequence acceptance digest before metadata work begins.

### Intent

Create fresh source and exact mapping evidence without parsing, inference, or old digest reuse.

### Boundaries

* Included: source freshness, packet rows, exact mapping, inventory eligibility, and digests.
* Excluded: relationship approval and publication.

### Likely Targets

* scripts/data/cbh-packets/star-lord-reading-order.json
* scripts/data/cbh-mappings/star-lord-reading-order.json
* scripts/data/cbh-character-inventory.json
* test/cbh-character-spotlight.test.js

### Dependencies

* Completed Research.

### Validation Expectations

* Exactly 99 unique packet and mapping rows with fresh evidence, zero unmatched, and zero ambiguous.

### Completion Evidence

* Packet and mapping validators plus exact sequence tests.

### Unresolved Items

* None.

<!-- rpi:task id=P01-T01 -->
### P01-T01: Freeze the source boundary and exact sequence

#### Context

The live and archived pages expose the same twelve `Collects:` blocks. They expand to 99 unique
issues. The current WordPress rendered-content digest differs from the older snapshot by two
characters, so old source bytes cannot be reused even though the issue-bearing boundary is stable.

#### Intent

Create one immutable packet that binds the fresh source evidence and all 99 source issues in displayed
order.

#### Boundaries

* Included: fresh retrieval date, fresh source content or issue-bearing sequence digest, explicit
  exclusions, source review, exact source and range references, normalized series identities,
  approved manual context notes, Complete guide proposal, insertion anchor, and packet digest.
* Excluded: parser output, inferred Annihilation: Conquest or Wastelanders rows, metadata approval,
  old digest reuse, and relationship decisions.

#### Likely Targets

* scripts/data/cbh-packets/star-lord-reading-order.json
* scripts/data/cbh-character-inventory.json
* test/cbh-character-spotlight.test.js

#### Dependencies

* Research W1-W3 and the exact 99-row reconstruction.

#### Validation Expectations

* The semantic test contains a literal 99-entry expected sequence and a literal expected
  source-blocks digest derived independently from the source-verification artifact.
* The packet has 99 unique rows and reproduces the independently derived ordered-sequence digest
  `8e604a0e5f77a1d927be683aa5325da0ede70a658dacf9b7d0661f4213813aa8`.
* A negative case that numerically sorts rows 66 through 77 fails the exact-sequence assertion.
* Explicit exclusions name the Annihilation, Annihilation: Conquest, Wastelanders, product, related,
  and prose references that have no issue-bearing `Collects:` range.

#### Completion Evidence

* Packet validator, digest checks, and exact source-sequence test pass. Omission, malformed digest,
  and stale self-consistent source evidence fail distinct semantic assertions.

#### Unresolved Items

* None.

<!-- rpi:task id=P01-T02 -->
### P01-T02: Generate and approve the exact mapping

#### Context

Prior C05 probes found all rows available but retained no packet or mapping. Fresh named preparation
must reproduce each issue through explicit series and number identity. Marvel Super Special #10 and
the FCBD source #1 to metadata #0 translation require explicit reviewed notes.

#### Intent

Produce one exact 99-row mapping from the frozen packet and bind its approved manifest.

#### Boundaries

* Included: temporary inventory eligibility if required, exact candidate metadata, explicit series
  selection notes, selected IDs, Marvel issue URLs, packet review, approved manifest, and mapping
  digest.
* Excluded: scoring, approved exceptions, direct generated-payload edits, relationship approval,
  and metadata outside explicit source rows.

#### Likely Targets

* scripts/data/cbh-mappings/star-lord-reading-order.json
* scripts/data/cbh-character-inventory.json
* scripts/prepare-cbh-batch.mjs only if current named packet preparation cannot represent the rows.

#### Dependencies

* P01-T01.

#### Validation Expectations

* 99 exact rows, 99 unique selected IDs, zero unmatched, zero ambiguous, and zero exceptions.
* Mapping source references equal packet references in order.
* Marvel Super Special #10 resolves to issue 50896.
* FCBD 2017 All-New Guardians of the Galaxy source #1 resolves to issue 62818 numbered #0 with an
  explicit note, not a heuristic choice.

#### Completion Evidence

* Named preparation summary, exact mapping validation, and fresh mapping digest.

#### Unresolved Items

* None.

<!-- rpi:phase id=P02 -->
## P02: Approve and publish Star-Lord

### Context

This phase starts only after the complete literal sequence and all 99 metadata identities validate.
It generates the full current-library and selected-peer report before any guide data is authored.

### Intent

Approve every current-library and selected-peer relationship and author one distinct guide.

### Boundaries

* Included: report, approval, order, payload, manifest, catalog, inventory.
* Excluded: changes to Rocket, Groot, or historical events.

### Likely Targets

* scripts/data/cbh-overlaps/star-lord-reading-order.json
* scripts/data/cbh-mappings/star-lord-reading-order.json
* src/data/orders/star-lord-reading-order.md
* src/data/star_lord_reading_order.json
* src/data/curated-lists.json
* src/data/catalog.json

### Dependencies

* P01.

### Validation Expectations

* Complete report and disposition coverage with fresh Rocket and Groot peer digests.

### Completion Evidence

* Fresh report and approval digests plus exact authored output.

### Unresolved Items

* None.

<!-- rpi:task id=P02-T01 -->
### P02-T01: Regenerate and centrally approve every relationship

#### Context

The pre-publication catalog has 96 readings. Rocket and Groot are named peers so their mapping digests
are bound and both are excluded from the factual current-library digest. Prior evidence expects 25
shared issues with each, but every current-library and peer relationship must be freshly observed.

#### Intent

Generate one 96-comparison report and centrally approve every observed relationship with fresh digests.

#### Boundaries

* Included: current library excluding Star-Lord and the two named peers, Rocket and Groot peer
  mappings, all comparisons, policy authority for `none`, stronger-model authority for every subset
  or partial, and packet, mapping, library, peer, report, and approval digests.
* Excluded: changing observed relationships, merging cards, treating a partial as exact, omitting
  either peer, and editing either peer mapping.

#### Likely Targets

* scripts/data/cbh-overlaps/star-lord-reading-order.json
* scripts/data/cbh-mappings/star-lord-reading-order.json
* test/cbh-character-spotlight.test.js
* test/cbh-batch.test.js only for a missing reusable stale-peer guard.

#### Dependencies

* P01-T02 and current `main` reconciliation.

#### Validation Expectations

* 96 comparisons and 96 dispositions.
* Rocket and Groot each reproduce 25 shared issues and remain partial relationships.
* `peerDigests` contains exactly Rocket and Groot with their fresh mapping digests.
* The pre-committed non-none set was Rocket 25, Groot 25, and `war-of-kings` 7. Fresh exact-ID
  reporting also found `infinity-countdown-wars` 1 through Guardians of the Galaxy #150. The final
  set is those four partials with 92 none.
* Stale library, either peer, report, omitted disposition, or approval evidence fails.

#### Completion Evidence

* Regenerated report equality, central approval validation, exact relationship assertions, and
  negative freshness tests.

#### Unresolved Items

* None.

<!-- rpi:task id=P02-T02 -->
### P02-T02: Author and vendor the separate guide

#### Context

One-candidate authoring must accept Rocket and Groot as shipped reviewed peer evidence while preserving
both in the manifest. The candidate remains ungrouped and is inserted after Groot immediately before
`xmen-claremont`, preserving the sequential split-release decision.

#### Intent

Author one distinct Complete guide and vendor its exact payload without touching existing guides.

#### Boundaries

* Included: both named-peer authoring arguments, source-order Markdown, manifest entry, payload
  vendoring, generated catalog, inventory lifecycle, counts, and exact source identity.
* Excluded: cross-candidate merge, existing guide writes, manual payload editing, grouping, and Best
  of taxonomy.

#### Likely Targets

* scripts/data/cbh-character-inventory.json
* src/data/orders/star-lord-reading-order.md
* src/data/curated-lists.json
* src/data/star_lord_reading_order.json
* src/data/catalog.json

#### Dependencies

* P02-T01.

#### Validation Expectations

* Authoring reports one guide, 99 rows, and 97 manifest entries.
* Both peers are excluded from the reviewed library digest, added once as peers, validated through
  fresh mapping digests, and retained unchanged in the manifest.
* Manifest, catalog, packet, mapping, Markdown, and payload sequences agree.
* Star-Lord uses `character-run`, `complete-guide`, `group: null`, and count 99.
* The inventory record advances `sourceContentSha256`, `sourceBoundaryStatus`,
  `metadataHorizonStatus`, `disposition`, `reason`, `catalogIds`, `overlapIds`,
  `deliveryStatus`, and `centralDisposition`; its source digest equals the packet's fresh evidence.
* Existing packet, mapping, report, order, payload, manifest, and catalog entries do not change.

#### Completion Evidence

* Authoring and vendoring summaries plus diff-backed existing-guide non-change evidence.

#### Unresolved Items

* None.

<!-- rpi:phase id=P03 -->
## P03: Prove and document the release

### Context

This phase adds proof to the existing semantic and shelf-test owners, updates only product records
whose release facts changed, and executes both rerunnable repository gates and real-catalog browser
checks.

### Intent

Prove semantics, update product records, and pass release gates.

### Boundaries

* Included: existing test owners, directly affected documents, anchors, local and browser checks.
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

* New focused tests fail without implementation and every requested gate passes with it.

### Completion Evidence

* Exact gate counts and browser observations in the changes record.

### Unresolved Items

* None.

<!-- rpi:task id=P03-T01 -->
### P03-T01: Add semantic, filter, and chronology proof

#### Context

The existing Character Spotlight semantic test owns packet, mapping, report, order, payload, inventory,
peer, and stale-evidence assertions. The shelf test owns taxonomy counts and visibility.

#### Intent

Prove every caller-required semantic without creating a parallel test owner.

#### Boundaries

* Included: exact 99-row sequence, source freshness, exact mapping, complete-current-library coverage,
  25-issue Rocket and Groot peer partials, all generated relationship counts, both peer digests,
  authoring freshness, final data equality, inventory, card taxonomy, All and Complete inclusion,
  Best of exclusion, sequential insertion, and stale-evidence rejection.
* Excluded: duplicate broad regression tests, network-dependent unit tests, and a new test file.

#### Likely Targets

* test/cbh-character-spotlight.test.js
* test/catalog-shelves.test.js
* test/cbh-batch.test.js only if a reusable two-peer stale case is absent.

#### Dependencies

* P02-T02.

#### Validation Expectations

* Focused tests pass on the implementation.
* Stale source, packet, mapping, library, either peer, report, omitted disposition, and approval
  mutations fail for their intended reasons.
* A full literal expected sequence and source-blocks digest reject a numeric reorder of source rows
  66 through 77.
* Filter tests assert All 14/13, Best of 5/5, Complete 5/5, and Star-Lord only in All and Complete.
* Chronology asserts Star-Lord follows Groot and immediately precedes `xmen-claremont`.
* Stashing only defended production files makes the completed Star-Lord tests fail.

#### Completion Evidence

* No-fix failure output and passing focused-test counts in the changes record.

#### Unresolved Items

* None.

<!-- rpi:task id=P03-T02 -->
### P03-T02: Update records and pass release gates

#### Context

The release changes visible catalog and Character Spotlight counts. Direct documents already explain
provenance, maintenance, publication, and UX taxonomy, so their affected counts and statements must
advance with the card.

#### Intent

Make product records agree with the release and complete all requested local and browser verification.

#### Boundaries

* Included: backlog status and detail, changelog, provenance, maintenance, publication runbook, UX
  study, a user-facing note that the linked Annihilation: Conquest Starlord miniseries is excluded
  because the source supplies no issue-bearing range, count and size claims in touched sections,
  anchors, the committed browser gate, a temporary real-catalog browser script, and requested gates.
* Excluded: unrelated cleanup, historical artifact rewrites, unrequested count claims, and committed
  browser dependencies.

#### Likely Targets

* CHANGELOG.md
* PRODUCT_BACKLOG.md
* docs/DATA_PROVENANCE.md
* docs/MAINTAINING.md
* docs/PUBLICATION_RUNBOOK.md
* docs/UX_STUDY.md
* docs/anchors.lock.json
* .copilot-tracking/changes/2026-08-23/star-lord-complete-guide-changes.md

#### Dependencies

* P03-T01.

#### Validation Expectations

* `npm run lint`, `npm test`, `npm run counts`, `npm run anchors`, `npm run sizes`,
  `npm run palette`, `npm run publication`, `npm run contract`, and `npm run browser` pass.
  Release checks are the complete enumerated gate set rather than an unnamed command; diff
  inspection is a manual review of the final branch diff.
* The counts command covers the backlog only. Every count in other touched documents is re-derived
  manually against the final tree.
* All new and changed files, including force-added tracking artifacts, are staged before the first
  anchors run. Anchors are rerun after blessing.
* Anchors are re-aimed from final diff arithmetic and head search, every bless pairing is read, and
  final report is zero drifted, zero new, zero removed.
* The dash scan writes the diff to a UTF-8 file and reads it back; it does not pipe the diff through
  PowerShell.
* Installed Edge at 1280x900 and 390x844 observes All 14/13, Best of 5/5, Complete 5/5, Star-Lord in
  All and Complete only, and no horizontal overflow.
* The committed browser gate runs first. The temporary script additionally uses the real catalog
  because the committed gate deliberately uses fixtures.
* Temporary browser files are removed.

#### Completion Evidence

* Exact gate, contract, dash, diff, and browser results in the changes record.

#### Unresolved Items

* None.

<!-- rpi:phase id=P04 -->
## P04: Review and deliver the release

### Context

This phase starts from a locally verified release, obtains the single independent Review, routes
its findings once, then delivers through a plain-English-first pull request, required hosted jobs,
final reconciliation, merge, and durable completion evidence.

### Intent

Run one independent Review and deliver the merged release.

### Boundaries

* Included: one Review, in-scope blocker fixes, PR, hosted CI, reconciliation, merge, durable result.
* Excluded: repeated Review or unrelated findings.

### Likely Targets

* .copilot-tracking/changes/2026-08-23/star-lord-complete-guide-changes.md
* .copilot-tracking/reviews/logs/2026-08-23/star-lord-complete-guide-review.md

### Dependencies

* P03.

### Validation Expectations

* Required hosted jobs pass and merged main contains the release.

### Completion Evidence

* Review verdict, PR, job conclusions, merge identity, and final durable state.

### Unresolved Items

* None.

<!-- rpi:task id=P04-T01 -->
### P04-T01: Run the one independent Review and route findings

#### Context

Review occurs only after implementation and local verification. The highest-risk paths are source
freshness, two-peer digest handling, full relationship dispositions, and stale approval rejection.

#### Intent

Obtain one independent release verdict and resolve only material in-scope blockers.

#### Boundaries

* Included: source, sequence, mapping, current library, both peers, stale evidence, taxonomy,
  chronology, data, documentation, release proof, and diff review; one review artifact; in-scope
  blocker fixes; routed unrelated items.
* Excluded: reviewer source edits, a second Review, and loops for non-blocking findings.

#### Likely Targets

* .copilot-tracking/reviews/logs/2026-08-23/star-lord-complete-guide-review.md
* .copilot-tracking/changes/2026-08-23/star-lord-complete-guide-changes.md

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

Concurrent work can move `main`, so the release reconciles immediately before delivery. The PR opens
with plain English and records exact technical verification counts.

#### Intent

Deliver the reviewed release through hosted CI and merge it into current `main`.

#### Boundaries

* Included: final `origin/main` fetch, non-destructive reconciliation, affected gate reruns, commit
  with required trailer, plain-English-first PR, Node 20, Node 24 and lint job conclusions, merge,
  merged-tree confirmation, and durable state.
* Excluded: widening the PR, suppressing failed output, dismissing real job failures as run-level
  noise, and leaving completion only in chat.

#### Likely Targets

* .copilot-tracking/changes/2026-08-23/star-lord-complete-guide-changes.md
* .copilot-tracking/rpi-sessions/2026-08-23/star-lord-complete-guide-state.json if the automatic
  coordinator requires a final machine-readable lifecycle record.
* Git commit, pull request, hosted CI, and merge records.

#### Dependencies

* P04-T01.

#### Validation Expectations

* Final branch includes current `origin/main`.
* Any library, peer, or catalog change regenerates the report and approval before affected gates rerun.
* Required hosted jobs conclude success.
* PR merges and merged `main` contains the Star-Lord release.
* Durable artifacts record commit, PR, CI, merge, and final lifecycle status.

#### Completion Evidence

* Commit SHA, PR number, job conclusions, merge commit, and final state.

#### Unresolved Items

* None.
