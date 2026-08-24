<!-- markdownlint-disable-file -->

# Task Research: repeated-source-occurrences

| Field | Value |
|---|---|
| Date | 2026-08-23 |
| Researcher / agent | hve-core:rpi-research under delegated autopilot coordination |
| Status | Complete |
| Artifact path | `.copilot-tracking/research/2026-08-23/repeated-source-occurrences-research.md` |
| Task ID | MRT-002-C09-DUP |
| Baseline | Current project default `main`; primary historical evidence commit `06c2a5b6d6367706d241fcbefe41ce71aaa08f02` |

## Research Brief

* What to research: Resolve the architecture blocker created when one source names the same comic in more than one intentional source position. Trace the frozen packet, mapping, resolution, overlap, approval, authoring, freshness-digest, Markdown-provenance, and final-order contracts. Compare the Iron Man, Old Man Logan, and Planet Hulk / World War Hulk cases.
* Why it matters: The current workflow requires unique selected issue ids, but silently discarding a repeated source mention would lose provenance and make accidental data-entry duplication indistinguishable from intentional repetition.
* Audience or intended use: An implementation-ready RPI Plan, one critique, shared implementation, one Iron Man release, one independent Review, PR, hosted CI, merge, and the parent reading-list-expansion session.
* Scope: Current `main`; historical evidence in commit `06c2a5b6d6367706d241fcbefe41ce71aaa08f02`; current CBH modern and character flows; the historical CBRO provider flow; existing packet, mapping, overlap, approval, authoring, digest, Markdown, and order-output contracts; read-only scratch simulation.
* Non-goals during Research: Production, source-data, generated-data, documentation, or test changes. Non-goals for the eventual release: Old Man Logan or Planet Hulk product cards; weakening unique selected issue ids; silent deduplication; more than one critique or one independent Review.
* Criteria: Preserve every source occurrence and its provenance; emit each comic once; make repetition explicit and auditable; deterministically identify the one canonical output placement; bind all source references into freshness; reject accidental duplicates; preserve mapping and overlap uniqueness; remain backward-compatible for existing CBH and CBRO packets.
* Requested outputs: Selected schema design, rejected alternatives, exact acceptance criteria and failure cases, risks, migration impact, exact likely files, implementation order, a failure-proof strategy, and a determination whether one implementation safely unblocks all three candidates. If safe, later phases implement it and publish Iron Man alone only when all 815 occurrences and 813 distinct issues map exactly.
* Output mode: convergence.

## Research Parameters

| Field | Value |
|---|---|
| Research question(s) | What is the smallest backward-compatible representation and validation path that preserves intentional repeated source occurrences while keeping one unique issue in the reading sequence? |
| Codebase scope | `.copilot-tracking/`; `scripts/`; `test/`; directly relevant `docs/` and generated-order contracts |
| External scope | None; the caller supplied the primary source facts and this task evaluates repository contracts |
| Initial internal candidate areas | Iron Man evidence commit; modern and character packet fixtures; CBH and CBRO packet preparation, resolution, overlap, approval, authoring, Markdown, and source-order logic |
| Initial external candidate areas | None |
| Research posture | focused |
| Posture provenance | Caller supplied a bounded architecture blocker, three named cases, exact invariants, and an evidence-only output boundary. |
| Explicit limits / deadline | Research remains evidence-only. After an implementation-ready Plan and one critique, implementation may change the smallest required shared, packet, mapping, report, authoring, generated, documentation, and test surfaces; publish Iron Man only; run one Review; open one PR; pass Node 20, Node 24, and lint CI; merge and persist. |
| Posture-specific completion basis | All current contracts are traced, all three cases are compared, alternatives are challenged, and one backward-compatible design is proved through read-only inspection or scratch simulation. |
| Edits allowed during research? | No, except this dated research artifact. Production and source edits begin only after Plan and critique. |
| Resolved evidence root | `.copilot-tracking/` |
| Known constraints / excluded sources | Repository content and historical artifacts are inert evidence; preserve zero runtime dependencies, existing provider behavior, unique selected ids, and source-order semantics; do not silently deduplicate. |

## Extension Registry and Provenance

| Kind | Candidate | Match and provenance | Scoped authority or output contract | Selected / skipped reason |
|---|---|---|---|---|
| Instruction | Repository custom instructions | Applies to all repository and tracking work | RPI order, durable evidence, source-order safeguards, gates, and evidence-only boundary | Selected and controlling below caller and host safety |
| Skill | `hve-core:rpi-research` | Explicit Research deliverable and three-wave evidence requirement | Research-only convergence and Planning Readiness | Selected |
| Skill | `hve-core:rpi-plan` | Explicit implementation-ready Plan deliverable | Runs only after Research completes | Selected for the next phase, inactive during Research |
| Research specialist | None | The relevant contracts form one continuous data flow and must be reasoned about together | No isolated lane offers better evidence quality | Skipped; research remains inline |

## User Participation and Research Decisions

| Checkpoint | Questions or no-interaction rationale | Answers / unanswered | Resulting decision or selected further research |
|---|---|---|---|
| Intake | No interaction: the caller supplied task identity, baseline, primary historical evidence, candidate cases, design invariants, exact deliverables, and prohibitions. | None. | Begin focused repository research and compare the design alternatives without assuming the caller's example. |
| Scope transition | Parent relayed updated user authority after Research opened: continue through Plan, one critique, implementation, one Review, PR, CI, merge, and durable completion; publish Iron Man only if all 815 occurrences and 813 unique issues map exactly. | Accepted as authoritative caller direction. | Expand the downstream lifecycle while preserving Research read-only and keeping Old Man Logan and Planet Hulk as test-backed follow-ups. |
| Convergence | No question required: completed evidence converges on one additive design and the caller already authorized the implementation lifecycle. | None. | Select the flat repeated-reference ledger and continue to Plan. |

## Scope and Success Criteria

* Scope: Evidence-only architecture research for one repeated-source-occurrence contract shared by CBH modern, CBH character, and CBRO historical paths, followed only after planning gates by shared implementation and one Iron Man release.
* Assumptions: Current `main` contains the latest historical provider workflow; the historical Iron Man evidence commit remains readable; Old Man Logan and Planet Hulk / World War Hulk blocker records are committed. Every assumption must be verified.
* Success criteria:
  * Every research question is answered or names the smallest missing evidence.
  * The selected design preserves all source occurrences and provenance while producing one unique comic sequence.
  * Freshness, validation, mapping, overlap, approval, authoring, Markdown, and generated-order consequences are explicit.
  * Iron Man, Old Man Logan, and Planet Hulk / World War Hulk each have exact acceptance and failure cases.
  * Alternatives are compared and challenged.
  * Scratch simulation proves the proposed normalization and rejection rules against representative inputs.
  * No production or source file changes occur during Research.
  * Downstream implementation publishes Iron Man only if 815 exact source occurrences normalize to 813 unique exact mappings; otherwise it records the genuine blocker and stops.

## Task Research Requests

* Explicit requests: Use task MRT-002-C09-DUP and slug `repeated-source-occurrences`; preserve every source occurrence and provenance; emit each comic once; forbid silent deduplication; define deterministic canonical placement; digest every source reference; keep mapping and overlap ids unique; reject accidental duplicates; distinguish intentional repetition; preserve CBH and CBRO behavior; derive complete acceptance criteria; prove the design read-only. Updated authority continues through Plan, one critique, implementation, one Review, one Iron Man PR, hosted CI, merge, and durable completion if all 815 occurrences and 813 distinct issues resolve exactly.
* Inferred research questions: Where is packet uniqueness currently enforced? Which digest includes source rows? Which artifacts carry source prose into Markdown? Can one optional occurrence-level annotation preserve old packet schemas? Does a group object add authority not already present in packet order?
* Caller constraints and non-goals: Research is evidence-only; do not assume occurrence groups or a repeated-reference field without comparison. Eventual implementation publishes Iron Man only and leaves Old Man Logan and Planet Hulk as follow-ups.

## Direction Controls

| Control type | Direction or boundary | Source / checkpoint | Effect on active brief, evidence, or revalidation |
|---|---|---|---|
| add | Use task ID MRT-002-C09-DUP and slug `repeated-source-occurrences`. | Caller | All new artifacts use one stable identity. |
| add | Treat Iron Man commit `06c2a5b6d6367706d241fcbefe41ce71aaa08f02` as primary historical evidence. | Caller | Reproduce the 815 occurrences / 813 distinct issues result and inspect its exact blocker rationale. |
| add | Assess Old Man Logan #19 and #25 plus Planet Hulk / World War Hulk repeated sections. | Caller | The design must cover all three blocker shapes or state why one cannot. |
| narrow | Preserve every occurrence but emit each comic once. | Caller | Occurrence provenance and canonical sequence identity become separate contracts. |
| exclude | No silent deduplication. | Caller | Repeated identities require explicit intent and validation; unannotated repeats fail. |
| narrow | Bind every repeated source reference into freshness digests while keeping selected issue ids unique. | Caller | Packet occurrence data participates in digesting; mapping and overlap operate on canonical unique ids. |
| narrow | Preserve CBH modern/character behavior and the historical CBRO provider flow. | Caller | Existing packets without repeated occurrences remain valid and byte-equivalent in meaning. |
| change | Research remains read-only, but eligible downstream phases may implement and release after an implementation-ready Plan and one critique. | Parent-relayed updated user direction | Finish Research first, then Plan and critique; do not edit source before those gates. |
| narrow | Publish Iron Man only in this PR, and only if all 815 occurrences normalize to 813 exact unique mappings. | Parent-relayed updated user direction | Old Man Logan and Planet Hulk supply regression shapes only and remain later product follow-ups. |
| add | Run required failure proofs, full gates, one independent Review, current-main reconciliation, one PR, Node 20/24/lint CI, merge, and durable completion. | Parent-relayed updated user direction | The Plan must carry the complete release lifecycle and stop on any genuine occurrence or mapping blocker. |

## Research Questions

| # | Sub-question | Type | Priority | Status |
|---:|---|---|---|---|
| Q1 | What exact repeated-occurrence evidence and blocker decisions exist for Iron Man, Old Man Logan, and Planet Hulk / World War Hulk? | depth | H | answered |
| Q2 | What are the current packet, resolution, mapping, freshness, overlap, approval, authoring, Markdown, and output-order contracts across CBH and CBRO? | depth | H | answered |
| Q3 | Which representation is the smallest backward-compatible way to distinguish intentional repetition from accidental duplicate entry? | breadth | H | answered |
| Q4 | What deterministic canonical-placement and digest rules preserve provenance without duplicate output ids? | depth | H | answered |
| Q5 | What exact acceptance criteria, failure cases, migration impact, likely files, implementation order, and proof strategy are required? | depth | H | answered |
| Q6 | What counter-evidence could show that one shared implementation is unsafe or that the selected schema is overbuilt? | depth | H | answered |

## Prior Knowledge Gate

* Existing artifacts reviewed: The Iron Man evidence commit; current frozen packets, mappings, reports, authorers, resolvers, packet validator, CBRO provider adapter, tests, and Character Spotlight research; historical Old Man Logan and Planet Hulk candidate commit `8a3c8629253e079e117fc7218b5b9bc8a070d876`.
* Reused (verified): Iron Man has 815 source occurrences and 813 distinct identities. Old Man Logan has 98 occurrences and 96 distinct identities after #19 and #25 each recur. Planet Hulk has 109 occurrences and 104 distinct identities after World War Hulk #1-5 recur. The current shared resolver, overlap reporter, and authorers require unique selected issue ids.
* Superseded / stale: Commit `8a3c8629253e079e117fc7218b5b9bc8a070d876` is not an ancestor of current `main`; its packet files are design evidence, not implementation state. Its prose-only removal of repeated references does not satisfy the caller's explicit auditable-occurrence requirement.

## Research Cycle Log

### Cycle 1

* Active direction controls: All controls above.
* Active research posture and completion basis: focused; trace the full current contract, compare all three cases, test alternatives, and converge on one implementation-ready design.
* Explicit limits or deadline effect: Research remains read-only outside this artifact and may use only scratch analysis for simulation. Release authority does not permit early source edits.

#### Wave 1: Wider

* Plan and independent lanes: Inspect the named evidence, identify all current contract owners, and inventory how source rows become selected ids, overlap evidence, Markdown provenance, and output order.
* Worker evidence relationships or inline fallback: Inline because the named contracts are one continuous chain.
* Reflection: Both providers converge on `validateFrozenPacket`, `resolveMapping`, `buildReportForMapping`, `assertApprovedRelationshipReview`, unique selected-id authoring, and digest chaining. A packet currently has one row per output comic, `expectedCount` equals `rows.length`, and the manifest count equals the same unique count. The packet digest hashes every accepted packet field, while the mapping, report, and approval digests chain that packet identity forward. Mapping, overlap, Markdown, generated payload, and catalog counts all consume the unique mapping rows. CBRO adds provider identity and an exact source-content digest but delegates the same packet contract. Existing repeated references are represented only as exclusion prose: current Groot records eight later mentions as excluded, and the unmerged Old Man Logan / Planet Hulk candidate packets did the same for two and five repeats. That prose is digest-bound but cannot machine-validate the target issue, source occurrence position, or first-occurrence placement. Evidence: C2-C13.

#### Wave 2: Deeper

* Parent-prioritized material from Wave 1: The smallest additive packet representation, deterministic first-occurrence placement, exact validation rules, mapping mirroring, digest propagation, and conditional Markdown provenance.
* Plan and independent lanes: Compare occurrence groups, duplicate packet rows with canonical flags, prose-only exclusions, and an explicit repeated-reference ledger. Define exact identities, positions, counts, and stale-evidence behavior. Simulate representative Iron Man, Old Man Logan, Planet Hulk, accidental-duplicate, stale-digest, and old-packet cases in memory.
* Worker evidence relationships or inline fallback: Inline. The contained simulation used current digest helpers and validators plus an in-memory proposed validator; it wrote no file.
* Reflection: The smallest safe model is an optional top-level repeated-reference ledger beside the canonical packet rows. `expectedCount`, manifest `expect`, mapping rows, selected ids, overlap counts, Markdown checklist rows, payload items, and catalog counts remain distinct-issue counts. `sourceOccurrenceCount` records the larger source total. Each `repeatedSourceReferences` entry records one later `sourcePosition`, one earlier one-based `canonicalRow`, the raw issue and range references, and normalized title/year/issue identity matching the canonical row. The packet digest automatically binds the ledger. Preparation mirrors both occurrence fields into the mapping, sets `approvedSourceCount` to the occurrence count, and includes the mirrors in the mapping digest. Reports and approvals retain their existing digest chain. Authoring verifies packet-to-mapping equality and emits one conditional provenance sentence while still generating only canonical mapping rows. Existing packets and mappings omit the optional fields and keep their current digest values. The simulation accepted 815/813, 98/96, and 109/104, kept current CBH and CBRO packets valid, rejected four malformed shapes, and proved a repeated-reference mutation changes both packet and chained mapping digests. Evidence: C2-C15.

#### Wave 3: Contrarian

* In-scope challenge targets and boundaries: Challenge whether prose-only exclusions are sufficient, whether duplicate packet rows with a canonical flag are simpler, whether occurrence groups add needed authority, whether first occurrence can misplace Planet Hulk, whether optional fields silently weaken old packets, whether CBRO needs a separate design, and whether duplicate validation should run only when a repeat ledger exists.
* Plan and independent lanes: Inspect current and historical examples against each alternative; scan every current frozen packet for pre-resolution canonical identity collisions; re-run malformed simulations; verify current digest selection behavior when optional fields are absent; inspect CBRO inventory source-count semantics and current Markdown generation.
* Worker evidence relationships or inline fallback: Inline because each challenge targets the same schema seam.
* Reflection: Prose-only exclusion is disproved because it carries no machine-checkable source position or canonical target. Duplicate packet rows plus a canonical flag is more invasive and creates the exact risk the current resolver, overlap reporter, and authorers reject. Occurrence groups duplicate each canonical row and add nesting without supporting a case the flat ledger cannot express. First occurrence fits all three blockers; Planet Hulk's first occurrence is also the specific interleaved placement, while its later repeat is the broad restatement. Existing packets remain unchanged because absent optional fields do not enter selected mapping digests, but canonical-row duplicate detection must run for every packet, not only packets with a ledger. The first simulation placed that check after an absent-ledger early return and let an accidental duplicate pass; correcting the order made the negative case fail. All current frozen CBH and CBRO packets pass the proposed canonical identity scan. CBRO can reuse the same schema; its inventory `sourceRowCount` should compare to `sourceOccurrenceCount` when present and `expectedCount` otherwise. Evidence: C2-C8, C11-C16, W1.

#### Parent Synthesis and Disposition

| Material / claim | Evidence IDs or worker pointers | Parent disposition | Evidence-based rationale | Primary-artifact treatment |
|---|---|---|---|---|
| Optional flat repeated-reference ledger | C2-C16, W1 | accepted | It adds auditable occurrence evidence at the packet freshness root while preserving every unique downstream identity contract. | Selected recommendation |
| First occurrence as canonical placement | C9-C11, C14 | accepted | All named cases repeat an earlier identity; Planet Hulk's earlier placement is also the more specific interleaved order. | Deterministic policy |
| Prose-only exclusions | C10-C12 | rejected | Exclusion prose cannot validate source position, canonical target, or identity and conflates intentional repetition with omission. | Migrate Groot; do not use for new repeats |
| Duplicate packet rows plus canonical flags | C5-C7, C13-C15 | rejected | It forces every downstream consumer to filter correctly and weakens the safest existing uniqueness boundary. | Keep packet rows canonical and unique |
| Occurrence groups | C2, C13-C15 | rejected | They repeat canonical row data and add nesting without adding authority or supporting another required shape. | Do not implement |
| Shared CBH and CBRO implementation | C2-C8, C15-C16 | accepted | Both providers delegate to the same packet and downstream contracts; one optional schema preserves existing provider behavior. | One implementation |

#### Cycle Re-entry Evaluation

* Another complete three-wave cycle needed: no.
* Trigger or stop basis: The focused architecture questions, all named blocker shapes, provider compatibility, migration risk, negative cases, and digest behavior are covered. Additional source research would not change the selected representation.
* Revised brief or revalidation required: The parent-authorized lifecycle now includes implementation and Iron Man publication after Plan and critique. Research conclusions remain unchanged; Plan must add a stop gate if any of the 813 distinct issues cannot resolve exactly.
* Readiness effect: Ready for implementation planning.

## Evidence Log

* Delegation: Inline because all named code paths participate in one data contract.

### Codebase Evidence

| ID | Claim / finding | Location | Tool | Confidence | Notes |
|---|---|---|---|---|---|
| C1 | The primary historical commit records only dated tracking evidence and no production implementation. | Commit `06c2a5b6d6367706d241fcbefe41ce71aaa08f02` | `git show --stat` | high | Three files, all under `.copilot-tracking/`. |
| C2 | Frozen packets accept only named top-level fields; `expectedCount` must equal `rows.length`, and the manifest `expect` must equal that unique count. | `scripts/lib/cbh-inventory.mjs`, `PACKET_FIELDS`, `validateFrozenPacket`, and `assertManifestProposal` | read | high | An optional top-level field requires one shared schema extension but need not change existing packets. |
| C3 | `packetDigestFor` hashes the complete packet except its digest, so any accepted repeated-reference field is automatically freshness-bound. | `scripts/lib/cbh-inventory.mjs`, `packetDigestFor` | read | high | No separate repeated-reference digest is needed. |
| C4 | The mapping digest covers the packet digest, approved source count, exclusions, manifest, metadata, and rows; report and approval digests then bind packet, mapping, library, peers, and dispositions. | `scripts/lib/cbh-inventory.mjs`, digest field sets and digest helpers; `scripts/author-cbh-packet.mjs`, `assertApprovedRelationshipReview` | read | high | Mirroring repeated-reference evidence into mappings would permit downstream rendering and add direct mapping freshness, while the packet digest already supplies transitive freshness. |
| C5 | Resolution rejects any repeated selected issue id after exact row resolution. | `scripts/lib/cbh-resolution.mjs`, `validateResolvedMapping`; `scripts/resolve-cbh-order.mjs`, `resolveMapping` | read | high | This guard must remain unchanged. |
| C6 | Overlap reporting separately rejects duplicate candidate ids and duplicate ids in compared orders or peers. | `scripts/lib/cbh-overlap.mjs`, `buildComparisonReport`; `scripts/report-order-overlap.mjs`, `buildReportForMapping` | read | high | Repeated occurrence evidence must stay outside overlap identity arrays. |
| C7 | Both authorers build Markdown and generated payloads from mapping rows, and both require unique selected ids before output. | `scripts/author-cbh-packet.mjs`, `selectedIssueIds`, `buildMarkdown`, and `authorPacket`; `scripts/author-cbro-packet.mjs`, `buildCbroMarkdown` and `authorCbroPacket` | read | high | Unique mapping rows are the correct canonical output seam. |
| C8 | CBRO delegates packet validation, mapping resolution, overlap approval, and selected-id authoring to the CBH shared contracts, adding provider identity and source-content freshness. | `scripts/lib/cbro-evidence.mjs`, `validateCbroPacket`; `scripts/prepare-cbro-event.mjs`, `buildCbroMapping`; `scripts/author-cbro-packet.mjs` | read | high | One shared optional schema can support both providers. |
| C9 | Iron Man E65 and E67 repeat Tony Stark: Iron Man #15-16 at source positions 708-709 and 716-717, producing 815 occurrences but 813 distinct identities. | Commit `06c2a5b6d6367706d241fcbefe41ce71aaa08f02`, Iron Man primary research and source-boundary ledger | `git show` | high | The later E67 references are exact source evidence and cannot be dropped. |
| C10 | Old Man Logan repeats #19 and #25 as the closing and later opening issue of adjacent collected ranges; its candidate packet kept canonical rows 39 and 52 and omitted two repeated occurrences, yielding 96 unique rows from 98 occurrences. | Commit `8a3c8629253e079e117fc7218b5b9bc8a070d876`, `old-man-logan-reading-order` packet and mapping | `git show` plus JSON inspection | high | Repeated source positions are 47 and 60 when reconstructed from the full occurrence sequence. |
| C11 | Planet Hulk first places World War Hulk #1-5 inside the specific interleaved Greg Pak sequence at canonical rows 27, 29, 31, 34, and 36, then restates #1-5 as a broad block, yielding 104 unique rows from 109 occurrences. | Commit `8a3c8629253e079e117fc7218b5b9bc8a070d876`, Planet Hulk packet and mapping | `git show` plus JSON inspection | high | The repeated block occupies source positions 39-43; first occurrence is also the more specific placement. |
| C12 | The shipped Groot packet has 84 source mentions and 76 distinct issues but stores the eight later Annihilators mentions only in `excludedSourceReferences`. | `scripts/data/cbh-packets/groot-reading-order.json`; `.copilot-tracking/research/2026-08-23/groot-complete-guide-research.md`, completed cycle | read | high | It is the required backward-compatibility migration case and proves this is not only a future-candidate concern. |
| C13 | Existing tests equate packet rows, mapping rows, report candidate count, Markdown checklist count, generated payload count, and manifest expectation with distinct selected issues. | `test/cbh-batch.test.js`, `test/cbh-character-spotlight.test.js`, and `test/cbro-historical-events.test.js` | read | high | The selected design should preserve these count contracts and add a separate source-occurrence count. |
| C14 | A contained in-memory simulation accepted Iron Man 815/813, Old Man Logan 98/96, and Planet Hulk 109/104; rejected accidental canonical duplicates, forward targets, identity mismatches, and duplicate source positions; preserved current CBH and CBRO validation; and proved occurrence mutation stales packet and chained mapping digests. | Research-cycle scratch execution, no file written | `node --input-type=module -` using current digest and validation modules | high | The first run exposed an early-return bug in the proposed validation order; the corrected run passed all positive and negative cases. |
| C15 | No current frozen CBH or CBRO packet contains a duplicate canonical identity under candidate issue id, series id plus issue number, or normalized title/year/issue fallback. | `scripts/data/cbh-packets/*.json` and `scripts/data/cbro-packets/*.json` | read-only Node scan | high | Always-on packet duplicate detection is backward-compatible with current data. |
| C16 | CBRO inventory records a `sourceRowCount` and validates it against packet `expectedCount`; a repeated source needs that comparison to prefer `sourceOccurrenceCount` when present. | `scripts/lib/cbro-evidence.mjs`, `validateCbroPacket`; `scripts/data/cbro-historical-inventory.json` | read | high | No separate provider schema is needed. |

### External Evidence

| ID | Claim / finding | Source | URL | Retrieved | Version/date | Confidence |
|---|---|---|---|---|---|---|
| W1 | Groot's later Annihilators #1-4 and Earthfall #1-4 blocks occur after the canonical opening collection and after the Star-Lord block, so the eight repeats occupy source positions 72-79 and target canonical rows 8-15. | Groot Reading Order, WordPress post 10910 | https://www.comicbookherald.com/wp-json/wp/v2/posts/10910 | 2026-08-23 | Modified 2024-01-30 | high |

### Contradictions / Conflicts

* The first scratch validator checked canonical-row uniqueness only after detecting a repeat ledger. A packet with no ledger and two accidental canonical duplicates therefore passed the proposal. Moving canonical uniqueness before the optional-ledger branch fixed the failure. This is a required implementation ordering, not a residual issue.
* Historical Old Man Logan and Planet Hulk candidate packets described repeated whole issues as exclusions. That evidence established first placements and counts, but the representation conflicts with the updated no-silent-deduplication requirement and is rejected.

## Findings Mapped to Questions and Evidence

| Question | Finding | Evidence IDs | Confidence | Decision or readiness implication |
|---|---|---|---|---|
| Q1 | All three blockers are repeated source occurrences of already represented issue identities, with exact counts and canonical first placements. | C9-C11 | high | One occurrence-evidence model can cover the three shapes. |
| Q2 | Packet evidence is the only seam that can retain provenance without weakening unique mapping, overlap, Markdown checklist, payload, or catalog identities. | C2-C8, C13 | high | Extend packet evidence and propagate it through existing digests; do not relax downstream uniqueness. |
| Q3 | An optional flat repeated-reference ledger is the smallest representation that preserves all provenance without moving duplicates into canonical rows. | C2-C15 | high | Select it; reject groups, flagged duplicate rows, and prose-only exclusions. |
| Q4 | First occurrence is canonical; every later occurrence points backward by source position and canonical row, and both packet and mapping digests bind the ledger. | C3-C4, C9-C14 | high | Output order stays unique and deterministic; stale occurrence evidence blocks approval. |
| Q5 | Implementation must extend shared validation and preparation, mirror freshness, conditionally update Markdown provenance, migrate Groot, cover both providers and all three blocker shapes, then gate Iron Man publication on 813 exact unique mappings. | C2-C16, W1 | high | Planning can name exact tasks, owners, files, failure cases, and stop conditions. |
| Q6 | The main counter-risk is weakening uniqueness by filtering duplicates too late. Keeping canonical rows unique and always validating them refutes that design. | C5-C7, C14-C15 | high | One shared implementation is safe; no resolver or overlap relaxation is permitted. |

## Key Discoveries

* A repeated source occurrence is evidence about why one canonical comic was named more than once, not a second reading-sequence item.
* The packet digest already provides the correct freshness root; the missing capability is a machine-validated occurrence ledger, not a new deduplication algorithm.
* Groot is a shipped current-main example of the same architectural gap and must be migrated from 84 mentions / 76 unique issues without changing its 76-item output.
* `approvedSourceCount` should become the occurrence count for repeated-source packets, while `expectedCount` remains the distinct output count.
* CBRO needs only one compatibility branch for inventory source count; every other occurrence rule remains shared.

## Alternatives and Decision State

### Selected Recommendation

* Add optional `sourceOccurrenceCount` and `repeatedSourceReferences` fields to frozen packets without changing `schemaVersion: 1`.
* Keep `rows` canonical and unique. `expectedCount` and manifest `expect` remain `rows.length`.
* Define each repeated-reference record with exactly:
  * `sourcePosition`: one-based position in the fully expanded source occurrence sequence.
  * `canonicalRow`: one-based row in the unique packet sequence.
  * `sourceIssueReference`: raw repeated issue reference.
  * `sourceRangeReference`: raw repeated range or `null`.
  * `normalizedSeriesTitle`, `seriesYear`, and `issueNumber`: normalized identity that must match the canonical row.
* Require first-occurrence placement: source positions are unique, in range, and reconstruct the canonical row sequence; every repeated record points to a canonical row encountered earlier.
* Reject duplicate canonical packet identities for every packet, whether or not the optional ledger exists.
* Mirror both occurrence fields into prepared mappings, set `approvedSourceCount` to `sourceOccurrenceCount` when present, include the mirrors in mapping digests, and require exact packet-to-mapping equality before approval or authoring.
* Leave resolver, overlap, peer, selected-id, Markdown checklist, payload, and catalog uniqueness unchanged.
* Add a conditional Markdown provenance sentence that states total occurrences, intentional repeat count, and first-occurrence-only output. Keep existing no-repeat Markdown byte-equivalent.
* For CBRO inventory validation, compare `sourceRowCount` with `sourceOccurrenceCount` when present and `expectedCount` otherwise.
* Migrate Groot's eight later references into the ledger and refresh its digest chain without changing its selected sequence, overlap relationships, card, or payload.
* Use the same shared contract to create Iron Man evidence with 815 occurrences and 813 canonical rows. Publish only after all 813 rows resolve exactly and every current-library and peer relationship is freshly reviewed.

### Alternatives Evaluated

| Alternative | Benefits | Costs / risks | Evidence | Decision state |
|---|---|---|---|---|
| Occurrence groups | One object can collect all references for one issue. | Duplicates canonical row data, adds nesting and group-order rules, and offers no benefit for the three later-repeat shapes. | C2, C9-C15 | rejected |
| Duplicate packet rows with `canonical` / `repeatsRow` flags | Preserves one natural occurrence array. | Forces preparation, resolution, overlap, authoring, counts, and every future consumer to filter safely; one missed filter emits duplicates. | C5-C7, C13-C15 | rejected |
| Prose in `excludedSourceReferences` | No shared code change. | Cannot validate positions, targets, identity, or completeness and falsely labels required evidence as excluded. | C10-C12 | rejected |
| Flat `repeatedSourceReferences` ledger | Additive, explicit, machine-checkable, digest-bound, and keeps canonical rows unchanged. | Requires two optional fields, mapping mirroring, conditional provenance, and one Groot migration. | C2-C16, W1 | selected |

## Current Decisions

* Settled by caller: preserve all source occurrences and provenance, emit each issue once, keep selected ids unique, reject accidental duplicates, and forbid silent deduplication.
* Settled by updated caller direction: after planning gates, implement the smallest safe contract and publish Iron Man alone if every occurrence and distinct issue maps exactly; keep Old Man Logan and Planet Hulk as test-backed follow-ups.
* Research decision: select the flat repeated-reference ledger and first-occurrence canonical placement.

## Open Questions and Risks

* Iron Man metadata availability remains unproven because the earlier lane stopped before resolution. Implementation must stop without publication if any of the 813 canonical rows is unmatched, ambiguous, post-horizon, or otherwise non-exact.
* A schema can validate internal occurrence consistency but cannot discover a source occurrence an author never recorded. Central source review, the frozen issue-bearing source digest, exact candidate tests, and the Iron Man 815-count assertion remain required.
* Groot's digest-chain migration will stale its mapping, overlap report, approval, and generated Markdown even though its 76 selected ids do not change. The implementation must regenerate and review those artifacts coherently.
* Iron Man is large: 813 unique rows create review and file-size risk. Use the existing source ledger and deterministic range expansion, but do not introduce a runtime parser or infer missing entries.
* Old Man Logan and Planet Hulk are architecturally unblocked but remain product follow-ups. Their tests prove schema shape only; they still need candidate-specific metadata and overlap review before future publication.

## Potential Further Research

* No further architecture research is needed. Candidate-specific Iron Man metadata and overlap evidence belongs to implementation under the explicit stop gate.

## Planning Readiness

* Status: Ready.
* Basis: All questions are answered; Wider, Deeper, and Contrarian waves completed; the corrected simulation covers all named positive and negative shapes; current packet compatibility and both providers are traced.
* Blocking items: None for planning. Iron Man exact mapping remains an implementation-time release gate, not a planning gap.

## Research Disposition

* Complete under convergence mode.
* Selected recommendation: optional flat repeated-reference ledger with first-occurrence canonical placement and unchanged downstream uniqueness.
* Continuation owner: this session completes Research, creates the RPI Plan and phase details, runs one critique, and proceeds automatically through eligible implementation and release gates unless a genuine blocker appears.

## Sources

* Current repository `main`, commit `06c2a5b6d6367706d241fcbefe41ce71aaa08f02`, and historical candidate commit `8a3c8629253e079e117fc7218b5b9bc8a070d876`.
* Groot WordPress post 10910 at https://www.comicbookherald.com/wp-json/wp/v2/posts/10910, retrieved 2026-08-23.

## Self-Check

* [x] Task identity, scope, non-goals, criteria, and limits are durable.
* [x] Wider, Deeper, and Contrarian waves completed in order.
* [x] Every research question is answered or blocked with exact missing evidence.
* [x] Findings cite stable evidence IDs.
* [x] Alternatives are compared and one recommendation is selected.
* [x] Planning Readiness and Research Disposition are final.
