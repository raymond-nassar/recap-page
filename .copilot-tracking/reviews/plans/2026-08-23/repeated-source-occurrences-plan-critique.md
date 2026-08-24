<!-- markdownlint-disable-file -->
# RPI Plan Critique: Repeated source occurrences and Iron Man

## Metadata

* Task ID: MRT-002-C09-DUP
* Critique date: 2026-08-23
* Plan: .copilot-tracking/plans/2026-08-23/repeated-source-occurrences-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: Preserve every intentional source occurrence and its
  provenance while emitting each comic once in deterministic first-occurrence order. Keep selected
  ids unique through mapping, peers, overlap, approval, Markdown, payload, and catalog. Preserve CBH
  modern and character behavior and CBRO historical behavior. Migrate Groot 84/76. Publish only Iron
  Man and only after 815 occurrences normalize to 813 exact mappings. Keep Old Man Logan 98/96 and
  Planet Hulk 109/104 as test-backed follow-ups. Use no parser, inference, heuristic metadata,
  exceptions, runtime dependencies, second critique, or second Review. Complete failure proofs,
  gates, reconciliation, one Review, one PR, Node 20/24/lint CI, merge, and post-merge durable
  identity.
* Research and evidence considered:
  .copilot-tracking/research/2026-08-23/repeated-source-occurrences-research.md; Iron Man evidence in
  commit 06c2a5b6d6367706d241fcbefe41ce71aaa08f02; Old Man Logan and Planet Hulk evidence in commit
  8a3c8629253e079e117fc7218b5b9bc8a070d876; current contract baseline
  b9367d8bdf40cf335caf1c6b2d46dfedb5e25826.
* Decisions, dependencies, and acceptance criteria considered: The optional
  sourceOccurrenceCount and repeatedSourceReferences packet and mapping fields; unique packet rows;
  occurrence-total approvedSourceCount; reconstructed mapping source positions; packet, mapping,
  report, and approval digest chaining; CBRO source-row fallback; conditional provenance; unchanged
  absent-field digests; exact Iron Man resolution and relationship stop gates; reciprocal Groot
  refresh; locked file and test ownership; reconciliation before one Review; and post-merge identity
  outside pre-merge artifacts.
* Assessment boundary: This critique assesses the complete supplied planning boundary once. It can
  establish that the design and lifecycle are credible and identify plan corrections. It cannot
  establish Iron Man metadata availability or overlap outcomes because resolution was deliberately
  not run after the historical duplicate-source blocker.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|---|---|---|
| Caller occurrence and provenance contract; Research C2-C14 | Partial | The additive ledger, first-occurrence rule, digest mirrors, and unique downstream rows are covered, but the final approval seam does not explicitly re-derive two occurrence-derived mapping values. See PC-002. |
| Functional requirement: canonical source-position reconstruction; P01-T01, P01-T03 | Partial | The algorithm and Groot checkpoint are credible, but the Iron Man post-repeat checkpoint names canonical row 710 instead of row 716. See PC-001. |
| Caller unique selected-id contract; Research C5-C8; P01-P03 | Covered | Resolver, peer, overlap, approval, Markdown, payload, and catalog uniqueness remain unchanged and are assigned to existing owners. |
| Caller CBH and CBRO compatibility; Research C2-C8 and C16; P01-T01 and P01-T02 | Covered | Optional fields preserve old digest selection, both preparation paths are named, and CBRO sourceRowCount has an explicit occurrence-count fallback. |
| Caller Groot 84/76 migration; Research C12 and W1; P01-T03 and P03-T01 | Covered | Exact repeat positions 72-79, targets 8-15, selected-id preservation, digest refresh, and reciprocal post-Iron-Man report and approval refresh are present. |
| Caller Iron Man 815/813 release boundary; Research C9; P02-P03 | Partial | Counts, exact repeats, explicit source exclusions, metadata and relationship stop gates, and five new data targets are covered. One checkpoint is arithmetically wrong. See PC-001. |
| Caller Old Man Logan 98/96 and Planet Hulk 109/104 follow-ups; Research C10-C11; P01-T03 | Covered | Both exact historical shapes remain in-memory regression fixtures with no candidate product files. |
| Caller failure proofs; P01 completion evidence and locked mutation matrix | Partial | The matrix covers freshness, counts, positions, targets, identity, mirrors, provider fallback, and provenance, but omits explicit repeated-record field-shape mutations. See PC-003. |
| Caller release lifecycle; P03-T03 and P04 | Covered | Full gates, browser checks, reconciliation before one Review, finding routing, no-drift fetch, one PR, job-level Node 20/24/lint CI, merge, PR comment, and parent durable completion are sequenced. |
| Locked change and test ownership | Covered | No removals or new test files are planned; five new Iron Man data files are the maximum; shared, character, CBRO, resolver, overlap, and catalog ownership is explicit. |
| Iron Man metadata availability | Covered as a stop gate | The plan plainly states resolution has not run and stops before publication on any unmatched, ambiguous, post-horizon, duplicate, or otherwise non-exact row. It does not quietly assume availability. |

## Verdict

* Verdict: Revise
* Rationale: The selected representation, dependencies, migration, file boundary, provider
  compatibility, release stop gates, and one-Review lifecycle are credible. Three direct planner
  corrections are required before implementation: repair one source-position checkpoint, require
  approval-time validation of occurrence-derived mapping values even after all digests are
  recomputed, and complete the failure matrix for strict repeated-record shape.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [High]: The Iron Man reconstructed-position checkpoint names the wrong canonical row

* Related IDs: Functional requirement canonical mapping positions; P01-T01; P01-T03; Research C9.
* Evidence: The supplied Iron Man ledger places canonical rows 708 and 709 at source positions 708
  and 709, then repeats them at source positions 716 and 717. The next new comic at source position
  718 is canonical row 716. The plan and phase details instead require canonical row 710 to map to
  source position 718, even though row 710 occurs before either repeat and remains at source position
  710.
* Concern: A required semantic test would either fail a correct reconstruction or force an
  implementation to assign the wrong source provenance to six canonical rows.
* Impact: The plan could corrupt the exact first-occurrence mapping behavior that the new contract is
  meant to protect.
* Smallest useful change: Replace the Iron Man checkpoint with canonical row 716 mapping to source
  position 718, and explicitly retain canonical row 710 at source position 710.
* Action owner: Planning parent.
* Exact resolving evidence: The corrected plan and phase details both name row 716 at position 718;
  the character-owner test asserts row 716 equals 718 and row 710 equals 710; the 813 mapping rows
  reconstruct exactly from the 815-position ledger.
* Decision route: Direct planner correction. No user decision is required.

<!-- rpi:critique id=PC-002 -->
### PC-002 [High]: Approval does not explicitly validate all occurrence-derived mapping values against the packet

* Related IDs: Caller freshness and provenance requirements; Research C4 and selected
  recommendation; P01-T01; P01-T02; locked failure matrix.
* Evidence: The plan requires preparation to reconstruct each canonical mapping sourcePosition and
  set approvedSourceCount to the occurrence total. It explicitly compares the two optional mapping
  mirrors with the packet, but it does not require approval or authoring to recompute mapping-row
  source positions from the packet ledger or assert approvedSourceCount equals the packet occurrence
  total. A mapping can therefore change either value and recompute its mapping, report, and approval
  digests while leaving the explicit packet mirrors equal.
* Concern: Digest validity proves artifact self-consistency, not that derived mapping values still
  equal the frozen packet evidence.
* Impact: A fully re-digested but incorrectly derived mapping could pass approval with false
  occurrence provenance or a false approved source count.
* Smallest useful change: Add a shared approval and authoring preflight that derives the expected
  canonical source positions and occurrence total from the validated packet, then compares every
  mapping row sourcePosition and approvedSourceCount before accepting the digest chain. Apply it to
  CBH and CBRO through the shared owner.
* Action owner: Planning parent.
* Exact resolving evidence: P01-T02 and the failure matrix require two self-consistent tamper tests:
  one changes a mapping-row sourcePosition and one changes approvedSourceCount, recomputes every
  downstream digest, and proves shared approval and authoring still reject each mismatch for both
  provider paths.
* Decision route: Direct planner correction. No user decision is required.

<!-- rpi:critique id=PC-003 -->
### PC-003 [Medium]: The failure matrix does not prove the strict repeated-record field contract

* Related IDs: Functional requirement for repeated-record shape; P01-T01 completion evidence; locked
  failure-proof matrix.
* Evidence: P01-T01 requires an exact allowed field set and validated raw issue reference, raw range
  reference, normalized title, year, and issue number. The locked failure matrix names identity
  mismatch and an unsupported field in general acceptance prose, but it does not assign failure
  proofs for a missing required record field, an empty raw issue reference, an invalid raw range
  value, or an extra field.
* Concern: The stated rule that every new semantic guard is observed failing can be met on paper
  without proving the strict schema boundary that prevents partial provenance.
* Impact: Malformed or silently extended repeat evidence could survive if implementation checks only
  the count, position, target, and normalized identity.
* Smallest useful change: Add explicit missing-field, empty sourceIssueReference, invalid
  sourceRangeReference, and unsupported-field mutations to P01-T01 and the locked matrix.
* Action owner: Planning parent.
* Exact resolving evidence: Focused shared-owner tests reject each malformed record, and the changes
  record shows the smallest corresponding guard revert makes each test fail before restoration.
* Decision route: Direct planner correction. No user decision is required.

## Strengths and Residual Risk

* The flat ledger is the smallest supplied design that preserves all occurrences without weakening
  canonical output uniqueness. The rejected duplicate-row and prose-only alternatives remain
  correctly excluded.
* Counts reconcile across supplied evidence: Iron Man 815/813, Old Man Logan 98/96, Planet Hulk
  109/104, and Groot 84/76. The current baseline has 96 total readings, 13 Character Spotlight
  readings, and 4 Complete guides, so the planned 97, 14, and 5 release totals are credible.
* Optional-field digest selection preserves old packet and mapping digest meaning. Packet mirrors,
  report chaining, approval chaining, conditional Markdown, CBRO fallback, and reciprocal Groot
  refresh are properly sequenced.
* The accepted residual risk is candidate metadata availability. The earlier Iron Man lane stopped
  before metadata resolution, but P02 treats every non-exact row as a publication blocker and
  permits no inference, heuristic, or exception.
* Relationship outcomes are also intentionally unknown. Complete current-library reporting,
  disposition, final reconciliation, and reciprocal Groot refresh make this a controlled release
  gate rather than a planning assumption.
* The one-Review constraint is credible because reconciliation precedes Review and material
  post-Review drift stops for user direction instead of silently triggering another Review.

## Questions or Blocking Evidence Gaps

* None. All findings are direct planner corrections. Iron Man metadata and overlap results are
  implementation-time stop gates, not missing planning evidence.

## Limitations

* No live metadata resolution or overlap report was performed during this critique.
* Historical Old Man Logan and Planet Hulk files were treated as evidence only because their commit
  is not current implementation state.
* This critique does not predict whether Iron Man will pass P02; it confirms that failure is handled
  without publication.

## Recommended Next Action

* Highest-impact finding: PC-002.
* Action owner: Planning parent.
* Smallest next action: Correct PC-001 through PC-003 directly in the plan and phase details,
  disposition this sole critique, and begin P01 without requesting a second critique.
* User response required: No.

## Relevant Artifacts

| Artifact | Description |
|---|---|
| [.copilot-tracking/plans/2026-08-23/repeated-source-occurrences-plan.md](.copilot-tracking/plans/2026-08-23/repeated-source-occurrences-plan.md) | Final-candidate implementation and release plan assessed by this critique |
| [.copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md](.copilot-tracking/details/2026-08-23/repeated-source-occurrences-phase-details.md) | Phase and task execution details assessed by this critique |
| [.copilot-tracking/research/2026-08-23/repeated-source-occurrences-research.md](.copilot-tracking/research/2026-08-23/repeated-source-occurrences-research.md) | Selected design, evidence synthesis, simulations, and residual risks |
| [.copilot-tracking/reviews/plans/2026-08-23/repeated-source-occurrences-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-23/repeated-source-occurrences-plan-critique.md) | Sole formal final-candidate critique and complete finding set |

## Next Steps

No user action is required. The active planning parent should apply and disposition PC-001 through
PC-003 directly, then continue to P01 without another critique.
