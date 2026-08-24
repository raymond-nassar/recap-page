<!-- markdownlint-disable-file -->
# Task Research: Historical event reading orders batch two

## Metadata

* Task ID: MRT-003-C02-B02
* Date: 2026-08-23
* Status: Complete
* Scope: The next maintained Comic Book Reading Orders timeline entries after Thanos War and before Maximum Security.

## User Direction

* Continue automatically from the merged first continuation batch in coherent batches of four to six, without repeating the ten shipped events.
* Retain Days of Future Present and Countdown as metadata-blocked, Legion Quest as absorbed, Marvel vs DC as provenance-blocked, and all timeline-only rows lacking exact issue-order evidence as blocked unless new exact evidence clears the named gate.
* Keep Maximum Security and every later timeline entry out of scope.
* Use Comic Book Reading Orders only for this source family. Do not call it Comic Book Herald and do not copy source prose, branding, images, layouts, or image bytes.
* Preserve local-first browser-companion constraints, zero runtime dependencies, current catalog conventions, complete overlap review, current source evidence, and central approval authority.

## Research Readiness

Merged batch one is present at cbeb226318ed4dc5f215452e79922f1e4344be07. Its source-neutral CBRO packet, mapping, digest, report, approval, authoring, overlap, catalog, and test machinery remains the baseline. This research does not repeat its five shipped events.

## Cycle Log

### Wave 1: Wider

The maintained source is the Comic Book Reading Orders Marvel event timeline at:

https://comicbookreadingorders.com/marvel/event-timeline/

It was retrieved on 2026-08-23. The response was 79,993 bytes with SHA-256 `2ce9dab79ef1f71bc2c4bdbb366f56e29b9f18dccb5c073613192dd7f2be54eb`.

The five next source-ordered entries before the exclusive Maximum Security cutoff are:

| Source position | ID | Source label | Exact printed rows | Metadata rows |
|---:|---|---|---:|---:|
| 6 | original-clone-saga | Original Clone Saga | Amazing Spider-Man #139-151 | 13 |
| 7 | phoenix-saga | Phoenix Saga | X-Men #101-108 | 8 |
| 8 | dark-phoenix-saga | Dark Phoenix Saga | X-Men #129-137 | 9 |
| 9 | days-of-future-past | Days of Future Past | X-Men #141-142 | 2 |
| 10 | contest-of-champions | Contest of Champions | Contest of Champions #1-3 | 3 |

The source provides visible timeline labels and inclusive ranges for all five. The rows are exact source evidence, not inferred event tie-ins. Their shared source identity is the timeline page plus each visible label. The selected chunk has 35 rows.

The source boundary remains factual issue identity and ascending printed range order. Page commentary, navigation, branding, layout, images, trade material, and comic image bytes remain excluded. The established credited and linked derived-order boundary remains unchanged.

Inventory coverage before this batch is 58 total: 10 shipped, 43 deferred, one deferred-subset, two metadata-blocked, one absorbed, and one provenance-blocked. This batch changes only source positions 6 through 10 if completed.

### Wave 2: Deeper

The configured Marvel metadata snapshot resolves all 35 selected rows exactly:

| Guide | Metadata series | Series ID | First on-sale | Last on-sale |
|---|---|---:|---|---|
| Original Clone Saga | The Amazing Spider-Man (1963 - 1998) | 1987 | 1974-12-01 | 1975-12-01 |
| Phoenix Saga | Uncanny X-Men (1963 - 2011) | 2258 | 1976-10-01 | 1977-12-01 |
| Dark Phoenix Saga | Uncanny X-Men (1963 - 2011) | 2258 | 1980-01-10 | 1980-09-01 |
| Days of Future Past | Uncanny X-Men (1963 - 2011) | 2258 | 1981-01-01 | 1981-02-01 |
| Contest of Champions | Marvel Super Hero Contest of Champions (1982) | 14637 | 1982-06-01 | 1982-08-01 |

The source's historical labels differ from the metadata series names for Amazing Spider-Man, X-Men, and Contest of Champions. Every such alias is explicit, series-ID-bound, manually selected, and centrally approved in its frozen row. No metadata ambiguity remains.

Complete-library comparison against the 106-list current catalog found:

| Guide | Non-none relationships | Central disposition |
|---|---|---|
| Original Clone Saga | None | Approve under the none-overlap policy. |
| Phoenix Saga | Candidate subset of xmen-claremont and xmen-claremont-complete, all eight rows | Approve as a distinct exact event route. |
| Dark Phoenix Saga | Candidate subset of xmen-claremont and xmen-claremont-complete, all nine rows | Approve as a distinct exact event route. |
| Days of Future Past | Candidate subset of xmen-claremont and xmen-claremont-complete, both rows; partial one-row overlap with marvel-multiverse | Approve only through named stronger-model authority. |
| Contest of Champions | None | Approve under the none-overlap policy. |

The candidate guide sequences do not repeat an issue across the selected five peers. Shelf chronology matches source order for this batch, based on verified first on-sale dates.

### Wave 3: Contrarian

* The timeline digest matched batch one. A changed digest before authoring or release invalidates packets, mappings, reports, approvals, and all downstream generated records.
* The three source-to-metadata aliases must not silently become title matches. The packet must retain the source wording, exact series ID, and reviewed manual-selection note.
* Phoenix, Dark Phoenix, and Days of Future Past cannot pass a none-only approval policy. Days of Future Past additionally has a partial relationship with marvel-multiverse. The release needs explicit per-comparison stronger-model decisions rather than a broad exception.
* The preexisting X-Men and Marvel Multiverse guides have different reader purposes. That does not erase shared factual issue IDs; it requires an auditable central decision and report binding.
* The four inherited terminal dispositions remain unchanged. Days of Future Present and Countdown still lack exact metadata; Legion Quest remains inside Age of Apocalypse; Marvel vs DC remains outside the approved provenance boundary.
* Maximum Security remains the next excluded boundary. No candidate after position 10 is pulled ahead.

## Decision

Proceed with exactly these five source-ordered events as MRT-003-C02-B02. The batch remains within the required four-to-six size and is coherent by source order, exact evidence, and publication chronology. The relationship approvals are a material design obligation, not a reason to substitute or skip a source-ordered entry.

## Remaining Inventory

After successful authoring, the inventory will contain 15 shipped records, 43 deferred records, one deferred-subset, two metadata-blocked records, one absorbed record, and one provenance-blocked record. The next eligible source-ordered candidate is Marvel Super Heroes Secret Wars. The existing terminal blockers are carried forward verbatim and have no new exact clearing evidence.
