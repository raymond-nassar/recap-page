<!-- markdownlint-disable-file -->
# RPI Changes: MCU best-of guides

## Metadata

* Task ID: MRT-004
* Related plan: .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md
* Implementation date: 2026-08-23

## Execution Status

* Status: Partial
* Declared invocation scope: full plan
* Completed scope markers: P00 through P04 and P00-T01 through P05-T01
* All remaining active-plan markers: P05 and P05-T02
* Status basis: The one independent Review and final main reconciliation are complete with no product defect or blocker; implementation continues with pull request delivery.

## Execution Summary

The implementation ships priorities 1 to 4 as four `screen-companion` / `selected` lists under Marvel on Screen, retains all fourteen selected sources in a guarded inventory, and has completed the one independent Review with a Conformant with justified divergence outcome. Final release work also applies the user's count-free README inventory wording so the overview does not become stale whenever the catalog grows.

## Completed Work

### CHG-002: Reconcile and freeze the implementation baseline

* Related phase or task: P00, P00-T01, P00-T02
* Files: `.copilot-tracking/research/2026-08-23/mcu-best-of-source-boundaries.json`, current manifest and catalog as read-only evidence
* What changed and why: Confirmed the feature branch and `origin/main` both point at 233c463, re-derived 96 readings across 89 stories and the 75 event / 2 creator-run / 6 era / 13 character-run split, and re-fetched all fourteen WordPress source identities. Full rendered-content hashes varied across retrievals while all normalized issue-bearing digests stayed stable, so the latter remains the source-boundary authority and the full digest records the exact current snapshot.
* Completion evidence: `HEAD...origin/main` returned `0 0`; all fourteen WordPress records resolved; the refreshed source evidence contains unique positions 1 to 14 and stable issue-bearing digests.
* Validation: Passed.

### CHG-003: Guard the fourteen-title inventory and four-guide evidence chain

* Related phase or task: P01, P01-T01, P01-T02, P01-T03
* Files: `scripts/lib/cbh-mcu-companion.mjs`, `scripts/data/cbh-mcu-companion-inventory.json`, four files each under `scripts/data/cbh-packets`, `scripts/data/cbh-mappings`, and `scripts/data/cbh-overlaps`, `test/cbh-mcu-companion.test.js`
* What changed and why: Added a narrow MCU companion inventory validator over the shared CBH primitives, froze all fourteen user priorities and terminal states, persisted four exact source packets and mappings totaling 43 unique issues, and bound stronger-model approvals for two partials and two candidate-subsets. After Star-Lord merged, each report was regenerated against the 97-list pre-publication library plus three selected peers, for 100 comparisons. Exact duplicates remain unapprovable.
* Completion evidence: Inventory identity digest `06dd03db51c6e64c5ab43ba712dd6da4ff6a1cb6483e8eeefdf243aa86304ad2`; selected counts 17, 17, 2, and 7; all four reports contain 100 comparisons; targeted semantic suite passes.
* Validation: Passed.

### CHG-004: Add truthful list taxonomy and Marvel on Screen Hub placement

* Related phase or task: P02, P02-T01, P02-T02, P02-T03
* Files: `src/js/lib/catalog.js`, `src/js/main.js`, `test/catalog.test.js`, `test/curated.test.js`, `test/catalog-shelves.test.js`, `test/home-categories.test.js`
* What changed and why: Added `screen-companion` and `selected` labels, a table-driven non-empty Marvel on Screen Home category, and Home rendering through the new partition while leaving the three browse shelves intact. Screen companions remain reachable through Storylines with truthful context. Existing Hub completeness and heading tests now exercise the actual partition, `timeline: null` items survive the age filter, and non-beginner companions cannot replace the featured pick.
* Completion evidence: Targeted catalog, manifest, shelf, Home, and featured suites passed 151 of 151 tests after the nested-test fixture was corrected.
* Validation: Passed.

### CHG-005: Author four offline guides and synchronize product records

* Related phase or task: P03, P03-T01, P03-T02
* Files: four `src/data/orders/*.md` files, four generated `src/data/*.json` payloads, `src/data/curated-lists.json`, `src/data/catalog.json`, `scripts/data/cbh-mcu-companion-inventory.json`, `README.md`, `CHANGELOG.md`, `PRODUCT_BACKLOG.md`, `docs/DATA_PROVENANCE.md`, `docs/MAINTAINING.md`, `docs/PUBLICATION_RUNBOOK.md`, `docs/UX_STUDY.md`, and directly affected tests
* What changed and why: Authored four approved source checklists and vendored 43 exact issues with zero unresolved rows, moved the selected inventory rows to shipped state, and documented the Marvel on Screen source, licence, maintenance, publication, UX, backlog, and reader-facing boundaries. After Star-Lord merged, rebuilt the combined catalog to 101 readings and updated coverage tests to 101 catalog payloads and 104 item-bearing files.
* Completion evidence: Catalog now contains 101 readings across 94 stories and 4,310 issue rows covering 3,571 distinct ids; four selected cards appear in user order; Character Spotlight includes Star-Lord at 14 readings while Marvel on Screen remains separate; counts gate, targeted integration tests, and lint pass.
* Validation: Passed.

### CHG-006: Prove the new semantic checks detect the broken behavior

* Related phase or task: P04-T01
* Files: staged release state with temporary one-file working-tree mutations restored through `git stash --keep-index`
* What changed and why: Observed four focused failures against the smallest relevant break: removing the issue-bearing inventory comparison made the source-boundary test report a missing exception; replacing the Home partition with browse-shelf grouping failed the landing-render test; weakening the Marvel Multiverse description failed its subset-scope test; removing `screen-companion` from accepted types failed manifest validation. Each broken mutation was stashed and dropped, restoring the staged correct file without checkout or reset.
* Completion evidence: The four failing runs named the intended semantic assertion. A combined restored run then passed all 4 targeted tests.
* Validation: Passed.

### CHG-007: Reconcile the integrated reading gateway before Review

* Affected plan area or markers: P02-T02, P02-T03, P04-T02, P05-T01, candidate lock, PC-001 through PC-003 and PC-008
* What changed: Merged `origin/main` at b9367d8, which had replaced the Home card wall with a shared Home/Browse category gateway and generated category child pages. Reconciled Marvel on Screen into that registry with its own child route, kept Storylines as the canonical shelf, retained `timeline: null` and `beginner: false`, migrated coverage to `home-categories.test.js`, and removed this branch's superseded Home partition tests.
* Why: The user explicitly required the existing Marvel on Screen category contract. Reviewing or releasing the pre-merge Home partition would have duplicated and contradicted the contract that landed concurrently.
* Triggering evidence: Current `main` added BL-208, `HOME_CATEGORIES`, publishing-age routes, generated child views, and 182 Edge assertions across 19 scenarios.
* User answer or decision: Existing confirmed Marvel on Screen placement and category-contract direction; no new decision was needed.
* Reconciliation performed: Updated plan, details, route registry, category renderer, tests, browser fixture, backlog id from BL-208 to BL-210 after the Star-Lord release, to BL-211 after the concurrent Home refresh, then to BL-212 after the repeated-source contract, documentation, counts, and validation expectations. Kept all four guide mappings and product data unchanged.
* Planning and critique state: Immediate in-scope current-state update. The one critique remains historical; no second critique runs.

## Implementation-Time Plan and Detail Updates

### CHG-001: Start the approved full-plan implementation

* Affected plan area or markers: P00-T01 and full-plan execution state
* What changed: Declared the full plan in scope and started the first dependency-ready task.
* Why: Research is Ready and the one plan critique is fully dispositioned.
* Triggering evidence: Final plan status is implementation ready; current branch and `origin/main` are equal at commit 233c463.
* User answer or decision: Automatic full-plan execution was explicitly requested.
* Reconciliation performed: Plan, phase details, critique dispositions, Research evidence, source boundary evidence, and mapping evidence were read as the current authority.
* Planning and critique state: Current and ready; PC-001 through PC-009 are resolved; no second critique will run.

### CHG-008: Apply the user-requested README inventory stability decision

* Affected plan area or markers: P05-T01 and final release evidence
* What changed: Added a bounded release requirement to remove fast-changing counts of reading orders, issues, cards, and similar catalog inventory from the README while retaining stable technical values, version requirements, the fixed origin and port, evidence dates, and measured hardware facts.
* Why: A neighboring catalog release identified that the README overview count becomes stale as soon as another curated list lands. The user assigned the durable count-free wording to this PR to avoid parallel README conflicts.
* Triggering evidence: The current overview says readers can pick one of 101 curated reading orders, a value already superseded whenever any concurrent list merges.
* User answer or decision: Include this README stability edit in MRT-004, update directly affected tests, changelog if required, and evidence anchors, and continue the existing one-Review flow without a second Review.
* Reconciliation performed: P05-T01 now owns the edit after current `main` is merged. The edit remains ancillary and does not change the fourteen-guide source boundary or the bounded four-guide product release.
* Planning and critique state: Immediate user-directed current-state update; no new critique or Review is permitted or needed.

### CHG-009: Replace stale README imagery with two current screenshots

* Affected plan area or markers: P05-T01 and final release evidence
* What changed: Added exactly two README screenshots to the bounded release requirement: the current Home view and an open actual Avengers Disassembled reading list at 1280x900.
* Why: The user assigned current product imagery to the same PR as the count-free README wording so the overview stays accurate without parallel README conflicts or obsolete assets accumulating.
* Triggering evidence: The existing README image no longer represents the current Home gateway and does not provide the requested open-list view.
* User answer or decision: Immediately before capture, fetch current `origin/main`; render a clean temporary copy outside tracked files at `127.0.0.1:8787`; use installed Edge, the existing external puppeteer-core setup, an explicit 1280x900 viewport, and clean profile/storage; import and open the actual Avengers Disassembled list without personal data or fabricated progress.
* Reconciliation performed: P05-T01 owns capture, visual and dimension checks, stable asset paths and alt text, replacement of stale assets where appropriate, README reference checks, temporary-process cleanup, and the affected full-gate rerun. The feature branch's unmerged MCU state is explicitly excluded from screenshot content.
* Planning and critique state: Immediate user-directed current-state update; the completed Review is not repeated.

### CHG-010: Reconcile the repeated-source contract before release

* Affected plan area or markers: P05-T01, evidence freshness, release records, and final validation
* What changed: Merged current `origin/main` at 4a0e837, which adds the shared repeated-source packet contract and refreshes Groot evidence against Star-Lord. Preserved the MCU release's later-list exclusions while accepting Star-Lord as part of Groot's refreshed reviewed library, moved the MCU backlog record to BL-212, and re-derived the combined backlog as 186 ranked rows, 5 parked rows, 191 detail blocks, and 163 Shipped items.
* Why: The user required the final PR to describe and test current `main`. Taking either side of the Groot test conflict would have been wrong: the old MCU side excluded Star-Lord from an older Groot review, while the new main side did not know the four later MCU guides existed.
* Triggering evidence: Current `main` advanced after the first README capture and after the independent Review. The merged targeted suite passes all 39 evidence and README checks only when Star-Lord remains in Groot's refreshed library and the four MCU guides remain excluded as later additions.
* User answer or decision: Reconcile the repeated-source contract and recapture both README screenshots from a fresh clean `origin/main` snapshot before final gates.
* Reconciliation performed: Fetched and archived 4a0e837 outside the repository, served only that clean tree at `127.0.0.1:8787`, and recaptured Home plus Avengers Disassembled in installed Edge at 1280x900 with clean storage, cover art off, and zero marked progress. The files remain 1280x900 with SHA-256 values `AAC0707418552FD7AB88A18D756FA63E0B5ACD177585DBB0B10F3F3BF91D3761` and `51972F35B2A1F47CB418BE905C4BDE0C61EAFBA502DBA9360E19387D97A5C3AB`. The temporary archive and server were removed.
* Planning and critique state: Immediate in-scope current-state update under P05-T01. The one critique and one Review remain complete; neither is repeated.

### CHG-011: Recover the final gate run in place

* Affected plan area or markers: P05-T01 and final validation
* What changed: Resumed from the canonical MRT-004 Plan, details, changes, and Review artifacts without restarting Research, implementation, critique, or Review. Preserved head 6d50019, the final main reconciliation, both refreshed screenshots, all source and evidence work, and the staged citation re-aims plus 1,181-anchor lock.
* Why: The browser mutation proof exceeded the command tool's 600-second foreground wait. The command continued under its existing shell session, so this was an orchestration timeout rather than a test, product, repository, or worktree failure.
* Triggering evidence: The ordinary Edge run completed 184 of 184 assertions while `npm run browser:prove` remained active after 600 seconds. Full tests had already completed 1,431 of 1,431, and the live metadata contract completed 33 of 33.
* User answer or decision: Recover in place, preserve the current worktree, report the concrete failure cause, and complete the existing one-Review release flow.
* Reconciliation performed: Kept the running mutation proof and resumed P05-T01 from final validation. No duplicate browser proof was started and no completed RPI stage was reopened.
* Planning and critique state: No planning change. The task remains unblocked and continues automatically.

## Validation Record

| Check | Scope | Status | Evidence or reason |
|---|---|---|---|
| Initial branch reconciliation | P00-T01 | Passed | `HEAD...origin/main` reports `0 0`; current main is 233c463. |
| Catalog baseline | P00-T01 | Passed | 96 readings, 89 stories; type counts 75/2/6/13. |
| Source refresh | P00-T02 | Passed | Fourteen exact WordPress identities refreshed; issue-bearing digests remained stable. |
| MCU evidence semantic test | P01 | Passed | 5 tests passed; inventory, packets, mappings, reports, approvals, aliases, subset authority, and exact-duplicate rejection verified. |
| Catalog and Hub semantics | P02 | Passed | 151 tests passed across catalog, manifest, browse shelves, Home partition, age filtering, and featured selection. |
| Four-guide authoring | P03-T01 | Passed | Generic authorer wrote 4 guides / 43 rows; vendor wrote 17, 17, 2, and 7 rows with zero unresolved, missing digital ids, or missing covers. |
| Documentation and counts | P03-T02 | Passed | 182 ranked rows, 5 parked, 187 detail blocks; 159 Shipped; all stated figures agree and no prose repeats. |
| Targeted release integration | P03 | Passed | 112 tests passed across evidence, catalog, Hub, and featured behavior; lint passed. |
| Failure proof: source boundary | P04-T01 | Passed | Removing the issue-bearing inventory check produced 1 expected failure: missing expected exception. |
| Failure proof: Hub partition | P04-T01 | Passed | Replacing `homeSections` with `shelfSections` produced 1 expected landing-render failure. |
| Failure proof: subset scope | P04-T01 | Passed | Replacing the priority 3 scope sentence produced 1 expected description failure. |
| Failure proof: taxonomy | P04-T01 | Passed | Removing `screen-companion` from `LIST_TYPES` produced 1 expected manifest failure. |
| Failure proof: integrated category | P04-T01 | Passed | Removing the Marvel on Screen registry row produced 1 expected undeclared-category failure; the restored focused test passed. |
| Restored semantic checks | P04-T01 | Passed | All 4 focused checks passed after stash restoration. |
| Full unit suite | P04-T02 | Passed | 1,424 of 1,424 tests passed after the reading-hub and Star-Lord merges, with 189 backlog blocks and 183 constraint checks. |
| Static release gates | P04-T02 | Passed | Lint, counts, sizes, palette, publication, and publication surface all passed. |
| Live metadata API contract | P04-T02 | Passed | 33 of 33 general assumptions hold across 17 requests. |
| MCU issue contract | P04-T02 | Passed | 43 of 43 mapped issue ids retain exact id, series, issue number, and detail URL. |
| Installed Edge | P04-T02 | Passed | 184 assertions passed across 19 scenarios at desktop and narrow viewports after current `main` reconciliation. |
| Installed Edge mutation proof | P04-T02 | Passed | All 41 browser mutations were detected; the restored run remained 184/184. |
| Evidence anchors | P04-T02 | Passed | The final merged-tree bless printed 260 changed citation pairings, all were read against their claims, and the post-bless run reported 1,181 unchanged / 0 drifted / 0 new / 0 removed. |
| Dash scan | P04-T02 | Passed | 0 added lines contain an en dash or em dash. |
| Diff check | P04-T02 | Passed | `git diff --check` passed; final feature diff against current `main` spans 66 files with generated evidence and payloads included. |
| Final main reconciliation | P05-T01 | Passed | Merged current `origin/main` through 4a0e837 without rebase, preserved the shared repeated-source contract, and moved the MCU backlog record to BL-212. |
| Final unit and static gates | P05-T01 | Passed | 1,431 of 1,431 tests passed; lint passed; counts derived 186 ranked rows, 5 parked rows, 191 detail blocks, and 163 Shipped items; sizes measured 6 statements; palette measured 90 pairs with 0 new failures; publication and publication surface reported 0 findings. |
| Final live contracts | P05-T01 | Passed | The general metadata contract passed 33 of 33 assumptions across 17 requests. After transient fetch failures were retried with delay, the MCU contract passed all 43 mapped issue identities. |
| Final Edge and mutation proof | P05-T01 | Passed | Installed Edge passed 184 of 184 assertions across 19 scenarios. The existing long-running proof completed once and caught all 41 of 41 mutations in their intended scenarios. |
| README stability and screenshots | P05-T01 | Passed | The no-fix check failed on the live catalog count and stale image reference, then both README tests passed. Exactly two referenced PNGs are 1280x900: clean-current-main Home and zero-progress Avengers Disassembled, both with cover art off and accurate alt text. |
| Final evidence anchors | P05-T01 | Passed | Head search and merge-diff arithmetic re-derived every conflict-touched citation. All 36 final bless pairings were read against their claims; the final run reports 1,181 unchanged / 0 drifted / 0 new / 0 removed. |
| Final dash and diff review | P05-T01 | Passed | 0 added lines contain an en dash or em dash; `git diff --check` passes; no unresolved conflict marker remains. |

## Post-Review Reconciliation

* Plan markers and phase details: P00 through P04 and P05-T01 complete; P05-T02 remains.
* Completed-work evidence and handoff prose: P00 through P05-T01 evidence is current, including the one independent Review, repeated-source reconciliation, README stability decision, screenshot provenance, and final gate results.
* Validation, blockers, remaining work, and follow-up items: Review outcome is Conformant with justified divergence; no product defect or blocker remains. RV-001 is folded into P05 record maintenance, RV-004's stale advisory targets are corrected when phase details are next edited, and RV-002 and RV-003 remain distinct low-severity follow-ups.
* Review readiness: Review completed once. No second Review will run.

## Blockers

* None.

## Remaining Work

* P05 and P05-T02.

## Follow-Up Items

* Canonical plan list: .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md, `## Follow-Up Items`
* Priorities 5, 6, 7, 9, 10, and 14 remain distinct later mapping releases.
* Priorities 8, 11, 12, and 13 require explicit issue enumeration or an approved exact mapping authority.

## Return-to-Caller State

* Implementation execution status: Partial
* Declared scope and markers: Full plan; P00 through P04 and P00-T01 through P05-T01 complete; P05 and P05-T02 remain.
* Validation coverage: Full tests, lint, counts, sizes, palette, publication, publication surface, live metadata, MCU mappings, Edge desktop and narrow layouts, mutation proof, anchors, dash scan, and diff check.
* Blockers: None.
* Current plan and detail updates: Integrated the shared category gateway, Star-Lord release, Home refresh, and repeated-source contract; completed one independent Review; delivered the count-free README wording and exactly two clean-current-main screenshots; completed P05-T01.
* Planning and critique state: One critique complete and resolved; one Review complete; no second critique or Review will run.
* Follow-up items: Ten unshipped guides remain outside this release.
* Review readiness or no-handoff reason: Review complete; implementation continues directly to release.
* Continuation owner: confirmed automatic RPI Agent.
