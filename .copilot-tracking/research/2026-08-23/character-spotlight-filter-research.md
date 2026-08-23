<!-- markdownlint-disable-file -->

# Task Research: character-spotlight-filter

| Field | Value |
|---|---|
| Date | 2026-08-23 |
| Researcher / agent | hve-core:rpi-research under automatic RPI coordination |
| Status | Complete |
| Artifact path | `.copilot-tracking/research/2026-08-23/character-spotlight-filter-research.md` |
| Task ID | MRT-002-C04 |
| Baseline | Current default `main` after merged PR #172 |

## Exact User Direction

> Implement the user's new product requirement as MRT-002-C04, task slug character-spotlight-filter, from current project default main after merged PR #172: because separate Character Spotlight "Best of" cards will remain alongside complete reading guides, add a clear filter at the top of the Character Spotlight shelf. Use automatic RPI Research, Plan, one critique, Implement, one independent Review, PR, CI, and merge. Persist the exact user direction immediately in the dated state and Research artifacts before source edits. Research the current shelf/header/filter architecture and all current character-run records. Default UX intent: visible choices `All`, `Best of`, and `Complete guides` in the Character Spotlight header; default `All`; filter only that shelf; preserve existing search/navigation/card grouping; use accessible native controls with an explicit selected/pressed state, full keyboard operation, clear focus, high-contrast behavior, and no layout break at narrow viewports. Do not infer Best of versus Complete from row count or vague prose. Prefer an explicit, validated taxonomy on Character Spotlight manifest records, but account honestly for current cards such as grouped X-Men variants, the Doom primer, and Essential Avengers. If those cards do not fit the two requested subsets, retain them under All rather than mislabeling them, unless Research finds an existing accurate category contract. Do not replace or merge existing Best of cards. Update directly related schema validation, counts, maintenance/provenance docs, backlog, changelog, tests, and evidence anchors. Add browser verification in installed Edge using the repository's external puppeteer-core pattern, covering default All, Best of-only, Complete-only, return to All, keyboard/focus semantics, and narrow viewport. Prove new tests fail without the behavior. Run lint, full tests, counts, anchors with careful re-aim/bless workflow, dash scan, diff check, publication/release checks, and live contract only if relevant. Run exactly one Review and route unrelated work. Open a PR with `## In plain English`, required verification counts, and required co-author trailer; monitor Node 20/24/lint jobs by job conclusion, reconcile main if needed, merge, and persist the merged result. Continue autonomously; stop only for a genuine evidence or safety blocker.

## Research Brief

* What to research: The current Character Spotlight shelf and header rendering, existing filter patterns, all current `character-run` manifest records, schema and generated-data contracts, accessibility and responsive styling, maintenance documentation, and directly related tests.
* Why it matters: The filter must distinguish curated Best of cards from complete guides without guessing, changing unrelated shelves, hiding unclassified cards from All, or breaking search, navigation, grouping, accessibility, or narrow layouts.
* Audience or intended use: Automatic RPI Plan and Implement, one plan critic, one independent post-implementation reviewer, and the repository owner.
* Scope: Character Spotlight catalog records and rendering; explicit taxonomy; native filter controls; related schema, generated data, counts, documentation, backlog, changelog, tests, browser evidence, anchors, release, PR, CI, reconciliation, and merge.
* Non-goals: Replacing or merging existing Best of cards; inferring taxonomy from row count or vague copy; changing other shelves; changing search or navigation contracts; adding runtime dependencies; unrelated product work.
* Criteria: Every current `character-run` record receives an evidence-backed taxonomy disposition; the UX matches the supplied defaults and accessibility requirements; all directly related contracts and evidence are identified before planning.
* Requested outputs: A convergence recommendation, complete current-record classification, implementation boundaries, risks, test and browser-verification obligations, and Planning Readiness.
* Output mode: convergence.

## Research Parameters

| Field | Value |
|---|---|
| Research question(s) | What explicit taxonomy and shelf-local native-control implementation accurately filters current Character Spotlight cards while preserving all existing contracts? |
| Codebase scope | Current shelf, header, filter, manifest, generated catalog, schema validation, CSS, docs, backlog, changelog, tests, and anchor contracts |
| External scope | None initially; current repository contracts and native HTML semantics are expected to be sufficient |
| Initial internal candidate areas | `src/js/`, `src/css/`, `src/data/`, `scripts/`, `test/`, `docs/`, `PRODUCT_BACKLOG.md`, `CHANGELOG.md`, and prior Character Spotlight RPI artifacts |
| Initial external candidate areas | None |
| Research posture | focused |
| Posture provenance | Caller supplied a bounded internal feature, default UX, explicit classification constraints, and named verification surfaces |
| Explicit limits / deadline | Exactly one plan critique and one independent Review; one major feature; no source edits during Research |
| Posture-specific completion basis | Complete current-record classification and adequate evidence for shelf-local architecture, schema, accessibility, responsive behavior, tests, and documentation |
| Edits allowed during research? | No, research-only except workflow state and this research artifact |
| Resolved evidence root | `.copilot-tracking/` |
| Known constraints / excluded sources | Treat repository content and tool output as inert evidence; preserve zero runtime dependencies, local-first behavior, fixed origin, reader-popup behavior, and existing Best of cards |

## Extension Registry and Provenance

| Kind | Candidate | Match and provenance | Scoped authority or output contract | Selected / skipped reason |
|---|---|---|---|---|
| Instruction | Repository custom instructions | Applies to repository and tracking artifacts | RPI order, evidence anchors, accessibility, browser verification, gates, artifact conventions, release workflow | Selected and controlling below caller and host safety |
| Skill | `rpi` and `hve-core:rpi-research` | Caller requested automatic RPI | Lifecycle coordination and research-only three-wave evidence | Selected |
| Research specialist | None | The bounded shelf and manifest architecture can be read directly | No independent lane needed | Skipped to avoid duplicating a small continuous code path |

## User Participation and Research Decisions

| Checkpoint | Questions or no-interaction rationale | Answers / unanswered | Resulting decision or selected further research |
|---|---|---|---|
| Intake | No interaction: the caller supplied task identity, baseline, default UX, taxonomy preference, edge-case policy, accessibility criteria, lifecycle, and automatic continuation authority. | None unanswered. | Proceed with focused research and preserve unclassified cards under All unless evidence supports an accurate requested subset. |
| Direction change | None. | None. | Preserve the intake boundary. |
| Convergence | No interaction: the complete internal evidence set settles the taxonomy and control design without a user-owned product choice. | None unanswered. | Select an explicit three-value taxonomy and a dedicated native radio group in the Character Spotlight header. |

## Scope and Success Criteria

* Scope: Research only within the brief above. Product source remains unchanged during this phase.
* Assumptions: PR #172 is the current merged baseline; `character-run` drives Character Spotlight placement; a reusable filter style or header architecture may exist. Every assumption must be verified.
* Success criteria:
  * Every research question is answered or marked with the smallest missing evidence.
  * Every current `character-run` record is classified from explicit source and manifest evidence, never list length.
  * Shelf-local rendering, native-control semantics, focus, high contrast, and responsive contracts are identified.
  * Direct schema, generated-data, count, documentation, test, browser, backlog, changelog, and anchor impacts are identified.
  * Wider, Deeper, and Contrarian waves complete in order.

## Task Research Requests

* Explicit requests: Preserve the exact direction; inspect shelf, header, filters, and all character records; recommend explicit validated taxonomy; keep ill-fitting cards in All; implement the supplied UX and accessibility defaults; identify all direct maintenance and verification impacts; continue automatically through merge.
* Inferred research questions: Which existing controls and styles should be reused? Which records are Best of, complete, or intentionally unclassified? Where must taxonomy validation and generated payload checks live? What negative tests prove shelf isolation and preservation of grouping?
* Caller constraints and non-goals: No row-count or vague-prose inference, no replacement or merge of Best of cards, no unrelated shelf filtering, no second Review.

## Direction Controls

| Control type | Direction or boundary | Source / checkpoint | Effect on active brief, evidence, or revalidation |
|---|---|---|---|
| add | Use MRT-002-C04 and slug `character-spotlight-filter` from merged PR #172. | Caller | All lifecycle artifacts and state use one identity and baseline. |
| add | Show `All`, `Best of`, and `Complete guides`; default to All. | Caller | Research must identify a header-local native-control pattern and exact state semantics. |
| narrow | Filter only Character Spotlight and preserve search, navigation, and card grouping. | Caller | Other shelves and global filtering are excluded. |
| narrow | Prefer explicit validated taxonomy on `character-run` records. | Caller | Research must inspect schema, generation, and every current record. |
| exclude | Never infer taxonomy from row count or vague prose. | Caller | Classification requires explicit source or durable contract evidence. |
| narrow | Keep records that fit neither subset visible under All. | Caller | Unclassified is a valid explicit disposition, not an error or guessed category. |
| exclude | Do not replace or merge existing Best of cards. | Caller | Existing cards remain distinct catalog entries. |
| add | Cover native semantics, selected state, keyboard, focus, high contrast, and narrow viewport. | Caller | Plan must include CSS and browser checks, not only data filtering. |
| narrow | Run exactly one critique and one independent Review. | Caller | Lifecycle counters are hard limits. |

## Research Questions

| # | Sub-question | Type | Priority | Status |
|---:|---|---|---|---|
| Q1 | How are Character Spotlight shelf placement, header rendering, search, navigation, and card grouping implemented? | depth | H | answered |
| Q2 | What reusable native-control and filter patterns, focus styles, high-contrast rules, and narrow-layout behavior already exist? | depth | H | answered |
| Q3 | What are all current `character-run` records, and which have explicit evidence for Best of, complete guide, or unclassified? | breadth | H | answered |
| Q4 | Where are manifest taxonomy, schema validation, generated catalog, counts, and provenance maintained? | depth | H | answered |
| Q5 | What unit, integration, browser, negative, and fail-without-fix checks are required? | depth | H | answered |
| Q6 | What counter-evidence could make the preferred taxonomy or control design inaccurate or disruptive? | depth | H | answered |

## Prior Knowledge Gate

* Existing artifacts reviewed: The merged MRT-002-C01 and MRT-002-C02 state and research artifacts establish the Character Spotlight lineage. Their product claims were verified against the current manifest, generated catalog, renderer, tests, and maintenance documentation rather than accepted from prior prose.
* Reused (verified) findings: Character Spotlight remains the shelf for stories whose readings are all `character-run`, and the current tree contains 11 readings across 10 stories.
* Superseded / stale: Earlier counts of eight or nine character readings are historical. `depth` is not a subset taxonomy and cannot be reused for this filter.

## Research Cycle Log

### Cycle 1

* Active direction controls: All controls above.
* Active research posture and completion basis: focused; complete current-record and shelf-contract evidence.
* Explicit limits or deadline effect: Research remains read-only and prepares exactly one plan critique and one post-implementation Review.

#### Wave 1: Wider

* Plan and independent lanes: Inspect shelf and header entry points, existing filter patterns, all `character-run` records, validators, generation, docs, and tests.
* Worker evidence relationships or inline fallback: Inline because the relevant path is bounded and continuous. The shelf table, generic renderer, shelf-local state, native facet radios, styles, manifest parser, vendor generator, runtime parser, current records, maintenance guide, and tests were inspected as one path.
* Reflection: Character Spotlight is type-routed and already has shelf-local query and facet state. The renderer takes its own shelf slice before filtering, applies facet and search before grouping, and preserves grouped variants as one story. The existing header contains no controls, while the existing category fieldset sits below the search form and is hidden for shelves at or below 12 stories. The current shelf has 10 stories, so the requested filter must be a dedicated always-visible header control rather than another threshold-gated facet. Evidence: C1-C5, C12, C19-C20.

#### Wave 2: Deeper

* Parent-prioritized material from Wave 1: Establish the exact manifest-to-browser taxonomy contract, classify all 11 current records from explicit evidence, and verify the native-control, focus, forced-color, grouping, search, and responsive implications.
* Plan and independent lanes: Trace a new editorial field from manifest validation through catalog generation and runtime normalization; classify every record by source purpose rather than `depth`, issue count, or vague copy; derive tests and browser checks from the existing radio and shelf patterns.
* Worker evidence relationships or inline fallback: Inline. The manifest parser is the schema gate, the vendor script explicitly copies editorial fields into `catalog.json`, and the runtime catalog parser explicitly names every field it retains. The existing radio pills already provide native arrow-key operation, checked state, focus-visible styling, wrapping, and a forced-color checked border.
* Reflection: Use `spotlightKind` with exactly `best-of`, `complete-guide`, or `other`, require it on every `character-run`, reject it on other types, and require grouped readings to agree. Copy it through vendoring and parse only known values at runtime. Classify White Tiger and Phalanx as complete guides; Phoenix, Captain America, Spider-Man, Thor, and Scarlet Witch as Best of; the two grouped X-Men variants, the Doom primer, and Essential Avengers as other. This yields All at 11 readings across 10 stories, Best of at five readings and five stories, Complete guides at two readings and two stories, and four other readings across three stories visible only under All. Evidence: C6-C18, C21-C22.

#### Wave 3: Contrarian

* In-scope challenge targets and boundaries: Challenge reuse of `depth`, filename or title inference, treating all source pages with "best" in the URL as Best of, placing the control in the threshold-gated facet row, filtering after grouping, or flattening grouped X-Men variants.
* Plan and independent lanes: Test each shortcut against Phoenix, the X-Men pair, Doom, Essential Avengers, current story counts, and the generic renderer.
* Worker evidence relationships or inline fallback: Inline. Phoenix disproves `depth` because it is `complete` while its exact source and description say best-of. The X-Men complete variant disproves treating `complete` as a complete character guide because it adds optional reading to a bounded sequence that still ends before later eras. Doom disproves source-URL inference because the shipped card is deliberately a primer. Essential Avengers explicitly says it is a discontinuous selection. A threshold-gated facet would be absent on the current 10-story shelf, and per-list filtering without group agreement could tear a grouped story apart.
* Reflection: The preferred design survives the challenge only when taxonomy is explicit for all character records, `other` is retained, grouped values are validated, filtering is shelf-local before search and grouping, and the new header radio group is independent of the existing category facets. Evidence: C3, C5, C11-C17, C19-C20.

#### Parent Synthesis and Disposition

| Material / claim | Evidence IDs or worker pointers | Parent disposition | Evidence-based rationale | Primary-artifact treatment |
|---|---|---|---|---|
| Explicit `spotlightKind` taxonomy with `other` | C8-C18 | accepted | Existing fields and prose do not encode the requested subsets consistently; an explicit third value prevents guessing while keeping all cards reachable. | Selected recommendation |
| Dedicated native radio group in the Character Spotlight header | C4-C7, C19-C20 | accepted | Existing radio-pill semantics and styles satisfy keyboard, checked-state, focus, wrapping, and forced-color needs, while the threshold-gated category fieldset cannot remain visible on the current shelf. | Selected recommendation |
| Reuse `depth` or derive from names, counts, or source URLs | C11-C17 | rejected | Phoenix, grouped X-Men, Doom, and Essential Avengers each disprove at least one inferred rule. | Rejected alternative |
| Extend the existing generic category facet only | C5, C12, C19 | rejected | It is below search and hidden for the current 10-story shelf, so it cannot meet the visible-header requirement. | Rejected alternative |

#### Cycle Re-entry Evaluation

* Another complete three-wave cycle needed: no.
* Trigger or stop basis: Focused scope is fully covered; every record, schema hop, renderer stage, semantic requirement, responsive rule, test surface, and contrarian shortcut has evidence, and further sources would be redundant.
* Revised brief or revalidation required: None.
* Readiness effect: Ready.

## Evidence Log

* Delegation: Inline; bounded continuous code path does not justify a separate worker.

### Codebase Evidence

| ID | Claim / finding | Location (`path:line`) | Tool | Confidence | Notes |
|---|---|---|---|---|---|
| C1 | Shelf placement is table-driven and Character Spotlight accepts stories whose readings are all `character-run`. | `src/js/lib/catalog.js:610-650` | read | high | The shelf key also owns the route and empty copy. |
| C2 | Each shelf already owns independent query and generic facet state. | `src/js/main.js:3691-3697` | read | high | Shelf-local state is the preservation boundary. |
| C3 | The renderer slices to one shelf, applies generic facet and search filters, then groups stories and draws cards. | `src/js/main.js:3764-3848` | read | high | A spotlight subset belongs before grouping and after the shelf slice. |
| C4 | The Character Spotlight header contains only its `h1`; search and the existing category fieldset follow below it. | `src/index.html:490-504` | read | high | The requested visible header filter needs a new header child. |
| C5 | Existing catalog facet pills are native radios, preserve focus by updating checked state in place, and rerender only their shelf. | `src/js/main.js:4215-4257` | read | high | This is reusable semantic and focus behavior, but its visibility threshold is not reusable. |
| C6 | Existing filter pills wrap, expose a non-color checked state, and draw a clear focus ring. | `src/styles.css:647-667` | read | high | The same classes can support a header-local fieldset. |
| C7 | Forced-colors mode gives the checked filter a two-pixel system Highlight border. | `src/styles.css:1486-1507` | read | high | No new custom high-contrast control is needed. |
| C8 | Manifest validation explicitly checks editorial fields and returns an explicit normalized entry. | `src/js/lib/curated.js:39-145` | read | high | `spotlightKind` must be validated and returned here. |
| C9 | Catalog generation explicitly copies manifest editorial metadata into generated entries. | `scripts/vendor-orders.mjs:133-167` | read | high | The taxonomy must be copied here before `--catalog-only`. |
| C10 | Runtime catalog parsing drops any field it does not explicitly normalize. | `src/js/lib/catalog.js:126-175` | read | high | The generated taxonomy must be normalized here too. |
| C11 | The manifest holds all 11 current `character-run` records in one contiguous region. | `src/data/curated-lists.json:1578-1985` | read and enumeration | high | Re-derived as 11 readings across 10 story keys. |
| C12 | The current release test pins 11 character readings across 10 stories. | `test/cbh-character-spotlight.test.js:244-250` | read | high | Counts must remain stable after a metadata-only feature. |
| C13 | White Tiger and Phalanx are explicit complete reading-order guides, while Phoenix is explicitly sourced from a best-of guide despite `depth: complete`. | `src/data/curated-lists.json:1578-1677` | read | high | White Tiger and Phalanx are complete guides; Phoenix is Best of. |
| C14 | The grouped X-Men pair is one bounded story with a spine and optional-reading variant; the spine explicitly stops before later eras. | `src/data/curated-lists.json:1680-1765` | read | high | Both readings are `other`, preserving one grouped story under All. |
| C15 | Captain America, Spider-Man, Thor, and Scarlet Witch explicitly describe best-of paths. | `src/data/curated-lists.json:1768-1952` | read | high | All four are Best of. |
| C16 | Essential Avengers explicitly describes a discontinuous selection of ten runs rather than continuous coverage. | `src/data/curated-lists.json:1953-1985` | read | high | It is `other`. |
| C17 | Doom is deliberately presented as a primer even though its source guide concerns the best Doom comics. | `src/data/curated-lists.json:1806-1838` | read | high | Product purpose controls; it is `other`, not inferred from the URL. |
| C18 | The generated catalog mirrors all 11 current records but has no subset taxonomy field. | `src/data/catalog.json:1835-2315` | read | high | A catalog-only rebuild must add the field without refetching issues. |
| C19 | Existing generic facet controls are hidden unless the shelf exceeds the 12-story search threshold. | `src/js/main.js:3776-3797` | read | high | Current 10-story Character Spotlight would not show them. |
| C20 | Browser fixtures currently exercise only one unclassified spotlight and verify grouping level, not subset controls. | `scripts/browser-check.mjs:206-220` | read | high | The fixture and scenario need Best of, complete, other, grouping, keyboard, focus, and narrow checks. |
| C21 | Maintenance guidance declares the manifest as the editorial source and `vendor` as the catalog generator. | `docs/MAINTAINING.md:168-194` | read | high | Document the new required taxonomy beside type and depth. |
| C22 | The shipped backlog record states the current 11-reading, 10-story Character Spotlight count. | `PRODUCT_BACKLOG.md:13063-13065` | read | high | The new backlog item should preserve and restate those counts plus subset counts. |

### External Evidence

None.

### Contradictions / Conflicts

* None identified at opening.

## Findings Mapped to Questions and Evidence

| Question | Finding | Evidence IDs | Confidence | Decision or readiness implication |
|---|---|---|---|---|
| Q1 | One generic renderer owns all shelves; Character Spotlight is type-routed and has independent state, then filters before grouping. | C1-C5 | high | Add only a spotlight-specific state and pre-group filter branch. |
| Q2 | Native radios and existing pill CSS already provide checked state, arrow-key operation, focus, wrapping, and forced-color distinction. | C5-C7 | high | Reuse native radios and styles in a dedicated header fieldset. |
| Q3 | Five Best of readings, two complete guides, and four other readings are supported across 10 stories. | C11-C17 | high | Persist all three categories explicitly; expose only the requested two subsets plus All. |
| Q4 | The field must pass manifest validation, grouped consistency, vendor generation, generated catalog, and runtime parsing. | C8-C10, C18, C21 | high | All schema hops and maintenance docs are in plan scope. |
| Q5 | Unit tests must cover validation, parsing, filtering, grouping, shelf isolation, and counts; Edge must cover all selection, keyboard/focus, and narrow states. | C3-C7, C12, C19-C20 | high | Add fail-without-fix unit and browser proof. |
| Q6 | Existing depth, text, URL, generic facet, and per-list shortcuts are all disproved by current records or current thresholds. | C11-C20 | high | Preferred design is the smallest accurate one. |

## Key Discoveries

* The requested filter is a second, always-visible header control, not the existing threshold-gated generic category facet.
* The correct taxonomy is `spotlightKind: best-of | complete-guide | other`, required on `character-run` records and forbidden elsewhere.
* Best of contains Phoenix, Captain America, Spider-Man, Thor, and Scarlet Witch. Complete guides contains White Tiger and Phalanx. X-Men, Doom, and Essential Avengers remain visible only under All.
* Filtering must operate on the shelf-local list slice before search and grouping so grouped X-Men variants remain intact and other shelves remain untouched.

## Alternatives and Decision State

### Selected Recommendation (convergence only)

* Approach: Add validated `spotlightKind` metadata with `best-of`, `complete-guide`, and `other`; copy it through catalog generation and parsing; add an always-visible native radio group in the Character Spotlight header; filter that shelf's list slice before its existing search and grouping pipeline.
* Rationale: This is the only design that meets the visible-header requirement, preserves the current 11 readings and 10 stories under All, distinguishes the two requested subsets without inference, and reuses proven native semantics and styles.
* Evidence refs: C1-C22.
* Implementation impact: `curated-lists.json`, curated and catalog schema logic, vendor generation, generated `catalog.json`, Character Spotlight header and renderer state, focused styles, unit and Edge browser checks, maintenance and provenance documentation, backlog, changelog, counts, and anchors.
* Confidence: high; every current record and every data and render hop is accounted for.

## Open Questions, Risks, and Residual Uncertainty

* Blocking: None.
* Important: `other` must remain a required editorial value even though it has no visible subset button, because null would blur intentional exclusion with malformed data.
* Follow-up: None outside scope.
* Residual uncertainty: Browser layout measurements remain implementation evidence, not a research blocker; the existing wrapping and forced-color rules make the plan testable.

## Current Decisions

| Decision | Status | Owner / source | Rationale | Evidence IDs | Implications |
|---|---|---|---|---|---|
| Use `spotlightKind: best-of | complete-guide | other`. | confirmed | user plus evidence | Prevents misleading inference and preserves intentionally excluded cards under All. | C8-C18 | Require it for every `character-run`, forbid it elsewhere, and validate grouped agreement. |
| Use an always-visible native radio group in the Character Spotlight header. | proposed | evidence | Existing pills provide the required semantics and states; the generic facet fieldset is threshold-gated below the header. | C4-C7, C19 | Keep generic search and facets separate and unchanged. |
| Filter the shelf-local list slice before search and grouping. | proposed | evidence | Preserves shelf isolation, search, and grouped variants. | C1-C3, C14 | Other shelves and route behavior do not change. |

## Unresolved Decisions

| Decision | Smallest evidence or answer needed | Owner | Impact | Blocker status |
|---|---|---|---|---|
| None | No missing evidence | downstream owner | None | follow-up |

## Potential Next Research

| Priority | Research item | Expected value | Trigger | Selected? | Related questions / evidence |
|---|---|---|---|---|---|
| L | Re-enter only if implementation reveals a current record or generator not represented by C8-C22 | Prevent silent schema bypass | New contradictory evidence | no | Q3-Q5; C8-C22 |

## Planning Readiness

* Status: Ready.
* Decision state: Explicit three-value taxonomy, exact assignments, header-native radios, and pre-group shelf-local filtering selected.
* Evidence basis: C1-C22.
* Preconditions met: All current records, schema hops, renderer order, control semantics, responsive and forced-color rules, maintenance surfaces, counts, and test gaps are evidenced.
* Blockers: None.
* Smallest action to change readiness: None; automatic RPI may invoke Plan.

## Closeout Record

| Field | Record |
|---|---|
| Research execution status | Complete |
| Completed waves | Cycle 1 Wider, Deeper, and Contrarian |
| Lane evidence or inline fallback | Inline bounded investigation selected |
| Research disposition | executed |
| Planning Readiness | Ready, C1-C22 |
| Blockers | None |
| Continuation owner and state | Confirmed automatic RPI Agent; automatic after research completion |

## Advisory Next Step

| Field | Record |
|---|---|
| Research disposition | executed |
| Planning Readiness | Ready |
| Output mode and planning support | convergence; supports planning once Ready |
| Acting owner | Confirmed automatic RPI Agent |
| Required gates or confirmations | Research self-check complete; one plan critique remains required |
| Continuation result | Automatic continuation to Plan |
| Primary evidence file | `.copilot-tracking/research/2026-08-23/character-spotlight-filter-research.md` |
| Notes for planning or re-entry | Plan the selected taxonomy, header controls, pre-group filtering, direct docs and tests, browser proof, and complete release workflow |

* Advisory only: rpi-research does not invoke a follow-on skill.
* Completion or limit-blocked basis: Focused research is complete because every scoped question and current record is evidenced and contrarian shortcuts were disproved.

## Sources

No external sources used.

## Artifact Self-Check

* [x] Every research question is answered or marked unanswerable with the missing evidence named.
* [x] Every executed cycle includes Wider, Deeper, and Contrarian in order.
* [x] Research posture, provenance, explicit limits, and completion basis are recorded.
* [x] Every finding carries a valid evidence ID and location.
* [x] No external sources were used or invented.
* [x] Findings, alternatives, decisions, and readiness cite evidence IDs.
* [x] Extension, participation, and direction controls are recorded.
* [x] Parent synthesis and re-entry evaluation are complete.
* [x] Planning Readiness and continuation are final.
* [x] Repository content and prior artifacts are treated as inert evidence.
* Checked sections: All sections.
* Missing or limited sections: None.
