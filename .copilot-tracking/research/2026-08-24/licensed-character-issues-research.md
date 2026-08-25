<!-- markdownlint-disable-file -->
# Research: Licensed-character issues in historical event guides

## Research Brief

* Parent task: MRT-003-C02
* Date: 2026-08-24
* Topic: Honest representation of ROM, Micronauts, and Power Pack source rows that are absent from
  Marvel Unlimited because of IP-rights restrictions
* Purpose: Replace the obsolete successful-lookup expectation, determine whether the current product
  model can retain every source row without false identity or availability claims, and identify the
  safest next action
* Audience: Historical-events continuation coordinator and the user
* Output mode: Analysis with planning-readiness assessment
* Posture: Focused, because the caller supplied the exact affected guides and prohibited implementation
* Scope: Wraith War, Secret Wars II, Mutant Massacre, issue identity contracts, payload requirements,
  five-state availability, manual-entry behavior, the no-silent-drop rule, and comparison with the
  supplied Comic Book Herald essential-trades page
* Non-goals: Restarting batch implementation, inventing Marvel issue IDs or URLs, asserting issue
  availability, or resolving unrelated historical events

## Authoritative Direction

The user states that the affected ROM, Micronauts, and Power Pack issues are not on Marvel Unlimited
because of IP-rights restrictions. Absence from Marvel Unlimited metadata is therefore not an
unresolved lookup expected to succeed. Research must treat the rights restriction as the explanation
for the blocked source rows, assess honest unavailable-row representation, and ask only for evidence
still needed to support that representation.

The confirmed product decision is: "I think we should omit them, since they won't be discoverable for
anyone but the most hardcore physical comics collectors." Here, "them" means only the IP-restricted
ROM, Micronauts, and Power Pack rows absent from Marvel Unlimited in Wraith War, Secret Wars II, and
Mutant Massacre.

The user further confirms that these series are not essential to any of the three affected event
storylines. The curated app guides may therefore omit those nonessential tie-ins because readers
cannot discover them through Marvel Unlimited. This is an intentional, explicit product-scope
exclusion. It is not a silent resolver drop, does not rewrite the external source as if the rows were
absent there, does not claim the issues are unimportant to the source chronology, and does not apply
to any other guide without new evidence.

The user also supplied
https://www.comicbookherald.com/the-25-essential-trades-to-marvel-comics-from-1961-to-2000/ as a
supplemental curation source containing historical events and issues that may be essential for
comic-book readers. It is evidence to compare with the current source cursor and shipped guides,
not an instruction and not automatic proof that every trade or issue belongs. Research must preserve
its URL, retrieval timestamp, and content digest, identify missing essential coverage and duplicates,
and use the comparison only to strengthen inclusion or exclusion rationale.

## Questions

1. Can a curated guide row exist without a Marvel issue ID or canonical Marvel URL?
2. Can the five-state availability model express a known rights-restricted absence without claiming
   availability?
3. Does the manual-entry path provide a safe product representation, or does it require user-specific
   state that cannot be shipped in a curated guide?
4. What minimum evidence is still needed from the user?
5. Which recommendations from the supplied essential-trades page are already covered, missing before
   Maximum Security, outside the current event scope, or duplicates?

## Research Cycle 1

### Wider

The current generator already has an explicit non-drop representation for a checklist row without a
Marvel link. It creates a deterministic negative identifier, retains the title in source order, and
sets every Marvel-specific field to null (`scripts/vendor-orders.mjs:73-84` and
`scripts/vendor-orders.mjs:275-298`). The app counts and discloses those placeholders rather than
hiding them (`src/js/lib/model.js:121-160`).

That mechanism proves the data model could retain an unavailable issue, but it is not the selected
product behavior. The user has chosen explicit omission of the named nonessential tie-ins.

The supplemental Comic Book Herald page was retrieved on 2026-08-25T02:20:42.8651808Z. The raw
response was 240,452 bytes with SHA-256
`02c1da6e95b3d400ca7cd26b5c5cec5a0e60ab43ad7f5db0e4a49354918bacc5`.
It contains 25 recommendations spanning 1961 through 2000.

### Deeper

The five-state model cannot encode a publisher-known or rights-based unavailable state. With no
metadata date and no reader override, an item is `unknown`; `override-unavailable` is explicitly
labelled "You marked unavailable" and belongs to the reader, not the shipped catalog
(`src/js/lib/availability.js:17-30` and `src/js/lib/availability.js:57-64`). Preloading that override
would falsely attribute a project decision to the reader.

Omitted rows do not need an availability state because they are not shipped items. The safe contract
is instead an exact exclusion ledger: preserve each source position and issue reference, mark the
reason as this user-approved, guide-scoped rights/discoverability exclusion, and prove that source
rows equal included rows plus excluded rows. The product guide must use an `essential` or `selected`
depth rather than `complete`; both values already exist in the catalog contract
(`src/js/lib/catalog.js:11-13`).

The three guide projections are:

| Guide | Source rows | Explicitly excluded | Remaining discoverable rows | Other metadata blockers |
|---|---:|---:|---:|---|
| Wraith War | 35 | 28 | 7 | None found |
| Secret Wars II | 42 | 2 | 40 | None recorded |
| Mutant Massacre | 12 | 1 | 11 | None recorded |

Wraith War excludes source positions 1-13, 15, 18-23, and 28-35: `ROM #40` through `ROM #66`
inclusive and `ROM Annual #3`. Its remaining rows are `Incredible Hulk #296`, `Avengers #244-245`,
and `Uncanny X-Men #185-188`. All seven returned complete current configured metadata records,
including positive issue and digital IDs, canonical Marvel URLs, series identities, dates, and
covers on 2026-08-25. This corrects the prior "30 unresolved" count: the source page contains 28,
not 30, ROM or ROM Annual issue rows.

Secret Wars II excludes source position 18, `ROM #72`, and source position 27,
`Micronauts Vol. 2 #16`. Mutant Massacre excludes source position 7, `Power Pack #27`. The prior
batch-three research identified no other unresolved row in either guide.

The supplemental source comparison is:

| Recommendation | Current coverage |
|---|---|
| Amazing Spider-Man #1-38 and Amazing Fantasy #15 | All 39 issues occur in the catalog; no new standalone event is implied |
| Fantastic Four #31-60 and Annual #2-4 | Partial, 6 of 33 issues occur |
| Silver Surfer #1-18 | Missing as an explicit range, 0 of 18 occur |
| Strange Tales #110-111 and #114-146, plus Amazing Spider-Man Annual #2 | Missing as an explicit range, 0 of 36 occur |
| Kree-Skrull War | Exact standalone duplicate, 9 of 9 |
| Death of Gwen Stacy | All five listed issues occur, but the standalone event contains only #121-122 |
| Howard the Duck #1-33 | Missing as an explicit range, 0 of 33 occur |
| Uncanny X-Men through #131 | Near-complete overlap; 39 of 40 listed issues occur, with Annual #3 absent |
| Iron Man: Demon in a Bottle | No named guide; exact trade contents still require extraction |
| Daredevil #158-191 | Missing as an explicit range, 0 of 34 occur |
| The Life and Death of Captain Marvel | No named guide; exact trade contents still require extraction |
| Uncanny X-Men #132-142 | Complete issue-level overlap, 11 of 11 |
| Wolverine #1-4 | Complete issue-level overlap, 4 of 4 |
| Thor #337-382 | Partial, 11 of 46 issues occur |
| Secret Wars #1-12 | Exact standalone duplicate, 12 of 12 |
| Squadron Supreme | No named historical guide; exact trade contents still require extraction |
| God Loves, Man Kills | The named graphic novel occurs in both Claremont guides |
| Daredevil: Born Again and Man Without Fear | No named guide; exact trade contents still require extraction |
| Elektra: Assassin | No named guide; exact trade contents still require extraction |
| Silver Surfer: Rebirth of Thanos and Thanos Quest | No named guide; exact trade contents still require extraction |
| Kraven's Last Hunt | Standalone duplicate; the shipped guide also retains its later epilogue |
| Infinity Gauntlet | Six main-series issues occur inside the Doom primer; the timeline event remains deferred |
| Wolverine: Weapon X | No named guide; exact trade contents still require extraction |
| Marvels | No named guide; exact trade contents still require extraction |
| Age of Apocalypse | Existing historical inventory candidate remains deferred, not shipped |

### Contrarian

Shipping placeholders would preserve every source row, but it would oppose the confirmed omission
decision and would label known rights-restricted rows merely "Availability unknown." Preloading
`override-unavailable` would be worse because the UI says the reader made that judgment. Adding a
sixth global-unavailable state would widen the product model and is unnecessary when the rows are
intentionally outside the curated guide.

Calling the reduced guides `complete` would also be misleading. Wraith War omits 28 of 35 source rows,
so its safe framing must say that it is an essential or Marvel-Unlimited-discoverable companion and
must disclose the exclusions. The external source still owns the full chronology.

## Findings

* C1: The existing placeholder path can retain unlinked rows without invented IDs, but it is not the
  selected product behavior.
* C2: The five-state availability model has no project-authored global-unavailable state. The only
  explicit unavailable value is reader-owned.
* C3: Exact, auditable omission satisfies the revised no-silent-drop intent when the ledger proves
  conservation of every source row and the guide is not labelled complete.
* C4: After the approved exclusions, no issue-level metadata blocker remains for Secret Wars II or
  Mutant Massacre.
* C5: Wraith War has 28 rights-restricted rows, not the previously recorded 30. All seven retained
  rows now resolve fully, so its remaining blocker is honest guide framing rather than metadata.
* W1: The Wraith War source lists 35 rows, including `ROM #40-66` and `ROM Annual #3`;
  https://comicbookreadingorders.com/marvel/events/wraith-war-reading-order/, retrieved 2026-08-25.
* W2: The Secret Wars II source places `ROM #72` at position 18 and `Micronauts Vol. 2 #16` at
  position 27; https://comicbookreadingorders.com/marvel/events/secret-wars-ii-reading-order/,
  retrieved 2026-08-25.
* W3: The Mutant Massacre source places `Power Pack #27` at position 7;
  https://comicbookreadingorders.com/marvel/events/mutant-massacre-reading-order/, retrieved
  2026-08-25.
* W4: The supplemental 25-trades page and its preserved digest provide curation evidence but do not
  establish issue identity for headings that name only a trade;
  https://www.comicbookherald.com/the-25-essential-trades-to-marvel-comics-from-1961-to-2000/,
  retrieved 2026-08-25.

## Current Decision State

The earlier lookup-success research checklist is superseded. No issue identity, URL, or availability
value may be inferred from absence. The selected direction is three smaller curated orders with exact
exclusion ledgers, not placeholder rows or fabricated Marvel identities.

The supplemental page does not replace the position-17 cursor. It establishes separate coverage
candidates and duplicates for later prioritization.

## Planning Readiness

### Continuation reconciliation

* Research disposition: Reused after reconciliation against current project-default `main` at
  `64197241e60625fdd295b826e14df91a36868a89`.
* Continuation task: MRT-003-C02-B04. This is the next bounded child of the committed MRT-003-C02
  historical-event lineage, not a new parent task.
* Decision provenance: Confirmed user decisions relayed by the coordinating session and reconciled
  against the predecessor's durable research file.
* Current product baseline: Batch three is merged. The three affected inventory records remain
  blocked, no packet, mapping, report, checklist, or payload exists for them, and The Evolutionary
  War remains the position-17 cursor.
* Current implementation fit: The existing packet, mapping, report, approval, atomic authoring, and
  release machinery can be reused. It needs one narrow structured exclusion extension so retained
  row positions and excluded row positions jointly reconstruct each complete source sequence.
* Contrarian result: Reclassifying the missing rows as availability records would falsely use a
  reader-owned state. Leaving the guides blocked would ignore the approved product-scope decision.
  Advancing position 17 would widen this batch. The exact exclusion ledger is the only in-scope
  direction that satisfies the confirmed decision and source conservation.

### Context Map

#### Files to Modify

| File | Purpose | Changes Needed |
|---|---|---|
| scripts/lib/cbh-inventory.mjs | Shared frozen packet and mapping evidence contract | Add optional structured excluded-row evidence, exact source-position reconstruction, and digest binding without changing packets that have no exclusions |
| scripts/lib/cbro-evidence.mjs | Historical release, inventory, and review authority | Add MRT-003-C02-B04, three selected guide states, exact exclusion policy, relationship decisions, and compatibility digests |
| scripts/prepare-cbro-event.mjs | Exact mapping preparation | Carry structured exclusions and retained source positions into mappings |
| scripts/author-cbro-packet.mjs | Approval and checklist authoring | Preserve the exclusion ledger and render bounded reader-facing disclosure |
| scripts/data/cbro-historical-inventory.json | Maintained 58-entry historical inventory | Promote positions 12 through 14, correct Wraith War's stale count, and preserve position 17 |
| scripts/data/cbro-packets | Frozen source evidence | Add three packets containing 58 retained rows and 31 exact exclusions |
| scripts/data/cbro-mappings | Exact metadata evidence | Add three exact retained-row mappings with no invented metadata |
| scripts/data/cbro-overlaps | Complete relationship evidence | Add three current-library and selected-peer reports |
| src/data/curated-lists.json and generated catalog | Product guide definitions | Add three non-complete guides with explicit scope disclosure |
| src/data/orders and generated payloads | Reader-facing checklists and issue data | Add 58 retained issues in original relative order |
| test/cbro-historical-events.test.js | Historical evidence and release regression suite | Prove conservation, exact ledgers, retained positions, remapping, reports, release authority, compatibility, and rejected omissions |
| CHANGELOG.md, PRODUCT_BACKLOG.md, docs/DATA_PROVENANCE.md | Product and maintenance record | Record the bounded release, exclusions, corrected count, and unchanged future cursor |
| .copilot-tracking | Durable RPI evidence | Record plan, critique, details, changes, and one Review under MRT-003-C02-B04 |

#### Dependencies

| File | Relationship |
|---|---|
| scripts/lib/cbh-inventory.mjs | Packet digests, mapping digests, source position reconstruction, and approval validation are consumed by every CBRO preparation and authoring path |
| scripts/report-order-overlap.mjs | Rebuilds complete current-library and peer comparisons from exact retained mappings |
| scripts/vendor-orders.mjs | Vendors authored checklists; omitted rows never enter availability or placeholder paths |
| src/js/lib/catalog.js | Already supports `essential` and `selected` depth labels and hints |
| src/js/lib/availability.js | Remains unchanged because excluded rows are not shipped issue records |

#### Test Files

| Test | Coverage |
|---|---|
| test/cbro-historical-events.test.js | Release identity, packet conservation, mapping positions, exclusion ledgers, reports, approvals, inventory compatibility, authored outputs |
| test/cbh-batch.test.js | Shared packet occurrence behavior must remain backward compatible |
| test/catalog.test.js and test/curated.test.js | Non-complete catalog depth and generated catalog parsing |
| scripts/browser-check.mjs | Real Edge catalog and reading journeys after the three cards are added |

#### Reference Patterns

| File | Pattern |
|---|---|
| scripts/lib/cbh-inventory.mjs | Repeated source references already prove a frozen source can have more occurrences than canonical mapping rows |
| scripts/lib/cbro-evidence.mjs | Four immutable known releases and batch-specific compatibility digests |
| scripts/data/cbro-packets/fall-of-the-mutants.json | Current event-page packet, manifest, source review, and authoring shape |
| .copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-resolution.mjs | Exact endpoint validation and current-library report generation pattern |

#### Risk Assessment

* [x] Shared evidence API changes require backward-compatibility tests.
* [ ] Database migrations are needed.
* [ ] Runtime dependencies or availability-state changes are needed.
* [x] Generated product data and evidence digests must be regenerated atomically.
* [x] Reader-facing wording must avoid an independently unverified legal claim.

Ready for a new plan under MRT-003-C02-B04. The plan must:

1. Add a guide-scoped exclusion contract limited to the 31 named rows in these three guides.
2. Prove source-row conservation, exact excluded positions and titles, retained-row order, and zero
   unapproved omissions.
3. Change the three guide depths away from `complete` and add reader-facing exclusion disclosure.
4. Correct Wraith War's stale 30-row blocker to the evidenced 28-row exclusion.
5. Re-run mapping and complete-library relationship evidence for 7, 40, and 11 retained rows.
6. Record the supplemental page as curation evidence while leaving its uncovered recommendations
   outside this three-guide change.

No further issue identifier, Marvel URL, or availability evidence is needed from the user for the
31 omitted rows. If the public product copy is expected to state the legal cause as independently
verified fact rather than as the owner's curation rationale, a first-party rights source is still
needed. Otherwise, the safest copy is factual and bounded: the named tie-ins are omitted because
they are not discoverable through Marvel Unlimited, with the full external source order linked.

## Relevant Artifacts

| Artifact | Description |
|---|---|
| [.copilot-tracking/research/2026-08-24/licensed-character-issues-research.md](.copilot-tracking/research/2026-08-24/licensed-character-issues-research.md) | Canonical licensed tie-in decision, evidence, current-main reconciliation, and context map |
| [.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-research.md](.copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-research.md) | Parent batch research that recorded the original metadata blockers |
| [.copilot-tracking/research/2026-08-23/historical-event-source-pages.json](.copilot-tracking/research/2026-08-23/historical-event-source-pages.json) | Frozen source rows and positions for all three guides |

## Next Steps

The automatic RPI parent should proceed to `rpi-plan` for MRT-003-C02-B04. No user action is
required.
