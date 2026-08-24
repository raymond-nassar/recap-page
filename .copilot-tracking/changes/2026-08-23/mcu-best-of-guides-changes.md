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
* Completed scope markers: P00 through P03, P00-T01 through P03-T02, and P04-T01
* All remaining active-plan markers: P04-T02 through P05-T02
* Status basis: P00 through P03 and P04-T01 are complete; implementation continues at P04-T02.

## Execution Summary

The approved implementation will ship priorities 1 to 4 as four `screen-companion` / `selected` lists under Marvel on Screen on the Hub, retain all fourteen selected sources in a guarded inventory, and complete one Review plus PR merge. Production edits have not started.

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
* What changed and why: Added a narrow MCU companion inventory validator over the shared CBH primitives, froze all fourteen user priorities and terminal states, persisted four exact source packets and mappings totaling 43 unique issues, generated 99-comparison current-library/three-peer reports, and bound stronger-model approvals for two partials and two candidate-subsets. Exact duplicates remain unapprovable.
* Completion evidence: Inventory identity digest `06dd03db51c6e64c5ab43ba712dd6da4ff6a1cb6483e8eeefdf243aa86304ad2`; selected counts 17, 17, 2, and 7; all four reports contain 99 comparisons; targeted semantic suite passes 5 of 5 tests.
* Validation: Passed.

### CHG-004: Add truthful list taxonomy and Marvel on Screen Hub placement

* Related phase or task: P02, P02-T01, P02-T02, P02-T03
* Files: `src/js/lib/catalog.js`, `src/js/main.js`, `test/catalog.test.js`, `test/curated.test.js`, `test/catalog-shelves.test.js`, `test/home-grid.test.js`, `test/home-featured.test.js`
* What changed and why: Added `screen-companion` and `selected` labels, a table-driven non-empty Marvel on Screen Home category, and Home rendering through the new partition while leaving the three browse shelves intact. Screen companions remain reachable through Storylines with truthful context. Existing Hub completeness and heading tests now exercise the actual partition, `timeline: null` items survive the age filter, and non-beginner companions cannot replace the featured pick.
* Completion evidence: Targeted catalog, manifest, shelf, Home, and featured suites passed 151 of 151 tests after the nested-test fixture was corrected.
* Validation: Passed.

### CHG-005: Author four offline guides and synchronize product records

* Related phase or task: P03, P03-T01, P03-T02
* Files: four `src/data/orders/*.md` files, four generated `src/data/*.json` payloads, `src/data/curated-lists.json`, `src/data/catalog.json`, `scripts/data/cbh-mcu-companion-inventory.json`, `README.md`, `CHANGELOG.md`, `PRODUCT_BACKLOG.md`, `docs/DATA_PROVENANCE.md`, `docs/MAINTAINING.md`, `docs/PUBLICATION_RUNBOOK.md`, `docs/UX_STUDY.md`, and directly affected tests
* What changed and why: Authored four approved source checklists and vendored 43 exact issues with zero unresolved rows, moved the selected inventory rows to shipped state, rebuilt the catalog to 100 readings, and documented the Marvel on Screen source, licence, maintenance, publication, UX, backlog, and reader-facing boundaries. Re-derived all counts in touched sections and updated coverage tests to 100 catalog payloads and 103 item-bearing files.
* Completion evidence: Catalog now contains 100 readings across 93 stories and 4,211 issue rows covering 3,498 distinct ids; four selected cards appear in user order; Character Spotlight remains 13 readings; counts gate, targeted integration tests, and lint pass.
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
* Reconciliation performed: Updated plan, details, route registry, category renderer, tests, browser fixture, backlog id from BL-208 to BL-209, documentation, counts, and validation expectations. Kept all four guide mappings and product data unchanged.
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
| Full unit suite | P04-T02 | Passed | 1,428 of 1,428 tests passed after legacy library-bound tests excluded the four later MCU releases and governance counts moved to 187 blocks / 181 checks. |
| Static release gates | P04-T02 | Passed | Lint, counts, sizes, palette, publication, and publication surface all passed. |
| Live metadata API contract | P04-T02 | Passed | 33 of 33 general assumptions hold across 17 requests. |
| MCU issue contract | P04-T02 | Passed | 43 of 43 mapped issue ids retain exact id, series, issue number, and detail URL. |
| Installed Edge | P04-T02 | Passed | 184 assertions passed across 19 scenarios at desktop and narrow viewports after current `main` reconciliation. |
| Installed Edge mutation proof | P04-T02 | Passed | All 22 browser mutations were detected; the restored run remained 184/184. |
| Evidence anchors | P04-T02 | Passed | 42 changed citations were read against their claims, range boundaries were nonblank, and the post-bless run reported 1,177 unchanged / 0 drifted / 0 new / 0 removed. |

## Pre-Review Reconciliation

* Plan markers and phase details: P00 through P03 complete; P04 and P05 remain.
* Completed-work evidence and handoff prose: P00 through P03 evidence is current.
* Validation, blockers, remaining work, and follow-up items: Current for implementation start.
* Review readiness: Not ready; P00 through P04-T02 remain.

## Blockers

* None.

## Remaining Work

* P04-T02 through P05-T02.

## Follow-Up Items

* Canonical plan list: .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md, `## Follow-Up Items`
* Priorities 5, 6, 7, 9, 10, and 14 remain distinct later mapping releases.
* Priorities 8, 11, 12, and 13 require explicit issue enumeration or an approved exact mapping authority.

## Return-to-Caller State

* Implementation execution status: Partial
* Declared scope and markers: Full plan; P00 through P03 and P04-T01 complete; P04-T02 through P05-T02 remain.
* Validation coverage: Branch, evidence, taxonomy, Hub, generated data, product records, counts, targeted integration, and lint.
* Blockers: None.
* Current plan and detail updates: None after critique disposition.
* Planning and critique state: Implementation ready; one critique complete and resolved.
* Follow-up items: Ten unshipped guides remain outside this release.
* Review readiness or no-handoff reason: Not ready; implementation active.
* Continuation owner: confirmed automatic RPI Agent.
