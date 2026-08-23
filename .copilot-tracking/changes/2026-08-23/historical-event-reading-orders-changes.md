<!-- markdownlint-disable-file -->
# RPI Changes: Historical event reading orders

## Metadata

* Task ID: MRT-003
* Related plan: .copilot-tracking/plans/2026-08-23/historical-event-reading-orders-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md
* Implementation date: 2026-08-23

## Execution Status

* Status: Partial
* Declared invocation scope: full plan
* Active marker: P07-T03
* Completed scope markers: P01 through P06, P07-T01, P07-T02, and P01-T01 through P06-T02
* All remaining active-plan markers: P07 and P07-T03
* Status basis: Planning and the single critique are complete. Implementation begins with mandatory
  current-main and selected-source freshness reconciliation before any product authoring.

## Execution Summary

The approved five-event and 23-issue release is active. Research artifacts are immutable baseline
inputs. Refreshed source and library facts will be written only to implementation-owned CBRO
inventory, packet, mapping, report, approval, product, and changes evidence.

## Approved Write Boundary

* Provider tooling: at most one CBRO evidence adapter, one preparation entry point, and one authoring
  entry point, with narrow backward-compatible changes to source-neutral existing primitives.
* Canonical data: one 58-entry CBRO inventory, five packets, five mappings, five reports and central
  approvals, five Markdown checklists, and five manifest entries.
* Generated data: five payloads and regenerated catalog.
* Tests: one new CBRO test file with exactly 14 owned semantic cases, plus existing regression tests.
* Records: directly related backlog, changelog, provenance, maintenance, publication, anchors, plan,
  details, changes, review, PR, CI, and final state.
* Excluded: additional events, runtime dependencies or UI changes, source prose or images, CBH evidence
  relabeling, existing CBH packet rewrites, and delegated central authority.

## Completed Work

### Current main and selected source snapshots reconciled

* Related phase or task: P01-T01
* Files: read-only main, source, manifest, payload, and research evidence inputs
* What changed and why: No source file changed. Fetched current main and all five selected CBRO pages
  before authoring so implementation starts from current catalog and source bytes.
* Completion evidence: Local HEAD and `origin/main` both resolve to
  `086cc5bbbbfa61cae95983e0acede47aeffa2dc8`. The library remains 89 lists with digest
  `30a01783e36ea7e1a799725e8164805c57f17f79e9697d65201d6cb288ef2cab`. All five HTTP 200
  responses matched their reviewed SHA-256 digests.
* Validation: Passed. Muir Island Saga, Bloodties, Midnight Massacre, Child's Play, and Eighth Day
  each matched the research source digest under the five-second source delay.

### Provider-aware evidence seam established

* Related phase or task: P01-T02
* Files: `scripts/lib/cbh-inventory.mjs`, `scripts/author-cbh-packet.mjs`,
  `scripts/lib/cbro-evidence.mjs`
* What changed and why: Added optional provider and source-content identity to the generic packet and
  mapping digest boundary, preserved CBH defaults, and added a dedicated CBRO provider configuration
  and validator. Approval validation now accepts an explicit packet provider while defaulting to CBH.
* Completion evidence: Existing CBH packets remain valid without provider fields or digest changes.
  CBRO packets require the exact provider, host, source origin, and SHA-256.
* Validation: Passed in the 29-test focused provider, resolver, and approved CBH packet run.

### Provider and freshness semantics locked

* Related phase or task: P01-T03
* Files: `test/cbro-historical-events.test.js`
* What changed and why: Added the six allocated provider-stage cases for provider identity, canonical
  source digest, mapping identity binding, CBH backward compatibility, stale evidence rejection, and
  central relationship authority.
* Completion evidence: All six new cases and 23 existing focused regression cases passed.
* Validation: Passed, 29 tests, 0 failed.

### Complete pre-cutoff inventory persisted

* Related phase or task: P02-T01
* Files: `scripts/data/cbro-historical-inventory.json`, `scripts/lib/cbro-evidence.mjs`
* What changed and why: Persisted all 58 positions before Maximum Security with provider, exact page
  or visible timeline section, source digest, row count, selected, deferred, subset, blocked, absorbed,
  and provenance state. Added a validator that refuses count, position, identity, source, state, or
  cutoff drift.
* Completion evidence: Inventory contains positions 1 through 58, the exact five selected ids, and
  precise Days of Future Present, Countdown, Legion Quest, and Marvel vs DC outcomes.
* Validation: Passed during packet selection and mapping preparation.

### Five source packets frozen

* Related phase or task: P02-T02
* Files: five files under `scripts/data/cbro-packets/`
* What changed and why: Bound explicit provider identity, exact page URL, content SHA-256, active issue
  panel, exclusions, ordered rows, manifest proposal, insertion anchor, and central source review.
* Completion evidence: Five packet digests validate against the current source and inventory.
* Validation: Passed before mapping preparation.

### Five exact mappings prepared

* Related phase or task: P02-T03
* Files: `scripts/prepare-cbro-event.mjs`, five files under `scripts/data/cbro-mappings/`, `package.json`
* What changed and why: Added one-event packet preparation using exact issue endpoints and existing
  source-neutral resolver behavior. All 23 rows preserve source order and centrally approved title
  aliases.
* Completion evidence: Muir Island Saga 5, Bloodties 5, Midnight Massacre 5, Child's Play 4, Eighth
  Day 4; all exact and unique.
* Validation: Passed live metadata preparation with zero unmatched or ambiguous rows.

### Complete reports and central approvals issued

* Related phase or task: P02-T04
* Files: `scripts/author-cbro-packet.mjs`, five files under `scripts/data/cbro-overlaps/`, five approved
  mappings
* What changed and why: Reused complete-library and selected-peer reporting, source-neutral authority
  checks, and digest validation through a CBRO authoring entry point. Central review approved only
  factual none relationships.
* Completion evidence: Each candidate has 93 comparisons, all `none`, against library digest
  `30a01783e36ea7e1a799725e8164805c57f17f79e9697d65201d6cb288ef2cab` and four peer digests.
* Validation: Passed approval validation for all five current packets, mappings, reports, peers,
  manifests, and approval digests.

### Five CBRO checklists and manifest entries authored

* Related phase or task: P03-T01
* Files: `scripts/author-cbro-packet.mjs`, five `src/data/orders/*.md` files,
  `src/data/curated-lists.json`, `package.json`
* What changed and why: Added provider-specific authoring that reuses the existing central approval
  and chronology primitives but writes CBRO attribution, exact page links, project-authored summaries,
  and no source commentary or images.
* Completion evidence: Exactly five event manifest entries and five Markdown checklists preserve the
  23 approved issue rows.
* Validation: Passed all authoring preconditions and focused generated-surface tests.

### Five offline payloads and catalog cards generated

* Related phase or task: P03-T02
* Files: five `src/data/*.json` payloads, `src/data/catalog.json`,
  `scripts/data/cbro-historical-inventory.json`
* What changed and why: Vendored 23 exact metadata records with zero placeholders, missing reader ids,
  or missing covers, regenerated the catalog, and moved selected inventory records to shipped.
* Completion evidence: Payload counts are 5, 5, 5, 4, and 4. Manifest chronology before Maximum
  Security is Muir Island Saga, Midnight Massacre, Bloodties, Child's Play, and Eighth Day, while
  source selection retains Bloodties before Midnight Massacre.
* Validation: Targeted vendor run passed with zero unresolved, missing digital ids, or missing covers.

### Fourteen product semantics locked

* Related phase or task: P03-T03
* Files: `test/cbro-historical-events.test.js`
* What changed and why: Completed the eight product-stage cases for inventory, packets, exact mappings,
  reports and approvals, Markdown attribution and sequence, payload and catalog surfaces, chronology,
  and duplicate guards.
* Completion evidence: The one focused file now owns exactly 14 new cases as planned.
* Validation: Passed, 14 tests, 0 failed.

### Authoring prevalidation made atomic

* Affected plan area or markers: P03-T01 and P03-T02.
* What changed: Moved shipped-inventory validation ahead of every authoring write.
* Why: The first authoring attempt exposed an invalid delivery-state enum after Markdown and manifest
  writes had begun. Allowing `shipped` and validating the complete next inventory before writes makes
  the same failure stop cleanly on future runs.
* Triggering evidence: The first author command failed on record 23 after creating canonical product
  files; targeted vendoring restored the partial state, and the corrected author run passed.
* User answer or decision: None; this is an in-scope reliability correction.
* Reconciliation performed: Inventory validator, authoring write order, generated payloads, manifest,
  catalog, and focused tests agree.
* Planning and critique state: Current; no new decision or critique required.

### Backlog, changelog, and counts reconciled

* Related phase or task: P04-T01
* Files: `PRODUCT_BACKLOG.md`, `CHANGELOG.md`
* What changed and why: Added BL-206 and the Unreleased five-guide outcome, preserved every later
  candidate state, and re-derived the ranked-row, detail-block, shipped, and rank figures affected by
  the new item.
* Completion evidence: The backlog now has 179 ranked rows and 184 detail blocks: 156 Shipped,
  21 Ready, 6 Dropped, and 1 Proposed.
* Validation: Counts passed with every stated figure agreeing with its source table.

### Provider provenance and maintenance guidance added

* Related phase or task: P04-T02
* Files: `docs/DATA_PROVENANCE.md`, `docs/MAINTAINING.md`, `docs/PUBLICATION_RUNBOOK.md`
* What changed and why: Documented the separate CBRO inventory and commands, source delay, provider and
  digest boundary, five permission conditions and exclusions, null licence, central approvals, 94-list
  and 4,017-record inventory, and no-source-prose or image rule.
* Completion evidence: Provenance now accounts for five CBRO lists, 23 rows, 93 Markdown checklists,
  4,092 records, 3,433 distinct issues, 4,023 cover-bearing records, and 3,950 records with creators.
* Validation: Counts and publication-facing source inventory are internally consistent.

### Anchor evidence re-aimed and read

* Related phase or task: P04-T03
* Files: current cited documents and `docs/anchors.lock.json`
* What changed and why: Re-aimed citations shifted by package, backlog, changelog, provenance, and
  publication edits. Read all 64 changed claim-to-line pairings printed by the bless, including the
  one intentional shared range, before accepting the lock.
* Completion evidence: Clean rerun reports 1,151 unchanged, 0 drifted, 0 new, and 0 removed, with two
  declared historical absence exemptions.
* Validation: Passed.

### Every new semantic case observed failing

* Related phase or task: P05-T01
* Files: temporary reversible mutations only; no mutation retained
* What changed and why: A provider-boundary mutation removed provider defaults and mapping identity,
  causing cases 1 through 10 to fail. A selected-set mutation named a missing candidate, causing cases
  7 through 14 to fail. Both were isolated above the staged implementation and restored through
  path-scoped `git stash --keep-index`.
* Completion evidence: Every one of the 14 named cases appeared in a failing run for its intended
  provider, digest, legacy compatibility, evidence, inventory, mapping, report, generated surface,
  chronology, or duplicate contract. The restored file passed 14 of 14.
* Validation: Passed failure proof and restoration.

### Full local, live, and browser gates passed

* Related phase or task: P05-T02
* Files: final pre-reconciliation tree
* What changed and why: Added the 1990 through 1999 named era required by the five cards and updated
  direct regression populations for 94 lists, 97 item-bearing files, 184 backlog blocks, 178
  constraint checks, later CBRO evidence exclusions in historical CBH tests, and source-name handling
  in the Reading List vocabulary test.
* Completion evidence: Full suite 1,411 passed, 0 failed; lint 0; counts passed; sizes 7 of 7; palette
  88 pairs, 5 recorded below floor, 0 new; publication 3,125 blobs and publication surface 3,199 blobs,
  both 0 findings; anchors 1,151 unchanged and clean. The live contract passed 33 of 33 assumptions
  after one transient reachability timeout and a successful retry.
* Validation: Existing Edge harness passed 158 assertions across 17 scenarios. Actual catalog Edge
  verification at 1280x900 passed 41 of 41 assertions: named era, five cards, years, counts, exact
  source labels and links, Add controls, payload counts, and first, middle, and final sampled issue
  IDs.

### Current main merged and release authority reissued

* Related phase or task: P05-T03
* Files: merged Rocket Raccoon product and evidence files; five CBRO mappings and reports; catalog,
  counts, documentation, tests, and anchor evidence
* What changed and why: Merged current main at `3f03c5322d0463337efd351dbf030fd4ae231fd7`,
  which added the Rocket Raccoon guide and moved the pre-publication library from 89 to 90 lists.
  Resolved shared catalog and record changes without dropping either feature. Renamed this feature's
  backlog record from BL-205 to BL-206 because main assigned BL-205 first.
* Completion evidence: Re-fetched all five source pages with matching SHA-256. Rebuilt each selected
  report against complete-library digest
  `75d060ace62824377e5a81b48eb25ffedcfb3d346ef25221a0817d8057d11596`
  and four peer digests. Each now contains 94 none relationships, for 470 total, with new report and
  approval digests. Re-authoring validated the complete current evidence set.
* Validation: Post-merge focused tests passed 80 of 80 and counts passed at 180 ranked rows, 185 detail
  blocks, 157 Shipped, 21 Ready, 6 Dropped, and 1 Proposed. Lint passed.

### Final merged-tree gates passed

* Related phase or task: P05-T03
* Files: final conflict-resolved implementation and merged current-main files
* What changed and why: Re-ran every deterministic, live, publication, and browser gate after the last
  conflict resolution, report regeneration, approval regeneration, documentation count update, and
  anchor re-aim.
* Completion evidence: Full suite 1,412 passed; lint 0; counts 180 ranked rows and 185 detail blocks;
  sizes 7 of 7; palette 88 pairs with 5 recorded and 0 new; anchors 1,168 unchanged with 0 drifted,
  new, or removed; live contract 33 of 33; installed Edge 158 of 158; actual CBRO cards 41 of 41 at
  1280x900. Final dash scan found 0 added lines with dash punctuation and `git diff --check` passed.
* Validation: Passed.

### One independent Review routed five implementation defects

* Affected plan area or markers: P06-T01 and P06-T02.
* What changed: The single Review completed with Defects found: RV-001 and RV-002 High, RV-003 through
  RV-005 Medium. All route to implementation and require no new planning or research.
* Why: Partial release modes, unbound inventory and source evidence, relabelable review provenance,
  missing alternate-universe state, and sequential multi-file writes weaken confirmed release
  contracts.
* Triggering evidence: The one independent post-implementation code review of commit `c80a864`.
* User answer or decision: None; all fixes preserve confirmed intent.
* Reconciliation performed: Review record is complete; P06-T01 is complete and P06-T02 owns all five
  in-scope fixes. No second Review will run.
* Planning and critique state: Current; original critique remains final.

### All five Review findings closed without another Review

* Related phase or task: P06-T02
* Files: CBRO evidence, preparation, authoring, inventory, mappings, tests, maintenance guidance, and
  the one review record
* What changed and why: Made approval and authoring require all five guides in chronology order;
  cryptographically locked every stable field across all 58 inventory records; matched selected
  inventory source fields to packets; bound exact CBRO review identity into approvals; marked only
  Marvel 2099 and MC2 alternate; and replaced sequential writes with staged, journaled,
  backup-restored transactions.
* Completion evidence: Full five-guide approval and authoring succeed with 94 comparisons per
  candidate. Partial and reordered authoring are refused. Fabricated inventory, changed selected
  source evidence, and relabeled review provenance are refused. Transaction staging failure leaves
  original files unchanged and successful publication removes its journal and backups.
* Validation: Two Review-fix mutation runs failed the intended four focused cases and transaction
  assertions. Restored 14 of 14 focused tests and lint pass. No second Review ran.

### Release commits and pull request published

* Related phase or task: P07-T01
* Files: four scoped commits and pull request release record
* What changed and why: Committed the five-guide implementation, current-main reconciliation, merged
  anchor correction, and the five Review fixes with the required co-author trailer. Pushed the
  branch and opened the release pull request with plain-English framing and exact verification counts.
* Completion evidence: Pull request 175 is open against current main. The pushed publication surface
  covers 9 branches and 3,310 blobs with 0 findings.
* Validation: Passed local branch publication and pushed-surface checks.

### Hosted checks passed on the pushed release head

* Related phase or task: P07-T02
* Files: hosted run 32669868358 at head `4acbc4b28d77b87e3a73e67474aee9072a2fa990`
* What changed and why: Monitored actual job and step conclusions rather than treating the aggregate
  run color as sufficient evidence.
* Completion evidence: Lint job 97268912954 completed success in 23 seconds, including ESLint,
  anchors, counts, sizes, palette, and publication. Tests on Node 24 job 97268912964 completed success
  in 19 seconds. Tests on Node 20 job 97268913018 completed success in 25 seconds.
* Validation: Hosted run conclusion `success`.

## Implementation-Time Plan and Detail Updates

### Single critique corrections incorporated

* Affected plan area or markers: locked boundaries, P02-T03, P02-T04, P05-T01 through P05-T03,
  P07-T02, Critique Disposition.
* What changed: Made the five-event release indivisible; added the final freshness chain, sizes and
  palette gates, exact 14-case ownership and per-case failure proof, and immutable research inputs.
* Why: Resolve PC-001 through PC-005 before implementation.
* Triggering evidence: The one final-candidate plan critique returned Revise with five direct planner
  findings.
* User answer or decision: No new answer required; corrections preserve confirmed caller intent.
* Reconciliation performed: Executive summary, requirements, acceptance criteria, phases, details,
  validation, critique disposition, and handoff are current.
* Planning and critique state: Ready; the single critique is complete and will not be repeated.

## Validation Record

| Check | Scope | Status | Evidence or reason |
|---|---|---|---|
| Current main and source refresh | P01-T01 | Passed | Main unchanged at `086cc5b`; 89-list digest and all five page digests match |
| Focused semantic tests | P01 | Passed | 29 provider, resolver, and CBH packet tests, 0 failed |
| Focused semantic tests | P03 | Passed | Exactly 14 CBRO historical-event tests, 0 failed |
| Targeted vendoring | P03 | Passed | 5 lists, 23 issues, 0 unresolved, 0 placeholders, 0 missing digital ids or covers |
| Counts | P04 and P05-T03 | Passed | 180 ranked rows, 185 detail blocks, all stated figures agree |
| Anchors | P04 and P05-T03 | Passed | 1,168 unchanged, 0 drifted, 0 new, 0 removed |
| Failure proof | P05-T01 | Passed | Provider mutation failed cases 1-10; selected-set mutation failed cases 7-14; restored 14/14 pass |
| Full tests | P05-T02 and P05-T03 | Passed | 1,412 passed, 0 failed on the merged tree |
| Lint | P05-T02 | Passed | 0 findings |
| Sizes | P05-T02 | Passed | 7 stated sizes agree |
| Palette | P05-T02 | Passed | 88 pairs, 5 recorded, 0 new |
| Publication | P05-T02 | Passed | 3,125 reachable blobs and 3,199 remote-surface blobs, 0 findings |
| Live contract | P05-T02 | Passed | 33/33 assumptions after one transient retry |
| Existing Edge harness | P05-T02 | Passed | 158 assertions, 17 scenarios, 0 failed |
| Actual CBRO cards in Edge | P05-T02 | Passed | 41/41 assertions at 1280x900 |
| Review-fix failure proof | P06-T02 | Passed | Four contract cases and transaction assertions failed under reversible mutations; restored 14/14 |
| Full local and browser gates | P05 and P06-T02 | Passed | Final affected deterministic gates pass after Review fixes |
| Hosted checks | P07 | Pending | Dependent on pull request |

## Pre-Review Reconciliation

* Plan markers and phase details: Current; P01 through P06 are complete.
* Completed-work evidence and handoff prose: Current through all routed Review fixes.
* Validation, blockers, remaining work, and follow-up items: Current; no release blocker.
* Review readiness: The one Review is complete and will not be repeated.

## Blockers

* None at implementation opening. A changed selected source row, exact duplicate, or unresolved selected
  relationship becomes a genuine whole-release blocker.

## Remaining Work

* P06 and P07 remain. Implementation P01 through P05 is complete.

## Follow-Up Items

* Canonical plan list: .copilot-tracking/plans/2026-08-23/historical-event-reading-orders-plan.md,
  `## Follow-Up Items`
* Ranked later historical chunks remain outside MRT-003 implementation scope and require a later RPI
  task.

## Return-to-Caller State

* Implementation execution status: Complete for implementation phases P01 through P05; full task
  remains Partial through Review and release
* Declared scope and markers: full plan; P01 through P06, P07-T01, and P07-T02 complete; P07-T03 active
* Validation coverage: All final merged-tree deterministic, live, publication, dash, diff, and browser
  gates passed
* Blockers: None
* Current plan and detail updates: PC-001 through PC-005 resolved before source work
* Planning and critique state: Ready; one critique complete
* Follow-up items: Ranked later historical chunks only
* Review readiness or no-handoff reason: Ready for exactly one independent Review
* Continuation owner: confirmed automatic RPI Agent
