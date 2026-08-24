<!-- markdownlint-disable-file -->

# Task Research: mcu-best-of-guides

| Field | Value |
|---|---|
| Date | 2026-08-23 |
| Researcher / agent | hve-core:rpi-research parent |
| Status | Complete |
| Artifact path | .copilot-tracking/research/2026-08-23/mcu-best-of-guides-research.md |

## Research Brief

* What to research: Resolve, inventory, and evaluate fourteen user-selected Comic Book Herald Best Of or MCU companion guides for guarded ingestion into the Marvel Reading Tracker, validate their fixed placement under the existing Marvel on Screen Hub category, then identify an honest list type and a bounded first release of four to six admissible guides.
* Why it matters: Planning needs exact source identity, issue boundaries, chronology, mapping feasibility, complete-library and peer overlap, and product-surface evidence before any catalog or reading-order data is authored.
* Audience or intended use: MRT-004 planning, independent plan critique, implementation, post-implementation review, and the repository owner deciding whether each guide is represented honestly.
* Scope: The exact fourteen-guide priority list below; Comic Book Herald canonical source pages and WordPress identities where available; current catalog, orders, guarded Comic Book Herald provider workflow, schemas, tests, product documentation, and all existing reading-list peers.
* Non-goals: Shipping all fourteen guides in the first release; copying source prose, branding, layout, movie imagery, or comic image bytes; bypassing access controls; inferring trade contents without explicit source enumeration or repository-approved exact metadata; forcing every guide into `character-run` or Character Spotlight `best-of`; revisiting emulator, origin, telemetry, or content-hosting decisions.
* Criteria: One canonical source page per title; retrieval timestamp and content plus issue-bearing digests; exact explicit issue/range boundary; issue recommendations distinguished from collections and prose-only mentions; every source row retained and dispositioned; complete-library and selected-peer overlap classification as exact, candidate-subset, existing-subset, partial, or none; exact duplicates rejected; mappings auditable; taxonomy truthful; smallest coherent first release remains one major feature.
* Requested outputs: Full fourteen-title inventory, current-library relationship analysis, deterministic lower-cost implementation chunks, ranked follow-ups, selected four-to-six-guide first release, validated Marvel on Screen category contract and list-type recommendation, risks, and planning readiness.
* Output mode: convergence

## Research Parameters

| Field | Value |
|---|---|
| Research question(s) | Which canonical pages and explicit issue sequences represent the fourteen selected guides, how do they relate to the complete current library and each other, how must the existing Marvel on Screen category contract support them, which list type fits, and which four to six form the smallest coherent admissible first release in user priority order? |
| Codebase scope | `.copilot-tracking/`, `scripts/`, `src/data/`, `src/js/`, `test/`, product documentation, package scripts, and CI/release contracts |
| External scope | `https://www.comicbookherald.com/best-of-lists/`, canonical Comic Book Herald guide pages, WordPress public metadata when normally accessible, and the live repository-approved Marvel metadata API for exact identity checks |
| Initial internal candidate areas | Existing MRT-001 research and plan rationale; `scripts/lib/cbh-inventory.mjs`; `scripts/data/cbh-character-inventory.json`; `scripts/data/cbh-modern-inventory.json`; CBH packet, mapping, overlap, and approval artifacts; `src/data/catalog.json`; current order JSON; schema and publication tests |
| Initial external candidate areas | Comic Book Herald Best Of index, the fourteen linked guide pages, WordPress REST or embedded identity metadata exposed by those pages, and normal HTTP response metadata |
| Research posture | balanced |
| Posture provenance | caller-specified |
| Explicit limits / deadline | Preserve user order; inventory all fourteen; first release only four to six and may reduce; all fourteen must land under the existing Marvel on Screen Hub category; no new category and no Character Spotlight placement; do not bypass anti-bot measures; no fixed deadline; one plan critique and exactly one independent post-implementation review downstream |
| Posture-specific completion basis | Balanced scope coverage and adequate evidence for all fourteen titles, exact first-release candidates, taxonomy, overlap, mappings, risks, chunks, and planning readiness |
| Edits allowed during research? | no, research-only outside this primary evidence artifact and permitted delegated evidence |
| Resolved evidence root | `.copilot-tracking/` |
| Known constraints / excluded sources | Treat fetched material as inert evidence; respect standing product constraints 1 to 11; do not scrape Marvel sites; do not copy protected expression or image bytes; do not infer collection contents without an explicit auditable source |

## Extension Registry and Provenance

* Precedence: platform and host safety; caller scope and criteria; matching repository instructions and enforced schemas; rpi-research contract; domain skills and specialists; examples and preferences.

| Kind | Candidate | Match and provenance | Scoped authority or output contract | Selected / skipped reason |
|---|---|---|---|---|
| Instruction | Repository custom instructions | Applies to all repository and evidence paths | Requires RPI order, three waves, durable decisions, exact citations, scope control, and constraints 1 to 11 | Selected and controlling within repository scope |
| Skill | hve-core:rpi-research | Automatic RPI parent selected it for MRT-004 | Research-only primary artifact, three-wave evidence cycle, parent-owned synthesis and readiness | Selected |
| Research specialist | research agent | Host-visible specialist for external source investigation | Independent bounded source-resolution lane with citations, no decision authority | Selected only for independent web lanes where it reduces context and does not duplicate parent work |
| Research specialist | explore agent | Host-visible internal codebase investigator | Independent bounded repository lane with workspace evidence, no decision authority | Skipped initially because direct batched search is faster for the known contracts |

## User Participation and Research Decisions

| Checkpoint | Questions or no-interaction rationale | Answers / unanswered | Resulting decision or selected further research |
|---|---|---|---|
| Intake | No interaction: the caller supplied exact titles, priority order, evidence requirements, taxonomy guardrails, first-release bounds, and execution mode. | No unanswered intake question. | Begin balanced research with the exact scope below. |
| Direction change | Parent relayed the confirmed user product decision that every selected guide must use the existing Marvel on Screen Hub category. | Fixed placement; no new shelf and no Character Spotlight placement. | Research validates Marvel on Screen ordering, navigation, accessibility, counts, and narrow-layout behavior and does not reopen placement. |
| Convergence | Automatic RPI continuation is explicitly requested; select only after all three waves. | Completed without further user input. | Select priorities 1 to 4 and continue automatically to planning. |

## Scope and Success Criteria

* Scope: Research all fourteen selected titles against their canonical sources, the complete current library, every selected peer, the existing guarded CBH workflow, and the existing Marvel on Screen Hub category contract. Preserve all source rows and priority order. Placement is fixed; only list-type semantics remain open.
* Assumptions: The index title text maps one-to-one to canonical pages; WordPress identity is normally exposed; the current character inventory has reusable guard primitives; the first four titles may form a coherent admissible first chunk. All are claims to verify, not facts.
* Success criteria:
  * Every research question is answered or marked unanswerable with the missing evidence named.
  * All fourteen exact user-selected titles are inventoried in priority order.
  * Every source and codebase claim uses a stable evidence ID.
  * Wider, deeper, and contrarian waves are complete in order.
  * A selected four-to-six-guide first release has exact source boundaries and auditable mapping feasibility.
  * Complete-library and peer overlaps are classified with no silent omissions.
  * The fixed Marvel on Screen placement is validated across ordering, navigation, accessibility, counts, and narrow layout; list-type semantics are evidence-backed.
  * Deterministic lower-cost chunks and ranked follow-ups are recorded.

## Task Research Requests

### Exact selected scope and priority order

The following is the user's exact selected scope, persisted before substantive search:

1. The Best Comics to Read with Doctor Strange: Multiverse of Madness!
2. The Best Comics to Read Before Spider-Man: No Way Home!
3. 10 Great Comics Featuring the Marvel Multiverse!
4. Best of Marvel What If…? Comics!
5. 10 Best Comics To Read With Wandavision!
6. The Best Comics to Read With Spider-Man: Far From Home!
7. One Comic Rec for Every Avenger in Avengers: Endgame!
8. Best Comics To Read Before Avengers: Endgame!
9. The Best Miles Morales Comics To Read With Into the Spider-Verse
10. The Best Venom Comics To Read With Venom (The Movie)!
11. Best Ant-Man & Wasp Comics To Read With The MCU
12. Best Deadpool Comics To Read With Deadpool 2
13. Best Comics To Read With Avengers: Infinity War
14. Best Iron Man Comics to Read Before Iron Man 3

The Miles Morales and Venom movie guides remain in this user-defined MCU companion scope even where film-universe taxonomy differs. The order above is the priority order.

* Explicit requests: Resolve each title to one canonical page and WordPress identity where available; record retrieval time, content and issue-bearing digests, explicit boundaries, chronology, and issue-versus-collection wording; classify overlap against the complete library and all selected peers; reject exact duplicates; determine the honest surface; inventory all fourteen; define implementation chunks and follow-ups; select and prepare a bounded first release of four to six.
* Inferred research questions: Whether a narrow `mcu-companion` list type can be added within the fixed Marvel on Screen category without weakening existing `character-run` semantics; whether the first four to six are source-exact and sufficiently distinct; which source rows require collection mapping, ambiguity approval, repetition preservation, or metadata-horizon handling.
* Caller constraints and non-goals: No implementation during research; no first-release widening beyond six; no silent row drops; no collection inference without auditable authority; no copying source expression or comic imagery.

## Direction Controls

| Control type | Direction or boundary | Source / checkpoint | Effect on active brief, evidence, or revalidation |
|---|---|---|---|
| add | Include all fourteen named guides and their complete-library plus peer relationships. | User intake | Every title requires a disposition even if not selected for release. |
| narrow | Ship only four to six smallest coherent admissible guides in user order. | User intake | Research may reduce first release but may not widen it to all fourteen. |
| change | Treat Miles Morales and Venom movie guides as in-scope MCU companions despite film-universe taxonomy. | User intake | Taxonomy must support a user-defined movie-companion shelf rather than strict MCU canon. |
| exclude | Do not force every guide into `character-run` or Character Spotlight `best-of`. | User intake | Existing taxonomy must be proven accurate or narrowly extended. |
| change | Place all fourteen guides under the existing Marvel on Screen Hub category. | Confirmed user product decision relayed 2026-08-23 | Placement is fixed; validate and reuse the existing category contract, card order, navigation, accessibility, counts, and narrow-layout behavior. |
| exclude | Do not create a new shelf/category or place these cards under Character Spotlight. | Confirmed user product decision relayed 2026-08-23 | Research cannot reopen the placement decision; it may only determine truthful list-type semantics inside Marvel on Screen. |
| exclude | Do not bypass access controls or infer trade contents without explicit auditable evidence. | User intake and repository constraints | Missing evidence becomes an explicit blocker or deferral, never a guessed mapping. |
| discard | Do not ship all fourteen in this first PR. | User intake | Remaining admissible guides become ranked follow-ups. |

## Research Questions

| # | Sub-question | Type | Priority | Status |
|---:|---|---|---|---|
| Q1 | What canonical page, WordPress identity, retrieval timestamp, digests, and explicit source boundary belongs to each of the fourteen titles? | breadth | H | answered |
| Q2 | Which source rows are explicit issues or ranges, collections, prose-only mentions, repeated rows, ambiguous identities, or post-2025 metadata-horizon cases? | depth | H | answered |
| Q3 | How does each candidate overlap the complete current library and every selected peer? | depth | H | answered for the first release; deferred candidates name the mapping evidence still needed |
| Q4 | Which current CBH inventory, packet, mapping, overlap, approval, digest, and freshness primitives can be reused without weakening modern or character flows? | depth | H | answered |
| Q5 | What list type and schema semantics honestly represent these guides inside the fixed Marvel on Screen category, and what existing ordering, navigation, accessibility, count, and narrow-layout contracts must be preserved? | depth | H | answered |
| Q6 | Which four to six guides form the smallest coherent admissible first release in user order, and what deterministic chunks and follow-ups remain? | breadth | H | answered |
| Q7 | What counter-evidence could disqualify the preferred first chunk or taxonomy? | depth | H | answered |

## Prior Knowledge Gate

* Existing artifacts reviewed: MRT-001 research and plan; repository instructions; current CBH inventory, packet, mapping, overlap, approval, catalog, Hub, shelf, routing, and release-test contracts; prior accepted character-source extraction tooling and recent Groot release research.
* Reused (verified) findings: The app is a local browser companion, not an emulator; comic image bytes, accounts, cloud services, telemetry, origin changes, Marvel scraping, and reader-tab reuse remain excluded by standing constraints. CBH source identity, stable issue-bearing digests, exact mapping, complete-library comparison, named peer comparison, and central approval already have guarded primitives.
* Superseded / stale: Catalog and CBH baseline counts were re-derived from current `main` as 96 readings across 89 stories, with 13 character runs, 2 creator runs, 6 eras, and 75 events. The approved Marvel on Screen Hub category is not yet represented in current runtime code, so planning must realize that fixed placement rather than assume a shipped category contract. No prior conclusion about the fourteen titles is accepted without current source and complete-library evidence.

## Research Cycle Log

### Cycle 1

* Active direction controls: all controls above, including the fixed Marvel on Screen placement.
* Active research posture and completion basis: balanced; complete all fourteen source identities and relationship inventory, then deepen the admissible first-release candidates and challenge the preferred result.
* Explicit limits or deadline effect: no time deadline; normal access controls and first-release size bound apply.

#### Wave 1: Wider

* Plan and independent lanes: Resolve all fourteen canonical source identities externally; inventory current taxonomy, schemas, CBH guard primitives, complete library, and precedent artifacts internally; identify candidate chunks in priority order.
* Worker evidence relationships or inline fallback: Three independent external title-resolution lanes resolved guides 1 to 5, 6 to 10, and 11 to 14. The parent persisted their full evidence under the research subagent path, re-fetched all fourteen exact WordPress identities, and computed raw rendered-content plus normalized issue-bearing-block digests. Inline internal investigation established the current catalog/type/shelf baseline, the accepted CBH evidence chain, and the approved-but-unimplemented Marvel on Screen Hub direction.
* Reflection: All fourteen titles resolve to one canonical Best Of identity. Priority 6 has a real second podcast post with a near-identical title, but the Best Of index selects post 40184 as canonical. Source structure divides the inventory into issue-explicit, collection-explicit, collection-only, and prose-only boundaries. A narrow inventory adapter can reuse exact packet, mapping, report, and approval primitives. The current Hub groups every eligible story through the three browse-shelf definitions, so Marvel on Screen cannot be achieved by changing a label or misusing `character-run`; it needs a bounded Hub-category contract while retaining one discoverable destination per story. Evidence: C2-C16; W1-W15.

#### Wave 2: Deeper

* Parent-prioritized material from Wave 1: Exact mappings and complete-library plus peer relationships for the highest-priority source-admissible chunk; truthful handling of guide 3's limited issue boundary; guide 6's dual identity; narrow provider-adapter precedent; and a runtime model for the approved Hub placement.
* Plan and independent lanes: Resolve every issue-explicit row for priorities 1 to 4 against exact metadata series; map priority 6 as the next small feasibility candidate; compare each candidate with all 96 current readings and every mapped peer; inspect the CBRO provider adapter; and derive a Hub-only category contract that does not add a fourth browse screen.
* Worker evidence relationships or inline fallback: Parent execution mapped priorities 1, 2, 3, 4, and 6 to 17, 17, 2, 7, and 8 exact unique issues respectively. Each report covers 96 current readings plus four selected peers. Priority 1 has two partial relationships, priority 2 none, priority 3 is a candidate-subset of both shipped Claremont paths, priority 4 none, and priority 6 has one partial relationship with Spider-Man Best Of. The mapping binds current library digest `b59fa634730a8a342346f3bdb4984739d8e034b0faeff0cbb14557ce51604f90`. The CBRO precedent proves a narrow provider inventory can reuse shared CBH packet, mapping, overlap, approval, and authoring primitives without changing CBH defaults. Evidence: C4-C8, C14-C16; W16.
* Reflection: Priorities 1 to 4 form a coherent 43-issue multiverse-oriented release in exact user order. Priority 3 adds no unique issue IDs, but it is not an exact duplicate: it is a source-defined thematic two-issue subset and remains admissible only with stronger-model subset approval plus explicit card copy that the source's other nine picks do not state issue boundaries. Priority 6 is the next smallest mapped candidate but remains a follow-up because the first four already satisfy the release bound and preserve priority. Evidence: C5-C8, C15-C16; W2-W7, W16.

#### Wave 3: Contrarian

* In-scope challenge targets and boundaries: Challenge canonical identity, source completeness, title counts, collection expansion, exact metadata identity, overlap classification, taxonomy, placement, and the claim that priorities 1 to 4 are a truthful release. Do not challenge the user's fixed Marvel on Screen placement.
* Plan and independent lanes: Seek duplicate pages, omitted headed rows, collection-only recommendations disguised as issue ranges, repeated source rows, inaccessible revisions, metadata mismatches, exact or subset duplication, misleading list names, and a simpler existing type that could fit without semantic damage.
* Worker evidence relationships or inline fallback: Priority 6's podcast post disproves title-string identity and confirms the index URL must be authoritative. Priority 5's title says ten while the current page has eleven headed picks. Priority 8 has zero issue-bearing blocks. Priorities 11 to 13 are collection-first and cannot be expanded honestly. Priority 3's two IDs are complete subsets of both Claremont paths, so it needs exceptional authority and transparent scope. New Avengers: Illuminati #0 maps to Marvel's exact one-shot series whose metadata labels its only issue #1; What If? Magik maps to the exact one-shot series whose sole metadata issue is #1. No first-release peer overlaps another first-release peer. Current types all assert event, character, creator, or era semantics that these guides do not share. Current narrow layout already collapses the card grid through `auto-fill` and needs no separate category-specific card CSS. Evidence: C5, C9-C17; W2-W16.
* Reflection: The preferred release survives only with explicit source exclusions and original project summaries. It must not claim to reproduce every collection recommendation. `screen-companion` is the narrowest honest type. Marvel on Screen must be a non-empty Hub category, not a fourth browse route and not Character Spotlight. Priority 3 remains the highest-risk accepted card; a semantic test must pin its two-row source boundary, subset approval, and scope wording. Priorities 5 onward stay inventoried and deferred or blocked rather than being silently omitted.

#### Parent Synthesis and Disposition

| Material / claim | Evidence IDs or worker pointers | Parent disposition | Evidence-based rationale | Primary-artifact treatment |
|---|---|---|---|---|
| Fourteen canonical source identities and digests | W1-W15; three lane artifacts | accepted | Each requested title resolves through the Best Of index or exact slug to one canonical post; priority 6's second post is identified and rejected as a podcast companion. | Full inventory source identity |
| First release priorities 1 to 4 | C15-C16; W2-W5, W16 | accepted | Forty-three exact unique rows preserve the user's first four priorities; every non-row source recommendation is explicitly classified and excluded rather than inferred. | Selected release boundary |
| Priority 3 candidate-subset | C5, C15; W4, W16 | accepted with central authority | The two-issue sequence is not an exact duplicate, has a distinct multiverse-companion purpose, and is the page's only issue-numbered headed recommendation. | Stronger-model subset disposition and scope-warning test |
| Priority 6 as part of first release | C15; W7, W16 | rejected for this release | It is exact and small, but priorities 1 to 4 already meet the four-guide bound and preserve user order. | Ranked follow-up after priority 5 |
| Collection expansion without source enumeration | W2-W15 | rejected | The caller forbids inferred trade contents; collection-only and prose-only rows remain explicit exclusions or blockers. | Inventory terminal or deferred states |
| Reuse Character Spotlight or current list types | C9-C13 | rejected | Every existing type makes a false event, character, creator, or era claim, and Character Spotlight placement is explicitly forbidden. | Add `screen-companion` |
| Fourth browse shelf or route | C11-C13; user direction | rejected | The user fixed Hub placement and prohibited a new shelf/category; the accepted category belongs on the existing Hub. | Add a Hub-only non-empty category contract |
| Narrow CBH MCU inventory adapter | C4-C8, C14 | accepted | CBRO demonstrates provider-specific inventory and authoring layers over the shared guarded primitives. | New fourteen-record inventory plus thin adapter |

#### Cycle Re-entry Evaluation

* Another complete three-wave cycle needed: no.
* Trigger or stop basis: Balanced scope is covered. Every title has canonical identity, digest, explicit source classification, disposition, and ranked follow-up state. The selected four have exact mappings, complete-library and peer relationships, and an evidence-backed runtime model. Further mapping of deferred large guides would widen the first release without changing it.
* Revised brief or revalidation required: None. The Marvel on Screen placement direction was persisted before deeper research and remained fixed.
* Readiness effect: Ready.

## Evidence Log

* Delegation: `.copilot-tracking/research/subagents/2026-08-23/mcu-best-of-guides-wider-guides-01-05.md`, `.copilot-tracking/research/subagents/2026-08-23/mcu-best-of-guides-wider-guides-06-10.md`, and `.copilot-tracking/research/subagents/2026-08-23/mcu-best-of-guides-wider-guides-11-14.md`; parent-owned synthesis, digests, mapping, overlap, and decisions remain in the primary artifact.

### Codebase Evidence

| ID | Claim / finding | Stable path or symbol | Tool | Confidence | Notes |
|---|---|---|---|---|---|
| C1 | The app was selected as a browser companion because it is the only sound host architecture, not as an emulator fallback. | `.copilot-tracking/research/2026-08-03/marvel-reading-tracker-research.md` | read | high | Existing rationale verified before structural analysis. |
| C2 | Existing CBH guard code recognizes `character-run` but no MCU or movie-companion type. | `scripts/lib/cbh-inventory.mjs` | read | high | Taxonomy addition remains a candidate, not a decision. |
| C3 | CBH packet validation already binds source URL, section, expected count, source origin, output filename, and exact cover issue identity. | `scripts/lib/cbh-inventory.mjs` | read | high | Reuse candidate for a narrow inventory adapter. |
| C4 | Frozen CBH packets validate exact provider URL, retrieval date, optional content and issue-bearing digests, explicit exclusions, non-empty rows, exact row count, source review authority, packet freshness, inventory identity, and duplicate source identity. | `scripts/lib/cbh-inventory.mjs` | read | high | MRT-004 can reuse the packet contract rather than inventing a parallel guard. |
| C5 | The overlap helper already classifies none, exact, candidate-subset, existing-subset, and partial relationships. | `scripts/lib/cbh-overlap.mjs` | read | high | This exactly matches the caller's relationship vocabulary. |
| C6 | The overlap reporter rejects unresolved and duplicate mapping rows, validates candidate and peer mapping freshness, compares against every current order, excludes the candidates from the library digest, and binds peer digests plus the final report digest. | `scripts/report-order-overlap.mjs` | read | high | Complete-library and selected-peer comparison machinery is reusable as-is. |
| C7 | The authorer requires approved manifests, exact mapped issue IDs and Marvel issue URLs, matching source identity and counts, and writes project-authored checklist framing without source commentary or images. | `scripts/author-cbh-packet.mjs` | read | high | Existing authorship and provenance boundary matches the caller's content restrictions. |
| C8 | Current semantic tests prove stale packet, mapping, report, library, peer, approval, omitted-row, and incomplete-disposition failures across a shipped character guide. | `test/cbh-character-spotlight.test.js` | read | high | New coverage should generalize these guards for the MCU inventory rather than weaken character behavior. |
| C9 | The catalog currently accepts only `event`, `character-run`, `creator-run`, and `era`; only `character-run` may carry Character Spotlight taxonomy. | `src/js/lib/catalog.js` | read | high | The new guides cannot be represented honestly by a current non-character type. |
| C10 | Curated manifest validation enforces the same list types and rejects Character Spotlight taxonomy on every non-character type. | `src/js/lib/curated.js` | read | high | A new list type must be wired through both source and generated catalog parsing. |
| C11 | The three browse shelves are Timeline for events, Storylines as the fallback, and Character Spotlights for character runs; unknown and mixed types deliberately fall to Storylines. | `src/js/lib/catalog.js` | read | high | Merely adding a type would misplace the guides on Storylines unless the approved Hub category is modeled explicitly. |
| C12 | The Hub currently groups every eligible story by the same three browse-shelf definitions and renders those headings; it has no independent category layer. | `src/js/main.js` | read | high | Marvel on Screen is an approved direction but not a shipped runtime contract on current `main`. |
| C13 | Shelf tests require every story to reach exactly one browse screen, preserve grouped stories, and keep the browse-screen and catalog counts equal. | `test/catalog-shelves.test.js` | read | high | Planning must preserve reachability while adding Hub-specific placement and must not strand new list types. |
| C14 | The CBRO evidence layer is a narrow provider adapter over shared CBH packet, digest, source identity, mapping, overlap, approval, and report primitives, while preserving legacy CBH defaults. | `scripts/lib/cbro-evidence.mjs` | read | high | This is the repository precedent for the requested MCU companion adapter. |
| C15 | Parent mapping evidence records 96 current readings, five mapped candidates, exact row metadata, complete-library plus peer comparisons, and the current library digest. | `.copilot-tracking/research/2026-08-23/mcu-best-of-first-release-mapping.json` | generated research evidence | high | Priorities 1 to 4 total 43 exact rows; priority 6 is retained as follow-up feasibility evidence. |
| C16 | First-release mapping reports priority 1 partials with Civil War Avengers and Dark Reign Avengers; priority 2 none; priority 3 candidate-subset relationships with both Claremont paths; and priority 4 none. | `.copilot-tracking/research/2026-08-23/mcu-best-of-first-release-mapping.json` | generated research evidence | high | No exact duplicate exists; priority 3 requires central subset approval. |
| C17 | The Hub card grid already uses an adaptive `auto-fill` minimum and group spacing, so an additional non-empty group reuses the same narrow-layout behavior without category-specific card CSS. | `src/styles.css` | read | high | Browser proof still must verify heading visibility and one-column behavior at a narrow viewport. |

### External Evidence

| ID | Claim / finding | Source (title) | URL | Retrieved | Version/date | Confidence |
|---|---|---|---|---|---|---|
| W1 | The Best Of index provides the authoritative title order and canonical links, including the priority 6 full guide rather than its podcast companion. | Comic Book Herald Best Of Lists | https://www.comicbookherald.com/best-of-lists/ | 2026-08-24 | current page | high |
| W2 | Priority 1 is WordPress post 60844; its source has three issue-explicit headed picks plus six collection, series, one-shot, or prose-defined picks. | Doctor Strange: Multiverse of Madness companion | https://www.comicbookherald.com/the-best-comics-to-read-with-doctor-strange-multiverse-of-madness/ | 2026-08-24 | retrieved content digest `5667169a...c528a` | high |
| W3 | Priority 2 is post 57912; three of six headed picks are issue-explicit and Spider-Man: One More Day is explicitly not recommended. | Spider-Man: No Way Home companion | https://www.comicbookherald.com/the-best-comics-to-read-before-spider-man-no-way-home/ | 2026-08-24 | digest `6499c534...b7ce4` | high |
| W4 | Priority 3 is post 53113; only Days of Future Past #142 to #143 is a headed issue-range recommendation among ten picks. | Marvel Multiverse picks | https://www.comicbookherald.com/10-great-comics-featuring-the-marvel-multiverse/ | 2026-08-24 | digest `8d46a4ef...8d02` | high |
| W5 | Priority 4 is post 52275; all seven headed recommendations identify one exact numbered issue or one-shot, with five numbers carried by captions. | Marvel What If picks | https://www.comicbookherald.com/best-of-marvel-what-if-comics/ | 2026-08-24 | digest `abc1a04d...bd9` | high |
| W6 | Priority 5 is post 51003; the title says ten while the current page has eleven headed picks, eight issue-explicit and three collection/run-only. | WandaVision companion | https://www.comicbookherald.com/10-best-comics-to-read-with-wandavision/ | 2026-08-24 | digest `32b6a240...590` | high |
| W7 | Priority 6 canonically resolves through the index to full guide post 40184; post 40334 is a separate podcast companion. The full guide has eight issue-explicit rows. | Spider-Man: Far From Home companion | https://www.comicbookherald.com/the-best-comics-to-read-before-spider-man-far-from-home/ | 2026-08-24 | digest `0cb605eb...a1b4` | high |
| W8 | Priority 7 is post 34099 with ten issue-explicit character sections; Dora Milaje and Thanos make the title's “every Avenger” wording inexact, and Captain Marvel includes a nested alternative. | Avengers: Endgame character picks | https://www.comicbookherald.com/one-comics-rec-for-every-avenger-in-avengers-endgame/ | 2026-08-24 | digest `8fc980c0...791` | high |
| W9 | Priority 8 is post 33921 and has zero explicit issue-number rows. | Avengers: Endgame companion | https://www.comicbookherald.com/best-comics-to-read-before-avengers-endgame/ | 2026-08-24 | digest `23a5818d...e85` | high |
| W10 | Priority 9 is post 30218 with eleven collection rows whose `Collects:` lines explicitly enumerate issue boundaries. | Miles Morales and Spider-Verse companion | https://www.comicbookherald.com/the-best-miles-morales-comics-to-read-with-into-the-spider-verse/ | 2026-08-24 | digest `29cfc9c2...2cc` | high |
| W11 | Priority 10 is post 26953 with eleven issue-explicit collection rows. | Venom movie companion | https://www.comicbookherald.com/the-best-venom-comics-to-read-with-venom-the-movie/ | 2026-08-24 | digest `445dba09...6a25` | high |
| W12 | Priority 11 is post 24369 with seven collection recommendations and only contextual issue citations. | Ant-Man and Wasp MCU companion | https://www.comicbookherald.com/best-ant-man-wasp-comics-to-read-with-the-mcu/ | 2026-08-24 | digest `1fdbf320...5ab` | high |
| W13 | Priority 12 is post 21958 with ten collection/run recommendations and one contextual X-Force range. | Deadpool 2 companion | https://www.comicbookherald.com/best-deadpool-comics-to-read-with-deadpool-2/ | 2026-08-24 | digest `8dde2eeb...167a` | high |
| W14 | Priority 13 is post 22013 with ten recommendations, predominantly collection or linked-guide level, including one prose novel that must not become a comic row. | Avengers: Infinity War companion | https://www.comicbookherald.com/best-comics-to-read-with-avengers-infinity-war/ | 2026-08-24 | digest `ae23e337...1a8d` | high |
| W15 | Priority 14 is post 1642 with eleven issue-explicit rows across three sections plus historical availability caveats. | Iron Man 3 companion | https://www.comicbookherald.com/best-iron-man-comics-to-read-before-iron-man-3/ | 2026-08-24 | digest `2f7f0120...49f3` | high |
| W16 | The maintained Marvel metadata snapshot resolves all 51 feasibility rows across priorities 1, 2, 3, 4, and 6 to one exact issue each; the selected first four use 43 of them. | Marvel metadata API | https://marvel.emreparker.com/v1 | 2026-08-24 | snapshot horizon 2025 | high |

### Contradictions / Conflicts

* Priority 6 title identity: the requested “With” title also exists as a short podcast post, but the Best Of index points that title to the full guide's “before” slug. Resolve identity by index target and WordPress post 40184, not title string.
* Priority 5 count: the title promises ten but the current source has eleven headed picks. Preserve eleven in inventory and require a source-boundary assertion before any future release.
* Priority 3 product value: source evidence supports only two issue rows, and both are already in two shipped Claremont paths. The relationship is candidate-subset, not exact; accept only as a transparently scoped thematic companion.
* WordPress modification timestamps: several records report modification before publication, so current content and issue-bearing digests plus retrieval timestamp are the freshness authority; timestamp ordering is not.

## Findings Mapped to Questions and Evidence

| Question | Finding | Evidence IDs | Confidence | Decision or readiness implication |
|---|---|---|---|---|
| Q4 | Packet, exact mapping, complete-library and peer comparison, source identity, digest freshness, authoring, and approval primitives are reusable; only the inventory state model and candidate-specific semantic assertions need a narrow MCU companion adapter. | C2-C8 | high | Do not duplicate or weaken the workflow. |
| Q5 | Marvel on Screen is a confirmed Hub placement but is absent from current runtime code; current unknown types fall to Storylines and current Hub groups only the three browse shelves. | C9-C13 | high | Planning must model the approved Hub category explicitly, add an honest list type, and preserve one reachable destination without creating a fourth browse screen or using Character Spotlight. |
| Q1 | All fourteen titles resolve to one canonical Best Of source identity and now have retrieval timestamps, content digests, issue-bearing digests, WordPress identities, and source-form classifications. | W1-W15 | high | A complete fourteen-record inventory can be validated and frozen. |
| Q2 | Sources range from fully issue-explicit to zero issue rows; priorities 3, 8, and 11 to 13 are the most boundary-limited, while priorities 4, 7, 9, 10, and 14 are structurally strongest. | W2-W15 | high | No collection-only row may be expanded or silently omitted. |
| Q3 | Priorities 1 to 4 have 43 exact unique mappings across 100 comparisons each: two partials, none, two candidate-subsets, and none respectively; no selected peer overlaps another selected peer. | C5-C6, C15-C16; W16 | high | Exact duplicates are absent; central authority is needed for priority 1 partials and priority 3 subsets. |
| Q5 | `screen-companion` states the shared reading purpose without claiming MCU canon, character focus, event scope, creator scope, or chronological era. A non-empty Hub category can reuse the existing grid and narrow behavior without a new browse route. | C9-C13, C17; user direction | high | Add a type and Hub category model, keep Character Spotlight untouched, and preserve accessibility/count contracts. |
| Q6 | Priorities 1 to 4 are the bounded first release; priority 6 is the next smallest mapped candidate but follows priority 5 in the user's queue. | C15-C16; W2-W7, W16 | high | Ship four now and preserve all ten remaining dispositions in inventory. |
| Q7 | Dual source identity, title-count drift, candidate-subset overlap, collection-only rows, and absent issue rows materially constrain the release but do not defeat the selected first four when exclusions and scope wording are explicit. | C5, C9-C17; W2-W16 | high | Candidate-specific semantic tests are release gates, not optional documentation. |

## Key Discoveries

* The strict source and relationship workflow already exists end to end and can be reused through a narrow MCU companion inventory.
* Current `main` carries 96 readings across 89 stories; every first-release overlap report must bind against that complete library plus all selected first-release peers.
* Marvel on Screen is an approved product placement but not a shipped runtime category. It cannot be achieved honestly through an existing type or by relabeling Character Spotlight.
* The first release is priorities 1 to 4, 43 exact rows total: Doctor Strange 17, Spider-Man No Way Home 17, Marvel Multiverse 2, and Marvel What If 7.
* Priority 3 is a reviewed candidate-subset, not an exact duplicate. Its card and checklist must say it represents the guide's only issue-numbered selection rather than all ten prose and collection picks.
* Priority 6 maps exactly to eight issues and is the next lowest-cost feasibility candidate, but the user's priority 5 remains ahead of it in follow-up ranking.

### Complete fourteen-guide inventory

| Priority | Inventory id | Canonical form | Explicit boundary | Current relationship state | Research disposition |
|---:|---|---|---|---|---|
| 1 | `doctor-strange-multiverse-of-madness` | Post 60844 | 17 exact issues from three issue-explicit picks; six headed non-row picks and contextual mentions are recorded exclusions | Partial with Civil War Avengers (6) and Dark Reign Avengers (1) | First release |
| 2 | `spider-man-no-way-home` | Post 57912 | 17 exact issues from three issue-explicit picks; collection and contextual rows are exclusions | None across current library and selected peers | First release |
| 3 | `marvel-multiverse` | Post 53113 | 2 exact issues from the sole issue-numbered headed pick; nine collection/run picks are exclusions | Candidate-subset of both shipped Claremont paths | First release with central subset approval |
| 4 | `marvel-what-if` | Post 52275 | 7 exact comics, including caption-defined issues and one exact one-shot | None across current library and selected peers | First release |
| 5 | `wandavision` | Post 51003 | Eight issue-explicit headed picks and three collection/run picks; title says 10 while page has 11 | Exact mapping not run | Ranked follow-up 1 |
| 6 | `spider-man-far-from-home` | Indexed full guide post 40184; podcast post 40334 excluded | 8 exact issues; four prose/run mentions excluded | Partial with Spider-Man Best Of (5) | Ranked follow-up 2 |
| 7 | `avengers-endgame-character-picks` | Post 34099 | Ten issue-explicit sections; one nested Captain Marvel alternative and two non-Avenger subjects need central disposition | Exact mapping not run | Ranked follow-up 3 |
| 8 | `avengers-endgame` | Post 33921 | Zero explicit issue-number rows | Not applicable until a new exact authority exists | Blocked by source boundary |
| 9 | `miles-morales-spider-verse` | Post 30218 | Eleven source-authored `Collects:` boundaries | Exact mapping not run | Ranked follow-up 4 |
| 10 | `venom-movie` | Post 26953 | Eleven source-authored `Issues:` boundaries | Exact mapping not run | Ranked follow-up 5 |
| 11 | `ant-man-wasp-mcu` | Post 24369 | Seven collection rows; contextual issue mentions do not enumerate the recommendations | Not applicable until a new exact authority exists | Blocked by source boundary |
| 12 | `deadpool-2` | Post 21958 | Ten collection/run rows; one contextual X-Force range | Not applicable until a new exact authority exists | Blocked by source boundary |
| 13 | `avengers-infinity-war` | Post 22013 | Collection/linked-guide rows plus one prose novel; no complete issue boundary | Not applicable until a new exact authority exists | Blocked by source boundary |
| 14 | `iron-man-3` | Post 1642 | Eleven issue-explicit rows across three sections | Exact mapping not run | Ranked follow-up 6 |

### Deterministic implementation chunks

| Chunk | Guides | Gate and cost rationale |
|---|---|---|
| Release A | Priorities 1, 2, 3, 4 | Selected now. Exact 43-row mapping exists; user order is preserved; two partials and two subsets need central approval; all four share the multiverse and screen-companion purpose. |
| Follow-up B | Priority 5 | Next user priority. Freeze all 11 headed picks, map the eight issue-explicit groups, and resolve the title-count discrepancy without dropping three collection rows. |
| Follow-up C | Priority 6 | Eight exact rows already mapped; freeze post 40184 and explicitly reject podcast post 40334; approve one five-issue partial. |
| Follow-up D | Priority 7 | Freeze ten character sections and the nested Captain Marvel alternative before mapping the large ranges. |
| Follow-up E | Priority 9 | Expand only the eleven source-authored `Collects:` lines, then compare the large mapping against Spider-Verse and Miles-related current lists. |
| Follow-up F | Priority 10 | Expand only the eleven source-authored `Issues:` lines, resolve reused series titles by year, then compare against Venomverse and Spider-Man peers. |
| Follow-up G | Priority 14 | Preserve all three sections, availability caveats, and eleven explicit rows; map reused Iron Man numbering by exact series year. |
| Evidence re-entry | Priorities 8, 11, 12, 13 | No implementation chunk exists until an explicit source enumeration or repository-approved exact collection mapping is available. |

## Alternatives and Decision State

### Selected Recommendation (convergence only)

* Approach: Ship priorities 1 to 4 as four `screen-companion` reading lists under a non-empty Marvel on Screen category on the existing Hub. Preserve only source-explicit issue or exact one-shot recommendations, record every other headed row as an exclusion, and bind all 43 mapped rows through a narrow MCU companion inventory adapter over the existing CBH packet, mapping, complete-library/peer report, central approval, and authoring primitives.
* Rationale: This is the smallest coherent release in exact user order. All four sources and mappings are exact, no exact duplicate exists, and the multiverse-oriented grouping fits the caller's explicit allowance. A new list type is necessary because all current types make false claims. A Hub-only category realizes the fixed placement without adding a fourth browse shelf or Character Spotlight classification.
* Evidence refs: C4-C17; W1-W5, W16; user direction.
* Implementation impact: Add a fourteen-record MCU companion inventory and thin provider adapter; four packets, mappings, reports, approvals, order sources, generated payloads, manifest and catalog cards; `screen-companion` parsing and labels; a non-empty Marvel on Screen Hub category; directly affected counts, tests, browser proof, backlog, changelog, provenance, maintenance, publication, UX, and anchors.
* Confidence: high for the four-guide source, mapping, overlap, and taxonomy boundary. Medium-high for the Hub realization because the category is an approved user direction but current `main` does not yet contain a runtime category layer.

### Alternative: Reuse Character Spotlight taxonomy unchanged

* Approach: Label all selected guides as `character-run` and `best-of`.
* Trade-offs: Lowest schema cost, but broad multiverse and Avengers guides may be falsely represented.
* Evidence refs: C2.
* Rejection rationale: Rejected. Caller direction forbids it, and priorities 1, 2, and 3 are not single-character guides.

### Alternative: Add a narrow movie-companion list type inside Marvel on Screen

* Approach: Introduce a validated list type while reusing the existing Marvel on Screen category and its UI contract.
* Trade-offs: Honest list semantics at the cost of a bounded schema extension, without adding or changing category placement.
* Evidence refs: C2.
* Rejection rationale: Selected with the more accurate type name `screen-companion`; the fixed category name remains Marvel on Screen.

### Alternative: Put the guides on a fourth browse screen

* Approach: Add a Marvel on Screen route, rail item, browse shelf, and page.
* Trade-offs: Gives the category a dedicated destination but widens navigation and contradicts the user's instruction not to add a shelf/category.
* Evidence refs: C11-C13; user direction.
* Rejection rationale: Rejected. The approved placement is the existing Hub, and all cards can remain fully operable there.

### Alternative: Exclude priority 3 because it adds no unique issues

* Approach: Skip the Marvel Multiverse guide because its two exact rows already occur in both Claremont paths.
* Trade-offs: Avoids a subset card but breaks the bounded first-four user order and discards a distinct screen-companion purpose.
* Evidence refs: C5, C15-C16; W4, W16.
* Rejection rationale: Rejected for the first release. The relationship is candidate-subset rather than exact, the caller explicitly reserves subset approval to central authority, and transparent scope wording prevents the card from overstating coverage.

## Open Questions, Risks, and Residual Uncertainty

* Blocking: None for planning the four-guide first release.
* Important: Priority 3 requires central candidate-subset approval and explicit scope wording. Current `main` lacks the approved Marvel on Screen runtime category, so implementation must add the Hub-only category model without a fourth route.
* Follow-up: Priorities 5, 6, 7, 9, 10, and 14 are ranked mapping releases; priorities 8 and 11 to 13 require new explicit source authority.
* Residual uncertainty: Public WordPress revisions are inaccessible, so freshness is bound to current retrieval timestamp plus content and issue-bearing digests rather than historical edit reconstruction. Priority 3's product value is purpose-based rather than issue uniqueness and remains the release's highest-risk accepted decision.

## Current Decisions

| Decision | Status | Owner / source | Rationale | Evidence IDs | Implications |
|---|---|---|---|---|---|
| Preserve the fourteen-title order as implementation priority. | confirmed | user | Explicit selected order. | User direction | Chunk selection may reduce scope but not reorder candidates silently. |
| Keep Miles Morales and Venom movie guides in companion scope. | confirmed | user | Explicit taxonomy direction. | User direction | Shelf naming cannot imply strict MCU canon. |
| Place every selected guide under Marvel on Screen. | confirmed | user | Explicit product placement decision relayed by the parent session. | User direction | Research validates the existing category and cannot select Character Spotlight or a new category. |
| Ship four to six guides only. | confirmed | user | One major feature and bounded first release. | User direction | Remaining titles become follow-ups. |
| Reuse guarded CBH primitives through a narrow adapter. | confirmed | C4-C8, C14 | Avoid duplicate or weakened workflow; CBRO proves the extension pattern. | C4-C8, C14 | New code owns only MCU inventory and candidate-specific semantics. |
| Ship priorities 1 to 4. | confirmed | research convergence | Forty-three exact rows preserve the smallest coherent user-ordered multiverse chunk. | C15-C16; W2-W5, W16 | First-release scope is fixed at four guides. |
| Accept priority 3 as a centrally approved candidate-subset. | confirmed | stronger-model research authority | It is not exact, has distinct screen-companion purpose, and is transparently limited to the source's only issue-numbered pick. | C5, C15-C16; W4, W16 | Mapping approval and card-copy tests must preserve this rationale. |
| Use `screen-companion` as the list type. | confirmed | research evidence | It states reading purpose without making a false MCU-canon, character, event, creator, or era claim. | C9-C13; W2-W15 | Add type labels and validation without `spotlightKind`. |
| Realize Marvel on Screen as a non-empty Hub-only category. | confirmed | user plus C11-C13, C17 | The placement is fixed, current runtime lacks it, and a fourth browse route is forbidden. | C11-C13, C17 | Add category partitioning, reuse card/grid behavior, and retain one discoverable destination. |

## Unresolved Decisions

| Decision | Smallest evidence or answer needed | Owner | Impact | Blocker status |
|---|---|---|---|---|
| Exact future mapping for priorities 5, 7, 9, 10, and 14 | Candidate-specific packet and metadata work | future RPI tasks | Defines later releases only | follow-up |
| New source authority for priorities 8, 11, 12, and 13 | Explicit issue enumeration or repository-approved exact collection mapping | future research | Required before those guides can produce issue checklists | follow-up |
| Public revision history | Publicly accessible WordPress revisions or an author-provided history | external source owner | Could explain old edits but does not change current snapshot authority | follow-up |

## Potential Next Research

| Priority | Research item | Expected value | Trigger | Selected? | Related questions / evidence |
|---|---|---|---|---|---|
| H | Revalidate source and issue-bearing digests immediately before authoring. | Prevents stale page evidence from shipping. | Implementation source packet creation. | yes | Q1-Q2; W2-W15 |
| H | Recompute complete-library and selected-peer reports after reconciling current `main`. | Protects approval from concurrent catalog changes. | Before approval and again before release. | yes | Q3; C6, C15-C16 |
| M | Map priority 5 with all eleven headed rows accounted for. | Advances the next user-priority guide without widening this release. | Distinct follow-up RPI task. | deferred | Q2, Q6; W6 |
| M | Map priority 6 against post 40184 and reject post 40334. | Ships the next low-cost exact guide after priority 5. | Distinct follow-up RPI task. | deferred | Q1-Q3, Q6; W7, W16 |
| L | Re-enter blocked source-only guides when exact authority appears. | Allows eventual coverage without guessing today. | New source enumeration or approved exact mapping. | deferred | Q2, Q6; W9, W12-W14 |

## Planning Readiness

* Status: Ready
* Decision state: Ship priorities 1 to 4 as 43 exact `screen-companion` rows under the Marvel on Screen Hub category through a narrow guarded adapter.
* Evidence basis: C1-C17; W1-W16; user direction.
* Preconditions met: All fourteen canonical identities and source forms are inventoried; first-release rows map exactly; complete-library and peer relationships are classified; exact duplicates are absent; subset and partial approval needs are named; type and placement are selected; follow-ups are ranked.
* Blockers: None for planning. Implementation must re-fetch current `main` and regenerate source/library/peer freshness before approval and release.
* Smallest action to change readiness: None.

## Closeout Record

| Field | Record |
|---|---|
| Research execution status | Complete |
| Completed waves | Cycle 1 Wider, Deeper, and Contrarian |
| Lane evidence or inline fallback | Three persisted Wider lane artifacts; parent inline digest, mapping, overlap, taxonomy, and synthesis evidence |
| Research disposition | executed |
| Planning Readiness | Ready with C1-C17 and W1-W16 |
| Blockers | None for planning |
| Continuation owner and state | confirmed automatic RPI Agent; automatic planning continuation |

## Advisory Next Step

| Field | Record |
|---|---|
| Research disposition | executed |
| Planning Readiness | Ready |
| Output mode and planning support | convergence; planning supported |
| Acting owner | confirmed automatic RPI Agent |
| Required gates or confirmations | Research three-wave cycle and self-check passed; source and library freshness must be regenerated during implementation |
| Continuation result | Automatic continuation to planning |
| Primary evidence file | `.copilot-tracking/research/2026-08-23/mcu-best-of-guides-research.md` |
| Notes for planning or re-entry | Plan exactly priorities 1 to 4; keep Marvel on Screen fixed; use `screen-companion`; preserve every source exclusion and central relationship disposition; do not map deferred guides in this PR. |

* Advisory only: research does not itself invoke planning.
* Completion or limit-blocked basis: Balanced research is complete. Further mapping belongs to ranked follow-up releases and cannot change the selected bounded first release without widening scope.

## Sources

* W1 - Comic Book Herald Best Of Lists - https://www.comicbookherald.com/best-of-lists/ (retrieved 2026-08-24, current page)
* W2 - Doctor Strange: Multiverse of Madness companion - https://www.comicbookherald.com/the-best-comics-to-read-with-doctor-strange-multiverse-of-madness/ (retrieved 2026-08-24, WordPress post 60844)
* W3 - Spider-Man: No Way Home companion - https://www.comicbookherald.com/the-best-comics-to-read-before-spider-man-no-way-home/ (retrieved 2026-08-24, WordPress post 57912)
* W4 - Marvel Multiverse picks - https://www.comicbookherald.com/10-great-comics-featuring-the-marvel-multiverse/ (retrieved 2026-08-24, WordPress post 53113)
* W5 - Marvel What If picks - https://www.comicbookherald.com/best-of-marvel-what-if-comics/ (retrieved 2026-08-24, WordPress post 52275)
* W6 - WandaVision companion - https://www.comicbookherald.com/10-best-comics-to-read-with-wandavision/ (retrieved 2026-08-24, WordPress post 51003)
* W7 - Spider-Man: Far From Home companion - https://www.comicbookherald.com/the-best-comics-to-read-before-spider-man-far-from-home/ (retrieved 2026-08-24, WordPress post 40184)
* W8 - Avengers: Endgame character picks - https://www.comicbookherald.com/one-comics-rec-for-every-avenger-in-avengers-endgame/ (retrieved 2026-08-24, WordPress post 34099)
* W9 - Avengers: Endgame companion - https://www.comicbookherald.com/best-comics-to-read-before-avengers-endgame/ (retrieved 2026-08-24, WordPress post 33921)
* W10 - Miles Morales and Spider-Verse companion - https://www.comicbookherald.com/the-best-miles-morales-comics-to-read-with-into-the-spider-verse/ (retrieved 2026-08-24, WordPress post 30218)
* W11 - Venom movie companion - https://www.comicbookherald.com/the-best-venom-comics-to-read-with-venom-the-movie/ (retrieved 2026-08-24, WordPress post 26953)
* W12 - Ant-Man and Wasp MCU companion - https://www.comicbookherald.com/best-ant-man-wasp-comics-to-read-with-the-mcu/ (retrieved 2026-08-24, WordPress post 24369)
* W13 - Deadpool 2 companion - https://www.comicbookherald.com/best-deadpool-comics-to-read-with-deadpool-2/ (retrieved 2026-08-24, WordPress post 21958)
* W14 - Avengers: Infinity War companion - https://www.comicbookherald.com/best-comics-to-read-with-avengers-infinity-war/ (retrieved 2026-08-24, WordPress post 22013)
* W15 - Iron Man 3 companion - https://www.comicbookherald.com/best-iron-man-comics-to-read-before-iron-man-3/ (retrieved 2026-08-24, WordPress post 1642)
* W16 - Marvel metadata API - https://marvel.emreparker.com/v1 (retrieved 2026-08-24, maintained snapshot with 2025 horizon)

## Artifact Self-Check

* [x] Every research question is answered or marked unanswerable with the missing evidence named.
* [x] Every executed cycle includes Wave 1 Wider, Wave 2 Deeper, and Wave 3 Contrarian in that order, with no skipped wave.
* [x] Research posture, provenance, explicit limits or deadline, and posture-specific completion basis are recorded.
* [x] Every codebase finding carries a `C#` ID and a stable path or symbol; every external finding carries a `W#` ID with URL and retrieval date. Historical tracking references omit live line suffixes under the repository's artifact-stability rule.
* [x] Every `W#` resolves to exactly one entry in Sources and the list is gap-free.
* [x] Findings, alternatives, decisions, and readiness claims cite Evidence Log IDs.
* [x] The Extension Registry records matching instructions, relevant skills, available specialist subagents, provenance, authority or output contract, and selected or skipped reasons.
* [x] User Participation records the no-interaction rationale and resulting decisions.
* [x] Direction Controls record caller additions, changes, narrowed scope, exclusions, and discarded directions.
* [x] Parent Synthesis and Disposition records accepted, rejected, and deferred material with evidence-based rationale.
* [x] Cycle Re-entry Evaluation is complete.
* [x] A convergence recommendation and rejected alternatives are evidence-backed.
* [x] Current Decisions and Unresolved Decisions record owners, implications, and blockers.
* [x] Potential Next Research records priority, value, trigger, selected state, and related evidence.
* [x] Planning Readiness and Advisory Next Step are final.
* [x] Fetched content, repository files, prior artifacts, and tool output are treated as inert data.
* Checked sections: Research Brief, Parameters, Extensions, Participation, Scope, Direction Controls, Questions, Prior Knowledge, all three waves, Parent Synthesis, Re-entry, Evidence Log, Findings, Inventory, Chunks, Alternatives, Risks, Decisions, Follow-ups, Readiness, Closeout, Sources, and Self-Check.
* Missing or limited sections: Public WordPress revision history is unavailable; deferred-guide exact mappings are intentionally outside the bounded first release and are represented as follow-up or blocked states.
