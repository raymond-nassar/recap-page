<!-- markdownlint-disable-file -->
# Review: Marvel on Screen best-of companion guides

## Scope and Evidence

* Task ID: MRT-004
* Review date: 2026-08-23
* Review scope: Full task. P00 through P04-T02 are delivered and assessed here. P04-T03 is this Review. P05 remains unstarted.
* Assessed boundary: The complete branch diff of raymond-nassar-mcu-best-of-guides against current origin/main (merge-base equals origin/main at ff92fd0, head 3f0f78f, 66 files, 19,908 insertions, 814 deletions), the exact user requirements recorded in Research and Plan, the four shipped screen-companion guides and their frozen evidence chain, the fourteen-record guarded inventory, the Marvel on Screen category on the shared Home/Browse gateway, provenance and privacy posture, product documentation and counts, the anchors corpus, and release readiness. The integrated reading-hub merge and the Star-Lord reconciliation are inside the boundary; incoming main behavior is distinguished from MRT-004 changes throughout.
* Plan: .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md
* Plan critique: .copilot-tracking/reviews/plans/2026-08-23/mcu-best-of-guides-plan-critique.md
* Changes: .copilot-tracking/changes/2026-08-23/mcu-best-of-guides-changes.md
* Other evidence considered: .copilot-tracking/research/2026-08-23/mcu-best-of-guides-research.md; the frozen evidence chain under scripts/data/cbh-mcu-companion-inventory.json, scripts/data/cbh-packets, scripts/data/cbh-mappings, scripts/data/cbh-overlaps and scripts/data/cbh-approvals; generated payloads under src/data; src/data/curated-lists.json; scripts/lib/cbh-mcu-companion.mjs; test/cbh-mcu-companion.test.js; test/cbh-character-spotlight.test.js; src/js/lib/catalog.js; src/js/lib/route.js; src/js/main.js; scripts/browser-check.mjs; PRODUCT_BACKLOG.md; CHANGELOG.md; docs/DATA_PROVENANCE.md; docs/MAINTAINING.md; docs/PUBLICATION_RUNBOOK.md; docs/UX_STUDY.md; and independently re-run validation commands recorded under Validation Evidence.

## Opening Review State

* Interpreted review goal: Produce the one and only independent post-implementation assessment of MRT-004 by re-deriving its factual claims from the repository rather than accepting the recorded evidence, then route every actionable gap once.
* Review scope: Full task, single pass, no second Review.
* Evidence readiness: Complete. Research, plan, phase details, plan critique and changes record all exist for slug mcu-best-of-guides under 2026-08-23, the branch is clean, and every gate except the live-API and Edge-dependent checks is reproducible locally.
* Acceptance basis: The exact user requirements and settled decisions in Research and Plan (fourteen sources inventoried in order, first release priorities 1 to 4, shared Home/Browse category contract with a generated child route, Storylines as canonical shelf, no Character Spotlight classification, screen-companion and selected taxonomy, no inferred collections or copied source expression, exact duplicates rejected, subset and partial centrally approved, exactly one Review), plus the plan Acceptance Criteria and the Candidate Lock.
* First comparison boundary: git diff origin/main HEAD, taken against merge-base ff92fd0 so the diff is exactly the MRT-004 delta, then narrowed to the frozen evidence chain and the generated surfaces it feeds.
* Active read-only boundaries: This review record is the only file this stage may create or update. No source, test, data, plan, detail, critique, research or changes edit was made, and none is proposed as part of this stage.
* Initial blockers: None.

## Execution Status

* Execution status: Partial
* Review execution evidence: The Review itself completed in full on 2026-08-23 against head 3f0f78f with a clean working tree. Execution is Partial only because the task is not finished: P04-T03 is this record, and P05-T01 and P05-T02 (second main reconciliation, pull request, CI job reading, merge and merged-state persistence) have not run. Every assessed marker inside the boundary had evidence sufficient for a verdict, so no part of the review scope is Blocked.

## Plan-to-Change Reconciliation

| Current plan scope | Descriptive changes-record summary | Current-state reconciliation | Gap or rationale |
|--------------------|-------------------------------------|-------------------------------|-------------------|
| P00 Freeze the fourteen-source inventory and the four-guide candidate lock | CHG-001 | Reconciled | scripts/data/cbh-mcu-companion-inventory.json holds fourteen records at positions 1 to 14 in exact research priority order under identity digest 06dd03db51c6e64c5ab43ba712dd6da4ff6a1cb6483e8eeefdf243aa86304ad2. Priorities 1 to 4 are shipped, 5, 6, 7, 9, 10 and 14 carry follow-up ranks 1 to 6, and 8, 11, 12 and 13 are blocked-no-complete-issue-boundary. |
| P01 Establish the screen-companion type and selected depth | CHG-002 | Reconciled | src/js/lib/catalog.js adds exactly one list type and one reading depth with labels and hints, and src/js/lib/curated.js accepts them. No existing type or depth changed. |
| P02 Integrate Marvel on Screen into the shared Home/Browse gateway | CHG-003, CHG-004, CHG-007 | Reconciled | One HOME_CATEGORIES row with tier secondary and route marvel-on-screen, a type selector rather than hard-coded ids, CUSTOM_CATEGORY_ROUTES derived in src/js/lib/route.js, and generatedCategoryByRoute dispatch in src/js/main.js. Three browse shelves remain and Storylines stays canonical through the unnamed-type fallback. |
| P03 Author the four-guide release | CHG-005 | Reconciled | Four packets, mappings, 100-comparison overlap reports and approvals, four order Markdown files, four generated payloads and the rebuilt catalog. 43 exact rows, zero unresolved, zero placeholders. |
| P04-T01, P04-T02 Prove failure detection and run the full gate set | CHG-006 | Reconciled | Four focused mutation failures recorded through git stash --keep-index; the full gate set is recorded and was independently reproduced here except for the live-API checks. |
| P04-T03 Run exactly one independent post-implementation Review | Not yet summarized in the changes record | Partial | This record is that Review. The changes record still describes the task as pre-Review and pre-implementation in three places, which is RV-001. |
| P05 Release and persist the merged result | Not started | Missing by design | Correctly outside this Review. P05 depends on this record. |
| Follow-Up Items | CHG-001 inventory follow-up ranks | Reconciled | Ten unshipped priorities are carried in the inventory with explicit dispositions and are routed below as distinct follow-up work, not as defects. |

## Completed Work Assessment

| Related marker | Files | What changed and why | Completion evidence | Validation | Assessment |
|----------------|-------|----------------------|---------------------|------------|------------|
| P00 | scripts/data/cbh-mcu-companion-inventory.json, scripts/lib/cbh-mcu-companion.mjs | All fourteen user-named sources are inventoried in priority order behind a fixed count and an identity digest, so the release ships four without losing the other ten or silently re-ordering them. | Fourteen records, positions 1 to 14 matching the research table exactly; MCU_COMPANION_COUNT is 14; selected, follow-up and blocked id lists are disjoint and exhaustive. Priority 6 pins WordPress post 40184 and names the rejected podcast post 40334. | Passed. test/cbh-mcu-companion.test.js validates the inventory; npm test 1424/1424. | Reconciled |
| P01 | src/js/lib/catalog.js, src/js/lib/curated.js | A screen companion is neither an event nor a character run nor an era, and its depth is a selection rather than a complete or beginner path, so both vocabularies gained exactly one value. | LIST_TYPES contains screen-companion, READING_DEPTHS contains selected, both with labels and hints; catalog type counts are event 75, creator-run 2, era 6, screen-companion 4, character-run 14. | Passed. Manifest validation rejects an unknown type; that rejection is one of the four proven mutations. | Reconciled |
| P02 | src/js/lib/catalog.js, src/js/lib/route.js, src/js/main.js, test/home-categories.test.js, test/catalog-shelves.test.js, scripts/browser-check.mjs | Marvel on Screen reaches the Hub through the shared category contract the incoming reading-hub merge already established, using a type selector and a generated child route, so no new shelf, rail item or bespoke page was introduced. | typeCategory('screen-companion') selects stories whose lists are all of that type; availableHomeCategories exposes the tile only when content exists; CUSTOM_CATEGORY_ROUTES resolves to exactly one route; availablePublishingCategories(allStories, 'marvel-on-screen') returns an empty list so the child page renders the card grid; CATALOG_SHELVES.length remains 3 under a new assertion. | Passed. Installed Edge 184/184 across 19 scenarios re-run here, including hash #/marvel-on-screen, focus marvel-on-screen-h, rail parent browse, count 4 Reading Lists, four titles in source order, and four cards in one column at 390px with no horizontal overflow. | Reconciled |
| P03 | scripts/data/cbh-packets, scripts/data/cbh-mappings, scripts/data/cbh-overlaps, scripts/data/cbh-approvals, src/data/orders, src/data/*.json, src/data/curated-lists.json | Four guides were transcribed as exact issue-bearing references only, resolved against live Marvel metadata, compared against the whole library, centrally approved where a real relationship existed, and generated into payloads and cards. | Mapping rows equal packet expectedCount equal payload items equal catalog count for every guide: 17, 17, 2, 7 summing to 43. All rows resolutionStatus exact; zero unresolved; zero placeholders; zero missing digitalId; zero missing cover; every declared coverIssueId present in its own guide; exclusions non-empty at 4, 5, 3 and 3; 43 release-wide distinct issue ids; mapping selectedIssueId order identical to payload issueId order for all four. | Passed. npm test 1424/1424 including six MCU-specific tests; general live contract and MCU live mapping contract recorded from implementation, see Validation Evidence. | Reconciled |
| P03 | scripts/data/cbh-overlaps | Every new guide was compared against the entire pre-publication library plus its three peers, so a duplicate or a subset could not ship unnoticed. | Each of the four reports carries comparisonCount 100, exactly 100 comparison objects, three peer digests and 100 dispositions with none missing and no relationship or disposition mismatch. Zero exact-duplicate comparisons exist. 396 of the 400 comparisons are none. The four non-none relationships are Doctor Strange against civil-war-avengers (partial, 6 issues) and against dark-reign-avengers (partial, 1), and Marvel Multiverse against xmen-claremont and xmen-claremont-complete (candidate-subset, 2 each), each approved with authorityType stronger-model and authorityIdentity MRT-004 coordinator. | Passed. test/cbh-mcu-companion.test.js proves an exact relationship has no approval path and that a policy authority on a candidate-subset is rejected. | Reconciled |
| P03 | test/cbh-character-spotlight.test.js | Publishing four new orders changes the library every earlier frozen report was hashed against, so each prior candidate's exclusion list gained the four new ids and the Star-Lord whole-report equality became a filtered-comparison equality. | The change follows the maintained prePublicationLibraryDigest exclusion mechanism already used for laterHistoricalIds, and the Star-Lord filtered form now matches the pattern the other four candidates already used. The Star-Lord block still asserts packetDigest, mappingDigest, reviewedLibraryDigest, reportDigest, approvalDigest, the three peerDigests, validateReportDigest and the full approved-relationship assertion. Star-Lord's stored report is untouched at 96 comparisons. | Passed. Freshness still fails closed: report.libraryDigest is compared against a digest recomputed from the current library. | Reconciled |
| P03 | PRODUCT_BACKLOG.md, CHANGELOG.md, docs/DATA_PROVENANCE.md, docs/MAINTAINING.md, docs/PUBLICATION_RUNBOOK.md, docs/UX_STUDY.md, README.md, GOVERNANCE.md | Product records were updated in the same change that ships the work, as the repository requires. | BL-210 detail block present with a constraint gate line and rationale, and its internal figures (43 rows, 400 relationships, 396 none, 101 catalog entries, 14 spotlight readings across 13 stories) are self-consistent. CHANGELOG Unreleased carries a plain-English and a maintainer paragraph. | Passed. Every prose count re-derived from the data: 101 files, 4,310 issue rows, 3,571 distinct ids, 4,241 with cover, 4,161 with creators, 82 CBH sourceOrigin, 5 CBRO, 99 order markdown files, 85 referencing Comic Book Herald, 82 cards linking CBH, 83 generated against 16 hand-compiled. All correct. | Reconciled |
| P04-T01 | test and data mutations, restored | Four focused failures were observed against the smallest relevant break rather than a whole-module revert. | The four recorded mutations each name the single test that fails. | Passed. Independently corroborated by the mutation proof: 41 of 41 browser mutations were caught by the scenario they were aimed at. | Reconciled |
| P04-T02 | Whole tree | The full gate set was run before Review. | Recorded in the changes record Validation Record. | Passed with one inaccurate figure. Eight gates plus two browser runs were reproduced here; the recorded browser mutation count of 22 does not reproduce on the final tree, which runs 41. See RV-001. | Partial |

## Implementation-Time Plan and Detail Update Assessment

| Affected area or marker | What changed and why | Triggering evidence and user decision | Reconciliation performed | Planning and critique state | Assessment |
|--------------------------|----------------------|----------------------------------------|---------------------------|------------------------------|------------|
| P02, P02-T01, P02-T02, P02-T03 and the Candidate Lock | The reading-hub work landed on main mid-task, retiring home-grid and home-featured and introducing a shared Home/Browse category contract with generated child routes. MRT-004 stopped adding a Hub partition of its own and joined the merged contract instead. | The merge of current main into the feature branch, recorded as CHG-007. The user decision that Marvel on Screen uses the existing shared category contract and a generated child route, with Storylines as the canonical shelf, is preserved exactly by this route. | Plan phase and task text, route registry, category renderer, tests, browser fixture, documentation, counts and validation expectations were updated. The Candidate Lock records the removals as belonging to the merge rather than to this feature. | PC-001, PC-002, PC-003 and PC-008 are dispositioned Resolved, then superseded by the integrated Hub. PC-004, PC-005, PC-006, PC-007 and PC-009 are Resolved. No fresh critique round was required because the superseding change narrowed scope and removed the surfaces those findings were about. | Reconciled, with one stale advisory list: the phase-details Likely Targets for P02-T02 and P02-T03 still name test/home-grid.test.js, which the merge deleted, while the Validation Expectations in the same blocks were updated to the shared category tests. Recorded as RV-004. |
| P03 evidence arithmetic | The comparison count moved from the 99 the critique reasoned about to the 100 the shipped reports carry. | The Star-Lord guide merged to main before this release, raising the pre-publication library from 96 orders to 97. | 97 library orders plus 3 peers is 100, which matches both the shipped reports and the research figure that was reached differently, as 96 plus 4 feasibility peers. | PC-005 remains correctly dispositioned; its arithmetic was superseded by a real library change rather than contradicted. | Reconciled |
| Backlog identity | The feature's backlog id moved as concurrent work claimed ids. | The Hub merge took BL-208 and Star-Lord took BL-209. | The shipped block is BL-210 and the ranked table row matches it. | No plan impact. | Gap in the record only: CHG-007 states the id moved from BL-208 to BL-209, which is not the shipped id. Recorded as RV-001. |
| Prior task artifact | A citation inside the earlier Star-Lord research artifact was re-aimed four lines later within src/js/lib/catalog.js, because this feature inserted four lines above the span it names. | The anchors gate enrolls citations in tracked files including dated tracking artifacts, so leaving it would have failed the gate. | The re-aim is content-faithful: the six lines named now are byte-identical to the six lines named before. | No plan or critique impact. | Divergence from repository instruction, justified by the gate and verified harmless. Recorded as RV-003. |

## Critique and Material Revision Assessment

* Latest critique dispositions: Complete. All nine findings PC-001 through PC-009 carry a disposition in the plan's Critique Disposition table, and the critique verdict of Revise was answered before P00 began. Four are marked resolved then superseded by the integrated Hub, and the supersession is explained by CHG-007 rather than asserted.
* Material revisions: One material revision occurred, the integrated Hub reconciliation. It narrowed the feature (no bespoke Hub partition, no new shelf, no new rail item) while preserving every confirmed user decision, and it is reflected in the current plan text, the phase details validation expectations, the Candidate Lock and the changes record. It did not introduce a new architecture, a new dependency or a new user-visible concept, so a fresh planning and critique round was not required. The one incompletely reconciled artifact is the advisory Likely Targets list noted as RV-004.
* Dependent-work pause assessment: No gap. P03 authoring did not begin before the P02 reconciliation settled, and the Star-Lord digest exclusions were added in the same change that published the four new orders, so no dependent evidence was left stale between commits.
* Justification assessment: Supported. Every divergence from the pre-critique plan is traceable to a recorded external event (the Hub merge, the Star-Lord merge) rather than to convenience, and each preserved the user's settled decisions.

## Plan Follow-Up Assessment

| Follow-up item | Why outside immediate scope | Owner or next action | Assessment and route |
|----------------|-----------------------------|----------------------|----------------------|
| Priorities 5, 6, 7, 9, 10 and 14 | The user set the first release at priorities 1 to 4. These six are mappable but unshipped, and each is a distinct later mapping release. | Later releases in user priority order, carried in the inventory as follow-up ranks 1 to 6. | Open, distinct follow-up work. Not a defect. Not to be pulled into MRT-004 scope. |
| Priorities 8, 11, 12 and 13 | These sources do not name a complete issue boundary, and the user rejected inferred collections. | Re-enter Research only when explicit issue enumeration or an approved exact collection mapping becomes available. | Open, distinct follow-up work, correctly blocked in the inventory with reason blocked-no-complete-issue-boundary. Not a defect and not an evidence gap in this task, because the blocker is a property of the source, not of the research. |

Unresolved plan follow-up items remain distinct follow-up work. Do not treat them as defects or add them to active `Pxx` or `Pxx-Txx` implementation, completion, or acceptance scope.

## Findings

<!-- rpi:review id=RV-001 -->
### RV-001 [Medium]: The changes record contradicts the state it records, and carries two figures that do not reproduce

* Related scope: P04-T02, and P05 which depends on this record
* Evidence: .copilot-tracking/changes/2026-08-23/mcu-best-of-guides-changes.md. Five distinct instances. The Execution Summary still ends "Production edits have not started." The Pre-Review Reconciliation states "Plan markers and phase details: P00 through P03 complete; P04 and P05 remain" and "Review readiness: Not ready; P00 through P04-T02 remain", both contradicting the Execution Status section in the same file, which records P04-T01 and P04-T02 complete. The Return-to-Caller State states "Current plan and detail updates: None after critique disposition", which CHG-007 contradicts directly. CHG-007 states the backlog id moved "from BL-208 to BL-209"; the shipped id is BL-210, and BL-209 is the Star-Lord guide. The Validation Record row for the mutation proof states "All 22 browser mutations were detected"; the final tree carries 41 mutations and a full proof run here reported 41 of 41 caught. The Validation Record row for P03-T02 cites 182 ranked rows, 5 parked, 187 detail blocks and 159 Shipped, superseded on the final tree by 184, 5, 189 and 161 and never restated.
* Impact: The changes record is the artifact P05 uses to write the pull request body, which the repository requires to record what was verified with numbers. A record that says production edits have not started, names the wrong backlog id, and states a mutation count that is roughly half the real one will produce a pull request body that is wrong in ways a reviewer cannot detect from the diff. The point-in-time counts row is defensible as a measurement taken when it was taken; the other four are not point-in-time, they are stale assertions about the present. None of this affects shipped product behavior, and no product data, code or test is wrong because of it.
* Destination: rpi-implement
* Smallest useful next action: Before P05-T02 writes the pull request, refresh four passages in the changes record: the Execution Summary closing sentence, the two Pre-Review Reconciliation lines, the Return-to-Caller State plan and detail line, and CHG-007's backlog id, and restate the mutation count as 41 with the counts row marked as measured at its own point in time. Do not open a separate change for this; it belongs inside the release commit P05 already makes.

<!-- rpi:review id=RV-002 -->
### RV-002 [Low]: The shared category empty state says "for this period", which is untrue for a non-publishing category

* Related scope: P02-T02
* Evidence: src/js/main.js, renderPublishingCategory, which emits "No Reading Lists are published for this period yet." That renderer is now shared by publishing-age categories and by the generated Marvel on Screen child route, because MRT-004 generalized publishingCategoryByRoute into generatedCategoryByRoute rather than adding a second renderer.
* Impact: None in the shipped product. The string is inherited from incoming main and is only reachable for Marvel on Screen by typing #/marvel-on-screen directly while the category has no content, which cannot happen with shipped data because the gateway tile and the route both exist only when the type selector finds stories. It is a latent copy defect that will surface if a future category is ever registered before its content lands.
* Destination: Distinct follow-up
* Smallest useful next action: Record a backlog entry to make the shared empty-state copy category-aware, and fix it inside whatever change next touches that renderer. Do not widen MRT-004 to carry it.

<!-- rpi:review id=RV-003 -->
### RV-003 [Low]: A citation inside a prior task's dated tracking artifact was re-aimed, which the repository instructions tell contributors not to do

* Related scope: P03
* Evidence: .copilot-tracking/research/2026-08-23/star-lord-complete-guide-research.md, row C8, whose third citation moved four lines later within src/js/lib/catalog.js, onto the same six-line span this feature had shifted. The repository instructions state that dated tracking artifacts are a historical record and must not be re-aimed to satisfy a gate, while the same instructions record that the anchors gate enumerates every tracked file, .copilot-tracking included. This is the first time a later task has edited an earlier task's dated artifact; every other dated artifact in the history was written once by its own task.
* Impact: Low and bounded. I compared both revisions directly: the six lines named now are byte-identical to the six lines named before, so the historical claim is preserved exactly and nothing was falsified to clear a red build. The real issue is that the instruction and the gate cannot both be obeyed once a later change shifts a line an old artifact cites, and the implementer resolved that silently rather than recording it. Left unaddressed, the next contributor faces the same conflict with no precedent to follow and may resolve it by editing the claim rather than the line number.
* Destination: Distinct follow-up
* Smallest useful next action: Record a backlog entry to reconcile the two instructions, either by exempting dated tracking artifacts from the gate or by stating that a content-faithful re-aim is the sanctioned resolution and must be noted in the changes record. Do not reverse the edit; reversing it would fail the gate and gain nothing.

<!-- rpi:review id=RV-004 -->
### RV-004 [Low]: Two phase-detail Likely Targets lists still name a test file the Hub merge deleted

* Related scope: P02-T02, P02-T03
* Evidence: .copilot-tracking/details/2026-08-23/mcu-best-of-guides-phase-details.md, the Likely Targets lists under P02-T02 and P02-T03, both naming test/home-grid.test.js. That file no longer exists; the merge replaced it with test/home-categories.test.js, which is the file the work actually touched. The Validation Expectations in the same two blocks were correctly updated to speak of the shared Home/Browse category tests, so the reconciliation was applied to the binding parts of the blocks and missed the advisory ones.
* Impact: Minimal. Likely Targets are advisory and no acceptance decision rests on them, and nothing in the delivered work was misdirected. It is recorded because the same CHG-007 reconciliation touched these blocks and left them half-updated, which is the kind of drift that misleads a future reader trying to learn what the merge changed.
* Destination: rpi-plan
* Smallest useful next action: Replace the two file names with test/home-categories.test.js the next time the plan or details are opened for another reason. Do not open a change, a commit or a pull request solely for this.

<!-- rpi:review id=RV-005 -->
### RV-005 [Low]: Verified conformance of the areas the review boundary named, recorded so the clean result is falsifiable

* Related scope: P00 through P04-T02
* Evidence: Source identity and digest integrity, all bindings between report, packet, mapping, library and peer digests match the values stored in each mapping's relationshipReview. The 43 exact mappings reconcile across four independent surfaces at 17, 17, 2 and 7. All four overlap reports carry 100 comparisons and 100 dispositions with three peer digests. Approval freshness fails closed, proven by recomputing the library digest from the live snapshot and by the two negative tests for an unapprovable exact relationship and an unauthorized policy authority. Star-Lord integration is correct and its stored report untouched. Generated payload order is identical to mapping order for all four guides, and the four screen companions sit at indexes 48 to 51 in user order in both the catalog and the manifest, each with depth selected, timeline null, beginner false and no spotlightKind. Character Spotlight is unchanged at 14 readings across 13 stories. Category route, navigation, accessibility and narrow behavior are proven in installed Edge. Provenance, licence and privacy hold: every cover is a remote https URL, no image bytes are stored, every payload description is empty, and the four order Markdown files state that no source commentary or images are copied. Documentation counts all re-derive correctly. The anchors corpus is 1181 citations with 0 drifted, 0 new and 0 removed, and seven re-aimed citations were read directly against the claims that cite them.
* Impact: Positive. This entry exists so the conformant verdict names what was checked and how, rather than asserting a clean result that a later reader cannot test. No action follows from it.
* Destination: No destination, informational
* Smallest useful next action: None.

## Defects

* RV-001, Medium, destination rpi-implement. It is a record defect rather than a product defect: no shipped code, data, test, document count or gate result is wrong because of it, but the release step that consumes the record would inherit four false statements and two unreproducible figures.
* No product defect was found. No finding blocks release once RV-001 is folded into the release commit.

## Routed Findings

| Finding | Destination | Owner or next action | Reason for route |
|---------|-------------|----------------------|------------------|
| RV-001 | rpi-implement | Refresh the four stale passages, correct BL-209 to BL-210, and restate the mutation count as 41 inside the P05 release commit | Implementation defect in a task artifact that P05 consumes |
| RV-002 | Distinct follow-up | Backlog entry for category-aware empty-state copy in the shared generated-category renderer | Residual work, latent and unreachable with shipped data |
| RV-003 | Distinct follow-up | Backlog entry reconciling the historical-artifact instruction with the anchors gate's tracked-file enumeration | Residual work on repository instructions, outside product scope |
| RV-004 | rpi-plan | Correct two advisory Likely Targets lists the next time the plan or details are opened | Incomplete reconciliation of a plan-stage artifact, non-blocking |
| RV-005 | None | None | Informational conformance evidence |

Later implementation of a routed finding does not require another Review.

## Residual Work

* RV-002, category-aware empty-state copy for generated categories that are not publishing ages. Scope is one string and its callers in src/js/main.js. Reason: unreachable with shipped data and inherited from incoming main, so fixing it inside MRT-004 would widen an unrelated surface.
* RV-003, reconcile the repository instruction that forbids re-aiming dated tracking artifacts with the anchors gate that enrolls them. Scope is repository instructions and possibly scripts/check-anchors.mjs. Reason: an instructions-level conflict, not a product change, and the instructions are exempt from the backlog rule while the gate change would not be.
* The ten unshipped inventory priorities, six ranked and four blocked, exactly as the plan's Follow-Up Items record them. Reason: the user set this release at priorities 1 to 4.

## Blockers and Remaining Work

* Blockers: None. No finding blocks P05, and RV-001's smallest action fits inside the release commit P05 already makes.
* Remaining active work: P04-T03 is closed by this record. P05-T01 (reconcile main a second time and rerun affected gates, including a full anchors read-and-bless cycle if any citation shifts) and P05-T02 (commit with the required trailer, push, open the pull request with a plain-English opening, read job conclusions rather than the run conclusion, merge, and persist the merged result) remain. Two notes for P05. If a conflict resolution touches any cited file, every citation in the touched documents must be re-derived against the final tree by both lock-head search and diff-hunk arithmetic, because taking one side of a conflict hunk invalidates any earlier re-aim without leaving a mark. And .copilot-tracking is ignored by .gitignore, so this review record needs an explicit forced add to be committed; the 19 review logs already in the history show that is the convention, and a plain add-all would silently drop it.

## Validation Evidence

| Command | Scope | Status | Summary |
|---------|-------|--------|---------|
| npm test | Whole repository at head 3f0f78f | Passed | 1424 pass, 0 fail. Includes the six MCU tests, the character spotlight suite with the four new exclusion ids, and the catalog assertion of 101 lists. Re-run by this Review. |
| npm run lint | Whole repository | Passed | eslint clean, exit 0. Re-run by this Review. |
| npm run counts | PRODUCT_BACKLOG.md | Passed | 184 ranked rows, 5 parked, 189 detail blocks, 161 Shipped, 21 Ready, 6 Dropped, 1 Proposed. Re-run by this Review. |
| npm run sizes | Stated file sizes | Passed | All 6 stated sizes agree with the files. Re-run by this Review. |
| npm run palette | Contrast pairs | Passed | 88 pairs checked, 5 recorded below floor, 0 new. Re-run by this Review. |
| npm run publication | Content surfaces at head | Passed | 0 content findings. Re-run by this Review. |
| npm run publication:surface | 9 branches | Passed | 0 content findings across 9 branches. Re-run by this Review. |
| npm run anchors | Every tracked file | Passed | 1181 citations unchanged, 0 drifted, 0 new, 0 removed, exit 0, 2 absent-marked exemptions. Re-run by this Review. Seven re-aimed citations were additionally read directly against their claims, which the bless print cannot do. |
| node scripts/browser-check.mjs | Installed Edge, 1280x900 and 390px | Passed | 184 assertions passed, 0 failed, across 19 scenarios, including the Marvel on Screen gateway, its generated child page, source order, count and narrow single-column layout. Re-run by this Review. |
| node scripts/browser-check.mjs --prove | Mutation catalog | Passed | 41 of 41 mutations caught by the scenario they were aimed at. Re-run by this Review, and the source of the figure correction in RV-001. |
| Added-line dash scan | git diff origin/main HEAD, added lines only, written to a file rather than piped | Passed | 0 added lines contain an em dash or an en dash. Re-run by this Review. |
| git diff --check | origin/main to HEAD | Passed | No whitespace errors, exit 0. Re-run by this Review. |
| npm run contract | Live Marvel metadata API | Passed, not re-run in Review | 33 of 33 across 17 requests, as observed by implementation. Not re-run because it calls a live third-party API, which the repository deliberately keeps out of gated runs so unrelated upstream state cannot decide a verdict. |
| MCU live mapping verification | The 43 selected issue ids against live metadata | Passed, not re-run in Review | 43 of 43, as observed by implementation. Same live-API reason. The frozen consequences of that run, digitalId presence, cover presence, titles and ordering, were fully re-derived here from the committed data. |

## Outcome

* Outcome: Conformant with justified divergence
* Outcome rationale: Every user requirement and settled decision in the boundary is met and was independently re-derived rather than accepted: all fourteen sources are inventoried in exact priority order behind an identity digest, priorities 1 to 4 shipped as 43 exact issue rows with zero unresolved and zero inferred content, Marvel on Screen reaches the Hub through the existing shared category contract and a generated child route with Storylines still canonical and three browse shelves intact, no Character Spotlight classification was applied and that shelf is unchanged at 14 readings across 13 stories, the screen-companion and selected vocabularies each gained exactly one value, no source expression was copied and no image bytes are stored, exact duplicates are unapprovable by construction and the four real relationships are centrally approved subsets and partials, and exactly one Review was run. Twelve validation commands were reproduced here and all passed, including 1424 of 1424 tests, 184 of 184 Edge assertions across 19 scenarios, 41 of 41 mutations caught, and an anchors corpus of 1181 with nothing drifted, added or lost. The divergences are justified rather than absent: the integrated reading-hub reconciliation recorded as CHG-007, which superseded four critique findings while narrowing scope and preserving every confirmed user decision, and the content-faithful re-aim of one citation in a prior task's dated artifact recorded as RV-003. The verdict is not reported clean because RV-001 is open: the changes record contradicts itself in four places and carries two figures that do not reproduce on the final tree. That is a record defect with no product consequence, its fix belongs inside the release commit P05 already makes, and it does not justify withholding acceptance of work whose every product-facing claim was verified.

## Closeout Routing Record

<!-- Persist outcome and route facts only. The rpi-review reference owns rendered closeout prose. -->

| Finding class | Destination | Owner or next action |
|---------------|-------------|----------------------|
| Implementation defect | rpi-implement | RV-001. Refresh the changes record's Execution Summary, Pre-Review Reconciliation and Return-to-Caller State, correct CHG-007's backlog id to BL-210, and restate the mutation count as 41, inside the P05 release commit. |
| Decision gap or invalid assumption | rpi-plan | RV-004 only, and non-blocking. Correct two advisory Likely Targets lists when the plan or details are next opened. No significant decision gap was found. |
| Material evidence gap | None | No material evidence gap. The four blocked inventory priorities are blocked by a property of the sources, not by missing research. |
| Non-blocking residual work | Distinct follow-up | RV-002 category-aware empty-state copy; RV-003 reconcile the historical-artifact instruction with the anchors gate; the ten unshipped inventory priorities in user order. |

* Execution status: Partial
* Outcome: Conformant with justified divergence
* Validation coverage: Twelve commands reproduced in this Review, all passed. Two live-API checks recorded as previously observed and not re-run, with their frozen consequences re-derived from committed data instead.
* Blockers: None.
