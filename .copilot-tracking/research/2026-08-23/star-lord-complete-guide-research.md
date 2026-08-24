<!-- markdownlint-disable-file -->

# Task Research: star-lord-complete-guide

| Field | Value |
|---|---|
| Date | 2026-08-23 |
| Researcher / agent | RPI Research |
| Status | Complete |
| Artifact path | .copilot-tracking/research/2026-08-23/star-lord-complete-guide-research.md |
| Task ID | MRT-002-C08 |

## Research Brief

* What to research: Revalidate the accepted Comic Book Herald Star-Lord / Peter Quill complete-guide boundary, its exact 99-issue sequence, metadata coverage, current-library relationships, and selected-peer overlaps against current main after merged PR #176.
* Why it matters: The next separate Character Spotlight release must preserve its source-defined boundary while centrally approving all exact, subset, and partial relationships on the current catalog.
* Audience or intended use: RPI Plan and Implement for the Star-Lord Character Spotlight release.
* Scope: The accepted `star-lord-reading-order-complete-peter-quill-comics-timeline` source; current packet, mapping, report, approval, library, and peer contracts; current main including Rocket Raccoon, Groot, and the historical-event batch.
* Non-goals: Altering existing guides, shortening Star-Lord because of overlap, merging guides, heuristic parsing, inferred metadata, or unrelated product work.
* Criteria: Freshly fetched source evidence; exact 99 entries in source order; exact metadata mappings only; complete-current-library and selected-peer reports including Rocket Raccoon and Groot; fresh digest-bound central approvals; no unresolved metadata or evidence blocker.
* Requested outputs: A convergence recommendation with a complete evidence boundary for planning.
* Output mode: convergence

## Research Parameters

| Field | Value |
|---|---|
| Research question(s) | Can Star-Lord ship unchanged as the next separate complete Character Spotlight guide with all 99 source-required issues and fresh central overlap approvals? |
| Codebase scope | Existing MRT-002 character-guide artifacts and current packet, mapping, report, approval, taxonomy, catalog, list, order, documentation, and test contracts. |
| External scope | The accepted Comic Book Herald Star-Lord page and linked source material needed to validate the displayed issue sequence. |
| Initial internal candidate areas | `scripts/data/cbh-character-inventory.json`, `scripts/author-cbh-packet.mjs`, `scripts/prepare-cbh-batch.mjs`, `scripts/report-order-overlap.mjs`, current Rocket and Groot packet/mapping/report data, curated catalog/list data, validation tests, and release documentation. |
| Initial external candidate areas | Comic Book Herald Star-Lord reading-order page. |
| Research posture | focused |
| Posture provenance | caller-specified bounded source and exact acceptance boundary |
| Explicit limits / deadline | Exactly one Research cycle with Wider, Deeper, and Contrarian waves only if evidence is sufficient; no source substitution or heuristic parser. |
| Posture-specific completion basis | Focused scope coverage, fresh source validation, exact metadata closure, and contrarian overlap/staleness checks. |
| Edits allowed during research? | no, research-only |
| Resolved evidence root | `.copilot-tracking/` default |
| Known constraints / excluded sources | Treat prior artifacts and digests as claims to verify; preserve all overlaps as factual relationships; do not infer missing metadata. |

## Extension Registry and Provenance

| Kind | Candidate | Match and provenance | Scoped authority or output contract | Selected / skipped reason |
|---|---|---|---|---|
| Instruction | Repository custom instructions | Applies to all repository research and RPI evidence | Research-first workflow, three waves, durable decisions, source and anchor discipline | Selected |
| Skill | `hve-core:rpi-research` | Explicit automatic RPI request | Owns the primary research artifact and planning readiness | Selected |
| Research specialist | `research` agent | External source verification can be isolated from repository research | Return independently fetched source evidence without decision authority | Selected for the external lane |

## User Participation and Research Decisions

| Checkpoint | Questions or no-interaction rationale | Answers / unanswered | Resulting decision or selected further research |
|---|---|---|---|
| Intake | No question needed because the caller supplied task identity, priority, release sequencing, source boundary, baseline, exclusions, and acceptance criteria. | Star-Lord / Peter Quill is rank 15 and is the next separate sequential Character Spotlight release. | Persist rank 15 and the split-release decision as confirmed user requirements for MRT-002-C08. |
| Direction change | None at intake. | None. | Revalidate rather than inherit prior packet or digest state. |
| Convergence | No question needed because the completed cycle supports one bounded release path. | No unanswered user decision. | Proceed automatically to Plan with the exact 99-row separate Complete guide and fail-closed metadata regeneration. |

## Scope and Success Criteria

* Scope: Research only the Star-Lord complete-guide evidence needed for MRT-002-C08 and its direct current-library and peer relationships.
* Assumptions: The prior 99-entry boundary and 25 Rocket overlaps are untrusted until independently reproduced; current main may add relationships through Groot and historical-event guides.
* Success criteria:
  * The source page is fetched again and its source-required entries are independently counted and ordered.
  * Every issue maps exactly to current metadata or the task stops on a named blocker.
  * Current-library and selected-peer relationships are recomputed against current main.
  * Contrarian checks seek stale, shortened, merged, inferred, or misclassified outcomes and reject them unless evidence supports them.

## Task Research Requests

* Explicit requests: Persist rank 15 and sequential split release; reuse but independently validate the accepted source boundary and 99 issues; include Rocket and Groot in regenerated relationship evidence; preserve all 99 issues; prepare planning for a separate `character-run` and `complete-guide`.
* Inferred research questions: Which current scripts and data contracts produce freshness-bound packets, mappings, reports, approvals, and final guide records without changing existing guides?
* Caller constraints and non-goals: Research is read-only outside this artifact. One later critique and one later Review. No heuristic parser, inferred metadata, overlap omission, guide merge, or existing-guide alteration.

## Direction Controls

| Control type | Direction or boundary | Source / checkpoint | Effect on active brief, evidence, or revalidation |
|---|---|---|---|
| add | Star-Lord / Peter Quill is user priority rank 15. | Caller intake | Candidate identity and priority are durable requirements. |
| change | Release Star-Lord as the next separate sequential Character Spotlight after Groot. | Caller intake | Do not revive a combined batch. |
| narrow | Use the accepted Comic Book Herald source boundary and preserve exactly 99 issues in order. | Caller intake | Research validates that boundary rather than selecting a new one. |
| exclude | Do not shorten, merge, infer metadata, add parsers, or alter existing guides. | Caller intake | Contrarian alternatives remain within the exact separate-guide boundary. |

## Research Questions

| # | Sub-question | Type | Priority | Status |
|---:|---|---|---|---|
| Q1 | Does a fresh fetch reproduce the accepted exact 99-entry Star-Lord source sequence? | depth | H | answered |
| Q2 | Do all 99 entries map exactly to current metadata on current main? | depth | H | answered with implementation regeneration required |
| Q3 | What exact, subset, and partial relationships exist with the complete current library and selected peers, especially Rocket Raccoon and Groot? | breadth | H | answered with implementation regeneration required |
| Q4 | Which current repository contracts must planning preserve for freshness, stale rejection, taxonomy, chronology, publication, and release validation? | straightforward | H | answered |
| Q5 | Can overlap or current-main changes credibly justify shortening, merging, or reclassifying Star-Lord? | depth | H | answered |

## Prior Knowledge Gate

* Existing artifacts reviewed: MRT-002-C05 research, plan, critique, changes, review, and the maintained character inventory were identified as prior claims.
* Reused (verified) findings: A fresh complete page traversal and independent archived-page comparison reproduced the same twelve source blocks and exact 99-entry order. The prior metadata evidence for issue 50896 and the FCBD translation to issue 62818 remains a seed for regeneration, not accepted mapping output.
* Superseded / stale: The prior WordPress rendered-content digest is stale: the current post has 22,513 rendered characters and digest `fc6fe92719720c4a4ebf78e1f9a80b175ab361cb95c731d23b38c37c0e99c929`, while the older snapshot recorded 22,511 characters and a different digest. Every packet, mapping, report, library, peer, approval, and overlap digest must therefore be fresh.

## Research Cycle Log

### Cycle 1

* Active direction controls: rank 15, sequential split release, exact 99-entry source boundary, and no shortening or inference.
* Active research posture and completion basis: focused; fresh source, metadata, relationship, and contract evidence must close every high-priority question.
* Explicit limits or deadline effect: One complete cycle is sufficient only if the evidence closes all material questions.

#### Wave 1: Wider

* Plan and independent lanes: Inspect prior candidate evidence and current repository contracts while independently refetching the accepted external source.
* Worker evidence relationships or inline fallback: External lane delegated; internal lane remains parent-owned.
* Reflection: Current main has 96 lists, 13 Character Spotlight readings across 12 stories, four Complete guides, five Best of readings, and four All-only readings. The Star-Lord inventory record still preserves the source identity but remains deferred with no packet or mapping. The current guarded workflow can bind a single candidate to a complete-library digest while treating Rocket and Groot as named peers. The external lane reproduced twelve issue-bearing blocks and 99 entries without relying on the old count. Evidence: C1-C7, W1-W3.

#### Wave 2: Deeper

* Parent-prioritized material from Wave 1: Exact source order, fresh source identity, current mapping and relationship contracts, the two selected peers, and the one known FCBD numbering translation.
* Plan and independent lanes: Expand the twelve accepted blocks in displayed order; hash the 99 normalized labels; verify that named preparation resolves every row exactly; regenerate the complete-current-library report with Rocket and Groot as selected peers; require central dispositions for every non-exact relationship; preserve the current ungrouped Complete guide contract and insertion before `xmen-claremont`.
* Worker evidence relationships or inline fallback: The external lane supplied the complete 99-row sequence and archived-page comparison. Parent inspection confirmed the current digest, current catalog baseline, source packet validator, reporter, authoring approval, taxonomy, and filter contracts.
* Reflection: The exact sequence hash is `8e604a0e5f77a1d927be683aa5325da0ede70a658dacf9b7d0661f4213813aa8`. Prior C05 metadata probes established that all 99 identities were available, including Marvel Super Special #10 as issue 50896 and the exact FCBD title/year match as issue 62818 despite metadata numbering it #0. Because no committed Star-Lord mapping exists, implementation must regenerate all 99 rows rather than inherit those conclusions. Current main's 96-list library and the two shipped peer mappings define the fresh report boundary. Evidence: C1-C8, W1-W4.

#### Wave 3: Contrarian

* In-scope challenge targets and boundaries: Prior issue count, metadata completeness, overlap totals, freshness, and separate-guide classification.
* Plan and independent lanes: Test whether the source changed, whether Annihilation: Conquest or Wastelanders supplies omitted issue rows, whether shared issues justify shortening or merging, whether a stale full-content digest can be reused, and whether Star-Lord fits Best of rather than Complete.
* Worker evidence relationships or inline fallback: The archived page has the same twelve `Collects:` blocks and trailing links as the live page. Parent recomputation disproved reuse of the old full-content digest. Repository contracts reject silently omitted rows, exact duplicate guides, stale packet/mapping/report/approval evidence, and implicit taxonomy.
* Reflection: The accepted 99 is robust. Annihilation: Conquest and Wastelanders are links without an issue-bearing `Collects:` line, so including them would change the established inclusion rule and produce a different guide. Captain Marvel #125-129 must remain because it is explicitly inside a source block. Rocket and Groot overlaps are factual partial relationships between distinct complete guides, not a reason to omit rows. The stale rendered-content digest proves fresh evidence is necessary, while the unchanged visible source blocks preserve the accepted boundary. Evidence: C2-C8, W1-W4.

#### Parent Synthesis and Disposition

| Material / claim | Evidence IDs or worker pointers | Parent disposition | Evidence-based rationale | Primary-artifact treatment |
|---|---|---|---|---|
| Exact 99-entry source boundary | C1-C2; W1-W3; external lane | accepted | The live page and archived copy expose the same twelve issue-bearing blocks, which independently expand to 99 unique ordered issues. | Frozen packet boundary |
| Prior full-content digest | C1-C2; W1, W3 | rejected as stale | Current rendered content differs by two characters and hashes differently even though the issue-bearing text is unchanged. | Regenerate packet evidence |
| All 99 metadata identities | C3-C6; W4 | accepted only as a regeneration target | C05 found exact identities, but no Star-Lord packet or mapping was retained. The current guarded resolver must reproduce every identity and stop on any mismatch. | First implementation evidence gate |
| Rocket and Groot shared issues | C3-C6 | accepted as selected-peer relationships | Current authoring supports centrally approved partial relationships with named peer digests. Shared rows remain required in each distinct guide. | Include both peer mappings |
| Shortened, merged, or Best of alternative | C5-C8; W1-W2 | rejected | It would contradict the exact source boundary, the separate-release decision, and the explicit Complete guide taxonomy. | Preserve 99-row separate guide |
| Release recommendation | C1-C8; W1-W4 | accepted | The current workflow has the needed freshness, approval, taxonomy, chronology, and validation contracts, with metadata regeneration as an explicit fail-closed implementation gate. | Ready for Plan |

#### Cycle Re-entry Evaluation

* Another complete three-wave cycle needed: no.
* Trigger or stop basis: The focused source, current baseline, workflow, taxonomy, overlap, and contrarian questions are covered. Fresh metadata and relationship generation is deterministic implementation evidence and will stop the release if it no longer reproduces the accepted exact results.
* Revised brief or revalidation required: None.
* Readiness effect: Ready for a fail-closed 99-row Star-Lord implementation.

## Evidence Log

* Delegation: Cycle 1 Wave 1 external lane at `.copilot-tracking/research/subagents/2026-08-23/star-lord-source-verification.md`; internal evidence inline.

### Codebase Evidence

| ID | Claim / finding | Location | Tool | Confidence | Notes |
|---|---|---|---|---|---|
| C1 | The maintained Star-Lord record preserves one exact whole-page source identity, the accepted 99-issue boundary, its reviewed overlaps, and the final shipped disposition. | `scripts/data/cbh-character-inventory.json:2692-2722` | read, glob | high | At baseline commit 233c463 it was deferred and no packet or mapping existed. |
| C2 | The prior accepted source snapshot identifies WordPress post 10902 and twelve issue-bearing blocks, but its full rendered-content digest is no longer current. | `.copilot-tracking/research/2026-08-22/character-spotlight-boundaries.json`, Star-Lord record | read, fresh hash comparison | high | Stable record identity, stale rendered-content bytes. |
| C3 | Relationship approval binds the fresh packet, mapping, report, library digest, every selected-peer mapping digest, and one central disposition for every comparison. | `scripts/author-cbh-packet.mjs:303-381` | read | high | Non-none relationships require human or stronger-model authority. |
| C4 | The relationship reporter compares a candidate with the complete current library, excludes named peers from that library digest, and binds those peer mapping digests into the report. | `scripts/report-order-overlap.mjs:104-179` | read | high | Rocket and Groot can be explicit selected peers. |
| C5 | Authoring validates every fresh evidence layer, then creates one ungrouped manifest entry and exact Markdown order without altering existing guide data. | `scripts/author-cbh-packet.mjs:400-507` | read | high | A one-guide packet avoids the same-batch duplicate issue-id guard. |
| C6 | Packet, mapping, report, and approval validators reject stale digests, and library hashing deliberately ignores editorial `spotlightKind` so taxonomy updates do not rewrite issue-library evidence. | `scripts/lib/cbh-inventory.mjs:346-419` | read | high | Negative stale tests already have shared helpers. |
| C7 | The taxonomy test owns exact Character Spotlight reading, story, subset, and Star-Lord filter assertions. | `test/catalog-shelves.test.js:37-70` | read, targeted tests | high | Baseline commit 233c463 held 96 lists, 13 readings, 12 stories, five Best of, four Complete, and four All-only readings. |
| C8 | Character runs require explicit taxonomy; `complete-guide` is the maintained value for a complete source scope, and filters include only matching explicit values. | `src/js/lib/curated.js:94-97`; `src/js/lib/catalog.js:13-18`; `src/js/lib/catalog.js:335-340` | read | high | Star-Lord belongs in All and Complete, never Best of. |

### External Evidence

| ID | Claim / finding | Source | URL | Retrieved | Version/date | Confidence |
|---|---|---|---|---|---|---|
| W1 | The live Star-Lord page exposes twelve explicit issue-bearing `Collects:` blocks that expand to exactly 99 ordered issues. | Star-Lord Reading Order | https://www.comicbookherald.com/star-lord-reading-order-complete-peter-quill-comics-timeline/ | 2026-08-23 | modified 2024-02-12 | high |
| W2 | The December 2024 archived page has the same relevant headings, all twelve `Collects:` lines, and the same trailing non-sequence link as the live page. | Wayback Machine snapshot | https://web.archive.org/web/20241207032053/https://www.comicbookherald.com/star-lord-reading-order-complete-peter-quill-comics-timeline/ | 2026-08-23 | snapshot 2024-12-07 | high |
| W3 | A fresh WordPress API response still identifies post 10902 and the same modified time, but its 22,513 rendered characters hash to a new full-content digest. | Comic Book Herald WordPress API | https://www.comicbookherald.com/wp-json/wp/v2/posts/10902 | 2026-08-23 | modified 2024-02-12 | high |
| W4 | Prior C05 exact metadata probes identified Marvel Super Special #10 as issue 50896 and the FCBD source #1 title/year as issue 62818, which metadata numbers #0. | Marvel metadata API | https://marvel.emreparker.com/v1 | 2026-08-23 | metadata horizon 2025-10-29 | medium until regenerated |

### Contradictions / Conflicts

* The old rendered-content digest and length conflict with the fresh WordPress response even though the visible issue-bearing boundary is unchanged. The release must bind fresh packet evidence rather than bless the old digest.
* The page prominently links Annihilation: Conquest but supplies no issue-bearing `Collects:` line. Including it would change the accepted inclusion rule and raise the count above 99, so it remains an explicit exclusion.
* The FCBD source calls its row #1 while the sole exact title/year metadata record is issue 62818 numbered #0. Implementation may retain that exact identity only with the established explicit note and fresh resolver output.

## Findings Mapped to Questions and Evidence

| Question | Finding | Evidence IDs | Confidence | Decision or readiness implication |
|---|---|---|---|---|
| Q1 | Fresh live and archived source checks reproduce twelve issue-bearing blocks and exactly 99 ordered rows. | C1-C2; W1-W3 | high | Freeze the complete 99-row packet. |
| Q2 | Prior exact mapping is credible but not reusable because no committed Star-Lord mapping exists and source bytes changed. Current named preparation must re-resolve every row exactly. | C1, C3-C6; W3-W4 | high on process, medium on identities until generated | Make exact regeneration the first fail-closed implementation gate. |
| Q3 | Current tooling supports the complete current library plus Rocket and Groot as named peers, with all digests and dispositions bound centrally. | C3-C7 | high | Regenerate and approve all exact, subset, partial, and none relationships. |
| Q4 | Freshness, staleness rejection, Complete taxonomy, filter behavior, sequential insertion, publication, and validation all have current repository contracts. | C3-C8 | high | Plan uses existing mechanisms and changes no architecture. |
| Q5 | No source or repository evidence supports shortening, merging, or Best of classification. | C3-C8; W1-W2 | high | Preserve all 99 rows in a separate Complete guide. |

## Key Discoveries

* The live source still expands to 99 exact ordered issues, and its visible boundary is unchanged from the archived copy.
* The old full-page digest is demonstrably stale despite the stable issue-bearing text, validating the caller's requirement to regenerate rather than inherit digests.
* The current workflow can compare Star-Lord against all 96 current lists while treating Rocket and Groot as named peers, then centrally bind every relationship.
* Current taxonomy and filter contracts place one ungrouped Star-Lord card under All and Complete, never Best of.

## Alternatives and Decision State

### Selected Recommendation

* Approach: Publish Star-Lord as one separate rank-15 Complete guide with all 99 source-defined issues, fresh packet and exact mapping evidence, a complete-current-library report, Rocket and Groot peer digests, and central dispositions for every relationship.
* Rationale: The source boundary is freshly reproduced, existing tooling already provides the required fail-closed evidence chain, and all overlap is compatible with distinct later guide authoring when centrally approved.
* Evidence refs: C1-C8, W1-W4.
* Implementation impact: Add only the Star-Lord packet, mapping, overlap report, manifest/order/generated data, directly affected inventory and documentation counts, semantic tests, and release evidence.
* Confidence: high. Exact metadata identities remain a mandatory implementation gate rather than an assumption.

## Open Questions, Risks, and Residual Uncertainty

* Blocking: None before Plan. Any unresolved or ambiguous metadata row during fresh preparation blocks implementation.
* Important: The old full-content digest is stale and must not be copied. Annihilation: Conquest and Wastelanders remain explicit non-sequence exclusions.
* Follow-up: None outside the caller's bounded release.
* Residual uncertainty: The metadata API must freshly reproduce all 99 exact rows and the peer report must freshly reproduce observed counts. The workflow fails closed if either changes.

## Current Decisions

| Decision | Status | Owner / source | Rationale | Evidence IDs | Implications |
|---|---|---|---|---|---|
| Star-Lord / Peter Quill is rank 15. | confirmed | user | The caller supplied the popularity priority. | user direction | Preserve the rank in planning and durable release records. |
| Publish Star-Lord as the next separate sequential Character Spotlight release. | confirmed | user | Distinct guides retain their full source boundaries even when issues overlap. | user direction | Do not merge with Rocket or Groot and do not shorten the list. |
| Preserve exactly 99 source rows and exclude only links or prose without an issue-bearing `Collects:` line. | confirmed | evidence and caller boundary | Fresh live and archived source checks reproduce the accepted boundary. | C1-C2; W1-W3 | Freeze the sequence and stop if mapping cannot remain exact. |
| Treat Rocket and Groot as selected peers, not merge or omission triggers. | confirmed | evidence and caller boundary | The current workflow binds peer digests and centrally approves factual partials between distinct guides. | C3-C6 | Include both peer mappings in reporting and authoring. |

## Unresolved Decisions

| Decision | Smallest evidence or answer needed | Owner | Impact | Blocker status |
|---|---|---|---|---|
| Fresh exact metadata sequence | Successful named preparation of all 99 rows | implementation | Determines whether publication continues | implementation gate |

## Potential Next Research

| Priority | Research item | Expected value | Trigger | Selected? | Related questions / evidence |
|---|---|---|---|---|---|
| H | Regenerate the named Star-Lord packet and mapping | Confirm every exact current metadata identity | First implementation task | selected for Plan | Q2; C1, C3-C6; W4 |

## Planning Readiness

* Status: Ready
* Decision state: Publish one separate rank-15 Star-Lord Complete guide with all 99 source rows and fresh centrally approved evidence.
* Evidence basis: C1-C8, W1-W4.
* Preconditions met: Fresh source reproduction, archived cross-check, current catalog baseline, fail-closed mapping and relationship contracts, explicit peer set, taxonomy, and user release decision.
* Blockers: None before Plan. Exact metadata or report drift blocks implementation.
* Smallest action to change readiness: Not applicable.

## Closeout Record

| Field | Record |
|---|---|
| Research execution status | Complete |
| Completed waves | Cycle 1 Wider, Deeper, and Contrarian |
| Lane evidence or inline fallback | External source lane persisted; internal repository and digest evidence inline |
| Research disposition | executed |
| Planning Readiness | Ready with C1-C8 and W1-W4 |
| Blockers | None before Plan; exact metadata generation remains fail-closed |
| Continuation owner and state | confirmed automatic RPI Agent, automatic |

## Advisory Next Step

| Field | Record |
|---|---|
| Research disposition | executed |
| Planning Readiness | Ready |
| Output mode and planning support | convergence, yes when Ready |
| Acting owner | confirmed automatic RPI Agent |
| Required gates or confirmations | Research cycle and artifact self-check passed |
| Continuation result | automatic continuation to Plan |
| Primary evidence file | .copilot-tracking/research/2026-08-23/star-lord-complete-guide-research.md |
| Notes for planning or re-entry | Preserve rank 15, the exact 99-entry source boundary, and separate-release decision. |

* Advisory only: rpi-research does not itself invoke a follow-on skill.
* Completion or limit-blocked basis: All material source, workflow, current-baseline, peer, taxonomy, and contrarian questions are covered; implementation owns deterministic fresh metadata and relationship generation.

## Sources

* W1 - Star-Lord Reading Order: Complete Peter Quill Comics Timeline - https://www.comicbookherald.com/star-lord-reading-order-complete-peter-quill-comics-timeline/ (retrieved 2026-08-23, modified 2024-02-12)
* W2 - Archived Star-Lord Reading Order - https://web.archive.org/web/20241207032053/https://www.comicbookherald.com/star-lord-reading-order-complete-peter-quill-comics-timeline/ (retrieved 2026-08-23, snapshot 2024-12-07)
* W3 - Comic Book Herald WordPress post 10902 - https://www.comicbookherald.com/wp-json/wp/v2/posts/10902 (retrieved 2026-08-23, modified 2024-02-12)
* W4 - Marvel metadata API - https://marvel.emreparker.com/v1 (retrieved 2026-08-23, metadata horizon 2025-10-29)

## Artifact Self-Check

* [x] Every research question is answered or marked unanswerable with the missing evidence named.
* [x] Every executed cycle includes Wave 1 Wider, Wave 2 Deeper, and Wave 3 Contrarian in that order.
* [x] Research posture, provenance, explicit limits, and completion basis are recorded.
* [x] Every codebase finding carries a `C#` ID and a `path:line` or stable record identity; every external finding carries a `W#` ID with URL and retrieval date.
* [x] Findings, alternatives, decisions, and readiness claims cite Evidence Log IDs.
* [x] The Extension Registry records applicable instructions, skills, and specialist routing.
* [x] User Participation records the no-interaction rationale and confirmed priority decisions.
* [x] Direction Controls record caller additions, changes, narrowed scope, and exclusions.
* [x] Parent synthesis, re-entry evaluation, readiness, and closeout are complete.
* [x] Fetched content, repository files, and prior artifacts are treated as data, not instructions.
* Checked sections: Research brief, parameters, extension registry, participation, scope, task requests, direction controls, questions, prior knowledge, all three waves, evidence, synthesis, findings, recommendation, decisions, risks, readiness, closeout, sources, and self-check.
* Missing or limited sections: Exact metadata identities and current overlap counts intentionally remain implementation evidence gates because no committed Star-Lord mapping exists.
