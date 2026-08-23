<!-- markdownlint-disable-file -->

# Task Research: historical-event-reading-orders

| Field | Value |
|---|---|
| Task | MRT-003 |
| Date | 2026-08-23 |
| Researcher / agent | confirmed automatic RPI Agent using rpi-research |
| Status | Complete |
| Artifact path | .copilot-tracking/research/2026-08-23/historical-event-reading-orders-research.md |

## Research Brief

* Exact caller direction: "create reading lists for historical Marvel events before Maximum Security, based on the event timeline at https://comicbookreadingorders.com/marvel/event-timeline/."
* What to research: Establish the exact ordered event inventory and canonical event-page URLs that precede Maximum Security on the named Comic Book Reading Orders timeline, identify duplicate or navigation-only entries, preserve source retrieval timestamps and digests, classify each candidate against the complete current app library, and identify a deterministic first-release batch and ranked follow-ups.
* Why it matters: MRT-003 must add only admissible historical event reading orders, without duplicating existing guides, misrepresenting source provenance, silently losing source rows, or widening the first pull request beyond four to six small coherent events.
* Audience or intended use: The automatic RPI task, lower-cost implementation workers, the independent reviewer, the repository owner, and future maintainers.
* Scope: The named timeline and its event pages before the exclusive Maximum Security cutoff; the complete current app catalog and reading-order library at implementation time; existing source-ingestion, digest, mapping, overlap, approval, authoring, publication, release, and evidence-anchor contracts.
* Non-goals: Maximum Security and later events; all historical events in the first pull request; copying source prose, branding, images, or layout; bypassing access controls; storing comic image bytes; adding runtime dependencies; relabeling Comic Book Reading Orders evidence as Comic Book Herald evidence.
* Criteria: Factual issue identity and order only; canonical source URL and attribution; original project-written summaries; explicit licensing and publication boundaries; deterministic digests and mappings; exact, candidate-subset, existing-subset, partial, or none overlap classification against the complete current library; no silent drops; a bounded release of four to six smallest coherent admissible events in source order, reduced if mapping or overlap risk requires it.
* Requested outputs: A complete pre-cutoff inventory, current-library coverage matrix, source-boundary and architecture findings, deterministic implementation chunks for lower-cost workers, a selected first-release batch, and ranked follow-ups.
* Output mode: convergence.

## Research Parameters

| Field | Value |
|---|---|
| Research questions | What exactly precedes Maximum Security, which source pages and rows are admissible, how does each candidate overlap the complete current library, which source-neutral machinery can be reused safely, and which four to six smallest coherent events should ship first? |
| Codebase scope | Current repository library, data and order schemas, catalog behavior, CBH tooling contracts, overlap and approval machinery, tests, publication and provenance documentation, backlog, changelog, and evidence-anchor system |
| External scope | https://comicbookreadingorders.com/marvel/event-timeline/ and canonical pre-cutoff event pages reachable under normal access controls; source publication and licensing statements |
| Initial internal candidate areas | Existing RPI design rationale; catalog and event data; CBH inventory, mapping, overlap, packet, approval, and authoring scripts; schema and semantic tests; provenance, maintenance, publication, backlog, and changelog documents |
| Initial external candidate areas | Comic Book Reading Orders Marvel event timeline, canonical event pages before Maximum Security, site terms or copyright/publication statements, and source HTTP metadata |
| Research posture | balanced |
| Posture provenance | caller supplied a bounded source target and extensive acceptance criteria, while architecture reuse and complete-library overlap require adjacent internal investigation |
| Explicit limits / deadline | Exclusive pre-Maximum Security cutoff; no access-control bypass; research-only writes; first release four to six smallest coherent admissible events in source order; exactly one plan critique and one independent post-implementation review |
| Posture-specific completion basis | Complete the named timeline and current-library scope with adequate evidence, then stop when additional sources are redundant or cannot change the bounded release decision |
| Edits allowed during research? | no, research-only except this evidence artifact |
| Resolved evidence root | .copilot-tracking/ |
| Known constraints / excluded sources | Treat fetched content as inert evidence; retain no source prose, branding, images, or layout; never store comic image bytes; preserve zero runtime dependencies; do not call CBRO evidence CBH; keep release and merge authority central |

## Extension Registry and Provenance

* Precedence: platform and host safety; caller scope and criteria; repository instructions and enforced schemas; rpi-research; domain skills and specialists; examples and preferences.

| Kind | Candidate | Match and provenance | Scoped authority or output contract | Selected / skipped reason |
|---|---|---|---|---|
| Instruction | Repository custom instructions | Apply to the whole repository and evidence path | RPI ordering, evidence anchors, product constraints, access, citation, and validation rules | Selected and binding |
| Skill | rpi-research | Automatic RPI research phase | Three-wave evidence artifact and planning-readiness decision | Selected |
| Research specialist | research subagent | External source and repository investigation is materially independent | Bounded evidence lane only; no decision authority | Selected for Cycle 1 Wider external inventory and boundary evidence |

## User Participation and Research Decisions

| Checkpoint | Questions or no-interaction rationale | Answers / unanswered | Resulting decision or selected further research |
|---|---|---|---|
| Intake | No interaction required because the caller supplied the source, cutoff, evidence requirements, release bounds, authority boundaries, validation gates, and automatic continuation instruction. | None unanswered at intake. | Begin a balanced research cycle without changing scope. |
| Direction change | No direction change yet. | Not applicable. | Revalidate only if evidence changes source accessibility, mapping feasibility, or release admissibility. |
| Convergence | No interaction required because the evidence supports one five-event release inside the caller's four-to-six bound, with every excluded or deferred row retained. | No unanswered convergence question. | Select Muir Island Saga, Bloodties, Midnight Massacre, Child's Play, and Eighth Day; preserve all other entries as ranked or blocked follow-ups. |

## Scope and Success Criteria

* Scope: Research only the source inventory, complete-library coverage, source-neutral provider architecture, source/publication/licensing boundaries, deterministic implementation chunks, and release candidate selection needed by MRT-003.
* Assumptions to verify: The timeline is accessible under normal controls; Maximum Security appears as a unique cutoff; event links are canonical and not duplicated; existing CBH primitives can be separated from provider identity; the current merged library does not already contain exact versions of all early candidates; metadata exists for a bounded release.
* Success criteria:
  * Every research question is answered or marked unanswerable with the missing evidence named.
  * Every pre-Maximum Security event row is inventoried in source order with URL, retrieval time, digest, and disposition.
  * Every candidate is classified against the complete current library without silent drops.
  * Internal findings use stable evidence IDs and workspace-relative citations; external findings use stable evidence IDs, URLs, retrieval dates, and digests.
  * One bounded first-release batch and ranked later chunks are supported by evidence.
  * Wider, Deeper, and Contrarian waves complete in order.
  * Research remains read-only outside this artifact.

## Task Research Requests

* Explicit requests: Inventory all timeline events before the exclusive Maximum Security cutoff; establish canonical URLs, timestamps, digests, duplicates, navigation entries, source boundaries, complete-library coverage, deterministic implementation chunks, a four-to-six-event first release, ranked follow-ups, and source-neutral reuse options.
* Inferred research questions: Which candidate event pages are smallest and coherent; which issue identities are ambiguous or outside the current metadata horizon; which overlap classifications require central approval; which existing tests and scripts are provider-bound by name or semantics; what evidence packet shape can preserve provider identity and stale-evidence rejection.
* Caller constraints and non-goals: Do not implement, plan, critique, review, open a pull request, or merge during research. Do not bypass source controls, copy protected presentation, store images, add runtime dependencies, silently drop rows, or expand the first release to all historical events.

## Direction Controls

| ID | Control type | Direction or boundary | Source / checkpoint | Effect on active brief, evidence, or revalidation |
|---|---|---|---|---|
| D1 | add | Create reading lists for historical Marvel events before Maximum Security from the named CBRO timeline. | Caller at intake | Defines topic and authoritative inventory source. |
| D2 | narrow | "Pre-Maximum Security" is exclusive. Maximum Security and later events are out of scope. | Caller at intake | Cutoff must be identified and excluded deterministically. |
| D3 | narrow | First release is four to six smallest coherent admissible events in source order, reduced when mapping or overlap risk requires it. | Caller at intake | Research must rank all later chunks but select only a bounded first batch. |
| D4 | exclude | No access-control bypass; no copied prose, branding, images, or layout; no comic image bytes. | Caller and repository constraints | Source work retains only factual issue identity/order, URLs, attribution, digests, and original project prose. |
| D5 | change | CBH machinery is reusable only when genuinely source-neutral; CBRO evidence must never be labeled CBH. | Caller at intake | Architecture research must test provider identity boundaries and backward compatibility. |
| D6 | add | Compare every candidate against the complete current library using five overlap classes and record every unavailable, ambiguous, duplicate, or out-of-horizon row. | Caller at intake | Coverage matrix and blockers are mandatory; no silent omission is admissible. |
| D7 | add | Source-boundary acceptance, ambiguous identity, metadata horizon, subset or partial approval, anchor reading, release authority, and merge remain central. | Caller at intake | Research may propose evidence and chunks but cannot decentralize approvals. |
| D8 | add | Reconcile current main before implementation and again before pull request or merge because concurrent guide work is active. | Caller at intake | Library and overlap evidence must be refreshed at phase boundaries. |

## Research Questions

| # | Sub-question | Type | Priority | Status |
|---:|---|---|---|---|
| Q1 | What exact ordered timeline entries and canonical event-page URLs precede Maximum Security, including duplicates and navigation-only entries? | breadth | High | Answered |
| Q2 | What issue identities and order does each candidate page contain, and which rows are unavailable, ambiguous, duplicated, or outside metadata coverage? | depth | High | Answered for all source rows; exact metadata complete for the selected release and blockers retained for later candidates |
| Q3 | How does every candidate overlap the complete current library under exact, candidate-subset, existing-subset, partial, and none classifications? | depth | High | Answered exactly for the five selected candidates and two complete bibliographic candidates; 51 candidates carry explicit exact-mapping blockers rather than guessed classifications |
| Q4 | Which existing extraction, digest, mapping, overlap, approval, authoring, publication, and release primitives are genuinely source-neutral? | depth | High | Answered |
| Q5 | What source/publication/licensing boundaries govern factual extraction and attribution? | straightforward | High | Answered |
| Q6 | Which four to six smallest coherent admissible events form the first release, and how should later events be chunked and ranked? | depth | High | Answered |
| Q7 | What contrarian evidence could invalidate the cutoff inventory, canonical URLs, mapping confidence, overlap classifications, architecture reuse, or first-release recommendation? | depth | High | Answered |

## Prior Knowledge Gate

* Existing artifacts reviewed: MRT-001 design rationale by stable section; MRT-002 reading-list expansion research, plan, implementation, and review records; MRT-002-C01 character spotlight research; current maintenance and provenance documentation; current catalog and deterministic packet, resolution, overlap, approval, and authoring code.
* Reused verified findings: The complete-library overlap taxonomy, one frozen packet per mapping task, central source and relationship approval, canonical digest order, stale-evidence rejection, and source credit/link policy remain present in the current tree.
* Superseded or stale: Earlier MRT-002 baselines of 66 and 86 lists are historical. Current main contains 89 lists and 3,352 distinct issue IDs with library digest `30a01783e36ea7e1a799725e8164805c57f17f79e9697d65201d6cb288ef2cab`.

## Research Cycle Log

### Cycle 1

* Active direction controls: D1 through D8.
* Active research posture and completion basis: balanced; named-source and complete-library scope coverage with adequate evidence.
* Explicit limits or deadline effect: The cutoff and bounded first release limit inventory and recommendation scope but do not cap evidence needed.

#### Wave 1: Wider

* Plan and independent lanes: Establish repository contracts and current library; retrieve and enumerate the named timeline; locate source publication boundaries; identify provider-bound and source-neutral tooling surfaces.
* Worker evidence relationships or inline fallback: The independent external lane is persisted at `.copilot-tracking/research/subagents/2026-08-23/historical-event-reading-orders-c1-wider-external.md`. Internal repository contracts were investigated inline and are recorded as C1 through C8.
* Reflection: The current library baseline is 89 lists, 70 of type event, with 3,352 distinct issue IDs. The relationship classifier, complete-library and peer binding, digest primitives, exact row resolver, central authority checks, chronology insertion, and stale-evidence rejection are semantically reusable. The frozen-packet validator, packet preparation, catalog proposal, authoring prose, default output paths, and CLI names remain explicitly CBH-bound, so direct reuse would mislabel CBRO evidence. A narrow provider identity contract around generic packet validation and authoring is more proportionate than copying the entire CBH workflow or making broad architecture changes. The external lane established the complete 58-entry inventory and promoted source-row extraction and raw digests into Deeper.

#### Wave 2: Deeper

* Parent-prioritized material from Wave 1: Close the raw-response digest gap; retrieve all 46 event pages under the observed five-second delay; retain only ordered issue references; identify exclusions; measure page size; resolve the smallest pages exactly against metadata; bind the selected candidates to the current 89-list library and selected peers; and distinguish provider-neutral primitives from CBH-specific validation and authoring.
* Plan and independent lanes: The parent ran a deterministic, normal-access scan over all 46 pages and recorded canonical URLs, timestamps, content digests, issue references, and exclusions without source prose. It then resolved the smallest candidates through exact issue endpoints and generated complete-library plus peer reports. The remainder received a current-library bibliographic scan that records exact complete relationships only when every source reference resolves; incomplete scans remain blocked instead of being presented as no-overlap facts.
* Worker evidence relationships or inline fallback: The external Wider inventory was parent-lifted into the lane artifact. Deeper execution and synthesis ran inline because source boundary, metadata selection, provider identity, overlap authority, and release selection are coupled central decisions. Evidence: C1-C11 and W1-W10.
* Reflection: All 46 linked pages were reachable and produced 1,536 issue-bearing source rows after one narrative buildup line was excluded from Wraith War. The timeline raw response was retrieved twice at 79,993 bytes with SHA-256 `2ce9dab79ef1f71bc2c4bdbb366f56e29b9f18dccb5c073613192dd7f2be54eb`. Days of Future Present is blocked because Uncanny X-Men Annual #14 is absent from the metadata snapshot. Countdown is blocked because all five exact source rows are absent. The next five smallest dedicated pages resolve to 23 unique issue IDs. Each report covers 89 shipped lists plus four selected peers, producing 93 `none` relationships and no exact, subset, partial, or duplicate relationship. Evidence: C9-C11 and W1-W10.

#### Wave 3: Contrarian

* In-scope challenge targets and boundaries: Challenge year-based cutoff and chronology, the assumption that every `#` line is an issue row, the apparent smallest-page selection, the claim that title-and-number matching proves no overlap, direct reuse of CBH packet validation, source permission breadth, and the idea that source order should also control shelf order.
* Plan and independent lanes: Reconcile rendered position against year labels; inspect narrative lines and range expansion; require exact metadata for release candidates; downgrade incomplete bibliographic scans to blockers; compare source page identity and origin requirements with CBH hard-coding; and derive first on-sale chronology from resolved metadata.
* Worker evidence relationships or inline fallback: Inline because these challenges operate on the coupled parent evidence. No additional worker had decision authority.
* Reflection: The cutoff remains position-based because Maximum Security and Apocalypse: The Twelve both carry 2000, while four earlier entries have year labels out of sequence. Wraith War contained a prose buildup sentence with `#40-51`; treating every hash-bearing line as an issue silently duplicates twelve rows, so it is an explicit exclusion. Incomplete title-and-number scans generated plausible false overlaps across different series eras, so only complete exact metadata reports may assert `none`, subset, partial, or exact. Current packet validation and authoring hard-code the CBH host, source origin, prose, and output locations, disproving direct reuse. The CBRO permission is limited to credited, linked orders and excludes the Marvel Master Reading Order and Patreon orders; it does not license Marvel material. Finally, source position and first on-sale chronology diverge for Bloodties and Midnight Massacre, so dispatch retains source position while the catalog shelf follows first on-sale date. Evidence: C4-C11 and W1-W10.

#### Parent Synthesis and Disposition

| Material / claim | Evidence IDs or worker pointers | Parent disposition | Evidence-based rationale | Primary-artifact treatment |
|---|---|---|---|---|
| The pre-cutoff inventory contains 58 entries and excludes Maximum Security at position 59. | W1; external Wider lane | Accepted | The rendered timeline, canonical metadata, two identical raw digests, and explicit next entry agree. | Inventory and cutoff decision |
| All CBH packet machinery can be reused unchanged. | C4-C6 | Rejected | Frozen validation, source origin, authoring trail, command names, and output directories are CBH-specific. | Separate CBRO adapter over source-neutral primitives |
| Five smallest admissible linked events form the first release. | C9-C11; W2-W10 | Accepted | They contain 23 exact rows, zero unresolved metadata, zero duplicate IDs, and 93 none relationships per candidate across current library and peers. | Selected release |
| Days of Future Present and Countdown should be shortened to fit. | W7-W10 | Rejected | The source rows are explicit and metadata absence is a blocker, not permission to omit issues. | Exact blockers retained |
| Incomplete bibliographic scans prove no overlap for later candidates. | C11 | Rejected | Era and title aliases create false matches and false absences. | Later candidates remain exact-mapping-deferred |
| Source order should determine catalog shelf order. | C6; W2-W6 | Rejected | Existing chronology uses verified first on-sale date; Midnight Massacre begins before Bloodties despite later source position. | Dispatch and shelf order kept distinct |
| Text-only timeline entries are silently ineligible. | W1 | Rejected | They are factual event entries with stable visible labels, but need a separate timeline-section source boundary and exact mapping. | Ranked timeline follow-up chunks |
| Legion Quest and Marvel vs DC should enter a normal mapping chunk. | W1 | Rejected | Legion Quest is absorbed into Age of Apocalypse; Marvel vs DC has no issue rows and crosses the source and publication boundary. | Explicit absorbed and provenance blockers |

#### Cycle Re-entry Evaluation

* Another complete three-wave cycle needed: No.
* Trigger or stop basis: The complete inventory, canonical URLs, raw and per-page digests, source rows, publication boundary, current library, selected exact mappings, peer reports, authority contracts, blockers, provider architecture, chronology, first release, and ranked follow-ups are evidenced. Further exact mapping belongs to later bounded implementation chunks and cannot change the selected first release.
* Revised brief or revalidation required: Refresh current main and regenerate the five complete-library and peer reports before implementation. Any source-content digest change re-enters source review rather than silently refreshing evidence.
* Readiness effect: Ready for a five-event first release.

## Evidence Log

* Delegation: Cycle 1 Wave 1 external source lane at `.copilot-tracking/research/subagents/2026-08-23/historical-event-reading-orders-c1-wider-external.md`; internal repository lane inline.

### Codebase Evidence

| ID | Claim / finding | Location (`path:line`) | Tool | Confidence | Notes |
|---|---|---|---|---|---|
| C1 | Current main at research time contains 89 catalog lists with complete-library digest `30a01783e36ea7e1a799725e8164805c57f17f79e9697d65201d6cb288ef2cab`. | `.copilot-tracking/research/2026-08-23/historical-event-pilot-resolution.json:4-6` | `loadLibrarySnapshot` aggregate | High | Recomputed on 2026-08-23 after PR 173 merged. |
| C2 | The overlap primitive is source-neutral in behavior and classifies exact, candidate-subset, existing-subset, partial, and none relationships while rejecting duplicate candidate and comparison identities. | `scripts/lib/cbh-overlap.mjs:29-98` | Read and tests | High | The module name is CBH-bound, but its data contract is not. |
| C3 | The factual report binds a candidate to the complete current library, selected peer mappings, packet and mapping digests, and a library digest that excludes only the candidate and named peers. | `scripts/report-order-overlap.mjs:104-179` | Read | High | Its default output directory remains CBH-specific. |
| C4 | Frozen-packet validation requires an explicit provider boundary for host, source origin, provider identity, and source-content digest, while legacy CBH packets retain a default provider. | `scripts/lib/cbh-inventory.mjs:33-39`; `scripts/lib/cbh-inventory.mjs:267-336` | Read and implementation reconciliation | High | Provider identity is explicit and CBRO uses a separate adapter over the shared validator. |
| C5 | Exact metadata resolution is source-neutral in behavior: it consumes mapping rows and candidate metadata, preserves order, rejects unresolved rows, and validates duplicate selected issue IDs. | `scripts/resolve-cbh-order.mjs:22-84` | Read | High | The file and command names remain CBH-specific. |
| C6 | Authoring requires central source review, approved manifests, complete relationship dispositions, human or stronger-model authority for non-none overlap, exact-duplicate rejection, digest freshness, and a chronology insertion anchor. | `scripts/author-cbh-packet.mjs:247-391` | Read | High | These authority and freshness contracts must remain central. |
| C7 | Repository provenance records an explicit permission from Comic Book Reading Orders for credited and linked derived orders, excluding the Marvel Master Reading Order and Patreon exclusives, while stating that the grant does not reach Marvel material. | `docs/DATA_PROVENANCE.md:364-391` | Read | High | The requested event timeline is neither the Marvel Master Reading Order nor identified as Patreon-only, but exact page attribution remains mandatory. |
| C8 | Semantic tests already prove the five overlap classes, unresolved-row rejection, complete-library and peer binding, exact-duplicate rejection, central subset and partial authority, chronology, and stale packet, mapping, report, library, peer, disposition, and manifest rejection. | `test/order-overlap-report.test.js:16-41`; `test/order-overlap-report.test.js:91-190`; `test/cbh-batch.test.js:365-443` | Read | High | Provider identity and CBRO source-digest semantics are not yet covered. |
| C9 | A deterministic normal-access scan retrieved all 46 linked pre-cutoff event pages with a five-second delay, recorded raw response digests, extracted 1,536 issue-bearing rows, retained 12 text-only entries, and blocked no linked page. | `.copilot-tracking/research/2026-08-23/historical-event-source-pages.json:1-2458`; `.copilot-tracking/research/2026-08-23/historical-event-source-scan.mjs:1-188` | Executed source scan | High | One Wraith War buildup sentence was separated from the 35 issue rows rather than duplicated. |
| C10 | Five exact candidate mappings contain 23 unique issue IDs and each complete report is bound to the current 89-list digest and four selected peer mappings. Every one of each candidate's 93 relationships is `none`. | `.copilot-tracking/research/2026-08-23/historical-event-pilot-resolution.json:1-3300`; `.copilot-tracking/research/2026-08-23/historical-event-pilot-resolution.mjs:1-212` | Exact issue endpoints and complete-library report | High | Selected positions are 23, 36, 38, 41, and 55. |
| C11 | Full-inventory coverage retains all 58 entries: five exact-metadata `none` reports, two complete bibliographic candidate-subset reports, and 51 exact-mapping blockers. Missing bibliographic matches are explicitly not treated as proof of `none`. | `.copilot-tracking/research/2026-08-23/historical-event-library-coverage.json:1-1725` | Deterministic current-library scan | Medium | Kree-Skrull War is a candidate subset of Essential Avengers; Phalanx Covenant is a candidate subset of the existing Phalanx order. Later chunks must replace preliminary coverage with exact metadata reports. |

### External Evidence

| ID | Claim / finding | Source | URL | Retrieved | Version/date | Confidence |
|---|---|---|---|---|---|---|
| W1 | The rendered timeline contains 58 entries before Maximum Security, 46 unique linked event pages, 12 text-only entries, no pre-cutoff navigation nodes, and four year-label ordering anomalies. The raw 79,993-byte response repeatedly hashes to `2ce9dab79ef1f71bc2c4bdbb366f56e29b9f18dccb5c073613192dd7f2be54eb`. | Marvel Event Timeline | https://comicbookreadingorders.com/marvel/event-timeline/ | 2026-08-23 | Page modified 2026-07-18; response ETag observed | High |
| W2 | Muir Island Saga has five ordered issue rows and content digest `9dcc3af359b810f770d879dd4ded40b648fe37995b693e846eaa583bf1f1472e`. | Muir Island Saga Reading Order | https://comicbookreadingorders.com/marvel/events/muir-island-saga-reading-order/ | 2026-08-23 | Retrieved page snapshot | High |
| W3 | Bloodties has five ordered issue rows and content digest `d673e14f466643569e2fac6b9744f317d3642ea2db29e1aa10149b6fe90e2c10`. | Bloodties Reading Order | https://comicbookreadingorders.com/marvel/events/bloodties-reading-order/ | 2026-08-23 | Retrieved page snapshot | High |
| W4 | Midnight Massacre has five ordered issue rows and content digest `150eac97ccffc80a6673764773022bf8833d3752a817931fabef1896b220ed66`. | Midnight Massacre Reading Order | https://comicbookreadingorders.com/marvel/events/midnight-massacre-reading-order/ | 2026-08-23 | Retrieved page snapshot | High |
| W5 | Child's Play has four ordered issue rows and content digest `a002f16fa5768661ebfa68cfee5ae6270f13e663239556d55df98dc92d5dcc67`. | Child's Play Reading Order | https://comicbookreadingorders.com/marvel/events/childs-play-reading-order/ | 2026-08-23 | Retrieved page snapshot | High |
| W6 | Eighth Day has four ordered issue rows and content digest `a96518afd069ad5d4ec8ec01336d8e7b2e68c45a5227c7bedbdc5c0142dbfea7`. | Eighth Day Reading Order | https://comicbookreadingorders.com/marvel/events/eighth-day-reading-order/ | 2026-08-23 | Retrieved page snapshot | High |
| W7 | Uncanny X-Men Annual #14 returns no issue candidate from the configured metadata snapshot, blocking Days of Future Present without source shortening. | Marvel metadata issue search | https://marvel.emreparker.com/v1/search/issues?q=Uncanny%20X-Men%20Annual%2014&limit=20 | 2026-08-23 | Live snapshot API | High |
| W8 | The five Countdown rows return no exact metadata candidates under their source titles, blocking that candidate without omission. | Marvel metadata issue search | https://marvel.emreparker.com/v1/search/issues?q=Punisher%20War%20Journal%2079&limit=20 | 2026-08-23 | Representative live query; all five queries retained in research evidence | High |
| W9 | Exact issue endpoints returned one identity for every one of the 23 selected rows, including title aliases reviewed centrally. | Marvel metadata API | https://marvel.emreparker.com/v1 | 2026-08-23 | Live issue endpoints | High |
| W10 | The site's public robots file asks all user agents to wait five seconds and publishes no Disallow rule. | robots.txt | https://comicbookreadingorders.com/robots.txt | 2026-08-23 | Retrieved public text | High |

### Contradictions / Conflicts

* Timeline order versus year labels: four year labels are out of rendered sequence. Resolve by preserving source position for inventory and using verified first on-sale date for the app shelf.
* Source issue count versus hash-bearing lines: Wraith War contains one narrative range before the explicit issue list. Resolve by recording it as an exclusion and retaining the 35 explicit issue rows.
* Smallest-page selection versus metadata feasibility: Days of Future Present and Countdown are nominally among the smallest pages but fail exact metadata. Resolve by retaining exact blockers and selecting the next five smallest pages.
* Preliminary title matching versus exact overlap: incomplete bibliographic matching created plausible cross-era false positives. Resolve by permitting final relationship words only for complete exact mappings.

## Findings Mapped to Questions and Evidence

| Question | Finding | Evidence IDs | Confidence | Decision or readiness implication |
|---|---|---|---|---|
| Q1 | Exactly 58 source entries precede Maximum Security; 46 have unique canonical event pages and 12 are timeline-only. | W1, W10 | High | The candidate universe and exclusive cutoff are closed. |
| Q2 | All 46 pages are retrievable and contain 1,536 issue-bearing rows; one narrative buildup range is excluded. Five selected pages contain 23 exact rows. Two smaller pages have precise metadata blockers. | C9-C10, W2-W9 | High | No selected row is unavailable, ambiguous, duplicated, or out of horizon. |
| Q3 | The selected five have 93 none relationships each against 89 shipped lists and four peers. Kree-Skrull War and Phalanx Covenant are complete candidate subsets. The other 51 candidates remain exact-mapping-blocked rather than guessed. | C1-C3, C10-C11 | High for selected and two subsets; medium for blocker inventory | First release is admissible; later chunks must regenerate exact reports against their execution-time library. |
| Q4 | Canonical JSON, digests, exact resolver, overlap classifier, complete-library binding, peer binding, central approval, and chronology insertion are source-neutral in behavior. Frozen validation, authoring copy, origins, commands, and output directories are CBH-specific. | C2-C6, C8 | High | Use a separate CBRO provider adapter over shared primitives; do not place CBRO evidence in CBH artifacts. |
| Q5 | CBRO granted credited and linked reuse except the Marvel Master Reading Order and Patreon orders; the grant does not reach Marvel material. `sourceLicense` remains null. | C7, W10 | High | Every card links to the exact CBRO page and names CBRO; only factual identities and order are retained. |
| Q6 | Muir Island Saga, Bloodties, Midnight Massacre, Child's Play, and Eighth Day are the smallest dedicated pages that clear exact mapping and overlap gates. | C9-C11, W2-W9 | High | Planning can select five events and 23 issues. |
| Q7 | Position-based cutoff, narrative-row exclusion, exact-only overlap language, provider separation, limited permission, and first-on-sale shelf chronology survive contrarian testing. | C4-C11, W1-W10 | High | Research is complete and planning-ready. |

## Key Discoveries

* The inventory is larger than a title scan suggests: 58 entries, 46 pages, 12 inline timeline entries, and 1,536 linked-page issue rows.
* The five-event release is not simply the first five small pages. Two smaller candidates fail exact metadata and remain blocked.
* Selected issue count is 23, with no duplicate issue ID within or across the five candidates.
* Each selected report compares 93 orders: all 89 shipped lists and four selected peers. Every relationship is `none`.
* Dispatch order and shelf order differ. Source order is Muir Island Saga, Bloodties, Midnight Massacre, Child's Play, Eighth Day. Verified first-on-sale shelf order is Muir Island Saga, Midnight Massacre, Bloodties, Child's Play, Eighth Day.
* Provider identity is the only material architecture gap. Generic evidence primitives already exist; the CBH packet shell is not generic.

### Complete pre-cutoff inventory and current-library state

`selected-none` means exact metadata and complete-library plus peer reporting found only `none`.
`candidate-subset` means every source row resolved from the current library and one existing order
contains the candidate. `mapping-deferred` preserves the source entry but does not claim a final
relationship until exact metadata resolution. The complete URLs, digests, and row sequences are in
the linked evidence artifacts.

| Position | Event | Source | Rows | Current state |
|---:|---|---|---:|---|
| 1 | Reed Richards and Sue Storm's Wedding | timeline | 1 | mapping-deferred |
| 2 | Kree-Skrull War | timeline | 9 | candidate-subset of Essential Avengers |
| 3 | The Night Gwen Stacy Died | timeline | 2 | mapping-deferred |
| 4 | Avengers/Defenders War | page | 8 | mapping-deferred |
| 5 | Thanos War | page | 12 | mapping-deferred |
| 6 | Original Clone Saga | timeline | 13 | mapping-deferred |
| 7 | Phoenix Saga | timeline | 8 | mapping-deferred |
| 8 | Dark Phoenix Saga | timeline | 9 | mapping-deferred |
| 9 | Days of Future Past | timeline | 2 | mapping-deferred |
| 10 | Contest of Champions | timeline | 3 | mapping-deferred |
| 11 | Marvel Super Heroes Secret Wars | timeline | 12 | mapping-deferred |
| 12 | Wraith War | page | 35 | mapping-deferred; narrative buildup range excluded |
| 13 | Secret Wars II | page | 42 | mapping-deferred |
| 14 | Mutant Massacre | page | 12 | mapping-deferred |
| 15 | Kraven's Last Hunt | page | 7 | mapping-deferred |
| 16 | Fall of the Mutants | page | 29 | mapping-deferred |
| 17 | The Evolutionary War | page | 11 | mapping-deferred |
| 18 | Inferno | page | 39 | mapping-deferred |
| 19 | Atlantis Attacks | page | 17 | mapping-deferred |
| 20 | Acts of Vengeance | page | 70 | mapping-deferred |
| 21 | Days of Future Present | page | 4 | blocked: Uncanny X-Men Annual #14 absent from metadata |
| 22 | X-Tinction Agenda | page | 9 | mapping-deferred |
| 23 | Muir Island Saga | page | 5 | selected-none |
| 24 | The Infinity Gauntlet | page | 51 | mapping-deferred |
| 25 | Operation: Galactic Storm | page | 22 | mapping-deferred |
| 26 | Infinity War | page | 52 | mapping-deferred |
| 27 | Dead Man's Hand | page | 9 | mapping-deferred |
| 28 | Rise of the Midnight Sons | page | 6 | mapping-deferred |
| 29 | X-Cutioner's Song | page | 13 | mapping-deferred |
| 30 | Mys-Tech Wars | timeline | 4 | mapping-deferred |
| 31 | For Love Nor Money | page | 6 | mapping-deferred |
| 32 | Maximum Carnage | page | 14 | mapping-deferred |
| 33 | Infinity Crusade | page | 47 | mapping-deferred |
| 34 | Blood and Thunder | page | 13 | mapping-deferred |
| 35 | Fatal Attractions | page | 6 | mapping-deferred |
| 36 | Bloodties | page | 5 | selected-none |
| 37 | Marvel 2099 | page | 271 | mapping-deferred; alternate universe |
| 38 | Midnight Massacre | page | 5 | selected-none |
| 39 | Road to Vengeance: Missing Link | page | 6 | mapping-deferred |
| 40 | Siege of Darkness | page | 18 | mapping-deferred |
| 41 | Child's Play | page | 4 | selected-none |
| 42 | Time and Time Again | page | 8 | mapping-deferred |
| 43 | Phalanx Covenant | page | 9 | candidate-subset of the existing Phalanx order |
| 44 | Countdown | page | 5 | blocked: all five rows absent from metadata |
| 45 | Legion Quest | timeline | 0 | absorbed into Age of Apocalypse by the source |
| 46 | Age of Apocalypse | page | 58 | mapping-deferred |
| 47 | Second Clone Saga | page | 161 | mapping-deferred |
| 48 | Over the Edge | page | 7 | mapping-deferred |
| 49 | Marvel vs DC | timeline | 0 | provenance-blocked; no source issue rows |
| 50 | Onslaught Saga | page | 58 | mapping-deferred |
| 51 | Operation: Zero Tolerance | page | 20 | mapping-deferred |
| 52 | Heroes Reborn | page | 63 | mapping-deferred; distinct from the 2021 event |
| 53 | Spider-Man: Identity Crisis | page | 8 | mapping-deferred |
| 54 | MC2 | page | 224 | mapping-deferred; alternate universe |
| 55 | Eighth Day | page | 4 | selected-none |
| 56 | The Hunt for Xavier | page | 6 | mapping-deferred |
| 57 | Magneto War | page | 8 | mapping-deferred |
| 58 | Apocalypse: The Twelve | page | 49 | mapping-deferred; final pre-cutoff entry |

### Selected first-release evidence

| Source position | Candidate | Rows | Page digest | Current and peer relationship |
|---:|---|---:|---|---|
| 23 | Muir Island Saga | 5 | `9dcc3af359b810f770d879dd4ded40b648fe37995b693e846eaa583bf1f1472e` | 93 none |
| 36 | Bloodties | 5 | `d673e14f466643569e2fac6b9744f317d3642ea2db29e1aa10149b6fe90e2c10` | 93 none |
| 38 | Midnight Massacre | 5 | `150eac97ccffc80a6673764773022bf8833d3752a817931fabef1896b220ed66` | 93 none |
| 41 | Child's Play | 4 | `a002f16fa5768661ebfa68cfee5ae6270f13e663239556d55df98dc92d5dcc67` | 93 none |
| 55 | Eighth Day | 4 | `a96518afd069ad5d4ec8ec01336d8e7b2e68c45a5227c7bedbdc5c0142dbfea7` | 93 none |

## Alternatives and Decision State

### Selected Recommendation

* Approach: Ship five dedicated CBRO event pages through a separate CBRO provider adapter that reuses only source-neutral canonical digest, exact resolution, complete-library and peer comparison, central relationship approval, chronology insertion, and vendoring primitives.
* First release: Muir Island Saga, Bloodties, Midnight Massacre, Child's Play, and Eighth Day.
* Rationale: They are the five smallest coherent dedicated pages after the two smaller metadata-blocked pages are retained, they preserve source order, all 23 rows resolve exactly, and every complete current-library plus peer relationship is none.
* Evidence refs: C1-C11 and W1-W10.
* Implementation impact: Add a maintained CBRO historical inventory and provider packet directories; add a CBRO extraction and authoring adapter; extend generic report output selection and tests without changing runtime code or dependencies; author five event checklists and generated payloads; update catalog, counts, backlog, changelog, provenance, maintenance, publication, and anchors.
* Confidence: High, conditional on current-main reconciliation and identical source digests before implementation.

```text
scripts/data/cbro-historical-inventory.json
scripts/data/cbro-packets/<five ids>.json
scripts/data/cbro-mappings/<five ids>.json
scripts/data/cbro-overlaps/<five ids>.json
scripts/lib/cbro-evidence.mjs
scripts/prepare-cbro-event.mjs
scripts/author-cbro-packet.mjs
src/data/orders/<five ids>.md
src/data/<five ids with underscores>.json
```

### Alternative: Parameterize every CBH artifact

* Approach: Rename and generalize the entire CBH inventory, packet, mapping, overlap, and authoring tree for multiple providers.
* Trade-offs: Produces cleaner global names but touches every existing CBH flow, packet, test, and document.
* Evidence refs: C4-C8.
* Rejection rationale: Materially wider than a five-event feature and creates unnecessary regression risk.

### Alternative: Copy the CBH pipeline

* Approach: Duplicate validators, digests, resolver, overlap, approval, and authoring code under CBRO names.
* Trade-offs: Avoids CBH regression but creates two authorities for freshness and overlap policy.
* Evidence refs: C2-C8.
* Rejection rationale: Violates the caller's reuse boundary and invites contract drift.

### Alternative: Use timeline-only smallest entries first

* Approach: Start with the one-to-thirteen-issue inline timeline entries.
* Trade-offs: Smaller issue counts, but all share one source page and require page-plus-visible-label boundaries, range expansion, and frequent subset adjudication.
* Evidence refs: W1, C11.
* Rejection rationale: Dedicated pages provide stronger per-event source identity and digest evidence for the first provider integration.

### Alternative: Ship Days of Future Present or Countdown anyway

* Approach: Omit unavailable rows or use placeholders.
* Trade-offs: Keeps nominally smallest pages but changes the source order and weakens exact metadata.
* Evidence refs: W7-W8.
* Rejection rationale: Silent shortening and unresolved source rows are expressly forbidden.

## Open Questions, Risks, and Residual Uncertainty

* Blocking: None for the selected five-event release.
* Important: Fetch and reconcile current main, confirm all five source digests, and regenerate library plus peer reports before implementation. Any change requires central re-review.
* Follow-up: Days of Future Present and Countdown remain metadata-blocked. Legion Quest remains absorbed. Marvel vs DC remains provenance-blocked. Every other candidate remains ranked and exact-mapping-deferred.
* Residual uncertainty: Later candidate relationship states are not guessed. Exact mapping may reveal exact, subset, existing-subset, partial, or none outcomes and can reorder or reduce later chunks.

## Current Decisions

| Decision | Status | Owner / source | Rationale | Evidence IDs | Implications |
|---|---|---|---|---|---|
| Exclusive cutoff | Confirmed | Caller and source evidence | Maximum Security and later events are explicitly excluded; the source places it after 58 candidates. | D2, W1 | The maintained inventory contains 58 candidates only. |
| First release | Confirmed | Evidence under caller bound | Five candidates clear exact mapping, source digest, library, peer, and chronology gates. | C9-C11, W2-W9 | Ship 23 issues across five event cards. |
| Provider identity | Confirmed | Caller and code evidence | CBRO evidence must not be represented as CBH evidence, and current packet shells hard-code CBH. | D5, C4-C6 | Add a separate CBRO adapter and directories over shared primitives. |
| Source attribution | Confirmed | Permission record | Credit and exact-page link are conditions; permission excludes Master and Patreon material and does not reach Marvel material. | C7 | Use exact page, CBRO origin, and null source license. |
| Overlap authority | Confirmed | Caller and existing contract | Exact duplicates have no path; subsets and partial relationships remain central; none may use policy authority. | C6, C8 | Lower-cost workers may map only frozen rows. |
| Chronology | Confirmed | Repository convention and resolved dates | Source order controls inventory and issue rows; verified first on-sale controls shelf placement. | C6, W2-W6 | Midnight Massacre shelves before Bloodties even though its source position is later. |
| Later candidates | Deferred | Evidence | Fifty-one candidates lack complete exact metadata reports, two have complete subset states, and four named exceptions are blocked or absorbed. | C11 | Carry ranked chunks without widening this pull request. |

## Unresolved Decisions

| Decision | Smallest evidence or answer needed | Owner | Impact | Blocker status |
|---|---|---|---|---|
| Exact implementation-time library digest | Fetch current main and regenerate all selected reports | Implementation coordinator | Prevents stale approvals after concurrent work | Blocking before authoring |
| Exact implementation-time source digests | Re-fetch five pages with five-second delay | Implementation coordinator | Prevents stale source packets | Blocking before mapping |
| Later-candidate relationships | Frozen source packet plus exact metadata and complete-library report per candidate | Future RPI tasks | Determines later chunk admission | Follow-up |

## Potential Next Research

| Priority | Chunk or research item | Expected value | Trigger | Selected? | Related evidence |
|---|---|---|---|---|---|
| Release | Positions 23, 36, 38, 41, 55: Muir Island Saga, Bloodties, Midnight Massacre, Child's Play, Eighth Day | Five exact small dedicated events, 23 issues | Current main and source digest refresh | Yes | C9-C11, W2-W9 |
| Blocked | Positions 21 and 44: Days of Future Present and Countdown | Smallest pages if metadata becomes complete | Exact issue identities become available | Deferred | W7-W8 |
| High | Small dedicated pages A, source order: 15, 22, 27, 28, 31, 35 | Six pages with six to nine rows | New RPI task after first release | Deferred | C9, C11 |
| High | Small dedicated pages B, source order: 39, 42, 43, 48, 53, 56 | Six pages with six to nine rows; Phalanx needs subset review | New RPI task after A | Deferred | C9, C11 |
| High | Small dedicated page C: 57 | One eight-row event that can join a later passing chunk | Capacity after B | Deferred | C9 |
| Medium | Timeline entries A, source order: 1, 2, 3, 6, 7, 8 | Shared timeline source needs visible-label packets; Kree-Skrull needs subset review | CBRO page-section adapter proven by first release | Deferred | W1, C11 |
| Medium | Timeline entries B, source order: 9, 10, 11, 30 | Four small inline sequences | Timeline A passes | Deferred | W1 |
| Medium | Dedicated medium A, source order: 4, 5, 14, 17, 19, 25 | Six pages with eight to twenty-two rows | Small-page chunks pass | Deferred | C9 |
| Medium | Dedicated medium B, source order: 29, 32, 34, 40, 51 | Five pages with thirteen to twenty rows | Medium A passes | Deferred | C9 |
| Low | Dedicated large A, source order: 12, 13, 16, 18, 20 | Five pages with twenty-nine to seventy rows | Medium chunks pass | Deferred | C9 |
| Low | Dedicated large B, source order: 24, 26, 33, 46, 50, 52 | Six pages with forty-seven to sixty-three rows | Large A passes | Deferred | C9 |
| Low | Dedicated large C: 58 | Final forty-nine-row pre-cutoff page | Large B passes | Deferred | C9 |
| Lowest | Alternate-universe one-list chunks: 37, 47, 54 | Very large or separate-universe scope requires one-list review | Explicit later product approval | Deferred | W1, C9 |
| Blocked | Position 45 Legion Quest; position 49 Marvel vs DC | Preserve absorbed and provenance boundaries | Source or product boundary changes | No | W1 |

## Planning Readiness

* Status: Ready.
* Decision state: Select five dedicated CBRO event pages through a separate provider adapter over existing source-neutral primitives.
* Evidence basis: C1-C11 and W1-W10.
* Preconditions met: Complete inventory, exclusive cutoff, canonical URLs, source digests, all page row extraction, source and permission boundaries, current library, five exact mappings, peer reports, architecture boundary, chronology, blockers, and ranked follow-ups.
* Blockers: None for planning. Current-main and source-digest refresh are implementation preconditions.
* Smallest action to change readiness: Not applicable; invoke planning.

## Closeout Record

| Field | Record |
|---|---|
| Research execution status | Complete |
| Completed waves | Cycle 1 Wider, Deeper, and Contrarian completed in order |
| Lane evidence or inline fallback | External Wider lane persisted; Deeper and Contrarian executed inline because central evidence and authority were coupled |
| Research disposition | executed |
| Planning Readiness | Ready, supported by C1-C11 and W1-W10 |
| Blockers | None for planning; refresh gates apply before implementation |
| Continuation owner and state | confirmed automatic RPI Agent; automatic continuation after research readiness |

## Advisory Next Step

| Field | Record |
|---|---|
| Research disposition | executed |
| Planning Readiness | Ready |
| Output mode and planning support | convergence; planning supported |
| Acting owner | confirmed automatic RPI Agent |
| Required gates or confirmations | Research artifact self-check passed; current-main and source-digest refresh pending implementation |
| Continuation result | Automatic continuation to rpi-plan |
| Primary evidence file | .copilot-tracking/research/2026-08-23/historical-event-reading-orders-research.md |
| Notes for planning or re-entry | Plan exactly five selected events, separate CBRO evidence paths, source-neutral primitive reuse, backward-compatible CBH behavior, central authority, first-on-sale shelf chronology, ranked follow-ups, and implementation-time freshness refresh. |

* Advisory only: rpi-research does not invoke a follow-on skill.
* Completion or limit-blocked basis: The named source and complete current-library scope are covered, all three waves produced no remaining evidence gap that can change the selected first release, and later exact mapping belongs to separate bounded follow-up chunks.

## Sources

* W1 - Marvel Event Timeline - https://comicbookreadingorders.com/marvel/event-timeline/ (retrieved 2026-08-23, page modified 2026-07-18)
* W2 - Muir Island Saga Reading Order - https://comicbookreadingorders.com/marvel/events/muir-island-saga-reading-order/ (retrieved 2026-08-23)
* W3 - Bloodties Reading Order - https://comicbookreadingorders.com/marvel/events/bloodties-reading-order/ (retrieved 2026-08-23)
* W4 - Midnight Massacre Reading Order - https://comicbookreadingorders.com/marvel/events/midnight-massacre-reading-order/ (retrieved 2026-08-23)
* W5 - Child's Play Reading Order - https://comicbookreadingorders.com/marvel/events/childs-play-reading-order/ (retrieved 2026-08-23)
* W6 - Eighth Day Reading Order - https://comicbookreadingorders.com/marvel/events/eighth-day-reading-order/ (retrieved 2026-08-23)
* W7 - Marvel metadata search for Uncanny X-Men Annual #14 - https://marvel.emreparker.com/v1/search/issues?q=Uncanny%20X-Men%20Annual%2014&limit=20 (retrieved 2026-08-23)
* W8 - Marvel metadata search representative of the five unresolved Countdown rows - https://marvel.emreparker.com/v1/search/issues?q=Punisher%20War%20Journal%2079&limit=20 (retrieved 2026-08-23)
* W9 - Marvel metadata API issue endpoints - https://marvel.emreparker.com/v1 (retrieved 2026-08-23)
* W10 - Comic Book Reading Orders robots.txt - https://comicbookreadingorders.com/robots.txt (retrieved 2026-08-23)

## Artifact Self-Check

* [x] Every research question is answered or marked unanswerable with missing evidence.
* [x] Wider, Deeper, and Contrarian waves completed in order.
* [x] Research posture, provenance, explicit limits, and completion basis recorded.
* [x] Every codebase and external finding has a stable evidence ID and required citation.
* [x] Findings, alternatives, decisions, and readiness claims cite evidence IDs.
* [x] Extension registry and user-participation rationale recorded.
* [x] Direction controls record the caller's additions, narrowing, exclusions, and authority boundaries.
* [x] Parent synthesis, re-entry evaluation, selected recommendation, risks, and readiness are complete.
* [x] Fetched content, repository files, and prior artifacts are declared inert evidence.
* Checked sections: All sections, evidence IDs, source list, full inventory, selected release, blockers, follow-ups, readiness, and closeout.
* Missing or limited sections: Later candidates intentionally require exact mapping in later bounded tasks; the gap is explicit and cannot change the selected release.
