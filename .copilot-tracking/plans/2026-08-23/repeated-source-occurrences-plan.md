<!-- markdownlint-disable-file -->
# RPI Plan: Repeated source occurrences and Iron Man

## Task Metadata

* Task ID: MRT-002-C09-DUP
* Task slug: repeated-source-occurrences
* Planning status: Implementation-ready after one critique and three direct corrections
* Implementation status: P04-T03 in progress after RV-001 resolution
* Plan date: 2026-08-23
* Mode: delegated autopilot
* Baseline: final reconciled project default `main` at `f3b0875c5c45ffbb5b3a0f6337ba98345b70d896`
* Research: .copilot-tracking/research/2026-08-23/repeated-source-occurrences-research.md
* Phase details: .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-23/repeated-source-occurrences-plan-critique.md

## Executive Summary

This plan adds an explicit way to record when a source names the same comic more than once without
putting that comic into the reading sequence twice. The frozen source packet will keep one canonical
row per comic plus a machine-checked ledger for later source references. First occurrence is always
the reading placement. All existing mapping, overlap, authoring, and generated-output uniqueness
guards remain in force.

Iron Man was the intended first new guide, but its conditional publication gate closed during
implementation. The accepted source requires Crimson Dynamo #1-4, Iron Man: Viva Las Vegas #3-4,
and Iron Man Legacy #2, #5, and #10. The configured metadata contract cannot resolve those issues.
This release therefore ships the shared contract and Groot migration only, preserving Iron Man's
815/813 boundary as a blocked follow-up rather than shortening it.

### User Decisions and Requirements Highlights

* Preserve every source occurrence and its provenance while emitting each comic exactly once.
* Use deterministic first-occurrence placement and reject every unannotated canonical duplicate.
* Keep all selected issue ids unique for mapping, peer overlap, Markdown, payload, and catalog output.
* Publish Iron Man only if all 813 distinct issues resolve exactly; that condition failed, so no Iron
  Man product file or card enters this PR.
* Continue through one critique, implementation, failure proofs, one independent Review, one PR,
  Node 20, Node 24, and lint CI, merge, and durable completion.

### What You May Not Know

* The current shipped Groot guide has the same architecture gap: 84 source mentions are represented
  by 76 issues, while its eight later references are stored only as exclusion prose. This plan
  migrates that evidence without changing Groot's 76-item reading sequence or card.
* The historical CBRO provider delegates to the same packet validator and downstream mapping,
  overlap, approval, and authoring contracts. One shared optional schema covers both providers.
* The earliest confirmed Iron Man blocker is Crimson Dynamo #1 at canonical/source position 425.
  Additional confirmed gaps are Crimson Dynamo #2-4, Iron Man: Viva Las Vegas #3-4, and Iron Man
  Legacy #2, #5, and #10.

### Unresolved Decisions or Blockers

* No planning decision or critique finding remains open. Iron Man publication is blocked by nine
  source-required issues that the configured metadata contract cannot resolve.

For current user input, see [User Decisions and Requirements](#user-decisions-and-requirements).

## User Decisions and Requirements

* Use task ID MRT-002-C09-DUP and slug `repeated-source-occurrences`.
* Preserve all source occurrences and provenance, emit each comic once, forbid silent
  deduplication, and distinguish intentional source repetition from accidental data-entry
  duplication.
* Use deterministic first-occurrence canonical placement because all named evidence repeats an
  earlier issue and Planet Hulk's first placement is also the more specific interleaved order.
* Bind every repeated source reference into packet, mapping, report, and approval freshness.
* Keep selected issue ids unique for mapping, peer overlap, approval, authoring, Markdown, generated
  payload, and catalog output.
* Preserve existing CBH modern and character behavior and the CBRO historical provider flow.
* Cover Iron Man, Old Man Logan #19 and #25, Planet Hulk's repeated World War Hulk #1-5 block,
  current Groot compatibility, packet validation, stale digests, mapping uniqueness, peer overlap,
  authoring, Markdown provenance, and backward compatibility.
* Implement the smallest backward-compatible contract only after complete Research, an
  implementation-ready Plan, and one plan critique.
* Publish Iron Man, the rank-1 priority, only if all 815 source occurrences normalize to 813 exact
  unique mappings. Preserve the two later Tony Stark: Iron Man #15-16 references explicitly.
* The publication condition failed on exact metadata availability. Do not create an incomplete Iron
  Man packet, mapping, order, payload, or card; preserve the exact blocker as a follow-up.
* Do not publish Old Man Logan or Planet Hulk cards in this PR. Retain their exact shapes as tests
  and later follow-up work.
* Migrate Groot's eight already-represented references into the explicit contract without changing
  its selected sequence, relationships, card, or payload.
* Do not add a parser, infer missing issues, score ambiguous metadata, permit exception rows, relax
  unique-id guards, add runtime dependencies, change the fixed origin, store image bytes, or add em
  dashes.
* Update directly affected shared source, Groot evidence, inventory blocker text, tests,
  documentation, backlog, changelog, counts, and evidence anchors.
* Prove every new semantic guard fails without its fix. Run lint, full tests, counts, anchors through
  read-before-bless, publication and release checks, live metadata contract, dash scan, diff check,
  and installed Edge browser verification at 1280x900 and 390x844.
* Run exactly one independent post-implementation Review. Fix in-scope release blockers without
  repeating Review and route unrelated findings.
* Reconcile current `main`, commit with the required co-author trailer, open a PR beginning with
  `## In plain English`, record exact verification counts, pass Node 20, Node 24, and lint jobs,
  merge, and persist the merged result.

## Goals

* Add one additive, provider-neutral occurrence-evidence contract without weakening any unique comic
  identity contract.
* Migrate Groot as the shipped compatibility proof while keeping all user-visible reading behavior
  unchanged.
* Preserve the exact Iron Man 815/813 boundary and the nine confirmed metadata gaps without creating
  a shortened guide.
* Prove the three supplied duplicate shapes and every accidental or stale variant fail or normalize
  exactly as intended.
* Deliver one coherent reviewed and merged feature with durable RPI evidence.

## Scope and Non-Goals

### In Scope

* Optional packet and mapping fields `sourceOccurrenceCount` and `repeatedSourceReferences`.
* Always-on canonical packet identity uniqueness and exact repeated-reference validation.
* Packet-to-mapping occurrence mirroring, source-count semantics, digest propagation, approval
  equality, and conditional Markdown provenance for both CBH and CBRO.
* Groot packet, mapping, report, approval, and Markdown provenance refresh with no selected-id,
  payload, catalog, or card behavior change.
* Iron Man blocker evidence and inventory follow-up text naming the 815/813 boundary and nine
  unavailable issues; no Iron Man product file.
* Old Man Logan 98/96 and Planet Hulk 109/104 as regression fixtures only.

### Non-Goals

* Publishing Iron Man, Old Man Logan, or Planet Hulk.
* Replacing frozen packets with source-page parsers or automatic deduplication.
* Allowing canonical placement other than first occurrence.
* Removing or weakening resolver, overlap, peer, packet, authoring, or generated-output unique-id
  guards.
* Changing any existing guide selected sequence.
* Adding a second critique, a second independent Review, runtime dependencies, new test files, or
  unrelated product or documentation cleanup.

## Functional Requirements

* Frozen packets can represent intentional later source references without duplicate canonical rows.
  * Observable acceptance criteria: a repeated packet has `sourceOccurrenceCount` equal to
    `rows.length + repeatedSourceReferences.length`; every repeated record has one unique in-range
    source position, points to an earlier one-based canonical row, preserves raw issue and range
    references, and matches the canonical normalized title, year, and issue number.
* Canonical packet identity is always unique.
  * Observable acceptance criteria: duplicate candidate issue ids, series-id plus issue-number
    identities, or normalized title/year/issue fallbacks fail packet validation whether or not a
    repeated-reference ledger exists.
* First occurrence is the only reading placement.
  * Observable acceptance criteria: a forward canonical target, duplicate source position, identity
    mismatch, out-of-range position or row, empty ledger, inconsistent occurrence count, unsupported
    repeated-record field, or unannotated repeated canonical row fails.
* Canonical mapping positions retain their full source positions.
  * Observable acceptance criteria: preparation reconstructs all source positions, assigns each
    mapping row the first non-repeat occurrence position rather than `index + 1`, and leaves current
    no-repeat positions unchanged. Groot canonical row 72 maps to source position 80, and Iron Man
    canonical row 710 remains at source position 710 while canonical row 716 maps to source position
    718 after the two later references.
* Freshness binds every occurrence reference.
  * Observable acceptance criteria: changing any repeated source position, target, issue reference,
    range reference, normalized title, year, issue number, or total occurrence count stales the
    packet digest; stale packet-to-mapping mirrors, mapping digests, reports, and approvals fail.
* Approval re-derives occurrence-dependent mapping values.
  * Observable acceptance criteria: shared approval and authoring preflight reconstruct every
    expected canonical mapping `sourcePosition` and the occurrence-total `approvedSourceCount` from
    the validated packet, then rejects any mismatch even when mapping, report, and approval digests
    have all been recomputed self-consistently.
* Existing no-repeat packets remain compatible.
  * Observable acceptance criteria: optional fields may be absent; every current CBH and CBRO packet
    and mapping retains its existing digest meaning and passes unchanged.
* Mapping and overlap remain unique.
  * Observable acceptance criteria: only canonical packet rows enter metadata preparation;
    `approvedSourceCount` records total source occurrences when present; mapping rows, selected ids,
    report candidate ids, peer ids, Markdown checklist entries, and payload items remain distinct.
* CBRO keeps provider-specific source evidence.
  * Observable acceptance criteria: provider identity and source-content digest checks remain
    unchanged, and inventory `sourceRowCount` compares with `sourceOccurrenceCount` when present or
    `expectedCount` otherwise.
* Markdown states the normalization without duplicating checklist items.
  * Observable acceptance criteria: repeated packets add one provenance sentence naming total source
    occurrences, repeat count, and first-occurrence-only output; no-repeat Markdown remains
    byte-equivalent; each distinct comic appears once.
* Groot uses the new contract.
  * Observable acceptance criteria: 84 occurrences, 76 canonical rows, and eight repeated references
    at source positions 72-79 targeting canonical rows 8-15; selected ids, report relationships,
    payload, card, and 76-item sequence remain unchanged.
* Iron Man remains complete and blocked rather than shortened.
  * Observable acceptance criteria: durable evidence retains the 815 occurrences, 813 distinct
    identities, repeat positions 716-717 and canonical rows 708-709, and the nine confirmed missing
    metadata issues. No Iron Man packet, mapping, report, order, payload, card, or shipped inventory
    transition exists.

## Non-Functional Requirements

* Backward compatibility is exact.
  * Objective threshold or evaluation condition: no existing no-repeat packet, mapping, report,
    authoring output, provider identity, or digest changes merely because the optional schema exists.
  * Observable acceptance criteria: current compatibility fixtures and the full suite pass before
    candidate data is added.
* The safety boundary stays fail-closed.
  * Objective threshold or evaluation condition: zero code paths deduplicate selected ids after
    resolution or suppress duplicate errors.
  * Observable acceptance criteria: malformed occurrence evidence fails packet validation and
    duplicate mapping or overlap ids continue to fail existing guards.
* Runtime dependencies remain zero.
  * Objective threshold or evaluation condition: no runtime package or browser dependency is added.
  * Observable acceptance criteria: package runtime dependency count stays zero and browser checks
    use external scratch `puppeteer-core`.
* The release remains bounded and reviewable.
  * Objective threshold or evaluation condition: zero new product guides or product data files, no
    new test file, one critique, one Review, and one explicit Iron Man blocker.
  * Observable acceptance criteria: the final diff and PR record exactly those boundaries.
* Evidence and writing conventions remain intact.
  * Objective threshold or evaluation condition: all changed counts are re-derived, added prose has
    no em or en dash, and anchors finish with zero drifted, new, or removed after read-before-bless.
  * Observable acceptance criteria: gates and the changes record carry exact results.

## Acceptance Criteria

* The shared schema accepts the three intended 815/813, 98/96, and 109/104 shapes and rejects every
  malformed or accidental duplicate shape.
* All current no-repeat CBH and CBRO packets and mappings remain valid with unchanged semantics.
* Groot records 84 occurrences and eight explicit repeats while preserving all 76 selected ids and
  user-visible outputs.
* Iron Man remains unpublished with all nine confirmed missing issues recorded and no source row
  omitted or inferred.
* The reconciled final catalog remains 97 readings, 14 Character Spotlight readings, 13 Character
  Spotlight stories, and 5 Complete guides. Star-Lord arrived from current main; this feature adds no
  card or reading.
* Required failure proofs, local gates, browser checks, one Review, PR, Node 20/24/lint CI, merge,
  and durable completion all succeed.

## Locked Change and Test Boundaries

* Exact removals: none.
* Maximum new product data files: zero.
* Maximum new test files: zero.
* Canonical shared schema owner: `scripts/lib/cbh-inventory.mjs`.
* CBH preparation owner: `scripts/prepare-cbh-batch.mjs`.
* CBRO preparation and inventory compatibility owners: `scripts/prepare-cbro-event.mjs` and
  `scripts/lib/cbro-evidence.mjs`.
* Approval and Markdown owners: `scripts/author-cbh-packet.mjs` and
  `scripts/author-cbro-packet.mjs`.
* Shared semantic guard owner: `test/cbh-batch.test.js`.
* Character source and release owner: `test/cbh-character-spotlight.test.js`.
* Historical provider compatibility owner: `test/cbro-historical-events.test.js`.
* Existing resolver and overlap owners: `test/cbh-resolver.test.js` and
  `test/order-overlap-report.test.js`; additions only if current assertions do not cover unchanged
  uniqueness.
* Catalog owners: `test/catalog-shelves.test.js`, `test/catalog.test.js`, and `test/curated.test.js`.
* Iron Man blocker target: its existing record in `scripts/data/cbh-character-inventory.json` and
  the dated changes evidence only.
* Groot migration targets: its packet, mapping, overlap report, and order Markdown only unless
  deterministic regeneration proves another directly derived file changes.
* Semantic coverage: exact occurrence structure, canonical uniqueness, digest freshness, provider
  compatibility, reconstructed mapping source positions, Iron Man source ledger and sequence, Groot
  migration and reciprocal post-Iron review, mapping/overlap uniqueness, authoring provenance,
  taxonomy, and catalog counts.
* Regression coverage: full existing suite, unchanged no-repeat digest fixtures, generated order
  identity, browser shelves, and release gates.
* Required failure-proof matrix: half-present optional fields in both directions, empty ledger,
  occurrence-count mismatch, duplicate and out-of-range source positions, invalid and forward
  canonical targets, normalized identity mismatch, accidental canonical duplicate with no ledger,
  missing required repeated-record field, empty `sourceIssueReference`, invalid
  `sourceRangeReference`, unsupported repeated-record field,
  stale packet digest, stale or divergent packet-to-mapping mirrors, stale mapping/report/approval,
  self-consistently re-digested incorrect mapping `sourcePosition`, self-consistently re-digested
  incorrect `approvedSourceCount`, incorrect CBRO source-row fallback, incorrect reconstructed
  mapping source position, and missing conditional Markdown provenance. The two self-consistent
  derived-value tamper cases run through both CBH and CBRO approval and authoring paths.

## Implementation Context Record

| Context item | Current artifact or record |
|---|---|
| Plan | .copilot-tracking/plans/2026-08-23/repeated-source-occurrences-plan.md |
| Phase details | .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md |
| Latest critique | .copilot-tracking/reviews/plans/2026-08-23/repeated-source-occurrences-plan-critique.md, Revise with PC-001 through PC-003 resolved directly |
| Relevant research | .copilot-tracking/research/2026-08-23/repeated-source-occurrences-research.md, Complete and Ready |
| Changes-record role | .copilot-tracking/changes/2026-08-23/repeated-source-occurrences-changes.md is created by implementation as its evidence record |
| Planning execution and readiness | Complete and implementation-ready after the sole critique |
| Continuation context | Automatic parent-authorized continuation to P01 |

## Sources

* .copilot-tracking/research/2026-08-23/repeated-source-occurrences-research.md: selected design,
  alternatives, exact blocker shapes, compatibility evidence, scratch proof, and risks.
* Commit `06c2a5b6d6367706d241fcbefe41ce71aaa08f02`: Iron Man 815/813 source ledger and stop evidence.
* Commit `8a3c8629253e079e117fc7218b5b9bc8a070d876`: Old Man Logan and Planet Hulk candidate evidence,
  treated as historical and not merged implementation.
* Current `main` at `b9367d8bdf40cf335caf1c6b2d46dfedb5e25826`: shared CBH and CBRO contracts and current catalog.

## Phase Checklist

<!-- rpi:phase id=P01 -->
### [x] P01: Implement the shared occurrence contract

* Intent: Add one additive validation and freshness model, migrate Groot, and prove provider
  compatibility without changing selected comic output.
* Dependencies: Complete Research and one passed or dispositioned Plan critique.

<!-- rpi:task id=P01-T01 -->
#### [x] P01-T01: Add packet occurrence validation and digest plumbing

* Requirement and evidence: Research C2-C6, C14-C16 define the flat ledger, always-on uniqueness,
  optional compatibility, and digest root.
* Expected result: shared validator, source-position reconstruction, and mapping digest logic accept
  intentional repeats and reject malformed or accidental duplicates without changing old digest
  meaning.
* Detail section: P01-T01 in .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md

<!-- rpi:task id=P01-T02 -->
#### [x] P01-T02: Propagate provider, approval, and Markdown provenance

* Requirement and evidence: Research C4, C7-C8, C13, and C16 define mapping mirrors, CBRO count
  compatibility, authoring equality, and conditional provenance.
* Expected result: CBH and CBRO preparation and authoring preserve unique output, fail stale
  occurrence evidence, and reject self-consistent downstream digests whose derived source positions
  or approved source count differ from the packet.
* Detail section: P01-T02 in .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md

<!-- rpi:task id=P01-T03 -->
#### [x] P01-T03: Migrate Groot and prove all occurrence shapes

* Requirement and evidence: Research C9-C15 and W1 define Iron Man, Old Man Logan, Planet Hulk, and
  Groot exact shapes.
* Expected result: the complete mutation matrix fails before the fix, all three blocker fixtures pass
  only with explicit ledgers, malformed variants fail, canonical mapping positions reconstruct the
  full occurrence sequence, and Groot preserves its 76 selected ids.
* Detail section: P01-T03 in .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md

<!-- rpi:phase id=P02 -->
### [x] P02: Preserve the exact Iron Man blocker

* Intent: Record the closed publication gate without shortening the 815/813 source boundary or
  creating complete-looking candidate artifacts.
* Dependencies: P01 complete.

<!-- rpi:task id=P02-T01 -->
#### [x] P02-T01: Verify and record unavailable source-required issues

* Requirement and evidence: User direction requires a genuine stop when all 813 distinct issues
  cannot map exactly.
* Expected result: durable evidence names Crimson Dynamo #1-4, Iron Man: Viva Las Vegas #3-4, and
  Iron Man Legacy #2, #5, and #10 as missing; Iron Man remains deferred with no packet, mapping,
  report, order, payload, or card.
* Detail section: P02-T01 in .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md

<!-- rpi:phase id=P03 -->
### [x] P03: Document and prove the shared release

* Intent: Make direct records agree with the shared contract, Groot migration, and blocked Iron Man
  outcome, then prove unchanged product behavior.
* Dependencies: P02 blocker evidence complete.

<!-- rpi:task id=P03-T01 -->
#### [x] P03-T01: Update direct records and blocker state

* Requirement and evidence: Repository conventions require inventory, backlog, changelog,
  provenance, maintenance, publication, UX, count, and anchor agreement for shipped workflow work.
* Expected result: direct records describe the new explicit occurrence model, Groot 84/76 migration,
  and Iron Man's nine-issue metadata blocker; catalog counts remain unchanged.
* Detail section: P03-T01 in .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md

<!-- rpi:task id=P03-T02 -->
#### [x] P03-T02: Prove the release locally and in installed Edge

* Requirement and evidence: Caller and repository gates require failure proofs, full checks, live
  contract, dash scan, and wide and narrow browser observations.
* Expected result: every required local and browser gate passes, reconciled Character Spotlight
  remains 14 readings / 13 stories / 5 Complete guides, and no temporary artifact remains.
* Detail section: P03-T02 in .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md

<!-- rpi:phase id=P04 -->
### [~] P04: Review and deliver the release

* Intent: Reconcile current main and rerun affected gates, run one independent Review on that final
  candidate, fix material in-scope blockers once, and merge one CI-green PR.
* Dependencies: P03 complete.

<!-- rpi:task id=P04-T01 -->
#### [x] P04-T01: Reconcile current main and refresh final evidence

* Requirement and evidence: Packet, mapping, library, report, approval, count, and anchor evidence is
  baseline-sensitive and must be final before the one Review.
* Expected result: the branch is reconciled, shared and Groot evidence is regenerated when needed,
  the Iron Man blocker remains exact, and all affected gates pass on the review candidate.
* Detail section: P04-T01 in .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md

<!-- rpi:task id=P04-T02 -->
#### [x] P04-T02: Run one independent Review and route findings

* Requirement and evidence: Updated caller direction permits exactly one Review after the final
  reconciliation candidate exists.
* Expected result: review findings are fixed or routed without a second Review, affected gates rerun,
  and no material in-scope finding remains open.
* Detail section: P04-T02 in .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md

<!-- rpi:task id=P04-T03 -->
#### [~] P04-T03: Open the PR, pass CI, and merge

* Requirement and evidence: Updated caller direction requires a plain-English-first PR, required
  trailer, Node 20/24/lint CI, final no-drift fetch, merge, and durable completion.
* Expected result: one merged PR contains the bounded feature; repository artifacts record all
  pre-merge evidence, and a post-merge PR comment plus parent completion record persist the merge SHA
  and default-branch verification that cannot exist inside the merged commit.
* Detail section: P04-T03 in .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md

## Dependencies

* Complete Research at .copilot-tracking/research/2026-08-23/repeated-source-occurrences-research.md.
* Exactly one plan critique with every finding disposition recorded below before implementation.
* Historical Iron Man source ledger from commit `06c2a5b6d6367706d241fcbefe41ce71aaa08f02`.
* Existing metadata snapshot and live contract endpoint for exact issue resolution.
* Current library and catalog after final `origin/main` reconciliation.
* Installed Edge and external scratch `puppeteer-core` for browser checks.
* GitHub-hosted Node 20, Node 24, and lint jobs.

## Critique Disposition

| Critique run and finding | Disposition | Plan response or residual risk |
|---|---|---|
| PC-001 | resolved | Corrected Iron Man reconstruction: canonical row 710 stays at source position 710; row 716 maps to position 718. Plan and details require both assertions. |
| PC-002 | resolved | P01-T02 now requires shared approval and authoring preflight to re-derive every mapping source position and approved source count from the packet, with self-consistent tamper tests for both providers. |
| PC-003 | resolved | The locked failure matrix and P01-T01 now explicitly cover missing, empty, invalid, and extra repeated-record fields. |

## Follow-Up Items

* Iron Man: the repeated-source architecture is unblocked, but publication remains blocked until the
  configured metadata contract can resolve Crimson Dynamo #1-4, Iron Man: Viva Las Vegas #3-4, and
  Iron Man Legacy #2, #5, and #10. Preserve the 815/813 boundary and rerun complete exact mapping
  rather than removing any issue.
* Old Man Logan: later product work should create its exact 98-occurrence / 96-unique packet with
  repeated source position 47 targeting canonical row 39 for #19 and position 60 targeting row 52
  for #25, then run candidate-specific metadata and overlap review.
* Planet Hulk: later product work should create its exact 109-occurrence / 104-unique packet with
  repeated source positions 39-43 targeting canonical rows 27, 29, 31, 34, and 36 for World War Hulk
  #1-5, then run candidate-specific metadata and overlap review.

## Handoff

* Implementation artifact: .copilot-tracking/changes/2026-08-23/repeated-source-occurrences-changes.md
* Ready phase or task: P01 and P01-T01.
* Remaining provisional question or blocker: None for the shared release. Iron Man is a follow-up
  blocker and is no longer an active publication task.
