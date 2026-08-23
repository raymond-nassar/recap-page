<!-- markdownlint-disable-file -->

# Task Research: reading-list-expansion

| Field              | Value                                                                    |
|--------------------|--------------------------------------------------------------------------|
| Date               | 2026-08-22                                                               |
| Researcher / agent | RPI Agent using rpi-research                                             |
| Status             | Complete                                                                 |
| Artifact path      | .copilot-tracking/research/2026-08-22/reading-list-expansion-research.md |

## Research Brief

* What to research: The most efficient repeatable way to add more reading lists from Comic Book Herald's complete Marvel reading-order guide, divide the work into bounded list chunks suitable for lower-cost models, and check every candidate against the app's current library.
* Why it matters: Future list additions should scale without duplicate catalog entries, inconsistent provenance, or each worker having to rediscover the repository's data contract.
* Audience or intended use: The repository owner and later planning and implementation agents.
* Scope: The current catalog and order-source files, existing Comic Book Herald-derived orders, import and validation tooling, relevant product backlog records, and the linked Comic Book Herald guide and its child guides.
* Non-goals: Adding lists, changing product code, scraping Marvel properties, introducing runtime dependencies, or selecting lists solely by popularity without checking overlap and data quality.
* Criteria: Evidence-backed current-library inventory; a source decomposition that respects guide boundaries; deterministic overlap checks; chunk inputs, outputs, gates, and dependency ordering that a lower-cost model can follow; and a planning-ready recommendation.
* Requested outputs: A selected workflow, a ranked chunking strategy, a current-library overlap check, risks, and planning readiness.
* Output mode: convergence

## Research Parameters

| Field                            | Value |
|----------------------------------|-------|
| Research question(s)             | How should Comic Book Herald's complete guide be converted into implementation chunks that are efficient, independently verifiable, and checked against the app's existing library? |
| Codebase scope                   | `src/data/`, catalog validation and generation scripts, related tests, `PRODUCT_BACKLOG.md`, and the original MRT-001 research and plan |
| External scope                   | `comicbookherald.com/the-complete-marvel-reading-order-guide/` and linked guide pages needed to understand hierarchy and list boundaries |
| Initial internal candidate areas | `src/data/catalog.json`, `src/data/curated-lists.json`, `src/data/orders/`, data scripts and tests, BL-142 and related shipped backlog records |
| Initial external candidate areas | Comic Book Herald's complete Marvel reading-order guide and its directly linked era, event, character, and collected-edition guides |
| Research posture                 | balanced |
| Posture provenance               | default |
| Explicit limits / deadline       | Research is read-only; no source changes; use the current app library as the duplication baseline |
| Posture-specific completion basis | Balanced scope coverage and adequate evidence for a repeatable workflow and planning chunks |
| Edits allowed during research?   | no, research-only |
| Resolved evidence root           | `.copilot-tracking/` |
| Known constraints / excluded sources | No comic image storage, no Marvel scraping, no runtime dependencies, one major product feature per pull request, and no implementation during research |

## Extension Registry and Provenance

* Precedence: platform and host safety; caller scope and criteria; matching repository instructions and enforced schemas; rpi-research contract; domain skills and specialists; examples and preferences.

| Kind                | Candidate | Match and provenance | Scoped authority or output contract | Selected / skipped reason |
|---------------------|-----------|----------------------|-------------------------------------|---------------------------|
| Instruction | `.github/copilot-instructions.md` | Applies repository-wide and to the evidence path | Requires RPI evidence, current-library grounding, three research waves, durable artifacts, and source-safe constraints | Selected |
| Skill | `hve-core:rpi-research` | Direct match for evidence gathering before planning | Owns research artifact, evidence synthesis, recommendation, and planning readiness | Selected |
| Research specialist | none | The current repository and one named source are bounded enough for direct investigation | No worker output needed | Skipped because the coupled source-to-catalog comparison is more reliable inline |

## User Participation and Research Decisions

| Checkpoint       | Questions or no-interaction rationale | Answers / unanswered | Resulting decision or selected further research |
|------------------|---------------------------------------|----------------------|--------------------------------------------------|
| Intake           | The user named the source, required lower-cost-model chunks, and required a current-library check, so no intake question would change the research boundary. | No unanswered intake question | Use the current catalog as the baseline and converge on a repeatable source-to-order workflow. |
| Direction change | No material direction change yet. | Not applicable | Keep the opening brief. |
| Convergence      | Existing evidence and current source sampling were sufficient to choose a workflow without asking the user to adjudicate individual lists. | No unanswered convergence question | Finish the maintained modern Earth-616 queue first, using one-list worker packets grouped into small integration chunks, then inventory character and team guides as a separate program. |

## Scope and Success Criteria

* Scope: Source hierarchy, current-library coverage, existing data and provenance contracts, validation surfaces, chunk boundaries, and worker handoff design.
* Assumptions: Existing Comic Book Herald orders may supply reusable conventions; source-page headings may not map one-to-one to importable lists; filename and catalog presence alone may not prove issue-level uniqueness.
* Success criteria:
  * Every research question is answered or marked unanswerable with the missing evidence named.
  * Evidence is grounded in actual code, docs, or tooling results, with locations (`path:line` for code, URL plus retrieval date for external).
  * Findings, decisions, and readiness claims cite Evidence Log IDs.
  * Alternatives are compared with trade-offs.
  * Open questions, risks, and residual uncertainty are recorded.
  * Self-check passes.

## Task Research Requests

* Explicit requests: Find the most efficient way to add more lists from the complete Comic Book Herald guide; organize implementation into reading-list chunks suitable for lower-cost models; check candidates against the app's current library.
* Inferred research questions: Which source guides are already represented, what list size and complexity make a safe chunk, what deterministic preflight should reject duplicates, and which work should remain centralized instead of delegated?
* Caller constraints and non-goals: Research and plan only at this stage; current-library comparison is mandatory.

## Direction Controls

| Control type (add / change / narrow / exclude / discard) | Direction or boundary | Source / checkpoint | Effect on active brief, evidence, or revalidation |
|----------------------------------------------------------|-----------------------|---------------------|---------------------------------------------------|
| add | Include a check against the app's current library | User intake | Requires both catalog-level and issue-level overlap analysis before chunk selection |
| add | Make implementation chunks executable by lower-cost models | User intake | Requires explicit bounded inputs, outputs, gates, and escalation rules |
| narrow | Use Comic Book Herald's complete Marvel guide as the source hierarchy | User intake | External research stays on the named guide and directly linked guide pages |
| exclude | Do not implement lists during research | RPI research contract | Source files remain unchanged |

## Research Questions

|  # | Sub-question | Type (depth / breadth / straightforward) | Priority | Status |
|---:|--------------|------------------------------------------|----------|--------|
| Q1 | What reading lists and Comic Book Herald sources are already represented in the app? | breadth | H | answered |
| Q2 | How does the current data, provenance, and validation pipeline define a correct new list? | depth | H | answered |
| Q3 | How is the complete guide structured, and which linked guides are viable independent list candidates? | breadth | H | answered |
| Q4 | What deterministic comparison against the current library should run before a candidate becomes a chunk? | depth | H | answered |
| Q5 | What chunk size, worker contract, sequencing, and escalation rules make lower-cost-model implementation reliable? | depth | H | answered |
| Q6 | What evidence could disprove the preferred chunking approach? | depth | M | answered |

## Prior Knowledge Gate

* Existing artifacts reviewed: Original MRT-001 research and plan; repository instructions; current backlog search results.
* Reused (verified) findings: The app is deliberately a local browser companion; curated orders are vendored and offline; Comic Book Herald is an established source; authoring curation from scratch remains out of scope.
* Superseded / stale: The original plan described only two bundled Hickman lists; the current tree contains substantially more order data and requires a fresh inventory.

## Research Cycle Log

### Cycle 1

* Active direction controls: all intake controls above.
* Active research posture and completion basis: balanced; adequate internal and external evidence for a repeatable workflow and chunk plan.
* Explicit limits or deadline effect: Research remains read-only and limited to the named source hierarchy.

#### Wave 1: Wider

* Plan and independent lanes: Inventory current lists and source provenance; locate generation and validation contracts; map the complete guide's hierarchy and candidate linked guides.
* Worker evidence relationships or inline fallback: Inline because source hierarchy, catalog overlap, and repository contracts must be reconciled together.
* Reflection: The app currently exposes 66 lists, including 52 derived from Comic Book Herald, and 2,787 distinct issue ids. The maintained modern Earth-616 inventory already covers 86 source records and has 22 pending new-order candidates after four shipped production packets. Twelve additional Comic Book Herald-derived character, team, and best-of lists sit outside that modern inventory. The immediate efficiency gain is to finish the maintained queue before opening a second large inventory. Evidence: C1-C3, W1.

#### Wave 2: Deeper

* Parent-prioritized material from Wave 1: The remaining queue, current-library duplicate and overlap behavior, source-page complexity, and hard-coded batch integration.
* Plan and independent lanes: Inspect the existing packet tools and validation contracts; sample compact and complex pending guides; derive a model handoff that keeps editorial decisions out of low-cost implementation tasks.
* Worker evidence relationships or inline fallback: Inline inspection and direct source retrieval. Existing research and the completed four-packet review were reused only after current repository checks confirmed their contracts.
* Reflection: The existing tooling already performs deterministic resolution, all-library overlap reporting, source identity validation, authoring, and vendoring. Its main scaling defect is that packet membership, insertion anchors, source rows, and the CLI default are hard-coded across a 3,027-line preparation script and a packet-specific author. Source sampling confirms large variance: Generations has a flat 10-issue list; X-Men Extermination has a 9-item event sequence plus separate recommendations; Spider-Geddon has a clear 25-item order; Age of X-Man has a clear 32-item order; Iron Man 2020 has an 18-item order; Hunt for Wolverine and Secret Empire mix several optional or contextual sections. Evidence: C4-C6, C10-C12, W2-W8.

#### Wave 3: Contrarian

* In-scope challenge targets and boundaries: Challenge ten-list-per-model packets, strict source chronology, blanket zero-overlap rejection, and immediate expansion into character guides.
* Plan and independent lanes: Compare the current catalog's intentional overlaps with the packet author gate; test whether chronological queue order correlates with source complexity; examine shared-file conflicts and the metadata horizon.
* Worker evidence relationships or inline fallback: Inline comparison of current generated orders, inventory states, source samples, and packet code.
* Reflection: One low-cost model should not own ten heterogeneous guides or edit the central manifest in parallel with peers. Chronology does not predict complexity: Secret Empire precedes much smaller, cleaner guides. Blanket zero overlap is also too strong as a product rule because the current library has 15 overlapping pairs, including explicit full and essential variants, while the comparison utility already distinguishes exact, subset, and partial relationships. The safe design is one mapping packet per worker, a central integrator for shared files, and escalation for any partial or subset overlap not already approved. Character guides should remain a second queue because 12 are already shipped outside the modern inventory and their overlap shape differs from event guides. Evidence: C1-C3, C5-C8, W2-W8.

#### Parent Synthesis and Disposition

| Material / claim | Evidence IDs or worker pointers | Parent disposition (accepted / rejected / deferred) | Evidence-based rationale | Primary-artifact treatment |
|------------------|---------------------------------|-----------------------------------------------------|--------------------------|----------------------------|
| Finish the 22-record pending modern queue before opening a new guide family | C1-C3, W1 | accepted | It reuses the maintained inventory and completed production pipeline while avoiding a second broad discovery program | Program sequencing |
| Give each low-cost worker exactly one frozen list packet | C4-C6, C8, W2-W8 | accepted | Source pages vary too much for a ten-guide context, and one-list artifacts avoid shared-file conflicts | Worker contract |
| Group worker outputs into two or three-list integration chunks | C1-C6, C10-C12 | accepted | Small chunks amortize review and vendoring without asking one model to hold several source interpretations | Delivery structure |
| Treat every nonzero overlap as a permanent blocker | C5-C7 | rejected | The current catalog intentionally contains 15 overlapping pairs, and the overlap utility can distinguish exact, subset, and partial relationships | Adjudication gate |
| Expand character and team guides in parallel with the modern queue | C1-C3, W1 | deferred | The existing queue is already maintained, while character guides need a new inventory and different overlap analysis | Later program |

#### Cycle Re-entry Evaluation

* Another complete three-wave cycle needed: no.
* Trigger or stop basis: Current-library coverage, open inventory, tool contracts, source complexity, overlap counter-evidence, and worker boundaries are adequately evidenced. Deeper per-list extraction belongs to implementation preflight.
* Revised brief or revalidation required: none.
* Readiness effect: Ready.

## Evidence Log

* Delegation: inline; direct investigation is proportionate and keeps source-to-catalog comparisons in one evidence chain.

### Codebase Evidence

| ID | Claim / finding | Location (`path:line`) | Tool | Confidence | Notes |
|----|-----------------|------------------------|------|------------|-------|
| C1 | The current app library contains 66 catalog lists and 2,787 distinct issue ids; 52 lists and 1,895 distinct issue ids come from Comic Book Herald-derived orders. | `src/data/curated-lists.json:1-2243`; `src/data/catalog.json:1-2637` | derived aggregate over manifest and generated payloads | high | Recomputed on 2026-08-22; catalog and manifest both contained 66 entries. |
| C2 | The maintained modern Earth-616 inventory has 86 source records: 48 marked new-order, 23 shipped records, 22 pending candidates, and 12 blocked candidates. | `scripts/data/cbh-modern-inventory.json:1-1289`; `test/cbh-modern-inventory.test.js:12-55` | read and derived aggregate | high | The 23 shipped inventory records map to 40 catalog lists because several source pages were split into approved guide sections. |
| C3 | Twelve Comic Book Herald-derived character, team, and best-of catalog lists are outside the modern inventory. | `src/data/curated-lists.json:582-1599` | manifest comparison against inventory catalog ids | high | Six are character best-of or primer lists and six are sections of the Avengers guide. |
| C4 | The maintained workflow already requires source snapshot, normalized extraction, exact resolution, discrepancy review, all-library overlap, approved mapping, authoring, vendoring, and targeted validation. | `docs/MAINTAINING.md:212-271` | read | high | This is the foundation to reuse rather than replace. |
| C5 | The overlap report compares a candidate against every current manifest order and optional packet peers, and classifies exact, candidate-subset, existing-subset, partial, or none. | `scripts/report-order-overlap.mjs:99-117`; `scripts/lib/cbh-overlap.mjs:29-55` | read | high | It is already the correct current-library comparison primitive. |
| C6 | Packet authoring remains batch-specific: packet ids and chronology anchors are constants, the CLI always authors the fourth packet, and every nonzero overlap is rejected. | `scripts/author-cbh-packet.mjs:95-142`; `scripts/author-cbh-packet.mjs:236-267`; `scripts/author-cbh-packet.mjs:285-347` | read | high | This is the principal scaling and cheap-model-context bottleneck. |
| C7 | The current library contains 15 intentional overlapping list pairs, led by full/essential or alternate presentation variants. | `src/data/curated-lists.json:1-2243`; generated payloads under `src/data/` | derived pairwise issue-id comparison | high | Blanket zero overlap is not a valid catalog-wide rule. |
| C8 | The prior approved lower-capability contract already says workers must stop on ambiguity or unapproved overlap and may not choose editorial fields or exceptions. | `.copilot-tracking/plans/2026-08-20/modern-marvel-continuity-guides-plan.md`, Lower-capability implementation contract | read | high | Stable section reference used for the historical tracking artifact. |
| C9 | Comic Book Herald approved continued use under the existing credit-and-link pattern, without granting a broader license. | `docs/DATA_PROVENANCE.md:316-334` | read | high | Exact card credit and source link remain mandatory. |
| C10 | Package scripts already expose preparation, resolution, overlap, and vendoring commands without runtime dependencies. | `package.json:14-16`; `package.json:24-25` | read | high | A generic queue/status wrapper can stay build-time only. |
| C11 | The preparation script is 3,027 lines and embeds reviewed series identities, source rows, and manifest proposals directly in code. | `scripts/prepare-cbh-batch.mjs:15-220`; `scripts/prepare-cbh-batch.mjs:2922-3017` | read | high | Moving per-list input to bounded data packets would reduce model context and central-file conflicts. |
| C12 | Source identity and duplicate validation already reject duplicate ids, source page and section identities, exact issue sequences, and catalog ids. | `scripts/lib/cbh-inventory.mjs:31-75`; `scripts/lib/cbh-inventory.mjs:84-140` | read | high | The planned current-library preflight can compose these existing guards. |

### External Evidence

| ID | Claim / finding | Source (title) | URL | Retrieved | Version/date | Confidence |
|----|-----------------|----------------|-----|-----------|--------------|------------|
| W1 | The master page separates fast tracks, modern Earth-616 continuity, alternate universes, and a large character/team guide index; it is actively updated through 2026. | The Complete Marvel Reading Order Guide | https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/ | 2026-08-22 | page current at retrieval | high |
| W2 | Generations exposes a flat, explicit 10-issue issue-by-issue order. | Marvel Generations Reading Order | https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/marvel-generations/ | 2026-08-22 | page current at retrieval | high |
| W3 | X-Men Extermination separates five post-credit recommendations from a 9-item event and epilogue sequence, so its event boundary can be frozen mechanically after one explicit scope approval. | X-Men Extermination Reading Order | https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/marvel-fresh-start-reading-order/x-men-extermination/ | 2026-08-22 | page current at retrieval | high |
| W4 | Hunt for Wolverine mixes collected editions, post-credit teasers, the Hunt event, and Return of Wolverine, making it a poor first task for a low-cost model without a frozen section boundary. | Hunt for Wolverine Reading Order | https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/the-hunt-for-wolverine/ | 2026-08-22 | page current at retrieval | high |
| W5 | Secret Empire mixes a long road-to section, optional recommendations, prior events, and the event order, making chronology alone a poor complexity heuristic. | Secret Empire Reading Order | https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/secret-empire/ | 2026-08-22 | page current at retrieval | high |
| W6 | Spider-Geddon has a compact explicit 25-item order after separate collected-edition material. | Spider-Geddon Reading Order | https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/marvel-fresh-start-reading-order/spidergeddon/ | 2026-08-22 | page current at retrieval | high |
| W7 | Age of X-Man has a compact explicit 32-item checklist composed of Alpha, six five-issue miniseries, and Omega. | Age of X-Man Reading Order | https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/marvel-fresh-start-reading-order/age-of-x-man/ | 2026-08-22 | page current at retrieval | high |
| W8 | Iron Man 2020 has a bounded explicit 18-item event order after separate historical and trade sections. | Iron Man 2020 Reading Order | https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/marvel-fresh-start-reading-order/iron-man-2020-reading-order/ | 2026-08-22 | page current at retrieval | high |

### Contradictions / Conflicts

* The prior packet plan selected ten guides per production pull request, while its lower-capability implementation contract scopes work to one named inventory id. Current evidence reconciles these by making the integration chunk a pull-request unit and the individual list packet the worker unit.
* The packet author treats every nonzero overlap as an authoring failure, while the app already intentionally ships overlapping variants. Resolve this by requiring an explicit overlap disposition rather than weakening or removing the comparison.

## Findings Mapped to Questions and Evidence

| Question | Finding | Evidence IDs | Confidence | Decision or readiness implication |
|----------|---------|--------------|------------|-----------------------------------|
| Q1 | The current app has 66 lists, 52 from Comic Book Herald, while 22 modern Earth-616 candidates remain pending and 12 CBH character/team lists sit outside that inventory. | C1-C3 | high | Finish the maintained queue before starting a new guide-family inventory. |
| Q2 | Existing tools already own the complete source-to-catalog workflow, but packet membership and source inputs remain hard-coded. | C4-C6, C10-C12 | high | Plan one generic packet/status improvement, not a new ingestion system. |
| Q3 | Master-page links vary from flat issue lists to umbrella eras, bridges, recommendations, and complex multi-section guides. | W1-W8 | high | Chunk by verified complexity and list identity, not page order alone. |
| Q4 | Source identity, exact sequence, and all-library relationship checks already exist; partial and subset results need explicit disposition. | C5-C7, C12 | high | Make the current-library check a mandatory pre-dispatch gate. |
| Q5 | One list per worker plus two or three-list integration chunks isolates context and shared files. | C4-C6, C8, C11 | high | Lower-cost models receive frozen packets and stop on ambiguity. |
| Q6 | Ten heterogeneous lists per worker, chronological-only selection, and blanket zero-overlap rejection do not survive current evidence. | C5-C8, W2-W8 | high | Preserve ten-list history as evidence, not as the next worker-size default. |

## Key Discoveries

* The repository has already built most of the needed automation; the efficient next move is to genericize packet selection and status reporting.
* The current-library baseline is 66 lists and 2,787 distinct issues. No pending inventory candidate has an exact whole-page source identity already in the manifest.
* Twenty-two pending modern Earth-616 candidates can be scheduled without reopening source discovery.
* The best low-cost worker unit is one frozen list mapping, not one source page and not one multi-list pull request.
* The best integration unit is two or three independently prepared lists, selected only after preflight reports issue count, source complexity, source identity, exact-sequence duplication, and overlap relationships.

## Alternatives and Decision State

### Selected Recommendation (convergence only)

* Approach: Add one generic, data-driven packet and current-library status layer over the existing CBH tools. Keep the 22 pending modern Earth-616 records as the active queue. Give each lower-cost worker one frozen list packet, then integrate two or three passing lists per delivery chunk. Route unresolved metadata, unclear section boundaries, exact or subset duplication, and unapproved partial overlap to a stronger reviewer.
* Rationale: This reuses the shipped workflow, eliminates repeated edits to large central scripts, prevents parallel manifest conflicts, and makes current-library comparison a deterministic prerequisite rather than a final surprise.
* Evidence refs: C1-C12, W1-W8.
* Implementation impact: Build-time scripts and packet data first; then per-list mapping and overlap artifacts; finally generated order data, catalog entries, inventory state, tests, backlog, and changelog in small integration chunks.
* Confidence: high for the workflow and queue; medium for the membership of later chunks until each source page passes preflight.

### Alternative: One worker per source page

* Approach: Give each worker one Comic Book Herald page and ask it to add everything found there.
* Trade-offs: Simple dispatch, but page length, nested guides, duplication, and validation cost vary dramatically.
* Evidence refs: W1-W8.
* Rejection rationale: Secret Empire and Hunt for Wolverine demonstrate that one page can contain several editorially distinct sections, while smaller pages are much safer.

### Alternative: Centralized bulk import

* Approach: Have one capable model inventory and implement all remaining lists in a single change.
* Trade-offs: Minimizes coordination but creates a large context, review, and failure-isolation burden.
* Evidence refs: C2, C6, C8, C11.
* Rejection rationale: It repeats the hard-coded packet pattern and gives a low-cost model both editorial and shared-file responsibilities.

### Alternative: Keep strict zero-overlap authoring

* Approach: Continue blocking any candidate that shares an issue with any current list.
* Trade-offs: Very simple and safe, but excludes legitimate event and variant lists already supported by the product model.
* Evidence refs: C5-C7.
* Rejection rationale: Exact and subset relationships should block by default, but partial overlap needs explicit adjudication because the current library already contains intentional overlap.

## Open Questions, Risks, and Residual Uncertainty

* Blocking: None for planning.
* Important: Later chunk membership is provisional until source freeze and exact issue resolution reveal actual size and overlap.
* Follow-up: Character and team guide expansion needs a separate maintained inventory after the modern queue, beginning with comparison against the 12 already shipped CBH character/team lists.
* Residual uncertainty: Some pending 2021-2024 guides may reference issues absent from the finished metadata snapshot even though their publication years are nominally covered.

## Current Decisions

* Use the current app catalog as the mandatory duplication and overlap baseline.
* Preserve source provenance per list and the exact page-plus-section identity.
* Finish the 22 pending modern Earth-616 candidates before opening a character/team inventory.
* Use one frozen list packet per lower-cost worker.
* Integrate two or three passing workers in one delivery chunk, with a central integrator owning shared manifest and product records.
* Reject exact duplicates and unapproved subsets; escalate partial overlap rather than treating it as automatically safe or automatically forbidden.

## Unresolved Decisions

* Exact membership after the first two pilot lists, because source complexity and overlap must be measured by preflight.
* Whether approved partial overlap should use a per-comparison disposition in the overlap report or an inventory-level summary.
* The later character/team inventory scope.

## Potential Next Research

* Preflight Generations and X-Men Extermination as the first two one-list worker packets.
* Inventory character/team guides only after the pending modern queue is completed or explicitly paused.

## Planning Readiness

* Status: Ready.
* Rationale: The current library, maintained queue, source hierarchy, tool contracts, source-complexity variance, overlap behavior, worker unit, integration unit, and escalation rules are evidenced by C1-C12 and W1-W8.

## Research Disposition

* Disposition: executed.
* Reason: New internal and external investigation is required.

## Sources

* Original MRT-001 research and plan, referenced by stable artifact sections.
* Current repository data, scripts, tests, and backlog records.
* Comic Book Herald's complete Marvel reading-order guide and directly linked guide pages.

## Self-Check

* [x] Brief and scope are complete.
* [x] Extension registry is complete.
* [x] Wider, Deeper, and Contrarian waves are complete and recorded in order.
* [x] Every material codebase claim has a `C#` evidence row.
* [x] Every material external claim has a `W#` evidence row.
* [x] Alternatives and recommendation are evidence-backed.
* [x] Planning Readiness is accurate.
* [x] No source implementation files were edited.
