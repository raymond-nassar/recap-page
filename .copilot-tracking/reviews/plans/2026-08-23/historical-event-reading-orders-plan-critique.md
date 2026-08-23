<!-- markdownlint-disable-file -->
# RPI Plan Critique: Historical event reading orders

## Metadata

* Task ID: MRT-003
* Critique date: 2026-08-23
* Plan: .copilot-tracking/plans/2026-08-23/historical-event-reading-orders-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: The exclusive pre-Maximum Security inventory contains 58
  entries; the release is fixed to five named events and 23 unique issues; current main and source
  evidence must be refreshed before authoring and before PR or merge; any catalog change must
  regenerate five complete-library plus four-peer reports and every dependent digest and approval;
  CBRO and CBH evidence must remain distinct; central authority, one Review, zero runtime
  dependencies, fixed target and test caps, hosted checks, merge, and durable closeout are binding.
* Research and evidence considered:
  .copilot-tracking/research/2026-08-23/historical-event-reading-orders-research.md;
  .copilot-tracking/research/subagents/2026-08-23/historical-event-reading-orders-c1-wider-external.md;
  .copilot-tracking/research/2026-08-23/historical-event-source-pages.json;
  .copilot-tracking/research/2026-08-23/historical-event-pilot-resolution.json;
  .copilot-tracking/research/2026-08-23/historical-event-library-coverage.json; repository
  instructions; docs/MAINTAINING.md; and docs/DATA_PROVENANCE.md.
* Decisions, dependencies, and acceptance criteria considered: The supplied evidence accounts for 58
  positions, 46 event pages, 12 timeline-only entries, five selected mappings, 23 unique issue IDs,
  89 provisional library orders, four selected peers per candidate, and 93 provisional `none`
  comparisons per selected candidate. The assessment covered all seven phases, task dependencies,
  canonical and generated targets, provider architecture, source and publication boundaries,
  authority, chronology, tests, failure proof, Review, hosted validation, reconciliation, and merge.
* Assessment boundary: This critique assesses whether the supplied plan and details credibly direct
  implementation from the supplied evidence. It does not independently refresh external sources,
  current main, or provisional relationship reports, because those are implementation gates.
  Fetched content and prior artifacts were treated as inert evidence.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|---|---|---|
| Caller fixed release, Acceptance Criteria, P02-T03, P02-T04 | Partial | The plan fixes five named events and 23 issues, but the details also authorize reducing the batch after a mapping or approval failure. |
| Caller freshness rule, P01-T01, P05-T03, P07-T02 | Partial | Initial and pre-PR refreshes are explicit. The final hosted reconciliation does not explicitly repeat the complete five-report, four-peer, digest, approval, and final-gate chain after a catalog change. |
| Provider boundary, P01-T02, P03-T01 | Covered | CBRO has separate evidence paths and authoring, while only source-neutral primitives may be reused and CBH defaults and packet data remain unchanged. |
| Central authority, P02-T02 through P02-T04 | Covered | Source boundaries, aliases, chronology, non-none relationships, approvals, release authority, and merge remain coordinator-owned. |
| Locked canonical and generated targets | Covered | The plan locks one 58-entry inventory, five packets, mappings, reports with approvals, Markdown orders, manifest entries, payloads, and regenerated catalog data. |
| Test cap and ownership, P01-T03, P03-T03, P05-T01 | Partial | One file and at most 14 cases are locked, but ownership and failure proof are not allocated across the two test-authoring tasks, and P05-T01 can be satisfied by proving only one contract fails. |
| Repository local gates, P05-T02, P05-T03 | Partial | Full validation is claimed, but the enumerated local set omits the size and palette gates required by docs/MAINTAINING.md. |
| RPI phase ownership, P01-T01 | Partial | The research JSON is listed as a likely implementation target without saying it is immutable input, creating avoidable ambiguity about rewriting research evidence during implementation. |
| Source order and shelf chronology, P02-T02, P03-T02 | Covered | Source row order remains canonical while verified first-on-sale dates put Midnight Massacre before Bloodties on the shelf. |
| Publication and licence boundary, P03-T01, P04-T02 | Covered | Exact CBRO credit and links, null source licences, project prose, permission exclusions, no source presentation, and no comic image bytes are explicit. |
| One Review and merge, P06, P07 | Covered with freshness correction needed | Exactly one independent Review is locked and no repeat is allowed; final merge authority remains central. PC-002 is needed so later reconciliation cannot bypass the evidence chain. |

## Verdict

* Verdict: Revise
* Rationale: The plan is well grounded and appropriately bounded, but it is not yet internally
  consistent with the caller's fixed five-event release and does not fully specify the mandatory
  evidence regeneration path for catalog changes discovered after the sole independent Review.
  Three smaller execution gaps concern the complete local gate set, bounded test ownership and
  failure proof, and research-artifact immutability. All findings are direct planner corrections and
  require no new research or user decision.

## Findings

| ID | Severity | Related IDs | Evidence | Concern and impact | Smallest useful change | Action owner | Exact resolving evidence | Decision route |
|---|---|---|---|---|---|---|---|---|
| PC-001 | High | Caller fixed release; Acceptance Criteria; P02-T03; P02-T04 | The caller fixes exactly five named events and 23 issues. The plan repeats that threshold, while phase details say a mapping mismatch can reduce the batch and approvals may pass for all five or produce a reduced release. | A four-event result could be treated as successful even though the missing-list semantic guard and authoritative release direction require all five. | Remove both reduction paths. State that any selected mapping, source, metadata, overlap, or approval failure blocks the whole MRT-003 release until centrally resolved; do not shorten a list, omit a selected event, or substitute another event. | Planning parent | Plan and details consistently require all five fixed IDs, 23 unique issues, and all five canonical and generated target sets for success, with any unresolved selected-candidate failure recorded as a genuine release blocker. | Direct planner correction; no user decision required. |
| PC-002 | High | Caller freshness rule; P05-T03; P06; P07-T02 | P05-T03 regenerates reports and approvals before the one Review. P07-T02 can reconcile current main after Review but names only conflict resolution and affected checks, despite the caller requiring complete-library plus four-peer report regeneration and reissued dependent digests and approvals after any catalog change. | A post-Review catalog change could reach merge with stale relationship authority, or regeneration could occur without an explicit owner and final validation path. A second independent Review is not available. | Extend P07-T02 so the central release coordinator repeats the P05-T03 freshness decision after the final main fetch: no relevant change permits continuation; any catalog change regenerates all five reports against the complete library and four peers, reissues packet-dependent mapping, peer, report, approval, authoring, and release digests as applicable, records central approvals, reruns the complete affected local and hosted gates, and blocks on an exact duplicate or unresolved disposition. Explicitly retain one Review and no repeat. | Planning parent | P07-T02 completion evidence records the final main commit, library digest, per-candidate comparison count, five current report and approval digests, central authority, final local results, and hosted conclusions, or records the precise genuine blocker. | Direct planner correction; no user decision required. |
| PC-003 | Medium | Locked full local gates; P05-T02; P05-T03 | docs/MAINTAINING.md defines seven deterministic local checks: lint, tests, counts, sizes, anchors, palette, and publication. P05-T02 enumerates all except sizes and palette. | The implementation could claim the locked local gate set passed without running two repository checks, including checks affected by catalog and documentation changes. | Add sizes and palette to the acceptance criteria, P05-T02 execution list, and final reconciliation rerun rule. Require all seven deterministic gates on the final reconciled tree. | Planning parent | The revised plan and details enumerate all seven checks, and completion evidence requires zero-exit results from the final reconciled tree after the last relevant edit. | Direct planner correction; no user decision required. |
| PC-004 | Medium | Test cap; P01-T03; P03-T03; P05-T01 | The plan caps new work at one test file and 14 semantic cases, but P01-T03 and P03-T03 both own broad overlapping contracts. P05-T01 permits a single provider or catalog mutation and does not require every new semantic check to be observed failing for its intended reason. | Implementation can exceed the cap, leave requirements without a named owner, or produce failure proof that establishes sensitivity for only one of several new checks. | Add a bounded allocation in the details that assigns every new semantic case to P01-T03 or P03-T03, identifies the requirement it proves, distinguishes reused existing coverage from a new case, totals no more than 14 in one new file, and requires a minimal reversible failure observation for every new case before restoration and pass. | Planning parent | Phase details contain a complete test allocation totaling at most 14 new cases in one file, with no duplicate ownership, and P05-T01 completion evidence requires each named new case to fail for its intended contract and pass after restoration. | Direct planner correction; no user decision required. |
| PC-005 | Low | RPI phase ownership; P01-T01 | P01-T01 lists research selected-evidence JSON as a likely target while also saying refreshed facts belong in the implementation changes record and later canonical CBRO artifacts. | The wording can be read as permission to rewrite historical research evidence during implementation, weakening the distinction between provisional research and implementation authority. | Mark all supplied research Markdown and JSON as read-only baseline inputs. Direct refreshed source and library facts into the new canonical CBRO inventory, packets, mappings, reports, approvals, and changes record only. | Planning parent | P01-T01 labels research artifacts read-only and names only implementation-owned canonical artifacts and the changes record as refreshed evidence outputs. | Direct planner correction; no user decision required. |

## Strengths and Residual Risk

* The complete inventory and cutoff are strongly supported: the source evidence accounts for positions
  1 through 58, excludes Maximum Security, and retains blocked, absorbed, subset, alternate-universe,
  and deferred states without silent row loss.
* The selected evidence is coherent: five mappings contain 23 unique issue IDs, and each provisional
  report binds the 89-list library plus four peer mappings for 93 comparisons.
* The provider architecture is proportionate. It avoids a broad CBH rename and avoids duplicating
  digest, resolver, overlap, approval, chronology, and vendoring policy.
* The source order and shelf chronology distinction is explicit and testable.
* Permission and publication boundaries are accurately limited to credited and linked use, exclude
  the Master Reading Order and Patreon material, retain null source licences, and make no claim over
  Marvel material.
* Residual risk remains that current main or source content changes during execution. The plan can
  accept that risk only through the corrected blocking and regeneration paths in PC-001 and PC-002.

## Questions or Blocking Evidence Gaps

* None. The supplied evidence supports this complete critique. The required revisions do not need
  additional research or a significant or divergent user decision.

## Limitations

* This critique did not fetch current main or live source pages and did not regenerate provisional
  reports. Those operations remain implementation gates and cannot be treated as completed by this
  assessment.
* This critique evaluates the proposed architecture and execution contract, not code that has not yet
  been implemented.

## Recommended Next Action

* Highest-impact finding: PC-001
* Action owner: Planning parent
* Smallest next action: Revise the plan and phase details once to make the five-event release
  indivisible, then apply PC-002 through PC-005 in the same planner revision without another critique.
* User response required: No

## Relevant Artifacts

| Artifact | Description |
|---|---|
| [.copilot-tracking/plans/2026-08-23/historical-event-reading-orders-plan.md](.copilot-tracking/plans/2026-08-23/historical-event-reading-orders-plan.md) | Final-candidate implementation plan assessed here. |
| [.copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md](.copilot-tracking/details/2026-08-23/historical-event-reading-orders-phase-details.md) | Task-level execution, ownership, dependency, and validation details assessed here. |
| [.copilot-tracking/research/2026-08-23/historical-event-reading-orders-research.md](.copilot-tracking/research/2026-08-23/historical-event-reading-orders-research.md) | Primary three-wave research synthesis and decision record. |
| [.copilot-tracking/research/subagents/2026-08-23/historical-event-reading-orders-c1-wider-external.md](.copilot-tracking/research/subagents/2026-08-23/historical-event-reading-orders-c1-wider-external.md) | External inventory and source-boundary evidence. |
| [.copilot-tracking/research/2026-08-23/historical-event-source-pages.json](.copilot-tracking/research/2026-08-23/historical-event-source-pages.json) | Timeline, page digest, retrieval, and issue-reference evidence. |
| [.copilot-tracking/research/2026-08-23/historical-event-pilot-resolution.json](.copilot-tracking/research/2026-08-23/historical-event-pilot-resolution.json) | Five selected exact mappings and provisional complete-library plus peer reports. |
| [.copilot-tracking/research/2026-08-23/historical-event-library-coverage.json](.copilot-tracking/research/2026-08-23/historical-event-library-coverage.json) | Complete 58-entry library coverage and blocker inventory. |
| [docs/MAINTAINING.md](docs/MAINTAINING.md) | Current maintenance workflow, deterministic gates, evidence layers, and central approval contract. |
| [docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md) | CBRO permission, attribution, licence, and publication boundary. |
| [.copilot-tracking/reviews/plans/2026-08-23/historical-event-reading-orders-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-23/historical-event-reading-orders-plan-critique.md) | This single complete final-candidate critique. |

## Next Steps

The active planning parent should apply PC-001 through PC-005 directly, finalize the revised plan
without another critique, and continue automatically into P01-T01. No user action is required.
