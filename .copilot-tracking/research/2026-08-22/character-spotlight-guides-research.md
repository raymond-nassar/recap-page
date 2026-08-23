<!-- markdownlint-disable-file -->

# Task Research: character-spotlight-guides

| Field | Value |
|---|---|
| Date | 2026-08-22 |
| Researcher / agent | rpi-research under automatic RPI Agent |
| Status | In progress |
| Artifact path | `.copilot-tracking/research/2026-08-22/character-spotlight-guides-research.md` |
| Task ID | MRT-002-C01 |
| Parent | MRT-002 / reading-list-expansion |

## Research Brief

* What to research: Inventory every Comic Book Herald guide in the "Individual Character/Team Guides" section, classify each guide against the complete current application library, verify the Character Spotlight catalog contracts, and identify complete high-confidence guides that can pass the guarded packet workflow without shortening.
* Why it matters: The evidence must support a bounded plan that expands Character Spotlight without duplicating reading orders, bypassing the central approval path, or inventing a new placement model.
* Audience or intended use: The automatic RPI planning and implementation phases, the independent post-implementation reviewer, and the repository owner.
* Scope: The named Comic Book Herald source section; the current catalog and curated-list data; the packet, mapping, overlap, freshness, approval, publication, and validation contracts merged by PR #169; the inherited MRT-002 artifacts.
* Non-goals: A new browse surface, speculative per-list placement metadata, silent guide shortening, runtime dependencies, image storage, changes to origin or popup behavior, and unrelated backlog work.
* Criteria: Complete source inventory; exact duplicate, both subset directions, partial overlap, and none classifications against the complete current library; evidence-backed source boundaries and identities; configured metadata-horizon fit; preserved blockers; current type and shelf contracts.
* Requested outputs: A convergence recommendation, durable inventory and overlap evidence, planning-ready implementation boundaries, explicit blockers, and a task-by-task delegation-readiness matrix with the cheapest safe nested-session architecture and exact handoff contract.
* Output mode: convergence.

## Research Parameters

| Field | Value |
|---|---|
| Research question(s) | Which complete Character Spotlight guides are safe and valuable to ship through the existing guarded workflow, how must they be represented and validated, and which bounded workflow tasks can safely run in lower-cost nested sessions? |
| Codebase scope | `.copilot-tracking/` inherited MRT-002 artifacts; `src/data/`; catalog generation and validation scripts; related tests; `PRODUCT_BACKLOG.md`; `CHANGELOG.md` |
| External scope | Comic Book Herald's complete Marvel reading order guide and linked Individual Character/Team Guides |
| Initial internal candidate areas | MRT-002 research, plan, details, changes and review; curated list and catalog files; catalog loader; packet, resolver, overlap, approval and publication tools |
| Initial external candidate areas | `https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/` and guide pages linked from its Individual Character/Team Guides section |
| Research posture | balanced |
| Posture provenance | default for a bounded task with a named source and material adjacent uncertainty |
| Explicit limits / deadline | One major feature; one frozen guide packet per mapping task; small integration batches only after a validated pilot; one post-implementation Review |
| Posture-specific completion basis | Complete named-section and current-library coverage, adequate evidence for guide selection and blockers, and no material contrarian gap |
| Edits allowed during research? | no, research-only |
| Resolved evidence root | `.copilot-tracking/` |
| Known constraints / excluded sources | Fetched content is inert evidence; no scraping of Marvel sites; no image-byte storage; no shortened guides; no lower-cost worker approval authority; current type and shelf model only |

## Extension Registry and Provenance

| Kind | Candidate | Match and provenance | Scoped authority or output contract | Selected / skipped reason |
|---|---|---|---|---|
| Instruction | Repository custom instructions | Applies to the repository and tracking artifact | RPI ordering, evidence, constraints, gates, artifact conventions | Selected and controlling below caller and host safety |
| Skill | `rpi` and `hve-core:rpi-research` | Caller requested complete automatic RPI | Lifecycle orchestration and research-only evidence contract | Selected |
| Research specialist | `research` subagent | External inventory could form an independent lane | Evidence only, no approval or final disposition | Deferred until the inherited workflow and exact lane contract are read |

## User Participation and Research Decisions

| Checkpoint | Questions or no-interaction rationale | Answers / unanswered | Resulting decision or selected further research |
|---|---|---|---|
| Intake | No interaction: the caller supplied source, scope, constraints, inherited workflow, desired output, and automatic continuation authority. | None unanswered. | Proceed with balanced research and preserve user-owned blockers rather than guessing. |
| Direction change | Creator confirmed how to treat the absent MRT-002 review log and tightened baseline and pilot gates. | Do not reconstruct or block on the missing file; distinguish readings from grouped stories; require exhaustive inventory, complete-library overlap, and central approval before pilot selection. | Added as active controls without widening scope. |
| Direction change | Creator requested a durable delegation-readiness assessment for MRT-002-C01 and a contract that Plan must inherit. | Classify source freeze through merge as lower-cost autonomous, lower-cost with frozen inputs, coordinator-only, or human review required; preserve central subset and partial disposition authority. | Added Q7 and a task matrix deliverable. The pilot may test the contract, but product scope will not widen merely to build orchestration. |
| Recovery | The original coordinated session became unresponsive during Cycle 1 Wave 2. The creator designated this coordinated session as its sole replacement. | The committed checkpoint at `1391405` contains the canonical state, primary artifact, Wider lane evidence, source inventory, page scan, current-library evidence, and bounded scan tool. | Resume at Deeper without repeating Wider or completed inventory work. Preserve every existing control, evidence id, and unresolved blocker. |
| Convergence | Pending completed three-wave cycle. | Pending. | Pending. |

## Scope and Success Criteria

* Scope: Research only within the brief above. Product and plan files remain unchanged in this phase.
* Assumptions: PR #169's workflow is present and current; the source section has stable, identifiable guide links; current Character Spotlight placement is derivable from catalog contracts. Every assumption must be verified.
* Success criteria:
  * Every source-section guide is inventoried.
  * Every guide has a complete-current-library overlap classification or an evidence-backed blocker.
  * Existing type and placement contracts are identified without adding speculative metadata.
  * Candidate guides are complete, high confidence, within the metadata horizon, and eligible for the existing approval path.
  * Wider, Deeper, and Contrarian waves are completed and synthesized.

## Task Research Requests

* Explicit requests: Read inherited MRT-002 artifacts; reuse PR #169 machinery; inventory all source-section guides; classify complete-library overlap; verify Character Spotlight representation; plan frozen one-guide packets and bounded batches; preserve blockers; continue automatically through RPI, PR, CI, and merge.
* Inferred research questions: Which source identities and boundaries are unambiguous? Which candidates offer novel complete coverage? Which existing contracts constrain representation? Which checks prove workflow reuse and publication correctness?
* Caller constraints and non-goals: No new surface, no speculative placement metadata, no bypass or duplication of central approval, no silent shortening, no runtime dependencies, no image storage, no origin or popup changes.

## Direction Controls

| Control type | Direction or boundary | Source / checkpoint | Effect on active brief, evidence, or revalidation |
|---|---|---|---|
| add | Use stable child identity MRT-002-C01 and slug `character-spotlight-guides`. | Caller and repository convention | All artifacts and state use one identity. |
| narrow | Source selection is the Individual Character/Team Guides section. | Caller | Adjacent Comic Book Herald sections are evidence context only. |
| narrow | Ship under Character Spotlight using existing type and shelf contracts. | Caller | A new surface or placement field is excluded. |
| exclude | Lower-cost mappers cannot approve overlap dispositions. | Caller | Approval remains central and evidence-backed. |
| exclude | Do not shorten a guide or hide ambiguous, unavailable, provenance, or overlap blockers. | Caller | Blocked candidates remain durable evidence rather than implementation shortcuts. |
| narrow | Treat the absent MRT-002 review log as a recorded evidence gap supported by the committed state and changes record. | Creator checkpoint | Do not reconstruct, invent, or block on the missing artifact. |
| narrow | Distinguish Character Spotlight readings from grouped stories in baseline counts. | Creator checkpoint | Report eight readings and seven grouped stories rather than using either count ambiguously. |
| narrow | Select no pilot before exhaustive named-section inventory, complete-current-library overlap, and central approval evidence. | Creator checkpoint | Candidate appeal or source simplicity alone cannot trigger planning selection. |
| add | Assess whether the merged deterministic tooling is sufficient for a cost-efficient nested guide-addition session and carry the resulting contract into Plan. | Creator checkpoint | Research must classify each workflow task by delegation tier, cite repository evidence and failure modes, and define the cheapest safe handoff. |
| exclude | Do not delegate subset or partial relationship disposition and do not weaken central approval. | Creator checkpoint | Lower-cost sessions may produce deterministic evidence but cannot make the integration decision. |
| narrow | Treat any shipped pilot as a bounded conformance test only when it fits the selected product scope. | Creator checkpoint | No orchestration-only expansion is permitted. |
| narrow | Recover from commit `1391405` as the sole replacement for the stalled coordinated session. | Creator recovery instruction | Preserve completed Research progress and resume at Wave 2 rather than rebuilding evidence. |

## Research Questions

| # | Sub-question | Type | Priority | Status |
|---:|---|---|---|---|
| Q1 | What contracts and workflow did MRT-002 and PR #169 establish? | depth | H | open |
| Q2 | How are current Character Spotlight stories represented and placed? | straightforward | H | open |
| Q3 | Which guides appear in the complete source section, and what are their identities and boundaries? | breadth | H | open |
| Q4 | How does every guide overlap the complete current library? | breadth | H | open |
| Q5 | Which complete guides fit the metadata horizon and central approval rules? | depth | H | open |
| Q6 | What counter-evidence could invalidate the candidate selection or proposed batching? | depth | H | open |
| Q7 | Which source-freeze, mapping, overlap, authoring, validation, review, PR, CI, and merge tasks can safely run in lower-cost nested sessions, and under what exact handoff contract? | depth | H | open |

## Prior Knowledge Gate

* Existing artifacts reviewed: MRT-002 research, plan, phase details, plan critique, changes, and state. The state names a post-implementation review path that is not present in the merged tree; its routed RV-001 through RV-003 outcomes remain recorded in the state and changes artifact.
* Reused (verified) findings: The full-library relationship taxonomy, one-packet mapping boundary, central approval authority, digest write order, generic named authoring, and follow-up requirement for a maintained character/team inventory remain current in the merged tree.
* Superseded / stale: MRT-002's pre-implementation baseline of 66 lists is historical. The current manifest and generated catalog each contain 86 lists, including eight `character-run` entries.

## Research Cycle Log

### Cycle 1

* Active direction controls: all controls above.
* Active research posture and completion basis: balanced; complete named-section and current-library coverage with adequate evidence.
* Explicit limits or deadline effect: The cycle must produce bounded planning inputs, not source edits.

#### Wave 1: Wider

* Plan and independent lanes: Read inherited artifacts and current contracts; inventory the source section; enumerate the complete current library and workflow entry points.
* Worker evidence relationships or inline fallback: Internal repository contracts were investigated inline. The independent source-section inventory is persisted at `research/subagents/2026-08-22/character-spotlight-guides-external-wider.md`; its 130 visible entries were normalized into `research/2026-08-22/character-spotlight-source-inventory.json`.
* Reflection: Internally, the workflow and placement questions are settled. The current library contains 86 entries, eight of type `character-run`. Catalog shelf assignment is type-driven, not timeline-driven, and `character-run` stories route to the existing Character spotlights screen. The guarded packet contract already owns exact source boundary, source identity, proposed manifest, insertion anchor, strong source review, immutable digest, exact mapping, complete-library reports, central dispositions, approval digest, and stale-input rejection. Preparation currently requires the packet's `inventoryId` to exist in the single modern inventory, so a maintained character inventory must be connected to the same validator and preparation path rather than bypassing it. Externally, the named section contains 130 visible entries resolving to 128 source URLs, including two duplicate-URL pairs, six author-centric or topical entries that may not satisfy the surface contract, and confirmed post-2025 guide content. Only 15 guide pages received direct boundary investigation in Wider, several tails were truncated, and no issue-level complete-library classifications were produced. Those are Deeper inputs, not candidate evidence. Evidence: C1-C12, W1-W4.

#### Wave 2: Deeper

* Parent-prioritized material from Wave 1: Resolve all 128 source identities to an exact issue boundary or a specific evidence-backed blocker; distinguish source-index duplicates from issue-set relationships; test metadata-horizon fit; produce complete-current-library relationship evidence before selecting a pilot; and derive the delegation-readiness matrix from deterministic tool boundaries and remaining judgment points.
* Plan and independent lanes: Investigate exact source boundaries and metadata horizon in bounded source-identity batches; map only frozen one-guide packets; retain relationship disposition centrally; inspect the deterministic tooling and tests for task-by-task delegation preconditions and failure surfaces.
* Worker evidence relationships or inline fallback: The recovered coordinator ran eight fixed 16-identity extraction batches through a deterministic WordPress REST tool and committed each cumulative checkpoint. No worker received source-acceptance authority. The exact White Tiger source freeze, metadata resolution, complete-library report, and all 128 central dispositions were completed inline because boundary and partial-overlap decisions are coordinator-only.
* Reflection: All 128 source identities now have one exact canonical WordPress record, raw rendered-content digest, headings, and retained issue-bearing blocks. The central disposition matrix accounts for every identity: 118 deferred behind exact row mapping, seven excluded for surface or provenance mismatch, two blocked by explicit 2026 issues, and one approved pilot. White Tiger is the only selected pilot because all 82 source-defined rows resolve exactly, the latest resolved on-sale date is 2022-09-28, and all 86 current lists were compared before its four partial relationships were approved centrally. Evidence: C13-C15, W5-W7.

##### Deeper source-batch checkpoints

| Batch | Source identities | Durable output | Result | Recovery or blocker handling |
|---|---:|---|---|---|
| D1 | 1-16 | `research/2026-08-22/character-spotlight-boundaries.json` | All 16 exact URL slugs resolved through Comic Book Herald's WordPress REST content endpoint. Every record retains the canonical URL, WordPress identity and timestamps, rendered-content digest, headings, and every issue-bearing block. | Direct-page 403 responses remain non-evidence. The REST records replaced no Wider evidence and do not decide source acceptance, horizon fit, or overlap. |
| D2 | 17-32 | same cumulative boundary record | All 16 exact URL slugs resolved to one WordPress record with issue-bearing content. | The Captain Marvel / Ms. Marvel duplicate index labels remain one source identity. Conan remains provenance-blocked pending central disposition. |
| D3 | 33-48 | same cumulative boundary record | All 16 exact URL slugs resolved to one WordPress record with issue-bearing content. | No fetch or identity blocker was introduced. Source acceptance and horizon fit remain central. |
| D4 | 49-64 | same cumulative boundary record | All 16 exact URL slugs resolved to one WordPress record with issue-bearing content. | The author-centric Hickman page remains a type-disposition question rather than a fetch blocker. |
| D5 | 65-80 | same cumulative boundary record | All 16 exact URL slugs resolved to one WordPress record with issue-bearing content. | Marvel Max and Marvel vs. DC retain their existing type or provenance blockers for central disposition. |
| D6 | 81-96 | same cumulative boundary record | All 16 exact URL slugs resolved to one WordPress record with issue-bearing content. | The Original Graphic Novels page remains a type-disposition question. No extraction blocker was introduced. |
| D7 | 97-112 | same cumulative boundary record | All 16 exact URL slugs resolved to one WordPress record with issue-bearing content. | Existing Scarlet Witch, Thor, and Thanos-adjacent catalog relationships are not inferred from page identity; issue-set review remains central. |
| D8 | 113-128 | same cumulative boundary record | All 16 exact URL slugs resolved to one WordPress record with issue-bearing content, completing all 128 identities. | Wolverine and modern X-Men retain their confirmed post-horizon blockers. The Claremont variants require issue-set comparison against both existing readings. |

##### Delegation-readiness matrix

| Task | Readiness tier | Frozen input or output contract | Failure handling and authority |
|---|---|---|---|
| Index inventory extraction | lower-cost with frozen inputs | One named index section; emit visible labels, exact URLs, positions, and duplicate-URL facts only | Missing section or truncation blocks the batch. No candidate or identity disposition authority. |
| Source-page retrieval | lower-cost autonomous in bounded batches | Exact URL list; emit status, canonical WordPress identity, timestamps, raw-content digest, headings, and issue-bearing blocks after each identity | 403, timeout, missing slug, or multiple records becomes explicit non-evidence or a blocker. |
| Source boundary and exclusions | coordinator-only | Exact retrieved record plus proposed boundary and every excluded source reference | Ambiguous section identity, implied collection contents, duplicate labels, and silent shortening are rejected centrally. |
| Exact metadata preparation | lower-cost with frozen inputs | One immutable packet, exact series ids, row count, packet digest, and candidate metadata only | Unmatched, ambiguous, stale, or post-horizon rows block. A worker cannot choose among ambiguous identities. |
| Complete-library and peer reports | lower-cost autonomous | Exact selected issue ids, current library digest, peer digests, and deterministic relationship taxonomy | Duplicate ids, stale digests, or incomplete comparison counts block. |
| `candidate-subset`, `existing-subset`, or `partial` disposition | coordinator-only | Complete report plus source boundary and product purpose | The relationship is recorded and explicitly approved or the candidate is blocked. |
| Approval digest and publication authority | coordinator-only | Frozen packet, exact mapping, complete reports, and recorded relationship decisions | No lower-cost worker may mint approval or weaken a blocker. |
| Named authoring and catalog generation | lower-cost with frozen inputs | Approved packet, mapping, report, approval digest, and fixed `character-run` manifest proposal | Any stale input or unexpected write blocks. No new browse surface or placement metadata. |
| Targeted tests, lint, deterministic validation, and Edge script execution | lower-cost autonomous | Exact commands or script, expected counts, and machine-readable results | Nonzero exit, count drift, missing browser assertion, or timeout routes to the coordinator. |
| Anchor re-aiming and bless output reading | coordinator-only | Final diff and every changed citation-to-claim pairing | No delegation because acceptance requires reading each claim against its final cited text. |
| Independent Review | human-review-required or independent reviewer | Final diff, research, plan, critique, changes, and validation evidence | Findings route once. Material findings block release; unrelated findings become follow-up work. |
| PR, required CI interpretation, and merge | coordinator-only | Final commit, PR body, CI jobs and logs, and one-feature scope | Cancelled jobs are distinguished from failures. Final release authority remains central. |

#### Wave 3: Contrarian

* In-scope challenge targets and boundaries: Candidate completeness, source identity, metadata horizon, overlap disposition, type and placement assumptions, and bounded batching.
* Plan and independent lanes: Try to invalidate White Tiger by finding a silently shortened source section, a post-horizon issue, a missed exact/subset relationship, a mismatch between page label and metadata identity, a placement requirement outside `character-run`, or a reason the 128-record matrix does not support selection.
* Worker evidence relationships or inline fallback: Inline central challenge, because all challenge targets are protected decisions.
* Reflection: The challenge narrowed rather than widened the pilot. The page's explicit "Ava Ayala Cut (every issue she's in)" controls whenever present; using surrounding collection contents in those cases would add unrelated issues. Whole collection contents remain only where the guide provides no narrower cut. This yields 82 unique exact rows from Avengers Academy #21 through Marvel's Voices: Community #1. All 82 resolve inside the metadata horizon. Marvel metadata places the source's 2021-labeled Community one-shot under a 2022 series year, so that identity is manually recorded rather than normalized silently. Complete-library comparison found 12 shared issue ids across four lists, all `partial`; none is exact or either subset direction. Those overlaps are acceptable for a broad character path and are explicitly approved centrally. The 2022 source snapshot cannot support a claim that the guide covers later White Tiger appearances, so the product description must name its endpoint rather than say "complete to present." The existing `character-run` type provides the requested screen with no new placement field. No second full cycle is needed.

#### Parent Synthesis and Disposition

Select one bounded pilot: the 82-issue Ava Ayala White Tiger reading path. Preserve its source-defined cut rule exactly, carry its four approved partial relationships into the approval artifact, represent it as an ungrouped `character-run`, and integrate the maintained 128-identity inventory with the existing packet validator and named preparation path. Do not plan any of the 127 other identities. Their exclusions, post-horizon blockers, existing-source questions, and unresolved exact mappings remain durable in the central disposition record.

#### Cycle Re-entry Evaluation

* Another complete three-wave cycle needed: No.
* Trigger or stop basis: The named-section inventory and exact boundary pass are exhaustive; every identity has a central disposition; the selected pilot has exact source, horizon, and 86-list relationship evidence; the contrarian pass found no material gap.
* Revised brief or revalidation required: None.
* Readiness effect: Ready for a one-pilot plan.

## Evidence Log

* Delegation: Cycle 1 Wave 1 external inventory lane at `.copilot-tracking/research/subagents/2026-08-22/character-spotlight-guides-external-wider.md`; deterministic bounded Deeper extraction; protected decisions inline.

### Codebase Evidence

| ID | Claim / finding | Location (`path:line`) | Tool | Confidence | Notes |
|---|---|---|---|---|---|
| C1 | MRT-002 selected one frozen list packet per lower-cost worker, central full-library and peer relationship review, and explicit approval for subset or partial relationships. | `.copilot-tracking/details/2026-08-22/reading-list-expansion-phase-details.md:88-167` | read | high | This is the inherited workflow to reuse. |
| C2 | MRT-002 explicitly routed a maintained character and team guide inventory to a later research and planning task after its modern queue completed. | `.copilot-tracking/plans/2026-08-22/reading-list-expansion-plan.md:744-749` | read | high | This task is that planned follow-up. |
| C3 | The merged catalog and manifest contain 87 entries, nine of which are `character-run`; those nine readings form eight stories because the two X-Men variants share one group. | `src/data/curated-lists.json:1578-1922` | parsed manifest and read | high | The generated catalog has the same entry count and ids. |
| C4 | Character Spotlight placement is derived from `type: character-run`; the shelf has no separate section or placement field. | `src/js/lib/catalog.js:590-676` | read | high | New guide packets need the existing type only. |
| C5 | Shelf tests require every grouped story and every reading path to reach exactly one screen and keep a grouped story intact. | `test/catalog-shelves.test.js:24-75` | read | high | Existing regression coverage already protects the placement contract. |
| C6 | Frozen packets bind exact Comic Book Herald URL and visible section, non-empty rows, expected count, proposed manifest, insertion anchor, strong source-review identity, and a fresh SHA-256 digest. | `scripts/lib/cbh-inventory.mjs:252-346` | read | high | No character guide may bypass source freeze or invent per-list placement metadata. |
| C7 | Complete-library reports classify `exact`, `candidate-subset`, `existing-subset`, `partial`, and `none` over issue-id sets and require every compared order to have unique ids. | `scripts/lib/cbh-overlap.mjs:29-98` | read | high | This directly supplies the required relationship vocabulary. |
| C8 | Named preparation loads a frozen packet, requires its record from exactly one maintained inventory, and validates both the packet and current catalog before mapping. | `scripts/prepare-cbh-batch.mjs:2825-2897` | read | high | The character inventory is integrated with this central path rather than maintained as an unaudited side file. |
| C9 | Authoring verifies packet, mapping, report, library, peer, approval, and manifest freshness before writing, and accepts named comma-separated guide ids. | `scripts/author-cbh-packet.mjs:297-374`; `scripts/author-cbh-packet.mjs:392-497` | read | high | Small integration batches can use the existing author path unchanged in concept. |
| C10 | Comic Book Herald approved continued use of the existing credit-and-link pattern, but did not grant a broader license over Marvel material or site editorial prose. | `docs/DATA_PROVENANCE.md:311-334` | read | high | Packets may preserve issue references and source structure, not copy commentary. |
| C11 | The merged state names a review artifact that is absent from the tree, while the durable state and changes record preserve the Review outcome and the implemented RV-001 through RV-003 corrections. | `.copilot-tracking/rpi-sessions/2026-08-22/reading-list-expansion-state.json:149-161`; `.copilot-tracking/changes/2026-08-22/reading-list-expansion-changes.md:163-187` | read and repository file search | high | There is no separate inherited review file to read on the merged commit. |
| C12 | The complete current library baseline is 86 lists and 3,209 distinct issues. Its eight current Character Spotlight readings already demonstrate that broad character guides naturally create partial overlaps, including 316 shared X-Men issues, 11 Thor and War of the Realms issues, and several Avengers-family overlaps. | `.copilot-tracking/research/2026-08-22/character-spotlight-current-library.json:1-125` | parsed all manifest payloads and applied the checked-in relationship semantics | high | Zero overlap cannot be the selection rule for this guide family. |
| C13 | The exact White Tiger source freeze contains 82 unique rows. Every row resolves to one metadata issue, the latest on-sale date is 2022-09-28, and comparison with all 86 current lists finds four partial relationships totaling 12 shared issue ids. | `.copilot-tracking/research/2026-08-22/character-spotlight-white-tiger-evidence.json` | deterministic source freeze, metadata resolution, and complete-library comparison | high | Partial overlap is centrally approved; exact and both subset directions are absent. |
| C14 | The central disposition matrix accounts for all 128 identities: 118 deferred, seven excluded, two blocked by explicit post-horizon issues, and one pilot approved. | `.copilot-tracking/research/2026-08-22/character-spotlight-dispositions.json` | deterministic synthesis with coordinator-owned dispositions | high | No unselected guide enters Plan. |
| C15 | Deterministic preparation, overlap, authoring, and validation can run at lower cost only after source and approval inputs are frozen; source boundaries, ambiguous identities, subset or partial dispositions, anchor reading, and release remain central. | C6-C9 and the Deeper delegation-readiness matrix | contract analysis | high | Plan must carry the exact handoff contract rather than delegate authority implicitly. |

### External Evidence

| ID | Claim / finding | Source | Retrieved | Confidence | Notes |
|---|---|---|---|---|---|
| W1 | The named source section exposes 130 visible entries resolving to 128 distinct URLs; Apocalypse / Age of Apocalypse and Captain Marvel / Ms. Marvel (All) are duplicate URL pairs. | https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/ | 2026-08-22 | high | The exhaustive visible-entry inventory is persisted separately; duplicate source identity is not itself an issue-set relationship disposition. |
| W2 | The Wolverine guide is updated through 2026 and includes a 2026 issue, so it exceeds the configured metadata horizon. | https://www.comicbookherald.com/wolverine-reading-order/ | 2026-08-22 | high | This is a candidate blocker unless the source boundary supports a complete eligible section within the horizon without silent shortening. |
| W3 | The X-Men modern-era guide reports a 2026 update. | https://www.comicbookherald.com/the-complete-x-men-reading-order-guide-modern-marvel-comics-era/ | 2026-08-22 | high | Current catalog use of the same source URL does not prove the live source remains within the metadata horizon. |
| W4 | The Amazing Spider-Man guide reports a 2026 update. | https://www.comicbookherald.com/amazing-spider-man-reading-order-modern-marvel-era/ | 2026-08-22 | high | Full boundary and metadata fit remain unresolved. |
| W5 | Deeper batch D1 resolved source identities 1 through 16 to exact WordPress records and complete rendered-content snapshots. The batch produced no fetch, not-found, or ambiguous-slug blocker. | Comic Book Herald WordPress REST posts and pages endpoints for the 16 exact inventory slugs | 2026-08-23 | high | The retained issue-bearing blocks support later central boundary and metadata-horizon dispositions; a 2026 modification timestamp alone is not treated as proof that an issue falls outside the metadata snapshot. |
| W6 | The complete Deeper boundary pass resolved all 128 distinct source URLs to one exact WordPress record each. Every record has issue-bearing content and a raw rendered-content digest; no direct-page 403 was promoted to evidence and no timeout, missing-slug, or ambiguous-slug blocker remains. | Comic Book Herald WordPress REST posts and pages endpoints for all 128 exact inventory slugs | 2026-08-23 | high | Boundary extraction is complete. Central source acceptance, metadata fit, relationship disposition, and candidate selection remain separate decisions. |
| W7 | The White Tiger page explicitly defines an "Ava Ayala Cut (every issue she's in)" for broad collections and supplies whole issue entries where no narrower cut is given. Its retained endpoint is Marvel's Voices: Community. | https://www.comicbookherald.com/ava-ayala-reading-order/ | 2026-08-23 | high | The source-defined cut is the complete character path; surrounding unrelated collection issues are excluded openly rather than silently shortened. |

### Contradictions / Conflicts

* Wider's 115 unfetched-guide boundary blocker is superseded by the complete WordPress REST pass, not silently removed.
* A 2026 page-modification timestamp is not itself post-horizon issue evidence. Only explicit issue years or exact resolved on-sale dates control horizon disposition.
* Duplicate index labels are navigation facts, not issue-set relationships.
* Zero overlap is not a selection requirement for broad character guides. White Tiger's four partial relationships are recorded and approved centrally.
* The source labels Marvel's Voices: Community as 2021 while Marvel metadata groups the resolved issue under 2022. The mismatch is retained as a manual identity note.

## Findings Mapped to Questions and Evidence

| Question | Finding | Evidence |
|---|---|---|
| Q1 | Reuse the full guarded packet, digest, complete-library, approval, authoring, and stale-input workflow. | C1, C6-C9 |
| Q2 | Use the existing `character-run` type; it routes to Character spotlights without new placement metadata. | C3-C5 |
| Q3 | The named section has 130 visible entries and 128 exact source identities, all now boundary-snapshotted. | W1, W5-W6 |
| Q4 | Every identity has a central relationship status or explicit exact-mapping blocker. White Tiger alone has an 86-list exact report. | C13-C14 |
| Q5 | White Tiger's 82 rows resolve inside the horizon; Ultimate Spider-Man and Wolverine are explicitly post-horizon; all other unselected identities remain deferred until exact mapping. | C13-C14 |
| Q6 | Contrarian checks rejected timestamp inference, source-label inference, silent collection expansion, and a "complete to present" claim. | Wave 3 reflection |
| Q7 | Deterministic extraction, preparation, reports, authoring, and checks can run lower-cost on frozen inputs; protected decisions and final authority remain central. | C15 and the delegation-readiness matrix |

## Alternatives and Decision State

### Selected Recommendation

Plan and implement only `white-tiger-ava-ayala` as an ungrouped complete `character-run` with 82 source-defined issues. Add the maintained 128-identity character guide inventory to the existing validation and preparation path, freeze the exact packet, retain the source's 2021 versus metadata's 2022 Community identity note, record the four approved partial relationships, generate through the existing named authoring contract, and verify that the reading appears only on Character spotlights.

## Open Questions, Risks, and Residual Uncertainty

* Blocking: None for the selected White Tiger pilot.
* Important: The other 127 identities are intentionally not selected. Their central dispositions remain exclusions, explicit post-horizon blockers, existing-source questions, or exact-mapping deferrals.
* Follow-up: Future character pilots must resume from the central disposition record and earn their own exact packet, horizon resolution, complete-library report, and central approval.
* Residual uncertainty: The preparation entry point currently reads one modern inventory. Plan must generalize that input narrowly without merging character and modern lifecycle semantics.

## Current Decisions

| Decision | Status | Owner / source | Rationale | Evidence IDs | Implications |
|---|---|---|---|---|---|
| Reuse the guarded packet workflow and Character Spotlight placement model. | confirmed | caller and evidence | The existing packet, report, approval, authoring, catalog type, and shelf contracts cover the required flow. | C1, C4-C9 | Excludes duplicate machinery, a new surface, and per-list placement metadata. |
| Treat the missing MRT-002 review file as an inherited artifact gap, not as permission to recreate its history. | confirmed | evidence | The merged state and changes preserve the routed findings and corrections, while the named file is absent. | C11 | Research relies on the durable surviving records. |
| Approve White Tiger as the only pilot. | confirmed | coordinator | Its source boundary, 82 exact metadata rows, horizon fit, complete-library report, and four partial relationships are all explicit. | C13, W7 | Plan may select this guide and no other. |
| Exclude seven nonconforming identities and block two explicit post-horizon identities. | confirmed | coordinator | Surface and provenance constraints exclude seven; explicit 2026 issues block Ultimate Spider-Man and Wolverine. | C14 | No shortening or alternate placement is used to rescue them. |
| Preserve the lower-cost handoff boundary. | confirmed | coordinator | Deterministic work can be delegated only after protected inputs are frozen. | C15 | Plan must name exact inputs, outputs, blockers, and retained authority. |

## Unresolved Decisions

| Decision | Smallest evidence or answer needed | Owner | Impact | Blocker status |
|---|---|---|---|---|
None.

## Potential Next Research

| Priority | Research item | Expected value | Trigger | Selected? | Related questions / evidence |
|---|---|---|---|---|---|
| M | Resolve another deferred guide | Add a later pilot without repeating inventory work | A distinct follow-up task selects one deferred identity | no | C14 |

## Planning Readiness

* Status: Ready.
* Decision state: White Tiger is the sole approved pilot.
* Evidence basis: C1-C15 and W1-W7.
* Preconditions met: Complete inventory, exact boundaries, central 128-record dispositions, exact selected mapping, metadata horizon, full-library relationships, contrarian challenge, and delegation contract.
* Blockers: None for planning.
* Smallest action to change readiness: Create the bounded implementation plan and independent critique.

## Closeout Record

Research closed after one balanced three-wave cycle. The selected recommendation is one White Tiger pilot, not a broad batch. Durable evidence preserves all 128 identities, every central disposition, the 82-row exact source freeze, metadata dates, complete-library relationships, protected authority boundaries, and recovery provenance.

## Advisory Next Step

* Acting owner: confirmed automatic RPI Agent.
* Continuation result: Advance automatically to Plan.
* Primary evidence file: `.copilot-tracking/research/2026-08-22/character-spotlight-guides-research.md`.

## Sources

* Repository and workflow evidence: C1-C15.
* External source evidence: W1-W7.
* Primary external index: https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/
* Selected guide: https://www.comicbookherald.com/ava-ayala-reading-order/

## Artifact Self-Check

Complete. The artifact preserves the original task identity and controls, records replacement provenance, distinguishes 130 entries from 128 identities and eight readings from seven grouped stories, accounts for every source identity, selects no pilot before the evidence gates, records all selected-guide overlaps, keeps protected decisions central, and introduces no product edits during Research.
