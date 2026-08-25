<!-- markdownlint-disable-file -->
# Phase Details: Historical event reading orders batch three

## Metadata

* Task ID: MRT-003-C02-B03
* Task slug: historical-event-reading-orders-batch-three
* Date: 2026-08-24
* Status: Ready after one independent critique
* Plan: .copilot-tracking/plans/2026-08-24/historical-event-reading-orders-batch-three-plan.md
* Research: .copilot-tracking/research/2026-08-24/historical-event-reading-orders-batch-three-research.md

## Initial Direction and Boundaries

The task continues the stable MRT-003-C02 program from current main. Positions 11 through 16 were
evaluated in order. Exact mapping admits positions 11, 15, and 16 and blocks positions 12 through 14.
No later position may be pulled into this pull request. Maximum Security remains exclusive.

The implementation owns exactly three product guides, three new metadata blockers, five relationship
decisions, and the directly related release records. It must preserve the other 52 inventory records
except for identity-digest changes mechanically caused by the six approved transitions.

## Locked Evidence Baseline

* Timeline and five event-page digests matched on 2026-08-24.
* Current catalog baseline: 111 lists.
* Selected source positions: 11, 15, 16.
* Selected issue rows: 12, 7, 29, for 48 total.
* Blocked source positions: 12, 13, 14.
* Comparisons: 113 per candidate, 339 total.
* Non-none tuples: five exact tuples and no selected-peer relationship.
* Expected final catalog: 114 lists.
* Expected final inventory: 18 selected and shipped, 32 deferred, one deferred-subset, five blocked,
  one absorbed, one provenance-blocked.

<!-- rpi:phase id=P01 -->
## P01 Details: Establish batch-three authority and immutable source evidence

### Evidence and implementation context

The current release registry knows MRT-003 and continuation batches one and two. Its source-order and
author-order matching is the release gate used by preparation and authoring. Batch three must be a
new known release rather than a permissive `--only` exception.

The inventory currently labels all six directed positions deferred and unresolved. The update is one
atomic authority transition:

| Position | ID | New central state | New delivery state |
|---:|---|---|---|
| 11 | marvel-super-heroes-secret-wars | selected | ready |
| 12 | wraith-war | blocked | blocked |
| 13 | secret-wars-ii | blocked | blocked |
| 14 | mutant-massacre | blocked | blocked |
| 15 | kravens-last-hunt | selected | ready |
| 16 | fall-of-the-mutants | selected | ready |

### P01-T01 completion evidence

* One new release ID exists with exact source and chronology arrays.
* All-selected inventory order includes positions 11, 15, and 16 without reordering existing selected
  records.
* The six approved records match their exact new projections.
* A checked immutable projection proves every other record is unchanged.
* The historical identity digest and nonselected projection digest are rederived.
* Add a new `CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256` and corresponding batch-three exclusion
  filter. Do not update `CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256` or its batch-two filter.

### P01-T02 completion evidence

* Secret Wars preserves the printed timeline label and exact #1-12 expansion.
* Kraven's Last Hunt preserves all seven rows, including Soul of the Hunter.
* Fall of the Mutants preserves all 29 displayed rows.
* Every packet binds provider, canonical URL or section, date, digest, boundary, exclusions, candidate
  issue IDs, series identities, original project summary, chronology, and central source review.
* Packet additions are exactly three.

### P01-T03 completion evidence

Semantic tests must fail for:

* a changed release source array or chronology array;
* an admitted blocked ID;
* a dropped Kraven epilogue or changed source row;
* a changed source digest or provider;
* a changed missing-identity blocker;
* a changed inherited terminal disposition;
* any nonselected inventory mutation.

<!-- rpi:phase id=P02 -->
## P02 Details: Resolve, compare, and approve current relationships

### Evidence and implementation context

Research froze exact candidate IDs, but implementation must create canonical packets first and then
prepare mappings through the existing live issue endpoint path. Research output cannot substitute
for canonical packet, mapping, report, or approval digests.

### P02-T01 completion evidence

* Exactly three mappings exist.
* Mapping row counts are 12, 7, and 29.
* Every row is exact, unique, packet-bound, and ordered.
* Series aliases are explicit and reviewed where source and metadata labels differ.
* Mapping additions are exactly three.

### P02-T02 completion evidence

* Each report uses the final current manifest and every final payload.
* Each report includes the other two candidate mappings as peers.
* Each report is bound to packet, mapping, library, and peer digests.
* Current-baseline reports contain 113 comparisons each and no exact relationship.
* Any main reconciliation changes the baseline and forces all three reports to regenerate.

### P02-T03 completion evidence

The central table contains exactly:

1. Secret Wars candidate-subset of doctor-doom-primer with all 12 shared IDs.
2. Kraven's Last Hunt partial with spider-man-best-of with the six core shared IDs.
3. Fall of the Mutants partial with captain-america-best-of with Captain America #339.
4. Fall of the Mutants partial with xmen-claremont with the exact 11 shared IDs.
5. Fall of the Mutants partial with xmen-claremont-complete with the same exact 11 shared IDs.

Tests reject changed shared IDs, relationship classes, candidate IDs, order IDs, extra tuples, and
unlisted non-none relationships.

Inventory summaries use these exact projections:

* Secret Wars: `relationshipStatus: 'candidate-subset'`,
  `overlapIds: ['doctor-doom-primer']`.
* Kraven's Last Hunt: `relationshipStatus: 'approved-mixed'`,
  `overlapIds: ['spider-man-best-of']`.
* Fall of the Mutants: `relationshipStatus: 'approved-mixed'`,
  `overlapIds: ['captain-america-best-of', 'xmen-claremont', 'xmen-claremont-complete']`.

<!-- rpi:phase id=P03 -->
## P03 Details: Author and integrate three guides

### P03-T01 completion evidence

* Approval runs only on current packet, mapping, report, inventory, library, and peer digests.
* Authoring accepts only the known chronology array.
* Three curated definitions are added atomically.
* Only positions 11, 15, and 16 move from ready to shipped.
* Positions 12 through 14 remain blocked after authoring.

### P03-T02 completion evidence

* Three checklists and three payloads contain 48 exact issues in source order.
* Catalog regeneration creates exactly three cards.
* Shelf order follows Secret Wars, Fall of the Mutants, Kraven's Last Hunt by first on-sale date.
* The cards remain in the Historical Event filter and before Maximum Security.
* No image bytes, runtime fetch, or runtime dependency is added.

### P03-T03 completion evidence

* Product counts are rederived after generation.
* The backlog records one shipped batch and the exact three blockers without claiming program
  completion.
* The changelog states the three visible guides and 48 issues.
* Provenance names Comic Book Reading Orders, null source licensing, URLs, and the factual extraction
  boundary.
* Maintenance and publication records name the new release command and evidence set.
* No count is copied from an earlier baseline.

<!-- rpi:phase id=P04 -->
## P04 Details: Prove and review the final candidate

### P04-T01 completion evidence

* Each new semantic contract has been observed failing under the smallest matching reversible
  mutation, with the clean tree restored.
* Focused tests pass before the full suite.
* `npm run lint`, bare `npm test`, counts, sizes, palette, anchors, publication, release checks, and
  live contract all pass.
* Any drifted anchor is re-aimed by both head search and diff arithmetic. Every bless pairing is read
  before the lock is accepted, followed by 0 drifted, 0 new, and 0 removed.
* Installed Edge at 1280x900 verifies all three cards and all issues in one complete sequence per
  guide.
* The added-line dash scan reports zero.

### P04-T02 completion evidence

* Exactly one independent post-implementation review artifact exists.
* Material in-scope findings are fixed and recorded without a second review.
* Unrelated findings are routed to Follow-Up Items rather than widening this pull request.
* Plan markers, phase details, changes evidence, blockers, validation, and handoff agree.

<!-- rpi:phase id=P05 -->
## P05 Details: Publish, merge, and hand off

### P05-T01 completion evidence

* Origin main is fetched and compared before final gates and before merge.
* Any catalog drift causes packet-dependent evidence, reports, approvals, counts, and anchors to
  regenerate.
* The commit uses a message file and the required coauthor trailer.
* The non-draft pull request starts with `## In plain English`, names no file, command, identifier, or
  backlog ID in that section, and records exact verification figures later.
* Actual Node 20, Node 24, and lint job conclusions are green.

### P05-T02 completion evidence

* The green pull request is merged.
* Final artifacts record PR URL, commit and merge SHAs, workflow run and job conclusions, exact
  shipped guides, 48 issues, inventory counts, six named metadata-blocked entries, inherited terminal
  states, and The Evolutionary War as the next cursor.
* The creator receives the durable handoff.
* No batch-four session or branch is created.

## Risks and Stop Conditions

* Stop if any source digest changes.
* Stop if any selected row is missing, ambiguous, duplicated, or resolves to an unreviewed series.
* Stop if an exact duplicate exists.
* Stop if a non-none relationship lacks its exact tuple decision.
* Stop if current-main reconciliation cannot regenerate coherent evidence.
* Stop if hosted validation is not green.

## Planning Handoff

The sole critique is complete. PC-001 and PC-002 were applied directly without a second critique or
user decision. Implementation begins at P01-T01 and records work in
.copilot-tracking/changes/2026-08-24/historical-event-reading-orders-batch-three-changes.md.
