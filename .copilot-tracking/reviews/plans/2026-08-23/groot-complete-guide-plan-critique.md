<!-- markdownlint-disable-file -->
# RPI Plan Critique: Groot complete guide

## Metadata

* Task ID: MRT-002-C07
* Critique date: 2026-08-23
* Plan: .copilot-tracking/plans/2026-08-23/groot-complete-guide-plan.md
* Phase details: .copilot-tracking/details/2026-08-23/groot-complete-guide-phase-details.md
* Critique execution status: Complete

## Inputs and Criterion Boundary

* Task context and caller requirements: Groot is priority rank 9 and must ship as a separate 76-issue
  Complete guide. All 41 Rocket-shared issues remain in both guides, Rocket is not altered, and the release
  uses a fresh packet, exact mapping, complete-current-library plus Rocket-peer report, central dispositions,
  exact source order, source and authoring freshness, stale-evidence rejection, explicit Character Spotlight
  filters, one critique, one later Review, automatic PR, hosted CI, and merge.
* Research and evidence considered: .copilot-tracking/research/2026-08-23/groot-complete-guide-research.md,
  .copilot-tracking/plans/2026-08-23/groot-complete-guide-plan.md,
  .copilot-tracking/details/2026-08-23/groot-complete-guide-phase-details.md,
  scripts/lib/cbh-inventory.mjs, scripts/report-order-overlap.mjs, scripts/author-cbh-packet.mjs,
  scripts/data/cbh-character-inventory.json, scripts/data/cbh-packets/rocket-raccoon-reading-order.json,
  test/cbh-character-spotlight.test.js, test/catalog-shelves.test.js, test/cbh-batch.test.js,
  test/cbh-batch-four.test.js, and src/js/lib/catalog.js.
* Decisions, dependencies, and acceptance criteria considered: the confirmed separate-release and no-Rocket-
  alteration decisions; the 76-row and 41-shared-issue boundaries; the three partial relationships; current
  main after pull request 174; the five-new-production-data-file ceiling; no removals; no new test file; named
  semantic and taxonomy owners; fresh evidence, release-gate, browser, Review, PR, CI, reconciliation, merge,
  and durable-state criteria.
* Assessment boundary: This critique assesses whether the supplied final-candidate plan and phase details can
  credibly execute the caller's confirmed boundary against the cited current repository contracts. It does
  not re-fetch external sources, reopen confirmed product choices, perform implementation, or assess evidence
  outside the supplied research and cited code paths.

## Coverage Assessment

| Requirement, research, phase, or task ID | Coverage | Evidence or concern |
|---|---|---|
| Caller rank, split release, exact 76 rows, 41 shared issues, and no Rocket alteration | Covered | The plan carries each confirmed decision into goals, non-goals, acceptance criteria, P01, P02, and Rocket non-change evidence. |
| Research C1-C3, W1, and P01-T01 source boundary and exact sequence | Partial | The expected digest and order are explicit, but the negative freshness proof does not yet distinguish stale source evidence from ordinary packet-integrity drift. See PC-002. |
| Research W2-W7 and P01-T02 exact mapping | Covered | The plan requires 76 exact unique IDs, explicit context resolution, ordered source-reference equality, no inference, and fresh packet and mapping digests. |
| Research C4-C5 and P02-T01 complete library, Rocket peer, and central dispositions | Covered | The 90 comparisons, three exact partial counts, Rocket peer digest, complete dispositions, and library, report, and approval freshness are explicit. |
| Research C5-C6 and P02-T02 selected-peer authoring | Partial | The current one-guide authorer cannot consume Rocket as an external peer, while the locked boundary leaves its required change conditional and names the wrong core guard owner. See PC-001. |
| Research C7-C8 and Character Spotlight taxonomy | Covered | The plan fixes Groot as character-run plus complete-guide and pins All 13/12, Best of 5/5, and Complete guides 4/4 with the requested taxonomy owner. |
| P03-T01 semantic proof and locked test boundaries | Partial | The named semantic and taxonomy owners are correct, but the reusable authoring guard owner and source-freshness mutation need the corrections in PC-001 and PC-002. No new test file is needed. |
| P03-T02 records, gates, anchors, contract, and browser evidence | Covered | The directly affected records, full local gate set, read-before-bless anchor process, live contract, two Edge viewports, filter observations, overflow check, and cleanup are planned. |
| P04 one Review, PR, hosted CI, reconciliation, merge, and durable completion | Covered | The plan permits exactly one later Review, routes findings without a loop, requires the three hosted jobs, reconciles current main, merges, and persists final identities. |
| Locked change boundary | Covered | No removal is planned, exactly five new production data files are enumerated, and no new test file is permitted. |

## Verdict

* Verdict: Revise
* Rationale: The product boundary, source sequence, relationship model, taxonomy, release gates, and automatic
  delivery path are credible. Two planner-owned corrections are required before implementation: selected-peer
  authoring must be an unconditional contract change with its guard in the actual core authoring test owner,
  and the source-boundary negative must reject a self-consistent stale digest rather than only an unrecomputed
  packet mutation. Neither issue requires a new product decision, a second critique, or more research.

## Findings

<!-- rpi:critique id=PC-001 -->
### PC-001 [High]: Make external shipped-peer authoring mandatory and assign its actual guard owner

* Related IDs: caller fresh Rocket-peer report and no-Rocket-alteration requirements; Research C4-C6; P02-T01;
  P02-T02; P03-T01.
* Evidence: scripts/report-order-overlap.mjs already accepts external peer mapping paths, removes peer IDs from
  the factual library digest, compares each peer once, and emits peerDigests. In contrast,
  scripts/author-cbh-packet.mjs derives peer mappings only from the candidate IDs being authored. A one-guide
  Groot call therefore treats shipped Rocket as an ordinary existing order, computes a library digest that
  includes Rocket, and expects no peer digest, which cannot validate the planned report that excludes Rocket
  from the library digest and names its mapping digest. test/cbh-batch.test.js owns the generic authoring,
  relationship, peer-freshness, and argument guards; test/cbh-batch-four.test.js owns the shipped fourth-batch
  fixture and chronology instead.
* Concern: The phase details correctly anticipate an external named-peer authoring option, but the locked
  targets still say the authorer changes only if alignment is needed and assign the reusable guard to
  test/cbh-batch-four.test.js. Current code proves alignment is required, not optional. The wrong owner also
  risks adding a Groot-specific fixture without proving the reusable authoring contract.
* Impact: Following the locked boundary literally can produce evidence that passes report generation but must
  fail authoring on the library digest or peer digest. A weak local workaround could instead compare Rocket
  twice, drop its peer freshness, or place Rocket among authored candidates, conflicting with the separate
  release and no-alteration decisions.
* Smallest useful change: Make scripts/author-cbh-packet.mjs an unconditional P02-T02 target. Define one
  external-peer input for authorPacket and its command path that loads Rocket's mapping without adding Rocket
  to authored candidate IDs, excludes Rocket from the reviewed library digest and ordinary existing-order
  set, adds it exactly once to expected comparison IDs and peerMappings, and leaves its manifest entry and
  files untouched. Change the reusable authoring guard owner to test/cbh-batch.test.js. Keep the actual Groot
  evidence-chain assertions in test/cbh-character-spotlight.test.js and use test/cbh-batch-four.test.js only if
  a fourth-batch invariant is genuinely affected.
* Action owner: planning parent.
* Exact resolving evidence: The revised P02-T02 and P03-T01 details make the external-peer authoring contract
  mandatory and name test/cbh-batch.test.js as its guard owner. The planned guard executes authorPacket against
  an isolated manifest containing a shipped peer and proves the peer is excluded from the library digest,
  supplied once to relationship validation, preserved in the resulting manifest, and rejected when its
  mapping or peer digest is stale. The Groot semantic test separately proves the real 41-issue Rocket partial
  and byte-level or diff-backed Rocket non-change.
* Decision route: Direct planner correction. The caller has already selected separate authoring, named Rocket
  as a peer, forbidden Rocket alteration, and allowed the existing authoring guard only when needed.

<!-- rpi:critique id=PC-002 -->
### PC-002 [Medium]: Make source-boundary freshness independent of the packet's outer integrity digest

* Related IDs: caller source freshness and stale-evidence rejection requirements; Research C2, C9-C10, and W1;
  P01-T01; P03-T01.
* Evidence: scripts/lib/cbh-inventory.mjs currently allows no source-boundary digest field in the frozen packet
  schema. Its packet digest hashes all packet content, so changing any packet value without recomputing that
  outer digest already fails as generic packet drift. The existing character semantic negative follows that
  pattern by mutating source content and relying on the stale packet digest. The plan names the accepted
  issue-bearing digest and says a changed boundary digest fails, but does not require a mutation that
  recomputes the packet digest.
* Concern: A test that changes the issue-bearing digest but leaves packetDigest untouched proves only packet
  integrity. It does not prove that a self-consistent packet carrying a different, stale source boundary is
  rejected against the accepted fresh source evidence. This is the exact distinction the research makes
  between volatile full-page content and the stable nine-block trust boundary.
* Impact: The source-freshness acceptance criterion can appear green while the implementation accepts any
  well-formed replacement boundary digest once its outer packet digest is regenerated. Downstream mapping,
  report, and approval digests would then faithfully bind the wrong source evidence.
* Smallest useful change: In P01-T01 and P03-T01, name a packet field for the issue-bearing SHA-256 value,
  require schema and lowercase-digest validation, and define the accepted value
  2f73854ba172a902a511cb2ae45ee4236bf81367166126667370c482c26478e3 as the candidate's semantic trust root.
  Require a negative that changes this field and recomputes packetDigest, then still fails the expected
  source-boundary assertion. Keep a separate malformed-digest negative if format validation is also claimed.
* Action owner: planning parent.
* Exact resolving evidence: The revised P01-T01 specifies the field, accepted value, schema validation, and
  propagation through packetDigest. The revised P03-T01 requires the semantic owner to assert the exact
  accepted digest and retrieval date and to reject a changed boundary after recomputing packetDigest. Final
  tests then show malformed format, self-consistent stale source evidence, and ordinary packet tampering fail
  for distinct reasons.
* Decision route: Direct planner correction. The accepted digest, retrieval date, and stable-boundary choice
  are already confirmed, so no significant or divergent user decision remains.

## Strengths and Residual Risk

* The plan preserves every confirmed caller decision and rejects the tempting but forbidden shortcuts of
  merging Groot with Rocket or removing shared issues.
* The 76-row shape, explicit manual Rocket Raccoon & Groot context resolution, exact mapping, three partial
  counts, 90 dispositions, final catalog and taxonomy counts, and all filter outcomes have observable checks.
* The five-new-production-data-file and zero-new-test-file ceilings are explicit and compatible with the
  planned release.
* The local, browser, hosted-CI, reconciliation, Review, merge, and durable-state sequence is complete.
* Residual live-contract availability risk is explicitly owned by the release-time contract gate and does not
  block planning.

## Questions or Blocking Evidence Gaps

* None. Both findings are direct planner corrections under decisions the caller has already confirmed.

## Limitations

* External WordPress and metadata sources were not re-fetched because the critique boundary treats the
  supplied completed research as evidence and forbids open-ended research.
* This critique establishes plan credibility, not implementation correctness. Exact generated digests, gate
  counts, browser observations, CI identities, and merge identities can exist only during later execution.

## Recommended Next Action

* Highest-impact finding: PC-001.
* Action owner: planning parent.
* Smallest next action: Revise P02-T02, P03-T01, and the locked test boundary to make shipped-peer authoring
  mandatory in the core authoring owner, then add the self-consistent source-boundary negative from PC-002 and
  finalize without another critique.
* User response required: No.

## Artifact Links

| Artifact | Description |
|---|---|
| [.copilot-tracking/research/2026-08-23/groot-complete-guide-research.md](.copilot-tracking/research/2026-08-23/groot-complete-guide-research.md) | Supplied source, sequence, relationship, taxonomy, and freshness evidence. |
| [.copilot-tracking/plans/2026-08-23/groot-complete-guide-plan.md](.copilot-tracking/plans/2026-08-23/groot-complete-guide-plan.md) | Final-candidate plan assessed by this critique. |
| [.copilot-tracking/details/2026-08-23/groot-complete-guide-phase-details.md](.copilot-tracking/details/2026-08-23/groot-complete-guide-phase-details.md) | Task-level execution details assessed by this critique. |
| [.copilot-tracking/reviews/plans/2026-08-23/groot-complete-guide-plan-critique.md](.copilot-tracking/reviews/plans/2026-08-23/groot-complete-guide-plan-critique.md) | This one complete final-candidate critique and finding set. |

## Next Steps

* The active planning parent should apply PC-001 and PC-002 directly, finalize the plan and phase details, and
  continue the confirmed automatic RPI lifecycle. No user action and no second plan critique are required.
