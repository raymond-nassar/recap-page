<!-- markdownlint-disable-file -->
# RPI Phase Details: MCU best-of guides

## Metadata

* Task ID: MRT-004
* Task slug: mcu-best-of-guides
* Related plan: .copilot-tracking/plans/2026-08-23/mcu-best-of-guides-plan.md
* Evidence sources: .copilot-tracking/research/2026-08-23/mcu-best-of-guides-research.md and its source-boundary and first-release mapping evidence

## Phase Index

| Phase ID | Name | Status | Detail sections |
|---|---|---|---|
| P00 | Reconcile and freeze release evidence | Complete | P00, P00-T01, P00-T02 |
| P01 | Guard the MCU companion provider flow | Complete | P01, P01-T01 to P01-T03 |
| P02 | Add Marvel on Screen product semantics | Complete | P02, P02-T01 to P02-T03 |
| P03 | Author the four-guide release | Complete | P03, P03-T01, P03-T02 |
| P04 | Prove the implementation and run one Review | Complete | P04, P04-T01 to P04-T03 |
| P05 | Release and persist the merged result | Complete | P05, P05-T01, P05-T02 |

<!-- rpi:phase id=P00 -->
## P00: Reconcile and freeze release evidence

### Context

Research is Ready with fourteen canonical source identities and a current 43-row first-release mapping, but concurrent catalog or source work may change the complete-library digest or source boundary before implementation starts. The current baseline is 96 readings across 89 stories and library digest `b59fa634730a8a342346f3bdb4984739d8e034b0faeff0cbb14557ce51604f90`; none of these figures outranks refreshed evidence.

### Intent

Establish a current, immutable release baseline before any generated or product surface depends on it.

### Boundaries

* Included: Fetch and reconcile current `main`; refresh source and issue-bearing digests; regenerate exact metadata, complete-library, and selected-peer evidence.
* Excluded: Authoring production catalog entries before freshness and relationship evidence passes.

### Likely Targets

* `.copilot-tracking/research/2026-08-23/mcu-best-of-source-boundaries.json`: source identity and digest baseline.
* `.copilot-tracking/research/2026-08-23/mcu-best-of-first-release-mapping.json`: exact metadata and relationship baseline.
* `.copilot-tracking/changes/2026-08-23/mcu-best-of-guides-changes.md`: implementation-time reconciliations and divergence.
* Current manifest and payloads: read-only baseline for library comparison.

### Dependencies

* Complete MRT-004 Research.
* Current remote `main`.

### Validation Expectations

* `origin/main` is merged into the feature branch, never rebased; command output and `$LASTEXITCODE` are read before any dependent work.
* `git rev-list --left-right --count HEAD...origin/main` records the actual reconciliation state before authoring.
* All four candidates remain exact, unique internally and across the release, and non-exact against the current library and peers.
* Source content and issue-bearing digests are recomputed with normal WordPress access and compared with Research.

### Completion Evidence

* Fresh source, metadata, library, peer, and approval inputs are persisted and digest-bound.

### Unresolved Items

* None. A changed source boundary, row count, or relationship pauses authoring and is handled as a durable implementation-time plan amendment, never by preserving a stale target.

<!-- rpi:task id=P00-T01 -->
### P00-T01: Reconcile current main and baseline counts

#### Context

The user explicitly named concurrent Star-Lord and other catalog work. Reports and approval digests are library-bound, so stale pre-publication counts are a release blocker rather than an informational difference.

#### Intent

Start production work from the actual current catalog and record the new comparison authority.

#### Boundaries

* Included: fetch current `main`; merge `origin/main` into the feature branch; read command output and exit status; re-derive list, story, type, Character Spotlight, and Hub counts; compute current library digest.
* Excluded: destructive reset, discarding user changes, or authoring selected guides before evidence refresh.

#### Likely Targets

* `src/data/curated-lists.json` and `src/data/catalog.json`: current read-only baseline.
* Changes record: durable baseline and any reconciliation divergence under CHG-xxx sections, including unplanned changes without inventing plan task ids.

#### Dependencies

* P00 phase start.

#### Validation Expectations

* No unmerged remote change is silently ignored.
* Existing full tests remain green before MRT-004 production changes begin.

#### Completion Evidence

* Current commit/base, counts, and library digest are recorded.

#### Unresolved Items

* None.

<!-- rpi:task id=P00-T02 -->
### P00-T02: Refresh all fourteen source identities and digests

#### Context

The inventory must remain complete even though only four rows advance. Several WordPress modification timestamps are not chronologically reliable, and priority 6 has two real near-identical posts.

#### Intent

Freeze the current canonical source state and every terminal disposition.

#### Boundaries

* Included: exact index target, canonical URL, WordPress post identity, retrieval timestamp, content and issue-bearing digests, explicit boundary class, chronology, exclusions, rank or blocker.
* Excluded: bypassing access controls, copying source prose, or mapping deferred guides.

#### Likely Targets

* `scripts/data/cbh-mcu-companion-inventory.json`: all fourteen records.
* Research source extractor and boundary evidence: reproducible source facts.

#### Dependencies

* P00-T01.

#### Validation Expectations

* Exactly 14 positions and unique ids/URLs.
* Priorities 1 to 4 are selected; 5, 6, 7, 9, 10, and 14 are ranked follow-ups; 8 and 11 to 13 are blocked.
* Priority 6 binds post 40184 and records post 40334 as rejected companion identity.

#### Completion Evidence

* Inventory identity digest and selected-id order are pinned by test.

#### Unresolved Items

* None.

<!-- rpi:phase id=P01 -->
## P01: Guard the MCU companion provider flow

### Context

CBH packet, mapping, overlap, approval, and authoring primitives already enforce exactness and freshness. The CBRO provider layer proves a thin inventory-specific adapter can preserve those primitives. This task uses the same provider as existing CBH flows, so it needs inventory semantics, not a duplicate ingestion framework.

### Intent

Make the four-guide evidence chain fail closed while preserving modern, character, and historical flows unchanged.

### Boundaries

* Included: one adapter, one inventory, four packets, mappings, reports, approvals, and semantic tests.
* Excluded: rewriting generic CBH primitives unless a concrete missing extension blocks this release.

### Likely Targets

* `scripts/lib/cbh-mcu-companion.mjs`: inventory and candidate-specific validation.
* `scripts/data/cbh-mcu-companion-inventory.json`: canonical inventory.
* `scripts/data/cbh-packets/`, `scripts/data/cbh-mappings/`, `scripts/data/cbh-overlaps/`: four records each.
* `test/cbh-mcu-companion.test.js`: semantic owner.

### Dependencies

* P00.

### Validation Expectations

* Stale source, packet, mapping, report, library, peer, approval, inventory, disposition, or generated sequence fails.
* Exact duplicates have no approval path.

### Completion Evidence

* New semantic test passes and existing CBH/CBRO suites remain unchanged and green.

### Unresolved Items

* None. The generic authorer remains canonical; the adapter is not a parallel authoring framework.

<!-- rpi:task id=P01-T01 -->
### P01-T01: Add the inventory adapter and terminal-state contract

#### Context

The character inventory has character-specific state rules, while this inventory must distinguish selected, ranked follow-up, and source-blocked movie companions.

#### Intent

Validate the complete fourteen-title decision state independently of the four-guide authoring batch.

#### Boundaries

* Included: count, identity digest, unique sources, WordPress identity, boundary status, metadata status, relationship state, delivery state, selected order, follow-up rank, and blocker reason.
* Excluded: changing `validateInventoryState` for character records or `validateCbroHistoricalInventory`.

#### Likely Targets

* `scripts/lib/cbh-mcu-companion.mjs`.
* `scripts/data/cbh-mcu-companion-inventory.json`.
* `test/cbh-mcu-companion.test.js`.

#### Dependencies

* P00-T02.

#### Validation Expectations

* Missing record, reordered priority, duplicate id/source, changed digest, selected-state mismatch, missing follow-up rank, or empty blocker fails.

#### Completion Evidence

* Fourteen identities and exact terminal states are locked by a canonical digest.

#### Unresolved Items

* None.

<!-- rpi:task id=P01-T02 -->
### P01-T02: Freeze four source packets and exact mappings

#### Context

Research mapped 43 rows exactly. Two rows require reviewed source-to-metadata aliases: New Avengers: Illuminati #0 to Marvel's one-shot metadata #1, and the unnumbered What If? Magik one-shot to its sole metadata issue #1.

#### Intent

Persist the exact source boundary, exclusions, row order, metadata identities, manifest proposals, and source reviews.

#### Boundaries

* Included: priorities 1 to 4 only; exact rows and explicit exclusions; original descriptions; `screen-companion`; `selected`; cover ids 55415, 43170, 13683, and 12135.
* Excluded: prose-only/contextual issues, inferred collection contents, priorities 5 to 14, source commentary, and image assets.

#### Likely Targets

* Four `scripts/data/cbh-packets/*.json`.
* Four `scripts/data/cbh-mappings/*.json`.
* `test/cbh-mcu-companion.test.js`.

#### Dependencies

* P01-T01.

#### Validation Expectations

* Counts equal the refreshed frozen packets; the current baseline is 17, 17, 2, and 7, and any changed source boundary pauses authoring and amends this plan before proceeding.
* Packet rows and mapping rows agree exactly by source reference and position.
* All 43 selected IDs are unique across the release.
* Every exclusion is non-empty, unique, and candidate-specific.

#### Completion Evidence

* Packet and mapping digests validate, all rows are exact, and deliberate omission or alias mutation fails.

#### Unresolved Items

* None.

<!-- rpi:task id=P01-T03 -->
### P01-T03: Bind complete-library, peer, and central approval evidence

#### Context

Priority 1 has partial relationships with Civil War Avengers and Dark Reign Avengers. Priority 3 is a complete candidate-subset of both shipped Claremont paths. The other two selected guides have no overlap, and no selected peers overlap each other.

#### Intent

Make the current relationship set and every disposition part of the approval digest.

#### Boundaries

* Included: every current library order, all three selected peers per candidate, current library digest, peer digests, policy `none` dispositions, stronger-model non-`none` dispositions, priority 3 scope rationale.
* Excluded: approval of any exact relationship or unreviewed future peer.

#### Likely Targets

* Four `scripts/data/cbh-overlaps/*.json`.
* Four approved mapping relationship reviews.
* `test/cbh-mcu-companion.test.js`.

#### Dependencies

* P01-T02.

#### Validation Expectations

* Comparison count equals the 97-list pre-publication library plus exactly the other three shipped peers, for 100. Research reached 100 by including deferred priority 6 as a fourth feasibility peer; final release reports exclude that peer and include the newly shipped Star-Lord card through current-library coverage.
* Every comparison has exactly one matching disposition.
* Exact duplication throws.
* Priority 3 subset rationale and card scope wording are asserted together.

#### Completion Evidence

* `assertApprovedRelationshipReview` passes for all four and fails under every deliberate freshness mutation.

#### Unresolved Items

* None.

<!-- rpi:phase id=P02 -->
## P02: Add Marvel on Screen product semantics

### Context

The approved Hub design keeps Timeline, Storylines, and Character Spotlights as primary groups, then adds non-empty categories. Current `main` implements only the three shelf-derived groups. Existing list types and reading depths cannot describe source-selected companion picks honestly.

### Intent

Add the smallest data and rendering model that names what these lists are and places them where the user decided.

### Boundaries

* Included: `screen-companion`, `selected`, Marvel on Screen Home category, truthful Storylines fallback context, tests, and browser coverage.
* Excluded: a fourth canonical shelf, direct rail item, Character Spotlight classification, or separate card renderer. The existing category contract supplies a generated child route.

### Likely Targets

* `src/js/lib/catalog.js`: type/depth labels and Home category partition.
* `src/js/lib/curated.js`: generic validation reuse; code change only if required by shared constants.
* `src/js/main.js`: Home section call.
* `test/catalog.test.js`, `test/curated.test.js`, `test/catalog-shelves.test.js`, `test/home-categories.test.js`.
* `scripts/browser-check.mjs`.

### Dependencies

* P01.

### Validation Expectations

* Exactly three browse shelves remain.
* Marvel on Screen appears only when matching stories exist and follows the three established Hub groups.
* Cards and headings reuse current accessibility and responsive behavior.

### Completion Evidence

* Targeted tests and browser scenario pass at desktop and narrow widths.

### Unresolved Items

* None. Current `main` now owns a shared Home/Browse category gateway with generated category pages; Marvel on Screen extends that registry instead of introducing a separate partition.

<!-- rpi:task id=P02-T01 -->
### P02-T01: Add screen-companion and selected taxonomy

#### Context

`character-run`, `event`, `creator-run`, `era`, `essential`, `complete`, and `tie-ins` all assert semantics the selected lists do not have.

#### Intent

Expose accurate labels and validation without affecting spotlight taxonomy.

#### Boundaries

* Included: constants, labels, hints, filter order, parsing, manifest validation, and negative `spotlightKind` coverage.
* Excluded: changing existing labels or depth meanings.

#### Likely Targets

* `src/js/lib/catalog.js`.
* `test/catalog.test.js`.
* `test/curated.test.js`.

#### Dependencies

* P01-T02.

#### Validation Expectations

* `typeLabel('screen-companion')` is `Screen companion`.
* `depthLabel('selected')` is `Selected issues`, with a plain-language hint.
* Spotlight taxonomy remains invalid on the new type.

#### Completion Evidence

* Manifest and generated catalog parse all four entries with no drops.

#### Unresolved Items

* None.

<!-- rpi:task id=P02-T02 -->
### P02-T02: Render the non-empty Marvel on Screen Hub category

#### Context

The Hub currently calls `shelfSections` and therefore cannot draw an additional category name.

#### Intent

Partition Hub content through a separate table while leaving browse shelf behavior stable.

#### Boundaries

* Included: one `HOME_CATEGORIES` row with a type selector, generated child-route registration, non-empty behavior, source ordering, and counts.
* Excluded: hard-coded candidate ids, a fourth `CATALOG_SHELVES` row, or a direct rail item.

#### Likely Targets

* `src/js/lib/catalog.js`.
* `src/js/main.js`.
* `test/home-categories.test.js`.

#### Dependencies

* P02-T01.

#### Validation Expectations

* `availableHomeCategories` exposes Marvel on Screen only when its type selector finds content.
* Existing primary and publishing categories retain names and order; Marvel on Screen is a secondary category before publishing ages.
* Empty Marvel on Screen data yields no gateway tile.
* The shared Home/Browse category tests assert availability, route uniqueness, generated child pages, and concise status updates.
* All four `timeline: null` screen companions populate Marvel on Screen in inventory order and remain outside publishing-age claims.

#### Completion Evidence

* Four shipped stories appear once under Marvel on Screen in user priority order.

#### Unresolved Items

* None.

<!-- rpi:task id=P02-T03 -->
### P02-T03: Preserve browse, accessibility, and narrow-layout contracts

#### Context

Unknown types currently reach Storylines through the fallback. Once `screen-companion` is known, it still needs a browse destination because the user prohibited a new one.

#### Intent

Keep reachability and keyboard/screen-reader behavior while making Storylines context broad enough to include companion picks.

#### Boundaries

* Included: fallback reachability, truthful blurb adjustment, heading levels, counts, accessible names, focus behavior, featured-pick stability, 1280x900 and narrow viewport proof.
* Excluded: moving any existing story, changing Character Spotlight counts, or category-specific card CSS.

#### Likely Targets

* `src/js/lib/catalog.js`.
* `test/catalog-shelves.test.js`.
* `test/home-categories.test.js`.
* `scripts/browser-check.mjs`.

#### Dependencies

* P02-T02.

#### Validation Expectations

* Every story reaches one browse screen and one appropriate Hub group.
* Three browse routes remain.
* The adaptive grid becomes one column at narrow width with no horizontal overflow.
* Marvel on Screen is a gateway button with an explicit accessible name and a generated child page whose heading receives focus.
* The merged Hub's retired featured picker is not restored.

#### Completion Evidence

* Browser proof records the gateway tile, child-route focus, four cards, import control names, source order, counts, and narrow layout.

#### Unresolved Items

* None.

<!-- rpi:phase id=P03 -->
## P03: Author the four-guide release

### Context

The generic CBH authorer already writes project-authored Markdown and manifest entries from approved mappings. Vendor generation derives catalog counts and cover data from payloads.

### Intent

Publish the four approved evidence chains without hand-maintaining generated counts or metadata.

### Boundaries

* Included: four order Markdown files, manifest entries, generated payloads, catalog rebuild, product documentation, backlog, changelog, and anchors.
* Excluded: hand-editing generated payload metadata, copied commentary, or any deferred guide.

### Likely Targets

* `src/data/orders/*.md`, `src/data/curated-lists.json`, four `src/data/*.json`, `src/data/catalog.json`.
* `README.md`, `CHANGELOG.md`, `PRODUCT_BACKLOG.md`, `docs/DATA_PROVENANCE.md`, `docs/MAINTAINING.md`, `docs/PUBLICATION_RUNBOOK.md`, `docs/UX_STUDY.md`.
* `docs/anchors.lock.json`.

### Dependencies

* P01 and P02.

### Validation Expectations

* Generated outputs agree with mappings and source attribution.
* Every changed count in touched documentation is re-derived.

### Completion Evidence

* Catalog contains the refreshed pre-publication count plus four readings, four new screen companions, and unchanged Character Spotlight counts; the current baseline would become 100.

### Unresolved Items

* Exact final catalog total is re-derived after P05-T01 rather than assumed.

<!-- rpi:task id=P03-T01 -->
### P03-T01: Author exact checklists, payloads, manifest, and cards

#### Context

The four approved mappings are the row authority. Card order must preserve priorities 1, 2, 3, and 4 rather than timeline chronology.

#### Intent

Generate all user-visible list data from approved evidence.

#### Boundaries

* Included: insertion before the existing character best-of run, stable priority order, original descriptions, source links, `screen-companion`, `selected`, explicit `timeline: null`, explicit `beginner: false`, exact cover ids, offline order files, payload generation.
* Excluded: manual payload rows, source prose, or grouping these as variants of one story.

#### Likely Targets

* Generic CBH authorer invocation.
* Four manifest entries and order files.
* Vendor invocation for the four ids and catalog rebuild.

#### Dependencies

* P01-T03 and P02-T01.

#### Validation Expectations

* Counts and IDs match mapping exactly.
* Payloads hold zero placeholders/unresolved rows.
* Card names and descriptions stay project-authored and dash-free.
* The Marvel on Screen type selector retains all four manifest entries, publishing-age selectors retain none of the undated cards, and no featured recommendation is restored.

#### Completion Evidence

* Semantic test compares packet, mapping, Markdown, payload, manifest, and catalog end to end.

#### Unresolved Items

* None.

<!-- rpi:task id=P03-T02 -->
### P03-T02: Update maintenance, provenance, product, and UX records

#### Context

This release adds a source inventory, an ingestion variant, a list type/depth, a Hub category, four catalog cards, and follow-up states readers and maintainers need to understand.

#### Intent

Keep product and maintainer records synchronized with shipped behavior.

#### Boundaries

* Included: Unreleased changelog, one shipped backlog block with `Constraint gate: checked 1 to 11, none breached`, source/license boundary, authoring workflow, publication gates, Hub category UX, visible counts, and README companion count if affected.
* Excluded: rewriting unrelated history or opening separate work for documentation drift.

#### Likely Targets

* `CHANGELOG.md`, `PRODUCT_BACKLOG.md`.
* `README.md`, `docs/DATA_PROVENANCE.md`, `docs/MAINTAINING.md`, `docs/PUBLICATION_RUNBOOK.md`, `docs/UX_STUDY.md`.

#### Dependencies

* P03-T01.

#### Validation Expectations

* Every count in touched sections is re-derived.
* Source attribution says no licence was conveyed for the source guide and the project's MIT licence covers only project-authored expression and code.
* Product copy carries no em or en dash.

#### Completion Evidence

* Documentation tests, counts, publication, and anchors pass after read/re-aim/bless.

#### Unresolved Items

* None.

<!-- rpi:phase id=P04 -->
## P04: Prove the implementation and run one Review

### Context

The release crosses recovery-sensitive evidence chains, generated data, catalog taxonomy, Hub rendering, accessibility, and external metadata. Unit, release, and browser gates cover different risks.

### Intent

Prove exact behavior and run the one independent Review before publication.

### Boundaries

* Included: failure proof, all repository gates, live contract, browser proof, diff/dash review, one independent Review, one fix pass.
* Excluded: repeated Review cycles or unrelated cleanup.

### Likely Targets

* Existing npm scripts and browser check.
* `.copilot-tracking/reviews/logs/2026-08-23/mcu-best-of-guides-review.md`.
* Changes record validation section.

### Dependencies

* P03.

### Validation Expectations

* New tests fail without their guarded fix and pass after restoration.
* Review returns no unresolved in-scope blocker.

### Completion Evidence

* Exact command/assertion counts, browser scenarios, Review findings, fixes, and routed follow-ups are persisted.

### Unresolved Items

* None.

<!-- rpi:task id=P04-T01 -->
### P04-T01: Prove semantic checks fail without the fix

#### Context

Repository policy rejects checks that have never been seen fail.

#### Intent

Demonstrate each new semantic family detects the smallest broken behavior.

#### Boundaries

* Included: stash only the smallest relevant source/data/test target for source omission, stale digest, missing central approval, taxonomy rejection, Hub placement, and priority 3 scope copy.
* Excluded: whole-module reverts when one line or artifact provides a narrower proof.

#### Likely Targets

* New MCU semantic test and smallest production/data changes.
* Changes record proof table.

#### Dependencies

* P03.

#### Validation Expectations

* Each proof names the reverted change, expected failing test, actual failure, restoration, and green rerun.

#### Completion Evidence

* At least one observed failure for each materially new check family.

#### Unresolved Items

* None.

<!-- rpi:task id=P04-T02 -->
### P04-T02: Run full gates and real-browser proof

#### Context

CI does not run the live metadata contract or local installed-Edge behavior.

#### Intent

Cover static, dynamic, release, external-contract, and visual behavior.

#### Boundaries

* Included: lint, full tests, counts, sizes, palette, publication, MCU release checks, anchors, contract, browser desktop/narrow, dash scan, diff review.
* Excluded: adding new tooling or `puppeteer-core` to project dependencies.

#### Likely Targets

* `package.json` scripts as already defined.
* `scripts/browser-check.mjs`.
* Scratch Puppeteer installation outside the repository.

#### Dependencies

* P04-T01.

#### Validation Expectations

* Edge at 1280x900 and narrow width shows Marvel on Screen, four cards, correct order/count, keyboard navigation, import, sampled sequences, and no overflow.
* New files are added to the index before anchors run, and ignored tracking artifacts are force-added so the gate can see them.
* Every moved citation target is derived both from the lock's head text and from diff-hunk shift arithmetic; disagreements are reconciled before bless.
* Anchor run reaches 0 drifted, 0 new, 0 removed after read/re-aim/bless.

#### Completion Evidence

* Exact pass/fail/assertion counts are recorded.

#### Unresolved Items

* None.

<!-- rpi:task id=P04-T03 -->
### P04-T03: Run exactly one independent post-implementation Review

#### Context

User direction allows one Review only and requires routing instead of looping.

#### Intent

Obtain independent correctness assessment and close material release blockers once.

#### Boundaries

* Included: complete branch diff, user requirements, Research, Plan, changes evidence, validation output, data/privacy/accessibility/release risks.
* Excluded: a second Review after fixes; unrelated findings become backlog follow-ups.

#### Likely Targets

* Review artifact.
* In-scope code/data/docs if one fix pass is required.
* Product backlog for unrelated routed work.

#### Dependencies

* P04-T02.

#### Validation Expectations

* Every finding has a disposition.
* No clean verdict is recorded while a material in-scope finding remains open.

#### Completion Evidence

* One independent Review artifact recorded a Conformant with justified divergence outcome, no product defect, no blocker, one medium record-integrity correction for P05, and distinct routing for unrelated low-severity residual work.

#### Unresolved Items

* None.

<!-- rpi:phase id=P05 -->
## P05: Release and persist the merged result

### Context

Library-bound evidence and anchors can become stale when concurrent work lands. The repository's CI reports cancelled jobs and real failures differently only at job/log level.

### Intent

Integrate current `main`, rerun affected proof, merge through a complete PR, and preserve the final state.

### Boundaries

* Included: second main reconciliation, affected report/approval/catalog/count/anchor/browser regeneration, commit, push, PR, job monitoring, merge, merged-state verification.
* Excluded: widening the feature or treating superseded/cancelled CI as a product failure.

### Likely Targets

* Final branch and PR.
* Changes record and plan checkboxes.

### Dependencies

* P04.

### Validation Expectations

* Node 20, Node 24, and lint job conclusions are green on the final head.
* Merged `main` contains all four cards and final evidence.

### Completion Evidence

* PR URL/number, merged commit, job conclusions, and final gate reruns are persisted.

### Unresolved Items

* None.

<!-- rpi:task id=P05-T01 -->
### P05-T01: Reconcile main and rerun affected gates

#### Context

Any concurrent catalog change invalidates library, comparison, approval, count, and anchor evidence.

#### Intent

Make the release evidence describe the tree that will actually merge.

#### Boundaries

* Included: merge `origin/main` into the feature branch, read command output and exit status, resolve conflicts, regenerate reports/approvals, re-derive counts and anchors, rerun targeted browser proof, and apply the user-requested count-free README inventory wording with directly affected checks and records. Replace stale README imagery with exactly two current screenshots captured at 1280x900 in installed Edge from a clean profile against a temporary freshly fetched `origin/main` render at `127.0.0.1:8787`: Home and the actual Avengers Disassembled reading view with no personal data or fabricated progress.
* Excluded: rebase, force-push, suppressed command output, destructive reset, or trusting pre-reconciliation green output.

#### Likely Targets

* Library-bound reports and approvals.
* Catalog, docs, anchors, and validation record if shifted.

#### Dependencies

* P04-T03.

#### Validation Expectations

* Every changed evidence digest is centrally re-approved.
* Every conflict-touched citation is re-derived against the final tree by both lock-head search and diff-hunk arithmetic.
* No final citation points to pre-conflict content.

#### Completion Evidence

* Current `main` through 4a0e837 is merged without rebase. The combined tree passes 1,431 tests, lint, counts, sizes, palette, publication, publication surface, 33 general live assumptions, 43 MCU issue identities, 184 Edge assertions, all 41 browser mutations, the dash and diff checks, and 1,181 unchanged anchors with no drift, additions, or removals.
* README references exactly `docs/screenshots/home-1280.png` and `docs/screenshots/avengers-disassembled-reading-1280.png`. Both are 1280x900 captures from a clean external archive of current `origin/main`, with cover art off; the reading view shows Avengers Disassembled at zero marked progress.

#### Unresolved Items

* None.

<!-- rpi:task id=P05-T02 -->
### P05-T02: Open, monitor, and merge the pull request

#### Context

The owner needs plain-English orientation, exact proof counts, and honest CI interpretation before merge.

#### Intent

Deliver and persist the merged feature.

#### Boundaries

* Included: commit with required trailer, push, PR body, job/log monitoring, blocker fix if needed, merge, merged result record.
* Excluded: force-push, amend, repeated Review, or extra feature work.

#### Likely Targets

* Git commit and pull request.
* Changes record merged-result section.

#### Dependencies

* P05-T01.

#### Validation Expectations

* PR begins with `## In plain English` and names no file, identifier, command, or backlog id in that section.
* Technical sections record exact verification counts.
* Required jobs are green on final head.

#### Completion Evidence

* Pull request 181 is the durable delivery identity. Hosted run 32693329995 completed Tests on Node 20, Tests on Node 24, and Lint successfully on head 0b69013 before the delivery record commit.
* GitHub reports the pull request clean and mergeable, and current `origin/main` at 4a0e837 remains an ancestor of the release.

#### Unresolved Items

* None.
